// PHA D13 (Phase D, 2026-05-20) — newsletter subscribe form.
//
// POSTs to /api/public/pha/subscribe which both persists locally
// (app.db.pha_email_subscribers) and forwards a kind=pha-subscribe submission
// to TCG-External-API-Svc /v1/intake/submission so the operator gets an email.
(function(){
  var form = document.getElementById('d13-form');
  if (!form) return;
  var status = document.getElementById('d13-status');

  function setStatus(msg, color){
    status.textContent = msg;
    status.style.color = color || 'var(--muted)';
  }

  form.addEventListener('submit', async function(ev){
    ev.preventDefault();
    var email = document.getElementById('d13-email').value.trim().toLowerCase();
    var statesRaw = document.getElementById('d13-states').value.trim();
    var conditionsRaw = document.getElementById('d13-conditions').value.trim();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)){
      setStatus('Enter a valid email address.', '#fca5a5');
      return;
    }
    var states = statesRaw ? statesRaw.split(/[,\s]+/).map(function(s){ return s.trim().toUpperCase(); }).filter(Boolean) : [];
    var conditions = conditionsRaw ? conditionsRaw.split(/[,\s]+/).map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean) : [];
    setStatus('Subscribing…');
    try {
      var r = await fetch('https://api.thatcomputerguy26.org/api/public/pha/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, states: states, conditions: conditions }),
      });
      var j = await r.json();
      if (!j.ok){
        setStatus('Could not subscribe: ' + (j.error || 'unknown error'), '#fca5a5');
        return;
      }
      setStatus(j.message || 'Subscribed. Your first digest arrives within 24h.', '#86efac');
      // Reset form fields except remember email.
      document.getElementById('d13-states').value = '';
      document.getElementById('d13-conditions').value = '';
    } catch (e) {
      setStatus('Network error: ' + e.message, '#fca5a5');
    }
  });
})();
