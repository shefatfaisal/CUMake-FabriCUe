import {Capacitor} from '@capacitor/core';
import {Camera,CameraResultType,CameraSource} from '@capacitor/camera';
import {App} from '@capacitor/app';
import {Share} from '@capacitor/share';
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {LocalNotifications} from '@capacitor/local-notifications';
import {
 TIMER_NOTIFICATION_IDS,
 SCHEDULE_NOTIFICATION_IDS,
 timerNotifications,
 schedulePlanNotifications
} from './notifications.js';

if(Capacitor.isNativePlatform()){
 const ui=window.smartLaundryUI;
 window.smartLaundryNative={
  async pickPhoto(token){
   try{
    const photo=await Camera.getPhoto({quality:75,width:1024,height:1024,correctOrientation:true,
     resultType:CameraResultType.DataUrl,source:CameraSource.Prompt,saveToGallery:false,
     promptLabelHeader:'Clothing photo',promptLabelPhoto:'Choose from Photos',promptLabelPicture:'Take Photo'});
    if(photo.dataUrl)ui.applyPhoto(photo.dataUrl,token);
   }catch(error){if(!/cancel/i.test(error.message||''))ui.notify('Could not open the camera or photos. Check app permissions in Settings.');}
  },
  async exportBackup(backup){
   try{
    const path='smart-laundry-backup-'+Date.now()+'.json';
    const file=await Filesystem.writeFile({path,data:JSON.stringify(backup,null,2),directory:Directory.Cache,encoding:Encoding.UTF8});
    await Share.share({title:'Smart Laundry backup',files:[file.uri],dialogTitle:'Save or share your wardrobe backup'});
   }catch{ui.notify('Could not share the backup. Please try again.');}
  }
 };
 let lastKey='',sequence=Promise.resolve();
 async function ensurePermission(){
  let permission=await LocalNotifications.checkPermissions();
  if(permission.display==='prompt')permission=await LocalNotifications.requestPermissions();
  return permission.display==='granted';
 }
 function updateReminders(state){
  const key=JSON.stringify({
   load:state.load&&{stage:state.load.stage,end:state.load.end},
   events:(state.events||[]).map(e=>({date:e.date,time:e.time,label:e.label,auto:!!e.auto}))
  });
  if(key===lastKey)return;
  lastKey=key;
  sequence=sequence.then(async()=>{
   const timer=timerNotifications(state.load);
   const plans=schedulePlanNotifications(state.events||[]);
   const reserved=[...TIMER_NOTIFICATION_IDS,...SCHEDULE_NOTIFICATION_IDS].map(id=>({id}));
   await LocalNotifications.cancel({notifications:reserved});
   if(!timer.length&&!plans.length)return;
   if(!(await ensurePermission())){
    ui.notify('Enable notifications in iPhone Settings for laundry reminders.');
    return;
   }
   await LocalNotifications.schedule({notifications:[...timer,...plans]});
  }).catch(()=>{lastKey='';ui.notify('Could not schedule laundry reminders. Your in-app plans and timers still work.');});
 }
 window.addEventListener('smart-laundry:changed',event=>updateReminders(event.detail));
 await App.addListener('appStateChange',({isActive})=>{if(isActive){lastKey='';ui.resume();}});
 await LocalNotifications.addListener('localNotificationActionPerformed',(action)=>{
  const id=action?.notification?.id;
  if(SCHEDULE_NOTIFICATION_IDS.includes(id))ui.openCalendar();
  else ui.openLaundry();
 });
 updateReminders(ui.state());
}
