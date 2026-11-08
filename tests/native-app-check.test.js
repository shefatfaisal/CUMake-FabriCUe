import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateClothingAnalysis, imagePart, useLocalAppCheckDebug} from '../server/web/clothing-analysis.js';

async function loadAI(nativePlatform) {
 const source=await readFile(new URL('../server/web/gemini-clothing.js',import.meta.url),'utf8');
 const apps=[],checks=[],services=[];
 let nativeTokens=0,recaptcha=0,loads=0;
 const context=vm.createContext({
  getApps:()=>apps,
  initializeApp:(options,name='[DEFAULT]')=>{const app={options,name};apps.push(app);return app},
  firebaseConfig:{projectId:'lightlink-cbe74',appId:'web-app'},
  geminiConfig:{model:'test-model',recaptchaEnterpriseSiteKey:'public-site-key'},
  Capacitor:{isNativePlatform:()=>nativePlatform},
  location:{hostname:'lightlink-cbe74.web.app',protocol:'https:'},self:{},
  initializeAppCheck:(app,options)=>checks.push({app,...options}),
  CustomProvider:class {constructor(options){Object.assign(this,options)}},
  ReCaptchaEnterpriseProvider:class {constructor(){recaptcha++}},
  GoogleAIBackend:class {},
  getAI:(app,options)=>{services.push({app,...options});return {app}},
  Schema:{object:x=>x,boolean:()=>({}),enumString:x=>x,integer:()=>({})},
  getGenerativeModel:()=>({generateContent:async()=>({response:{text:()=>JSON.stringify({isClothing:true,type:'Jeans',color:'Blue',wearLimit:5})}})}),
  nativeModule:async()=>{loads++;return {
   nativeAIConfiguration:async()=>({appId:'1:123:ios:test',projectId:'lightlink-cbe74',apiKey:'public-ios-key'}),
   nativeAILimitedUseToken:async()=>({token:'native-'+(++nativeTokens),expireTimeMillis:Date.now()+300000})
  }},
  validateClothingAnalysis,imagePart,useLocalAppCheckDebug
 });
 const executable=source.replace(/^import .*;\n/gm,'').replaceAll('export async function','async function').replace("import('/native-app-check.js')",'nativeModule()');
 vm.runInContext(executable,context);
 return {context,apps,checks,services,count:()=>({nativeTokens,recaptcha,loads})};
}

test('native Gemini uses matching iOS identity and fresh tokens, without reCAPTCHA',async()=>{
 const a=await loadAI(true);
 await a.context.analyzeClothing('data:image/jpeg;base64,AAAA',['Jeans'],['Blue']);
 await a.context.analyzeClothing('data:image/jpeg;base64,AAAA',['Jeans'],['Blue']);
 assert.equal(a.apps[0].name,'[DEFAULT]','database retains its web identity');
 assert.equal(a.services[0].app.options.appId,'1:123:ios:test');
 assert.equal(a.services[0].useLimitedUseAppCheckTokens,true);
 assert.equal(a.count().recaptcha,0);assert.equal(a.count().loads,1);
 const first=await a.checks[0].provider.getToken();
 const second=await a.checks[0].provider.getToken();
 assert.notEqual(first.token,second.token);
});

test('hosted browser Gemini keeps reCAPTCHA and never loads the native bridge',async()=>{
 const a=await loadAI(false);
 await a.context.analyzeClothing('data:image/jpeg;base64,AAAA',['Jeans'],['Blue']);
 assert.equal(a.services[0].app.name,'[DEFAULT]');
 assert.equal(a.count().recaptcha,1);assert.equal(a.count().loads,0);
});
