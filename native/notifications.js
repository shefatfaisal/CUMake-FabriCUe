export const TIMER_NOTIFICATION_IDS=[41001,41002,41003,41004];
export function timerNotifications(load,now=Date.now()){
 if(!load||!['wash','dry'].includes(load.stage)||!Number.isFinite(load.end)||load.end<=now)return [];
 const wash=load.stage==='wash',base=wash?41001:41003,label=wash?'Wash':'Drying';
 const events=[];
 if(load.end-300000>now)events.push({id:base,title:`${label}: 5 minutes left`,body:'Your laundry timer finishes soon.',schedule:{at:new Date(load.end-300000)}});
 events.push({id:base+1,title:`${label} timer finished`,body:wash?'Move your clothes to the dryer.':'Your laundry is ready to collect.',schedule:{at:new Date(load.end)}});
 return events;
}
