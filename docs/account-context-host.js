/* Storage addressing only. This namespace is never an authentication credential. */
(() => {
  const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
  let epoch=0, verificationGeneration=0, contextSessionId=crypto.randomUUID(), status='unknown', reason='initializing', actor=null, expiresAt=null, expiryTimer=null;
  const checkedLaunch = event => {
    const launch=window.HubPlayer?.current();
    return launch && window.HubPlayer.trusted(launch) && (!event || (event.source===launch.frame.contentWindow && event.origin===new URL(launch.game.url).origin)) ? launch : null;
  };
  function expire() {
    if(status==='ready' && Date.now()>=expiresAt){++epoch;++verificationGeneration;contextSessionId=crypto.randomUUID();status='expired';reason='session_expired';actor=null;expiresAt=null;publish();}
  }
  async function snapshot(launch) {
    expire();
    const ticket=epoch, verificationTicket=verificationGeneration, session=contextSessionId;
    const result={status,reason,gameId:launch.game.id,storageNamespace:null,expiresAt:status==='ready'?expiresAt:null,epoch:ticket,contextSessionId:session};
    if(status==='ready') {
      try {
        const project=new URL(window.LIBERTY_PANDA_AUTH_CONFIG.supabaseUrl).origin;
        const input=JSON.stringify(['lpa-storage-v1',project,actor,launch.game.id]);
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
        result.storageNamespace='lpa:save:v1:'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      } catch {result.status='unknown';result.reason='namespace_unavailable';result.storageNamespace=null;result.expiresAt=null;}
    }
    if(ticket!==epoch || verificationTicket!==verificationGeneration || session!==contextSessionId || checkedLaunch()!==launch) return null;
    if(result.status==='ready' && Date.now()>=result.expiresAt){expire();return null;}
    return result;
  }
  async function send(launch,type,requestId) {
    const context=await snapshot(launch);if(!context||context.epoch!==epoch||context.contextSessionId!==contextSessionId||checkedLaunch()!==launch)return;
    launch.frame.contentWindow.postMessage({type,protocol:1,contextVersion:1,launchId:launch.id,...(requestId?{requestId}:{}),context},new URL(launch.game.url).origin);
  }
  function publish(){const launch=checkedLaunch();if(launch)void send(launch,'lpa:account:changed');}
  function transition(next,nextReason){++epoch;++verificationGeneration;contextSessionId=crypto.randomUUID();status=next;reason=nextReason;actor=null;expiresAt=null;clearTimeout(expiryTimer);publish();}
  function observe(_event,session){
    // Invalidate synchronously; A→B→A cannot resurrect A's earlier async response.
    const sameVerified=session?.user?.id?.toLowerCase()===actor && status==='ready' && Date.now()<expiresAt;
    if(!sameVerified)transition(session?'changed':'absent',session?'verification_pending':'signed_out');
    const verificationTicket=++verificationGeneration;
    if(!session)return;
    const ticket=epoch, expected=session.user?.id?.toLowerCase(), expiry=Number(session.expires_at)*1000;
    if(!uuid(expected)||!Number.isFinite(expiry)||expiry<=Date.now()){transition('expired','session_expired');return;}
    // Never await Supabase calls inside its auth callback.
    setTimeout(async()=>{
      try {
        const result=await window.HubClient.auth.getUser();
        if(ticket!==epoch||verificationTicket!==verificationGeneration)return;
        if(result.error){if([401,403].includes(result.error.status)){transition('unknown','verification_rejected');return;}throw Error('verification_failed');}
        if(result.data?.user?.id?.toLowerCase()!==expected){transition('unknown','identity_mismatch');return;}
        if(Date.now()>=expiry){transition('expired','session_expired');return;}
        actor=expected;expiresAt=expiry;status='ready';reason='verified';
        clearTimeout(expiryTimer);expiryTimer=setTimeout(expire,Math.min(2147483647,Math.max(0,expiry-Date.now())));
        publish();
      }catch{if(ticket===epoch&&verificationTicket===verificationGeneration){if(sameVerified&&Date.now()<expiresAt)return;status='unknown';reason='verification_unavailable';publish();}}
    },0);
  }
  function start(){if(window.HubClient?.auth?.onAuthStateChange)window.HubClient.auth.onAuthStateChange(observe);else{status='unknown';reason='auth_unavailable';publish();}}
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('hub:playerready',publish);
  window.addEventListener('message',event=>{
    const data=event.data,launch=checkedLaunch(event);
    if(!launch||!data||data.type!=='lpa:account:request'||data.protocol!==1||data.contextVersion!==1||data.launchId!==launch.id||!uuid(data.requestId))return;
    void send(launch,'lpa:account:response',data.requestId);
  });
})();
