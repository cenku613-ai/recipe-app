/**
 * 還原被 PowerShell 以 CP1252（ANSI）讀取、再以 UTF-8 寫回的檔案。
 * 還原方式：UTF-8 解出 mojibake 字串 → 依 CP1252 表編回原始位元組 → UTF-8 解碼。
 */
'use strict';
const fs = require('node:fs');

const CP1252_REV = new Map(Object.entries({
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
}));

function reverse(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) out.push(cp);
    else if (CP1252_REV.has(ch)) out.push(CP1252_REV.get(ch));
    else return null; // 無法還原的字元
  }
  return Buffer.from(out);
}

const p = process.argv[2];
if (!p) { console.error('用法: node fix-encoding.js <file>'); process.exit(1); }
const mojibake = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const bytes = reverse(mojibake);
if (!bytes) { console.error('還原失敗：含有無法對應的字元'); process.exit(1); }
const original = bytes.toString('utf8');
if ((original.match(/�/g) || []).length) { console.error('還原失敗：UTF-8 解碼出現 replacement char'); process.exit(1); }
fs.writeFileSync(p, original, { encoding: 'utf8' });
const head = original.split('\n').slice(0, 3).join(' | ');
console.log('還原完成:', original.length, 'chars');
console.log('開頭:', head);
