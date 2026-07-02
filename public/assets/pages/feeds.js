import { mount } from "../layout.js";
mount();

const API = 'https://api.thatcomputerguy26.org';
let registry = null;
let activeTab = 'all';
let activeStateCode = '';
let activeCountryIso = '';

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function pillForCat(cat) {
  if (cat === 'health:us-cdc') return 'cdc';
  if (cat === 'health:fed') return 'fed';
  if (cat === 'health:who-region') return 'who';
  if (cat.startsWith('health:state:')) return 'state';
  if (cat.startsWith('health:country:')) return 'country';
  if (cat === 'health:journal') return 'journal';
  if (cat === 'health:research') return 'research';
  if (cat === 'health:reliefweb') return 'relief';
  return '';
}
function shortCat(cat) {
  if (cat === 'health:us-cdc') return 'CDC';
  if (cat === 'health:fed') return 'Federal';
  if (cat === 'health:who-region') return 'WHO/Regional';
  if (cat.startsWith('health:state:')) return 'State ' + cat.slice('health:state:'.length);
  if (cat.startsWith('health:country:')) return 'Country ' + cat.slice('health:country:'.length);
  if (cat === 'health:journal') return 'Journal';
  if (cat === 'health:research') return 'Research';
  if (cat === 'health:reliefweb') return 'ReliefWeb';
  return cat.replace(/^health:/, '');
}

async function loadRegistry() {
  try {
    const r = await fetch(API + '/api/world/source-registry/health?expand=1', { cache: 'no-cache' });
    const d = await r.json();
    if (!d.ok) throw new Error('not ok');
    registry = d;
    renderStats();
    renderTabs();
    render();
  } catch (e) {
    document.getElementById('feedTable').innerHTML = '<div class="empty">Could not load registry: ' + esc(e.message) + '. Try reloading.</div>';
  }
}

function renderStats() {
  const total = registry.total;
  const states = (registry.states || []).length;
  const countries = (registry.countries || []).length;
  const fed = (registry.by_category['health:us-cdc'] || 0) + (registry.by_category['health:fed'] || 0);
  const who = (registry.by_category['health:who-region'] || 0);
  const research = (registry.by_category['health:journal'] || 0) + (registry.by_category['health:research'] || 0);
  document.getElementById('feedStats').innerHTML = `
    <div class="stat-tile"><div class="stat-num">${total}</div><div class="stat-lbl">Total feeds</div></div>
    <div class="stat-tile"><div class="stat-num">${states}</div><div class="stat-lbl">US states/territories</div></div>
    <div class="stat-tile"><div class="stat-num">${countries}</div><div class="stat-lbl">Countries</div></div>
    <div class="stat-tile"><div class="stat-num">${fed}</div><div class="stat-lbl">CDC / FDA / NIH</div></div>
    <div class="stat-tile"><div class="stat-num">${who}</div><div class="stat-lbl">WHO regional</div></div>
    <div class="stat-tile"><div class="stat-num">${research}</div><div class="stat-lbl">Journals + research</div></div>
  `;
}

function renderTabs() {
  document.querySelectorAll('.filter-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      activeTab = b.dataset.tab;
      activeStateCode = '';
      activeCountryIso = '';
      render();
    });
  });
}

function renderPicker() {
  const wrap = document.getElementById('pickerWrap');
  if (activeTab === 'us-state') {
    const states = (registry.states || []).slice().sort((a,b) => a.name.localeCompare(b.name));
    wrap.innerHTML = '<div class="pick-grid">' + states.map(s => `
      <button class="pick-btn${activeStateCode===s.code?' active':''}" data-state="${esc(s.code)}">
        <div class="pick-name">${esc(s.name)}</div>
        <div class="pick-count">${esc(s.code)}</div>
      </button>
    `).join('') + '</div>';
    wrap.querySelectorAll('[data-state]').forEach(el => {
      el.addEventListener('click', () => {
        activeStateCode = (activeStateCode === el.dataset.state) ? '' : el.dataset.state;
        renderPicker();
        render();
      });
    });
  } else if (activeTab === 'country') {
    const countries = (registry.countries || []).slice().sort((a,b) => a.name.localeCompare(b.name));
    wrap.innerHTML = '<div class="pick-grid">' + countries.map(c => `
      <button class="pick-btn${activeCountryIso===c.iso?' active':''}" data-country="${esc(c.iso)}">
        <div class="pick-name">${esc(c.name)}</div>
        <div class="pick-count">${esc(c.iso)}</div>
      </button>
    `).join('') + '</div>';
    wrap.querySelectorAll('[data-country]').forEach(el => {
      el.addEventListener('click', () => {
        activeCountryIso = (activeCountryIso === el.dataset.country) ? '' : el.dataset.country;
        renderPicker();
        render();
      });
    });
  } else {
    wrap.innerHTML = '';
  }
}

function render() {
  renderPicker();
  const q = (document.getElementById('feedSearch').value || '').toLowerCase().trim();
  const all = [
    ...(registry.feeds && registry.feeds.rss || []).map(f => ({...f, kind:'rss'})),
    ...(registry.feeds && registry.feeds.api || []).map(f => ({...f, kind:'api'}))
  ];
  let rows = all;
  if (activeTab === 'us-state') {
    if (activeStateCode) rows = rows.filter(f => f.category === 'health:state:' + activeStateCode);
    else rows = rows.filter(f => f.category.startsWith('health:state:'));
  } else if (activeTab === 'country') {
    if (activeCountryIso) rows = rows.filter(f => f.category === 'health:country:' + activeCountryIso);
    else rows = rows.filter(f => f.category.startsWith('health:country:'));
  } else if (activeTab === 'federal') {
    rows = rows.filter(f => f.category === 'health:us-cdc' || f.category === 'health:fed');
  } else if (activeTab === 'who') {
    rows = rows.filter(f => f.category === 'health:who-region' || f.category === 'health:reliefweb');
  } else if (activeTab === 'research') {
    rows = rows.filter(f => f.category === 'health:journal' || f.category === 'health:research');
  }
  if (q) rows = rows.filter(f => (f.source||'').toLowerCase().includes(q) || (f.url||'').toLowerCase().includes(q));
  rows.sort((a,b) => (a.source||'').localeCompare(b.source||''));
  document.getElementById('resultMeta').textContent = rows.length + ' feed' + (rows.length===1?'':'s') + ' shown';
  const tbl = document.getElementById('feedTable');
  if (rows.length === 0) { tbl.innerHTML = '<div class="empty">No feeds match.</div>'; return; }
  tbl.innerHTML = rows.slice(0, 2000).map(f => `
    <div class="feed-row">
      <span class="pill ${pillForCat(f.category)}">${esc(shortCat(f.category))}</span>
      <div>
        <div class="feed-name">${esc(f.source||'(unnamed)')}</div>
        <div class="feed-url">${esc(f.url||'')}</div>
      </div>
      <a class="feed-open" href="${esc(f.url||'#')}" target="_blank" rel="noopener">Open feed →</a>
    </div>
  `).join('');
}

document.getElementById('feedSearch').addEventListener('input', render);
loadRegistry();
