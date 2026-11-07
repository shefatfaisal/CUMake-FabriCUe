export const TIMER_NOTIFICATION_IDS=[41001,41002,41003,41004];
export const SCHEDULE_NOTIFICATION_BASE=42001;
export const SCHEDULE_NOTIFICATION_SLOTS=32; // up to 16 plans × (warning + due)
export const SCHEDULE_NOTIFICATION_IDS=Array.from(
  {length:SCHEDULE_NOTIFICATION_SLOTS},
  (_,i)=>SCHEDULE_NOTIFICATION_BASE+i
);
export const SCHEDULE_WARNING_MS=30*60*1000;

export function timerNotifications(load,now=Date.now()){
 if(!load||!['wash','dry'].includes(load.stage)||!Number.isFinite(load.end)||load.end<=now)return [];
 const wash=load.stage==='wash',base=wash?41001:41003,label=wash?'Wash':'Drying';
 const events=[];
 if(load.end-300000>now)events.push({id:base,title:`${label}: 5 minutes left`,body:'Your laundry timer finishes soon.',schedule:{at:new Date(load.end-300000)}});
 events.push({id:base+1,title:`${label} timer finished`,body:wash?'Move your clothes to the dryer.':'Your laundry is ready to collect.',schedule:{at:new Date(load.end)}});
 return events;
}

export function planAt(event){
 if(!event||typeof event.date!=='string'||typeof event.time!=='string')return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time))return null;
 const at=new Date(`${event.date}T${event.time}:00`);
 return Number.isNaN(at.getTime())?null:at;
}

/** Local calendar plans → iOS LocalNotifications. Manual and auto plans share this path. */
export function schedulePlanNotifications(events,now=Date.now()){
 if(!Array.isArray(events))return [];
 const upcoming=events
  .map((event,index)=>({event,index,at:planAt(event)}))
  .filter(row=>row.at&&row.at.getTime()>now)
  .sort((a,b)=>a.at-b.at||a.index-b.index)
  .slice(0,SCHEDULE_NOTIFICATION_SLOTS/2);
 const notifications=[];
 let slot=0;
 for(const {event,at} of upcoming){
  const label=(event.label&&String(event.label).trim())||'Laundry day';
  const when=at.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const warnAt=at.getTime()-SCHEDULE_WARNING_MS;
  if(warnAt>now&&slot<SCHEDULE_NOTIFICATION_SLOTS){
   notifications.push({
    id:SCHEDULE_NOTIFICATION_BASE+slot,
    title:`Laundry in 30 minutes`,
    body:`${label} · ${when}`,
    schedule:{at:new Date(warnAt)}
   });
   slot++;
  }
  if(slot<SCHEDULE_NOTIFICATION_SLOTS){
   notifications.push({
    id:SCHEDULE_NOTIFICATION_BASE+slot,
    title:event.auto?'Suggested laundry time':'Laundry reminder',
    body:`${label} · ${when}`,
    schedule:{at}
   });
   slot++;
  }
 }
 return notifications;
}
