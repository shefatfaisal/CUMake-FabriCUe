import test from 'node:test';
import assert from 'node:assert/strict';
import {startCommunication} from '../server/web/communication.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup({id='boot-0001', session=null, fail=false}={}) {
  const tree={status:{communication:'success',connectionId:id,session,response:'waiting'},
    scans:{old:{tagId:'OLD'}},closet:{items:{old:{photo:'old'}}},clothingPhotos:{old:'photo'},signal:{value:'b'},acknowledgement:{old:true}};
  const listeners=new Map(), errors=[], resets=[];
  let pauses=0,completed=[];
  const read=path=>path.split('/').filter(Boolean).reduce((n,k)=>n?.[k],tree)??null;
  function put(path,value) {
    const parts=path.split('/');let node=tree;
    for(const key of parts.slice(0,-1))node=node[key]||=( {} );
    if(value===null)delete node[parts.at(-1)];else node[parts.at(-1)]=clone(value);
  }
  function notify(){for(const [path,fn]of listeners)fn({val:()=>clone(read(path))});}
  const stop=startCommunication({}, {
    ref:(_,path)=>{assert.notEqual(path,'','Firebase SDK rejects empty child paths');return path??'ROOT';},
    onValue(path,fn){listeners.set(path,fn);queueMicrotask(()=>fn({val:()=>clone(read(path))}));return()=>listeners.delete(path);},
    async runTransaction(path,fn){const value=fn(clone(read(path)));put(path,value);notify();return{snapshot:{val:()=>clone(value)}};},
    async update(root,values){assert.equal(root,'ROOT');if(fail)throw Error('denied');resets.push(values);for(const [p,v]of Object.entries(values))put(p,v);notify();}
  }, message=>errors.push(message),{pause(){pauses++;},complete(value){completed.push(value);}});
  for(let i=0;i<5;i++)await tick();
  return{tree,errors,resets,stop,notify,put,get pauses(){return pauses;},completed};
}
test('a new connection atomically clears all previous demo data before successful',async()=>{
  const s=await setup();
  assert.equal(s.resets.length,1);
  for(const key of ['scans','clothingPhotos','signal','acknowledgement'])assert.equal(s.tree[key],undefined);
  assert.equal(s.tree.closet.items,undefined);
  assert.equal(s.tree.closet.settings.connectionId,'boot-0001');
  assert.equal(s.tree.status.response,'successful');
  assert.equal(s.tree.status.session.phase,'ready');
  assert.ok(s.completed.includes('boot-0001'));
  s.put('scans/new',{tagId:'NEW'});s.notify();await tick();
  assert.equal(s.resets.length,1,'normal scans and repeated snapshots do not reset');
  assert.equal(s.tree.scans.new.tagId,'NEW');
});
test('reopening the app in a ready connection does not wipe existing data',async()=>{
  const s=await setup({session:{connectionId:'boot-0001',phase:'ready'}});
  assert.equal(s.resets.length,0);
  assert.ok(s.tree.scans.old);
  s.put('status/connectionId','boot-0002');s.notify();
  for(let i=0;i<5;i++)await tick();
  assert.equal(s.resets.length,1);
  assert.equal(s.tree.status.session.connectionId,'boot-0002');
});
test('legacy success without a connection ID never erases data; failed resets never reply successful',async()=>{
  const missing=await setup({id:null});
  assert.equal(missing.resets.length,0);assert.ok(missing.tree.scans.old);
  assert.match(missing.errors.at(-1),/connectionId/);
  const failed=await setup({fail:true});
  assert.equal(failed.tree.status.response,'waiting');
  assert.match(failed.errors.at(-1),/could not complete/);
});
