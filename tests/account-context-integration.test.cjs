/* Independent browser integration QA: real shell/host/SDK, stubbed Supabase Auth.
 * No game source, real login, cloud save, money, provider or physical device is exercised. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let pw;try{pw=require('playwright-core');}catch{pw=require('../output/qa/playwright-core/package');}
const ORIGIN='https://libertypandaa.github.io',BASE=ORIGIN+'/liberty-panda-arcade/';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const CF='crystal-front-demo',CC='clutter-cup';
let browser;
before(async()=>{browser=await pw.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});});
after(async()=>{await browser?.close();});
async function harness(t,options={}){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:844,height:430}});t.after(()=>context.close());
 const messages=[],errors=[],network=[];
 await context.exposeBinding('__captureAccountMessage',(_source,data)=>messages.push(data));
 await context.addInitScript(({actor,expiresIn,fail,hold,fakeClock})=>{
  addEventListener('message',event=>{if(event.data?.type?.startsWith('lpa:account:'))window.__captureAccountMessage(event.data);});
  if(fakeClock){
   const nativeNow=Date.now.bind(Date),nativeTimeout=setTimeout.bind(window),nativeClear=clearTimeout.bind(window),timers=new Map();let offset=0,next=-1;
   Date.now=()=>nativeNow()+offset;
   window.setTimeout=(callback,delay=0,...args)=>{if(delay<1000)return nativeTimeout(callback,delay,...args);const id=next--;timers.set(id,{at:Date.now()+delay,callback:()=>callback(...args)});return id;};
   window.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else nativeClear(id);};
   window.qaAdvanceTime=ms=>{offset+=ms;for(const [id,timer]of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(timer.at<=Date.now()&&timers.has(id)){timers.delete(id);timer.callback();}}};
  }
  if(window!==window.top)return;
  localStorage.setItem('lpa:analytics-consent-v2','no');
  localStorage.setItem('crystalFrontProgressV1',JSON.stringify({version:'legacy-fixture',profile:{rays:987},bonuses:{bomb:7}}));
  const listeners=[];let id=actor, expiry=Math.floor(Date.now()/1000)+expiresIn;
  const user=()=>id?{id,email:id+'@example.invalid',user_metadata:{name:'QA fixture'},app_metadata:{provider:'google'}}:null;
  const session=()=>id?{user:user(),expires_at:expiry,access_token:'SENTINEL_ACCESS_TOKEN_NEVER_IN_IFRAME',refresh_token:'SENTINEL_REFRESH_TOKEN_NEVER_IN_IFRAME'}:null;
  window.fixtureAuth={expiresIn,fail,hold,pending:[],verified:0,emit(next,event='SIGNED_IN'){id=next;expiry=Math.floor(Date.now()/1000)+this.expiresIn;const s=session();listeners.forEach(cb=>cb(event,s));},release(index){this.pending[index]?.();}};
  const client={auth:{
   onAuthStateChange(cb){listeners.push(cb);queueMicrotask(()=>cb('INITIAL_SESSION',session()));return {data:{subscription:{unsubscribe(){}}}};},
   async getSession(){return {data:{session:session()},error:null};},
   getUser(){const captured=user(),failed=window.fixtureAuth.fail;window.fixtureAuth.verified++;const result=()=>failed?{data:{user:null},error:{message:'verification unavailable',status:failed===401?401:0}}:{data:{user:captured},error:null};return window.fixtureAuth.hold?new Promise(resolve=>window.fixtureAuth.pending.push(()=>resolve(result()))):Promise.resolve(result());},
   async signOut(){window.fixtureAuth.emit(null,'SIGNED_OUT');return {error:null};}
  },from(){return {select(){return {eq(){return {async maybeSingle(){return {data:{display_name:'QA fixture'},error:null};}}}}}}},async rpc(){return {data:null,error:{message:'Not available in account-context fixture'}};}};
  window.supabase={createClient:()=>client};
  Element.prototype.requestFullscreen=async()=>{throw new DOMException('QA fallback','NotAllowedError');};
 },{actor:options.actor===undefined?A:options.actor,expiresIn:options.expiresIn||3600,fail:options.fail||false,hold:!!options.hold,fakeClock:!!options.fakeClock});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({body:'',contentType:'application/javascript'});
  if(url.href.startsWith(BASE)){
   let file=path.resolve('docs',decodeURIComponent(url.pathname.slice(new URL(BASE).pathname.length))||'index.html');
   if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   if(!file.startsWith(path.resolve('docs')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Missing controlled asset'});
   return route.fulfill({path:file,contentType:({'.js':'application/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream'});
  }
  if(url.origin===ORIGIN&&['/crystal-front-demo/','/clutter-cup-playtest/'].includes(url.pathname))return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Account context fixture</title><p>Controlled SDK integration, not a game</p><script src="${BASE}game-platform-sdk.js"></script>`});
  network.push(url.origin+url.pathname);return route.fulfill({status:503,body:'External network disabled'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 async function open(game=CF,route='games/crystal-front/'){
  if(route!==null)await page.goto(BASE+route,{waitUntil:'load'});
  await page.waitForFunction(()=>window.HubAccount?.user());
  await page.evaluate(id=>window.HubPlayer.open(id),game);
  await page.waitForFunction(()=>window.HubPlayer?.trusted());
  const frame=page.frames().find(f=>new URL(f.url()).pathname===(game===CF?'/crystal-front-demo/':'/clutter-cup-playtest/'));
  await frame.waitForFunction(()=>!!window.LibertyPanda?.getAccountContext);
  await frame.evaluate(async()=>{await LibertyPanda.ready;window.accountChanges=[];LibertyPanda.onAccountContextChange(value=>accountChanges.push(value));});
  return frame;
 }
 async function read(frame){return frame.evaluate(()=>LibertyPanda.getAccountContext());}
 async function ready(frame){let value;for(let i=0;i<100;i++){try{value=await read(frame);}catch(error){if(!error.message.includes('ACCOUNT_CONTEXT_CHANGED'))throw error;continue;}if(value.status==='ready')return value;await page.waitForTimeout(20);}throw new Error('Context did not become ready: '+JSON.stringify(value));}
 async function clean(){assert.deepEqual(errors,[]);assert.deepEqual(network,[]);const all=JSON.stringify(messages);assert.ok(!all.includes('SENTINEL_'),'session secrets must not cross iframe boundary');assert.ok(!all.includes('@example.invalid'),'email must not cross iframe boundary');}
 return {context,page,messages,errors,open,read,ready,clean};
}

test('same verified actor/game keeps namespace across close/reopen, reload and re-login; other actor/game differs',async t=>{
 const h=await harness(t),frame=await h.open(),initial=await h.ready(frame);
 assert.equal(initial.gameId,CF);assert.ok(initial.storageNamespace);assert.ok(!initial.storageNamespace.includes(A));
 await h.page.evaluate(()=>HubPlayer.close());let next=await h.open(CF,null);assert.equal((await h.ready(next)).storageNamespace,initial.storageNamespace);
 next=await h.open();assert.equal((await h.ready(next)).storageNamespace,initial.storageNamespace);
 await h.page.evaluate(id=>fixtureAuth.emit(id,'SIGNED_OUT'),null);await h.page.evaluate(id=>fixtureAuth.emit(id),A);next=await h.open(CF,null);assert.equal((await h.ready(next)).storageNamespace,initial.storageNamespace);
 await h.page.evaluate(id=>fixtureAuth.emit(id),B);next=await h.open(CF,null);assert.notEqual((await h.ready(next)).storageNamespace,initial.storageNamespace);
 await h.page.evaluate(id=>fixtureAuth.emit(id),A);next=await h.open(CC,null);assert.notEqual((await h.ready(next)).storageNamespace,initial.storageNamespace);
 await h.clean();
});

test('duplicate same-user auth events retain owner namespace and do not overwrite legacy storage',async t=>{
 const h=await harness(t),frame=await h.open(),initial=await h.ready(frame);
 const before=await frame.evaluate(()=>localStorage.getItem('crystalFrontProgressV1'));
 for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED']){
  await h.page.evaluate(({actor,event})=>fixtureAuth.emit(actor,event),{actor:A,event});
  assert.equal(await h.page.evaluate(()=>!!HubPlayer.current()),true,'same actor must not close iframe');
  assert.equal((await h.ready(frame)).storageNamespace,initial.storageNamespace);
 }
 assert.equal(await frame.evaluate(()=>localStorage.getItem('crystalFrontProgressV1')),before);
 assert.deepEqual(await frame.evaluate(()=>Object.keys(localStorage).filter(key=>key.includes('legacy-fixture'))),[]);
 await h.clean();
});

test('failed verification gives no namespace and leaves legacy data intact; reconnect can recover',async t=>{
 const h=await harness(t,{fail:true}),frame=await h.open();
 const before=await frame.evaluate(()=>localStorage.getItem('crystalFrontProgressV1'));
 const value=await h.read(frame);assert.notEqual(value.status,'ready');assert.equal(value.storageNamespace,null);
 assert.equal(await frame.evaluate(()=>localStorage.getItem('crystalFrontProgressV1')),before);
 await h.page.evaluate(()=>{fixtureAuth.fail=false;fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED');});
 assert.equal((await h.ready(frame)).status,'ready');await h.clean();
});

test('SDK Exit save/stop/fallback failures do not lose legacy data or report a successful close',async t=>{
 const h=await harness(t),frame=await h.open();await h.ready(frame);
 const before=await frame.evaluate(()=>localStorage.getItem('crystalFrontProgressV1'));
 const result=await frame.evaluate(async()=>{let stops=0;try{await LibertyPanda.exit({save:()=>{throw Error('storage full');},stop:()=>stops++});}catch(e){return {message:e.message,stops};}});
 assert.deepEqual(result,{message:'storage full',stops:0});assert.equal(await h.page.evaluate(()=>!!HubPlayer.current()),true);
 const stopError=await frame.evaluate(async()=>{try{await LibertyPanda.exit({save:()=>{},stop:()=>{throw Error('stop failed');}});}catch(e){return e.message;}});
 assert.equal(stopError,'stop failed');assert.equal(await h.page.evaluate(()=>!!HubPlayer.current()),true);
 assert.equal(await frame.evaluate(()=>localStorage.getItem('crystalFrontProgressV1')),before);
 await frame.evaluate(()=>LibertyPanda.exit({save:()=>{},stop:()=>{}}));await h.page.waitForFunction(()=>!HubPlayer.current());await h.clean();
});

test('late getUser results from A→B→A cannot publish a retired launch or replace the new verified context',async t=>{
 const h=await harness(t,{hold:true}),old=await h.open();
 await h.page.waitForFunction(()=>fixtureAuth.pending.length>=1);
 const oldLaunch=new URL(old.url()).searchParams.get('launch');
 await h.page.evaluate(id=>fixtureAuth.emit(id),B);await h.page.waitForFunction(()=>fixtureAuth.pending.length>=2);
 await h.page.evaluate(id=>fixtureAuth.emit(id),A);await h.page.waitForFunction(()=>fixtureAuth.pending.length>=3);
 await h.page.evaluate(()=>{fixtureAuth.hold=false;fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED');});
 const current=await h.open(CF,null),verified=await h.ready(current);
 await h.page.evaluate(()=>fixtureAuth.pending.forEach(resolve=>resolve()));await h.page.waitForTimeout(40);
 const after=await h.read(current);assert.equal(after.storageNamespace,verified.storageNamespace);assert.equal(after.contextSessionId,verified.contextSessionId);assert.equal(after.epoch,verified.epoch);
 assert.equal(h.messages.filter(m=>m.launchId===oldLaunch&&m.context?.status==='ready').length,0,'old verification must never resurrect old launch');
 await h.clean();
});

test('offline revalidation retains only existing unexpired context; explicit server revocation clears it',async t=>{
 const h=await harness(t),frame=await h.open(),verified=await h.ready(frame);
 await h.page.evaluate(()=>{fixtureAuth.fail=true;fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED');});
 await h.page.waitForTimeout(40);const offline=await h.read(frame);
 assert.equal(offline.status,'ready');assert.equal(offline.storageNamespace,verified.storageNamespace);assert.equal(offline.expiresAt,verified.expiresAt,'network failure must not extend verified validity');
 await h.page.evaluate(()=>{fixtureAuth.fail=401;fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED');});
 await frame.waitForFunction(()=>LibertyPanda.accountContext().status!=='ready');
 const revoked=await h.read(frame);assert.equal(revoked.storageNamespace,null);assert.ok(revoked.epoch>verified.epoch);assert.notEqual(revoked.contextSessionId,verified.contextSessionId);
 assert.equal(await frame.evaluate(old=>LibertyPanda.isAccountContextCurrent(old),verified),false);
 // Replay of formerly valid ready cannot resurrect a namespace after revocation.
 await frame.evaluate(old=>dispatchEvent(new MessageEvent('message',{source:parent,origin:location.origin,data:{type:'lpa:account:changed',protocol:1,contextVersion:1,launchId:new URL(location.href).searchParams.get('launch'),context:old}})),verified);
 assert.notEqual((await h.read(frame)).status,'ready');await h.clean();
});

test('expiry invalidates stale captures and same-actor delayed verification cannot revive them',async t=>{
 const h=await harness(t,{fakeClock:true}),frame=await h.open(),verified=await h.ready(frame);
 await h.page.evaluate(()=>{fixtureAuth.hold=true;fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED');});
 await h.page.waitForFunction(()=>fixtureAuth.pending.length>=1);
 await h.page.evaluate(()=>qaAdvanceTime(3601000));await frame.evaluate(()=>qaAdvanceTime(3601000));
 await frame.waitForFunction(()=>LibertyPanda.accountContext().status==='expired');
 const expired=await h.read(frame);assert.equal(expired.storageNamespace,null);assert.ok(expired.epoch>verified.epoch);assert.notEqual(expired.contextSessionId,verified.contextSessionId);
 await h.page.evaluate(()=>fixtureAuth.pending.forEach(resolve=>resolve()));await h.page.waitForTimeout(30);
 assert.equal((await h.read(frame)).status,'expired');
 assert.equal(await frame.evaluate(old=>LibertyPanda.isAccountContextCurrent(old),verified),false);
 await h.page.evaluate(()=>{fixtureAuth.hold=false;fixtureAuth.expiresIn=3600;fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED');});
 const renewed=await h.ready(frame);assert.equal(renewed.storageNamespace,verified.storageNamespace);assert.ok(renewed.epoch>expired.epoch);
 assert.equal(await frame.evaluate(old=>LibertyPanda.isAccountContextCurrent(old),verified),false);await h.clean();
});

test('already expired same-actor refresh rotates epoch; a replayed ready packet cannot restore old owner state',async t=>{
 const h=await harness(t),frame=await h.open(),verified=await h.ready(frame);
 await h.page.evaluate(()=>{fixtureAuth.expiresIn=-1;fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED');});
 await frame.waitForFunction(()=>LibertyPanda.accountContext().status==='expired');const expired=await h.read(frame);
 assert.ok(expired.epoch>verified.epoch);assert.notEqual(expired.contextSessionId,verified.contextSessionId);
 await frame.evaluate(old=>parent.postMessage({type:'lpa:account:request',protocol:1,contextVersion:1,launchId:new URL(location.href).searchParams.get('launch'),requestId:crypto.randomUUID(),epoch:old.epoch,contextSessionId:old.contextSessionId},location.origin),verified);
 await frame.evaluate(old=>dispatchEvent(new MessageEvent('message',{source:parent,origin:location.origin,data:{type:'lpa:account:changed',protocol:1,contextVersion:1,launchId:new URL(location.href).searchParams.get('launch'),context:old}})),verified);
 assert.equal((await h.read(frame)).status,'expired');await h.clean();
});

test('SDK rejects forged source/origin/launch/old epoch/session and orphan responses without mutating context',async t=>{
 const h=await harness(t),frame=await h.open(),verified=await h.ready(frame);
 const latest=await frame.evaluate(old=>{
  const launchId=new URL(location.href).searchParams.get('launch'),base={type:'lpa:account:changed',protocol:1,contextVersion:1,launchId,context:{...old,storageNamespace:'lpa:save:v1:'+'f'.repeat(64)}};
  const emit=(data,source=parent,origin=location.origin)=>dispatchEvent(new MessageEvent('message',{data,source,origin}));
  emit(base,window);emit(base,parent,'https://evil.example');emit({...base,launchId:crypto.randomUUID()});emit({...base,protocol:2});emit({...base,contextVersion:2});
  emit({...base,context:{...base.context,epoch:old.epoch-1}});emit({...base,context:{...base.context,contextSessionId:crypto.randomUUID()}});
  emit({...base,type:'lpa:account:response',requestId:crypto.randomUUID()});
  return LibertyPanda.accountContext();
 },verified);
 assert.equal(latest.storageNamespace,verified.storageNamespace);assert.equal(latest.epoch,verified.epoch);assert.equal(latest.generation,verified.generation);
 await h.clean();
});

test('host rejects forged senders/nonces; advisory epoch cannot select another actor; retired iframe never receives context',async t=>{
 const h=await harness(t),frame=await h.open(),verified=await h.ready(frame);
 const before=h.messages.filter(x=>x.type==='lpa:account:response').length;
 await h.page.evaluate(()=>{
  const launch=HubPlayer.current(),data={type:'lpa:account:request',protocol:1,contextVersion:1,launchId:launch.id,requestId:crypto.randomUUID(),epoch:null,contextSessionId:null};
  const emit=(payload,source=launch.frame.contentWindow,origin=location.origin)=>dispatchEvent(new MessageEvent('message',{data:payload,source,origin}));
  emit(data,window);emit(data,launch.frame.contentWindow,'https://evil.example');emit({...data,launchId:crypto.randomUUID()});emit({...data,protocol:2});emit({...data,contextVersion:2});emit({...data,requestId:'bad'});
  window.retiredAccountWindow=launch.frame.contentWindow;window.retiredAccountLaunch=launch.id;
 });
 await h.page.waitForTimeout(30);assert.equal(h.messages.filter(x=>x.type==='lpa:account:response').length,before);
 const adversarialId=await frame.evaluate(()=>{const requestId=crypto.randomUUID();parent.postMessage({type:'lpa:account:request',protocol:1,contextVersion:1,launchId:new URL(location.href).searchParams.get('launch'),requestId,epoch:999999,contextSessionId:crypto.randomUUID(),actor:'22222222-2222-4222-8222-222222222222'},location.origin);return requestId;});
 await h.page.waitForTimeout(30);const reply=h.messages.find(x=>x.type==='lpa:account:response'&&x.requestId===adversarialId);
 if(reply)assert.equal(reply.context.storageNamespace,verified.storageNamespace,'advisory fields never choose actor');
 await h.page.evaluate(()=>HubPlayer.close());const next=await h.open(CF,null),current=await h.ready(next);
 const oldRequest=await h.page.evaluate(()=>{const requestId=crypto.randomUUID();dispatchEvent(new MessageEvent('message',{source:retiredAccountWindow,origin:location.origin,data:{type:'lpa:account:request',protocol:1,contextVersion:1,launchId:retiredAccountLaunch,requestId}}));return requestId;});
 await h.page.waitForTimeout(30);assert.equal(h.messages.some(x=>x.type==='lpa:account:response'&&x.requestId===oldRequest),false);
 assert.equal((await h.read(next)).storageNamespace,current.storageNamespace);await h.clean();
});

test('all five real shell pages load the account host and return verified context without external auth/network',async t=>{
 const h=await harness(t);
 for(const [route,game]of [['',CF],['games/crystal-front/',CF],['games/crystal-front/install/',CF],['games/clutter-cup/',CC],['games/clutter-cup/install/',CC]]){
  const frame=await h.open(game,route),value=await h.ready(frame);assert.equal(value.gameId,game);
 }
 await h.clean();
});

test('launch game identity is pinned; same-epoch forged gameId must not rebind an existing namespace',async t=>{
 const h=await harness(t),frame=await h.open(),verified=await h.ready(frame);
 await frame.evaluate(old=>dispatchEvent(new MessageEvent('message',{source:parent,origin:location.origin,data:{type:'lpa:account:changed',protocol:1,contextVersion:1,launchId:new URL(location.href).searchParams.get('launch'),context:{...old,gameId:'clutter-cup'}}})),verified);
 const after=await frame.evaluate(()=>LibertyPanda.accountContext());assert.equal(after.gameId,CF);
 assert.equal(await frame.evaluate(old=>LibertyPanda.isAccountContextCurrent({...old,gameId:'clutter-cup'}),verified),false);
 await h.clean();
});

test('pagehide permanently retires this SDK instance; old parent config/context/response cannot revive it',async t=>{
 const h=await harness(t),frame=await h.open(),verified=await h.ready(frame);
 const after=await frame.evaluate(old=>{
  dispatchEvent(new PageTransitionEvent('pagehide'));
  const launchId=new URL(location.href).searchParams.get('launch'),send=data=>dispatchEvent(new MessageEvent('message',{source:parent,origin:location.origin,data:{protocol:1,launchId,...data}}));
  send({type:'lpa:player:config',capabilities:{close:true}});
  send({type:'lpa:account:changed',contextVersion:1,context:old});
  send({type:'lpa:account:response',contextVersion:1,requestId:crypto.randomUUID(),context:old});
  return {available:LibertyPanda.available(),context:LibertyPanda.accountContext(),current:LibertyPanda.isAccountContextCurrent(old)};
 },verified);
 assert.equal(after.available,false);assert.equal(after.context.storageNamespace,null);assert.equal(after.current,false);
 assert.notEqual((await h.read(frame)).status,'ready');await h.clean();
});

test('absent and verification-pending contexts never assign legacy progress to an account',async t=>{
 const h=await harness(t,{actor:null});
 await h.page.goto(BASE+'games/crystal-front/',{waitUntil:'load'});
 await h.page.waitForFunction(()=>window.HubAccount&&window.HubPlayer);
 // Intentionally bypass only the mock UI gate to test the independent host denial.
 await h.page.evaluate(()=>{HubAccess.allowed=async()=>true;return HubPlayer.open('crystal-front-demo');});
 await h.page.waitForFunction(()=>HubPlayer.trusted());
 const frame=h.page.frames().find(f=>new URL(f.url()).pathname==='/crystal-front-demo/');
 await frame.waitForFunction(()=>!!window.LibertyPanda?.getAccountContext);await frame.evaluate(()=>LibertyPanda.ready);
 const absent=await h.read(frame);assert.equal(absent.status,'absent');assert.equal(absent.storageNamespace,null);
 assert.equal(await frame.evaluate(()=>JSON.parse(localStorage.getItem('crystalFrontProgressV1')).bonuses.bomb),7);
 await h.page.evaluate(()=>{fixtureAuth.hold=true;fixtureAuth.emit('11111111-1111-4111-8111-111111111111');});
 const pending=await h.open(CF,null),value=await h.read(pending);assert.equal(value.status,'changed');assert.equal(value.storageNamespace,null);
 assert.equal(await pending.evaluate(()=>JSON.parse(localStorage.getItem('crystalFrontProgressV1')).profile.rays),987);await h.clean();
});

test('throwing account-context consumer callbacks cannot break protocol or alter saved data',async t=>{
 const h=await harness(t),frame=await h.open();await h.ready(frame);
 await frame.evaluate(()=>LibertyPanda.onAccountContextChange(()=>{throw Error('consumer failed');}));
 const initial=await h.read(frame);
 await h.page.evaluate(()=>fixtureAuth.emit('11111111-1111-4111-8111-111111111111','TOKEN_REFRESHED'));
 assert.equal((await h.ready(frame)).storageNamespace,initial.storageNamespace);assert.equal(await frame.evaluate(()=>JSON.parse(localStorage.getItem('crystalFrontProgressV1')).bonuses.bomb),7);await h.clean();
});

test('independent browser storage contexts for the same verified account/game derive identical addressing',async t=>{
 const first=await harness(t),second=await harness(t),one=await first.ready(await first.open()),two=await second.ready(await second.open());
 assert.equal(one.storageNamespace,two.storageNamespace);assert.notEqual(one.contextSessionId,two.contextSessionId);
 await first.clean();await second.clean();
});

test('direct standalone SDK has no account context; failing fallback preserves data and never closes an OS window',async t=>{
 const h=await harness(t);await h.page.goto(ORIGIN+'/crystal-front-demo/',{waitUntil:'load'});
 const outcome=await h.page.evaluate(async()=>{
  let closed=0;window.close=()=>closed++;
  const before=localStorage.getItem('crystalFrontProgressV1'),ctx=await LibertyPanda.getAccountContext();let error;
  try{await LibertyPanda.exit({save:()=>{},stop:()=>{},fallback:()=>{throw Error('menu unavailable');}});}catch(e){error=e.message;}
  return {ctx,before,after:localStorage.getItem('crystalFrontProgressV1'),closed,error,available:LibertyPanda.available()};
 });
 assert.equal(outcome.ctx.storageNamespace,null);assert.equal(outcome.ctx.status,'unknown');assert.equal(outcome.available,false);assert.equal(outcome.before,outcome.after);assert.equal(outcome.closed,0);assert.equal(outcome.error,'menu unavailable');await h.clean();
});

test('contract fixture: async A1 preparation cannot overwrite newer A2 data in the same stable namespace',async t=>{
 const h=await harness(t),frame=await h.open(),a1=await h.ready(frame);
 // Fault injection: retain this document across account switches to test the fence
 // independently of the production gate, which normally destroys the iframe.
 await h.page.evaluate(()=>{window.HubPlayer={...window.HubPlayer,close:async()=>{}};});
 await frame.evaluate(captured=>{
  window.oldPreparation=new Promise(resolve=>{window.resolveOldPreparation=resolve;});
  window.oldCommit=(async()=>{
   const serialized=await oldPreparation;
   if(!LibertyPanda.isAccountContextCurrent(captured))return 'stale-not-written';
   localStorage.setItem(captured.storageNamespace+':qa-contract-save',serialized);
   return 'committed';
  })();
 },a1);
 await h.page.evaluate(id=>fixtureAuth.emit(id),B);
 await frame.waitForFunction(previous=>{const c=LibertyPanda.accountContext();return c.status==='ready'&&c.storageNamespace!==previous;},a1.storageNamespace);
 await h.page.evaluate(id=>fixtureAuth.emit(id),A);
 await frame.waitForFunction(previous=>{const c=LibertyPanda.accountContext();return c.status==='ready'&&c.storageNamespace===previous.storageNamespace&&c.generation!==previous.generation;},a1);
 const a2=await h.ready(frame);assert.equal(a2.storageNamespace,a1.storageNamespace);assert.notEqual(a2.generation,a1.generation);
 const result=await frame.evaluate(async current=>{
  if(!LibertyPanda.isAccountContextCurrent(current))throw Error('new context not current');
  // No await between this fence and the actual synchronous write.
  localStorage.setItem(current.storageNamespace+':qa-contract-save',JSON.stringify({version:'A2-newer'}));
  resolveOldPreparation(JSON.stringify({version:'A1-stale'}));
  const outcome=await oldCommit;
  return {outcome,stored:JSON.parse(localStorage.getItem(current.storageNamespace+':qa-contract-save'))};
 },a2);
 assert.deepEqual(result,{outcome:'stale-not-written',stored:{version:'A2-newer'}});await h.clean();
});
