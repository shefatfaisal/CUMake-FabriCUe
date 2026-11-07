import {getDatabase, ref, push, set, get, onValue, runTransaction} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import {toProfile, toSeed, fromCloud, signature} from './closet-data.js';
import {applyAppRequest, applyDemoScans} from './demo-processing.js';

// The open app computes updates and commits them atomically to Firebase.
export function connectCloset(app) {
  const database = getDatabase(app);
  let ready = false, connected = false, error = '', syncing = false;
  let scanQueue = [], processing = false, serverTimeOffset = 0;
  let acknowledgement = null, paused = false, sessionId = null, generation = 0;
  let closet = {items: {}}, photos = {}, pending = new Map(), inflight = new Set();
  const observed = new Map(), photoKeys = new Map();
  const outboxKey = 'smart-laundry-cloud-pending-v1';
  let restoredIds = [];
  try { restoredIds = JSON.parse(localStorage.getItem(outboxKey) || '[]'); } catch {}
  if (!Array.isArray(restoredIds)) restoredIds = [];
  function unpackPhotos(value) {return Object.fromEntries(Object.entries(value || {}).map(([key, photo]) => [key, typeof photo === 'string' ? photo : photo.data]));}
  function persistOutbox() {
    try { localStorage.setItem(outboxKey, JSON.stringify([...new Set([...pending.keys(), ...inflight])])); } catch {}
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const api = window.laundryCloud = {
    pauseForReset() { paused = true; ready = false; generation++; pending.clear(); inflight.clear(); scanQueue = []; error = 'ESP32 reconnected · resetting all demo data…'; status(); },
    get ready() { return ready; },
    async finishLaundryCheck(itemIds, tags) {
      if (!ready || !connected || paused) throw Error('Wait for the live Firebase connection before finishing the check.');
      await send({kind: 'laundryCheck', itemIds, tags});
      status();
      return closet.output.value;
    },
    async finishBedroomReturn(itemIds, tags) {
      if (!ready || !connected || paused) throw Error('Wait for the live Firebase connection.');
      await flush();
      await send({kind: 'bedroomReturn', itemIds, tags});
      await refresh();
    },
    async testIndicator(value) {
      if (!ready || !connected) return window.laundryRfid.notify('Wait for Firebase before testing the indicator.');
      try { await send({kind: 'indicatorTest', value}); await publishSignal(); status(); }
      catch (failure) { error = failure.message; status(); }
    },
    save(clothes, load) {
      if (paused) return;
      for (const clothing of clothes) {
        const profile = toProfile(clothing, load ? load.ids.includes(clothing.id) : clothing.inLaundry === true);
        const key = String(clothing.id), serialized = signature(profile);
        if (observed.get(key) === serialized) continue;
        observed.set(key, serialized);
        pending.set(key, {profile, seed: toSeed(clothing)});
      }
      persistOutbox();
      status();
      if (ready && !error) void flush();
    },
    processScans(scans) { scanQueue = scans; void processScans(); },
    async manualWear(itemId) {
      if (!ready || !connected) { window.laundryRfid.notify('Wait for the cloud connection before recording wear.'); return; }
      try {
        await send({kind: 'manualWear', itemId});
        await refresh();
        window.laundryRfid.notify('One wear used. Remaining allowance updated.');
      } catch (failure) { error = failure.message; status(); }
    },
    retry() { error = ''; status(); if (ready) void refresh().then(() => flush()).catch(failure => {error = failure.message; status();}); else void initialize(); void processScans(); }
  };
  function status() {
    window.laundryRfid.cloudStatus({ready, connected, pending: pending.size + inflight.size + (processing ? 1 : 0),
      error, timezone: closet.settings?.timezone || timezone, output: closet.output || null, acknowledgement});
  }
  function hydrate() {
    if (paused) return;
    const clothes = Object.entries(closet.items || {}).map(([id, item]) => {
      const dirty = pending.get(id);
      if (inflight.has(id) && !dirty) return window.laundryRfid.getLocalClothes().find(c => String(c.id) === id)
        || fromCloud(item, photos[item.profile.photoKey]);
      const clothing = fromCloud(item, photos[item.profile.photoKey]);
      if (dirty) Object.assign(clothing, dirty.profile);
      else observed.set(id, signature(toProfile(clothing)));
      return clothing;
    });
    const known = new Set(clothes.map(c => String(c.id)));
    for (const clothing of window.laundryRfid.getLocalClothes()) {
      if (!known.has(String(clothing.id)) && (pending.has(String(clothing.id)) || inflight.has(String(clothing.id)))) clothes.push(clothing);
    }
    window.laundryRfid.applyCloudClothes(clothes);
  }
  async function refresh() {
    closet = (await get(ref(database, 'closet'))).val() || {items: {}};
    hydrate(); status();
    if (connected) await publishSignal();
  }
  async function send(request) {
    if (paused) throw Error('Connection reset in progress.');
    const expectedSession = sessionId;
    const operationId = push(ref(database, 'closetOperations')).key;
    const now = Date.now() + serverTimeOffset;
    let issue = '';
    const result = await runTransaction(ref(database, 'closet'), current => {
      try {
        issue = '';
        if ((current?.settings?.connectionId || null) !== expectedSession) throw Error('Connection changed. Reload the app.');
        return applyAppRequest(current, {...request, timezone}, now, operationId);
      } catch (failure) { issue = failure.message; return current || null; }
    }, {applyLocally: false});
    if (!result.committed || issue) throw Error(issue || 'Could not save clothing. Check your connection and database rules.');
    closet = result.snapshot.val() || {items: {}};
    await publishSignal();
  }
  async function processScans() {
    if (paused || !ready || !connected || error || processing || syncing) return;
    processing = true; status();
    try {
      let unseen;
      while ((unseen = scanQueue.filter(scan => !closet.processedScans?.[scan.id]).slice(0, 200)).length) {
        const result = await runTransaction(ref(database, 'closet'), current =>
          ((current?.settings?.connectionId || null) === sessionId && !paused ? applyDemoScans(current, unseen, Date.now() + serverTimeOffset) : current), {applyLocally: false});
        if (!result.committed || !result.snapshot.val()?.settings || paused || (result.snapshot.val().settings.connectionId || null) !== sessionId) throw Error('Could not save scan processing.');
        closet = result.snapshot.val() || {items: {}};
        hydrate();
        await publishSignal();
      }
    } catch (failure) { error = failure.message; }
    finally { processing = false; status(); }
  }
  async function publishSignal() {
    if (paused) return;
    const expectedSession = sessionId;
    const output = closet.output;
    if (!output) return;
    await runTransaction(ref(database, 'signal'), current => {
      if (current && current.revision >= output.revision) return current;
      return {...output, connectionId: expectedSession};
    }, {applyLocally: false});
  }
  async function encodeItems(entries) {
    const items = {};
    for (const [id, entry] of entries) {
      const profile = {...entry.profile};
      const photo = profile.photo;
      delete profile.photo;
      let photoKey = null;
      if (photo) {
        photoKey = photoKeys.get(photo);
        if (!photoKey) {
          const asset = push(ref(database, 'clothingPhotos'));
          if (paused) throw Error('Connection reset in progress.');
          await set(asset, sessionId ? {data: photo, connectionId: sessionId} : photo);
          photoKey = asset.key; photoKeys.set(photo, photoKey); photos[photoKey] = photo;
        }
      }
      profile.photoKey = photoKey;
      items[id] = {profile, seed: entry.seed, revision: closet.items?.[id]?.revision || 0};
    }
    return items;
  }
  async function flush() {
    if (syncing || !ready || !connected || error || !pending.size) return;
    syncing = true;
    const version = generation;
    const batch = new Map([...pending.entries()].slice(0, 200));
    for (const [id] of batch) { pending.delete(id); inflight.add(id); }
    persistOutbox();
    status();
    try {
      const items = await encodeItems(batch);
      await send({kind: 'save', items});
      inflight.clear();
      await refresh();
    } catch (failure) {
      if (version !== generation) return;
      for (const [id, entry] of batch) if (!pending.has(id)) pending.set(id, entry);
      inflight.clear(); error = failure.message;
    } finally { syncing = false; persistOutbox(); status(); }
    if (!error && pending.size) void flush();
    else if (!error) void processScans();
  }
  async function initialize() {
    try {
      if (paused) return;
      const session = (await get(ref(database, 'status/session'))).val();
      sessionId = session?.connectionId || null;
      if (session?.phase === 'resetting') { api.pauseForReset(); return; }
      if (sessionId && window.laundryRfid.resetForConnection) {
        if (localStorage.getItem('smart-laundry-connection-id') !== sessionId) { api.pauseForReset(); window.laundryRfid.resetForConnection(sessionId); return; }
      }
      // Read before importing; permission failures must not replace local storage.
      closet = (await get(ref(database, 'closet'))).val() || {items: {}};
      await send({kind: 'configure'});
      const local = window.laundryRfid.getLocalClothes();
      for (const c of local) {
        const id = String(c.id);
        if (restoredIds.includes(id) && !pending.has(id)) pending.set(id, {profile: toProfile(c), seed: toSeed(c)});
      }
      photos = unpackPhotos((await get(ref(database, 'clothingPhotos'))).val());
      for (const [key, photo] of Object.entries(photos)) photoKeys.set(photo, key);
      for (let offset = 0; offset < local.length; offset += 200) {
        const entries = local.slice(offset, offset + 200).map(c => [String(c.id), {profile: toProfile(c), seed: toSeed(c)}]);
        await send({kind: 'import', items: await encodeItems(entries)});
      }
      closet = (await get(ref(database, 'closet'))).val() || {items: {}};
      if (paused) return;
      ready = true;
      // Changes made during migration are retained and queued, not replaced.
      for (const c of local) if (!observed.has(String(c.id))) observed.set(String(c.id), signature(toProfile(c)));
      onValue(ref(database, 'clothingPhotos'), snapshot => {
        if (paused) return;
        photos = unpackPhotos(snapshot.val());
        for (const [key, photo] of Object.entries(photos)) photoKeys.set(photo, key);
        hydrate();
      }, failure => { error = failure.message; status(); });
      onValue(ref(database, 'closet'), snapshot => {
        if (paused) return;
        closet = snapshot.val() || {items: {}};
        hydrate(); status();
        if (connected) void publishSignal().catch(failure => {error = failure.message; status();});
      }, failure => { error = failure.message; status(); });
      await refresh();
      void flush();
      void processScans();
    } catch (failure) { error = failure.message; status(); }
  }
  onValue(ref(database, 'acknowledgement'), snapshot => {acknowledgement = snapshot.val(); status();}, failure => {error = failure.message; status();});
  onValue(ref(database, '.info/serverTimeOffset'), snapshot => {serverTimeOffset = Number(snapshot.val()) || 0;});
  onValue(ref(database, '.info/connected'), snapshot => {
    connected = snapshot.val() === true; status();
    if (connected && ready && !error) { void flush(); void processScans(); }
  });
  status();
  void initialize();
  return api;
}
