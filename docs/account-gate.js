(() => {
 const base = new URL('./', document.currentScript.src);
 const pendingKey='lpa:pending-game';
 function login(gameId, mode='play') {
  const game=window.HubGames?.get(gameId);
  try { if(game) sessionStorage.setItem(pendingKey,JSON.stringify({gameId:game.id,mode,at:Date.now()})); } catch {}
  const url=new URL('./',base);url.hash='profile';location.assign(url.href);
 }
 function pending() {
  try {
   const data=JSON.parse(sessionStorage.getItem(pendingKey)||'null');
   const game=window.HubGames?.get(data?.gameId);
   if(!game || !['play','install'].includes(data.mode) || !Number.isFinite(data.at) || Date.now()-data.at>3600000 || data.at>Date.now()+60000) return null;
   const url=new URL(game.shell+(data.mode==='install'?'install/':''),base);
   if(data.mode==='play')url.searchParams.set('launch','after-sign-in');
   return {title:game.title,url:url.href};
  } catch {return null;}
 }
 function clearPending(){try{sessionStorage.removeItem(pendingKey);}catch{}}

 async function allowed(gameId) {
  if (document.readyState === 'loading') await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  if (!window.HubAccount) { login(gameId); return false; }
  await Promise.race([window.HubAccount.ready,new Promise(resolve=>setTimeout(resolve,8000))]);
  if (!window.HubAccount.user()) { login(gameId); return false; }
  return true;
 }
 window.HubAccess = { allowed, pending, clearPending };
 document.addEventListener('click',event=>{
  const link=event.target.closest('[data-install-link], #install-button');
  if (!link) return;
  if (!window.HubAccount?.user()) {event.preventDefault();event.stopImmediatePropagation();login((window.HubGames?.forInstall(link.href)||window.HubGames?.forPage())?.id,'install');}
 },true);
 window.addEventListener('DOMContentLoaded',()=>{
  let previous;
  window.HubClient?.auth.onAuthStateChange((_event,session)=>{
   const next=session?.user?.id||null;
   if(previous!==undefined&&previous!==next) window.HubPlayer?.close();
   previous=next;
  });
 });
})();
