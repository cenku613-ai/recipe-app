/**
 * 以 Chrome DevTools 協定實際執行「下載 PDF」路徑：
 * 驗證 jsPDF + html2canvas 能成功產生 .pdf 檔。
 * 前置：npm start（伺服器需在 3777 執行）
 * 執行：node test/cdp-pdf.js
 */
'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = process.env.BASE || 'http://localhost:3777';
const DL_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DL_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const profile = path.join(os.tmpdir(), 'cdp-pdf-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
    '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1200, 900'.replace(' ', ''), 'about:blank',
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
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(method + ' 逾時')); } }, 15000);
    });
    const consoleErrors = [];
    ws.on('message', (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
      }
    });
    await new Promise((r) => ws.on('open', r));
    await send('Page.enable');
    await send('Runtime.enable');
    try { await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }); } catch { /* 舊版 CDP */ }

    await send('Page.navigate', { url: `${BASE}/#/new` });
    await sleep(3000);

    // 註冊測試帳號並建立一份食譜（路由守衛需要登入）
    const setup = await send('Runtime.evaluate', {
      expression: `(async () => {
        const r = await fetch('/api/auth/register', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'cdppdf-' + Date.now() + '@example.com', password: 'password123', name: 'CDP PDF' }),
        });
        const j = await r.json();
        if (!j.token) return 'ERR ' + JSON.stringify(j);
        localStorage.setItem('rbToken', j.token);
        localStorage.setItem('rbUser', JSON.stringify(j.user));
        const mk = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + j.token },
          body: JSON.stringify({
            title: 'PDF 測試食譜', description: '測試 PDF 匯出', category: '測試', servings: 2,
            ingredients: [{ name: '番茄', qty: 2, unit: '個', group_name: '' }, { name: '蛋', qty: 3, unit: '隻', group_name: '' }],
            steps: [{ title: '備料', body: '番茄切塊', t: 30, tip: '' }, { title: '下鍋', body: '炒至金黃', t: 90, tip: '火要大' }],
          }),
        });
        const mj = await mk.json();
        return String(mj.recipe.id);
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const recipeId = setup.result.value;
    if (!/^\d+$/.test(String(recipeId))) throw new Error('建立食譜失敗: ' + recipeId);
    await send('Page.navigate', { url: `${BASE}/#/recipe/${recipeId}` });
    await sleep(3500);

    const expr = `(async () => {
      try {
        await downloadPdf(state.recipe);
        const t = document.querySelector('.toast');
        return 'OK|' + (t ? t.textContent : '');
      } catch (e) {
        return 'ERR|' + e.message;
      }
    })()`;
    const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const value = out.result.value || '';
    console.log('downloadPdf →', value);

    // 給下載一點時間落盤
    for (let i = 0; i < 20; i++) {
      const files = fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR).filter((f) => f.endsWith('.pdf')) : [];
      if (files.length) {
        for (const f of files) {
          const fp = path.join(DL_DIR, f);
          const buf = fs.readFileSync(fp);
          const head = buf.slice(0, 5).toString();
          console.log(`下載成功：${f}（${buf.length} bytes，標頭=${head}）`);
        }
        break;
      }
      await sleep(500);
    }
    const still = fs.readdirSync(DL_DIR).filter((f) => f.endsWith('.pdf'));
    if (consoleErrors.length) {
      console.log('頁面錯誤：');
      consoleErrors.forEach((e) => console.log('  ' + e));
    }
    if (!value.startsWith('OK') || !still.length) {
      console.log('CDP PDF TEST FAIL ❌');
      process.exitCode = 1;
    } else {
      console.log('CDP PDF TEST PASS ✅');
    }
    ws.close();
  } finally {
    chrome.kill();
  }
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('CDP PDF TEST FAIL ❌', e.message);
  process.exit(1);
});
