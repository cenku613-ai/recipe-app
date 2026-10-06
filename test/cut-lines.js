/** 刪除檔案中的指定行範圍（保留 UTF-8 編碼） */
'use strict';
const fs = require('node:fs');
const [, , file, startStr, endStr] = process.argv;
const start = Number(startStr);
const end = Number(endStr);
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');
const before = lines.slice(0, start - 1);
const after = lines.slice(end);
fs.writeFileSync(file, [...before, ...after].join('\n'), 'utf8');
console.log(`已刪除第 ${start}-${end} 行，剩餘 ${before.length + after.length} 行`);
