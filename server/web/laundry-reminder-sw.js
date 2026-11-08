// Displays page-triggered notifications; it does not schedule background alarms.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const existing = windows.find(client => new URL(client.url).pathname === '/smart-laundry.html');
    if (existing) return existing.focus();
    return self.clients.openWindow('/smart-laundry.html');
  })());
});
