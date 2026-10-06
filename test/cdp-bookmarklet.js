/**
 * 實測「字幕稿書籤小工具」：在真實 YouTube 頁面執行 BOOKMARKLET_CODE，
 * 攔截 alert/prompt/clipboard 取得輸出，驗證它真的能讀到逐字稿。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const os = require('node:os');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const ID = process.argv[2] || 'msLskDp5pG0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

// 從 core.js 抓出 BOOKMARKLET_CODE
function readBookmarkletCode() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');
  const m = src.match(/const BOOKMARKLET_CODE = `([\s\S]*?)`;/);
  if (!m) throw new Error('找不到 BOOKMARKLET_CODE');
  return m[1];
}

(async () => {
  const code = readBookmarkletCode();
  console.log('bookmarklet 長度:', code.length);

  const profile = path.join(os.tmpdir(), 'cdp-bm-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
    '--no-first-run', '--disable-blink-features=AutomationControlled',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,1200', 'about:blank',
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
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(m + ' 逾時')); } }, 60000);
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

    await send('Page.navigate', { url: `https://www.youtube.com/watch?v=${ID}` });
    await sleep(8000);

    // 先埋設攔截器
    await send('Runtime.evaluate', {
      expression: `(() => {
        window.__bmOut = { alert: [], prompt: [], clip: [] };
        window.alert = function (m) { window.__bmOut.alert.push(String(m)); };
        window.prompt = function (m, v) { window.__bmOut.prompt.push(String(v == null ? '' : v)); return v; };
        if (navigator.clipboard) {
          navigator.clipboard.writeText = function (t) { window.__bmOut.clip.push(String(t)); return Promise.resolve(); };
        }
        return 'hooked';
      })()`,
    });

    // 執行書籤小工具
    await send('Runtime.evaluate', { expression: code, awaitPromise: true });
    await sleep(24000);

    const r = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        alerts: window.__bmOut.alert,
        prompts: window.__bmOut.prompt.map(s => s.slice(0, 300)),
        clipLen: window.__bmOut.clip.length,
        clipHead: window.__bmOut.clip.map(s => s.split('\\n').slice(0, 6).join(' | ')),
        clipLines: window.__bmOut.clip.map(s => s.split('\\n').length),
      })`,
      returnByValue: true,
    });
    const out = JSON.parse(r.result.value);
    console.log('alerts:', JSON.stringify(out.alerts));
    console.log('clip lines:', out.clipLines, 'head:', JSON.stringify(out.clipHead));
    if (out.prompts.length) console.log('prompt(備援):', JSON.stringify(out.prompts));

    // 診斷：頁面上字幕面板狀態
    const diag = await send('Runtime.evaluate', {
      expression: `(() => {
        const segs = document.querySelectorAll('ytd-transcript-segment-renderer, yt-transcript-segment-renderer, [class*="transcript-segment"]');
        const panels = Array.from(document.querySelectorAll('ytd-engagement-panel-section-list-renderer')).map((p) => (p.innerText || '').slice(0, 40).replace(/\\n/g, ' ')).filter(Boolean);
        return JSON.stringify({ segs: segs.length, panels });
      })()`,
      returnByValue: true,
    });
    console.log('DOM 診斷:', diag.result.value);

    const gotText = out.clipLines.some((n) => n >= 3) || out.prompts.some((s) => s.length > 30);
    const ok = gotText;
    console.log(ok ? 'BOOKMARKLET TEST PASS ✅' : 'BOOKMARKLET TEST FAIL ❌（headless 下 YouTube 字幕面板不渲染，需真瀏覽器驗證）');
    if (!ok) process.exitCode = 1;
  } finally {
    chrome.kill();
  }
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('BOOKMARKLET TEST FAIL ❌', e.message);
  process.exit(1);
});
