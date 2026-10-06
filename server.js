/**
 * 食譜 App 後端伺服器 — 零相依（Node 內建 http + node:sqlite）
 * 啟動：npm start   （或 node --disable-warning=ExperimentalWarning server.js）
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3777);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'recipes.db');
const MAX_BODY = 30 * 1024 * 1024; // 30MB（封面圖可能以 base64 內嵌）

/* ------------------------------------------------------------------ */
/* 資料庫                                                              */
/* ------------------------------------------------------------------ */

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  name          TEXT    DEFAULT '',
  password_hash TEXT    NOT NULL,
  created_at    TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  expires_at TEXT
);
CREATE TABLE IF NOT EXISTS recipes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  description   TEXT    DEFAULT '',
  category      TEXT    DEFAULT '',
  video_url     TEXT    DEFAULT '',
  video_title   TEXT    DEFAULT '',
  cover         TEXT    DEFAULT '',
  servings      INTEGER DEFAULT 2,
  prep_minutes  INTEGER DEFAULT 0,
  cook_minutes  INTEGER DEFAULT 0,
  difficulty    TEXT    DEFAULT '',
  tags          TEXT    DEFAULT '[]',
  notes         TEXT    DEFAULT '',
  source        TEXT    DEFAULT '',
  favorite      INTEGER DEFAULT 0,
  created_at    TEXT    DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ingredients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  qty        REAL,
  unit       TEXT    DEFAULT '',
  group_name TEXT    DEFAULT '',
  sort       INTEGER DEFAULT 0,
  in_list    INTEGER DEFAULT 0,
  checked    INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS steps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sort      INTEGER NOT NULL,
  title     TEXT    DEFAULT '',
  body      TEXT    NOT NULL,
  t_start   INTEGER,
  t_end     INTEGER,
  tip       TEXT    DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_steps_recipe       ON steps(recipe_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user      ON sessions(user_id);
`);

/* ---- 舊資料庫補欄位（user_id）；原有資料稍後指派給第一個註冊者 ---- */
for (const ddl of [
  'ALTER TABLE recipes ADD COLUMN user_id INTEGER REFERENCES users(id)',
  'ALTER TABLE ingredients ADD COLUMN user_id INTEGER REFERENCES users(id)',
]) {
  try { db.exec(ddl); } catch { /* 已存在 */ }
}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id)'); } catch { /* ignore */ }
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch { /* 已存在 */ }

/** 管理員檢查：第一位註冊者自動成為管理員；可由後台調整 */
function isAdmin(user) {
  return !!(user && user.is_admin);
}

function requireAdmin(user) {
  return isAdmin(user);
}

/** 刪除使用者及其全部資料（食譜連同步驟／食材、自訂清單、工作階段） */
function deleteUserCascade(userId) {
  const owned = db.prepare('SELECT id FROM recipes WHERE user_id = ?').all(userId).map((r) => r.id);
  for (const rid of owned) {
    db.prepare('DELETE FROM recipes WHERE id = ?').run(rid); // steps/ingredients 經 CASCADE 刪除
  }
  // 食譜食材已隨 CASCADE 清掉；剩下的自訂清單項目與工作階段一併清除
  db.prepare('DELETE FROM ingredients WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return { recipes: owned.length, changes: r.changes };
}

/* ------------------------------------------------------------------ */
/* 使用者認證（scrypt 雜湊 + 工作階段 token）                            */
/* ------------------------------------------------------------------ */

const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function bearerToken(req) {
  const h = req.headers.authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, u.is_admin FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND (s.expires_at IS NULL OR s.expires_at > datetime('now','localtime'))
  `).get(token);
  return row || null;
}

/** 把資料庫裡尚未歸屬的舊食譜／食材指派給第一個註冊者 */
function claimOrphanData(userId) {
  const orphans = db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id IS NULL').get().n;
  if (!orphans) return 0;
  db.prepare('UPDATE recipes SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE ingredients SET user_id = ? WHERE user_id IS NULL').run(userId);
  return orphans;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name || '', is_admin: !!u.is_admin };
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJSON(res, status, { ok: false, error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('請求內容過大（上限 30MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON 格式錯誤'));
      }
    });
    req.on('error', reject);
  });
}

function parseTags(v) {
  if (Array.isArray(v)) return JSON.stringify(v.map(String));
  if (typeof v === 'string') {
    const arr = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    return JSON.stringify(arr);
  }
  return '[]';
}

/* ------------------------------------------------------------------ */
/* 食譜資料                                                            */
/* ------------------------------------------------------------------ */

function recipeRow(row) {
  if (!row) return null;
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch { tags = []; }
  return { ...row, tags, favorite: !!row.favorite };
}

const LIST_SQL = `
SELECT r.*,
  (SELECT COUNT(*) FROM ingredients i WHERE i.recipe_id = r.id) AS ingredient_count,
  (SELECT COUNT(*) FROM steps s          WHERE s.recipe_id = r.id) AS step_count,
  (SELECT COUNT(*) FROM ingredients i WHERE i.recipe_id = r.id AND i.in_list = 1) AS listed_count
FROM recipes r`;

function listRecipes({ q, category, fav, tag, userId } = {}) {
  const where = ['r.user_id = ?'];
  const params = [userId];
  if (q) {
    where.push('(r.title LIKE ? OR r.description LIKE ? OR r.tags LIKE ? OR r.category LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (category) { where.push('r.category = ?'); params.push(category); }
  if (tag) { where.push('r.tags LIKE ?'); params.push(`%"${tag}"%`); }
  if (fav) where.push('r.favorite = 1');
  const sql = `${LIST_SQL}${' WHERE ' + where.join(' AND ')}
    ORDER BY r.favorite DESC, r.updated_at DESC, r.id DESC`;
  return db.prepare(sql).all(...params).map((r) => ({
    ...recipeRow(r),
    ingredients: undefined, steps: undefined,
  }));
}

function getRecipe(id, userId) {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  const recipe = recipeRow(row);
  recipe.ingredients = db
    .prepare('SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY sort, id')
    .all(id);
  recipe.steps = db
    .prepare('SELECT * FROM steps WHERE recipe_id = ? ORDER BY sort, id')
    .all(id);
  return recipe;
}

function saveRecipe(id, body, userId) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('食譜名稱必填');

  const fields = {
    title,
    description: String(body.description || ''),
    category: String(body.category || ''),
    video_url: String(body.video_url || ''),
    video_title: String(body.video_title || ''),
    cover: String(body.cover || ''),
    servings: Math.max(1, Number(body.servings) || 2),
    prep_minutes: Math.max(0, Number(body.prep_minutes) || 0),
    cook_minutes: Math.max(0, Number(body.cook_minutes) || 0),
    difficulty: String(body.difficulty || ''),
    tags: parseTags(body.tags),
    notes: String(body.notes || ''),
    source: String(body.source || ''),
    favorite: body.favorite ? 1 : 0,
  };

  let recipeId = id;
  if (id) {
    const exists = db.prepare('SELECT id FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
    if (!exists) throw new Error('找不到食譜');
    db.prepare(`
      UPDATE recipes SET title=@title, description=@description, category=@category,
        video_url=@video_url, video_title=@video_title, cover=@cover, servings=@servings,
        prep_minutes=@prep_minutes, cook_minutes=@cook_minutes, difficulty=@difficulty,
        tags=@tags, notes=@notes, source=@source, favorite=@favorite,
        updated_at=datetime('now','localtime')
      WHERE id=@id`).run({ ...fields, id });
  } else {
    const r = db.prepare(`
      INSERT INTO recipes (title, description, category, video_url, video_title, cover,
        servings, prep_minutes, cook_minutes, difficulty, tags, notes, source, favorite, user_id)
      VALUES (@title, @description, @category, @video_url, @video_title, @cover,
        @servings, @prep_minutes, @cook_minutes, @difficulty, @tags, @notes, @source, @favorite, @user_id)
    `).run({ ...fields, user_id: userId });
    recipeId = Number(r.lastInsertRowid);
  }

  // 食材：有 id 就更新（保留採購狀態），沒有就新增，缺席的刪除
  const incoming = Array.isArray(body.ingredients) ? body.ingredients : [];
  const keepIds = new Set();
  incoming.forEach((ing, idx) => {
    const name = String(ing.name || '').trim();
    if (!name) return;
    const data = {
      name,
      qty: ing.qty === '' || ing.qty === null || ing.qty === undefined ? null : Number(ing.qty),
      unit: String(ing.unit || ''),
      group_name: String(ing.group_name || ''),
      sort: idx,
      in_list: ing.in_list ? 1 : 0,
      checked: ing.checked ? 1 : 0,
    };
    if (ing.id) {
      const res = db.prepare(`
        UPDATE ingredients SET name=@name, qty=@qty, unit=@unit, group_name=@group_name,
          sort=@sort, in_list=@in_list, checked=@checked
        WHERE id=@id AND recipe_id=@recipe_id`).run({ ...data, id: ing.id, recipe_id: recipeId });
      if (res.changes > 0) { keepIds.add(ing.id); return; }
    }
    const res = db.prepare(`
      INSERT INTO ingredients (recipe_id, name, qty, unit, group_name, sort, in_list, checked, user_id)
      VALUES (@recipe_id, @name, @qty, @unit, @group_name, @sort, @in_list, @checked, @user_id)
    `).run({ ...data, recipe_id: recipeId, user_id: userId });
    keepIds.add(Number(res.lastInsertRowid));
  });
  if (id) {
    const existing = db.prepare('SELECT id FROM ingredients WHERE recipe_id = ?').all(recipeId);
    for (const row of existing) {
      if (!keepIds.has(row.id)) db.prepare('DELETE FROM ingredients WHERE id = ?').run(row.id);
    }
  }

  // 步驟：一律重建（保持順序）
  db.prepare('DELETE FROM steps WHERE recipe_id = ?').run(recipeId);
  const insertStep = db.prepare(`
    INSERT INTO steps (recipe_id, sort, title, body, t_start, t_end, tip)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  (Array.isArray(body.steps) ? body.steps : []).forEach((st, idx) => {
    const bodyText = String(st.body || '').trim();
    if (!bodyText) return;
    insertStep.run(
      recipeId,
      idx,
      String(st.title || ''),
      bodyText,
      st.t_start === '' || st.t_start === null || st.t_start === undefined ? null : Number(st.t_start),
      st.t_end === '' || st.t_end === null || st.t_end === undefined ? null : Number(st.t_end),
      String(st.tip || ''),
    );
  });

  db.prepare(`UPDATE recipes SET updated_at = datetime('now','localtime') WHERE id = ?`).run(recipeId);
  return getRecipe(recipeId, userId);
}

/* ------------------------------------------------------------------ */
/* 採購清單                                                            */
/* ------------------------------------------------------------------ */

function shoppingList(userId) {
  return db.prepare(`
    SELECT i.*, COALESCE(r.title, '自訂項目') AS recipe_title, r.id AS rid
    FROM ingredients i LEFT JOIN recipes r ON r.id = i.recipe_id
    WHERE i.in_list = 1
      AND ((i.recipe_id IS NOT NULL AND r.user_id = ?) OR (i.recipe_id IS NULL AND i.user_id = ?))
    ORDER BY CASE WHEN r.id IS NULL THEN 1 ELSE 0 END, r.title, i.sort, i.id`).all(userId, userId);
}

/** 檢查這個食材是否屬於該使用者（食譜食材看食譜擁有者） */
function ownsIngredient(ingId, userId) {
  const row = db.prepare(`
    SELECT i.id FROM ingredients i LEFT JOIN recipes r ON r.id = i.recipe_id
    WHERE i.id = ? AND ((i.recipe_id IS NOT NULL AND r.user_id = ?) OR (i.recipe_id IS NULL AND i.user_id = ?))
  `).get(ingId, userId, userId);
  return !!row;
}

/* ------------------------------------------------------------------ */
/* YouTube 影片資訊（伺服器端 proxy，避免 CORS）                        */
/* ------------------------------------------------------------------ */

async function videoInfo(rawUrl) {
  const id = parseVideoId(rawUrl);
  if (!id) throw new Error('無法辨識的影片連結');

  const canonical = `https://www.youtube.com/watch?v=${id}`;
  const endpoint = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(canonical);
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`影片資訊取得失敗（${res.status}）`);
  const data = await res.json();
  return {
    ok: true,
    id,
    url: canonical,
    title: data.title || '',
    author: data.author_name || '',
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

function parseVideoId(rawUrl) {
  if (!rawUrl) return null;
  // 直接給 11 碼 ID
  if (/^[\w-]{11}$/.test(String(rawUrl).trim())) return String(rawUrl).trim();
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'youtu.be' || u.hostname.endsWith('.youtu.be')) {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{6,})/);
    if (m) return m[2];
  } catch { /* ignore */ }
  const m = String(rawUrl).match(/(?:v=|\/)([\w-]{11})(?:[?&/]|$)/);
  return m ? m[1] : null;
}

/**
 * 取得影片「內容」：說明文字（description）、章節、是否有字幕軌。
 * 說明文字是最可靠的自動擷取來源；字幕端點 YouTube 要求憑證，只能回報有無。
 */
async function videoContent(rawUrl) {
  const id = parseVideoId(rawUrl);
  if (!id) throw new Error('無法辨識的影片連結');
  const canonical = `https://www.youtube.com/watch?v=${id}`;

  const res = await fetch(canonical, {
    headers: {
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`影片頁面取得失敗（${res.status}）`);
  const html = await res.text();

  const unescapeStr = (s) => { try { return JSON.parse('"' + s + '"'); } catch { return s; } };

  const descM = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  const description = descM ? unescapeStr(descM[1]) : '';

  const chunkStart = html.indexOf('"videoDetails":');
  const chunk = chunkStart >= 0 ? html.slice(chunkStart, chunkStart + 8000) : '';
  const titleM = chunk.match(/"title":"((?:[^"\\]|\\.)*)"/);
  const authorM = chunk.match(/"author":"((?:[^"\\]|\\.)*)"/);
  const lenM = chunk.match(/"lengthSeconds":"(\d+)"/);

  let captionLangs = [];
  const capM = html.match(/"captionTracks":(\[.*?\])/);
  if (capM) {
    try { captionLangs = JSON.parse(capM[1]).map((t) => t.languageCode + (t.kind === 'asr' ? '(自動)' : '')); }
    catch { captionLangs = []; }
  }

  // 頁面內建章節（若影片有設章節）
  const chapters = [];
  const chapRe = /"chapterRenderer":\{"title":\{"(?:simpleText|text)":"((?:[^"\\]|\\.)*)"\}[^}]*?"timeRangeStartMillis":(\d+)/g;
  let cm;
  while ((cm = chapRe.exec(html)) !== null) {
    chapters.push({ title: unescapeStr(cm[1]), t: Math.round(Number(cm[2]) / 1000) });
    if (chapters.length >= 50) break;
  }

  return {
    ok: true,
    id,
    url: canonical,
    title: titleM ? unescapeStr(titleM[1]) : '',
    author: authorM ? unescapeStr(authorM[1]) : '',
    description,
    chapters,
    captionLangs,
    hasCaptions: captionLangs.length > 0,
    lengthSeconds: lenM ? Number(lenM[1] || 0) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* YouTube 字幕逐字稿（免金鑰；套件自行處理 PoToken / BotGuard）           */
/* ------------------------------------------------------------------ */

/**
 * 從可用字幕裡挑一個語言：
 *  1. 依 hint（影片說明／標題的語系）配對（優先人工字幕）
 *  2. 否則優先「自動產生字幕」所在的語系（＝原音語系）
 *  3. 否則 en → zh → 第一個
 */
function pickLanguage(available, hint) {
  const list = Array.isArray(available) ? available : [];
  if (!list.length) return null;
  const code = (x) => String(x.languageCode || '');
  const manual = list.filter((x) => !x.isAutoGenerated);

  if (hint) {
    const h = String(hint).toLowerCase();
    const hit = manual.find((x) => code(x).toLowerCase() === h)
      || manual.find((x) => code(x).toLowerCase().startsWith(h) || h.startsWith(code(x).toLowerCase().split('-')[0]))
      || list.find((x) => code(x).toLowerCase() === h)
      || list.find((x) => code(x).toLowerCase().startsWith(h));
    if (hit) return code(hit);
  }
  // 原音語系：有自動產生字幕的那個
  const auto = list.find((x) => x.isAutoGenerated);
  if (auto) {
    const inSame = manual.find((x) => code(x) === code(auto)) || auto;
    return code(inSame);
  }
  for (const pref of ['en', 'en-US', 'zh-TW', 'zh-Hant', 'zh-HK', 'zh']) {
    const m = manual.find((x) => code(x) === pref) || list.find((x) => code(x) === pref);
    if (m) return code(m);
  }
  return code(manual[0] || list[0]);
}

/** 粗略判斷文字語系：'zh' / 'en' / '' */
function detectTextLang(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const total = cjk + latin;
  if (!total) return '';
  if (cjk / total > 0.25) return 'zh';
  if (latin / total > 0.7) return 'en';
  return '';
}

/**
 * 取得字幕逐字稿。主用 youtube-transcript-plus（CJS/ESM 皆可），
 * 失敗則退回 get-youtube-transcript（ESM）。兩者都會自己鑄 PoToken。
 * opts.lang — 語系代碼（'en'、'zh-HK'…）；不給則自動挑選。
 * opts.hint — 語系提示（來自影片說明／標題），供自動挑選參考。
 */
async function fetchTranscript(videoIdOrUrl, opts = {}) {
  const attempts = [];
  try {
    const plus = require('youtube-transcript-plus');
    attempts.push(async () => {
      let available = [];
      try { available = await plus.listLanguages(videoIdOrUrl); } catch { /* 有些影片列不出來 */ }
      const lang = opts.lang || pickLanguage(available, opts.hint);
      const segs = await plus.fetchTranscript(videoIdOrUrl, {
        includeTimestamps: true,
        ...(lang ? { lang } : {}),
      });
      return {
        source: 'youtube-transcript-plus',
        language: lang || (segs[0] && segs[0].lang) || '',
        available: (available || []).map((x) => ({ code: x.languageCode, auto: !!x.isAutoGenerated })),
        segments: (Array.isArray(segs) ? segs : []).map((s) => ({
          t: Number(s.offset ?? s.start ?? 0),
          duration: Number(s.duration || 0),
          text: String(s.text || '').trim(),
        })).filter((s) => s.text),
      };
    });
  } catch { /* 套件不存在 */ }

  if (!attempts.length) {
    attempts.push(async () => {
      const mod = require('get-youtube-transcript');
      const r = await mod.getTranscript(videoIdOrUrl, opts.lang ? { lang: opts.lang } : {});
      return {
        source: 'get-youtube-transcript',
        language: r.language || opts.lang || '',
        available: [],
        segments: (r.segments || []).map((s) => ({
          t: Number(s.start ?? 0),
          duration: Number(s.duration || 0),
          text: String(s.text || '').trim(),
        })).filter((s) => s.text),
      };
    });
  }

  let lastErr;
  for (const fn of attempts) {
    try {
      const r = await fn();
      if (r.segments.length) return r;
      lastErr = new Error('字幕是空的');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('取得字幕失敗');
}

/**
 * 把逐字稿片段聚合成「步驟」：
 * 依停頓（>3.2 秒）、句尾標點、長度上限切分，並保留起始時間碼。
 */
function transcriptToSteps(segments) {
  const steps = [];
  let buf = [];
  let startT = null;
  let lastEnd = null;

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const t = Number(seg.t) || 0;
    if (startT === null) startT = t;
    buf.push(text);
    const endT = t + (Number(seg.duration) || 0);
    const joined = buf.join('');
    const pause = lastEnd === null ? 0 : t - lastEnd;
    const sentenceEnd = /[。！？!?…]$/.test(text);
    const tooLong = joined.length >= 90;
    if ((sentenceEnd && joined.length >= 18) || pause > 3.2 || tooLong) {
      steps.push({ title: '', body: joined, t: Math.round(startT), tip: '' });
      buf = [];
      startT = null;
    }
    lastEnd = endT;
  }
  if (buf.length) {
    steps.push({ title: '', body: buf.join(''), t: startT !== null ? Math.round(startT) : null, tip: '' });
  }
  return steps.slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* AI 智慧解析（使用者自備 API Key，金鑰不落盤）                         */
/* ------------------------------------------------------------------ */

const AI_PROMPT = `你是食譜整理助手。以下是一段煮食教學影片的說明文字或字幕逐字稿。請把它整理成結構化食譜，只輸出 JSON，不要任何其他文字或程式碼區塊。

要求：
1. 食材要乾淨：只留中文名稱（若原文是「蠔仔/baby oyster」這種中英混雜，就只取「蠔仔」）；數量與單位分開填（如 qty:500, unit:"g"）；沒有數量就填 ""。
2. 步驟要可執行：每個步驟一句清楚的動作；若原文有時間碼就填 t（秒數，沒有就 null）；可幫忙取一個簡短步驟標題（title）與一個實用小提示（tip，沒有就留空）。
3. 若內容裡沒有做法，steps 就給空陣列；不要憑空捏造步驟。
4. 不要把器材、連結、社群文字當成食材或步驟。
5. 份量若提到就填 servings，否則給 2。

嚴格輸出這個 JSON 結構：
{
  "title": "",
  "servings": 2,
  "ingredients": [ { "name": "", "qty": "", "unit": "", "group_name": "" } ],
  "steps": [ { "title": "", "body": "", "t": null, "tip": "" } ]
}`;

async function aiParse({ text, title, apiKey, baseUrl, model }) {
  const base = String(baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: model || 'deepseek-chat',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_PROMPT },
        {
          role: 'user',
          content: `影片標題：${title || '（無）'}\n\n--- 內容開始 ---\n${String(text).slice(0, 14000)}\n--- 內容結束 ---`,
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 服務回應 ${res.status}：${t.slice(0, 180)}`);
  }
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content || '';
  const cleaned = String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error('AI 回應不是有效 JSON'); }
  const ingredients = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  return {
    title: parsed.title || '',
    servings: Number(parsed.servings) || 2,
    ingredients: ingredients
      .filter((i) => i && i.name)
      .map((i) => ({
        name: String(i.name).slice(0, 40),
        qty: i.qty === '' || i.qty === null || i.qty === undefined ? '' : Number(i.qty) || 0,
        unit: String(i.unit || ''),
        group_name: String(i.group_name || ''),
      })),
    steps: steps
      .filter((s) => s && s.body)
      .map((s) => ({
        title: String(s.title || '').slice(0, 60),
        body: String(s.body).slice(0, 800),
        t: s.t === null || s.t === undefined || s.t === '' ? null : Number(s.t) || 0,
        tip: String(s.tip || '').slice(0, 300),
      })),
  };
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const user = getUserByToken(bearerToken(req));

  /* ---------- 認證（公開） ---------- */

  // POST /api/auth/register
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, '電子郵件格式不正確');
    if (password.length < 8) return sendError(res, 400, '密碼至少 8 個字元');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return sendError(res, 409, '這個 Email 已經註冊');
    }
    // 第一位註冊者（或目前沒有任何管理員時）成為管理員
    const hasAdmin = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
    const r = db.prepare('INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
      .run(email, name, hashPassword(password), hasAdmin === 0 ? 1 : 0);
    const uid = Number(r.lastInsertRowid);
    const claimed = claimOrphanData(uid);
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    return sendJSON(res, 200, {
      ok: true,
      token: createSession(uid),
      user: publicUser(me),
      claimed,
    });
  }

  // POST /api/auth/login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return sendError(res, 401, 'Email 或密碼不正確');
    }
    return sendJSON(res, 200, { ok: true, token: createSession(row.id), user: publicUser(row) });
  }

  // POST /api/auth/logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    destroySession(bearerToken(req));
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/auth/me
  if (pathname === '/api/auth/me' && method === 'GET') {
    if (!user) return sendError(res, 401, '未登入');
    return sendJSON(res, 200, { ok: true, user: publicUser(user) });
  }

  /* ---------- 後台管理（需管理員） ---------- */

  if (pathname.startsWith('/api/admin/')) {
    if (!user) return sendError(res, 401, '請先登入');
    if (!requireAdmin(user)) return sendError(res, 403, '需要管理員權限');
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    if (!requireAdmin(user)) return sendError(res, 403, '需要管理員權限');
    const rows = db.prepare(`
      SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM recipes r WHERE r.user_id = u.id) AS recipe_count,
        (SELECT COUNT(*) FROM ingredients i WHERE i.recipe_id IS NULL AND i.user_id = u.id) AS custom_items,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
      FROM users u ORDER BY u.id`).all();
    const stats = {
      users: rows.length,
      recipes: db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n,
      ingredients: db.prepare('SELECT COUNT(*) AS n FROM ingredients').get().n,
      steps: db.prepare('SELECT COUNT(*) AS n FROM steps').get().n,
      shopping: db.prepare('SELECT COUNT(*) AS n FROM ingredients WHERE in_list = 1').get().n,
      admins: rows.filter((r) => r.is_admin).length,
    };
    return sendJSON(res, 200, { ok: true, items: rows.map((r) => ({ ...r, is_admin: !!r.is_admin })), stats });
  }

  // PATCH /api/admin/users/:id → 設為／取消管理員、重設密碼
  const am = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (am && method === 'PATCH') {
    if (!requireAdmin(user)) return sendError(res, 403, '需要管理員權限');
    const uid = Number(am[1]);
    const body = await readBody(req);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!target) return sendError(res, 404, '找不到使用者');

    if (body.reset_password !== undefined) {
      const pw = String(body.reset_password);
      if (pw.length < 8) return sendError(res, 400, '新密碼至少 8 個字元');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), uid);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid); // 強制重新登入
    }
    if (body.is_admin !== undefined) {
      const admins = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
      if (target.is_admin && !body.is_admin && admins <= 1) {
        return sendError(res, 400, '至少要保留一位管理員');
      }
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(body.is_admin ? 1 : 0, uid);
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    return sendJSON(res, 200, { ok: true, user: publicUser(updated) });
  }

  // DELETE /api/admin/users/:id → 刪除帳號與其資料
  if (am && method === 'DELETE') {
    if (!requireAdmin(user)) return sendError(res, 403, '需要管理員權限');
    const uid = Number(am[1]);
    if (uid === user.id) return sendError(res, 400, '不能刪除自己的帳號');
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!target) return sendError(res, 404, '找不到使用者');
    const admins = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
    if (target.is_admin && admins <= 1) return sendError(res, 400, '至少要保留一位管理員');
    const result = deleteUserCascade(uid);
    return sendJSON(res, 200, { ok: true, deleted: result });
  }

  /* ---------- 其餘 API 皆需登入 ---------- */
  const isPublic = pathname.startsWith('/api/video-')
    || pathname.startsWith('/api/thumb/');
  if (!isPublic && !user) return sendError(res, 401, '請先登入');

  // GET /api/recipes
  if (pathname === '/api/recipes' && method === 'GET') {
    return sendJSON(res, 200, {
      ok: true,
      items: listRecipes({
        q: url.searchParams.get('q') || '',
        category: url.searchParams.get('category') || '',
        fav: url.searchParams.get('fav') === '1',
        tag: url.searchParams.get('tag') || '',
        userId: user.id,
      }),
    });
  }

  // GET /api/categories
  if (pathname === '/api/categories' && method === 'GET') {
    const rows = db.prepare(
      "SELECT category, COUNT(*) AS n FROM recipes WHERE category <> '' AND user_id = ? GROUP BY category ORDER BY n DESC")
      .all(user.id);
    return sendJSON(res, 200, { ok: true, items: rows });
  }

  // GET /api/shopping
  if (pathname === '/api/shopping' && method === 'GET') {
    const items = shoppingList(user.id);
    return sendJSON(res, 200, {
      ok: true,
      items,
      total: items.length,
      checked: items.filter((i) => i.checked).length,
    });
  }

  // POST /api/shopping  → 新增自訂項目
  if (pathname === '/api/shopping' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendError(res, 400, '項目名稱必填');
    const r = db.prepare(`
      INSERT INTO ingredients (recipe_id, name, qty, unit, group_name, sort, in_list, checked, user_id)
      VALUES (NULL, ?, ?, ?, '', 0, 1, 0, ?)`)
      .run(name, body.qty ?? null, String(body.unit || ''), user.id);
    return sendJSON(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
  }

  // POST /api/shopping/recipe/:id → 整份食譜加入／移出清單
  let m = pathname.match(/^\/api\/shopping\/recipe\/(\d+)$/);
  if (m && method === 'POST') {
    const body = await readBody(req);
    const inList = body.in_list === false ? 0 : 1;
    const owns = db.prepare('SELECT id FROM recipes WHERE id = ? AND user_id = ?').get(Number(m[1]), user.id);
    if (!owns) return sendError(res, 404, '找不到食譜');
    db.prepare('UPDATE ingredients SET in_list = ?, checked = 0 WHERE recipe_id = ?')
      .run(inList, Number(m[1]));
    return sendJSON(res, 200, { ok: true, in_list: !!inList });
  }

  // PATCH /api/shopping/:id → 勾選／移出清單
  m = pathname.match(/^\/api\/shopping\/(\d+)$/);
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    const body = await readBody(req);
    if (!ownsIngredient(id, user.id)) return sendError(res, 404, '找不到項目');
    const row = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    if (body.checked !== undefined) {
      db.prepare('UPDATE ingredients SET checked = ? WHERE id = ?').run(body.checked ? 1 : 0, id);
    }
    if (body.in_list !== undefined) {
      if (row.recipe_id === null) {
        if (body.in_list === false) db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
      } else {
        db.prepare('UPDATE ingredients SET in_list = ? WHERE id = ?')
          .run(body.in_list ? 1 : 0, id);
        if (!body.in_list) db.prepare('UPDATE ingredients SET checked = 0 WHERE id = ?').run(id);
      }
    }
    return sendJSON(res, 200, { ok: true });
  }

  // DELETE /api/shopping/:id  或  /api/shopping?clear=checked|all
  if (pathname === '/api/shopping' && method === 'DELETE') {
    const clear = url.searchParams.get('clear');
    const ownCustom = 'recipe_id IS NULL AND in_list = 1 AND user_id = ?';
    const ownRecipe = `recipe_id IS NOT NULL AND in_list = 1 AND recipe_id IN
      (SELECT id FROM recipes WHERE user_id = ?)`;
    if (clear === 'checked') {
      // 已購買：食譜食材只退出清單（保留回食譜），自訂項目直接刪除
      db.prepare(`DELETE FROM ingredients WHERE ${ownCustom} AND checked = 1`).run(user.id);
      db.prepare(`UPDATE ingredients SET in_list = 0, checked = 0 WHERE ${ownRecipe} AND checked = 1`).run(user.id);
    } else if (clear === 'all') {
      db.prepare(`DELETE FROM ingredients WHERE ${ownCustom}`).run(user.id);
      db.prepare(`UPDATE ingredients SET in_list = 0, checked = 0 WHERE ${ownRecipe}`).run(user.id);
    }
    return sendJSON(res, 200, { ok: true });
  }
  m = pathname.match(/^\/api\/shopping\/(\d+)$/);
  if (m && method === 'DELETE') {
    const id = Number(m[1]);
    if (!ownsIngredient(id, user.id)) return sendError(res, 404, '找不到項目');
    const row = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
    if (row) {
      if (row.recipe_id === null) db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
      else db.prepare('UPDATE ingredients SET in_list = 0, checked = 0 WHERE id = ?').run(id);
    }
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/video-info?url=
  if (pathname === '/api/video-info' && method === 'GET') {
    try {
      return sendJSON(res, 200, await videoInfo(url.searchParams.get('url') || ''));
    } catch (e) {
      return sendError(res, 422, e.message);
    }
  }

  // GET /api/video-content?url= — 影片說明文字、章節、字幕有無
  if (pathname === '/api/video-content' && method === 'GET') {
    try {
      return sendJSON(res, 200, await videoContent(url.searchParams.get('url') || ''));
    } catch (e) {
      return sendError(res, 422, e.message);
    }
  }

  // GET /api/video-steps?url=&lang=&hint= — 自動取得字幕逐字稿並聚合成步驟（免金鑰）
  if (pathname === '/api/video-steps' && method === 'GET') {
    try {
      const lang = url.searchParams.get('lang') || '';
      const hint = url.searchParams.get('hint') || detectTextLang(url.searchParams.get('hintText') || '');
      const raw = await fetchTranscript(url.searchParams.get('url') || '', { lang: lang || undefined, hint });
      return sendJSON(res, 200, {
        ok: true,
        source: raw.source,
        language: raw.language || '',
        available: raw.available || [],
        segments: raw.segments,
        steps: transcriptToSteps(raw.segments),
      });
    } catch (e) {
      return sendError(res, 422, e.message);
    }
  }

  // POST /api/ai-parse — AI 智慧解析（使用者自備 API Key）
  if (pathname === '/api/ai-parse' && method === 'POST') {
    const body = await readBody(req);
    const apiKey = String(body.apiKey || '').trim();
    if (!apiKey) return sendError(res, 400, '尚未設定 AI API Key，請按「⚙ AI 設定」填入');
    const text = String(body.text || '').trim();
    if (!text) return sendError(res, 400, '沒有可解析的文字');
    try {
      return sendJSON(res, 200, { ok: true, result: await aiParse(body) });
    } catch (e) {
      return sendError(res, 422, e.message);
    }
  }

  // GET /api/thumb/:id — YouTube 縮圖代理（同源，讓 PDF 轉檔不會被跨域污染）
  m = pathname.match(/^\/api\/thumb\/([\w-]{6,20})$/);
  if (m && method === 'GET') {
    try {
      const up = await fetch(`https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!up.ok) throw new Error('not found');
      const buf = Buffer.from(await up.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(buf);
    } catch {
      return sendError(res, 404, '縮圖取得失敗');
    }
  }

  // GET /api/recipes/:id
  m = pathname.match(/^\/api\/recipes\/(\d+)$/);
  if (m && method === 'GET') {
    const recipe = getRecipe(Number(m[1]), user.id);
    if (!recipe) return sendError(res, 404, '找不到食譜');
    return sendJSON(res, 200, { ok: true, recipe });
  }

  // POST /api/recipes
  if (pathname === '/api/recipes' && method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJSON(res, 200, { ok: true, recipe: saveRecipe(null, body, user.id) });
    } catch (e) {
      return sendError(res, 400, e.message);
    }
  }

  // PUT /api/recipes/:id
  m = pathname.match(/^\/api\/recipes\/(\d+)$/);
  if (m && method === 'PUT') {
    try {
      const body = await readBody(req);
      return sendJSON(res, 200, { ok: true, recipe: saveRecipe(Number(m[1]), body, user.id) });
    } catch (e) {
      return sendError(res, 400, e.message);
    }
  }

  // PATCH /api/recipes/:id （僅切換收藏）
  if (m && method === 'PATCH') {
    const body = await readBody(req);
    if (body.favorite !== undefined) {
      db.prepare('UPDATE recipes SET favorite = ? WHERE id = ? AND user_id = ?')
        .run(body.favorite ? 1 : 0, Number(m[1]), user.id);
    }
    return sendJSON(res, 200, { ok: true });
  }

  // DELETE /api/recipes/:id
  if (m && method === 'DELETE') {
    db.prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(Number(m[1]), user.id);
    return sendJSON(res, 200, { ok: true });
  }

  return sendError(res, 404, 'API 不存在');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    return sendError(res, 403, '禁止存取');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback（其餘路徑回 index.html）
      const index = path.join(PUBLIC_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return fs.createReadStream(index).pipe(res);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { Allow: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' });
        return res.end();
      }
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, '方法不允許');
    return serveStatic(req, res, url);
  } catch (e) {
    return sendError(res, 500, e.message || '伺服器錯誤');
  }
});

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address);
    }
  }
  console.log(`食譜 App 已啟動`);
  console.log(`  本機   : http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  區網   : http://${a}:${PORT}   （手機／平板可連）`);
  console.log(`  資料庫 : ${DB_PATH}`);
});
