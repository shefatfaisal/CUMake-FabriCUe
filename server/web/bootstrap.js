// Dynamic import makes SDK download failures visible instead of leaving a frozen page.
const status = document.querySelector('#status');
let loaded = false;
const timer = setTimeout(() => {
  if (!loaded) status.textContent = 'Firebase is taking too long to load. Check your connection and refresh.';
}, 12000);
import('./scans.js?v=scans-1').then(() => {
  loaded = true;
  clearTimeout(timer);
}).catch(error => {
  clearTimeout(timer);
  status.textContent = 'Could not load Firebase. Check your connection or browser blockers, then refresh.';
  console.error('Firebase startup failed', error);
});
