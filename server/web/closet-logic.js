export function calendarDay(timestamp, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(timestamp));
}
export function validTimezone(timezone) {
  try { calendarDay(0, timezone); return typeof timezone === 'string' && timezone.length <= 80; }
  catch { return false; }
}
const copy = value => JSON.parse(JSON.stringify(value));
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function profileValue(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 0
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60
    || typeof value.type !== 'string' || !value.type.length || value.type.length > 80
    || !/^#[a-f0-9]{6}$/i.test(value.color)
    || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 30
    || (value.rfid != null && (typeof value.rfid !== 'string' || !value.rfid.trim() || value.rfid.length > 256))
    || (value.photoKey && !/^[A-Za-z0-9_-]{1,100}$/.test(value.photoKey))) {
    throw Error('Invalid clothing details. Check name, color, tag ID, and wear limit.');
  }
  return {id: value.id, name: value.name, type: value.type, color: value.color,
    colorName: String(value.colorName || '').slice(0, 40), limit: value.limit,
    limitMode: value.limitMode === 'auto' ? 'auto' : 'manual', rfid: value.rfid || null,
    photoKey: value.photoKey || null, inLaundry: value.inLaundry === true};
}

// Shared profile validation and migration reducers, called by app transactions.
export function applyClosetRequest(current, request, now) {
  if (!request || !['import', 'save', 'manualWear'].includes(request.kind)) throw Error('Invalid closet request.');
  const closet = copy(current || {settings: {timezone: request.timezone}, items: {}});
  closet.items ||= {};
  if (!validTimezone(closet.settings?.timezone)) throw Error('Choose a valid wardrobe timezone.');
  if (request.kind === 'manualWear') {
    const item = closet.items[String(request.itemId)];
    if (!item) throw Error('Clothing no longer exists.');
    recordWear(item, now, closet.settings.timezone, 'manual');
    return closet;
  }
  const entries = Object.entries(request.items || {});
  if (!entries.length || entries.length > 200) throw Error('Save between 1 and 200 clothing items at a time.');
  for (const [id, incoming] of entries) {
    const profile = profileValue(incoming.profile);
    if (String(profile.id) !== id) throw Error('Clothing ID does not match its record.');
    const existing = closet.items[id];
    if (request.kind === 'import' && existing) {
      if ((existing.profile.rfid || null) !== profile.rfid) throw Error('An existing cloud item has a different tag. Your local backup was preserved.');
      continue; // A second browser's old cache must not overwrite cloud changes.
    }
    if (existing && incoming.revision !== existing.revision) throw Error('This item changed in another app. Reload before editing it again.');
    const seed = incoming.seed || {};
    const days = [...new Set((Array.isArray(seed.wornDates) ? seed.wornDates : []).filter(day => dayPattern.test(day)))];
    const last = dayPattern.test(seed.last || '') ? seed.last : '';
    if (last && !days.includes(last)) days.push(last);
    const tracking = existing?.tracking || {
      wears: Number.isInteger(seed.wears) && seed.wears >= 0 && seed.wears <= 9999 ? seed.wears : 0,
      washCount: Number.isInteger(seed.washCount) && seed.washCount >= 0 && seed.washCount <= 9999 ? seed.washCount : 0,
      wornDates: Object.fromEntries(days.map(day => [day, true])),
      countedDays: Object.fromEntries(days.map(day => [day, true])), last,
      trackingSince: now, historyPartial: seed.historyPartial === true
    };
    // Changing a tag starts a fresh scan boundary; preserve all wear history.
    if (existing && (existing.profile.rfid || null) !== profile.rfid) tracking.trackingSince = now;
    closet.items[id] = {profile, tracking, revision: (existing?.revision || 0) + 1};
  }
  const owners = new Map();
  for (const item of Object.values(closet.items)) {
    const tag = item.profile.rfid;
    if (!tag) continue;
    if (owners.has(tag)) throw Error('RFID tag ' + tag + ' is already assigned to another clothing item.');
    owners.set(tag, item.profile.id);
  }
  return closet;
}

function recordWear(item, timestamp, timezone, scanId) {
  if (item.profile.inLaundry) return 'laundry';
  const day = calendarDay(timestamp, timezone);
  const tracking = item.tracking;
  tracking.countedDays ||= {};
  tracking.wornDates ||= {};
  if (tracking.countedDays[day]) return 'already-counted';
  tracking.countedDays[day] = scanId;
  tracking.wornDates[day] = true;
  tracking.wears++;
  tracking.last = tracking.last > day ? tracking.last : day;
  return 'counted';
}

export function applyScan(current, scan, scanId) {
  if (!current || !scan || typeof scan.tagId !== 'string'
    || !Number.isSafeInteger(scan.receivedAt) || scan.receivedAt < 0) return {closet: current, outcome: 'invalid-or-unregistered'};
  const closet = copy(current);
  const item = Object.values(closet.items || {}).find(value => value.profile.rfid === scan.tagId);
  if (!item) return {closet: current, outcome: 'unregistered'};
  // Registration scans and saved history must not become wear events.
  if (scan.receivedAt <= item.tracking.trackingSince) return {closet: current, outcome: 'before-registration'};
  const outcome = recordWear(item, scan.receivedAt, closet.settings.timezone, scanId);
  return {closet, outcome, itemId: item.profile.id, day: calendarDay(scan.receivedAt, closet.settings.timezone)};
}
