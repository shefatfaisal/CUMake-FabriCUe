import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function appBridge(page = 'Scanner') {
  const source = (await readFile(new URL('../server/web/laundry-rfid.js', import.meta.url), 'utf8'))
    .replace("import('./laundry-firebase.js?v=8')", 'Promise.resolve()');
  const elements = new Map();
  const makeElement = () => ({innerHTML: '', value: '', textContent: '', events: {},
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(event, fn) { this.events[event] = fn; }});
  const app = makeElement();
  const modal = makeElement();
  const context = vm.createContext({
    window: {}, page, app, modal, pendingItem: {name: 'New tee'},
    add() {}, cancelTagSetup() { context.pendingItem = null; modal.open = false; },
    finishTagSetup(tag) { context.s.clothes.push({...context.pendingItem, rfid: tag}); context.pendingItem = null; },
    s: {clothes: [{id: 1, name: 'Blue shirt', rfid: 'TAG-A', wears: 2}]},
    closetCard() {return "";}, save() {}, editClothing() {}, render() {}, detail() {}, title: title => title,
    sheet: (heading, body) => `${heading} ${body}`,
    esc: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    topModal(_, html) {
      modal.innerHTML = html; modal.open = true;
      for (const id of ['rfid-error', 'tag-connection']) elements.set(id, makeElement());
    },
    document: {getElementById: id => elements.get(id)},
    Option: function(text, value) { this.text = text; this.value = value; },
    paintLaundryPanel() {}, ensurePanel: () => app,
    launchTimer() { context.launched = true; }, toast(message) { context.message = message; },
    Date, Promise
  });
  vm.runInContext(source, context);
  await Promise.resolve();
  return {context, elements, app, modal};
}

const savedData = {
  connected: true, loaded: true, error: '',
  scans: [{id: 's1', tagId: 'TAG-A', receivedAt: 1000}],
  tags: [{tagId: 'TAG-A', count: 1, firstSeen: 1000, lastSeen: 1000},
    {tagId: '<TAG-B>', count: 1, firstSeen: 2000, lastSeen: 2000}]
};

test('scanner displays Firebase tags and their local clothing links without changing wear counts', async () => {
  const a = await appBridge();
  a.context.window.laundryRfid.update(savedData);
  assert.match(a.app.innerHTML, /LIVE · FIREBASE/);
  assert.match(a.app.innerHTML, /Blue shirt/);
  assert.match(a.app.innerHTML, /UNLINKED TAG/);
  assert.match(a.app.innerHTML, /&lt;TAG-B&gt;/);
  assert.equal(a.context.s.clothes[0].wears, 2);
  a.context.window.laundryRfid.update(savedData);
  assert.equal(a.context.s.clothes[0].wears, 2, 'replayed history does not add wears');
  a.context.window.laundryRfid.update({...savedData, connected: false});
  assert.match(a.app.innerHTML, /OFFLINE/);
  a.context.window.laundryRfid.update({...savedData, error: 'Cannot read scans'});
  assert.match(a.app.innerHTML, /Cannot read scans/);
});

test('automatic enrollment ignores history and links a fresh tag exactly once', async () => {
  const a = await appBridge('Wardrobe');
  a.context.window.laundryRfid.update(savedData);
  a.context.tagView();
  a.context.window.laundryRfid.update(savedData);
  assert.equal(a.context.s.clothes.length, 1, 'old snapshots cannot link clothing');
  const scan = {id: 'new-event', tagId: 'TAG-NEW', receivedAt: Date.now() + 100};
  const next = {...savedData, scans: [scan, ...savedData.scans]};
  a.context.window.laundryRfid.update(next);
  assert.equal(a.context.s.clothes.length, 2);
  assert.equal(a.context.s.clothes[1].rfid, 'TAG-NEW');
  a.context.window.laundryRfid.update(next);
  assert.equal(a.context.s.clothes.length, 2, 'same event cannot assign twice');
});

test('assigned tags and ambiguous batches do not overwrite clothing', async () => {
  const a = await appBridge('Wardrobe');
  a.context.window.laundryRfid.update(savedData);
  a.context.tagView();
  a.context.window.laundryRfid.update({...savedData, scans: [
    {id: 'repeat', tagId: 'TAG-A', receivedAt: Date.now() + 100}, ...savedData.scans]});
  assert.match(a.elements.get('rfid-error').textContent, /already linked/);
  assert.equal(a.context.s.clothes.length, 1);
  a.context.window.laundryRfid.update({...savedData, scans: [
    {id: 'one', tagId: 'B', receivedAt: Date.now() + 100},
    {id: 'two', tagId: 'C', receivedAt: Date.now() + 100}, ...savedData.scans]});
  assert.match(a.elements.get('rfid-error').textContent, /Several tags/);
  assert.equal(a.context.s.clothes.length, 1);
});

test('loading history before connection and closing the dialog cannot assign a tag', async () => {
  const a = await appBridge('Wardrobe');
  a.context.tagView();
  a.context.window.laundryRfid.update(savedData);
  assert.equal(a.context.s.clothes.length, 1, 'first load establishes baseline');
  a.modal.open = false;
  a.context.window.laundryRfid.update({...savedData, scans: [
    {id: 'new', tagId: 'B', receivedAt: Date.now() + 100}, ...savedData.scans]});
  assert.equal(a.context.s.clothes.length, 1);
});

test('skipping a clothing item preserves its wear count in the supplied app', async () => {
  const html = await readFile(new URL('../smart-laundry.html', import.meta.url), 'utf8');
  const source = html.match(/^function chooseSwipe\(right\).*$/m)?.[0];
  assert.ok(source);
  const clothing = {id: 1, name: 'Shirt', wears: 5, limit: 5};
  const context = vm.createContext({swipeBusy: false, availableReview: () => [clothing],
    reviewSkipped: [], skippedReviewIds: null, s: {cart: [], logs: [], date: '2026-11-05'},
    save() {}, toast() {}, render() {}});
  vm.runInContext(source, context);
  context.chooseSwipe(false);
  assert.equal(clothing.wears, 5);
  assert.equal(context.reviewSkipped[0], 1);
});

test('new connections clear local clothing and pending edits once without refreshing repeatedly', async()=>{
  const a=await appBridge('Wardrobe');
  const stored=new Map([['smart-laundry-cloud-pending-v1','[1]']]);
  let reloads=0;
  a.context.localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  a.context.defaults=()=>({clothes:[],date:'2026-11-05',cart:[],load:null});
  a.context.dt=value=>new Date(value+'T12:00:00');
  a.context.window.location={reload(){reloads++;}};
  a.context.window.laundryRfid.resetForConnection('boot-0001');
  assert.equal(a.context.s.clothes.length,0);
  assert.equal(stored.has('smart-laundry-cloud-pending-v1'),false);
  assert.equal(reloads,1);
  a.context.window.laundryRfid.resetForConnection('boot-0001');
  assert.equal(reloads,1,'same connection cannot clear local data twice');
});


test('laundry check ignores history, deduplicates tags, blocks missing clothes and ignores extra tags', async () => {
  const a = await appBridge('Cart');
  const c = a.context;
  c.s.load = {ids: [1], stage: 'ready'};
  c.window.laundryRfid.update(savedData);
  c.window.startLaundryCheck();
  c.launchTimer({preventDefault() {}}, 'wash');
  assert.equal(c.launched, undefined);
  assert.match(a.app.innerHTML, /MISSING \/ NOT YET SCANNED \(1\)/);
  const scan = {id: 'fresh', tagId: 'TAG-A', receivedAt: Date.now() + 100};
  c.window.laundryRfid.update({...savedData, scans: [scan, ...savedData.scans]});
  assert.match(a.app.innerHTML, /PRESENT \(1\)/);
  c.launchTimer(null, 'wash');
  assert.equal(c.launched, true);
  c.launched = false;
  c.window.laundryRfid.update({...savedData, scans: [scan, {...scan, id: 'extra', tagId: '<UNKNOWN>'}]});
  c.launchTimer({preventDefault() {}}, 'wash');
  assert.equal(c.launched, true);
  assert.doesNotMatch(a.app.innerHTML, /UNEXPECTED|Remove a tag from range/);
  c.window.startLaundryCheck();
  assert.equal(c.s.load.rfidCheck.tags.length, 0);
  c.window.laundryRfid.update({...savedData, scans: [scan]});
  assert.equal(c.s.load.rfidCheck.tags.length, 0, 'restart excludes events already in baseline');
});

test('offline scans cannot satisfy a check and unlinked clothes remain missing', async () => {
  const a = await appBridge('Cart');
  const c = a.context;
  c.s.load = {ids: [1], stage: 'ready'};
  c.window.startLaundryCheck();
  assert.equal(c.s.load.rfidCheck, undefined);
  c.window.laundryRfid.update(savedData);
  c.window.startLaundryCheck();
  const fresh = {id: 'fresh', tagId: 'TAG-A', receivedAt: Date.now() + 100};
  c.window.laundryRfid.update({...savedData, connected: false, scans: [fresh]});
  assert.equal(c.s.load.rfidCheck.tags.length, 0);
  c.s.clothes[0].rfid = null;
  c.window.laundryRfid.update({...savedData, scans: [fresh]});
  assert.match(a.app.innerHTML, /No linked tag/);
  c.launchTimer({preventDefault() {}}, 'wash');
  assert.equal(c.launched, undefined);
});

test('finish checking sends the selected load and scans, and reports failures', async () => {
  const a = await appBridge('Cart');
  const c = a.context;
  c.s.load = {ids: [1], stage: 'ready', rfidCheck: {tags: []}};
  c.window.laundryRfid.update(savedData);
  let sent;
  c.window.laundryCloud = {ready: true, async finishLaundryCheck(ids, tags) { sent = {ids, tags}; return 'd'; }};
  await c.window.finishLaundryCheck();
  assert.equal(sent.ids[0], 1);
  assert.equal(sent.tags.length, 0);
  assert.match(c.message, /Flashing red/);
  c.window.laundryCloud.finishLaundryCheck = async () => { throw Error('Connection changed'); };
  await c.window.finishLaundryCheck();
  assert.match(c.message, /Could not send.*Connection changed/);
});

test('missing-clothes popup shows saved photos, names and a fallback without claiming device acknowledgement', async () => {
  const a = await appBridge('Cart');
  const c = a.context;
  c.s.clothes[0].photo = 'data:image/jpeg;base64,YWJj';
  c.s.clothes.push({id: 2, name: '<White tee>', rfid: 'TAG-B'});
  c.s.load = {ids: [1, 2], stage: 'ready', rfidCheck: {tags: []}};
  c.window.laundryRfid.update(savedData);
  c.window.laundryCloud = {ready: true, async finishLaundryCheck() { return 'd'; }};
  await c.window.finishLaundryCheck();
  assert.equal(a.modal.open, true);
  assert.match(a.modal.innerHTML, /data:image\/jpeg;base64,YWJj/);
  assert.match(a.modal.innerHTML, /Blue shirt/);
  assert.match(a.modal.innerHTML, /&lt;White tee&gt;/);
  assert.match(a.modal.innerHTML, /No photo/);
  assert.match(a.modal.innerHTML, /BACK TO LOAD/);
});

test('bedroom check ignores history and shows photos only for items not returned', async () => {
  const a = await appBridge('Cart');
  const c = a.context;
  c.s.clothes[0].photo = 'data:image/jpeg;base64,YWJj';
  c.s.load = {ids: [1], stage: 'return'};
  c.window.laundryRfid.update(savedData);
  c.window.startBedroomCheck();
  assert.match(a.app.innerHTML, /disabled>CONFIRM RETURN/);
  assert.match(a.app.innerHTML, /LIVE · FIREBASE \/scans/);
  c.window.laundryRfid.update(savedData);
  c.window.finishBedroomCheck();
  assert.match(a.modal.innerHTML, /Not returned to bedroom/);
  assert.match(a.modal.innerHTML, /data:image\/jpeg;base64,YWJj/);
  c.window.laundryRfid.update({...savedData, scans: [
    {id: 'bedroom', tagId: 'TAG-A', receivedAt: Date.now() + 100}, ...savedData.scans]});
  assert.doesNotMatch(a.app.innerHTML, /disabled>CONFIRM RETURN/);
  assert.match(a.app.innerHTML, /All clothes scanned/);
  assert.ok(c.s.load, 'scanning alone must not complete the load');
  c.window.laundryCloud = {ready: true, async finishBedroomReturn(ids, tags) {
    assert.equal(ids[0], 1); assert.equal(tags[0], 'TAG-A');
  }};
  await c.window.finishBedroomCheck();
  assert.equal(c.s.load, null);
  assert.equal(c.s.clothes[0].wears, 2);
});
