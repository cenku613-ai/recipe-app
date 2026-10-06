/**
 * 管理員後台 API 測試（使用獨立資料庫，不影響正式資料）：
 *  第一位註冊者成為管理員 → 列出使用者／設管理員／重設密碼／刪除帳號／權限保護
 * 執行：node test/admin-test.js
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 3790;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), 'recipebox-admin-test-' + Date.now() + '.db');
let failed = 0;
let server = null;

const post = async (p, body, token) => {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const call = async (p, method, body, token) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const ok = (cond, label, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failed++;
};

async function startServer() {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH, HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/api/auth/me');
      if (r.status === 401) return; // 伺服器已就緒
    } catch { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('測試伺服器啟動逾時');
}

(async () => {
  await startServer();
  console.log(`測試伺服器已啟動（獨立資料庫：${path.basename(DB_PATH)}）`);

  const uniq = Date.now();

  console.log('=== 1. 第一位註冊者成為管理員 ===');
  const a = await post('/api/auth/register', {
    email: `admin-${uniq}@example.com`, password: 'password123', name: '管理員',
  });
  ok(a.status === 200 && a.json.token, '管理員註冊成功', `id=${a.json.user && a.json.user.id}`);
  ok(a.json.user && a.json.user.is_admin === true, '第一位註冊者是管理員');
  const ADMIN = a.json.token;

  console.log('=== 2. 第二位註冊者是普通用戶 ===');
  const b = await post('/api/auth/register', {
    email: `user-${uniq}@example.com`, password: 'password123', name: '一般用戶',
  });
  ok(b.status === 200 && b.json.user.is_admin === false, '第二位註冊者非管理員');
  const USER = b.json.token;

  console.log('=== 3. 權限保護 ===');
  ok((await call('/api/admin/users', 'GET', null, USER)).status === 403, '普通用戶被拒（403）');
  ok((await call('/api/admin/users', 'GET', null, null)).status === 401, '未登入被拒（401）');

  console.log('=== 4. 管理員列出使用者 ===');
  const list = await call('/api/admin/users', 'GET', null, ADMIN);
  ok(list.status === 200, '取得使用者清單');
  const rows = list.json.items || [];
  ok(rows.length >= 2, `清單含 ${rows.length} 人`);
  ok(list.json.stats && list.json.stats.users >= 2, '統計資料正確', JSON.stringify(list.json.stats));
  ok(rows.some((r) => r.id === a.json.user.id && r.is_admin), '清單中管理員標記正確');

  console.log('=== 5. 設為管理員 / 取消 ===');
  const promote = await call(`/api/admin/users/${b.json.user.id}`, 'PATCH', { is_admin: true }, ADMIN);
  ok(promote.status === 200 && promote.json.user.is_admin === true, '已設為管理員');
  const demote = await call(`/api/admin/users/${b.json.user.id}`, 'PATCH', { is_admin: false }, ADMIN);
  ok(demote.status === 200 && promote.json.user.is_admin !== undefined && demote.json.user.is_admin === false, '已取消管理員');

  console.log('=== 6. 不能取消自己的管理員（至少保留一位） ===');
  const selfDemote = await call(`/api/admin/users/${a.json.user.id}`, 'PATCH', { is_admin: false }, ADMIN);
  ok(selfDemote.status === 400, '最後一位管理員不能取消自己', `status=${selfDemote.status}`);

  console.log('=== 7. 重設密碼（並強制重新登入） ===');
  const reset = await call(`/api/admin/users/${b.json.user.id}`, 'PATCH', { reset_password: 'newpassword456' }, ADMIN);
  ok(reset.status === 200, '重設密碼成功');
  ok((await post('/api/auth/login', { email: `user-${uniq}@example.com`, password: 'password123' })).status === 401, '舊密碼已失效');
  const newLogin = await post('/api/auth/login', { email: `user-${uniq}@example.com`, password: 'newpassword456' });
  ok(newLogin.status === 200, '新密碼可登入');

  console.log('=== 8. 刪除帳號（連同資料） ===');
  await call('/api/recipes', 'POST', {
    title: '將被刪除的食譜', description: '', category: '', servings: 2,
    ingredients: [{ name: '鹽', qty: 1, unit: '茶匙', group_name: '' }],
    steps: [{ title: '', body: '測試', t: null, tip: '' }],
  }, newLogin.json.token);
  const before = await call('/api/admin/users', 'GET', null, ADMIN);
  const target = (before.json.items || []).find((u) => u.email === `user-${uniq}@example.com`);
  ok(target && target.recipe_count === 1, '目標帳號有 1 份食譜', `count=${target && target.recipe_count}`);
  const del = await call(`/api/admin/users/${b.json.user.id}`, 'DELETE', null, ADMIN);
  ok(del.status === 200, '刪除帳號成功', JSON.stringify(del.json && del.json.deleted));
  ok(del.json && del.json.deleted && del.json.deleted.recipes === 1, '連同 1 份食譜刪除');
  const after = await call('/api/admin/users', 'GET', null, ADMIN);
  ok(!(after.json.items || []).some((u) => u.id === b.json.user.id), '清單中已移除');
  ok(after.json.stats.recipes === before.json.stats.recipes - 1, '食譜總數減少 1');

  console.log('=== 9. 不能刪除自己 ===');
  const selfDel = await call(`/api/admin/users/${a.json.user.id}`, 'DELETE', null, ADMIN);
  ok(selfDel.status === 400, '管理員不能刪除自己', `status=${selfDel.status}`);

  console.log(failed ? `\nADMIN TEST FAIL ❌（${failed} 項不符）` : '\nADMIN TEST PASS ✅');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error('ADMIN TEST FAIL ❌', e.message);
  process.exitCode = 1;
}).finally(() => {
  if (server) server.kill();
  try { fs.rmSync(DB_PATH, { force: true }); } catch { /* ignore */ }
  process.exit(process.exitCode || 0);
});
