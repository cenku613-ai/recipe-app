/**
 * 食譜盒 · core — 工具函式、API 用戶端、全域狀態
 */
'use strict';

/* ---------- DOM ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 提示 ---------- */
function toast(message, type = 'ok') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, 2600);
}

/* ---------- 確認對話框 ---------- */
function confirmDialog(message, { okText = '確定', danger = false } = {}) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <p class="modal-text">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel" type="button">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(okText)}</button>
        </div>
      </div>`;
    const close = (val) => { wrap.remove(); resolve(val); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') close(true);
      if (act === 'cancel') close(false);
    });
    root.appendChild(wrap);
    wrap.querySelector('[data-act="ok"]').focus();
  });
}

/* ---------- 登入狀態 ---------- */
function authToken() {
  try { return localStorage.getItem('rbToken') || ''; } catch { return ''; }
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem('rbUser') || 'null'); } catch { return null; }
}

function setAuth(token, user) {
  try {
    if (token) localStorage.setItem('rbToken', token);
    else localStorage.removeItem('rbToken');
    if (user) localStorage.setItem('rbUser', JSON.stringify(user));
    else localStorage.removeItem('rbUser');
  } catch { /* ignore */ }
  updateAuthUi();
}

/** 登入狀態列（右上角／手機設定頁） */
function updateAuthUi() {
  const u = currentUser();
  for (const el of $$('[data-auth-slot]')) {
    el.innerHTML = u
      ? `<span class="auth-chip" title="${esc(u.email)}">👤 ${esc(u.name || u.email)}</span>
         <button class="btn btn-ghost btn-sm" data-action="logout" type="button">登出</button>`
      : `<a class="btn btn-primary btn-sm" href="#/login" data-action="goto-login">登入</a>`;
  }
  for (const el of $$('[data-admin-slot]')) {
    el.innerHTML = (u && u.is_admin) ? '<a class="btn btn-ghost btn-sm hide-mobile" href="#/admin">🛠 後台</a>' : '';
  }
}

/* ---------- API ---------- */
async function api(path, { method = 'GET', body, skipAuth } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = authToken();
  if (token && !skipAuth) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && !skipAuth) {
    // 只有「帶著 token 卻 401」才視為工作階段過期；
    // 未登入時的請求不應清除稍後才建立的登入狀態（避免競態）
    if (token) {
      setAuth('', null);
      if (!location.hash.startsWith('#/login') && !location.hash.startsWith('#/register')) {
        location.hash = '#/login';
      }
    }
    throw new Error((data && data.error) || '請先登入');
  }
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.error) || `請求失敗（${res.status}）`);
  }
  return data;
}

/* ---------- 格式 ---------- */
function fmtMinutes(min) {
  min = Number(min) || 0;
  if (min <= 0) return '';
  if (min < 60) return `${min} 分鐘`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}

function secsToClock(sec) {
  sec = Number(sec);
  if (!Number.isFinite(sec) || sec < 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function clockToSecs(text) {
  if (!text) return null;
  const parts = String(text).trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.some((p) => p !== '' && !/^\d+$/.test(p))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + (Number(p) || 0);
  return sec;
}

/** 依份量換算數量顯示 */
function scaleQty(qty, factor) {
  if (qty === null || qty === undefined || qty === '') return '';
  const n = Number(qty);
  if (!Number.isFinite(n)) return String(qty);
  const v = n * factor;
  const rounded = Math.round(v * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/0+$/, '').replace(/\.$/, '');
}

/** 粗略判斷文字語系：'zh' / 'en' / ''（供字幕語言自動挑選） */
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

/** 從各式 YouTube 連結解析影片 ID */
function videoIdOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (/youtu\.be$/.test(u.hostname) || u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]{6,})/);
    if (m) return m[2];
    if (/^[\w-]{11}$/.test(u.pathname.replace(/\//g, ''))) return u.pathname.replace(/\//g, '');
  } catch { /* ignore */ }
  const m = String(url).match(/(?:v=|\/)([\w-]{11})(?:[?&/]|$)/);
  return m ? m[1] : null;
}

function thumbOf(recipe) {
  if (recipe.cover) return recipe.cover;
  const id = videoIdOf(recipe.video_url);
  if (id) return `/api/thumb/${id}`;
  return '';
}

function debounce(fn, wait = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/* ---------- 全域狀態 ---------- */
const state = {
  route: { name: 'home', id: null },
  shopCount: 0,
  listFactor: 1, // 食譜詳情頁的份量倍率
};

async function refreshShoppingBadge() {
  try {
    const data = await api('/api/shopping');
    state.shopCount = data.items.length;
  } catch { /* ignore */ }
  for (const id of ['shopBadge', 'shopBadgeMobile']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = String(state.shopCount);
    el.hidden = state.shopCount === 0;
  }
}

async function refreshFooterStats() {
  const el = $('#footerStats');
  if (!el) return;
  try {
    const [recipes, shop] = await Promise.all([api('/api/recipes'), api('/api/shopping')]);
    el.textContent = `共 ${recipes.items.length} 份食譜 · 採購清單 ${shop.items.length} 項`;
  } catch { /* ignore */ }
}

/* ================================================================== */
/* AI 設定（全域，存 localStorage）與模型呼叫                           */
/* ================================================================== */

const AI_DEFAULTS = { provider: 'deepseek', key: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
const AI_PROVIDER_HINTS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  custom: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
};

function aiSettings() {
  try {
    return {
      provider: localStorage.getItem('rbAiProvider') || AI_DEFAULTS.provider,
      key: localStorage.getItem('rbAiKey') || '',
      baseUrl: localStorage.getItem('rbAiBase') || AI_DEFAULTS.baseUrl,
      model: localStorage.getItem('rbAiModel') || AI_DEFAULTS.model,
    };
  } catch {
    return { ...AI_DEFAULTS };
  }
}

function saveAiSettings(s) {
  try {
    localStorage.setItem('rbAiProvider', s.provider || 'deepseek');
    localStorage.setItem('rbAiKey', s.key || '');
    localStorage.setItem('rbAiBase', s.baseUrl || AI_DEFAULTS.baseUrl);
    localStorage.setItem('rbAiModel', s.model || AI_DEFAULTS.model);
  } catch { /* ignore */ }
}

/** 全域設定對話框 */
function openAiSettings(onSaved) {
  const s = aiSettings();
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="AI 設定">
      <h3 class="modal-title">⚙ AI 設定（全域）</h3>
      <div class="settings-grid">
        <label class="field">
          <span class="field-label">服務提供者</span>
          <select class="input" id="setProvider">
            <option value="deepseek">DeepSeek（解析文字）</option>
            <option value="gemini">Google Gemini（可直接看影片）</option>
            <option value="custom">自訂 OpenAI 相容服務</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">API Key</span>
          <input class="input" id="setKey" type="password" autocomplete="off" placeholder="sk-…（Google AI Studio 亦可）" value="${esc(s.key)}">
        </label>
        <label class="field">
          <span class="field-label">模型</span>
          <input class="input" id="setModel" placeholder="模型名稱" value="${esc(s.model)}">
        </label>
        <label class="field">
          <span class="field-label">Base URL（自訂服務用）</span>
          <input class="input" id="setBase" placeholder="https://api.deepseek.com/v1" value="${esc(s.baseUrl)}">
        </label>
      </div>
      <p class="muted small">金鑰只存這台裝置的瀏覽器（localStorage），不寫入資料庫。DeepSeek／Gemini 支援跨域，由瀏覽器直接呼叫，金鑰不離開你的裝置。API 用量計入你自己的帳號。</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="cancel" type="button">取消</button>
        <button class="btn btn-primary" data-act="save" type="button">儲存設定</button>
      </div>
    </div>`;
  const close = () => wrap.remove();
  const providerSel = wrap.querySelector('#setProvider');
  const modelInp = wrap.querySelector('#setModel');
  const baseInp = wrap.querySelector('#setBase');
  providerSel.value = s.provider;
  providerSel.addEventListener('change', () => {
    const hint = AI_PROVIDER_HINTS[providerSel.value];
    if (hint) { modelInp.value = hint.model; baseInp.value = hint.baseUrl; }
  });
  wrap.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target === wrap || act === 'cancel') close();
    if (act === 'save') {
      saveAiSettings({
        provider: providerSel.value,
        key: wrap.querySelector('#setKey').value.trim(),
        model: modelInp.value.trim(),
        baseUrl: baseInp.value.trim(),
      });
      toast('AI 設定已儲存');
      close();
      if (typeof onSaved === 'function') onSaved();
    }
  });
  root.appendChild(wrap);
  wrap.querySelector('#setKey').focus();
}

/** 解析 LLM 回傳的 JSON → 標準食譜結構 */
function parseAiJson(content) {
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
        name: (typeof normalizeIngredientName === 'function' ? normalizeIngredientName(i.name) : String(i.name)).slice(0, 40),
        qty: i.qty === '' || i.qty === null || i.qty === undefined ? '' : Number(i.qty) || 0,
        unit: String(i.unit || ''),
        group_name: String(i.group_name || ''),
      }))
      .filter((i) => i.name),
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

const AI_JSON_SCHEMA = `{
  "title": "",
  "servings": 2,
  "ingredients": [ { "name": "", "qty": "", "unit": "", "group_name": "" } ],
  "steps": [ { "title": "", "body": "", "t": null, "tip": "" } ]
}`;

const AI_RULES = `要求：
1. 食材要乾淨：只留中文名稱（若原文是「蠔仔/baby oyster」這種中英混雜，就只取「蠔仔」）；數量與單位分開填（如 qty:500, unit:"g"）；沒有數量就填 ""。
2. 步驟要可執行：每個步驟一句清楚的動作；若影片有時間碼就填 t（秒數，沒有就 null）；幫忙取一個簡短步驟標題（title）與一個實用小提示（tip，沒有就留空）。
3. 若內容裡沒有做法，steps 就給空陣列；不要憑空捏造步驟。
4. 不要把器材、連結、社群文字當成食材或步驟。
5. 份量若提到就填 servings，否則給 2。`;

/** 呼叫 LLM（依 provider 路由）；mode: 'video'（給 YouTube 連結看影片）| 'text' */
async function aiAnalyze({ mode = 'text', text = '', title = '', videoUrl = '' }) {
  const s = aiSettings();
  if (!s.key) {
    openAiSettings();
    throw new Error('請先設定 AI API Key（右上角 ⚙）');
  }
  const wantsVideo = mode === 'video' && videoUrl;
  if (s.provider === 'gemini') {
    return geminiCall({ s, text, title, videoUrl: wantsVideo ? videoUrl : '' });
  }
  return openAiChatCall({ s, text, title, videoUrl: wantsVideo ? videoUrl : '' });
}

/** Gemini（可直接吃 YouTube 連結看影片） */
async function geminiCall({ s, text, title, videoUrl }) {
  const base = String(s.baseUrl || AI_PROVIDER_HINTS.gemini.baseUrl).replace(/\/+$/, '');
  const model = s.model || AI_PROVIDER_HINTS.gemini.model;
  const parts = [];
  if (videoUrl) {
    parts.push({ file_data: { file_uri: videoUrl } });
    parts.push({
      text: `請「觀看」這段煮食教學影片（包含旁白與畫面上的文字），整理成結構化食譜。\n${AI_RULES}\n\n影片標題：${title || '（無）'}\n${text ? '\n（參考說明文字）：\n' + String(text).slice(0, 6000) : ''}\n\n嚴格輸出這個 JSON 結構：\n${AI_JSON_SCHEMA}`,
    });
  } else {
    parts.push({
      text: `你是食譜整理助手。以下是煮食教學影片的說明文字或字幕逐字稿，請整理成結構化食譜。\n${AI_RULES}\n\n影片標題：${title || '（無）'}\n\n--- 內容開始 ---\n${String(text).slice(0, 14000)}\n--- 內容結束 ---\n\n嚴格輸出這個 JSON 結構：\n${AI_JSON_SCHEMA}`,
    });
  }
  const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini 回應 ${res.status}：${t.slice(0, 160)}`);
  }
  const j = await res.json();
  const content = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return parseAiJson(content);
}

/** OpenAI 相容（DeepSeek／自訂） */
async function openAiChatCall({ s, text, title, videoUrl }) {
  const base = String(s.baseUrl || AI_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const model = s.model || AI_DEFAULTS.model;
  const userContent = videoUrl
    ? `影片連結：${videoUrl}\n影片標題：${title || '（無）'}\n\n（若你無法看連結內容，請改用下方說明文字）\n\n--- 內容 ---\n${String(text).slice(0, 14000)}`
    : `影片標題：${title || '（無）'}\n\n--- 內容開始 ---\n${String(text).slice(0, 14000)}\n--- 內容結束 ---`;
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.key },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `你是食譜整理助手。請整理成結構化食譜。\n${AI_RULES}\n\n嚴格輸出這個 JSON 結構：\n${AI_JSON_SCHEMA}` },
        { role: 'user', content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 服務回應 ${res.status}：${t.slice(0, 160)}`);
  }
  const j = await res.json();
  return parseAiJson(j.choices?.[0]?.message?.content || '');
}

/* ================================================================== */
/* YouTube 字幕稿書籤小工具（在 YouTube 頁面執行，用自己的工作階段）        */
/* ================================================================== */

/**
 * 書籤小工具原始碼：在 YouTube 影片頁執行
 * → 自動打開「顯示字幕稿」→ 讀取逐字稿（含時間碼）→ 複製到剪貼簿
 * 因為執行在網頁自己的 origin，能讀到你已登入的 YouTube 面板。
 */
const BOOKMARKLET_CODE = `(function(){
function segs(){
  var sel='ytd-transcript-segment-renderer, yt-transcript-segment-renderer, [class*="transcript-segment"]';
  var s=document.querySelectorAll(sel),o=[];
  for(var i=0;i<s.length;i++){
    var a=s[i].querySelector('.segment-timestamp')||s[i].querySelector('.segment-start-time')||s[i].querySelector('[class*="timestamp"]'),
        b=s[i].querySelector('.segment-text')||s[i].querySelector('yt-formatted-string')||s[i].querySelector('[class*="segment-text"]');
    var t=a?(a.innerText||a.textContent||'').trim():'';
    var x=b?(b.innerText||b.textContent||'').trim():'';
    if(x)o.push((t?t+' ':'')+x);
  }
  return o;
}
function panelText(){
  var p=document.querySelectorAll('ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer');
  for(var i=0;i<p.length;i++){
    var txt=(p[i].innerText||'').trim();
    if(/^(transcript|字幕稿|逐字稿)/i.test(txt)&&txt.length>80){
      return txt.split('\\n').map(function(l){return l.trim();}).filter(function(l){return l && !/^(transcript|字幕稿|逐字稿)$/i.test(l);});
    }
  }
  return [];
}
function go(l){
  if(!l||!l.length){alert('沒讀到字幕稿。請手動按「顯示字幕稿」，等它展開後再點我。');return;}
  var v=l.join('\\n');
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(v).then(function(){
      alert('已複製 '+l.length+' 行字幕稿到剪貼簿。\\n\\n回到食譜盒 → 按「貼上字幕稿」→「解析文字稿成步驟」。');
    },function(){prompt('請複製以下字幕稿：',v);});
  }else{prompt('請複製以下字幕稿：',v);}
}
function find(){
  var b=document.querySelectorAll('button');
  for(var i=0;i<b.length;i++){
    var t=(b[i].innerText||'')+' '+(b[i].getAttribute('aria-label')||'');
    if(/show transcript|transcript|字幕稿|逐字稿|顯示文字/i.test(t))return b[i];
  }
  return null;
}
function attempt(){
  var x=segs(); if(x.length)return go(x);
  var p=panelText(); if(p.length)return go(p);
  return null;
}
if(attempt())return;
var btn=find();
if(btn){btn.scrollIntoView({block:'center'});try{btn.click();}catch(e){}}
var n=0,h=setInterval(function(){
  n++;
  if(attempt()){clearInterval(h);return;}
  if(n>40){clearInterval(h);go([]);}
},500);
})()`;

/** 書籤小工具連結（javascript: 型式） */
function bookmarkletHref() {
  return 'javascript:' + encodeURIComponent(BOOKMARKLET_CODE.replace(/\n\s*/g, ''));
}

/** 書籤小工具說明對話框 */
function openBookmarkletHelp() {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="字幕稿書籤小工具">
      <h3 class="modal-title">📚 一鍵複製字幕稿（書籤小工具）</h3>
      <ol class="help-steps">
        <li>把下面的按鈕<b>拖到瀏覽器書籤列</b>（或右鍵 →「加到書籤」／「另存書籤」）。</li>
        <li>打開要做的 YouTube 影片頁，<b>點一下這個書籤</b>。</li>
        <li>它會自動打開「顯示字幕稿」並<b>複製逐字稿（含時間碼）</b>。</li>
        <li>回到食譜盒 → 按「📋 貼上字幕稿」→「解析文字稿成步驟」。</li>
      </ol>
      <a class="btn btn-primary bookmarklet-link" id="bmLink" href="#">📚 複製字幕稿（拖到書籤列）</a>
      <p class="muted small">只在 YouTube 影片頁有效。若瀏覽器擋住剪貼簿，會改用彈出視窗讓你手動複製。這個工具<b>不需安裝任何東西</b>、只在你自己的瀏覽器裡執行。</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="cancel" type="button">關閉</button>
      </div>
    </div>`;
  wrap.querySelector('#bmLink').setAttribute('href', bookmarkletHref());
  wrap.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target === wrap || act === 'cancel') wrap.remove();
  });
  root.appendChild(wrap);
}

/* ---------- YouTube 播放控制（postMessage，無需載入 API） ---------- */
function ytCommand(iframe, func, args = []) {
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(
    JSON.stringify({ event: 'command', func, args }),
    '*',
  );
}

function seekVideo(iframe, seconds) {
  if (!iframe) return;
  ytCommand(iframe, 'seekTo', [Number(seconds) || 0, true]);
  ytCommand(iframe, 'playVideo', []);
}
