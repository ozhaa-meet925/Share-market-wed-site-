self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }
  const title = String(payload.title || 'ShareMarket Pro').slice(0, 160);
  const body = String(payload.body || 'You have a new account notification.').slice(0, 600);
  const notificationUrl = new URL(payload.url || '/notifications', self.location.origin);
  const safeUrl = notificationUrl.origin === self.location.origin ? notificationUrl.pathname + notificationUrl.search : '/notifications';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: String(payload.tag || `${Date.now()}`),
    renotify: false,
    data: { url: safeUrl },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = new URL(event.notification.data?.url || '/notifications', self.location.origin);
  const target = requested.origin === self.location.origin ? requested.href : `${self.location.origin}/notifications`;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
