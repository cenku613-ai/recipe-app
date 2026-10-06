/**
 * 食譜盒 · 種子資料 — 三份附影片的示範食譜
 * 執行：npm run seed（僅在資料庫沒有食譜時寫入）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'recipes.db'));
db.exec('PRAGMA foreign_keys = ON;');

/* 與 server.js 相同的結構（確保在 server 未啟動前也能建庫） */
db.exec(`
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '',
  video_url TEXT DEFAULT '',
  video_title TEXT DEFAULT '',
  cover TEXT DEFAULT '',
  servings INTEGER DEFAULT 2,
  prep_minutes INTEGER DEFAULT 0,
  cook_minutes INTEGER DEFAULT 0,
  difficulty TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  source TEXT DEFAULT '',
  favorite INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty REAL,
  unit TEXT DEFAULT '',
  group_name TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  in_list INTEGER DEFAULT 0,
  checked INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL,
  title TEXT DEFAULT '',
  body TEXT NOT NULL,
  t_start INTEGER,
  t_end INTEGER,
  tip TEXT DEFAULT ''
);
`);

const count = db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n;
if (count > 0) {
  console.log(`資料庫已有 ${count} 份食譜，略過種子資料。`);
  process.exit(0);
}

const recipes = [
  {
    title: '番茄炒蛋',
    description: '最家常也最討喜的一道菜：蛋要滑、番茄要香，酸甜汁濃拌飯一流。',
    category: '家常菜',
    video_url: 'https://www.youtube.com/watch?v=ksIYgS_K4ig',
    video_title: 'Ricky教室 經典家常菜 蕃茄炒蛋',
    source: 'Ricky教室',
    servings: 2,
    prep_minutes: 10,
    cook_minutes: 8,
    difficulty: '簡單',
    tags: ['快手菜', '下飯', '蛋料理'],
    notes: '番茄先切塊再下鍋，炒的時間不要太長，保留口感；蛋液炒至半熟就要盛出，回鍋才會嫩。',
    ingredients: [
      { group_name: '主料', name: '番茄', qty: 2, unit: '個' },
      { group_name: '主料', name: '雞蛋', qty: 4, unit: '隻' },
      { group_name: '配料', name: '蔥花', qty: 1, unit: '湯匙' },
      { group_name: '配料', name: '食用油', qty: 2, unit: '湯匙' },
      { group_name: '調味', name: '白砂糖', qty: 1, unit: '茶匙' },
      { group_name: '調味', name: '鹽', qty: 0.5, unit: '茶匙' },
      { group_name: '調味', name: '茄汁（番茄醬）', qty: 1, unit: '湯匙' },
      { group_name: '調味', name: '清水', qty: 2, unit: '湯匙' },
    ],
    steps: [
      { title: '備料', t: '00:30', body: '番茄洗淨，底部划十字用熱水汆燙去皮（懶人可直接切塊），去蒂切成小塊；蔥切成蔥花。', tip: '不去皮也可以，但去皮後茄汁更濃稠。' },
      { title: '打蛋', t: '01:10', body: '雞蛋打入碗中，加少許鹽打散至起泡，讓蛋更蓬鬆。', tip: '蛋液裡加 1 茶匙清水，炒出來更滑嫩。' },
      { title: '滑炒雞蛋', t: '01:40', body: '熱鍋下油，油溫升高後倒入蛋液，邊緣凝固時用鍋鏟快速推散，蛋半熟就盛出備用。', tip: '全熟再盛出，回鍋會變老。' },
      { title: '炒番茄', t: '02:30', body: '原鍋補少許油，放入番茄塊，中火翻炒至變軟出汁。', tip: '想快速出汁可加一小撮鹽。' },
      { title: '調味', t: '03:20', body: '加入糖、茄汁、鹽翻勻，再加 2 湯匙清水，煮 1 分鐘成濃稠的番茄汁。', tip: '糖能平衡番茄的酸，讓味道更有層次。' },
      { title: '合體', t: '04:10', body: '倒回炒蛋，輕輕翻勻 30 秒，讓蛋吸收番茄汁即可關火。', tip: '不要久炒，蛋保持嫩滑。' },
      { title: '上碟', t: '04:50', body: '撒上蔥花，盛碟即成。', tip: '' },
    ],
  },
  {
    title: '蒜香大蝦',
    description: '去蝦線、開背、裹粉煎香，再以蒜蓉爆炒，每步都清楚的宴客大菜。',
    category: '海鮮',
    video_url: 'https://www.youtube.com/watch?v=gGqEgswQiW8',
    video_title: '蒜香大蝦做法完整示範｜去蝦線、開背、裹地瓜粉，煎到金黃再翻炒',
    source: 'YouTube 美食教學',
    servings: 3,
    prep_minutes: 20,
    cook_minutes: 12,
    difficulty: '中等',
    tags: ['宴客', '下酒菜', '蝦料理'],
    notes: '蝦要徹底擦乾再裹粉，煎的時候才不會濺油；蒜蓉分兩次下，先爆香一半、起鍋前再放另一半，香氣更有層次。',
    ingredients: [
      { group_name: '主料', name: '大蝦（白蝦／劍蝦）', qty: 15, unit: '隻' },
      { group_name: '醃料', name: '料酒', qty: 1, unit: '湯匙' },
      { group_name: '醃料', name: '白胡椒粉', qty: 0.5, unit: '茶匙' },
      { group_name: '醃料', name: '鹽', qty: 0.5, unit: '茶匙' },
      { group_name: '配料', name: '蒜頭', qty: 10, unit: '瓣' },
      { group_name: '配料', name: '薑片', qty: 4, unit: '片' },
      { group_name: '配料', name: '蔥段', qty: 2, unit: '根' },
      { group_name: '配料', name: '小米椒（可省略）', qty: 1, unit: '根' },
      { group_name: '其他', name: '地瓜粉（或太白粉）', qty: 2, unit: '湯匙' },
      { group_name: '其他', name: '食用油', qty: 4, unit: '湯匙' },
      { group_name: '調味', name: '蠔油', qty: 1, unit: '湯匙' },
      { group_name: '調味', name: '糖', qty: 1, unit: '茶匙' },
    ],
    steps: [
      { title: '處理蝦', t: '00:40', body: '剪去蝦鬚，從背部剪開挑出蝦線，洗淨後用廚房紙徹底印乾水分。', tip: '水分不乾，下鍋會濺油且煎不香。' },
      { title: '醃蝦', t: '02:00', body: '加入料酒、白胡椒粉、鹽抓勻，醃 10 分鐘。', tip: '' },
      { title: '裹粉', t: '03:10', body: '醃好的蝦薄薄撲上一層地瓜粉，抖掉多餘粉。', tip: '薄粉即可，粉太厚會蓋過蝦味。' },
      { title: '煎蝦', t: '04:00', body: '熱鍋下油，放入蝦平鋪，中火煎至兩面金黃（約每面 2 分鐘），盛出。', tip: '不要急著翻面，定型後才不粘鍋。' },
      { title: '爆香', t: '06:20', body: '原鍋留底油，下一半蒜蓉、薑片、蔥段、小米椒小火炒香。', tip: '蒜蓉用小火，焦了會苦。' },
      { title: '回鍋調味', t: '07:40', body: '放回大蝦，加蠔油、糖快速翻炒 1 分鐘，讓蝦裹上醬汁。', tip: '' },
      { title: '加蒜收尾', t: '08:40', body: '熄火後撒入另一半蒜蓉拌勻，用餘溫逼出蒜香，裝盤。', tip: '最後的生蒜蓉是靈魂，別省。' },
    ],
  },
  {
    title: '黃金雞湯',
    description: '30 分鐘燉出濃郁金黃的雞湯，先煎後煮是關鍵，湯色奶金、雞肉不柴。',
    category: '湯品',
    video_url: 'https://www.youtube.com/watch?v=uGhfXQDvFN4',
    video_title: '這鍋湯真的只要30分鐘! 就可燉出3到4小時頂級濃雞湯的口感【黃金雞湯】',
    source: 'YouTube 湯品教學',
    servings: 4,
    prep_minutes: 15,
    cook_minutes: 35,
    difficulty: '中等',
    tags: ['湯水', '補身', '雞料理'],
    notes: '雞件先煎香再下水，湯才會金黃濃郁；水要一次加足，中途加水會沖淡味道。可用雞髀代替全雞。',
    ingredients: [
      { group_name: '主料', name: '雞件（雞髀／雞塊）', qty: 600, unit: '克' },
      { group_name: '主料', name: '清水或雞湯', qty: 1800, unit: '毫升' },
      { group_name: '配料', name: '薑', qty: 5, unit: '片' },
      { group_name: '配料', name: '蔥段', qty: 2, unit: '根' },
      { group_name: '配料', name: '蒜頭', qty: 6, unit: '瓣' },
      { group_name: '配料', name: '洋蔥', qty: 0.5, unit: '個' },
      { group_name: '醃料', name: '鹽', qty: 1, unit: '茶匙' },
      { group_name: '醃料', name: '白胡椒粉', qty: 0.5, unit: '茶匙' },
      { group_name: '醃料', name: '米酒', qty: 1, unit: '湯匙' },
      { group_name: '調味', name: '鹽（試味）', qty: 1, unit: '茶匙' },
      { group_name: '點綴', name: '枸杞', qty: 1, unit: '湯匙' },
      { group_name: '點綴', name: '香菜／蔥花', qty: 1, unit: '湯匙' },
    ],
    steps: [
      { title: '浸泡去血水', t: '00:50', body: '雞件沖洗乾淨，用清水浸 10 分鐘去除血水，再徹底印乾。', tip: '印乾才能煎出金黃色。' },
      { title: '醃雞', t: '02:30', body: '雞件用鹽、白胡椒粉、米酒抓勻，醃 10 分鐘。', tip: '' },
      { title: '煎香雞件', t: '04:00', body: '熱鍋下少許油，雞皮朝下中火煎至金黃，翻面再煎 1 分鐘。', tip: '這是湯色金黃的關鍵，不要跳過。' },
      { title: '炒香料頭', t: '06:30', body: '放入薑片、蒜頭、洋蔥、蔥段，與雞件一起炒香。', tip: '' },
      { title: '加水煮滾', t: '08:00', body: '倒入 1800 毫升清水（或雞湯），大火煮滾後撇去浮沫。', tip: '水一次加足，中途不加水。' },
      { title: '濃燉', t: '10:00', body: '轉中小火加蓋燉 25 分鐘，湯色會漸漸轉成金黃。', tip: '想要奶白色可轉中火滾煮。' },
      { title: '調味上桌', t: '36:00', body: '加鹽試味，撒上枸杞再煮 1 分鐘，盛碗後撒香菜或蔥花。', tip: '' },
    ],
  },
];

const insertRecipe = db.prepare(`
  INSERT INTO recipes (title, description, category, video_url, video_title, cover,
    servings, prep_minutes, cook_minutes, difficulty, tags, notes, source, favorite)
  VALUES (@title, @description, @category, @video_url, @video_title, '',
    @servings, @prep_minutes, @cook_minutes, @difficulty, @tags, @notes, @source, 0)`);
const insertIng = db.prepare(`
  INSERT INTO ingredients (recipe_id, name, qty, unit, group_name, sort, in_list, checked)
  VALUES (?, ?, ?, ?, ?, ?, 0, 0)`);
const insertStep = db.prepare(`
  INSERT INTO steps (recipe_id, sort, title, body, t_start, t_end, tip)
  VALUES (?, ?, ?, ?, ?, NULL, ?)`);

db.exec('BEGIN');
try {
  for (const r of recipes) {
    const fields = { ...r, tags: JSON.stringify(r.tags) };
    delete fields.ingredients;
    delete fields.steps;
    const id = Number(insertRecipe.run(fields).lastInsertRowid);
    r.ingredients.forEach((ing, i) =>
      insertIng.run(id, ing.name, ing.qty, ing.unit, ing.group_name, i));
    r.steps.forEach((st, i) =>
      insertStep.run(id, i, st.title, st.body, clockToSecs(st.t), st.tip));
  }
  db.exec('COMMIT');
  console.log(`已寫入 ${recipes.length} 份示範食譜。`);
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

function clockToSecs(text) {
  if (!text) return null;
  const parts = String(text).split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
