// PHA D12 (Phase D, 2026-05-20) - U.S. state tile-grid choropleth.
//
// Primary data: /api/public/pha/state-outbreaks?since-days=7&limit=500
//   Returns one row per (state, condition, week_ending) from real CDC + state
//   DPH ingest. Aggregated client-side into a per-state advisory count.
// Supplement: /api/public/pha/deep/snapshot for total advisory context
//   (last_run timestamp + advisories[] count) so the legend can show
//   data freshness honestly.
// Renders an inline SVG tile-grid (no external mapping library). Click a
// state to drill into a detail row listing the condition + week_ending +
// source_url for every advisory tagged to that state. Quintile-style
// color scale (0 / 1 / 2-3 / 4-7 / 8+).
(function(){
  if (!document.getElementById('d12-host')) return;

  // Tile-grid layout: row, col, abbr - approximates US state geographic adjacency.
  var TILES = [
    [0,0,'AK'],                                              [0,10,'ME'],
                                                            [1,5,'WA'],[1,9,'VT'],[1,10,'NH'],
                            [2,1,'MT'],[2,2,'ND'],[2,3,'MN'],[2,4,'WI'],[2,5,'MI'],[2,7,'NY'],[2,8,'MA'],
    [3,0,'OR'],[3,1,'ID'],[3,2,'SD'],[3,3,'WY'],[3,4,'IA'],[3,5,'IL'],[3,6,'IN'],[3,7,'OH'],[3,8,'PA'],[3,9,'CT'],[3,10,'RI'],
    [4,0,'CA'],[4,1,'NV'],[4,2,'UT'],[4,3,'CO'],[4,4,'NE'],[4,5,'MO'],[4,6,'KY'],[4,7,'WV'],[4,8,'VA'],[4,9,'NJ'],
                              [5,1,'AZ'],[5,2,'NM'],[5,3,'KS'],[5,4,'AR'],[5,5,'TN'],[5,6,'NC'],[5,7,'MD'],[5,8,'DE'],
                                                  [6,3,'OK'],[6,4,'LA'],[6,5,'MS'],[6,6,'AL'],[6,7,'GA'],[6,8,'SC'],
                                                          [7,3,'TX'],                       [7,8,'FL'],
    [8,0,'HI'], [8,8,'DC']
  ];

  // Quintile color scale.
  function colorFor(n){
    if (!n) return '#1a2238';
    if (n >= 8) return '#dc2626';
    if (n >= 4) return '#f97316';
    if (n >= 2) return '#facc15';
    return '#14b8a6';
  }

  function buildLegend(meta){
    var host = document.getElementById('d12-legend');
    var swatches = [['#1a2238','0'], ['#14b8a6','1'], ['#facc15','2-3'], ['#f97316','4-7'], ['#dc2626','8+']]
      .map(function(p){ return '<span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:'+p[0]+';border:1px solid rgba(255,255,255,.18)"></span>'+p[1]+' advisories (7d)</span>'; })
      .join('');
    var fresh = meta && meta.lastRun ? ' &middot; source last run ' + new Date(meta.lastRun).toLocaleString() : '';
    host.innerHTML = swatches + (fresh ? '<span style="margin-left:auto;color:rgba(255,255,255,.45)">'+fresh+'</span>' : '');
  }

  function esc(s){ return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){ return ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]; }); }

  async function fetchJson(url){
    var r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
    return r.json();
  }

  async function load(){
    var status = document.getElementById('d12-status');
    var svgHost = document.getElementById('d12-svg');
    try {
      // Primary: real per-state outbreak rows.
      var so = await fetchJson('https://api.thatcomputerguy26.org/api/public/pha/state-outbreaks?since-days=7&limit=500');
      var rows = (so && so.items) || [];

      // Optional: snapshot for last_run freshness display.
      var snapMeta = null;
      try {
        var snap = await fetchJson('https://api.thatcomputerguy26.org/api/public/pha/deep/snapshot');
        if (snap && snap.last_run) snapMeta = { lastRun: snap.last_run.ts };
      } catch (e) { /* non-fatal */ }

      // Aggregate by state.
      var byState = {};
      var detailsByState = {};
      rows.forEach(function(row){
        if (!row || !row.state) return;
        var s = String(row.state).toUpperCase().slice(0,2);
        byState[s] = (byState[s] || 0) + 1;
        (detailsByState[s] = detailsByState[s] || []).push({
          condition: row.condition || '(unspecified)',
          week_ending: row.week_ending || '',
          source_url: row.source_url || '',
          cases: row.cases
        });
      });

      // Render SVG tile-grid.
      var BOX = 56, GAP = 6, COLS = 11, ROWS = 9;
      var w = COLS * (BOX + GAP) + GAP, h = ROWS * (BOX + GAP) + GAP;
      var parts = ['<svg viewBox="0 0 '+w+' '+h+'" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="US state choropleth - 7-day advisory count">'];
      TILES.forEach(function(t){
        var row = t[0], col = t[1], abbr = t[2];
        var x = col * (BOX + GAP) + GAP;
        var y = row * (BOX + GAP) + GAP;
        var count = byState[abbr] || 0;
        var color = colorFor(count);
        parts.push('<g class="d12-cell" tabindex="0" role="button" aria-label="'+abbr+' '+count+' advisories" data-abbr="'+abbr+'" data-count="'+count+'" style="cursor:pointer;outline:none">');
        parts.push('<rect x="'+x+'" y="'+y+'" width="'+BOX+'" height="'+BOX+'" rx="6" fill="'+color+'" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>');
        parts.push('<text x="'+(x + BOX/2)+'" y="'+(y + BOX/2 + 2)+'" text-anchor="middle" font-size="14" font-weight="800" fill="#0a0f1a" style="text-shadow:0 0 3px rgba(255,255,255,.4)">'+abbr+'</text>');
        if (count > 0) {
          parts.push('<text x="'+(x + BOX/2)+'" y="'+(y + BOX - 6)+'" text-anchor="middle" font-size="10" fill="#0a0f1a" font-weight="700">'+count+'</text>');
        }
        parts.push('</g>');
      });
      parts.push('</svg>');
      svgHost.innerHTML = parts.join('');
      buildLegend(snapMeta);

      var totalStates = Object.keys(byState).length;
      var totalAdv = rows.length;
      status.innerHTML = '<strong>'+totalStates+'</strong> states with new advisories in the last 7 days &middot; <strong>'+totalAdv+'</strong> total advisory tags (source: /api/public/pha/state-outbreaks). Click a state for detail.';

      var detail = document.getElementById('d12-detail');
      svgHost.querySelectorAll('.d12-cell').forEach(function(g){
        function activate(){
          var abbr = g.getAttribute('data-abbr');
          var count = +g.getAttribute('data-count');
          detail.style.display = 'block';
          if (count === 0){
            detail.innerHTML = '<strong>'+abbr+'</strong> &mdash; no advisories tagged in the last 7 days.';
            return;
          }
          var items = (detailsByState[abbr] || []).slice(0, 12);
          detail.innerHTML = '<strong>'+abbr+' &middot; '+count+' advisor'+(count===1?'y':'ies')+' (7d)</strong>'+
            '<ul style="margin:8px 0 0;padding-left:18px;line-height:1.6">'+
            items.map(function(it){
              var label = esc(it.condition) + (it.week_ending ? ' &middot; week ending ' + esc(it.week_ending) : '') + (it.cases != null ? ' &middot; ' + it.cases + ' cases' : '');
              return it.source_url ? '<li><a href="'+esc(it.source_url)+'" target="_blank" rel="noopener">'+label+'</a></li>' : '<li>'+label+'</li>';
            }).join('') +
            '</ul><div style="margin-top:8px;font-size:12px"><a href="./state.html?s='+abbr+'">Open '+abbr+' detail page &rarr;</a></div>';
        }
        g.addEventListener('click', activate);
        g.addEventListener('keydown', function(ev){ if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); activate(); }});
      });
    } catch (e) {
      status.textContent = 'Server offline: ' + e.message;
      status.style.color = '#fca5a5';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
