import test from 'node:test';
import assert from 'node:assert/strict';
import {applyClosetRequest, applyScan, calendarDay} from '../server/web/closet-logic.js';
import {fromCloud, toProfile} from '../server/web/closet-data.js';

const at = iso => Date.parse(iso);
const profile = {id: 1, name: 'Blue shirt', type: 'Shirt', color: '#2255aa', limit: 5, rfid: 'TAG-A'};
const initial = () => applyClosetRequest(null, {kind: 'import', timezone: 'America/New_York',
  items: {'1': {profile, seed: {wears: 3, wornDates: ['2026-11-01'], last: '2026-11-01'}}}}, at('2026-11-05T12:00:00Z'));

test('migration preserves counts, history and tag; repeated imports cannot overwrite cloud state', () => {
  const closet = initial();
  assert.equal(closet.items[1].tracking.wears, 3);
  assert.equal(closet.items[1].profile.rfid, 'TAG-A');
  const next = applyScan(closet, {tagId: 'TAG-A', receivedAt: at('2026-11-05T13:00:00Z')}, 'scan').closet;
  const repeated = applyClosetRequest(next, {kind: 'import', items: {'1': {profile, seed: {wears: 0}}}}, Date.now());
  assert.equal(repeated.items[1].tracking.wears, 4);
  assert.equal(next.items[1].tracking.wornDates['2026-11-01'], true);
});

test('repeated scans, retried events and out-of-order events count at most once per local calendar day', () => {
  let closet = initial();
  const scan = {tagId: 'TAG-A', receivedAt: at('2026-11-05T13:00:00Z')};
  closet = applyScan(closet, scan, 'one').closet;
  assert.equal(applyScan(closet, scan, 'one').outcome, 'already-counted');
  closet = applyScan(closet, {...scan, receivedAt: at('2026-11-05T23:00:00Z')}, 'two').closet;
  assert.equal(closet.items[1].tracking.wears, 4);
  closet = applyScan(closet, {...scan, receivedAt: at('2026-11-07T13:00:00Z')}, 'three').closet;
  closet = applyScan(closet, {...scan, receivedAt: at('2026-11-06T13:00:00Z')}, 'four').closet;
  assert.equal(closet.items[1].tracking.wears, 6);
  assert.equal(closet.items[1].tracking.last, '2026-11-07');
});

test('timezone boundaries, DST, old history, unknown tags, and active laundry are handled', () => {
  assert.equal(calendarDay(at('2026-11-06T04:59:00Z'), 'America/New_York'), '2026-11-05');
  assert.equal(calendarDay(at('2026-11-06T05:00:00Z'), 'America/New_York'), '2026-11-06');
  assert.equal(calendarDay(at('2026-11-01T05:30:00Z'), 'America/New_York'), calendarDay(at('2026-11-01T06:30:00Z'), 'America/New_York'));
  const closet = initial();
  assert.equal(applyScan(closet, {tagId: 'TAG-A', receivedAt: at('2026-11-04T13:00:00Z')}, 'old').outcome, 'before-registration');
  assert.equal(applyScan(closet, {tagId: 'UNKNOWN', receivedAt: Date.now()}, 'unknown').outcome, 'unregistered');
  closet.items[1].profile.inLaundry = true;
  assert.equal(applyScan(closet, {tagId: 'TAG-A', receivedAt: at('2026-11-05T13:00:00Z')}, 'wash').outcome, 'laundry');
});

test('profile edits preserve computed tracking and reject stale edits and duplicate tag assignments', () => {
  const closet = initial();
  const edited = applyClosetRequest(closet, {kind: 'save', items: {'1': {profile: {...profile, name: 'Updated'}, revision: 1, seed: {wears: 99}}}}, Date.now());
  assert.equal(edited.items[1].tracking.wears, 3);
  assert.equal(edited.items[1].profile.name, 'Updated');
  assert.throws(() => applyClosetRequest(edited, {kind: 'save', items: {'1': {profile, revision: 1}}}, Date.now()), /another app/);
  assert.throws(() => applyClosetRequest(closet, {kind: 'save', items: {'2': {profile: {...profile, id: 2}}}}, Date.now()), /already assigned/);
  const c = fromCloud(edited.items[1], 'data:image/png;base64,AAAA');
  assert.equal(c.photo, 'data:image/png;base64,AAAA');
  assert.equal(toProfile(c).rfid, 'TAG-A');
});
