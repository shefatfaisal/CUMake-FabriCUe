import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Only the local emulator receives these generated demo credentials.
const project = 'demo-lightlink';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!authHost || !databaseHost) throw new Error('Run npm run test:firebase; never target the live database.');
const databaseURL = `http://${databaseHost}`;

async function account() {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: `test-${crypto.randomUUID()}@example.com`, password: crypto.randomUUID(), returnSecureToken: true})
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function request(path, {token, value, method = 'GET'} = {}) {
  const url = new URL(`${databaseURL}/${path}.json`);
  url.searchParams.set('ns', project);
  if (token) url.searchParams.set('auth', token);
  return fetch(url, {method, headers: {'Content-Type': 'application/json'},
    ...(['PUT','PATCH'].includes(method) ? {body: JSON.stringify(value)} : {})});
}

test('obsolete light paths stay blocked', async () => {
  const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8');
  const load = await fetch(`${databaseURL}/.settings/rules.json?ns=${project}`, {
    method:'PUT', headers:{Authorization:'Bearer owner','Content-Type':'application/json'}, body:rules
  });
  assert.equal(load.status,200);
  const user = await account();
  for (const path of ['latest', 'users', `users/${user.localId}/light`]) {
    assert.equal((await request(path)).status,401);
    assert.equal((await request(path,{method:'PUT',value:'a',token:user.idToken})).status,401);
  }
});

test('raw scans allow public append and read, preserve duplicates, and reject modification and malformed records', async () => {
  const scansPath = `scans/${crypto.randomUUID()}`;
  const value = {tagId: 'E200001234', receivedAt: {'.sv': 'timestamp'}};
  const write = await request(scansPath, {method: 'PUT', value});
  assert.equal(write.status, 200);
  const saved = await (await request(scansPath)).json();
  assert.equal(saved.tagId, value.tagId);
  assert.equal(typeof saved.receivedAt, 'number');
  assert.equal((await request(scansPath, {method: 'PUT', value: saved})).status, 401, 'cannot overwrite a scan');
  assert.equal((await request(scansPath, {method: 'PUT', value: null})).status, 401, 'cannot delete a scan');
  const second = `scans/${crypto.randomUUID()}`;
  assert.equal((await request(second, {method: 'PUT', value})).status, 200, 'repeated tag gets a separate event');
  const all = await request('scans');
  assert.equal(all.status, 200);
  const records = await all.json();
  assert.ok(records[scansPath.split('/')[1]]);
  assert.ok(records[second.split('/')[1]]);
  for (const invalid of ['E200', {tagId: '' , receivedAt: 1}, {tagId: '  ', receivedAt: 1},
    {tagId: 'X'}, {tagId: 12, receivedAt: 1}, {tagId: 'X', receivedAt: 'today'},
    {tagId: 'X', receivedAt: -1}, {tagId: 'X', receivedAt: 1.5},
    {tagId: 'X', receivedAt: Date.now() + 600000}, {tagId: 'X', receivedAt: 1, extra: true}]) {
    assert.equal((await request(`scans/${crypto.randomUUID()}`, {method: 'PUT', value: invalid})).status, 401);
  }
  assert.equal((await request('scans', {method: 'PUT', value: {}})).status, 401, 'cannot clear scan history');
});

test('communication handshake accepts exact public request and response strings', async () => {
  const user = await account();
  const path = 'status/communication';
  assert.equal((await request(path,{method:'PUT',value:'success'})).status,200);
  assert.equal((await request(path,{method:'PUT',value:'success',token:user.idToken})).status,200);
  assert.equal((await request('status/response',{method:'PUT',value:'waiting'})).status,200);
  assert.equal(await (await request(path)).json(),'success');
  assert.equal(await (await request('status/response')).json(),'waiting');
  assert.equal((await request('status/response',{method:'PUT',value:'success'})).status,401);
  for (const value of [null,true,'failed','Successful','successful',{value:'successful'}]) {
    assert.equal((await request(path,{method:'PUT',value})).status,401);
    assert.equal((await request(path,{method:'PUT',value,token:user.idToken})).status,401);
  }
  for (const path of ['status','status/other','status/communication/other']) {
    assert.equal((await request(path,{method:'PUT',value:'successful',token:user.idToken})).status,401);
  }
  assert.equal((await request('status',{token:user.idToken})).status,401);
});

test('a fresh connection clears demo data atomically and cannot wipe a ready session twice', async()=>{
  const oldCloset={settings:{processing:'app',mode:'demo',timezone:'UTC'},items:{
    '1':{profile:{id:1,name:'Old shirt',rfid:'OLD'},tracking:{wears:1,remainingWears:4},revision:1}
  }};
  assert.equal((await request('closet',{method:'PUT',value:oldCloset})).status,200);
  assert.equal((await request('clothingPhotos/old-photo',{method:'PUT',value:'data:image/png;base64,AAAA'})).status,200);
  assert.equal((await request('signal',{method:'PUT',value:{value:'b',commandId:'old-command',revision:9,createdAt:1}})).status,200);
  const id='boot-test0001';
  assert.equal((await request('status/connectionId',{method:'PUT',value:id})).status,200);
  assert.equal((await request('status/session',{method:'PUT',value:{connectionId:id,phase:'resetting'}})).status,200);
  assert.equal((await request('closet',{method:'PUT',value:oldCloset})).status,401,'old profile writes blocked during reset');
  assert.equal((await request('status/response',{method:'PUT',value:'successful'})).status,401,'no reply before the reset');
  assert.equal((await request('status/session',{method:'PUT',value:{connectionId:id,phase:'ready'}})).status,401,'ready requires cleared data');
  const reset={scans:null,clothingPhotos:null,signal:null,acknowledgement:null,
    users:null,scanResults:null,closetRequests:null,closetResults:null,
    closet:{settings:{processing:'app',mode:'demo',timezone:'UTC',connectionId:id}},
    'status/session':{connectionId:id,phase:'ready'},'status/response':'successful'};
  assert.equal((await request('',{method:'PATCH',value:reset})).status,200);
  for(const path of ['scans','clothingPhotos','signal','acknowledgement','closet/items']) {
    assert.equal(await (await request(path)).json(),null,path+' cleared');
  }
  assert.equal(await (await request('status/response')).json(),'successful');
  const scan={tagId:'NEW',receivedAt:{'.sv':'timestamp'},connectionId:id};
  assert.equal((await request('scans/after-reset',{method:'PUT',value:scan})).status,200);
  assert.equal((await request('',{method:'PATCH',value:reset})).status,401,'same session cannot reset twice');
  assert.equal((await (await request('scans/after-reset')).json()).tagId,'NEW');
  assert.equal((await request('closet',{method:'PUT',value:oldCloset})).status,401,'stale app cache cannot resurrect old wardrobe');
  assert.equal((await request('scans/stale',{method:'PUT',value:{...scan,connectionId:'old-connection'}})).status,401);
  assert.equal((await request('clothingPhotos/stale',{method:'PUT',value:'data:image/png;base64,AAAA'})).status,401);
  assert.equal((await request('clothingPhotos/new',{method:'PUT',value:{data:'data:image/png;base64,AAAA',connectionId:id}})).status,200);
});
