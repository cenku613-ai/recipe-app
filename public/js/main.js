/**
 * 食譜盒 · main — 路由、全域互動、PDF 匯出
 */
'use strict';

/* ================================================================== */
/* 路由                                                                */
/* ================================================================== */

function parseRoute() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  const [a, b] = parts;
  if (a === 'fav') return { name: 'fav' };
  if (a === 'shopping') return { name: 'shopping' };
  if (a === 'new') return { name: 'new' };
  if (a === 'login') return { name: 'login' };
  if (a === 'register') return { name: 'register' };
  if (a === 'account') return { name: 'account' };
  if (a === 'admin') return { name: 'admin' };
  if (a === 'recipe' && b) return { name: 'recipe', id: Number(b) };
  if (a === 'edit' && b) return { name: 'edit', id: Number(b) };
  return { name: 'home' };
}

function updateNav(route) {
  const key = route.name === 'fav' ? 'fav'
    : route.name === 'shopping' ? 'shopping'
    : route.name === 'new' ? 'new'
    : (route.name === 'account' || route.name === 'login' || route.name === 'register') ? 'account'
    : 'home';
  $$('[data-nav]').forEach((el) => el.classList.toggle('is-active', el.dataset.nav === key));
}

let lastRouteKey = '';

async function route() {
  const r = parseRoute();
  state.route = r;
  updateNav(r);

  // 認證守衛：未登入只能看登入／註冊頁
  const authPages = ['login', 'register'];
  if (!currentUser() && !authPages.includes(r.name)) {
    location.hash = '#/login';
    return;
  }
  if (currentUser() && authPages.includes(r.name)) {
    location.hash = '#/';
    return;
  }

  const key = JSON.stringify(r);
  if (key !== lastRouteKey) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  lastRouteKey = key;

  try {
    switch (r.name) {
      case 'home': await renderHome(); break;
      case 'fav': await renderHome({ fav: true }); break;
      case 'shopping': await renderShopping(); break;
      case 'new': await renderForm(null); break;
      case 'edit': await renderForm(r.id); break;
      case 'login': renderAuth('login'); break;
      case 'register': renderAuth('register'); break;
      case 'account': renderAccount(); break;
      case 'admin': await renderAdmin(); break;
      case 'recipe':
        await renderRecipe(r.id);
        if (state.recipe) buildPdfSheet(state.recipe); // 預先組好列印／PDF 版面
        break;
      default: await renderHome();
    }
  } catch (e) {
    $('#view').innerHTML = errorHtml(e.message);
  }
  refreshShoppingBadge();
  refreshFooterStats();
}

/* ================================================================== */
/* 全域互動（事件委派）                                                 */
/* ================================================================== */

document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id);

  switch (action) {
    case 'new-recipe':
      location.hash = '#/new';
      break;

    case 'goto-login':
      location.hash = '#/login';
      break;

    case 'logout': {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
      setAuth('', null);
      toast('已登出');
      location.hash = '#/login';
      break;
    }

    case 'open-settings':
      e.preventDefault();
      openAiSettings();
      break;

    case 'open-recipe':
      location.hash = `#/recipe/${id}`;
      break;

    case 'edit-recipe':
      location.hash = `#/edit/${id}`;
      break;

    case 'reload':
      route();
      break;

    case 'clear-filter':
      homeFilters.q = '';
      homeFilters.category = '';
      renderHome({ fav: homeFilters.fav });
      break;

    case 'cat': {
      homeFilters.category = target.dataset.cat || '';
      $$('#catChips .chip').forEach((c) =>
        c.classList.toggle('is-active', (c.dataset.cat || '') === homeFilters.category));
      loadRecipeGrid();
      break;
    }

    case 'toggle-fav':
    case 'toggle-fav-detail': {
      e.stopPropagation();
      const nowFav = target.dataset.fav !== '1';
      try {
        await api(`/api/recipes/${id}`, { method: 'PATCH', body: { favorite: nowFav } });
        toast(nowFav ? '已加入收藏 ⭐' : '已取消收藏');
        route();
      } catch (err) { toast(err.message, 'err'); }
      break;
    }

    case 'serv': {
      const delta = Number(target.dataset.delta) || 0;
      const base = Number(state.recipe?.servings) || 2;
      let factor = state.listFactor + (delta * 0.5) / base;
      factor = Math.min(6, Math.max(0.5, factor));
      state.listFactor = factor;
      $('#view').innerHTML = detailHtml(state.recipe);
      break;
    }

    case 'toggle-all-list': {
      // data-in = 按下後的目標狀態（1＝全部加入、0＝全部移出）
      const targetIn = target.dataset.in === '1';
      try {
        await api(`/api/shopping/recipe/${id}`, { method: 'POST', body: { in_list: targetIn } });
        toast(targetIn ? '已加入採購清單 🛒' : '已移出採購清單');
        refreshShoppingBadge();
        // 先更新本機狀態，再重新繪製
        state.recipe.ingredients.forEach((i) => {
          i.in_list = targetIn ? 1 : 0;
          if (targetIn) i.checked = 0;
        });
        $('#view').innerHTML = detailHtml(state.recipe);
      } catch (err) { toast(err.message, 'err'); }
      break;
    }

    case 'seek': {
      const t = Number(target.dataset.t);
      const frame = $('#mainVideo') || $('#cookVideo');
      if (frame) { seekVideo(frame, t); toast(`跳到 ${secsToClock(t)}`); }
      else toast('這份食譜未連結影片', 'err');
      break;
    }

    case 'cook-mode':
      if (state.recipe && state.recipe.steps.length) openCookMode(state.recipe);
      break;

    case 'delete-recipe': {
      const ok = await confirmDialog('確定要刪除這份食譜嗎？（食材與步驟會一併刪除）',
        { okText: '刪除', danger: true });
      if (!ok) break;
      try {
        await api(`/api/recipes/${id}`, { method: 'DELETE' });
        toast('已刪除食譜');
        location.hash = '#/';
        route();
      } catch (err) { toast(err.message, 'err'); }
      break;
    }

    case 'print-pdf':
      if (state.recipe) { buildPdfSheet(state.recipe); window.print(); }
      break;

    case 'download-pdf':
      if (state.recipe) downloadPdf(state.recipe);
      break;

    /* ---- 採購清單 ---- */
    case 'shop-remove': {
      try {
        await api(`/api/shopping/${id}`, { method: 'DELETE' });
        const y = window.scrollY;
        await renderShopping();
        window.scrollTo(0, y);
        refreshShoppingBadge();
      } catch (err) { toast(err.message, 'err'); }
      break;
    }

    case 'shop-clear-checked': {
      const ok = await confirmDialog('清除已購買的項目？（食譜中的食材會保留）', { okText: '清除' });
      if (!ok) break;
      await api('/api/shopping?clear=checked', { method: 'DELETE' });
      toast('已清除已購買項目');
      renderShopping();
      refreshShoppingBadge();
      break;
    }

    case 'shop-clear-all': {
      const ok = await confirmDialog('清空整個採購清單？', { okText: '清空', danger: true });
      if (!ok) break;
      await api('/api/shopping?clear=all', { method: 'DELETE' });
      toast('清單已清空');
      renderShopping();
      refreshShoppingBadge();
      break;
    }
  }
});

/* 勾選類互動 */
document.addEventListener('change', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id);

  if (action === 'ing-list') {
    const li = target.closest('.ing');
    li?.classList.toggle('in-list', target.checked);
    try {
      await api(`/api/shopping/${id}`, { method: 'PATCH', body: { in_list: target.checked } });
      refreshShoppingBadge();
      // 更新面板上的統計
      const r = state.recipe;
      if (r) {
        const ing = r.ingredients.find((i) => i.id === id);
        if (ing) ing.in_list = target.checked ? 1 : 0;
        const count = r.ingredients.filter((i) => i.in_list).length;
        const label = $('.panel-cta .muted');
        if (label) label.textContent = `${count}/${r.ingredients.length} 已加入`;
        const allBtn = $('[data-action="toggle-all-list"]');
        if (allBtn && count === r.ingredients.length && r.ingredients.length > 0) route();
      }
    } catch (err) {
      toast(err.message, 'err');
      target.checked = !target.checked;
    }
  }

  if (action === 'shop-toggle') {
    try {
      await api(`/api/shopping/${id}`, { method: 'PATCH', body: { checked: target.checked } });
      target.closest('.shop-item')?.classList.toggle('is-checked', target.checked);
      const y = window.scrollY;
      await renderShopping();
      window.scrollTo(0, y);
      refreshShoppingBadge();
    } catch (err) { toast(err.message, 'err'); }
  }
});

/* 卡片鍵盤操作 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest?.('[data-action="open-recipe"]');
  if (card) { e.preventDefault(); location.hash = `#/recipe/${card.dataset.id}`; }
});

/* ================================================================== */
/* PDF 匯出                                                            */
/* ================================================================== */

function printRecipePdf(recipe) {
  buildPdfSheet(recipe);
  window.print();
}

window.addEventListener('beforeprint', () => {
  if (state.recipe && !$('#pdf-sheet').innerHTML.trim()) buildPdfSheet(state.recipe);
});

async function downloadPdf(recipe) {
  if (typeof html2canvas !== 'function' || !window.jspdf) {
    toast('PDF 元件未載入，改用「列印／另存 PDF」', 'err');
    return printRecipePdf(recipe);
  }
  buildPdfSheet(recipe);
  const sheet = $('#pdf-sheet');
  toast('正在產生 PDF…', 'info');
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = await html2canvas(sheet, {
      scale: Math.min(2, window.devicePixelRatio > 1 ? 2 : 1.6),
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: sheet.scrollWidth,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = 210;
    const pageH = 297;
    const pagePxH = Math.floor((canvas.width * pageH) / pageW);

    let page = 0;
    for (let y = 0; y < canvas.height; y += pagePxH) {
      const sliceH = Math.min(pagePxH, canvas.height - y);
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = pagePxH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if (page > 0) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH);
      page += 1;
    }

    const safe = (recipe.title || '食譜').replace(/[\\/:*?"<>|]/g, '_');
    pdf.save(`${safe}.pdf`);
    toast('PDF 已下載 ⬇');
  } catch (err) {
    console.error(err);
    toast('轉檔失敗，改用列印視窗', 'err');
    printRecipePdf(recipe);
  }
}

/* ================================================================== */
/* 啟動                                                                */
/* ================================================================== */

function boot() {
  window.addEventListener('hashchange', route);
  updateAuthUi();
  route();
}

boot();
