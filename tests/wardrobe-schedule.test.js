import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wardrobeWearStats,
  wardrobeOnlyPrediction,
  suggestFreeSlot,
  formatSlotReason,
  laundryWindowForDate
} from '../server/web/wardrobe-schedule.js';

test('wardrobe wear stats report percent used and +X days left', () => {
  const stats = wardrobeWearStats([
    {id: 1, type: 'T-shirt', limit: 5, wears: 2},
    {id: 2, type: 'T-shirt', limit: 5, wears: 1},
    {id: 3, type: 'Jeans', limit: 5, wears: 1},
    {id: 5, type: 'Sweatpants', limit: 4, wears: 0},
    {id: 4, type: 'Coat', limit: 10, wears: 9}
  ], {today: '2026-11-07'});
  assert.equal(stats.empty, false);
  assert.equal(stats.percentUsed, 21); // 4/19 tops+bottoms worn
  assert.ok(stats.daysLeft >= 1);
  assert.match(stats.reason, /About 21%/);
  assert.match(stats.reason, /\+/);
  const prediction = wardrobeOnlyPrediction(stats, '2026-11-07');
  assert.equal(prediction.date, stats.needByDate);
  assert.equal(prediction.time, '18:00');
  assert.equal(prediction.calendar, false);
});

test('urgent wardrobe forces laundry today', () => {
  const stats = wardrobeWearStats([
    {id: 1, type: 'T-shirt', limit: 3, wears: 3},
    {id: 2, type: 'Jeans', limit: 4, wears: 0}
  ], {today: '2026-11-07'});
  assert.equal(stats.daysLeft, 0);
  assert.equal(stats.needByDate, '2026-11-07');
  assert.match(stats.reason, /today/i);
});

test('laundry windows differ for weekdays and weekends', () => {
  assert.deepEqual(laundryWindowForDate('2026-11-09'), {startHour: 18, endHour: 21}); // Monday
  assert.deepEqual(laundryWindowForDate('2026-11-08'), {startHour: 10, endHour: 18}); // Sunday
});

test('free-slot picker skips busy blocks and past times', () => {
  const needByDate = '2026-11-09'; // Monday
  const windowStart = new Date('2026-11-09T18:00:00').getTime();
  const busy = [{start: windowStart, end: windowStart + 60 * 60 * 1000}];
  const slot = suggestFreeSlot({
    needByDate,
    busy,
    now: new Date('2026-11-09T12:00:00').getTime(),
    sessionMinutes: 120
  });
  assert.ok(slot);
  assert.equal(slot.date, '2026-11-09');
  assert.equal(slot.time, '19:00');
  const reason = formatSlotReason(slot, {percentUsed: 40, daysLeft: 2, empty: false});
  assert.match(reason, /Google Calendar/);
  assert.match(reason, /40%/);
  assert.equal(suggestFreeSlot({
    needByDate,
    busy: [{start: windowStart, end: windowStart + 4 * 60 * 60 * 1000}],
    now: new Date('2026-11-09T12:00:00').getTime(),
    horizonDays: 0
  }), null);
});
