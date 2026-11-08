/**
 * Paste your Google Cloud OAuth 2.0 Web Client ID here to enable Connect Google Calendar.
 * Enable the Google Calendar API and add authorized JavaScript origins for:
 * - http://localhost:8000
 * - https://lightlink-cbe74.web.app
 * - capacitor://localhost (iOS Capacitor) when testing on device
 *
 * Leave empty to keep wardrobe-only AUTO suggestions.
 */
export const GOOGLE_CLIENT_ID = '290585835974-5rtkm06mc0hdq63pdf27etqc1634qf0b.apps.googleusercontent.com';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_TOKEN_STORAGE_KEY = 'smart-laundry-google-calendar-v1';
