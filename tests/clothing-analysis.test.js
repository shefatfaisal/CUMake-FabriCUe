import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {validateClothingAnalysis, imagePart, useLocalAppCheckDebug} from '../server/web/clothing-analysis.js';

test('analysis validates garment, supported categories, colors and wear units',()=>{
 const valid={isClothing:true,type:'Jeans',color:'Blue',wearLimit:5};
 const check=v=>validateClothingAnalysis(v,['Jeans'],['Blue']);
 assert.deepEqual(check(valid),{type:'Jeans',color:'Blue',wearLimit:5});
 for(const patch of [{isClothing:false},{isClothing:'yes'},{type:'unknown'},{color:'<script>'},{wearLimit:0},{wearLimit:31},{wearLimit:2.5},{wearLimit:'5'}])assert.throws(()=>check({...valid,...patch}));
 assert.deepEqual(imagePart('data:image/jpeg;base64,AAAA'),{inlineData:{mimeType:'image/jpeg',data:'AAAA'}});
 for(const photo of ['https://example.com/photo.jpg','data:image/svg+xml;base64,AAAA','data:image/png;base64,<html>'])assert.throws(()=>imagePart(photo));
});

test('photo suggestions apply to current form only and preserve edits',async()=>{
 const html=await readFile(new URL('../smart-laundry.html',import.meta.url),'utf8');
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
 for(const [,attributes,body] of scripts)if(/\bsrc=/.test(attributes))assert.equal(body.trim(),'','external script bodies are ignored by browsers');
 const inline=scripts.find(([,attributes,body])=>!/\bsrc=/.test(attributes)&&body.includes('async function analyzeAddPhoto('));
 assert.ok(inline,'analysis must be in an executable inline script');
 const script=inline[2];
 let resolve;
 const listeners={};
 const radio={checked:false};
 const form={addEventListener:(k,fn)=>listeners[k]=fn,removeEventListener:k=>delete listeners[k],querySelector:()=>radio};
 const fields={ctype:{value:'T-shirt',closest:()=>form},ccolor:{value:'#ffffff'},climit:{value:2},'photo-analysis-status':{textContent:'',setAttribute(){}}};
 const context=vm.createContext({photoReadVersion:1,addPhoto:'photo',modal:{open:true},document:{getElementById:id=>fields[id]},clothingOptions:[{items:[['Jeans',5]]}],colorOptions:[['Blue','#648bad']],refreshWearLimit(){},paintSelectedColor(){},setTimeout,clearTimeout,
  requestAnalysis:()=>new Promise(r=>resolve=r)});
 vm.runInContext(script.replace("import('/gemini-clothing.js').then(m=>m.analyzeClothing(photo,clothingOptions.flatMap(g=>g.items.map(([t])=>t)),colorOptions.map(([n])=>n)))",'requestAnalysis()'),context);
 const result={type:'Jeans',color:'Blue',wearLimit:5};
 let pending=context.analyzeAddPhoto('photo',1);resolve(result);await pending;
 assert.equal(fields.ctype.value,'Jeans');assert.equal(fields.climit.value,5);assert.equal(radio.checked,true);
 fields.ctype.value='T-shirt';
 pending=context.analyzeAddPhoto('photo',1);listeners.input();resolve(result);await pending;
 assert.equal(fields.ctype.value,'T-shirt','typing while waiting keeps user details');
 pending=context.analyzeAddPhoto('photo',1);context.photoReadVersion=2;resolve(result);await pending;
 assert.equal(fields.ctype.value,'T-shirt','an old photo cannot update new photo details');
 pending=context.analyzeAddPhoto('photo',2);context.modal.open=false;resolve(result);await pending;
 assert.equal(fields.ctype.value,'T-shirt','closed forms ignore results');
});

test('only local browser previews use App Check debug mode',()=>{
 for(const hostname of ['localhost','127.0.0.1','[::1]'])assert.equal(useLocalAppCheckDebug({hostname,protocol:'http:'}),true);
 assert.equal(useLocalAppCheckDebug({hostname:'lightlink-cbe74.web.app',protocol:'https:'}),false);
 assert.equal(useLocalAppCheckDebug({hostname:'localhost.evil.example',protocol:'https:'}),false);
 assert.equal(useLocalAppCheckDebug({hostname:'localhost',protocol:'capacitor:'}),false);
 assert.equal(useLocalAppCheckDebug({hostname:'localhost',protocol:'https:'},true),false);
});
