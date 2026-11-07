import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {timerNotifications,TIMER_NOTIFICATION_IDS} from '../native/notifications.js';

test('native timer reminders use real deadlines, skip elapsed warnings, and stay within reserved IDs',()=>{
 const now=1000000;
 assert.deepEqual(timerNotifications(null,now),[]);
 assert.deepEqual(timerNotifications({stage:'ready',end:now+600000},now),[]);
 const wash=timerNotifications({stage:'wash',end:now+600000},now);
 assert.equal(wash.length,2);
 assert.equal(wash[0].schedule.at.getTime(),now+300000);
 assert.equal(wash[1].schedule.at.getTime(),now+600000);
 const dry=timerNotifications({stage:'dry',end:now+120000},now);
 assert.equal(dry.length,1,'do not schedule a warning in the past');
 assert.equal(dry[0].id,41004);
 assert.ok([...wash,...dry].every(event=>TIMER_NOTIFICATION_IDS.includes(event.id)));
 assert.deepEqual(timerNotifications({stage:'wash',end:now},now),[]);
});

test('native photo selection rejects old picker results and emits local timer changes',async()=>{
 const source=await readFile(new URL('../native/native-bridge.js',import.meta.url),'utf8');
 const preview={replaceChildren(image){this.image=image;}},label={textContent:''};
 const events=[];let saved=0;
 const context=vm.createContext({
  window:{dispatchEvent:event=>events.push(event)},localStorage:{getItem:()=>null},
  s:{load:{stage:'wash',end:123},clothes:[]},save(){saved++;},exportCloset(){},
  photoReadVersion:2,addPhoto:null,toast(){},syncToday(){},checkLoad(){},render(){},go(){},
  CustomEvent:function(type,options){this.type=type;this.detail=options.detail;},
  MutationObserver:function(){this.observe=()=>{};},
  document:{getElementById:id=>id==='photo-preview'?preview:id==='photo-label'?label:{},
    querySelectorAll:()=>[],createElement:()=>({})}
 });
 vm.runInContext(source,context);
 const ui=context.window.smartLaundryUI;
 ui.applyPhoto('data:image/jpeg;base64,AAAA',1);
 assert.equal(context.addPhoto,null,'a stale picker result cannot change another form');
 ui.applyPhoto('data:image/jpeg;base64,AAAA',2);
 assert.equal(context.addPhoto,'data:image/jpeg;base64,AAAA');
 assert.equal(label.textContent,'CHANGE PHOTO');
 context.save();assert.equal(saved,1);
 assert.equal(events[0].type,'smart-laundry:changed');
 assert.equal(events[0].detail.load.stage,'wash');
});

test('native bundle contains local app assets and no external Firebase SDK imports',async()=>{
 const base=new URL('../native-dist/',import.meta.url);
 const html=await readFile(new URL('index.html',base),'utf8');
 assert.match(html,/native-bridge\.js/);
 assert.match(html,/native-runtime\.js/);
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/window\.smartLaundryUI\.pickPhoto\(\)/);
 for(const file of ['native.css','native-runtime.js','laundry-firebase.js','laundry-rfid.js','scans.html'])await access(new URL(file,base));
 for(const file of (await readdir(base)).filter(file=>file.endsWith('.js'))){
  const js=await readFile(new URL(file,base),'utf8');
  assert.doesNotMatch(js,/(?:from\s*|import\s*\()['"]https:\/\/www\.gstatic\.com/);
 }
 const config=JSON.parse(await readFile(new URL('../capacitor.config.json',import.meta.url),'utf8'));
 assert.equal(config.server?.url,undefined,'installed UI must not be hosted-server-only');
 const plist=await readFile(new URL('../ios/App/App/Info.plist',import.meta.url),'utf8');
 for(const permission of ['NSCameraUsageDescription','NSPhotoLibraryUsageDescription','NSPhotoLibraryAddUsageDescription'])assert.ok(plist.includes(permission));
 const project=await readFile(new URL('../ios/App/App.xcodeproj/project.pbxproj',import.meta.url),'utf8');
 assert.match(project,/PrivacyInfo.xcprivacy in Resources/);
});

test('iOS project stays compatible with the Capacitor 7 Xcode 16 toolchain',async()=>{
 const root=new URL('../',import.meta.url);
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 for(const [name,version] of Object.entries({...pkg.dependencies,...pkg.devDependencies})){
  if(name.startsWith('@capacitor/'))assert.match(version,/^\^7\./,name);
 }
 const swift=await readFile(new URL('ios/App/CapApp-SPM/Package.swift',root),'utf8');
 assert.match(swift,/exact: "7\./);
 const delegate=await readFile(new URL('ios/App/App/AppDelegate.swift',root),'utf8');
 assert.match(delegate,/ApplicationDelegateProxy/);
 assert.doesNotMatch(delegate,/SceneDelegate/);
 const plist=await readFile(new URL('ios/App/App/Info.plist',root),'utf8');
 assert.doesNotMatch(plist,/UISceneDelegateClassName/);
});
