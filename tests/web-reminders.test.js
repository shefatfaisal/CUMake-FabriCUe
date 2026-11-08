import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('web reminders fire for due plans once and ignore future, deleted, and old plans',async()=>{
 const source=await readFile(new URL('../server/web/web-reminders.js',import.meta.url),'utf8');
 const now=new Date(2026,10,8,12,0).getTime();
 let tick,permissionRequests=0;
 const messages=[],storage=new Map();
 function Notification(title,options){messages.push({title,...options});}
 Notification.permission='granted';
 Notification.requestPermission=async()=>{permissionRequests++;return 'granted'};
 const context=vm.createContext({window:{Notification,addEventListener(){},focus(){}},Notification,navigator:{},
  document:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  s:{events:[{date:'2026-11-08',time:'12:00',label:'Laundry'},{date:'2026-11-08',time:'13:00'},{date:'2026-11-08',time:'11:00'}]},
  Date:class extends Date{static now(){return now}},setInterval:fn=>{tick=fn},toast(){},savePlan(){},scheduleDraft:{},go(){}});
 vm.runInContext(source,context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.length,1);tick();assert.equal(messages.length,1);
 context.s.events=[];tick();assert.equal(messages.length,1);
 Notification.permission='default';context.savePlan();assert.equal(permissionRequests,1);
 // Reloading the page must preserve deduplication.
 context.s.events=[{date:'2026-11-08',time:'12:00',label:'Laundry'}];Notification.permission='granted';
 vm.runInContext(source,context);assert.equal(messages.length,1);
});
