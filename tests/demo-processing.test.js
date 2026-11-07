import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAppRequest, applyDemoScans} from '../server/web/demo-processing.js';
const profile = {id:1,name:'Shirt',type:'Shirt',color:'#2255aa',limit:5,rfid:'TAG-A'};
function initial() {
  return applyAppRequest(null,{kind:'import',timezone:'America/New_York',items:{'1':{profile,seed:{wears:0}}}},1000,'registration');
}
test('registration and old history do not consume allowance; each separate same-day event does',()=>{
  let closet=initial();
  closet=applyDemoScans(closet,[{id:'registration',tagId:'TAG-A',receivedAt:1000}],2000);
  assert.equal(closet.items[1].tracking.remainingWears,5);
  const scans=[{id:'one',tagId:'TAG-A',receivedAt:2000},{id:'two',tagId:'TAG-A',receivedAt:3000}];
  closet=applyDemoScans(closet,scans,4000);
  assert.equal(closet.items[1].tracking.remainingWears,3);
  closet=applyDemoScans(closet,scans,5000);
  assert.equal(closet.items[1].tracking.remainingWears,3);
});
test('missed events process on reopening, unknown tags do not count, and remaining never goes below zero',()=>{
  let closet=initial();
  const scans=Array.from({length:10},(_,i)=>({id:'event'+i,tagId:'TAG-A',receivedAt:2000+i}));
  closet=applyDemoScans(closet,[...scans,{id:'unknown',tagId:'OTHER',receivedAt:3000}],4000);
  assert.equal(closet.items[1].tracking.remainingWears,0);
  assert.equal(closet.processedScans.unknown.outcome,'unregistered');
});
test('switching an existing wardrobe to app/demo mode preserves counts and excludes old events',()=>{
  let closet=initial();
  delete closet.settings.mode;
  closet.items[1].tracking.wears=2;
  closet=applyAppRequest(closet,{kind:'configure'},5000,'switch');
  closet=applyDemoScans(closet,[{id:'old',tagId:'TAG-A',receivedAt:4000}],6000);
  assert.equal(closet.items[1].tracking.remainingWears,3);
  assert.equal(closet.processedScans.old.outcome,'before-registration');
});

test('finishing a laundry check sends green only for a complete matching load', () => {
  const closet = initial();
  for (const [tags, value] of [[[], 'd'], [['TAG-A'], 'a'], [['TAG-A', 'EXTRA'], 'd'], [['TAG-A', 'TAG-A'], 'a']]) {
    const next = applyAppRequest(closet, {kind: 'laundryCheck', itemIds: [1], tags}, 5000, 'check');
    assert.equal(next.output.value, value);
    assert.equal(next.output.source, 'laundryCheck');
    assert.equal(next.items[1].tracking.wears, 0);
    assert.equal(applyAppRequest(next, {kind: 'laundryCheck', itemIds: [1], tags}, 6000, 'check').output.revision, next.output.revision);
  }
  assert.throws(() => applyAppRequest(closet, {kind: 'laundryCheck', itemIds: [999], tags: []}, 5000, 'check'), /changed/);
});

test('bedroom return resets wears only after every in-laundry item is scanned', () => {
  let closet = initial();
  closet.items[1].tracking.wears = 3;
  closet.items[1].tracking.remainingWears = 2;
  closet.items[1].tracking.washCount = 1;
  closet.items[1].profile.inLaundry = true;
  assert.throws(() => applyAppRequest(closet, {kind: 'bedroomReturn', itemIds: [1], tags: []}, 5000, 'return-empty'), /Scan every item/);
  assert.throws(() => applyAppRequest(closet, {kind: 'bedroomReturn', itemIds: [1], tags: [123]}, 5000, 'return-bad'), /Invalid bedroom check/);
  closet.items[1].profile.inLaundry = false;
  assert.throws(() => applyAppRequest(closet, {kind: 'bedroomReturn', itemIds: [1], tags: ['TAG-A']}, 5000, 'return-idle'), /Scan every item/);
  closet.items[1].profile.inLaundry = true;
  const next = applyAppRequest(closet, {kind: 'bedroomReturn', itemIds: [1], tags: ['TAG-A', 'EXTRA']}, 6000, 'return-ok');
  assert.equal(next.items[1].tracking.wears, 0);
  assert.equal(next.items[1].tracking.remainingWears, 5);
  assert.equal(next.items[1].tracking.washCount, 2);
  assert.equal(next.items[1].profile.inLaundry, false);
  assert.equal(next.output.value, 'a');
  assert.equal(next.output.source, 'bedroomReturn');
  assert.equal(applyAppRequest(next, {kind: 'bedroomReturn', itemIds: [1], tags: ['TAG-A']}, 7000, 'return-ok').output.revision, next.output.revision);
});
