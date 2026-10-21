// LightAndSky 乐谱库前端主逻辑
// 启动 → 拉取 scores.json → 渲染卡片 → 搜索/分类/排序/详情视图

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  scores: [],
  filtered: [],
  category: 'all',
  query: '',
  sort: 'hot',
};

const grid = $('#grid');
const empty = $('#empty');
const searchInput = $('#search');
const sortSelect = $('#sort');
const chips = $('#categories');
const detailPage = $('#detail-page');

// 宽屏用浮窗、窄屏用整页，具体形态由 CSS 媒体查询决定
const wideQuery = window.matchMedia('(min-width: 720px)');

let listScrollY = 0;

// ===== 加载数据 =====
async function loadScores() {
  try {
    const res = await fetch('scores.json?v=' + Date.now(), { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.scores = (await res.json()).filter((s) => s.status === 'S1' || s.status === 'S2');
  } catch (err) {
    grid.innerHTML = '<p class="empty">无法加载乐谱数据：' + err.message + '</p>';
    return;
  }
  renderCategories();
  apply();
  routeFromHash();
}

// ===== 分类 chips =====
function renderCategories() {
  const set = new Set(['all']);
  state.scores.forEach((s) => {
    if (s.category) set.add(s.category);
  });
  const cats = Array.from(set);
  chips.innerHTML = '';
  cats.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'chip' + (cat === state.category ? ' active' : '');
    btn.textContent = cat === 'all' ? '全部' : cat;
    btn.dataset.cat = cat;
    btn.addEventListener('click', () => {
      state.category = cat;
      $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === cat));
      apply();
      history.replaceState(null, '', '#/');
    });
    chips.appendChild(btn);
  });
}

// ===== 过滤 + 排序 =====
function apply() {
  const q = state.query.trim().toLowerCase();
  state.filtered = state.scores.filter((s) => {
    if (state.category !== 'all' && s.category !== state.category) return false;
    if (q) {
      const hay = (s.title + ' ' + (s.composer || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorters = {
    hot: (a, b) => (b.views || 0) - (a.views || 0),
    new: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    alpha: (a, b) => (a.title || '').localeCompare(b.title || '', 'zh'),
  };
  state.filtered.sort(sorters[state.sort] || sorters.hot);
  render();
}

// ===== 渲染卡片 =====
function render() {
  grid.innerHTML = '';
  if (state.filtered.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const frag = document.createDocumentFragment();
  state.filtered.forEach((s) => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = '#/score/' + encodeURIComponent(s.id);
    card.dataset.id = s.id;
    const cat = s.category || '其他';
    const statusBadge = s.status
      ? `<span class="status-badge status-${escapeAttr(s.status)}">${escapeHTML(s.status)}</span>`
      : '';
    card.innerHTML = `
      <div class="card-bar cat-${escapeAttr(cat)}"></div>
      ${statusBadge}
      <div class="card-body">
        <h3 class="card-title">${escapeHTML(s.title || '未命名')}</h3>
        <p class="card-composer">${escapeHTML(s.composer || '')}</p>
        <p class="card-intro">${escapeHTML(s.intro || '')}</p>
        <div class="card-footer">
          <span class="tag">${escapeHTML(cat)}</span>
          <span class="views">浏览 ${(s.views || 0).toLocaleString()}</span>
        </div>
      </div>`;
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

// ===== 详情页 =====
function openDetail(id) {
  const s = state.scores.find((x) => x.id === id);
  if (!s) return false;

  document.title = (s.title || '未命名') + ' · 光遇琴谱';
  $('#detail-title').textContent = s.title || '未命名';
  $('#detail-composer').textContent = s.composer || '';
  $('#detail-intro').textContent = s.intro || '暂无';
  $('#detail-category').textContent = s.category || '其他';
  $('#detail-fingering').textContent = s.fingering || '—';
  $('#detail-difficulty').textContent = s.difficulty || '—';
  $('#detail-views').textContent = (s.views || 0).toLocaleString();
  $('#detail-date').textContent = s.created_at || '—';

  const status = $('#detail-status');
  if (s.status) {
    status.hidden = false;
    status.textContent = s.status;
    status.className = 'status-pill status-' + s.status;
  } else {
    status.hidden = true;
  }

  const link = $('#detail-link');
  if (s.feishu_url) {
    link.href = s.feishu_url;
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  if (!document.body.classList.contains('detail-open')) listScrollY = window.scrollY;
  detailPage.hidden = false;
  document.body.classList.add('detail-open');
  // 整页模式下回到顶部；浮窗模式保持列表原地不动
  if (!wideQuery.matches) window.scrollTo(0, 0);
  return true;
}

function closeDetail() {
  if (detailPage.hidden) return;
  detailPage.hidden = true;
  document.body.classList.remove('detail-open');
  document.title = '光遇琴谱';
  if (!wideQuery.matches) window.scrollTo(0, listScrollY);
}

// ===== 工具 =====
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHTML(s); }

// ===== 事件绑定 =====
searchInput.addEventListener('input', (e) => {
  state.query = e.target.value;
  apply();
});
sortSelect.addEventListener('change', (e) => {
  state.sort = e.target.value;
  apply();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !detailPage.hidden) location.hash = '#/';
});
// 浮窗模式：点击浮窗外的遮罩关闭（整页模式点击空白不关闭）
detailPage.addEventListener('click', (e) => {
  if (e.target === detailPage && wideQuery.matches) location.hash = '#/';
});

// hash 路由：#/score/<id> 显示详情页，其余显示列表
function routeFromHash() {
  const m = location.hash.match(/^#\/score\/(.+)$/);
  if (m) {
    if (openDetail(decodeURIComponent(m[1]))) return;
    // 数据未加载完成时先等待；已加载但仍找不到该乐谱则回到列表
    if (state.scores.length) {
      history.replaceState(null, '', '#/');
      closeDetail();
    }
    return;
  }
  closeDetail();
}
window.addEventListener('hashchange', routeFromHash);

// ===== PWA: Service Worker 注册（含一次性自清理） =====
if ('serviceWorker' in navigator) {
  // 每个会话首次加载时，注销所有旧 SW 并清空缓存，确保拿到最新代码
  if (!sessionStorage.getItem('sw_cleaned')) {
    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}
      sessionStorage.setItem('sw_cleaned', '1');
      location.reload();
    })();
  } else {
    // 清理完成后正常注册 SW
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });
    }).catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
}

// ===== 启动 =====
loadScores();
