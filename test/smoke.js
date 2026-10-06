/**
 * 前端煙霧測試：以 jsdom 載入四支前端腳本，逐一走過所有畫面與互動。
 * 執行前請先啟動伺服器（npm start），再執行：node test/smoke.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://localhost:3777';
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => problems.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => problems.push(`console.error: ${a.join(' ')}`));
vc.on('warn', (...a) => problems.push(`console.warn: ${a.join(' ')}`));

const dom = new JSDOM(html, {
  url: BASE + '/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

/* 環境替身 */
window.scrollTo = () => {};
window.print = () => { window.__printed = true; };
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.fetch = (url, opts) => globalThis.fetch(new URL(url, BASE), opts);
window.html2canvas = undefined;
window.jspdf = undefined;

const ctx = dom.getInternalVMContext();
for (const f of ['core.js', 'views.js', 'form.js', 'main.js']) {
  const code = fs.readFileSync(path.join(root, 'public', 'js', f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}

const runnerCode = `
(async () => {
  const out = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fireClick = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const fireChange = (el) => el && el.dispatchEvent(new Event('change', { bubbles: true }));
  const TOK = () => localStorage.getItem('rbToken') || '';
  const call = async (p, opts = {}) => fetch(p, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + TOK() },
  });
  const jq = async (p, opts = {}) => (await call(p, opts)).json();

  // 0. 註冊獨立測試帳號（資料隔離），自建一份已知形狀的食譜
  const email = 'smoke-' + Date.now() + '@example.com';
  const reg = await jq('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: '煙霧測試' }),
  });
  if (!reg.token) throw new Error('註冊失敗: ' + JSON.stringify(reg));
  localStorage.setItem('rbToken', reg.token);
  localStorage.setItem('rbUser', JSON.stringify(reg.user));
  out.push('註冊 OK（' + email + '）');

  const mainRes = await jq('/api/recipes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '煙霧測試主食譜', description: '測試用食譜', category: '測試', servings: 2,
      ingredients: [
        { name: '番茄', qty: 2, unit: '個', group_name: '主料' },
        { name: '雞蛋', qty: 4, unit: '隻', group_name: '主料' },
        { name: '蔥花', qty: 1, unit: '湯匙', group_name: '配料' },
        { name: '食用油', qty: 2, unit: '湯匙', group_name: '配料' },
        { name: '白砂糖', qty: 1, unit: '茶匙', group_name: '調味' },
        { name: '鹽', qty: 0.5, unit: '茶匙', group_name: '調味' },
        { name: '茄汁', qty: 1, unit: '湯匙', group_name: '調味' },
        { name: '清水', qty: 2, unit: '湯匙', group_name: '調味' },
      ],
      steps: Array.from({ length: 7 }, (_, i) => ({ title: '', body: '測試步驟內容 ' + (i + 1), t: i * 30, tip: '' })),
    }),
  });
  const MAIN_ID = mainRes.recipe.id;
  out.push('建立主食譜 #' + MAIN_ID);

  // 0b. 清空清單，確保狀態一致
  await call('/api/shopping?clear=all', { method: 'DELETE' });

  // 1. 首頁
  let apiProbe = '';
  try {
    const d = await api('/api/recipes');
    apiProbe = 'api() OK count=' + (d.items || []).length;
  } catch (e) {
    apiProbe = 'api() 失敗: ' + e.message + ' / coreToken=' + (typeof authToken === 'function' ? (authToken() ? '有' : '無') : '無函式') + ' / lsToken=' + (localStorage.getItem('rbToken') ? '有' : '無');
  }
  await renderHome();
  out.push('首頁卡片=' + $$('.card').length + ' 分類chip=' + $$('#catChips .chip').length);
  if ($$('.card').length < 1) {
    throw new Error('首頁卡片數不對｜' + apiProbe + '｜grid=' +
      ($('#recipeGrid') ? $('#recipeGrid').innerHTML.slice(0, 160) : 'none'));
  }

  // 2. 搜尋
  homeFilters.q = '煙霧';
  await loadRecipeGrid();
  out.push('搜尋結果=' + $$('.card').length);
  if ($$('.card').length !== 1) throw new Error('搜尋結果數不對（應為 1）');
  homeFilters.q = '';
  await loadRecipeGrid();

  // 3. 食譜詳情
  await renderRecipe(MAIN_ID);
  out.push('詳情 步驟=' + $$('.step').length + ' 食材=' + $$('.ing').length + ' 影片=' + !!$('#mainVideo'));
  if ($$('.step').length !== 7) throw new Error('步驟數不符預期（應為 7）');
  if ($$('.ing').length !== 8) throw new Error('食材數不符預期（應為 8）');

  // 4. 份量換算
  fireClick($('[data-action="serv"][data-delta="1"]'));
  const servNum = $('.serv-num').textContent;
  out.push('份量+1 → ' + servNum);
  if (!/3\\s*人份/.test(servNum)) throw new Error('份量換算失敗: ' + servNum);
  const qty = $$('.ing-qty')[0].textContent;
  out.push('換算後第一項食材量=' + qty.trim());

  // 5. 全部加入採購清單
  fireClick($('[data-action="toggle-all-list"]'));
  await wait(500);
  const shop = await jq('/api/shopping');
  out.push('加入清單後項目=' + shop.total);
  if (shop.total !== 8) throw new Error('採購清單項目數不符: ' + shop.total);
  const stat = $('.panel-cta .muted').textContent;
  if (!stat.includes('8/8')) throw new Error('面板統計未更新: ' + stat);

  // 6. 再按一次＝全部移出
  fireClick($('[data-action="toggle-all-list"]'));
  await wait(500);
  const shopOut = await jq('/api/shopping');
  out.push('全部移出後項目=' + shopOut.total);
  if (shopOut.total !== 0) throw new Error('全部移出失敗');
  // 再加回來，供後續採購頁測試
  fireClick($('[data-action="toggle-all-list"]'));
  await wait(500);

  // 7. 時間碼跳轉（有影片 iframe）
  fireClick($('[data-action="seek"]'));
  out.push('seek OK（無例外）');

  // 8. 烹調模式
  fireClick($('[data-action="cook-mode"]'));
  if (!$('.cook-panel')) throw new Error('烹調模式未開啟');
  fireClick($('[data-cook="next"]'));
  out.push('烹調模式 第' + $('#cookNow').textContent + '步');
  if ($('#cookNow').textContent !== '2') throw new Error('烹調模式下一步失敗');
  fireClick($('[data-cook="close"]'));
  if ($('.cook-panel')) throw new Error('烹調模式未關閉');

  // 9. 單一食材加入清單
  const box = $$('.ing input[data-action="ing-list"]')[0];
  box.checked = false;
  fireChange(box);
  await wait(400);
  const s2 = await jq('/api/shopping');
  out.push('單項勾選後清單=' + s2.total);
  if (s2.total !== 7) throw new Error('單項加入清單失敗: ' + s2.total);

  // 10. PDF 版面 + 列印
  buildPdfSheet(state.recipe);
  const sheetLen = $('#pdf-sheet').innerHTML.length;
  out.push('PDF 版面長度=' + sheetLen);
  if (sheetLen < 800) throw new Error('PDF 版面內容過少');
  window.__printed = false;
  fireClick($('[data-action="print-pdf"]'));
  await wait(150);
  if (!window.__printed) throw new Error('window.print 未被呼叫');
  out.push('列印 OK');

  // 11. 下載 PDF（無 jsPDF 元件時應優雅降級為列印）
  window.__printed = false;
  await downloadPdf(state.recipe);
  await wait(150);
  if (!window.__printed) throw new Error('下載 PDF 未降級為列印');
  out.push('下載 PDF 降級路徑 OK');

  // 12. 編輯表單
  await renderForm(MAIN_ID);
  out.push('編輯表單 食材列=' + $$('.ing-row').length + ' 步驟列=' + $$('.step-row').length);
  if ($$('.ing-row').length !== 8) throw new Error('編輯表單食材列不符');
  fireClick($('[data-form="add-ing"]'));
  fireClick($('[data-form="add-step"]'));
  if ($$('.ing-row').length !== 9 || $$('.step-row').length !== 8) throw new Error('新增列失敗');
  out.push('表單增列 OK');

  // 13. 新增食譜
  await renderForm(null);
  const form = $('#recipeForm');
  form.elements.namedItem('title').value = '煙霧測試食譜';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(700);
  const created = await jq('/api/recipes?q=' + encodeURIComponent('煙霧測試食譜'));
  out.push('建立結果=' + created.items.length);
  if (created.items.length !== 1) throw new Error('建立食譜失敗：搜到 ' + created.items.length + ' 份');
  await call('/api/recipes/' + created.items[0].id, { method: 'DELETE' });
  out.push('建立＋刪除 OK');

  // 13b. AI 結果併入草稿（模擬 LLM 回應）
  await renderForm(null);
  const aiRes = {
    title: 'AI 測試食譜', servings: 3,
    ingredients: [
      { name: '蠔仔', qty: 500, unit: 'g', group_name: '主料' },
      { name: '蛋', qty: 2, unit: '個', group_name: '' },
    ],
    steps: [{ title: '洗蠔', body: '用粗鹽抓洗蠔仔', t: 30, tip: '洗到無腥味' }],
  };
  const merged = applyAiResult(aiRes);
  if (merged.ni !== 2 || merged.ns !== 1) throw new Error('AI 結果併入失敗: ' + JSON.stringify(merged));
  if (!draft.ingredients.some((i) => i.name === '蠔仔' && i.qty === 500)) throw new Error('AI 食材沒進草稿: ' + JSON.stringify(draft.ingredients));
  const aiStep = draft.steps.find((s) => (s.body || '').indexOf('抓洗') >= 0);
  if (!aiStep || aiStep.t !== '00:30') throw new Error('AI 步驟時間碼沒轉成 mm:ss: ' + JSON.stringify(aiStep));
  if (draft.title !== 'AI 測試食譜') throw new Error('AI 標題沒填入');
  out.push('AI 結果併入 OK（食材 ' + merged.ni + '、步驟 ' + merged.ns + '、時間 ' + aiStep.t + '）');

  // 13c. 字幕稿書籤小工具
  const href = bookmarkletHref();
  if (href.indexOf('javascript:') !== 0) throw new Error('書籤連結格式錯誤');
  if (href.length < 200) throw new Error('書籤程式碼太短');
  if (href.indexOf('transcript-segment') < 0) throw new Error('書籤沒含字幕段落選擇器');
  out.push('書籤小工具 OK（' + href.length + ' 字元）');

  // 14. 採購清單頁
  await renderShopping();
  out.push('採購頁項目=' + $$('.shop-item').length);
  const firstBox = $('[data-action="shop-toggle"]');
  if (!firstBox) throw new Error('採購頁無項目');
  firstBox.checked = true;
  fireChange(firstBox);
  await wait(500);
  out.push('勾選已購買 OK');

  // 15. 自訂項目
  $('#shopName').value = '測試自訂品項';
  $('#shopAddForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(500);
  const s3 = await jq('/api/shopping');
  if (!s3.items.some((i) => i.name === '測試自訂品項')) throw new Error('自訂項目加入失敗');
  out.push('自訂項目 OK');

  // 16. 移除單項
  const delId = s3.items.find((i) => i.name === '測試自訂品項').id;
  await call('/api/shopping/' + delId, { method: 'DELETE' });

  // 17. 清空清單（還原測試資料）
  await call('/api/shopping?clear=all', { method: 'DELETE' });
  const s4 = await jq('/api/shopping');
  if (s4.total !== 0) throw new Error('清空失敗');
  out.push('清空清單 OK');

  // 18. 路由巡覽
  for (const h of ['#/', '#/fav', '#/shopping', '#/new', '#/recipe/2', '#/edit/2']) {
    location.hash = h;
    await wait(400);
    if (!document.querySelector('#view').innerHTML.trim()) throw new Error('路由未渲染: ' + h);
  }
  out.push('全部路由 OK');

  // 19. 資料隔離：另一個帳號看不到第一個帳號的食譜
  const reg2 = await (await fetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'iso-' + Date.now() + '@example.com', password: 'password123', name: '第二帳號' }),
  })).json();
  if (!reg2.token) throw new Error('第二帳號註冊失敗');
  const list2 = await (await fetch('/api/recipes', {
    headers: { Authorization: 'Bearer ' + reg2.token },
  })).json();
  if (list2.items.length !== 0) {
    throw new Error('資料隔離失敗：第二帳號看得到 ' + list2.items.length + ' 份食譜');
  }
  // 第二帳號也讀不到第一個帳號的食譜明細
  const detail2 = await (await fetch('/api/recipes/' + MAIN_ID, {
    headers: { Authorization: 'Bearer ' + reg2.token },
  })).json();
  if (detail2.ok) throw new Error('資料隔離失敗：第二帳號能讀別人的食譜');
  out.push('資料隔離 OK（第二帳號 0 份、無法讀取他人食譜）');
  localStorage.setItem('rbToken', reg.token);
  localStorage.setItem('rbUser', JSON.stringify(reg.user));

  // 19. 文字解析（說明／文字稿 → 步驟、食材）
  const stepSample = [
    '00:30 先把番茄洗淨切塊',
    '01:10 雞蛋打散加鹽',
    '02:00 熱鍋下油炒蛋',
    '',
    '這段是廣告文字不算',
  ].join('\\n');
  const parsedSteps = parseStepsFromText(stepSample);
  if (parsedSteps.length < 3) throw new Error('時間碼解析失敗: ' + JSON.stringify(parsedSteps));
  if (parsedSteps[0].t !== 30 || parsedSteps[1].t !== 70) throw new Error('時間碼秒數不對: ' + parsedSteps.map(s=>s.t));
  out.push('時間碼→步驟 OK（' + parsedSteps.length + ' 步）');

  const numbered = '1. 番茄切塊\\n2. 蛋液炒半熟\\n3. 合炒調味';
  const p2 = parseStepsFromText(numbered);
  if (p2.length !== 3) throw new Error('編號解析失敗');
  out.push('編號→步驟 OK');

  const ingSample = ['番茄 2 個', '雞蛋 4 隻', '鹽 0.5 茶匙', '蔥 適量', 'https://example.com', '先把番茄洗乾淨切成小塊備用'];
  const p3 = parseIngredientsFromText(ingSample.join('\\n'));
  const names = p3.map((i) => i.name);
  if (!names.includes('番茄') || !names.includes('雞蛋')) throw new Error('食材解析失敗: ' + JSON.stringify(p3));
  if (names.some((n) => n.includes('https'))) throw new Error('URL 不該被當成食材');
  if (p3.find((i) => i.name === '番茄').qty !== 2) throw new Error('數量解析失敗');
  out.push('文字→食材 OK（' + p3.length + ' 種）：' + names.join('、'));

  // 19b. 真實影片說明（港式煎蠔餅）：段落感知解析，器材／連結段要被過濾
  const descSample = [
    '港式煎蠔餅/簡單 家做/大牌檔味道/洗蠔仔竅門/新手 入門/粵語/中字/p95',
    '',
    'recipe',
    '500g 蠔仔/baby oyster',
    '2 egg /蛋',
    '80g spring onion/青蔥',
    '30g coriander/元茜',
    '75g cake flour/低筋粉',
    '75g cassava flour/木薯粉',
    '180g water/水',
    'white pepper power 白胡椒粉',
    'fish sauce 魚露',
    '',
    '我的fb主頁',
    'https://www.facebook.com/kerrykitchenbee',
    '',
    'Equipment',
    'AMD RYZEN 3 2200G',
    'NOKIA 7.2',
    'Adobe Audition',
  ].join('\\n');
  const dIngs = parseIngredientsFromText(descSample);
  const dNames = dIngs.map((i) => i.name);
  const oyster = dIngs.find((i) => i.name.indexOf('蠔仔') >= 0);
  if (!oyster || oyster.qty !== 500 || oyster.unit !== 'g') throw new Error('500g 蠔仔 解析失敗: ' + JSON.stringify(oyster));
  if (!dNames.some((n) => n.indexOf('魚露') >= 0) || !dNames.some((n) => n.indexOf('白胡椒粉') >= 0)) throw new Error('無數量食材解析失敗: ' + JSON.stringify(dNames));
  if (dNames.some((n) => /NOKIA|AMD|Adobe|facebook|Equipment/i.test(n))) throw new Error('器材／連結段沒被過濾: ' + JSON.stringify(dNames));
  // 名稱正規化：中英混雜應只留中文、不該殘留 '/' 或英文單字
  const expectClean = ['蠔仔', '蛋', '青蔥', '元茜', '低筋粉', '木薯粉', '水', '白胡椒粉', '魚露'];
  for (const want of expectClean) {
    if (!dNames.includes(want)) throw new Error('名稱沒正規化成「' + want + '」，實際=' + JSON.stringify(dNames));
  }
  if (dNames.some((n) => /[\/]/.test(n))) throw new Error('名稱殘留斜線: ' + JSON.stringify(dNames));
  if (dNames.some((n) => /[a-z]{3,}/.test(n))) throw new Error('名稱殘留英文單字: ' + JSON.stringify(dNames));
  const dSteps = parseStepsFromText(descSample);
  if (dSteps.length !== 0) throw new Error('不該把標題／連結當步驟: ' + JSON.stringify(dSteps.map((s) => s.body)));
  out.push('真實說明解析 OK（食材 ' + dIngs.length + ' 種、步驟 ' + dSteps.length + '）：' + dNames.join('、'));

  // 19c. 標題行與 hashtag 段落不該變成步驟
  const noisyTitle = 'Ricky教室 經典家常菜 蕃茄炒蛋 做法超簡單 Fail-proof scrambled egg with cherry tomatoes';
  const noisy = [
    noisyTitle,
    '',
    '蕃茄炒蛋 scrambled egg with cherry tomatoes',
    '',
    '#Ricky講煮講食 #香港名廚 #名廚 #張錦祥',
  ].join('\\n');
  const nSteps = parseStepsFromText(noisy, { title: noisyTitle });
  if (nSteps.length !== 0) throw new Error('標題／hashtag 段不該變成步驟: ' + JSON.stringify(nSteps.map((s) => s.body)));
  out.push('標題／hashtag 過濾 OK');

  // 19d. 字幕式文字稿（短行、無標點）→ 一行一步驟
  const captionSample = [
    '蠔餅最重要係洗蠔仔',
    '用粗鹽輕輕抓洗去腥',
    '倒走黑水再沖乾淨',
    '雞蛋打散落少少胡椒粉',
    '落蠔仔同葱段撈勻',
    '熱鑊落油攤平半煎半炸',
    '煎到金黃反面再煎一分鐘',
    '上碟即成',
  ].join('\\n');
  const capSteps = parseTranscriptSteps(captionSample);
  if (capSteps.length !== 8) throw new Error('字幕行解析失敗: ' + capSteps.length + ' → ' + JSON.stringify(capSteps.map((s) => s.body)));
  out.push('字幕文字稿→步驟 OK（' + capSteps.length + ' 步）');

  // 19e. 從旁白敘述中撈食材（影片沒有說明欄時）
  const narr = 'melt 2 tablespoons butter and 1 tablespoon flour, add 1 cup whole milk and half a cup heavy cream, cook a box of elbow macaroni, top with 2 cups Gruyère cheese';
  const nIngs = parseIngredientsFromNarration(narr);
  const nNames = nIngs.map((i) => i.name);
  for (const want of ['butter', 'flour', 'whole milk', 'heavy cream', 'elbow macaroni', 'Gruyère cheese']) {
    if (!nNames.includes(want)) throw new Error('敘述食材解析缺「' + want + '」: ' + JSON.stringify(nNames));
  }
  const cream = nIngs.find((i) => i.name === 'heavy cream');
  if (!cream || cream.qty !== 0.5) throw new Error('half a cup 沒轉成 0.5: ' + JSON.stringify(cream));
  const mac = nIngs.find((i) => i.name === 'elbow macaroni');
  if (!mac || mac.unit !== 'box') throw new Error('a box of 沒轉成 box: ' + JSON.stringify(mac));
  out.push('旁敘→食材 OK（' + nIngs.length + ' 種）：' + nNames.join('、'));

  // 20. 影片內容擷取 API（說明文字／章節／字幕有無）
  try {
    const c = await jq('/api/video-content?url=' + encodeURIComponent('https://www.youtube.com/watch?v=ksIYgS_K4ig'));
    out.push('video-content: descLen=' + (c.description || '').length + ' title=' + (c.title || '?') + ' captions=' + c.hasCaptions);
    if (!c.description) throw new Error('video-content 沒有回傳說明文字');
    if (!c.title) throw new Error('video-content 沒有回傳標題');
    const stepsFromDesc = parseStepsFromText(c.description);
    const ingsFromDesc = parseIngredientsFromText(c.description);
    out.push('說明→步驟=' + stepsFromDesc.length + ' 說明→食材=' + ingsFromDesc.length);
  } catch (e) {
    if (/fetch|network/i.test(e.message)) out.push('video-content 略過（無網路）: ' + e.message);
    else throw e;
  }

  // 21b. 語系自動挑選（避免抓到阿拉伯文等錯誤語言）
  if (detectTextLang('Worlds Best Mac And Cheese recipe I have ever tasted') !== 'en') throw new Error('英文偵測失敗');
  if (detectTextLang('港式煎蠔餅 簡單 家做 大牌檔味道') !== 'zh') throw new Error('中文偵測失敗');
  out.push('語系偵測 OK（en / zh）');

  // 21c. 英文影片應挑到英文字幕（不是清單第一個的阿拉伯文）
  try {
    const en = await jq('/api/video-steps?url=' + encodeURIComponent('https://www.youtube.com/watch?v=UrftcQIbHoY') + '&hintText=' + encodeURIComponent('Worlds Best Mac And Cheese recipe'));
    out.push('英文影片字幕語言=' + en.language + ' 段=' + (en.segments || []).length + ' 步=' + (en.steps || []).length);
    if (en.language !== 'en') throw new Error('語系挑選錯誤（應為 en）：' + en.language);
    if (!/mac|cheese|pasta|butter|flour|macaroni/i.test((en.segments || []).map((s) => s.text).join(' '))) {
      throw new Error('英文字幕內容看起來不是英文');
    }
  } catch (e) {
    if (/fetch|network/i.test(e.message)) out.push('語系測試略過（無網路）: ' + e.message);
    else throw e;
  }
  try {
    const tr = await jq('/api/video-steps?url=' + encodeURIComponent('https://www.youtube.com/watch?v=msLskDp5pG0'));
    out.push('video-steps: seg=' + (tr.segments || []).length + ' steps=' + (tr.steps || []).length);
    if (!tr.segments || tr.segments.length < 10) throw new Error('字幕段落太少');
    if (!tr.steps || tr.steps.length < 3) throw new Error('步驟太少');
    if (!tr.steps.every((s) => typeof s.body === 'string' && s.body.length > 0)) throw new Error('步驟有空內容');
    if (!tr.steps.some((s) => s.t !== null && s.t !== undefined)) throw new Error('步驟沒有時間碼');
  } catch (e) {
    if (/fetch|network/i.test(e.message)) out.push('video-steps 略過（無網路）: ' + e.message);
    else throw e;
  }

  return out;
})()
`;

const runner = vm.runInContext(runnerCode, ctx, { filename: 'smoke-runner.js' });

runner
  .then((lines) => {
    console.log(lines.join('\\n'));
    if (problems.length) {
      console.log('\n[console 問題]');
      problems.forEach((p) => console.log('  ' + p));
      process.exit(1);
    }
    console.log('\nSMOKE TEST PASS ✅');
    process.exit(0);
  })
  .catch((e) => {
    console.error('SMOKE TEST FAIL ❌');
    console.error(e.stack || e.message);
    if (problems.length) {
      console.log('[console 問題]');
      problems.forEach((p) => console.log('  ' + p));
    }
    process.exit(1);
  });
