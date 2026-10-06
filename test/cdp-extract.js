/**
 * 以 CDP 實際操作「取得影片說明 → 建立步驟草稿 → 解析食材」並截圖。
 * 前置：npm start
 * 執行：node test/cdp-extract.js
 */
'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const BASE = process.env.BASE || 'http://localhost:3777';
const OUT = path.join(__dirname, 'extract-form.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const profile = path.join(os.tmpdir(), 'cdp-extract-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
    '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1100,1600', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let i = 0; i < 50 && !targets; i++) {
      try { targets = await getJson('/json/list'); } catch { await sleep(300); }
    }
    if (!targets) throw new Error('Chrome DevTools 未啟動');
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(method + ' 逾時')); } }, 30000);
    });
    ws.on('message', (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      }
    });
    await new Promise((r) => ws.on('open', r));
    await send('Page.enable');
    await send('Runtime.enable');

    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate 失敗');
      return r.result.value;
    };

    await send('Page.navigate', { url: `${BASE}/#/new` });
    await sleep(3000);

    // 註冊測試帳號（路由守衛需要登入）
    console.log(await evalJs(`(async () => {
      const r = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'cdp-' + Date.now() + '@example.com', password: 'password123', name: 'CDP' }),
      });
      const j = await r.json();
      if (j.token) { localStorage.setItem('rbToken', j.token); localStorage.setItem('rbUser', JSON.stringify(j.user)); }
      return j.token ? 'auth ok' : ('auth fail: ' + JSON.stringify(j));
    })()`));
    await send('Page.navigate', { url: `${BASE}/#/new` });
    await sleep(3000);

    // 填入影片連結（同步到 draft）
    const target = process.argv[2] || 'https://www.youtube.com/watch?v=uGhfXQDvFN4';
    console.log(await evalJs(`(() => {
      const inp = document.querySelector('input[name="video_url"]');
      inp.value = ${JSON.stringify(target)};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 'url set';
    })()`));

    // 按「擷取影片資訊」（新版會一併抓說明並自動建立草稿）
    console.log(await evalJs(`(async () => {
      document.querySelector('[data-form="fetch-video"]').click();
      await new Promise(r => setTimeout(r, 9000));
      const box = document.getElementById('contentBox');
      const desc = document.getElementById('videoDescText');
      return 'contentBox=' + (box && box.innerHTML.length) + ' descLen=' + (desc ? desc.value.length : 0);
    })()`));

    // 再按一次解析按鈕（重複內容應自動去重、不重複加入）；按鈕不存在就跳過
    console.log(await evalJs(`(async () => {
      const bs = document.querySelector('[data-form="desc-to-steps"]');
      const bi = document.querySelector('[data-form="desc-to-ings"]');
      if (bs) bs.click();
      if (bi) bi.click();
      await new Promise(r => setTimeout(r, 800));
      const steps = document.querySelectorAll('.step-row').length;
      const ings = document.querySelectorAll('.ing-row').length;
      const ingNames = Array.from(document.querySelectorAll('.ing-row [data-ing="name"]')).map(i => i.value);
      const stepBodies = Array.from(document.querySelectorAll('.step-row [data-step="body"]')).map(t => t.value.slice(0, 40));
      const toast = document.querySelector('.toast');
      return JSON.stringify({ steps, ings, ingNames, stepBodies, toast: toast ? toast.textContent : '' });
    })()`));

    // 量測擷取面板
    console.log(await evalJs(`(() => {
      const box = document.querySelector('.extract-box');
      if (!box) return 'NO extract-box';
      const r = box.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      return JSON.stringify({
        top: Math.round(r.top), width: Math.round(r.width),
        right: Math.round(r.right), viewport: vw, overflow: r.right > vw + 1,
        hasDescBox: !!document.getElementById('videoDescText'),
        hasTranscriptBox: !!document.getElementById('transcriptText'),
        buttons: Array.from(box.querySelectorAll('[data-form]')).map(b => b.textContent.trim()),
        note: box.querySelector('.extract-note').textContent.trim().slice(0, 40),
        stepRows: document.querySelectorAll('.step-row').length,
        ingRows: document.querySelectorAll('.ing-row').length,
      });
    })()`));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截圖：', OUT);

    // 還原：重新載入表單（不儲存）
    ws.close();
  } finally {
    chrome.kill();
  }
  process.exit(0);
})().catch((e) => {
  console.error('CDP EXTRACT TEST FAIL ❌', e.message);
  process.exit(1);
});
