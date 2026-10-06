/** 指定某個 Email 為管理員：node test/set-admin.js <email> */
'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[3] || path.join(__dirname, '..', 'data', 'recipes.db'));
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('用法: node test/set-admin.js <email>'); process.exit(1); }
const r = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
console.log(r.changes ? `✅ 已設為管理員：${email}` : `找不到帳號：${email}`);
