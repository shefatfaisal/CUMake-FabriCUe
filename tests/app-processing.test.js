import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyAppRequest, applyDemoScans} from '../server/web/demo-processing.js';
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!host) throw Error('Run npm run test:app with the local database emulator.');
const base = `http://${host}`;
const url = path => `${base}/${path}.json?ns=demo-lightlink`;
async function write(path, value) {
  return fetch(url(path), {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value)});
}
async function transaction(reduce) {
  for (let i = 0; i < 20; i++) {
    const response = await fetch(url('closet'), {headers:{'X-Firebase-ETag':'true'}});
    const value = reduce(await response.json());
    const write = await fetch(url('closet'), {method:'PUT',
      headers:{'Content-Type':'application/json','if-match':response.headers.get('etag')}, body:JSON.stringify(value)});
    if (write.status === 412) continue;
    assert.equal(write.status, 200, await write.clone().text());
    return write.json();
  }
  assert.fail('Transaction did not converge.');
}

test('app processing runs using only the database emulator, with atomic replay protection across two clients', async () => {
  const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8');
  const load = await fetch(`${base}/.settings/rules.json?ns=demo-lightlink`, {method:'PUT',
    headers:{Authorization:'Bearer owner','Content-Type':'application/json'}, body:rules});
  assert.equal(load.status, 200);
  const now = Date.now();
  await transaction(current => applyAppRequest(current, {kind:'configure',timezone:'America/New_York'}, now, 'setup'));
  const profile = {id:123, name:'Shirt', type:'Shirt', color:'#2255aa', limit:5, rfid:'TAG-A'};
  await transaction(current => applyAppRequest(current, {kind:'import',items:{'123':{profile,seed:{wears:0}}}}, now, 'import'));
  assert.equal((await write('clothingPhotos/photo', 'data:image/png;base64,AAAA')).status, 200);
  assert.equal((await write('scans/one', {tagId:'TAG-A',receivedAt:{'.sv':'timestamp'}})).status, 200);
  const event = {id:'event-one',tagId:'TAG-A',receivedAt:now+100};
  await Promise.all([
    transaction(current => applyDemoScans(current,[event],now+200)),
    transaction(current => applyDemoScans(current,[event],now+200))
  ]);
  let closet = await (await fetch(url('closet'))).json();
  assert.equal(closet.items[123].tracking.remainingWears, 4, 'one event delivered twice consumes one allowance');
  closet = await transaction(current => applyDemoScans(current,[{...event,id:'event-two',receivedAt:now+300}],now+400));
  assert.equal(closet.items[123].tracking.remainingWears, 3, 'another event the same day consumes another allowance');
  closet = await transaction(current => applyDemoScans(current,[event,{...event,id:'event-two',receivedAt:now+300}],now+500));
  assert.equal(closet.items[123].tracking.remainingWears, 3, 'reopening and replaying saved events does not consume twice');
  assert.equal((await write('scans/one',{tagId:'TAG-A',receivedAt:now})).status,401,'raw scans remain append-only');
});

test('ESP32 reads signal and acknowledges commands while invalid signal writes are rejected', async()=>{
  const closet=await (await fetch(url('closet'))).json();
  assert.equal((await write('signal',closet.output)).status,200);
  const signal=await (await fetch(url('signal'))).json();
  assert.ok(['a','b','c','d'].includes(signal.value));
  assert.equal((await write('acknowledgement',{commandId:signal.commandId,value:signal.value,appliedAt:{'.sv':'timestamp'}})).status,200);
  const ack=await (await fetch(url('acknowledgement'))).json();
  assert.equal(ack.commandId,signal.commandId);
  assert.equal(ack.value,signal.value);
  assert.equal((await write('signal',{...signal,value:'z'})).status,401);
  assert.equal((await write('signal',{...signal,revision:0})).status,401);
});
