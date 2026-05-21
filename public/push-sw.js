// PublicHealthAlert push service worker (D15, Phase D, 2026-05-20).
//
// Receives Web Push messages from TCG-API-Svc (operator-triggered) and
// displays them. Limited to 1/day cadence by operator policy.
self.addEventListener('install',  function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(event){
  var data = { title: 'PublicHealthAlert', body: 'New outbreak signal.', url: '/' };
  if (event.data) {
    try { data = Object.assign(data, event.data.json()); }
    catch (e) {
      try { data.body = event.data.text(); } catch(e2) {}
    }
  }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/og-card.svg',
    badge: '/og-card.svg',
    data: { url: data.url || '/' },
    requireInteraction: false,
    tag: data.tag || 'pha-daily',
  }));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
    for (var i=0; i<clientList.length; i++){
      if (clientList[i].url.indexOf(self.location.origin) === 0) return clientList[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});
