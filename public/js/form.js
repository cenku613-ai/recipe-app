/**
 * 食譜盒 · form — 新增／編輯食譜
 */
'use strict';

function emptyDraft() {
  return {
    id: null,
    title: '',
    description: '',
    category: '',
    video_url: '',
    video_title: '',
    cover: '',
    servings: 2,
    prep_minutes: '',
    cook_minutes: '',
    difficulty: '',
    tags: '',
    notes: '',
    source: '',
    ingredients: [{ group_name: '', name: '', qty: '', unit: '' }],
    steps: [{ title: '', t: '', body: '', tip: '' }],
  };
}

function toDraft(r) {
  return {
    id: r.id,
    title: r.title || '',
    description: r.description || '',
    category: r.category || '',
    video_url: r.video_url || '',
    video_title: r.video_title || '',
    cover: r.cover || '',
    servings: r.servings || 2,
    prep_minutes: r.prep_minutes || '',
    cook_minutes: r.cook_minutes || '',
    difficulty: r.difficulty || '',
    tags: (r.tags || []).join('，'),
    notes: r.notes || '',
    source: r.source || '',
    ingredients: (r.ingredients || []).map((i) => ({
      id: i.id, group_name: i.group_name || '', name: i.name,
      qty: i.qty ?? '', unit: i.unit || '',
      in_list: i.in_list, checked: i.checked,
    })),
    steps: (r.steps || []).map((s) => ({
      title: s.title || '',
      t: s.t_start === null || s.t_start === undefined ? '' : secsToClock(s.t_start),
      body: s.body || '',
      tip: s.tip || '',
    })),
  };
}

let draft = null;

async function renderForm(id) {
  const view = $('#view');
  view.innerHTML = loadingHtml(id ? '載入食譜…' : '準備新食譜…');

  if (id) {
    try {
      const data = await api(`/api/recipes/${id}`);
      draft = toDraft(data.recipe);
    } catch (e) {
      view.innerHTML = errorHtml(e.message);
      return;
    }
  } else {
    draft = emptyDraft();
  }

  view.innerHTML = formHtml(draft);
  bindForm();
  renderIngRows();
  renderStepRows();
}

function formHtml(d) {
  const editing = !!d.id;
  return `
  <nav class="crumbs"><a href="${editing ? `#/recipe/${d.id}` : '#/'}">← 取消</a></nav>

  <section class="page-head">
    <div>
      <h1>${editing ? '✏️ 編輯食譜' : '＋ 新增食譜'}</h1>
      <p class="muted">貼上教學影片連結，再把畫面中的做法拆成一步步的步驟</p>
    </div>
  </section>

  <form id="recipeForm" class="form" novalidate>
    <section class="panel">
      <div class="panel-head"><h2>🎬 影片連結</h2></div>
      <div class="video-fetch">
        <input class="input" name="video_url" data-field="video_url" type="url" inputmode="url"
               placeholder="https://www.youtube.com/watch?v=…" value="${esc(d.video_url)}">
        <button class="btn btn-primary" data-form="fetch-video" type="button">擷取影片資訊</button>
      </div>
      <div class="video-preview" id="videoPreview">${videoPreviewHtml(d)}</div>
      <div class="extract-row">
        <button class="btn btn-ghost btn-sm" data-form="fetch-content" type="button">
          📄 取得影片說明／章節，自動建立草稿
        </button>
        <span class="muted small">沒有字幕也能用（讀取說明文字與章節）</span>
      </div>
      <div id="contentBox"></div>
      <label class="field">
        <span class="field-label">影片標題（用於記錄）</span>
        <input class="input" name="video_title" data-field="video_title" value="${esc(d.video_title)}">
      </label>
      <label class="field">
        <span class="field-label">影片來源／作者</span>
        <input class="input" name="source" data-field="source" placeholder="頻道名稱" value="${esc(d.source)}">
      </label>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>📖 基本資料</h2></div>

      <label class="field field-required">
        <span class="field-label">食譜名稱 *</span>
        <input class="input" name="title" data-field="title" required maxlength="80"
               placeholder="例：番茄炒蛋" value="${esc(d.title)}">
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field-label">分類</span>
          <input class="input" name="category" data-field="category" list="catList"
                 placeholder="例：家常菜" value="${esc(d.category)}">
          <datalist id="catList">${categoriesForDatalist()}</datalist>
        </label>
        <label class="field">
          <span class="field-label">難度</span>
          <select class="input" name="difficulty" data-field="difficulty">
            ${['', '簡單', '中等', '進階'].map((v) =>
              `<option value="${v}" ${d.difficulty === v ? 'selected' : ''}>${v || '未設定'}</option>`).join('')}
          </select>
        </label>
      </div>

      <label class="field">
        <span class="field-label">簡介</span>
        <textarea class="input" name="description" data-field="description" rows="2"
                  placeholder="這道菜的特色、口感…">${esc(d.description)}</textarea>
      </label>

      <div class="field-row field-row-4">
        <label class="field">
          <span class="field-label">份量（人）</span>
          <input class="input" name="servings" data-field="servings" type="number" min="1" max="99"
                 value="${esc(d.servings)}">
        </label>
        <label class="field">
          <span class="field-label">準備（分鐘）</span>
          <input class="input" name="prep_minutes" data-field="prep_minutes" type="number" min="0"
                 value="${esc(d.prep_minutes)}">
        </label>
        <label class="field">
          <span class="field-label">烹調（分鐘）</span>
          <input class="input" name="cook_minutes" data-field="cook_minutes" type="number" min="0"
                 value="${esc(d.cook_minutes)}">
        </label>
        <label class="field">
          <span class="field-label">標籤（逗號分隔）</span>
          <input class="input" name="tags" data-field="tags" placeholder="快手菜，下飯" value="${esc(d.tags)}">
        </label>
      </div>

      <div class="field">
        <span class="field-label">封面圖片</span>
        <div class="cover-row">
          <div class="cover-preview" id="coverPreview">${coverPreviewHtml(d)}</div>
          <input class="input" name="cover" data-field="cover" placeholder="圖片網址，或按「上傳圖片」"
                 value="${esc(d.cover.startsWith('data:') ? '' : d.cover)}">
          <label class="btn btn-ghost file-btn">
            上傳圖片<input type="file" accept="image/*" id="coverFile" hidden>
          </label>
          <button class="btn btn-ghost" data-form="clear-cover" type="button">清除</button>
        </div>
      </div>

      <label class="field">
        <span class="field-label">備註</span>
        <textarea class="input" name="notes" data-field="notes" rows="2"
                  placeholder="替代食材、保存方式…">${esc(d.notes)}</textarea>
      </label>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>🥕 食材</h2>
        <button class="btn btn-ghost btn-sm" data-form="add-ing" type="button">＋ 加一行食材</button>
      </div>
      <div class="ing-head-row" aria-hidden="true">
        <span>分組</span><span>食材名稱 *</span><span>數量</span><span>單位</span><span></span>
      </div>
      <div id="ingRows"></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>👩‍🍳 步驟</h2>
        <div class="head-actions">
          <span class="muted small">時間欄填入影片時間碼，例如 01:30</span>
          <button class="btn btn-ghost btn-sm" data-form="add-step" type="button">＋ 加一個步驟</button>
        </div>
      </div>
      <div id="stepRows"></div>
    </section>

    <div class="form-foot">
      <a class="btn btn-ghost" href="${d.id ? `#/recipe/${d.id}` : '#/'}">取消</a>
      <button class="btn btn-primary" type="submit">${d.id ? '儲存變更' : '建立食譜'}</button>
    </div>
  </form>`;
}

function videoPreviewHtml(d) {
  const vid = videoIdOf(d.video_url);
  if (!vid) return `<p class="muted small">支援 YouTube 連結（watch、youtu.be、shorts、embed）。</p>`;
  return `<div class="vp-inner">
    <img src="/api/thumb/${vid}" alt="" onerror="this.style.display='none'">
    <div><b>${esc(d.video_title || '已辨識影片')}</b>
      <p class="muted small">ID：${esc(vid)}${d.source ? ` · ${esc(d.source)}` : ''}</p></div>
  </div>`;
}

function coverPreviewHtml(d) {
  if (!d.cover) return '<span class="muted small">無封面（會用影片縮圖）</span>';
  return `<img src="${esc(d.cover)}" alt="" onerror="this.parentNode.innerHTML='<span class=&quot;muted small&quot;>圖片無法載入</span>'">`;
}

/** 分類下拉選項（快取，非同步回填） */
let categoryCache = [];
function categoriesForDatalist() {
  return categoryCache.map((c) => `<option value="${esc(c)}">`).join('');
}

function renderIngRows() {
  const box = $('#ingRows');
  if (!box) return;
  box.innerHTML = draft.ingredients.map((ing, i) => `
    <div class="ing-row" data-idx="${i}">
      <input class="input" data-ing="group_name" placeholder="主料／醃料…" value="${esc(ing.group_name)}" aria-label="分組">
      <input class="input" data-ing="name" placeholder="食材名稱" value="${esc(ing.name)}" aria-label="食材名稱">
      <input class="input" data-ing="qty" placeholder="數量" inputmode="decimal" value="${esc(ing.qty)}" aria-label="數量">
      <input class="input" data-ing="unit" placeholder="個／克／湯匙" value="${esc(ing.unit)}" aria-label="單位">
      <div class="row-tools">
        <button class="icon-btn" data-form="ing-up" data-idx="${i}" type="button" aria-label="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-form="ing-down" data-idx="${i}" type="button" aria-label="下移" ${i === draft.ingredients.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-btn" data-form="ing-del" data-idx="${i}" type="button" aria-label="刪除">×</button>
      </div>
    </div>`).join('') || '<p class="muted">未加入食材</p>';
}

function renderStepRows() {
  const box = $('#stepRows');
  if (!box) return;
  box.innerHTML = draft.steps.map((st, i) => `
    <div class="step-row" data-idx="${i}">
      <div class="step-row-head">
        <span class="step-row-no">${i + 1}</span>
        <input class="input" data-step="title" placeholder="步驟標題（可留空）" value="${esc(st.title)}" aria-label="步驟標題">
        <input class="input input-sm" data-step="t" placeholder="01:30" value="${esc(st.t)}" aria-label="影片時間碼">
        <div class="row-tools">
          <button class="icon-btn" data-form="step-up" data-idx="${i}" type="button" aria-label="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-form="step-down" data-idx="${i}" type="button" aria-label="下移" ${i === draft.steps.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn" data-form="step-del" data-idx="${i}" type="button" aria-label="刪除">×</button>
        </div>
      </div>
      <textarea class="input" data-step="body" rows="2" placeholder="詳細描述這個步驟要做什麼…">${esc(st.body)}</textarea>
      <input class="input" data-step="tip" placeholder="小提示（可留空）" value="${esc(st.tip)}" aria-label="小提示">
    </div>`) || '<p class="muted">未加入步驟</p>';
}

/* ================================================================== */
/* 文字解析：說明文字／文字稿 → 步驟、食材（沒有字幕也適用）              */
/* ================================================================== */

const ING_UNITS = '公克|克|公斤|千克|毫升|公升|CC|cc|ml|ML|mL|kg|KG|g|G|oz|條|根|隻|個|片|瓣|粒|碗|杯|湯匙|茶匙|大匙|小匙|匙|斤|兩|包|把|串|尾|塊|段|公分|公釐|cm|mm|圈|滴|份|盒|罐|顆|枝|支|束';

/** 不是食材的詞（說明欄常見標籤與廣告詞） */
const ING_STOP = /^(recipe|recipes|equipment|ingredients?|materials?|methods?|directions?|steps?|notes?|for serving|instructions?|材料|食材|調味料?|步驟|做法|器材|裝備|連結|主頁|訂閱|歡迎|感謝|聯絡|簡介|關於)$/i;

function timeStrToSecs(str) {
  const parts = String(str).split(/[:：]/).map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/** A：行首是時間碼（章節／字幕稿常見格式） */
function parseTimeCodedLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^[[\[(（]?\s*((?:\d{1,2}[:：]){1,2}\d{1,2})\s*[\]\)）]?\s*[\s\-–—~至>|.、,，:：]*\s*(.*)$/);
    if (!m) continue;
    const sec = timeStrToSecs(m[1]);
    if (sec === null) continue;
    let body = (m[2] || '').trim();
    // 去掉「01:20 - xxx」的第二個時間碼與前置符號
    body = body.replace(/^[[\[(（]?\s*(?:\d{1,2}[:：]){1,2}\d{1,2}\s*[\]\)）]?\s*[\s\-–—~至>|.、,，:：]*/, '').trim();
    body = body.replace(/^[\s\-–—~>|.、,，:：]+/, '').trim();
    out.push({ title: '', body, t: sec, tip: '' });
  }
  return out;
}

/** B：行首是編號「1. / 步驟1：」 */
function parseNumberedLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:步驟\s*)?(\d{1,2})[\.、\)）:：]\s*(.+)$/);
    if (!m) continue;
    let body = m[2].trim();
    let sec = null;
    const t = body.match(/^[[\[(（]?\s*((?:\d{1,2}[:：]){1,2}\d{1,2})\s*[\]\)）]?\s*[\s\-–—~>|.、,，:：]*/);
    if (t) { sec = timeStrToSecs(t[1]); body = body.slice(t[0].length).trim(); }
    if (!body) continue;
    out.push({ title: '', body, t: sec, tip: '' });
  }
  return out;
}

/** C：按段落拆，過濾「不是步驟」的段落（連結、器材、標題、食材清單…） */
const STEP_SKIP_RE = /https?:\/\/|www\.|訂閱|按讚|分享|追蹤|主頁|連結|器材|裝備|音樂|歡迎|聯絡|感謝|facebook|instagram|youtube\.com|tiktok|(?:^|\s)(?:subscribe|follow|credits?|equipment|notes?)(?:\s|$)/i;
const STEP_VERB_RE = /洗|切|炒|煎|煮|蒸|烤|拌|攪|倒|加|放|預熱|沖|泡|撈|燙|醃|擠|撒|蓋|轉|熄|盛|裝|剝|削|剁|磨|壓|搾|打散|打勻|上碟|擺盤|備料|調味|(?:^|\s)(?:mix|stir|fry|bake|boil|add|cut|heat|cook|place|pour|serve|remove|wash|chop|slice|season|combine|cover|drain|beat|whisk|preheat|transfer)(?:\s|$)/i;

function parseParagraphSteps(text, opts = {}) {
  const paras = String(text || '').split(/\n\s*\n/);
  const norm = (s) => String(s).replace(/蕃/g, '番').replace(/[\s/#＃·・、,，。．.!:：;；()（）【】「」『』]/g, '').toLowerCase();
  const titleNorm = opts.title ? norm(opts.title) : '';
  const out = [];
  for (const p of paras) {
    const flat = p.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (flat.length < 4) continue;
    if (STEP_SKIP_RE.test(flat)) continue;                                  // 連結／器材／社群段
    if (/(?:^|\s)[#＃]/.test(flat)) continue;                               // hashtag 段
    if ((flat.match(/\//g) || []).length >= 3) continue;                    // 標題樣（多個 / 分隔）
    const fn = norm(flat);
    if (fn.length >= 10 && titleNorm && titleNorm.includes(fn)) continue;   // 與影片標題完全相同（標題行）
    if (fn.length >= 10 && titleNorm) {                                     // 大部分字詞都出現在標題 → 標題行
      const words = flat.split(/[\s,，。．.、;；:：()（）\/＃#]+/).filter((w) => w.length >= 2);
      if (words.length >= 2) {
        const hits = words.filter((w) => titleNorm.includes(norm(w))).length;
        if (hits / words.length >= 0.8) continue;
      }
    }
    const lines = p.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const qtyCount = lines.filter((l) => /\d/.test(l) && !/\d{1,2}[:：]\d{2}/.test(l)).length;
    if (qtyCount >= 2) continue;                                            // 食材清單交給食材解析
    if (!STEP_VERB_RE.test(flat)) continue;                                 // 沒有動作字眼 → 不像步驟
    out.push({ title: '', body: flat.slice(0, 500), t: null, tip: '' });
    if (out.length >= 30) break;
  }
  return out;
}

/** 一份文字 → 步驟草稿（優先時間碼 → 編號 → 段落） */
function parseStepsFromText(text, opts = {}) {
  const tc = parseTimeCodedLines(text).filter((s) => s.body || s.t !== null);
  const num = parseNumberedLines(text);
  if (tc.filter((s) => s.body).length >= 2) return tc;
  if (num.length >= 2) return num;
  if (tc.length) return tc;
  return parseParagraphSteps(text, opts);
}

/** 字幕式文字稿：很多短行、少標點 → 逐行／逐句變成步驟 */
function parseCaptionLikeSteps(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(https?:\/\/|www\.|[#＃])/i.test(l));
  if (lines.length < 4) return [];
  const avg = lines.reduce((a, l) => a + l.length, 0) / lines.length;
  if (avg > 60) return [];                                                   // 太長的行不是字幕
  const hasPunct = lines.some((l) => /[。！？!?…]/.test(l));
  if (!hasPunct) return lines.slice(0, 40).map((l) => ({ title: '', body: l, t: null, tip: '' }));
  const steps = [];
  let buf = '';
  for (const l of lines) {
    // 英文字幕行之間補空格，避免黏字
    buf += buf && /[\w)$」』]$/.test(buf) && /^[\w("「『]/.test(l) ? ' ' + l : l;
    if (/[。！？!?…]$/.test(l) || buf.length >= 100) {
      steps.push({ title: '', body: buf, t: null, tip: '' });
      buf = '';
    }
  }
  if (buf.trim()) steps.push({ title: '', body: buf, t: null, tip: '' });
  return steps.slice(0, 40);
}

/** 文字稿專用：時間碼 → 編號 → 字幕行 → 段落 */
function parseTranscriptSteps(text, opts = {}) {
  const tc = parseTimeCodedLines(text).filter((s) => s.body || s.t !== null);
  const num = parseNumberedLines(text);
  if (tc.filter((s) => s.body).length >= 2) return tc;
  if (num.length >= 2) return num;
  if (tc.length) return tc;
  const cap = parseCaptionLikeSteps(text);
  if (cap.length) return cap;
  return parseParagraphSteps(text, opts);
}

/** 食材名稱正規化：中英混雜時取中文片段，保留 XO醬／BBQ醬 這類縮寫 */
function normalizeIngredientName(name) {
  let s = String(name)
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：\-–—.、,，「【（(]+|[\s:：\-–—.、,，」】）)]+$/g, '')
    .trim();
  if (!s) return '';
  const cjkRuns = s.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g);
  // 只有在混了「真正的英文單字」（含 3 字母以上小寫）時才取中文
  // 「XO醬」「BBQ醬」是縮寫、沒小寫 → 整個保留
  const hasRealEnglish = /[a-z]{3,}/.test(s);
  if (cjkRuns && cjkRuns.length && hasRealEnglish) {
    return cjkRuns.join(' ').trim();
  }
  return s;
}

/** 整理食材（名稱正規化、去品牌、去句子） */
function finishIngredient(name, qty, unit) {
  name = normalizeIngredientName(name);
  if (!name || name.length > 24) return null;
  if (ING_STOP.test(name)) return null;
  if (/^[A-Za-z0-9 .\-]+$/.test(name) && /[A-Z]{3,}/.test(name)) return null; // 全半形品牌／型號（NOKIA、SONY…）
  if (name.length > 8 && /[的了是要和與在把將就]/.test(name)) return null;      // 疑似句子
  return {
    name,
    qty: qty === '' || qty === null || qty === undefined ? '' : Number(qty),
    unit: unit || '',
    group_name: '',
  };
}

/** 解析一行食材：500g 蠔仔 / 蠔仔 2 個 / 魚露（無數量） */
function parseIngredientLine(raw) {
  let line = String(raw || '').trim();
  if (!line || line.length > 45) return null;
  if (/https?:|www\.|^#|^＃|訂閱|按讚|留言|分享|主頁|連結|歡迎|感謝/i.test(line)) return null;
  if (/\d{1,2}[:：]\d{2}/.test(line)) return null;                          // 時間碼行
  line = line.replace(/^[-•*．○○]\s*/, '').replace(/^[【\[（(「]+/, '').replace(/[】\])）」]+\s*$/, '').trim();
  if (!line) return null;

  let m;
  // A：名稱 數量 單位（尾隨「適量／少許」可省略單位）
  m = line.match(new RegExp(`^(.+?)[\\s:：]+(\\d+(?:\\.\\d+)?)(?:\\s*[-~至]\\s*\\d+(?:\\.\\d+)?)?\\s*(${ING_UNITS})?\\s*(適量|少許)?$`));
  if (m) return finishIngredient(m[1], m[2], m[3] || m[4] || '');
  // B：數量 單位 名稱（500g 蠔仔/baby oyster）
  m = line.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${ING_UNITS})?\\s*[的]?\\s*(.+)$`));
  if (m && m[3] && !/[。！？，,]/.test(m[3])) return finishIngredient(m[3], m[1], m[2] || '');
  // C：名稱 適量／少許
  m = line.match(/^(.{1,20}?)[\s:：]+(適量|少許)$/);
  if (m) return finishIngredient(m[1], '', m[2]);
  // D：沒有數量的一行（white pepper power 白胡椒粉）
  if (!/\d/.test(line) && line.length <= 30 && !/[。！？；;:：]/.test(line)) {
    return finishIngredient(line, '', '');
  }
  return null;
}

/** 從敘述句子中撈出「數量 單位 食材」（影片旁白常是連續句子） */
const NARRATION_RE = /((?:\d+(?:[./]\d+)?|a|an|one|two|three|four|five|six|half|¼|½|⅓|⅔)\b|少許|適量)\s*(?:an?\s+)?(cups?|tablespoons?|tbsp\.?|teaspoons?|tsp\.?|sticks?|box(?:es)?|pounds?|lbs?|oz\.?|ounces?|grams?|g|kg|ml|litres?|cloves?|slices?|pieces?|cans?|pinch(?:es)?|公克|克|公斤|毫升|杯|湯匙|茶匙|碗|盒|隻|個|片|瓣|條|磅|兩|斤|匙)\s*(?:of\s+)?([A-Za-z\u00C0-\u024F\u4e00-\u9fff][A-Za-z\u00C0-\u024F\u4e00-\u9fff\-]*(?:(?!\s+(?:and|then|until|into|with|to|the|of|or|plus|half|a|an|is|are|was|be|add|put|mix|stir|cook|bake|season|serve)\b)\s+[A-Za-z\u00C0-\u024F\u4e00-\u9fff\-]+){0,4})/gi;

function parseIngredientsFromNarration(text) {
  const out = [];
  const seen = new Set();
  const NUMWORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, '¼': 0.25, '½': 0.5, '⅓': 0.33, '⅔': 0.67, 少許: '', 適量: '' };
  NARRATION_RE.lastIndex = 0;
  let m;
  while ((m = NARRATION_RE.exec(String(text || ''))) !== null) {
    const rawNum = m[1].toLowerCase();
    const qty = Object.prototype.hasOwnProperty.call(NUMWORD, rawNum) ? NUMWORD[rawNum] : Number(m[1]) || '';
    let name = m[3].split(/\s+(?:and|then|until|into|with|to|the|a|an)\b/i)[0].trim();
    name = normalizeIngredientName(name);
    if (!name || name.length > 24) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, qty, unit: String(m[2] || '').replace(/\.$/, ''), group_name: '' });
  }
  return out;
}

/** 一份文字 → 食材草稿（先辨識「食材段落」，避開器材／連結段） */
function parseIngredientsFromText(text) {
  const paras = String(text || '').split(/\n\s*\n/);
  const out = [];
  const seen = new Set();
  const add = (item) => {
    if (!item) return;
    const k = item.name + '|' + item.unit;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(item);
  };

  const NEG_LABEL = /equipment|器材|裝備|連結|主頁|social|聯絡|關於|credits?|音樂|camera|software|subscribe|訂閱|頻道|channel|follow|規格|設備/i;
  const POS_LABEL = /(?:^|\s)(?:recipe|materials?|ingredients?)(?:\s|$)|材料|食材|用料|調味料?/i;

  for (const p of paras) {
    const lines = p.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (NEG_LABEL.test(lines[0])) continue;                                 // 器材／連結段整段跳過
    const qtyCount = lines.filter((l) => /\d/.test(l)).length;
    const isRecipeBlock = POS_LABEL.test(lines[0]) || qtyCount >= 2;
    if (!isRecipeBlock) continue;
    for (const l of lines) add(parseIngredientLine(l));
  }

  if (!out.length) {                                                        // 退而求其次：逐行（不含無數量行，避免垃圾）
    for (const raw of String(text || '').split(/\r?\n/)) {
      const item = parseIngredientLine(raw);
      if (item && (item.qty !== '' || item.unit)) add(item);
    }
  }
  if (out.length < 2) {                                                     // 仍是連續敘述 → 從句子中撈數量＋食材
    for (const item of parseIngredientsFromNarration(text)) add(item);
  }
  return out;
}

/** 把解析結果併入草稿（原本只有一列空白時會取代；重複內容自動略過） */
function mergeParsedSteps(newOnes) {
  if (!newOnes.length) return 0;
  const have = new Set(draft.steps.map((s) => s.body.trim()));
  const add = newOnes.filter((s) => !have.has(s.body.trim()));
  if (!add.length) return 0;
  const blankOnly = draft.steps.length === 1 && !draft.steps[0].body.trim() && !draft.steps[0].title.trim();
  draft.steps = blankOnly ? add : draft.steps.concat(add);
  renderStepRows();
  return add.length;
}

function mergeParsedIngs(newOnes) {
  if (!newOnes.length) return 0;
  const existing = new Set(draft.ingredients.map((i) => i.name.trim()));
  const add = newOnes.filter((i) => !existing.has(i.name));
  if (!add.length) return 0;
  const blankOnly = draft.ingredients.length === 1 && !draft.ingredients[0].name.trim();
  draft.ingredients = blankOnly ? add : draft.ingredients.concat(add);
  renderIngRows();
  return add.length;
}

/** 取得字幕逐字稿 → 填入文字稿框並更新面板（lang 可指定語系） */
async function loadTranscript({ url, lang, hintText }) {
  const qs = new URLSearchParams({ url });
  if (lang) qs.set('lang', lang);
  if (hintText) qs.set('hintText', hintText);
  const tr = await api(`/api/video-steps?${qs}`);
  const lines = (tr.segments || []).map((s) => `${secsToClock(s.t)} ${s.text}`);
  renderContentBox({
    description: $('#videoDescText')?.value || '',
    captionLangs: [],
    hasCaptions: true,
    chapters: [],
    url,
    transcriptCount: tr.segments.length,
    transcriptLang: tr.language || '',
    available: tr.available || [],
  });
  const ta = $('#transcriptText');
  if (ta) { ta.value = lines.join('\n'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
  return tr;
}

/** 把字幕片段轉成步驟草稿（含時間碼） */
function transcriptStepsToDraft(tr) {
  return (tr.steps || []).map((s) => ({
    title: '',
    body: s.body,
    t: s.t === null || s.t === undefined ? '' : secsToClock(s.t),
    tip: '',
  }));
}

/** 內容擷取結果面板 */
function renderContentBox(c) {
  const box = $('#contentBox');
  if (!box) return;
  box.innerHTML = `
    <div class="extract-box">
      <div class="extract-note">
        ${c.transcriptCount
          ? `<b>✅ 已自動抓取字幕逐字稿（${c.transcriptCount} 段，${esc(c.transcriptLang || '未知語言')}）</b>，並存入下方文字稿框。<br>步驟已自動產生（含時間碼）；要更精準可按「🤖 AI 看影片」整理。`
          : c.hasCaptions
            ? `<b>此影片有字幕（${esc(c.captionLangs.join('、'))}）</b>，但自動抓取失敗。<br>可用「📚 字幕稿書籤小工具」一鍵複製，或手動到觀看頁按「⋯ 更多／顯示字幕稿」複製。<br>
               <a href="${esc(c.url)}" target="_blank" rel="noopener">🔗 開啟影片 ↗</a>`
            : `<b>此影片沒有字幕</b> —— 請改用說明文字／章節，或按「🎬 AI 看影片」由 AI 觀看影片取得步驟。`}
      </div>
      ${Array.isArray(c.available) && c.available.length ? `
        <div class="lang-row">
          <label class="muted small" for="captionLang">字幕語言：</label>
          <select class="input input-sm lang-select" id="captionLang" data-form="lang-change">
            ${c.available.map((a) => `<option value="${esc(a.code)}" ${a.code === (c.transcriptLang || '') ? 'selected' : ''}>${esc(a.code)}${a.auto ? '（自動產生）' : ''}</option>`).join('')}
          </select>
          <span class="muted small">選錯語言會出現怪字，換一個即可</span>
        </div>` : ''}
      ${c.description ? `
        <div class="extract-head"><b>🎬 影片說明文字</b><span class="muted small">可先編輯再解析</span></div>
        <textarea id="videoDescText" class="input" rows="8">${esc(c.description)}</textarea>
        <div class="extract-actions">
          <button class="btn btn-primary btn-sm" data-form="desc-to-steps" type="button">⏱ 用說明／章節建立步驟</button>
          <button class="btn btn-ghost btn-sm" data-form="desc-to-ings" type="button">🥕 解析說明中的食材</button>
        </div>`
      : '<p class="muted small">此影片沒有說明文字，請用下方文字稿或手動輸入。</p>'}
      ${c.chapters && c.chapters.length ? `
        <div class="extract-head"><b>📑 影片章節</b></div>
        <div class="chips">${c.chapters.map((ch) => `<span class="chip">${secsToClock(ch.t)}　${esc(ch.title)}</span>`).join('')}</div>` : ''}
      <div class="extract-head"><b>📝 文字稿（選填）</b><span class="muted small">有時間碼更準，例如：01:30 先把番茄切塊</span></div>
      <div class="extract-actions">
        <button class="btn btn-ghost btn-sm" data-form="fetch-steps" type="button">📝 取得字幕步驟（免金鑰）</button>
        <button class="btn btn-warn btn-sm" data-form="bookmarklet-help" type="button">📚 字幕稿書籤小工具</button>
        <button class="btn btn-ghost btn-sm" data-form="paste-transcript" type="button">📋 貼上字幕稿</button>
      </div>
      <textarea id="transcriptText" class="input" rows="5"
        placeholder="按上方「📚 字幕稿書籤」→ 在 YouTube 影片頁點一下 → 回這裡按「📋 貼上字幕稿」。&#10;或直接貼任何文字：&#10;01:30 先把番茄切塊&#10;1. 番茄切塊&#10;2. 蛋液炒至半熟"></textarea>
      <div class="extract-actions">
        <button class="btn btn-primary btn-sm" data-form="transcript-to-steps" type="button">📝 解析文字稿成步驟</button>
        <button class="btn btn-ghost btn-sm" data-form="transcript-to-ings" type="button">🥕 解析文字稿成食材</button>
      </div>

      <div class="extract-head"><b>🤖 AI 智慧解析</b>
        <span class="muted small">讓 AI 讀懂內容、整理成乾淨食譜（
          ${aiSettings().key ? '已設定：' + esc(aiSettings().provider) : '<b>尚未設定 API Key</b>'}　
          <a href="#" data-form="open-settings">⚙ 設定</a>）</span></div>
      <div class="extract-actions">
        ${draft.video_url ? `<button class="btn btn-primary" data-form="ai-video" type="button">🎬 AI 看影片（聽旁白＋看畫面）</button>` : ''}
        <button class="btn ${draft.video_url ? 'btn-ghost' : 'btn-primary'}" data-form="ai-text" type="button">🤖 AI 解析說明／文字稿</button>
      </div>
      <p class="muted small">「AI 看影片」把 YouTube 連結交給 Gemini 直接觀看，<b>不需要字幕檔</b>就能取得片中的步驟與食材。</p>
    </div>`;
}

/** 把 AI 回傳的食譜併入草稿：AI 結果較可靠，直接取代；時間碼轉成 mm:ss */
function applyAiResult(res) {
  if (res.title && !draft.title.trim()) {
    draft.title = res.title;
    const ti = $('#recipeForm')?.elements.namedItem('title');
    if (ti) ti.value = res.title;
  }
  if (res.servings) {
    draft.servings = res.servings;
    const sv = $('#recipeForm')?.elements.namedItem('servings');
    if (sv) sv.value = res.servings;
  }

  const ings = (res.ingredients || [])
    .filter((i) => i && i.name)
    .map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, group_name: i.group_name || '' }));
  let ni = 0;
  if (ings.length) {
    draft.ingredients = ings;   // AI 結果取代草稿
    renderIngRows();
    ni = ings.length;
  } else {
    ni = mergeParsedIngs([]);
  }

  const steps = (res.steps || [])
    .filter((s) => s && s.body)
    .map((s) => ({
      title: s.title || '',
      body: s.body || '',
      t: s.t === null || s.t === undefined ? '' : secsToClock(s.t),
      tip: s.tip || '',
    }));
  let ns = 0;
  if (steps.length) {
    draft.steps = steps;        // AI 結果取代草稿
    renderStepRows();
    ns = steps.length;
  }

  return { ni, ns };
}

/* ---------- 繫結 ---------- */
function bindForm() {
  const form = $('#recipeForm');
  if (!form) return;
  // 注意：form.title 會取到表單的 title 屬性；一律用 elements 取輸入欄（瀏覽器與測試環境都穩定）
  const fld = (n) => form.elements.namedItem(n);
  const titleInput = fld('title');

  // 主欄位
  form.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (f) {
      draft[f] = e.target.value;
      if (f === 'video_url') $('#videoPreview').innerHTML = videoPreviewHtml(draft);
      if (f === 'cover') $('#coverPreview').innerHTML = coverPreviewHtml(draft);
      return;
    }
    const ingField = e.target.dataset.ing;
    if (ingField) {
      const idx = Number(e.target.closest('.ing-row').dataset.idx);
      draft.ingredients[idx][ingField] = e.target.value;
      return;
    }
    const stepField = e.target.dataset.step;
    if (stepField) {
      const idx = Number(e.target.closest('.step-row').dataset.idx);
      draft.steps[idx][stepField] = e.target.value;
    }
  });
  form.addEventListener('change', async (e) => {
    const f = e.target.dataset.field;
    if (f) draft[f] = e.target.value;

    // 字幕語系切換（選錯語言會出現怪字）
    if (e.target.id === 'captionLang') {
      const url = (draft.video_url || '').trim();
      if (!url) return;
      const lang = e.target.value;
      try {
        toast('切換字幕語言…');
        const tr = await loadTranscript({ url, lang });
        const steps = transcriptStepsToDraft(tr);
        if (steps.length) {
          draft.steps = steps;   // 切換語言 → 取代步驟（避免重複）
          renderStepRows();
        }
        toast(`已改用 ${tr.language || lang} 字幕（${tr.segments.length} 段，${steps.length} 步）`);
        document.getElementById('stepRows')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (err) {
        toast('切換語言失敗：' + err.message, 'err');
      }
    }
  });

  // 按鈕
  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-form]');
    if (!btn) return;
    const act = btn.dataset.form;
    const idx = Number(btn.dataset.idx);

    if (act === 'add-ing') { draft.ingredients.push({ group_name: '', name: '', qty: '', unit: '' }); renderIngRows(); focusRow('#ingRows .ing-row:last-child [data-ing="name"]'); }
    if (act === 'ing-del') { draft.ingredients.splice(idx, 1); renderIngRows(); }
    if (act === 'ing-up' && idx > 0) { swap(draft.ingredients, idx, idx - 1); renderIngRows(); }
    if (act === 'ing-down' && idx < draft.ingredients.length - 1) { swap(draft.ingredients, idx, idx + 1); renderIngRows(); }

    if (act === 'add-step') { draft.steps.push({ title: '', t: '', body: '', tip: '' }); renderStepRows(); focusRow('#stepRows .step-row:last-child [data-step="body"]'); }
    if (act === 'step-del') { draft.steps.splice(idx, 1); renderStepRows(); }
    if (act === 'step-up' && idx > 0) { swap(draft.steps, idx, idx - 1); renderStepRows(); }
    if (act === 'step-down' && idx < draft.steps.length - 1) { swap(draft.steps, idx, idx + 1); renderStepRows(); }

    if (act === 'clear-cover') { draft.cover = ''; fld('cover').value = ''; $('#coverPreview').innerHTML = coverPreviewHtml(draft); }

    if (act === 'fetch-video') {
      const url = draft.video_url.trim();
      if (!url) { toast('請先貼上影片連結', 'err'); return; }
      btn.disabled = true; btn.textContent = '擷取中…';
      try {
        const info = await api(`/api/video-info?url=${encodeURIComponent(url)}`);
        draft.video_url = info.url;
        draft.video_title = info.title || draft.video_title;
        if (!draft.source && info.author) draft.source = info.author;
        if (!draft.title) draft.title = info.title || '';
        if (!draft.cover) draft.cover = ''; // 封面留空 → 自動用影片縮圖
        fld('video_url').value = info.url;
        fld('video_title').value = draft.video_title;
        fld('source').value = draft.source;
        if (!titleInput.value) { titleInput.value = draft.title; }
        $('#videoPreview').innerHTML = videoPreviewHtml(draft);

        // 一併取得說明文字＋字幕逐字稿，自動建立草稿（免金鑰）
        let extra = '';
        let ni = 0;
        let ns = 0;
        let descSteps = [];
        let content = null;
        try {
          content = await api(`/api/video-content?url=${encodeURIComponent(info.url)}`);
          renderContentBox(content);
          ni = mergeParsedIngs(parseIngredientsFromText(content.description || ''));
          descSteps = parseStepsFromText(content.description || '', { title: info.title });
        } catch { /* 說明抓不到不影響 */ }

        // 自動取得字幕逐字稿（語系依影片說明／標題自動挑選，避免抓到錯誤語言）
        const hintText = detectTextLang(`${info.title || ''}\n${content?.description || ''}`);
        try {
          const tr = await loadTranscript({ url: info.url, hintText });
          const toDraft = (s) => ({
            title: s.title || '',
            body: s.body || '',
            t: s.t === null || s.t === undefined ? '' : (typeof s.t === 'number' ? secsToClock(s.t) : s.t),
            tip: s.tip || '',
          });
          const fromTranscript = transcriptStepsToDraft(tr);
          // 說明有步驟就用說明的（通常較乾淨）；否則用字幕的
          const use = descSteps.length ? descSteps : fromTranscript;
          ns = mergeParsedSteps(use.map(toDraft));
          // 說明欄沒有食材 → 從字幕敘述中撈（例：「melt 2 tablespoons butter」）
          if (ni < 2) {
            const trText = (tr.segments || []).map((s) => s.text).join(' ');
            const extraIngs = parseIngredientsFromNarration(trText);
            ni += mergeParsedIngs(extraIngs);
          }
          const langTag = tr.language ? `，${tr.language}` : '';
          if (fromTranscript.length && descSteps.length) {
            extra = `，字幕 ${tr.segments.length} 段${langTag}已存入文字稿`;
          } else if (fromTranscript.length) {
            extra = `，已從字幕產生 ${ns} 個步驟${langTag}`;
          }
        } catch (err) {
          extra = `（字幕取得失敗：${err.message}）`;
        }

        const parts = [];
        if (ni) parts.push(`食材 ${ni} 種`);
        if (ns) parts.push(`步驟 ${ns} 個`);
        if (parts.length) extra = `，已自動建立草稿：${parts.join('、')}` + extra;
        else if (!extra && !(content?.description || '').trim()) extra = '（此影片沒有說明文字，可貼文字稿）';
        else if (!extra) extra = '（說明中沒有步驟，可用文字稿或 AI）';
        toast('已擷取影片資訊' + extra);
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false; btn.textContent = '擷取影片資訊';
      }
    }

    if (act === 'fetch-content') {
      const url = (draft.video_url || '').trim();
      if (!url) { toast('請先貼上影片連結', 'err'); return; }
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = '讀取中…';
      try {
        const c = await api('/api/video-content?url=' + encodeURIComponent(url));
        renderContentBox(c);
        if (c.description) toast('已取得影片說明文字');
        else toast('此影片沒有說明文字，可貼文字稿', 'err');
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false; btn.textContent = label;
      }
    }

    if (act === 'desc-to-steps') {
      const steps = parseStepsFromText($('#videoDescText')?.value || '',
        { title: draft.video_title || draft.title });
      const n = mergeParsedSteps(steps);
      if (n) toast(`已加入 ${n} 個步驟草稿，請檢查內容`);
      else if (steps.length) toast('這些步驟已存在，未重複加入', 'info');
      else toast('說明中解析不到步驟，試試文字稿', 'err');
      if (n) document.getElementById('stepRows')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (act === 'desc-to-ings') {
      const ings = parseIngredientsFromText($('#videoDescText')?.value || '');
      const n = mergeParsedIngs(ings);
      if (n) toast(`已加入 ${n} 種食材（啟發式解析，請核對）`);
      else if (ings.length) toast('這些食材已存在，未重複加入', 'info');
      else toast('解析不到食材，可用文字稿或手動加入', 'err');
      if (n) document.getElementById('ingRows')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (act === 'transcript-to-steps') {
      const text = $('#transcriptText')?.value || '';
      if (!text.trim()) { toast('請先貼上文字稿', 'err'); return; }
      const steps = parseTranscriptSteps(text, { title: draft.video_title || draft.title });
      const n = mergeParsedSteps(steps);
      if (n) toast(`已加入 ${n} 個步驟草稿`);
      else if (steps.length) toast('這些步驟已存在，未重複加入', 'info');
      else toast('解析不到步驟', 'err');
      if (n) document.getElementById('stepRows')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (act === 'transcript-to-ings') {
      const text = $('#transcriptText')?.value || '';
      if (!text.trim()) { toast('請先貼上文字稿', 'err'); return; }
      const ings = parseIngredientsFromText(text);
      const n = mergeParsedIngs(ings);
      if (n) toast(`已加入 ${n} 種食材`);
      else if (ings.length) toast('這些食材已存在，未重複加入', 'info');
      else toast('解析不到食材', 'err');
      if (n) document.getElementById('ingRows')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (act === 'fetch-steps') {
      const url = (draft.video_url || '').trim();
      if (!url) { toast('請先貼上影片連結', 'err'); return; }
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = '取得字幕中…';
      try {
        const hintText = detectTextLang(`${draft.video_title || ''}\n${draft.title || ''}\n${$('#videoDescText')?.value || ''}`);
        const tr = await loadTranscript({ url, hintText });
        const n = mergeParsedSteps(transcriptStepsToDraft(tr));
        toast(n ? `✅ 已從字幕產生 ${n} 個步驟（${tr.language || '?'}，共 ${tr.segments.length} 段）` : '字幕裡沒有可用步驟', n ? 'ok' : 'err');
        if (n) document.getElementById('stepRows')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        toast('字幕取得失敗：' + e.message, 'err');
      } finally {
        btn.disabled = false; btn.textContent = label;
      }
    }

    if (act === 'bookmarklet-help') {
      openBookmarkletHelp();
      return;
    }

    if (act === 'paste-transcript') {
      try {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) { toast('剪貼簿是空的', 'err'); return; }
        const ta = $('#transcriptText');
        if (ta) {
          ta.value = text;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
        toast('📋 已貼上字幕稿（' + text.trim().split('\n').length + ' 行），按「解析文字稿成步驟」');
        $('#transcriptText')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        toast('讀不到剪貼簿（瀏覽器需授權），請手動貼上：' + e.message, 'err');
        $('#transcriptText')?.focus();
      }
      return;
    }

    if (act === 'open-settings') {
      e.preventDefault();
      openAiSettings(() => renderContentBox({
        description: $('#videoDescText')?.value || '',
        captionLangs: [], hasCaptions: false,
        chapters: [], url: draft.video_url || '',
      }));
      return;
    }

    if (act === 'ai-video' || act === 'ai-text') {
      const mode = act === 'ai-video' ? 'video' : 'text';
      const text = [$('#videoDescText')?.value || '', $('#transcriptText')?.value || '']
        .filter((s) => s.trim()).join('\n\n');
      if (mode === 'text' && !text.trim()) {
        toast('沒有可解析的文字（請先擷取說明或貼文字稿）', 'err');
        return;
      }
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = mode === 'video' ? '🎬 AI 看影片中…' : '🤖 AI 解析中…';
      try {
        const result = await aiAnalyze({
          mode,
          text,
          title: draft.title || draft.video_title || '',
          videoUrl: draft.video_url || '',
        });
        const { ni, ns } = applyAiResult(result);
        const parts = [];
        if (ni) parts.push(`食材 ${ni} 種`);
        if (ns) parts.push(`步驟 ${ns} 個`);
        toast(parts.length ? `🤖 AI 已整理：${parts.join('、')}（請核對）` : '🤖 AI 沒有整理出內容', parts.length ? 'ok' : 'err');
        if (parts.length) document.getElementById('ingRows')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        toast('AI 解析失敗：' + e.message, 'err');
      } finally {
        btn.disabled = false; btn.textContent = label;
      }
    }
  });

  // 上傳封面
  $('#coverFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('圖片請小於 3MB', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      draft.cover = reader.result;
      fld('cover').value = '';
      $('#coverPreview').innerHTML = coverPreviewHtml(draft);
    };
    reader.readAsDataURL(file);
  });

  // 送出
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = (titleInput.value || '').trim();
    if (!title) { toast('請輸入食譜名稱', 'err'); titleInput.focus(); return; }

    const payload = {
      title,
      description: draft.description,
      category: draft.category,
      video_url: draft.video_url,
      video_title: draft.video_title,
      cover: draft.cover,
      servings: Number(fld('servings').value) || 2,
      prep_minutes: Number(fld('prep_minutes').value) || 0,
      cook_minutes: Number(fld('cook_minutes').value) || 0,
      difficulty: draft.difficulty,
      tags: draft.tags,
      notes: draft.notes,
      source: draft.source,
      ingredients: draft.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({ ...i, qty: i.qty === '' ? null : Number(i.qty) })),
      steps: draft.steps.map((s) => ({
        title: s.title,
        body: s.body,
        tip: s.tip,
        t_start: clockToSecs(s.t),
        t_end: null,
      })),
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const res = draft.id
        ? await api(`/api/recipes/${draft.id}`, { method: 'PUT', body: payload })
        : await api('/api/recipes', { method: 'POST', body: payload });
      toast(draft.id ? '已儲存變更' : '食譜已建立');
      location.hash = `#/recipe/${res.recipe.id}`;
    } catch (err) {
      toast(err.message, 'err');
      submitBtn.disabled = false;
    }
  });
}

function swap(arr, a, b) {
  [arr[a], arr[b]] = [arr[b], arr[a]];
}

function focusRow(sel) {
  const el = $(sel);
  if (el) el.focus();
}

/* 分類下拉回填（非同步，失敗不影響） */
(async function fillCategories() {
  try {
    const data = await api('/api/categories');
    categoryCache = data.items.map((x) => x.category);
    const list = $('#catList');
    if (list) list.innerHTML = categoryCache.map((c) => `<option value="${esc(c)}">`).join('');
  } catch { /* ignore */ }
})();
