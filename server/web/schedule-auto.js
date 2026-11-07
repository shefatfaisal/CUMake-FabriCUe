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
  const heading = p.calendar
    ? (p.slotFound === false ? 'NO FREE SLOT FOUND' : (p.days === 0 ? 'LAUNDRY TODAY' : fmt(p.date)))
    : (p.days === 0 ? 'LAUNDRY TODAY' : `IN ${p.days} DAY${p.days === 1 ? '' : 'S'}`);
  const status = connected
    ? '<p class="sub">Connected to Google Calendar. Suggestions use your busy schedule plus wardrobe wear.</p>'
    : '<p class="sub">Not connected. Suggestion uses how worn your clothes are. Connect Google Calendar to also pick a free day and time from your classes and plans.</p>';
  const actions = connected
    ? `<div class="actions" style="margin-top:10px">
        <button type="button" class="btn" onclick="refreshAutoSuggestion()">REFRESH FROM CALENDAR</button>
        <button type="button" class="btn" onclick="disconnectGoogleCalendarUI()">DISCONNECT</button>
      </div>`
    : `<div class="actions" style="margin-top:10px">
        <button type="button" class="btn primary" onclick="connectGoogleCalendarUI()">${configured ? 'CONNECT GOOGLE CALENDAR' : 'CONNECT GOOGLE CALENDAR (SETUP NEEDED)'}</button>
      </div>`;
  const percent = Number.isFinite(p.percentUsed)
    ? `<p class="sub"><strong>${p.percentUsed}% worn</strong> · about <strong>${p.days}</strong> day${p.days === 1 ? '' : 's'} of wearable clothes left</p>`
    : '';
  return `<div class="sheet lime"><h3>${heading}</h3>${percent}<p>${esc(p.reason || '')}</p>${status}${actions}<p class="sub">You can still adjust the date and time before saving. Reminder stays on this device / iPhone.</p></div>`;
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
    scheduleDraft.prediction = predictionFromStats(stats);
    scheduleDraft.prediction.reason = (error?.message || 'Calendar suggestion failed.') + ' Showing wardrobe-only estimate instead.';
    scheduleDraft.date = scheduleDraft.prediction.date;
    scheduleDraft.time = scheduleDraft.prediction.time || '18:00';
    scheduleMonth = dt(scheduleDraft.date);
    bumpScheduleIfPast(scheduleDraft);
    paintSchedule();
    toast(error?.message || 'Could not use Google Calendar.');
  }
};

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
