// state.js — externalized from state.html (2026-06-23).
// Moved out of inline <script> blocks so it passes the site CSP
// `script-src 'self' https://api.thatcomputerguy26.org` (no 'unsafe-inline').
// Behavior is identical to the previous inline blocks: mounts the shared
// header/footer, then loads per-state public-health feeds from the fabric API.

import { mount } from "../layout.js";

mount();

const API = 'https://api.thatcomputerguy26.org';
let states = [];
let activeCode = '';

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function init() {
  const r = await fetch(API + '/api/world/source-registry/health', { cache: 'no-cache' });
  const d = await r.json();
  states = (d.states || []).slice().sort((a,b) => a.name.localeCompare(b.name));
  renderGrid();
  const q = new URLSearchParams(location.search).get('s');
  if (q) selectState(q.toUpperCase());
}

function renderGrid() {
  document.getElementById('stateGrid').innerHTML = states.map(s => `
    <button class="state-btn${activeCode===s.code?' active':''}" data-code="${esc(s.code)}">
      <div class="state-name">${esc(s.name)}</div>
      <div class="state-meta">${esc(s.code)} · 25+ feeds</div>
    </button>
  `).join('');
  document.querySelectorAll('[data-code]').forEach(b => {
    b.addEventListener('click', () => selectState(b.dataset.code));
  });
}

async function selectState(code) {
  activeCode = code;
  const state = states.find(s => s.code === code);
  if (!state) return;
  renderGrid();
  history.replaceState(null,'', '?s=' + code);
  document.getElementById('stateTitle').textContent = state.name + ' — public-health feeds';
  document.getElementById('feedsList').innerHTML = '<div style="padding:30px;text-align:center;opacity:.6">Loading feeds…</div>';
  try {
    const r = await fetch(API + '/api/world/source-registry/health?state=' + code, { cache: 'no-cache' });
    const d = await r.json();
    const all = [
      ...((d.feeds && d.feeds.rss) || []),
      ...((d.feeds && d.feeds.api) || [])
    ];
    if (all.length === 0) {
      document.getElementById('feedsList').innerHTML = '<div style="padding:30px;text-align:center;opacity:.6">No feeds wired for this state yet.</div>';
      return;
    }
    document.getElementById('feedsList').innerHTML = all.map(f => `
      <div class="feed-row">
        <div>
          <div class="feed-name">${esc(f.source||'(unnamed)')}</div>
          <div class="feed-url">${esc(f.url||'')}</div>
        </div>
        <a class="feed-open" href="${esc(f.url||'#')}" target="_blank" rel="noopener">Open feed →</a>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('feedsList').innerHTML = '<div style="padding:30px;text-align:center;opacity:.6">Could not load: ' + esc(e.message) + '</div>';
  }
}

init();
