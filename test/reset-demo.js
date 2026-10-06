/**
 * 清理測試資料，把示範／使用者食譜歸回「未指派」，
 * 讓第一個真正註冊的使用者能認領它們。
 * 執行：node test/reset-demo.js
 */
'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.argv[2] || path.join(__dirname, '..', 'data', 'recipes.db'));
db.exec('PRAGMA foreign_keys = ON;');

const TEST_EMAIL_LIKE = [
  'smoke-%', 'iso-%', 'cdp-%', 'cdpai-%', 'cdppdf-%', 'dbg-%', 'admin-%', 'user-%',
];
const TEST_TITLE_LIKE = ['%測試%', '%煙霧%', 'AI 測試%'];

const users = db.prepare(
  `SELECT id, email FROM users WHERE ${TEST_EMAIL_LIKE.map(() => 'email LIKE ?').join(' OR ')}`
).all(...TEST_EMAIL_LIKE);
const ids = users.map((u) => u.id);

console.log(`測試帳號 ${ids.length} 個：${users.map((u) => u.email).join(', ').slice(0, 120)}`);

if (!ids.length) {
  console.log('沒有測試帳號，無需清理。');
  // 仍可能有未指派的食譜
  const n = db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id IS NULL').get().n;
  console.log(`未指派食譜：${n} 份（將由第一個註冊者認領）`);
  process.exit(0);
}

const ph = ids.map(() => '?').join(',');

// 1. 測試帳號名下、但不是「測試食譜」的 → 收回為未指派
const real = db.prepare(`
  UPDATE recipes SET user_id = NULL
  WHERE user_id IN (${ph}) AND ${TEST_TITLE_LIKE.map(() => 'title NOT LIKE ?').join(' AND ')}
`).run(...ids, ...TEST_TITLE_LIKE);
console.log(`收回 ${real.changes} 份真實食譜（改為未指派）`);

// 2. 對應食材也收回
db.prepare(`UPDATE ingredients SET user_id = NULL WHERE user_id IN (${ph})`).run(...ids);

// 3. 刪除測試食譜（連同步驟、食材）
const del = db.prepare(`
  DELETE FROM recipes WHERE user_id IN (${ph}) AND ${TEST_TITLE_LIKE.map(() => 'title LIKE ?').join(' OR ')}
`).run(...ids, ...TEST_TITLE_LIKE);
console.log(`刪除 ${del.changes} 份測試食譜`);

// 4. 刪除測試帳號（連同工作階段）
const gu = db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
console.log(`刪除 ${gu.changes} 個測試帳號`);

const left = db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id IS NULL').get().n;
console.log(`完成。未指派食譜 ${left} 份 → 將由第一個註冊的使用者認領。`);
