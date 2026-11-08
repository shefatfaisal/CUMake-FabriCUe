import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {
 timerNotifications,
 TIMER_NOTIFICATION_IDS,
 schedulePlanNotifications,
 SCHEDULE_NOTIFICATION_IDS,
 SCHEDULE_NOTIFICATION_BASE,
 SCHEDULE_WARNING_MS,
 planAt
} from '../native/notifications.js';

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

test('manual and auto calendar plans schedule local reminders without colliding with timer IDs',()=>{
 const due=new Date(Date.now()+2*60*60*1000);
 const date=`${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}`;
 const time=`${String(due.getHours()).padStart(2,'0')}:${String(due.getMinutes()).padStart(2,'0')}`;
 const at=planAt({date,time});
 assert.ok(at);
 const now=at.getTime()-60*60*1000;
 const notes=schedulePlanNotifications([
  {date,time,label:'Laundry day',auto:false},
  {date:'2000-01-01',time:'10:00',label:'Past plan',auto:true}
 ],now);
 assert.equal(notes.length,2,'30-minute warning and due reminder');
 assert.equal(notes[0].schedule.at.getTime(),at.getTime()-SCHEDULE_WARNING_MS);
 assert.equal(notes[1].schedule.at.getTime(),at.getTime());
 assert.equal(notes[1].title,'Laundry reminder');
 const auto=schedulePlanNotifications([{date,time,label:'Suggested wash',auto:true}],at.getTime()-10*60*1000);
 assert.equal(auto.length,1,'skip warning when it would already be past');
 assert.equal(auto[0].title,'Suggested laundry time');
 assert.ok(notes.every(event=>SCHEDULE_NOTIFICATION_IDS.includes(event.id)));
 assert.equal(new Set([...TIMER_NOTIFICATION_IDS,...SCHEDULE_NOTIFICATION_IDS]).size,
  TIMER_NOTIFICATION_IDS.length+SCHEDULE_NOTIFICATION_IDS.length);
 assert.equal(SCHEDULE_NOTIFICATION_BASE,42001);
 assert.deepEqual(schedulePlanNotifications(null,now),[]);
});

test('native photo selection rejects old picker results and emits local timer changes',async()=>{
 const source=await readFile(new URL('../native/native-bridge.js',import.meta.url),'utf8');
 const preview={replaceChildren(image){this.image=image;}},label={textContent:''};
 const events=[];let saved=0;let calendarOpens=0;
 const context=vm.createContext({
  window:{dispatchEvent:event=>events.push(event)},localStorage:{getItem:()=>null},
  s:{load:{stage:'wash',end:123},clothes:[],events:[{date:'2026-11-08',time:'10:00',label:'Laundry day',auto:true}]},
  save(){saved++;},exportCloset(){},
  photoReadVersion:2,addPhoto:null,toast(){},syncToday(){},checkLoad(){},render(){},
  go(page){if(page==='Calendar')calendarOpens++;},
  CustomEvent:function(type,options){this.type=type;this.detail=options.detail;},
  MutationObserver:function(){this.observe=()=>{};},
  document:{getElementById:id=>id==='photo-preview'?preview:id==='photo-label'?label:id==='phone'?{}:{},
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
 assert.equal(events[0].detail.events[0].auto,true);
 ui.openCalendar();
 assert.equal(calendarOpens,1);
});

test('native bundle contains local app assets and no external Firebase SDK imports',async()=>{
 const base=new URL('../native-dist/',import.meta.url);
 const html=await readFile(new URL('index.html',base),'utf8');
 assert.match(html,/native-bridge\.js/);
 assert.match(html,/native-runtime\.js/);
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/window\.smartLaundryUI\.pickPhoto\(\)/);
 for(const file of ['native.css','native-runtime.js','laundry-firebase.js','laundry-rfid.js','schedule-auto.js','native-app-check.js','gemini-clothing.js','scans.html'])await access(new URL(file,base));
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

test('iOS App Check bridge configuration survives Capacitor sync',async()=>{
 const root=new URL('../',import.meta.url);
 const project=await readFile(new URL('ios/App/App.xcodeproj/project.pbxproj',root),'utf8');
 assert.match(project,/GoogleService-Info.plist in Resources/);
 assert.match(project,/CODE_SIGN_ENTITLEMENTS = App\/App.entitlements/);
 const storyboard=await readFile(new URL('ios/App/App/Base.lproj/Main.storyboard',root),'utf8');
 assert.match(storyboard,/customClass="SmartLaundryBridgeViewController" customModule="CapApp_SPM"/);
 const swift=await readFile(new URL('ios/App/CapApp-SPM/Package.swift',root),'utf8');
 assert.match(swift,/firebase-ios-sdk.git", exact: "11.11.0"/);
 assert.match(swift,/product\(name: "FirebaseAppCheck"/);
 const bridge=await readFile(new URL('ios/App/CapApp-SPM/Sources/CapApp-SPM/SmartLaundryAppCheck.swift',root),'utf8');
 assert.match(bridge,/#if DEBUG[\s\S]*AppCheckDebugProviderFactory\(\)[\s\S]*#else[\s\S]*SmartLaundryAttestationFactory\(\)/);
 assert.match(bridge,/AppCheck.appCheck\(\).limitedUseToken/);
 const nativeHTML=await readFile(new URL('native-dist/index.html',root),'utf8');
 assert.doesNotMatch(nativeHTML,/src="\/web-reminders.js"/,'native reminders must not run twice');
});
