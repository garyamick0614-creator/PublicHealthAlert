// national-surveillance.js (2026-06-06)
// Surfaces the surveillance.db corpus that was previously unused by any page:
//   /api/public/surveillance/summary   -> CDC NNDSS national disease case table (1,849 rows)
//   /api/public/surveillance/outbreaks -> global outbreak newsroom (2,377 items)
// Standalone IIFE, no deps. Renders into #surv-host (injected if absent).
(function () {
  "use strict";
  var API = "https://api.thatcomputerguy26.org";
  function esc(s){ return (s==null?"":String(s)).replace(/[&<>"']/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];}); }
  function num(n){ n=Number(n)||0; return n.toLocaleString("en-US"); }
  function host(){
    var h = document.getElementById("surv-host");
    if (h) return h;
    var main = document.getElementById("main"); if (!main) return null;
    var sec = document.createElement("section");
    sec.className = "section"; sec.id = "surv-host";
    sec.setAttribute("aria-labelledby","survTitle");
    sec.innerHTML =
      '<div class="section-head"><h2 id="survTitle" class="section-title">National disease surveillance &middot; CDC NNDSS</h2></div>' +
      '<p class="section-sub" style="color:var(--muted)">Reportable-disease case counts compiled from the CDC National Notifiable Diseases Surveillance System, plus a live global outbreak newsroom. Updated daily.</p>' +
      '<div id="surv-diseases" style="overflow-x:auto"></div>' +
      '<h3 class="section-title" style="font-size:1.05rem;margin:22px 0 10px">Global outbreak newsroom</h3>' +
      '<div id="surv-news"></div>';
    // Insert before the world map section if present, else append to main.
    var mapSec = document.getElementById("mapPreviewTitle");
    if (mapSec && mapSec.closest("section")) main.insertBefore(sec, mapSec.closest("section"));
    else main.appendChild(sec);
    return sec;
  }
  function renderDiseases(d){
    var box = document.getElementById("surv-diseases"); if (!box) return;
    var list = (d && d.diseases) || [];
    if (!list.length){ box.innerHTML = '<p style="color:var(--muted)">Surveillance data unavailable right now.</p>'; return; }
    list.sort(function(a,b){ return (Number(b.latest_year_cases)||0)-(Number(a.latest_year_cases)||0); });
    var rows = list.map(function(x){
      return '<tr>' +
        '<td style="padding:8px 10px;font-weight:600">'+esc(x.disease_name||x.disease_slug)+'</td>' +
        '<td style="padding:8px 10px;text-align:right">'+num(x.latest_year_cases)+'</td>' +
        '<td style="padding:8px 10px;text-align:right;color:var(--muted)">'+esc(x.latest_year||"")+'</td>' +
        '<td style="padding:8px 10px;text-align:right;color:var(--muted)">'+num(x.states)+'</td>' +
        '<td style="padding:8px 10px;text-align:right;color:var(--muted)">'+num(x.all_cases)+'</td>' +
      '</tr>';
    }).join("");
    box.innerHTML =
      '<table style="width:100%;border-collapse:collapse;font-size:14px;background:rgba(15,21,46,.42);border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden">' +
      '<thead><tr style="text-align:left;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em">' +
        '<th style="padding:8px 10px">Disease</th><th style="padding:8px 10px;text-align:right">Cases (latest yr)</th>' +
        '<th style="padding:8px 10px;text-align:right">Year</th><th style="padding:8px 10px;text-align:right">States</th>' +
        '<th style="padding:8px 10px;text-align:right">All-time</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderNews(d){
    var box = document.getElementById("surv-news"); if (!box) return;
    var list = (d && d.items) || [];
    if (!list.length){ box.innerHTML = '<p style="color:var(--muted)">No outbreak headlines right now.</p>'; return; }
    box.innerHTML = '<ul style="list-style:none;margin:0;padding:0;display:grid;gap:10px">' +
      list.slice(0,24).map(function(it){
        var date = (it.published_at||"").slice(0,10);
        return '<li style="background:rgba(15,21,46,.42);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 14px">' +
          '<a href="'+esc(it.url)+'" target="_blank" rel="noopener" style="color:var(--text);text-decoration:none;font-weight:600">'+esc(it.title)+'</a>' +
          '<div style="color:var(--muted);font-size:12.5px;margin-top:3px">'+esc(it.source||"")+(date?(" &middot; "+esc(date)):"")+'</div></li>';
      }).join("") + '</ul>';
  }
  function load(){
    if (!host()) return;
    fetch(API+"/api/public/surveillance/summary",{cache:"no-store"})
      .then(function(r){return r.ok?r.json():null;}).then(renderDiseases).catch(function(){});
    fetch(API+"/api/public/surveillance/outbreaks?limit=24",{cache:"no-store"})
      .then(function(r){return r.ok?r.json():null;}).then(renderNews).catch(function(){});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
