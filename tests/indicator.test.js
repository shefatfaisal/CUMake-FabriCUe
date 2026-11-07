import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAppRequest, applyDemoScans} from '../server/web/demo-processing.js';
function initial() {
  return applyAppRequest(null,{kind:'import',timezone:'UTC',items:{
    '1':{profile:{id:1,name:'Shirt',type:'Shirt',color:'#2255aa',limit:2,rfid:'A'},seed:{wears:0}},
    '2':{profile:{id:2,name:'Pants',type:'Pants',color:'#2255aa',limit:5,rfid:'B'},seed:{wears:0}}
  }},1000,'setup');
}
const scan=(id,tagId,receivedAt)=>({id,tagId,receivedAt});
test('signals follow remaining wears: green, yellow at one remaining, and red at zero',()=>{
  let c=initial();
  assert.equal(c.output.value,'a');
  c=applyDemoScans(c,[scan('one','A',2000)],2000);
  assert.equal(c.output.value,'b');
  c=applyDemoScans(c,[scan('two','A',5000)],5000);
  assert.equal(c.output.value,'c');
  const replay=applyDemoScans(c,[scan('two','A',5000)],6000);
  assert.deepEqual(replay.output,c.output);
});
test('highest severity wins across nearby scans; a later separate group can turn green',()=>{
  let c=initial();
  c=applyDemoScans(c,[scan('one','A',2000),scan('two','A',2100)],2200);
  assert.equal(c.output.value,'c');
  c=applyDemoScans(c,[scan('pants','B',2300)],2300);
  assert.equal(c.output.value,'c','red cannot be overwritten by a nearby green scan');
  c=applyDemoScans(c,[scan('pants-later','B',6000)],6000);
  assert.equal(c.output.value,'a','a separate group considers only its scanned clothing');
});
test('unknown tags and delayed older events do not replace the latest command',()=>{
  let c=initial();
  c=applyDemoScans(c,[scan('latest','B',7000)],7000);
  const id=c.output.commandId;
  c=applyDemoScans(c,[scan('old','A',3000),scan('unknown','X',8000)],8000);
  assert.equal(c.output.commandId,id);
  assert.equal(c.output.value,'a');
});
test('indicator tests support d and reject unsupported values without consuming wears',()=>{
  const c=initial();
  const next=applyAppRequest(c,{kind:'indicatorTest',value:'d'},2000,'test-d');
  assert.equal(next.output.value,'d');
  assert.equal(next.items[1].tracking.wears,0);
  assert.throws(()=>applyAppRequest(c,{kind:'indicatorTest',value:'z'},2000,'bad'),/Invalid indicator/);
});
