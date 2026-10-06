/** 檢查資料庫中食譜的歸屬 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2] || 'data/recipes.db');

console.log('--- 食譜歸屬 ---');
for (const r of db.prepare('SELECT user_id, COUNT(*) AS n FROM recipes GROUP BY user_id').all()) {
  const titles = db.prepare('SELECT title FROM recipes WHERE user_id IS ? LIMIT 6').all(r.user_id)
    .map((x) => x.title).join(' | ');
  console.log(`user_id=${r.user_id} count=${r.n} → ${titles.slice(0, 130)}`);
}
console.log('--- 使用者 ---');
for (const u of db.prepare('SELECT id, email, name FROM users').all()) {
  console.log(`#${u.id} ${u.email} (${u.name})`);
}
