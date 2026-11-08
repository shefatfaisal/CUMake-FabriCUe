import {wardrobeWearStats, wardrobeOnlyPrediction} from './wardrobe-schedule.js';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  isGoogleCalendarConfigured,
  isGoogleCalendarConnected,
  suggestFromGoogleCalendar,
  clearGoogleCalendarSession
} from './google-calendar.js';

function currentStats() {
  const loadIds = s.load?.ids || [];
  return wardrobeWearStats(s.clothes || [], {cart: s.cart || [], loadIds, today: s.date});
}

function predictionFromStats(stats) {
  return wardrobeOnlyPrediction(stats, s.date);
}

laundryPrediction = function() {
  return predictionFromStats(currentStats());
};

function autoPanelHtml(d) {
  const p = d.prediction || {};
  const connected = isGoogleCalendarConnected();
  const configured = isGoogleCalendarConfigured();
  const emptyWardrobe = /add everyday tops and bottoms/i.test(p.reason || '');
  const heading = emptyWardrobe
    ? 'ADD CLOTHING FIRST'
    : p.calendar
      ? (p.slotFound === false ? 'NO FREE SLOT FOUND' : (p.days === 0 ? 'LAUNDRY TODAY' : fmt(p.date)))
      : (p.days === 0 ? 'LAUNDRY TODAY' : `IN ${p.days} DAY${p.days === 1 ? '' : 'S'}`);
  const status = connected ? 'Google Calendar connected' : 'Wardrobe estimate';
  const actions = connected
    ? `<button type="button" class="auto-refresh" onclick="refreshAutoSuggestion()" aria-label="Refresh calendar suggestion">↻ Refresh</button>
       <button type="button" class="auto-disconnect" onclick="disconnectGoogleCalendarUI()">Disconnect</button>`
    : `<button type="button" class="btn primary" onclick="connectGoogleCalendarUI()">${configured ? 'CONNECT CALENDAR' : 'SET UP CALENDAR'}</button>`;
  const note = emptyWardrobe ? '<p class="sub">Add everyday tops and bottoms to get a suggestion.</p>'
    : p.slotFound === false ? '<p class="sub">Choose a date and time below.</p>' : '';
  return `<div class="sheet lime auto-suggestion">
    <span class="auto-eyebrow">SUGGESTED LAUNDRY</span>
    <div class="auto-slot"><h3>${heading}</h3>${!emptyWardrobe && p.slotFound !== false ? `<span class="auto-time">${esc(d.time || p.time || '18:00')}</span>` : ''}</div>
    <div class="auto-source"><span aria-hidden="true">${connected ? '✓' : '◷'}</span> ${status}</div>
    ${note}<div class="auto-panel-actions">${actions}</div>
  </div>`;
}

paintSchedule = function() {
  if (!scheduleDraft) return;
  const d = scheduleDraft;
  const editing = Number.isInteger(d.editIndex);
  topModal(editing ? 'EDIT LAUNDRY PLAN' : 'PLAN YOUR WASH',
    `<div class="chips">
      <button class="chip ${!d.auto ? 'active' : ''}" onclick="scheduleDraft.auto=false;paintSchedule()">MANUAL</button>
      <button class="chip ${d.auto ? 'active' : ''}" onclick="useAutoSchedule()">AUTO SUGGESTION</button>
    </div>`
    + (d.auto ? autoPanelHtml(d) : '')
    + `<label>Date</label>
    <button class="schedule-field" onclick="schedulePicker=schedulePicker==='date'?'':'date';paintSchedule()">${dt(d.date).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})}<span>▦</span></button>
    ${schedulePicker === 'date' ? datePickerHtml() : ''}
    <label>Time</label>
    <button class="schedule-field" onclick="schedulePicker=schedulePicker==='time'?'':'time';paintSchedule();if(schedulePicker==='time')positionTimeWheels()">${d.time}<span>↕</span></button>
    ${schedulePicker === 'time' ? timePickerHtml() : ''}
    <label for="schedule-title">Title</label>
    <input id="schedule-title" maxlength="60" value="${esc(d.label)}" oninput="scheduleDraft.label=this.value">
    <button type="button" class="btn primary" style="width:100%" onclick="savePlan()">${editing ? 'SAVE CHANGES ➜' : 'SAVE PLAN ➜'}</button>`
  );
};

useAutoSchedule = async function() {
  if (!scheduleDraft) {
    const prediction = laundryPrediction();
    scheduleDraft = {date: prediction.date, time: prediction.time || '18:00', label: 'Laundry day', auto: true, prediction};
    scheduleMonth = dt(scheduleDraft.date);
  }
  scheduleDraft.auto = true;
  schedulePicker = '';
  const stats = currentStats();
  try {
    if (isGoogleCalendarConnected()) {
      scheduleDraft.prediction = await suggestFromGoogleCalendar(stats);
    } else {
      scheduleDraft.prediction = predictionFromStats(stats);
    }
    scheduleDraft.date = scheduleDraft.prediction.date;
    scheduleDraft.time = scheduleDraft.prediction.time || '18:00';
    scheduleMonth = dt(scheduleDraft.date);
    bumpScheduleIfPast(scheduleDraft);
    paintSchedule();
  } catch (error) {
    const clean = shortError(error);
    scheduleDraft.prediction = predictionFromStats(stats);
    scheduleDraft.prediction.reason = `${clean} Showing a wardrobe-only estimate instead.`;
    scheduleDraft.date = scheduleDraft.prediction.date;
    scheduleDraft.time = scheduleDraft.prediction.time || '18:00';
    scheduleMonth = dt(scheduleDraft.date);
    bumpScheduleIfPast(scheduleDraft);
    paintSchedule();
    toast(clean);
  }
};

function shortError(error) {
  const raw = String(error?.message || error || 'Calendar suggestion failed.');
  if (raw.length > 220 || raw.trim().startsWith('{')) {
    return 'Google Calendar could not be read. Enable the Calendar API and add your Gmail as a Test user, then try again.';
  }
  return raw;
}

window.connectGoogleCalendarUI = async function() {
  if (!isGoogleCalendarConfigured()) {
    return toast('Paste your Google OAuth Web Client ID into server/web/google-calendar-config.js, then reload.');
  }
  try {
    toast('Connecting Google Calendar…');
    await connectGoogleCalendar();
    toast('Google Calendar connected.');
    await useAutoSchedule();
  } catch (error) {
    toast(error?.message || 'Could not connect Google Calendar.');
    paintSchedule();
  }
};

window.disconnectGoogleCalendarUI = function() {
  disconnectGoogleCalendar();
  toast('Google Calendar disconnected. Using wardrobe-only suggestions.');
  void useAutoSchedule();
};

window.refreshAutoSuggestion = function() {
  void useAutoSchedule();
};

window.smartLaundryGoogleCalendar = {
  clearSession: clearGoogleCalendarSession,
  isConnected: isGoogleCalendarConnected,
  isConfigured: isGoogleCalendarConfigured
};
