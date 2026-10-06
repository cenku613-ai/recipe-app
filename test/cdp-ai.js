/**
 * AI 解析端到端測試（兩條路徑）：
 *  A. OpenAI 相容（DeepSeek／自訂）— 「AI 解析說明／文字稿」
 *  B. Gemini — 「AI 看影片」（吃 YouTube 連結）
 * 以假 LLM 服務（含 CORS）驗證整條流程。先啟動伺服器：npm start
 */
'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const MOCK_PORT = 3901;
const BASE = process.env.BASE || 'http://localhost:3777';

const MOCK_RESULT = {
  title: 'AI 假標題',
  servings: 4,
  ingredients: [
    { name: '蠔仔/baby oyster', qty: 500, unit: 'g', group_name: '主料' },
    { name: 'egg /蛋', qty: 2, unit: '個', group_name: '' },
  ],
  steps: [
    { title: '洗蠔', body: '用粗鹽抓洗蠔仔去除雜質', t: 42, tip: '洗到水變清' },
    { title: '煎餅', body: '熱鑊落油把蠔餅煎至兩面金黃', t: 125, tip: '' },
  ],
};

// 假 LLM：同時支援 OpenAI /chat/completions 與 Gemini :generateContent
const mock = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,authorization,x-goog-api-key',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let payload;
    if (req.url.includes('generateContent')) {
      // Gemini 形狀
      payload = { candidates: [{ content: { parts: [{ text: JSON.stringify(MOCK_RESULT) }] } }] };
    } else {
      payload = { choices: [{ message: { role: 'assistant', content: JSON.stringify(MOCK_RESULT) } }] };
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify(payload));
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  console.log('假 LLM 服務 :' + MOCK_PORT);

  const profile = path.join(os.tmpdir(), 'cdp-ai-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
    '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1100,1500', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let i = 0; i < 50 && !targets; i++) {
      try { targets = await getJson('/json/list'); } catch { await sleep(300); }
    }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    let rid = 0;
    const pending = new Map();
    const send = (m, p = {}) => new Promise((res, rej) => {
      const i = ++rid;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(m + ' 逾時')); } }, 90000);
    });
    ws.on('message', (msg) => {
      const m = JSON.parse(msg.toString());
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
    await new Promise((r) => ws.on('open', r));
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: `${BASE}/#/new` });
    await sleep(3500);

    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate 失敗');
      return r.result.value;
    };

    // 全域設定：自訂 OpenAI 相容 → 指向假 LLM
    // 全域設定 + 註冊測試帳號（路由守衛需要登入）
    console.log(await ev(`(async () => {
      localStorage.setItem('rbAiProvider', 'custom');
      localStorage.setItem('rbAiKey', 'sk-test');
      localStorage.setItem('rbAiBase', 'http://127.0.0.1:${MOCK_PORT}/v1');
      localStorage.setItem('rbAiModel', 'fake-model');
      const r = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'cdpai-' + Date.now() + '@example.com', password: 'password123', name: 'CDP AI' }),
      });
      const j = await r.json();
      if (j.token) { localStorage.setItem('rbToken', j.token); localStorage.setItem('rbUser', JSON.stringify(j.user)); }
      return j.token ? 'settings+auth saved' : ('auth fail: ' + JSON.stringify(j));
    })()`));

    // 貼影片 → 擷取說明
    await send('Page.navigate', { url: `${BASE}/#/new` });
    await sleep(3500);
    console.log(await ev(`(async () => {
      const inp = document.querySelector('input[name="video_url"]');
      inp.value = 'https://www.youtube.com/watch?v=msLskDp5pG0';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-form="fetch-video"]').click();
      await new Promise(r => setTimeout(r, 8000));
      return 'desc=' + (document.getElementById('videoDescText') ? document.getElementById('videoDescText').value.length : 0);
    })()`));

    const runAi = async (btnForm) => ev(`(async () => {
      const btn = document.querySelector('[data-form="${btnForm}"]');
      if (!btn) return 'ERR no button ${btnForm}';
      btn.click();
      await new Promise(r => setTimeout(r, 2600));
      const toastEl = document.querySelector('.toast');
      const toastText = toastEl ? toastEl.textContent : '';
      await new Promise(r => setTimeout(r, 500));
      const ings = Array.from(document.querySelectorAll('.ing-row')).map((r) => {
        const n = r.querySelector('[data-ing="name"]'); const q = r.querySelector('[data-ing="qty"]'); const u = r.querySelector('[data-ing="unit"]');
        return n.value + '|' + q.value + '|' + u.value;
      });
      const steps = Array.from(document.querySelectorAll('.step-row')).map((r) => {
        const t = r.querySelector('[data-step="t"]'); const b = r.querySelector('[data-step="body"]');
        return t.value + ' :: ' + b.value.slice(0, 18);
      });
      return JSON.stringify({ ings, steps, toast: toastText });
    })()`);

    // A. OpenAI 相容路徑（ai-text）
    const a = JSON.parse(await runAi('ai-text'));
    console.log('A（AI 解析文字）:', JSON.stringify(a));
    const okA = a.ings.some((x) => x.startsWith('蠔仔|500|g')) &&
                a.ings.some((x) => x.startsWith('蛋|2|個')) &&
                a.steps.some((x) => x.startsWith('00:42')) &&
                a.steps.some((x) => x.startsWith('02:05')) &&
                /AI 已整理/.test(a.toast);

    // B. Gemini 影片路徑（改 provider → gemini）
    console.log(await ev(`(() => {
      localStorage.setItem('rbAiProvider', 'gemini');
      localStorage.setItem('rbAiBase', 'http://127.0.0.1:${MOCK_PORT}/v1beta');
      localStorage.setItem('rbAiModel', 'gemini-2.0-flash');
      return 'switch to gemini';
    })()`));
    await send('Page.navigate', { url: `${BASE}/#/new` });
    await sleep(3500);
    await ev(`(async () => {
      const inp = document.querySelector('input[name="video_url"]');
      inp.value = 'https://www.youtube.com/watch?v=msLskDp5pG0';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-form="fetch-video"]').click();
      await new Promise(r => setTimeout(r, 8000));
      return 'ready';
    })()`);
    const b = JSON.parse(await runAi('ai-video'));
    console.log('B（AI 看影片）:', JSON.stringify(b));
    const okB = b.ings.some((x) => x.startsWith('蠔仔|500|g')) &&
                b.steps.some((x) => x.startsWith('00:42')) &&
                /AI 已整理/.test(b.toast);

    console.log(okA ? '  A 路徑 PASS ✅' : '  A 路徑 FAIL ❌');
    console.log(okB ? '  B 路徑 PASS ✅' : '  B 路徑 FAIL ❌');
    const ok = okA && okB;
    console.log(ok ? 'CDP AI TEST PASS ✅' : 'CDP AI TEST FAIL ❌');
    if (!ok) process.exitCode = 1;
  } finally {
    chrome.kill();
    mock.close();
  }
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('CDP AI TEST FAIL ❌', e.message);
  mock.close();
  process.exit(1);
});
