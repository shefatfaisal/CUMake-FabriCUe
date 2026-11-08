// Browser-only reminders. Native builds use OS-scheduled LocalNotifications.
(() => {
  const storageKey = 'smart-laundry-web-reminders-v1';
  let delivered;
  try { delivered = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { delivered = []; }
  if (!Array.isArray(delivered)) delivered = [];
  let registration;
  if ('serviceWorker' in navigator) {
    registration = navigator.serviceWorker.register('/laundry-reminder-sw.js').catch(() => null);
  }
  async function notify(event, key) {
    const title = 'Time for laundry';
    const body = event.label || 'Your scheduled laundry time has arrived.';
    toast(title + ' · ' + body);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const worker = await registration;
      if (worker?.active) await worker.showNotification(title, {body, tag: key, data: {url: '/smart-laundry.html'}});
      else {
        const notification = new Notification(title, {body, tag: key});
        notification.onclick = () => { window.focus(); go('Calendar'); notification.close(); };
      }
    } catch { /* The in-app reminder remains available if the browser blocks delivery. */ }
  }
  function check() {
    const now = Date.now();
    for (const event of s.events || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) continue;
      const at = new Date(event.date + 'T' + event.time + ':00').getTime();
      // Catch up briefly after a suspended tab resumes, without replaying old plans.
      if (!Number.isFinite(at) || at > now || now - at > 5 * 60 * 1000) continue;
      const key = JSON.stringify([localStorage.getItem('smart-laundry-connection-id'), event.date, event.time, event.label]);
      if (delivered.includes(key)) continue;
      delivered = [...delivered, key].slice(-200);
      try { localStorage.setItem(storageKey, JSON.stringify(delivered)); } catch {}
      void notify(event, key);
    }
  }
  const originalSavePlan = savePlan;
  savePlan = function(...args) {
    if (scheduleDraft && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }
    return originalSavePlan.apply(this, args);
  };
  setInterval(check, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  check();
})();
