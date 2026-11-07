import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {applyAppRequest, applyDemoScans} from '../server/web/demo-processing.js';
import {toProfile, toSeed, fromCloud, signature} from '../server/web/closet-data.js';
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

async function browser(localClothes = [], initial = {}, stored = {}) {
  const source = (await readFile(new URL('../server/web/closet-sync.js', import.meta.url), 'utf8'))
    .replace(/^import\s[\s\S]*?;\s*$/gm, '').replace('export function connectCloset', 'function connectCloset');
  const tree = clone(initial), listeners = new Map();
  const storage = {...stored};
  const clientId = crypto.randomUUID();
  let local = clone(localClothes), state, counter = 0;
  const read = path => path.split('/').reduce((node, part) => node?.[part], tree) ?? null;
  function publish(path, value) {
    const parts = path.split('/'); let node = tree;
    for (const key of parts.slice(0, -1)) node = node[key] ||= {};
    node[parts.at(-1)] = clone(value);
    for (const [watched, callbacks] of listeners) {
      if (path === watched || path.startsWith(watched + '/') || watched.startsWith(path + '/')) {
        for (const cb of callbacks) cb({val: () => clone(read(watched))});
      }
    }
  }
  const context = vm.createContext({
    localStorage: {getItem: key => storage[key] ?? null, setItem: (key, value) => {storage[key] = value;}},
    window: {laundryRfid: {getLocalClothes: () => clone(local),
      applyCloudClothes(value) { local = clone(value); },
      cloudStatus(value) { state = value; }, notify() {}}},
    getDatabase: () => ({}), ref: (_, path) => path,
    push: path => ({path: path + '/' + clientId + (++counter), key: clientId + counter}),
    runTransaction: async (path, update) => {
      const result = update(clone(read(path)));
      publish(path, result);
      return {committed: true, snapshot: {val: () => clone(result)}};
    },
    get: async path => ({val: () => clone(read(path))}),
    onValue(path, callback) {
      const list = listeners.get(path) || new Set(); list.add(callback); listeners.set(path, list);
      queueMicrotask(() => callback({val: () => clone(read(path))}));
      return () => list.delete(callback);
    },
    set: async (reference, value) => {
      const path = reference.path || reference;
      publish(path, value);

    },
    applyAppRequest, applyDemoScans, toProfile, toSeed, fromCloud, signature, Intl, Map, Set, Promise, setTimeout, clearTimeout
  });
  vm.runInContext(source, context);
  publish('.info/connected', true);
  const api = context.connectCloset({});
  for (let i = 0; i < 10; i++) await tick();
  return {api, tree, publish, storage, get local() { return local; }, get state() { return state; }};
}
const clothing = {id: 1, name: 'Shirt', type: 'Shirt', color: '#2255aa', limit: 5,
  rfid: 'TAG-A', wears: 3, last: '', wornDates: [], photo: 'data:image/png;base64,AAAA'};

test('browser migrates existing profiles/photos/counts and a fresh browser restores them', async () => {
  const a = await browser([clothing]);
  assert.equal(a.state.error, '');
  assert.equal(a.state.ready, true);
  assert.equal(a.tree.closet.items[1].tracking.wears, 3);
  assert.equal(Object.values(a.tree.clothingPhotos)[0], clothing.photo);
  assert.equal(a.local[0].photo, clothing.photo);
  const b = await browser([], a.tree);
  assert.equal(b.local[0].rfid, 'TAG-A');
  assert.equal(b.local[0].photo, clothing.photo);
  assert.equal(b.local[0].wears, 3);
});

test('editing a profile does not send tracking changes or erase a concurrent scan', async () => {
  const a = await browser([clothing]);
  const current = a.tree.closet;
  const next = applyDemoScans(current, [{id:'scan', tagId: 'TAG-A', receivedAt: Date.now() + 1000}], Date.now());
  a.publish('closet', next);
  assert.equal(a.local[0].wears, 4);
  a.api.save([{...a.local[0], name: 'Edited', wears: 999}], null);
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(a.tree.closet.items[1].profile.name, 'Edited');
  assert.equal(a.tree.closet.items[1].tracking.wears, 4);
  assert.equal(a.local[0].wears, 4);
});

test('offline profile edits remain pending and sync when the connection returns', async () => {
  const a = await browser([clothing]);
  a.publish('.info/connected', false);
  a.api.save([{...a.local[0], name: 'Offline edit'}], null);
  assert.equal(a.state.pending, 1);
  assert.equal(a.tree.closet.items[1].profile.name, 'Shirt');
  a.publish('.info/connected', true);
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(a.tree.closet.items[1].profile.name, 'Offline edit');
  assert.equal(a.state.pending, 0);
});


test('an offline edit remains queued across a browser reload', async () => {
  const a = await browser([clothing]);
  a.publish('.info/connected', false);
  const edited = {...a.local[0], name: 'Saved offline before closing'};
  a.api.save([edited], null);
  assert.deepEqual(JSON.parse(a.storage['smart-laundry-cloud-pending-v1']), ['1']);
  const b = await browser([edited], a.tree, a.storage);
  assert.equal(b.tree.closet.items[1].profile.name, edited.name);
  assert.equal(b.state.pending, 0);
  assert.deepEqual(JSON.parse(b.storage['smart-laundry-cloud-pending-v1']), []);
});

test('the open app processes new and missed scan events once, with no daily restriction', async () => {
  const a = await browser([clothing]);
  const since = a.tree.closet.items[1].tracking.trackingSince;
  const scans = [
    {id:'registration',tagId:'TAG-A',receivedAt:since},
    {id:'one',tagId:'TAG-A',receivedAt:since+100},
    {id:'two',tagId:'TAG-A',receivedAt:since+200}
  ];
  a.api.processScans(scans);
  for (let i=0;i<10;i++) await tick();
  assert.equal(a.tree.closet.items[1].tracking.remainingWears,0);
  assert.equal(a.tree.closet.processedScans.registration.outcome,'before-registration');
  a.api.processScans(scans);
  for (let i=0;i<10;i++) await tick();
  assert.equal(a.tree.closet.items[1].tracking.wears,5);
  const b = await browser([], a.tree);
  b.api.processScans([...scans,{id:'missed-while-closed',tagId:'TAG-A',receivedAt:since+300}]);
  for (let i=0;i<10;i++) await tick();
  assert.equal(b.tree.closet.processedScans['missed-while-closed'].outcome,'limit-reached');
  assert.equal(b.tree.closet.items[1].tracking.remainingWears,0);
});


test('app mirrors commands for ESP32 and distinguishes matching acknowledgements', async () => {
  const a = await browser([clothing]);
  assert.equal(a.tree.signal.value,'a');
  await a.api.testIndicator('d');
  assert.equal(a.tree.signal.value,'d');
  assert.equal(a.tree.closet.items[1].tracking.wears,3);
  a.publish('acknowledgement',{commandId:a.tree.signal.commandId,value:'d',appliedAt:Date.now()});
  assert.equal(a.state.acknowledgement.commandId,a.state.output.commandId);
  await a.api.testIndicator('b');
  assert.equal(a.tree.signal.value,'b');
  assert.notEqual(a.state.acknowledgement.commandId,a.state.output.commandId,'old confirmation does not confirm new command');
});

test('fresh-session app uploads photos and commands with the current connection ID',async()=>{
  const id='boot-session0001';
  const initial={status:{session:{connectionId:id,phase:'ready'}},closet:{settings:{processing:'app',mode:'demo',timezone:'UTC',connectionId:id,demoSince:1}}};
  const a=await browser([{...clothing,wears:0}],initial,{'smart-laundry-connection-id':id});
  assert.equal(a.state.error,'');
  const photo=Object.values(a.tree.clothingPhotos)[0];
  assert.equal(photo.connectionId,id);
  assert.equal(photo.data,clothing.photo);
  assert.equal(a.tree.signal.connectionId,id);
  const since=a.tree.closet.items[1].tracking.trackingSince;
  a.api.processScans([{id:'old',tagId:'TAG-A',receivedAt:since+100,connectionId:'old-connection'},
    {id:'new',tagId:'TAG-A',receivedAt:since+200,connectionId:id}]);
  for(let i=0;i<10;i++)await tick();
  assert.equal(a.tree.closet.items[1].tracking.remainingWears,4);
  assert.equal(a.tree.closet.processedScans.old.outcome,'previous-connection');
});
