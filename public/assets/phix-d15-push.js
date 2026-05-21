// PHA D15 (Phase D, 2026-05-20) — Web Push enrollment.
//
// Registers /push-sw.js, fetches the VAPID public key from
// /api/public/push/vapid-public, calls PushManager.subscribe(), and POSTs the
// subscription to /api/public/push/subscribe with site='publichealthalert'.
// 1-push/day operator cap is enforced server-side; the UI just informs.
(function(){
  var stateEl = document.getElementById('d15-state');
  var btnEnable = document.getElementById('d15-enable');
  var btnDisable = document.getElementById('d15-disable');
  if (!stateEl || !btnEnable) return;

  function setState(msg, kind){
    stateEl.textContent = msg;
    stateEl.style.color = kind === 'err' ? '#fca5a5' : (kind === 'ok' ? '#86efac' : 'var(--muted)');
  }

  function urlBase64ToUint8Array(b64){
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i=0; i<raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)){
    setState('Push notifications not supported in this browser.', 'err');
    return;
  }
  if (location.protocol !== 'https:'){
    setState('Push requires HTTPS. Visit https://publichealthalert.netlify.app/', 'err');
    return;
  }

  var reg = null;
  var vapidKey = null;
  var current = null;

  async function init(){
    try {
      reg = await navigator.serviceWorker.register('/push-sw.js');
      current = await reg.pushManager.getSubscription();

      // Fetch VAPID public key.
      var r = await fetch('https://api.thatcomputerguy26.org/api/public/push/vapid-public', { cache: 'no-store' });
      var j = await r.json();
      if (!j.ok){
        setState('Push backend not yet configured: ' + (j.error || ''), 'err');
        return;
      }
      vapidKey = j.public_key;

      refreshUi();
    } catch (e) {
      setState('Push setup error: ' + e.message, 'err');
    }
  }

  function refreshUi(){
    if (current){
      setState('Push alerts enabled (max 1/day). You can disable any time.', 'ok');
      btnEnable.disabled = true;
      btnDisable.disabled = false;
    } else {
      setState('Click below to enable browser push alerts (max 1/day).');
      btnEnable.disabled = false;
      btnDisable.disabled = true;
    }
  }

  btnEnable.addEventListener('click', async function(){
    btnEnable.disabled = true;
    setState('Requesting permission…');
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted'){
        setState('Permission denied. You can re-enable from the browser site-settings panel.', 'err');
        btnEnable.disabled = false;
        return;
      }
      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      var subJson = sub.toJSON();
      var r = await fetch('https://api.thatcomputerguy26.org/api/public/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: 'publichealthalert', subscription: subJson }),
      });
      var j = await r.json();
      if (!j.ok){
        setState('Subscribe rejected: ' + (j.error || 'unknown'), 'err');
        try { await sub.unsubscribe(); } catch(e){}
        btnEnable.disabled = false;
        return;
      }
      current = sub;
      refreshUi();
    } catch (e) {
      setState('Subscribe error: ' + e.message, 'err');
      btnEnable.disabled = false;
    }
  });

  btnDisable.addEventListener('click', async function(){
    btnDisable.disabled = true;
    setState('Unsubscribing…');
    try {
      if (current){
        var endpoint = current.endpoint;
        await current.unsubscribe();
        await fetch('https://api.thatcomputerguy26.org/api/public/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: endpoint }),
        });
      }
      current = null;
      refreshUi();
    } catch (e) {
      setState('Unsubscribe error: ' + e.message, 'err');
      btnDisable.disabled = false;
    }
  });

  init();
})();
