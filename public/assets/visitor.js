// PublicHealthAlert visitor counter — pings TCGAPI's
// /api/proxy/visitor/ping which keys by origin+path. Fire-and-forget;
// degrades silently if the API is unreachable so it never visibly errors.
(function(){
  var api = 'https://api.thatcomputerguy26.org';
  var path = location.pathname || '/';
  fetch(api + '/api/proxy/visitor/ping', {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, referrer: document.referrer || '' })
  })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      var el = document.getElementById('visitor-line');
      if (!el || !d || typeof d.count !== 'number') return;
      el.textContent = 'Visitor #' + d.count.toLocaleString() + ' on this page';
    })
    .catch(function(){ /* silent */ });
})();
