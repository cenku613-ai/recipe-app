/**
 * 食譜盒 · views — 首頁、食譜詳情、採購清單、PDF 版面
 */
'use strict';

/* ================================================================== */
/* 共用片段                                                            */
/* ================================================================== */

function loadingHtml(msg = '載入中…') {
  return `<div class="loading"><span class="spinner" aria-hidden="true"></span>${esc(msg)}</div>`;
}

function errorHtml(message) {
  return `<div class="empty">
    <div class="empty-icon" aria-hidden="true">🍳</div>
    <p>${esc(message)}</p>
    <button class="btn btn-primary" data-action="reload" type="button">重試</button>
  </div>`;
}

function groupIngredients(ingredients) {
  const map = new Map();
  for (const ing of ingredients || []) {
    const key = ing.group_name || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ing);
  }
  return Array.from(map.entries());
}

function totalTime(recipe) {
  return (Number(recipe.prep_minutes) || 0) + (Number(recipe.cook_minutes) || 0);
}

/* ================================================================== */
/* 首頁 / 收藏                                                         */
/* ================================================================== */

const homeFilters = { q: '', category: '', fav: false };

async function renderHome({ fav = false } = {}) {
  homeFilters.fav = fav;
  homeFilters.category = '';
  const view = $('#view');
  view.innerHTML = `
    <section class="page-head">
      <div>
        <h1>${fav ? '我的收藏' : '我的食譜'}</h1>
        <p class="muted">${fav ? '⭐ 收藏起來的口袋名單' : '把煮食教學影片，變成一步一步的食譜'}</p>
      </div>
      <button class="btn btn-primary hide-desktop" data-action="new-recipe" type="button">＋ 新增食譜</button>
    </section>

    <div class="toolbar">
      <label class="search-box">
        <span aria-hidden="true">🔍</span>
        <input id="homeSearch" class="input" type="search" enterkeyhint="search"
               placeholder="搜尋食譜、食材、標籤…" value="${esc(homeFilters.q)}" aria-label="搜尋食譜">
      </label>
      <div id="catChips" class="chips" role="tablist" aria-label="分類"></div>
    </div>

    <div id="recipeGrid" class="recipe-grid">${loadingHtml()}</div>`;

  $('#homeSearch').addEventListener('input', debounce((e) => {
    homeFilters.q = e.target.value;
    loadRecipeGrid();
  }, 250));

  await Promise.all([loadCategoryChips(), loadRecipeGrid()]);
}

async function loadCategoryChips() {
  const box = $('#catChips');
  if (!box) return;
  try {
    const data = await api('/api/categories');
    const items = [{ category: '', n: null }, ...data.items];
    box.innerHTML = items.map(({ category, n }) => `
      <button class="chip ${homeFilters.category === category ? 'is-active' : ''}"
              data-action="cat" data-cat="${esc(category)}" type="button">
        ${esc(category || '全部')}${n ? ` <span class="chip-n">${n}</span>` : ''}
      </button>`).join('');
  } catch { box.innerHTML = ''; }
}

async function loadRecipeGrid() {
  const grid = $('#recipeGrid');
  if (!grid) return;
  const params = new URLSearchParams();
  if (homeFilters.q) params.set('q', homeFilters.q);
  if (homeFilters.category) params.set('category', homeFilters.category);
  if (homeFilters.fav) params.set('fav', '1');
  try {
    const data = await api(`/api/recipes?${params}`);
    grid.innerHTML = data.items.length
      ? data.items.map(recipeCardHtml).join('')
      : emptyGridHtml();
  } catch (e) {
    grid.innerHTML = errorHtml(e.message);
  }
}

function emptyGridHtml() {
  const searching = homeFilters.q || homeFilters.category;
  return `<div class="empty span-all">
    <div class="empty-icon" aria-hidden="true">${searching ? '🔎' : '🥗'}</div>
    <p>${searching ? '找不到符合的食譜，換個關鍵字試試' : '還沒有食譜，先新增第一份吧'}</p>
    ${searching
      ? '<button class="btn btn-ghost" data-action="clear-filter" type="button">清除篩選</button>'
      : '<button class="btn btn-primary" data-action="new-recipe" type="button">＋ 新增食譜</button>'}
  </div>`;
}

function recipeCardHtml(r) {
  const thumb = thumbOf(r);
  const time = totalTime(r);
  const listed = r.listed_count > 0;
  return `
  <article class="card" data-action="open-recipe" data-id="${r.id}" tabindex="0" role="link"
           aria-label="開啟食譜 ${esc(r.title)}">
    <div class="card-media">
      ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" decoding="async"
                    onerror="this.style.display='none'">`
             : '<div class="card-media-fallback" aria-hidden="true">🍳</div>'}
      <button class="fav-btn ${r.favorite ? 'is-fav' : ''}" data-action="toggle-fav" data-id="${r.id}"
              data-fav="${r.favorite ? 1 : 0}" type="button"
              aria-label="${r.favorite ? '取消收藏' : '加入收藏'}" title="${r.favorite ? '取消收藏' : '加入收藏'}">★</button>
      ${time ? `<span class="card-time">⏱ ${esc(fmtMinutes(time))}</span>` : ''}
    </div>
    <div class="card-body">
      <h3 class="card-title">${esc(r.title)}</h3>
      <div class="card-meta">
        ${r.category ? `<span class="tag">${esc(r.category)}</span>` : ''}
        <span>${r.step_count} 個步驟</span>
        <span>${r.ingredient_count} 種食材</span>
      </div>
      ${listed ? `<div class="card-flag">🛒 已加入採購清單 ${r.listed_count}/${r.ingredient_count}</div>` : ''}
    </div>
  </article>`;
}

/* ================================================================== */
/* 食譜詳情                                                            */
/* ================================================================== */

async function renderRecipe(id) {
  const view = $('#view');
  view.innerHTML = loadingHtml('載入食譜…');
  let recipe;
  try {
    recipe = (await api(`/api/recipes/${id}`)).recipe;
  } catch (e) {
    view.innerHTML = errorHtml(e.message);
    return;
  }
  state.recipe = recipe;
  state.listFactor = 1;
  view.innerHTML = detailHtml(recipe);
  refreshFooterStats();
}

function detailHtml(r) {
  const vid = videoIdOf(r.video_url);
  const factor = state.listFactor;
  const servingsShown = Math.max(1, Math.round((Number(r.servings) || 1) * factor));
  const groups = groupIngredients(r.ingredients);
  const allInList = r.ingredients.length > 0 && r.ingredients.every((i) => i.in_list);
  const inListCount = r.ingredients.filter((i) => i.in_list).length;
  const time = totalTime(r);

  const videoBlock = vid
    ? `<div class="video-frame">
         <iframe id="mainVideo" title="教學影片"
           src="https://www.youtube.com/embed/${vid}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}"
           allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
           allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
       </div>
       ${r.video_title || r.source ? `<p class="video-caption">🎬 ${esc(r.video_title || '')}
         ${r.source ? `· <a href="${esc(r.video_url)}" target="_blank" rel="noopener">來源：${esc(r.source)}</a>` : ''}</p>` : ''}
       ${r.video_url ? `<p class="video-caption"><a href="${esc(r.video_url)}" target="_blank" rel="noopener">在 YouTube 開啟影片 ↗</a></p>` : ''}`
    : `<div class="video-frame video-empty">
         <div class="video-empty-inner">
           <span aria-hidden="true">🎬</span>
           <p>尚未連結教學影片</p>
           <button class="btn btn-ghost" data-action="edit-recipe" data-id="${r.id}" type="button">連結影片</button>
         </div>
       </div>`;

  const coverBlock = (r.cover && !vid)
    ? `<img class="detail-cover" src="${esc(r.cover)}" alt="${esc(r.title)}">`
    : '';

  return `
  <nav class="crumbs"><a href="#/">← 食譜</a></nav>

  <header class="detail-head">
    <div class="detail-head-main">
      <h1>${esc(r.title)}</h1>
      <div class="detail-meta">
        ${r.category ? `<span class="tag">${esc(r.category)}</span>` : ''}
        ${r.servings ? `<span class="meta-pill">🍽 ${servingsShown} 人份</span>` : ''}
        ${r.prep_minutes ? `<span class="meta-pill">🔪 準備 ${fmtMinutes(r.prep_minutes)}</span>` : ''}
        ${r.cook_minutes ? `<span class="meta-pill">🔥 烹調 ${fmtMinutes(r.cook_minutes)}</span>` : ''}
        ${time ? `<span class="meta-pill">⏱ 共 ${fmtMinutes(time)}</span>` : ''}
        ${r.difficulty ? `<span class="meta-pill">📊 ${esc(r.difficulty)}</span>` : ''}
      </div>
      ${r.tags && r.tags.length ? `<div class="tag-row">${r.tags.map((t) => `<span class="tag tag-soft">#${esc(t)}</span>`).join('')}</div>` : ''}
      ${r.description ? `<p class="detail-desc">${esc(r.description)}</p>` : ''}
    </div>
    <div class="detail-actions">
      <button class="btn ${r.favorite ? 'btn-warn' : 'btn-ghost'}" data-action="toggle-fav-detail"
              data-id="${r.id}" data-fav="${r.favorite ? 1 : 0}" type="button">
        ${r.favorite ? '★ 已收藏' : '☆ 收藏'}</button>
      <button class="btn btn-ghost" data-action="edit-recipe" data-id="${r.id}" type="button">✏️ 編輯</button>
      <button class="btn btn-ghost" data-action="print-pdf" type="button">🖨 列印／另存 PDF</button>
      <button class="btn btn-primary" data-action="download-pdf" type="button">⬇ 下載 PDF</button>
      <button class="btn btn-danger-ghost" data-action="delete-recipe" data-id="${r.id}" type="button">🗑 刪除</button>
    </div>
  </header>

  <div class="detail-grid">
    <div class="detail-col-media">
      ${videoBlock}
      ${coverBlock}

      <section class="panel">
        <div class="panel-head">
          <h2>🛒 食材</h2>
          <div class="servings" aria-label="調整份量">
            <button class="serv-btn" data-action="serv" data-delta="-1" type="button" aria-label="減少份量">−</button>
            <span class="serv-num">${servingsShown} 人份</span>
            <button class="serv-btn" data-action="serv" data-delta="1" type="button" aria-label="增加份量">＋</button>
          </div>
        </div>

        <div class="panel-cta">
          <button class="btn ${allInList ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="toggle-all-list"
                  data-id="${r.id}" data-in="${allInList ? 0 : 1}" type="button">
            ${allInList ? '✓ 已全部加入清單 · 移出' : `🛒 全部加入採購清單（${r.ingredients.length}）`}
          </button>
          <span class="muted small">${inListCount}/${r.ingredients.length} 已加入</span>
        </div>

        ${groups.length ? groups.map(([gname, items]) => `
          <div class="ing-group">
            ${gname ? `<h4 class="ing-group-name">${esc(gname)}</h4>` : ''}
            <ul class="ing-list">
              ${items.map((i) => `
                <li class="ing ${i.in_list ? 'in-list' : ''}">
                  <label>
                    <input type="checkbox" data-action="ing-list" data-id="${i.id}" ${i.in_list ? 'checked' : ''}>
                    <span class="ing-name">${esc(i.name)}</span>
                    <span class="ing-qty">${esc(scaleQty(i.qty, factor))} ${esc(i.unit)}</span>
                  </label>
                </li>`).join('')}
            </ul>
          </div>`).join('')
        : '<p class="muted">尚未加入食材</p>'}
      </section>

      ${r.notes ? `<section class="panel"><div class="panel-head"><h2>📝 備註</h2></div>
        <p class="notes">${esc(r.notes)}</p></section>` : ''}
    </div>

    <div class="detail-col-steps">
      <section class="panel steps-panel">
        <div class="panel-head">
          <h2>👩‍🍳 步驟（${r.steps.length}）</h2>
          ${r.steps.length ? `<button class="btn btn-warn btn-sm" data-action="cook-mode" type="button">▶ 跟住步驟做</button>` : ''}
        </div>
        ${r.steps.length ? `<ol class="steps">${r.steps.map((s, idx) => `
          <li class="step" data-step="${idx}">
            <div class="step-no">${idx + 1}</div>
            <div class="step-main">
              <div class="step-head">
                ${s.title ? `<h3>${esc(s.title)}</h3>` : '<h3></h3>'}
                ${s.t_start !== null && s.t_start !== undefined
                  ? `<button class="time-chip" data-action="seek" data-t="${s.t_start}" type="button"
                       title="跳到影片 ${secsToClock(s.t_start)}">▶ ${secsToClock(s.t_start)}</button>` : ''}
              </div>
              <p class="step-body">${esc(s.body).replace(/\n/g, '<br>')}</p>
              ${s.tip ? `<p class="step-tip">💡 ${esc(s.tip)}</p>` : ''}
            </div>
          </li>`).join('')}</ol>`
        : '<p class="muted">尚未加入步驟，按「編輯」把影片教學拆成步驟。</p>'}
      </section>
    </div>
  </div>`;
}

/* ---------- 跟住步驟做（烹調模式） ---------- */
function openCookMode(recipe) {
  const root = $('#modal-root');
  const vid = videoIdOf(recipe.video_url);
  let idx = 0;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop cook-mode';
  wrap.innerHTML = `
    <div class="cook-panel" role="dialog" aria-modal="true" aria-label="烹調模式">
      <header class="cook-head">
        <span class="cook-title">${esc(recipe.title)}</span>
        <span class="cook-progress"><b id="cookNow">1</b> / ${recipe.steps.length}</span>
        <button class="cook-close" data-cook="close" type="button" aria-label="關閉">✕</button>
      </header>
      ${vid ? `<div class="video-frame cook-video">
        <iframe id="cookVideo" title="教學影片"
          src="https://www.youtube.com/embed/${vid}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe></div>` : ''}
      <div class="cook-body" id="cookBody"></div>
      <footer class="cook-foot">
        <button class="btn btn-ghost" data-cook="prev" type="button">← 上一步</button>
        <div class="cook-dots" id="cookDots"></div>
        <button class="btn btn-primary" data-cook="next" type="button">下一步 →</button>
      </footer>
    </div>`;
  root.appendChild(wrap);

  const draw = () => {
    const s = recipe.steps[idx];
    $('#cookNow', wrap).textContent = String(idx + 1);
    $('#cookBody', wrap).innerHTML = `
      <div class="cook-step">
        ${s.title ? `<h3>${esc(s.title)}</h3>` : ''}
        <p>${esc(s.body).replace(/\n/g, '<br>')}</p>
        ${s.tip ? `<p class="step-tip">💡 ${esc(s.tip)}</p>` : ''}
        ${s.t_start !== null && s.t_start !== undefined
          ? `<button class="btn btn-warn btn-sm" data-cook="seek" data-t="${s.t_start}" type="button">
               ▶ 從  ${secsToClock(s.t_start)}  播放</button>` : ''}
      </div>`;
    $('#cookDots', wrap).innerHTML = recipe.steps.map((_, i) =>
      `<span class="dot ${i === idx ? 'is-on' : ''} ${i < idx ? 'is-done' : ''}"></span>`).join('');
    wrap.querySelector('[data-cook="prev"]').disabled = idx === 0;
    wrap.querySelector('[data-cook="next"]').textContent =
      idx === recipe.steps.length - 1 ? '完成 ✓' : '下一步 →';
  };

  wrap.addEventListener('click', (e) => {
    const act = e.target.closest('[data-cook]')?.dataset.cook;
    if (e.target === wrap || act === 'close') { wrap.remove(); return; }
    if (act === 'prev' && idx > 0) { idx -= 1; draw(); }
    if (act === 'next') {
      if (idx === recipe.steps.length - 1) { wrap.remove(); return; }
      idx += 1; draw();
    }
    if (act === 'seek') {
      const t = Number(e.target.closest('[data-t]').dataset.t);
      seekVideo($('#cookVideo', wrap), t);
    }
  });
  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(wrap)) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'ArrowRight') { idx = Math.min(recipe.steps.length - 1, idx + 1); draw(); }
    if (e.key === 'ArrowLeft') { idx = Math.max(0, idx - 1); draw(); }
    if (e.key === 'Escape') wrap.remove();
  });
  draw();
}

/* ================================================================== */
/* 採購清單                                                            */
/* ================================================================== */

async function renderShopping() {
  const view = $('#view');
  view.innerHTML = loadingHtml('載入採購清單…');
  let data;
  try {
    data = await api('/api/shopping');
  } catch (e) {
    view.innerHTML = errorHtml(e.message);
    return;
  }

  const groups = new Map();
  for (const item of data.items) {
    const key = item.recipe_title || '自訂項目';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const pct = data.total ? Math.round((data.checked / data.total) * 100) : 0;

  view.innerHTML = `
    <section class="page-head">
      <div>
        <h1>🛒 採購清單</h1>
        <p class="muted">${data.total ? `已購買 ${data.checked} / ${data.total} 項` : '清單是空的'}</p>
      </div>
      <div class="head-actions">
        ${data.total ? `
          <button class="btn btn-ghost" data-action="shop-clear-checked" type="button">清除已購買</button>
          <button class="btn btn-danger-ghost" data-action="shop-clear-all" type="button">清空清單</button>` : ''}
      </div>
    </section>

    ${data.total ? `
    <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>` : ''}

    <form class="shop-add" id="shopAddForm">
      <input class="input" id="shopName" placeholder="加入其他要買的東西，如：醬油" aria-label="項目名稱" required>
      <input class="input input-sm" id="shopQty" placeholder="數量" aria-label="數量">
      <input class="input input-sm" id="shopUnit" placeholder="單位" aria-label="單位">
      <button class="btn btn-primary" type="submit">＋ 加入</button>
    </form>

    <div class="shop-groups">
      ${data.total ? Array.from(groups.entries()).map(([title, items]) => `
        <section class="panel shop-group">
          <div class="panel-head"><h2>${esc(title)}</h2>
            <span class="muted small">${items.filter((i) => i.checked).length}/${items.length}</span></div>
          <ul class="shop-list">
            ${items.map((i) => `
              <li class="shop-item ${i.checked ? 'is-checked' : ''}">
                <label class="shop-main">
                  <input type="checkbox" data-action="shop-toggle" data-id="${i.id}" ${i.checked ? 'checked' : ''}>
                  <span class="shop-name">${esc(i.name)}</span>
                  <span class="shop-qty">${esc([i.qty, i.unit].filter(Boolean).join(' '))}</span>
                </label>
                ${i.recipe_id ? `<a class="shop-src" href="#/recipe/${i.recipe_id}" title="查看食譜">📄</a>` : '<span class="shop-src">✏️</span>'}
                <button class="icon-btn" data-action="shop-remove" data-id="${i.id}" type="button"
                        aria-label="移除項目" title="移出清單">✕</button>
              </li>`).join('')}
          </ul>
        </section>`).join('')
      : `<div class="empty">
          <div class="empty-icon" aria-hidden="true">🧺</div>
          <p>打開任一食譜，按「全部加入採購清單」，就能帶著清單去買餸。</p>
          <a class="btn btn-primary" href="#/">去看食譜</a>
        </div>`}
    </div>`;

  $('#shopAddForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#shopName').value.trim();
    if (!name) return;
    try {
      await api('/api/shopping', {
        method: 'POST',
        body: { name, qty: $('#shopQty').value.trim() || null, unit: $('#shopUnit').value.trim() },
      });
      toast('已加入清單');
      renderShopping();
      refreshShoppingBadge();
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* ================================================================== */
/* 管理員後台                                                          */
/* ================================================================== */

async function renderAdmin() {
  const view = $('#view');
  if (!currentUser()?.is_admin) {
    view.innerHTML = `<div class="empty">
      <div class="empty-icon" aria-hidden="true">🔒</div>
      <p>需要管理員權限</p>
      <a class="btn btn-ghost" href="#/">返回食譜</a>
    </div>`;
    return;
  }
  view.innerHTML = loadingHtml('載入後台…');
  let data;
  try {
    data = await api('/api/admin/users');
  } catch (e) {
    view.innerHTML = errorHtml(e.message);
    return;
  }
  const s = data.stats;
  view.innerHTML = `
    <section class="page-head">
      <div>
        <h1>🛠 管理員後台</h1>
        <p class="muted">管理使用者帳號與檢視系統狀態</p>
      </div>
    </section>

    <div class="stat-grid">
      <div class="stat-card"><b>${s.users}</b><span>使用者</span></div>
      <div class="stat-card"><b>${s.admins}</b><span>管理員</span></div>
      <div class="stat-card"><b>${s.recipes}</b><span>食譜</span></div>
      <div class="stat-card"><b>${s.ingredients}</b><span>食材</span></div>
      <div class="stat-card"><b>${s.steps}</b><span>步驟</span></div>
      <div class="stat-card"><b>${s.shopping}</b><span>採購項目</span></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>👤 使用者（${data.items.length}）</h2>
        <span class="muted small">刪除帳號會連同其食譜與清單一併移除</span>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th>#</th><th>帳號</th><th>名稱</th><th>角色</th><th>食譜</th><th>自訂清單</th><th>註冊時間</th><th class="th-actions">操作</th></tr>
          </thead>
          <tbody>
            ${data.items.map((u) => `
              <tr class="${u.id === currentUser().id ? 'is-me' : ''}">
                <td>${u.id}</td>
                <td class="td-email" title="${esc(u.email)}">${esc(u.email)}${u.id === currentUser().id ? '（我）' : ''}</td>
                <td>${esc(u.name || '—')}</td>
                <td>${u.is_admin ? '<span class="tag">管理員</span>' : '<span class="muted small">一般</span>'}</td>
                <td>${u.recipe_count}</td>
                <td>${u.custom_items}</td>
                <td class="td-date">${esc((u.created_at || '').slice(0, 16))}</td>
                <td class="td-actions">
                  <button class="btn btn-ghost btn-sm" data-admin="toggle" data-id="${u.id}" data-to="${u.is_admin ? 0 : 1}"
                          type="button" ${u.id === currentUser().id ? 'disabled title="不能取消自己的管理員"' : ''}>
                    ${u.is_admin ? '取消管理員' : '設為管理員'}
                  </button>
                  <button class="btn btn-ghost btn-sm" data-admin="reset" data-id="${u.id}" type="button">重設密碼</button>
                  <button class="btn btn-danger-ghost btn-sm" data-admin="delete" data-id="${u.id}" data-email="${esc(u.email)}"
                          type="button" ${u.id === currentUser().id ? 'disabled title="不能刪除自己"' : ''}>刪除</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  view.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-admin]');
    if (!btn) return;
    const act = btn.dataset.admin;
    const uid = Number(btn.dataset.id);
    try {
      if (act === 'toggle') {
        const to = btn.dataset.to === '1';
        await api(`/api/admin/users/${uid}`, { method: 'PATCH', body: { is_admin: to } });
        toast(to ? '已設為管理員' : '已取消管理員');
        renderAdmin();
      }
      if (act === 'reset') {
        const pw = prompt('輸入新的密碼（至少 8 個字元）：');
        if (!pw) return;
        await api(`/api/admin/users/${uid}`, { method: 'PATCH', body: { reset_password: pw } });
        toast('已重設密碼並強制重新登入');
      }
      if (act === 'delete') {
        const email = btn.dataset.email;
        const ok = await confirmDialog(
          `確定刪除帳號「${email}」？\n其所有食譜、食材、步驟與採購清單會一併刪除，且無法復原。`,
          { okText: '刪除帳號', danger: true });
        if (!ok) return;
        const r = await api(`/api/admin/users/${uid}`, { method: 'DELETE' });
        toast(`已刪除帳號（連同 ${r.deleted.recipes} 份食譜）`);
        renderAdmin();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

/* ================================================================== */
/* 我的帳號                                                            */
/* ================================================================== */

function renderAccount() {
  const u = currentUser();
  if (!u) { renderAuth('login'); return; }
  const view = $('#view');
  view.innerHTML = `
    <section class="page-head">
      <div>
        <h1>我的帳號</h1>
        <p class="muted">${esc(u.email)}</p>
      </div>
    </section>
    <div class="panel">
      <div class="panel-head">
        <h2>👤 ${esc(u.name || u.email)}</h2>
        <span class="muted small">帳號 #${u.id}</span>
      </div>
      <p class="muted small">每位使用者的食譜、採購清單與收藏都是分開保存的。</p>
      <div class="extract-actions" style="margin-top:14px">
        ${u.is_admin ? '<a class="btn btn-primary" href="#/admin">🛠 管理員後台</a>' : ''}
        <button class="btn ${u.is_admin ? 'btn-ghost' : 'btn-primary'}" data-action="open-settings" type="button">⚙ AI 設定</button>
        <button class="btn btn-ghost" data-action="logout" type="button">登出</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>📦 我的資料</h2></div>
      <p class="muted small">資料存放在伺服器的 SQLite 資料庫（<code>data/recipes.db</code>）；備份該檔案即可備份所有帳號與食譜。</p>
    </div>`;
}

/* ================================================================== */
/* 登入 / 註冊                                                          */
/* ================================================================== */

function renderAuth(mode) {
  const view = $('#view');
  const isLogin = mode !== 'register';
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo" aria-hidden="true">🍳</div>
        <h1>${isLogin ? '登入食譜盒' : '建立帳號'}</h1>
        <p class="muted">${isLogin ? '登入後繼續使用你的食譜與採購清單' : '每個人的食譜與清單分開保存'}</p>
        <form id="authForm" class="auth-form" novalidate>
          ${isLogin ? '' : `
            <label class="field">
              <span class="field-label">名稱（選填）</span>
              <input class="input" name="name" autocomplete="name" placeholder="你的名字">
            </label>`}
          <label class="field">
            <span class="field-label">電子郵件</span>
            <input class="input" name="email" type="email" required autocomplete="email" placeholder="you@example.com">
          </label>
          <label class="field">
            <span class="field-label">密碼${isLogin ? '' : '（至少 8 個字元）'}</span>
            <input class="input" name="password" type="password" required
                   autocomplete="${isLogin ? 'current-password' : 'new-password'}">
          </label>
          <button class="btn btn-primary btn-block" type="submit">${isLogin ? '登入' : '註冊並登入'}</button>
        </form>
        <p class="auth-switch">
          ${isLogin ? '還沒有帳號？<a href="#/register">立即註冊</a>' : '已經有帳號？<a href="#/login">登入</a>'}
        </p>
        <p class="muted small">資料存在伺服器的 SQLite 資料庫；密碼以 scrypt 雜湊保存，不會明文儲存。</p>
      </div>
    </div>`;

  const form = $('#authForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.elements.namedItem('email').value.trim();
    const password = form.elements.namedItem('password').value;
    const name = isLogin ? '' : (form.elements.namedItem('name')?.value || '').trim();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '處理中…';
    try {
      const res = await api(isLogin ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        body: { email, password, name },
        skipAuth: true,
      });
      setAuth(res.token, res.user);
      if (res.claimed) toast(`歡迎！已把 ${res.claimed} 份既有食譜歸到你的帳號`);
      else toast(isLogin ? '登入成功' : '註冊成功');
      location.hash = '#/';
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  form.elements.namedItem('email').focus();
}

/* ================================================================== */
/* PDF 版面（畫面外，供列印與 jsPDF 轉檔使用）                          */
/* ================================================================== */

function buildPdfSheet(r) {
  const groups = groupIngredients(r.ingredients);
  const vid = videoIdOf(r.video_url);
  const cover = r.cover || (vid ? `/api/thumb/${vid}` : '');
  const time = totalTime(r);
  const today = new Date().toLocaleDateString('zh-TW');

  $('#pdf-sheet').innerHTML = `
    <div class="sh-page">
      <header class="sh-head">
        <div class="sh-head-text">
          <div class="sh-kicker">食譜盒 · RECIPE</div>
          <h1>${esc(r.title)}</h1>
          ${r.description ? `<p class="sh-desc">${esc(r.description)}</p>` : ''}
          <div class="sh-meta">
            ${r.category ? `<span>分類：${esc(r.category)}</span>` : ''}
            <span>份量：${esc(r.servings)} 人份</span>
            ${r.prep_minutes ? `<span>準備：${esc(fmtMinutes(r.prep_minutes))}</span>` : ''}
            ${r.cook_minutes ? `<span>烹調：${esc(fmtMinutes(r.cook_minutes))}</span>` : ''}
            ${time ? `<span>總時間：${esc(fmtMinutes(time))}</span>` : ''}
            ${r.difficulty ? `<span>難度：${esc(r.difficulty)}</span>` : ''}
          </div>
          ${r.tags && r.tags.length ? `<div class="sh-tags">${r.tags.map((t) => `#${esc(t)}`).join('　')}</div>` : ''}
        </div>
        ${cover ? `<img class="sh-cover" src="${esc(cover)}" alt="" crossorigin="anonymous">` : ''}
      </header>

      <div class="sh-cols">
        <section class="sh-ings">
          <h2>食材（${esc(r.servings)} 人份）</h2>
          ${groups.length ? groups.map(([g, items]) => `
            <div class="sh-ing-group">
              ${g ? `<h4>${esc(g)}</h4>` : ''}
              <ul>${items.map((i) => `
                <li><span class="sh-box">☐</span><span class="sh-ing-name">${esc(i.name)}</span>
                    <span class="sh-ing-qty">${esc([i.qty, i.unit].filter((x) => x !== '' && x !== null).join(' '))}</span></li>`).join('')}
              </ul>
            </div>`).join('')
          : '<p class="sh-muted">（未填寫食材）</p>'}
        </section>

        <section class="sh-steps">
          <h2>做法步驟</h2>
          ${r.steps.length ? `<ol class="sh-steps-list">${r.steps.map((s, i) => `
            <li>
              <div class="sh-step-head"><b>步驟 ${i + 1}</b>
                ${s.title ? `<span class="sh-step-title">${esc(s.title)}</span>` : ''}
                ${s.t_start !== null && s.t_start !== undefined
                  ? `<span class="sh-time">${secsToClock(s.t_start)}</span>` : ''}</div>
              <p>${esc(s.body).replace(/\n/g, '<br>')}</p>
              ${s.tip ? `<p class="sh-tip">💡 ${esc(s.tip)}</p>` : ''}
            </li>`).join('')}</ol>`
          : '<p class="sh-muted">（未填寫步驟）</p>'}
        </section>
      </div>

      ${r.notes ? `<section class="sh-notes"><h2>備註</h2><p>${esc(r.notes).replace(/\n/g, '<br>')}</p></section>` : ''}

      <footer class="sh-foot">
        <span>${r.video_url ? `影片教學：${esc(r.video_url)}` : ''}</span>
        <span>${esc(today)} 匯出 · 食譜盒 RecipeBox</span>
      </footer>
    </div>`;
}
