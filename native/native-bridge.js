// Native-only adapter. This classic script shares the supplied HTML's global state.
(() => {
  const state = () => ({
    load:s.load?JSON.parse(JSON.stringify(s.load)):null,
    events:Array.isArray(s.events)?JSON.parse(JSON.stringify(s.events)):[],
    connectionId:localStorage.getItem('smart-laundry-connection-id')
  });
  const changed = () => window.dispatchEvent(new CustomEvent('smart-laundry:changed',{detail:state()}));
  const previousSave=save;
  save=function(){previousSave();changed();};
  exportCloset=function(){
    if(!window.smartLaundryNative)return toast('Native sharing is starting. Please try again.');
    void window.smartLaundryNative.exportBackup({format:'smart-laundry-backup',version:1,data:s});
  };
  window.smartLaundryUI={
    state,
    notify:message=>toast(message),
    pickPhoto(){
      if(!window.smartLaundryNative)return toast('Camera is starting. Please try again.');
      const token=++photoReadVersion;
      void window.smartLaundryNative.pickPhoto(token);
    },
    applyPhoto(photo,token){
      if(token!==photoReadVersion||!document.getElementById('photo-preview'))return;
      if(!/^data:image\/(jpeg|png|webp);base64,/.test(photo)||photo.length>2800000)return toast('Please choose a smaller photo.');
      addPhoto=photo;
      const image=document.createElement('img');image.src=photo;image.alt='Clothing photo';
      document.getElementById('photo-preview').replaceChildren(image);
      document.getElementById('photo-label').textContent='CHANGE PHOTO';
      if(typeof analyzeAddPhoto==='function')void analyzeAddPhoto(photo,token);
    },
    resume(){syncToday();checkLoad();render();changed();},
    openLaundry(){checkLoad();go('Cart');},
    openCalendar(){go('Calendar');},
    refresh:changed
  };
  function linkHistory(){for(const a of document.querySelectorAll('a[href="/"]'))a.setAttribute('href','/scans.html');}
  new MutationObserver(linkHistory).observe(document.getElementById('phone'),{childList:true,subtree:true});
  linkHistory();
})();
