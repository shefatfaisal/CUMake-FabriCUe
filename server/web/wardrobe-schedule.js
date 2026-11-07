/** Pure wardrobe + free-slot helpers for AUTO laundry suggestions. */

export const TOP_TYPES = new Set(['Shirt', 'T-shirt', 'Long sleeves', 'Sweater', 'Hoodie', 'Dress shirt', 'Gym clothes']);
export const BOTTOM_TYPES = new Set(['Pants', 'Shorts', 'Jeans', 'Sweatpants', 'Dress pants', 'Cargo pants', 'Trousers']);
export const SESSION_MINUTES = 120;
export const HORIZON_DAYS = 14;

/** Weekday evenings 18–21, weekend days 10–18 (local). */
export function laundryWindowForDate(dateIso) {
  const day = new Date(dateIso + 'T12:00:00').getDay();
  const weekend = day === 0 || day === 6;
  return weekend
    ? {startHour: 10, endHour: 18}
    : {startHour: 18, endHour: 21};
}

export function clothingGroup(type) {
  if (BOTTOM_TYPES.has(type)) return 'bottom';
  if (TOP_TYPES.has(type)) return 'top';
  return 'other';
}

function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysIso(dateIso, days) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return isoFromDate(d);
}

/**
 * @param {Array<{type:string,limit:number,wears:number,id?:any}>} clothes
 * @param {{cart?:any[], loadIds?:any[], today?:string}} opts
 */
export function wardrobeWearStats(clothes, opts = {}) {
  const today = opts.today || isoFromDate(new Date());
  const cart = new Set(opts.cart || []);
  const loadIds = new Set(opts.loadIds || []);
  const tracked = (clothes || []).filter(c => {
    const group = clothingGroup(c.type);
    if (group === 'other') return false;
    if (cart.has(c.id) || loadIds.has(c.id)) return false;
    return Number.isFinite(c.limit) && c.limit > 0;
  });

  if (!tracked.length) {
    return {
      percentUsed: 0,
      daysLeft: 0,
      readyTops: 0,
      readyBottoms: 0,
      needByDate: today,
      reason: 'Add everyday tops and bottoms so AUTO can estimate how long your wardrobe will last.',
      empty: true
    };
  }

  let totalLimit = 0;
  let totalWorn = 0;
  const byGroup = {top: [], bottom: []};
  for (const item of tracked) {
    const limit = Math.max(1, Number(item.limit) || 1);
    const wears = Math.max(0, Math.min(limit, Number(item.wears) || 0));
    totalLimit += limit;
    totalWorn += wears;
    byGroup[clothingGroup(item.type)].push({limit, wears, remaining: Math.max(0, limit - wears)});
  }

  const percentUsed = Math.round((totalWorn / totalLimit) * 100);
  const readyTops = byGroup.top.filter(i => i.remaining > 0).length;
  const readyBottoms = byGroup.bottom.filter(i => i.remaining > 0).length;
  const low = (byGroup.top.length && readyTops <= 1) || (byGroup.bottom.length && readyBottoms <= 1);

  const groupDays = ['top', 'bottom']
    .filter(g => byGroup[g].length)
    .map(g => byGroup[g].reduce((n, i) => n + i.remaining, 0));
  // Assume one top + one bottom per day; buffer one day when not urgent.
  let daysLeft = low ? 0 : Math.max(0, Math.min(...groupDays) - 1);
  const needByDate = addDaysIso(today, daysLeft);

  const reason = low
    ? `About ${percentUsed}% of your tracked wardrobe allowance is used. You have one or fewer ready tops or bottoms left, so schedule laundry today.`
    : `About ${percentUsed}% of your tracked wardrobe allowance is used. At this pace, wearable clothes last about ${daysLeft} more day${daysLeft === 1 ? '' : 's'}. Schedule laundry around +${daysLeft} day${daysLeft === 1 ? '' : 's'} (${needByDate}).`;

  return {percentUsed, daysLeft, readyTops, readyBottoms, needByDate, reason, empty: false};
}

export function wardrobeOnlyPrediction(stats, today) {
  const day = today || isoFromDate(new Date());
  if (!stats || stats.empty) {
    return {date: day, time: '18:00', days: 0, percentUsed: 0, reason: stats?.reason || 'Add clothing to estimate laundry.', calendar: false};
  }
  return {
    date: stats.needByDate,
    time: '18:00',
    days: stats.daysLeft,
    percentUsed: stats.percentUsed,
    reason: stats.reason,
    calendar: false
  };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * @param {{needByDate:string, busy:Array<{start:number,end:number}>, now?:number, sessionMinutes?:number, horizonDays?:number}} args
 */
export function suggestFreeSlot({needByDate, busy = [], now = Date.now(), sessionMinutes = SESSION_MINUTES, horizonDays = HORIZON_DAYS}) {
  const sessionMs = sessionMinutes * 60 * 1000;
  const startDay = needByDate || isoFromDate(new Date(now));
  for (let offset = 0; offset <= horizonDays; offset++) {
    const date = addDaysIso(startDay, offset);
    const {startHour, endHour} = laundryWindowForDate(date);
    const windowStart = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`).getTime();
    const windowEnd = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00`).getTime();
    for (let t = windowStart; t + sessionMs <= windowEnd; t += 30 * 60 * 1000) {
      if (t < now) continue;
      const end = t + sessionMs;
      const blocked = busy.some(block => overlaps(t, end, block.start, block.end));
      if (!blocked) {
        const at = new Date(t);
        const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
        return {date, time, at: t, sessionMinutes};
      }
    }
  }
  return null;
}

export function formatSlotReason(slot, stats) {
  if (!slot) {
    return 'No free 2-hour laundry window found in the next two weeks during preferred hours. Pick a time manually or free a calendar slot.';
  }
  const when = new Date(`${slot.date}T${slot.time}:00`);
  const label = when.toLocaleString(undefined, {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  const wear = stats && !stats.empty
    ? ` Wardrobe is about ${stats.percentUsed}% worn (~${stats.daysLeft} day${stats.daysLeft === 1 ? '' : 's'} left).`
    : '';
  return `Free at ${label} based on your Google Calendar.${wear}`;
}
