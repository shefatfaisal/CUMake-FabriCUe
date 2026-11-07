import {applyClosetRequest, calendarDay, validTimezone} from './closet-logic.js';
import {command, scanCommand, signalForItems, SIGNAL_LABELS} from './indicator.js';
const copy = value => JSON.parse(JSON.stringify(value));

export function applyAppRequest(current, request, now, operationId) {
  if (current?.appliedRequests?.[operationId]) return current;
  const base = copy(current || {settings: {timezone: request.timezone}, items: {}});
  if (!validTimezone(base.settings?.timezone)) throw Error('Choose a valid wardrobe timezone.');
  base.settings.processing = 'app';
  if (base.settings.mode !== 'demo') {
    base.settings.mode = 'demo';
    // Switching from daily counting must not re-consume historical detections.
    base.settings.demoSince = now;
  }
  let next;
  if (request.kind === 'indicatorTest') {
    if (!SIGNAL_LABELS[request.value]) throw Error('Invalid indicator signal.');
    command(base, request.value, operationId, now, 'test');
    next = base;
  } else if (request.kind === 'laundryCheck') {
    const ids = request.itemIds;
    const tags = request.tags;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200
      || !Array.isArray(tags) || tags.length > 10000
      || tags.some(tag => typeof tag !== 'string' || !tag || tag.length > 256)) throw Error('Invalid laundry check.');
    const items = ids.map(id => base.items?.[String(id)]);
    if (items.some(item => !item)) throw Error('Selected clothing changed. Restart the laundry check.');
    const expected = new Set(items.map(item => item.profile.rfid).filter(Boolean));
    const detected = new Set(tags);
    const matches = items.every(item => item.profile.rfid && detected.has(item.profile.rfid))
      && [...detected].every(tag => expected.has(tag));
    command(base, matches ? 'a' : 'd', operationId, now, 'laundryCheck', ids);
    next = base;
  } else if (request.kind === 'bedroomReturn') {
    const ids = request.itemIds;
    const tags = request.tags;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length
      || !Array.isArray(tags) || tags.length > 10000
      || tags.some(tag => typeof tag !== 'string' || !tag || tag.length > 256)) throw Error('Invalid bedroom check.');
    const items = ids.map(id => base.items?.[String(id)]);
    const detected = new Set(tags);
    if (items.some(item => !item || !item.profile.inLaundry || !item.profile.rfid || !detected.has(item.profile.rfid)))
      throw Error('Scan every item in this laundry load before finishing.');
    for (const item of items) {
      item.tracking.wears = 0;
      item.tracking.washCount = (item.tracking.washCount || 0) + 1;
      item.tracking.trackingSince = now;
      item.profile.inLaundry = false;
    }
    command(base, 'a', operationId, now, 'bedroomReturn', ids);
    next = base;
  } else if (request.kind === 'configure') next = base;
  else if (request.kind === 'manualWear') {
    const item = base.items?.[String(request.itemId)];
    if (!item) throw Error('Clothing no longer exists.');
    if (item.profile.inLaundry) throw Error('Finish this item’s laundry load first.');
    next = applyDemoScans(base, [{id: 'manual-' + operationId, tagId: item.profile.rfid,
      itemId: request.itemId, receivedAt: now, manual: true}], now);
  } else next = applyClosetRequest(base, request, now);
  for (const item of Object.values(next.items || {})) {
    item.tracking.remainingWears = Math.max(0, item.profile.limit - item.tracking.wears);
  }
  if (!next.output && Object.keys(next.items || {}).length) {
    const ids = Object.values(next.items).map(item => item.profile.id);
    command(next, signalForItems(next, ids), operationId, now, 'registration', ids);
  }
  next.appliedRequests ||= {};
  next.appliedRequests[operationId] = true;
  return next;
}

// One stored event consumes one allowance, regardless of the calendar date.
// Marking the event and changing the allowance happen in the SAME transaction.
export function applyDemoScans(current, scans, now) {
  if (!current?.settings || current.settings.processing !== 'app') return current || null;
  const next = copy(current);
  next.processedScans ||= {};
  for (const scan of [...scans].sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id))) {
    if (next.processedScans[scan.id]) continue;
    if (typeof scan.id !== 'string' || typeof scan.tagId !== 'string' && !scan.manual
      || !Number.isSafeInteger(scan.receivedAt) || scan.receivedAt < 0) continue;
    const item = scan.manual ? next.items?.[String(scan.itemId)]
      : Object.values(next.items || {}).find(item => item.profile.rfid === scan.tagId);
    if (next.settings.connectionId && scan.connectionId !== next.settings.connectionId && !scan.manual) {
      next.processedScans[scan.id] = {outcome:'previous-connection', receivedAt:scan.receivedAt, processedAt:now};
      continue;
    }
    let outcome = 'unregistered';
    if (item) {
      if (!scan.manual && scan.receivedAt <= Math.max(item.tracking.trackingSince, next.settings.demoSince || 0)) outcome = 'before-registration';
      else if (item.profile.inLaundry) outcome = 'laundry';
      else {
        const tracking = item.tracking;
        const day = calendarDay(scan.receivedAt, next.settings.timezone);
        tracking.wornDates ||= {};
        tracking.wornDates[day] = true;
        tracking.last = tracking.last > day ? tracking.last : day;
        if (tracking.wears < item.profile.limit) { tracking.wears++; outcome = 'counted'; }
        else outcome = 'limit-reached';
        tracking.remainingWears = Math.max(0, item.profile.limit - tracking.wears);
        scanCommand(next, item.profile.id, scan.id, scan.receivedAt);
      }
    }
    next.processedScans[scan.id] = {outcome, itemId: item?.profile.id || null, receivedAt: scan.receivedAt, processedAt: now};
  }
  if (next.output?.source === 'scan') {
    const value = signalForItems(next, next.output.itemIds || []);
    if (value !== next.output.value) command(next, value, 'recalc-' + scans.at(-1)?.id,
      next.output.createdAt, 'scan', next.output.itemIds, next.output.groupStartedAt);
  }
  return next;
}
