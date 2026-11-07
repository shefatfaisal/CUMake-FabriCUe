import {GOOGLE_CLIENT_ID, GOOGLE_CALENDAR_SCOPE, GOOGLE_TOKEN_STORAGE_KEY} from './google-calendar-config.js';
import {suggestFreeSlot, formatSlotReason, HORIZON_DAYS} from './wardrobe-schedule.js';

let gsiLoading = null;

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeStored(value) {
  if (!value) localStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
  else localStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, JSON.stringify(value));
}

export function clearGoogleCalendarSession() {
  writeStored(null);
}

export function isGoogleCalendarConfigured() {
  return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 0;
}

export function isGoogleCalendarConnected() {
  const stored = readStored();
  return Boolean(stored?.accessToken);
}

function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiLoading) return gsiLoading;
  gsiLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-smart-laundry-gsi]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Google sign-in.')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.dataset.smartLaundryGsi = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(script);
  });
  return gsiLoading;
}

async function ensureAccessToken({interactive}) {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('Add a Google OAuth Web Client ID in google-calendar-config.js to connect Calendar.');
  }
  const stored = readStored();
  if (stored?.accessToken && stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
  await loadGsi();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID.trim(),
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: response => {
        if (response.error) {
          reject(new Error(explainGoogleAuthError(response.error, response.error_description)));
          return;
        }
        const expiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
        writeStored({accessToken: response.access_token, expiresAt});
        resolve(response.access_token);
      },
      error_callback: err => reject(new Error(explainGoogleAuthError(err?.type || err?.message, err?.message)))
    });
    client.requestAccessToken({prompt: interactive ? 'consent' : ''});
  });
}

function explainGoogleAuthError(code, detail) {
  const text = `${code || ''} ${detail || ''}`.toLowerCase();
  if (text.includes('access_denied') || text.includes('verification') || text.includes('not completed')) {
    return 'Google blocked sign-in because SmartLaundry is still in Testing. In Google Cloud → OAuth consent screen, add your Gmail under Test users, then try Connect again.';
  }
  if (text.includes('popup') || text.includes('closed')) {
    return 'Google sign-in was cancelled. Open Connect again and finish the Google prompt.';
  }
  return detail || code || 'Could not connect Google Calendar.';
}

export async function connectGoogleCalendar() {
  await ensureAccessToken({interactive: true});
  return true;
}

export function disconnectGoogleCalendar() {
  const stored = readStored();
  if (stored?.accessToken && window.google?.accounts?.oauth2?.revoke) {
    try { window.google.accounts.oauth2.revoke(stored.accessToken, () => {}); } catch { /* ignore */ }
  }
  clearGoogleCalendarSession();
}

export async function listBusyRange({timeMin, timeMax}) {
  const token = await ensureAccessToken({interactive: false});
  const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      items: [{id: 'primary'}]
    })
  });
  if (response.status === 401) {
    clearGoogleCalendarSession();
    throw new Error('Google Calendar session expired. Connect again.');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(explainGoogleApiError(response.status, text));
  }
  const data = await response.json();
  const busy = data.calendars?.primary?.busy || [];
  return busy.map(block => ({
    start: new Date(block.start).getTime(),
    end: new Date(block.end).getTime()
  })).filter(block => Number.isFinite(block.start) && Number.isFinite(block.end));
}

function explainGoogleApiError(status, body) {
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* plain text */ }
  const message = parsed?.error?.message || '';
  const reason = parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || '';
  const blob = `${message} ${reason} ${body || ''}`.toLowerCase();
  if (blob.includes('accessnotconfigured') || blob.includes('service_disabled') || blob.includes('has not been used') || blob.includes('is disabled')) {
    return 'Google Calendar API is not enabled for this Cloud project. In Google Cloud, enable “Google Calendar API”, wait a minute, then tap Refresh from Calendar.';
  }
  if (blob.includes('access_denied') || blob.includes('verification')) {
    return 'Google blocked Calendar access. Add your Gmail as an OAuth Test user, then connect again.';
  }
  if (status === 403) return 'Google Calendar permission was denied. Check Calendar API is enabled and your account is a Test user.';
  if (status === 429) return 'Google Calendar rate limit hit. Wait a moment and try again.';
  if (message && message.length < 180) return message;
  return 'Could not read Google Calendar busy times. Check Calendar API setup and try again.';
}

export async function suggestFromGoogleCalendar(stats, now = Date.now()) {
  const needByDate = stats?.needByDate || new Date(now).toISOString().slice(0, 10);
  const timeMin = now;
  const timeMax = now + HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const busy = await listBusyRange({timeMin, timeMax});
  const slot = suggestFreeSlot({needByDate, busy, now});
  return {
    date: slot?.date || needByDate,
    time: slot?.time || '18:00',
    days: stats?.daysLeft ?? 0,
    percentUsed: stats?.percentUsed ?? 0,
    reason: formatSlotReason(slot, stats),
    calendar: true,
    slotFound: Boolean(slot)
  };
}
