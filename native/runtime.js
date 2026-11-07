import {Capacitor} from '@capacitor/core';
import {Camera,CameraResultType,CameraSource} from '@capacitor/camera';
import {App} from '@capacitor/app';
import {Share} from '@capacitor/share';
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {LocalNotifications} from '@capacitor/local-notifications';
import {TIMER_NOTIFICATION_IDS,timerNotifications} from './notifications.js';

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
 let lastTimer='',sequence=Promise.resolve();
 function updateTimer(state){
  const key=JSON.stringify(state.load&&{stage:state.load.stage,end:state.load.end});
  if(key===lastTimer)return;
  lastTimer=key;
  sequence=sequence.then(async()=>{
   await LocalNotifications.cancel({notifications:TIMER_NOTIFICATION_IDS.map(id=>({id}))});
   const notifications=timerNotifications(state.load);
   if(!notifications.length)return;
   let permission=await LocalNotifications.checkPermissions();
   if(permission.display==='prompt')permission=await LocalNotifications.requestPermissions();
   if(permission.display!=='granted'){ui.notify('Enable notifications in iPhone Settings for laundry timer reminders.');return;}
   await LocalNotifications.schedule({notifications});
  }).catch(()=>{lastTimer='';ui.notify('Could not schedule laundry reminders. Your in-app timer still works.');});
 }
 window.addEventListener('smart-laundry:changed',event=>updateTimer(event.detail));
 await App.addListener('appStateChange',({isActive})=>{if(isActive){lastTimer='';ui.resume();}});
 await LocalNotifications.addListener('localNotificationActionPerformed',()=>ui.openLaundry());
 updateTimer(ui.state());
}
