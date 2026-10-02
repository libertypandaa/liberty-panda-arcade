const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
let playwright; try { playwright = require('playwright-core'); } catch { playwright = require('../output/qa/playwright-core/package'); }
const { chromium } = playwright;
const base = 'https://libertypandaa.github.io/liberty-panda-arcade/';
const shells = [
 {route:'', game:'clutter-cup'},
 {route:'games/crystal-front/', game:'crystal-front-demo'},
 {route:'games/crystal-front/install/', game:'crystal-front-demo'},
 {route:'games/clutter-cup/', game:'clutter-cup'},
 {route:'games/clutter-cup/install/', game:'clutter-cup'},
];
const fixture = `<!doctype html><html><body style="margin:0;background:#123;color:white;font:20px system-ui;padding:24px;box-sizing:border-box"><h1>Controlled game fixture</h1><p>This is not a real game build.</p><button id="exit" style="padding:14px">Exit Game</button><script>
 window.fixture={player:null,analytics:null};
 window.sendEvent=(name,data,id=crypto.randomUUID(),session=fixture.analytics?.session)=>parent.postMessage({type:'lpa:event',protocol:1,session,id,name,data},location.origin);
 window.sendClose=(overrides={})=>parent.postMessage({type:'lpa:player:close',protocol:1,launchId:fixture.player?.launchId,requestId:crypto.randomUUID(),...overrides},location.origin);
 addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;
  if(event.data?.type==='lpa:player:config'&&fixture.player?.launchId!==event.data.launchId){fixture.player=event.data;parent.postMessage({type:'lpa:player:hello',protocol:1,launchId:event.data.launchId,capabilities:{close:true}},location.origin);}
  if(event.data?.type==='lpa:config')fixture.analytics=event.data;
 });
 document.querySelector('#exit').onclick=()=>sendClose();
 </script></body></html>`;
async function setup({consent='yes', approvedExit=false, sessionEndDelayMs=0}={}) {
 const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context = await browser.newContext({serviceWorkers:'block',viewport:{width:844,height:430}});
 const calls=[], errors=[], unexpected=[];
 await context.exposeBinding('__recordFixtureRpc',async (_source,entry)=>{
  // A previous page's already-submitted RPC can settle after the next page loads.
  // Capture its identity at submission; delayed completion must not relabel it.
  if(entry.name==='record_game_event'&&entry.args?.p_name==='session_end'&&sessionEndDelayMs)
   await new Promise(resolve=>setTimeout(resolve,sessionEndDelayMs));
  calls.push(entry);
 });
 await context.addInitScript(({consent})=>{
  if(window!==window.top)return;
  localStorage.setItem('lpa:analytics-consent-v2',consent);
  const listeners=[];
  const makeUser=id=>id?{id,email:id+'@example.invalid',user_metadata:{name:'Fixture player'},app_metadata:{provider:'google'}}:null;
  let user=makeUser('11111111-1111-4111-8111-111111111111');
  window.fixtureAuth=id=>{user=makeUser(id);for(const listener of listeners)listener(user?'SIGNED_IN':'SIGNED_OUT',user?{user}:null);};
  // Exercise the browser's full-window fallback deterministically without depending on OS fullscreen policy.
  Element.prototype.requestFullscreen=async()=>{throw new DOMException('Fixture denies fullscreen','NotAllowedError');};
  const client={auth:{onAuthStateChange(callback){listeners.push(callback);queueMicrotask(()=>callback('INITIAL_SESSION',{user}));return {data:{subscription:{unsubscribe(){}}}};},async signOut(){window.fixtureAuth(null);return {error:null};}},from(){return {select(){return {eq(){return {async maybeSingle(){return {data:{display_name:'Fixture player'}};}}}}}}},async rpc(name,args){await window.__recordFixtureRpc({name,args,actor:user?.id});if(name==='my_hub_stats')return {data:{launches:1,visits:1,history:[]}};if(name==='my_game_stats')return {data:[]};if(name==='record_hub_event'||name==='record_game_event')return {data:null,error:null};return {data:null,error:{message:'Unconfigured fixture RPC'}};}};
  window.supabase={createClient:()=>client};
 },{consent});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({body:'',contentType:'application/javascript'});
  if(url.href.startsWith(base)){
   const relative=decodeURIComponent(url.pathname.slice(new URL(base).pathname.length));
   let file=path.resolve('docs',relative||'index.html');if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   if(!file.startsWith(path.resolve('docs')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   const contentType=({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'})[path.extname(file)]||'application/octet-stream';
   if(approvedExit&&file.endsWith('game-registry.js'))return route.fulfill({body:fs.readFileSync(file,'utf8').replaceAll('"playerExit": false','"playerExit": true'),contentType});
   return route.fulfill({path:file,contentType});
  }
  if(url.origin==='https://libertypandaa.github.io'&&['/crystal-front-demo/','/clutter-cup-playtest/'].includes(url.pathname))return route.fulfill({body:fixture,contentType:'text/html'});
  unexpected.push(url.origin+url.pathname);return route.fulfill({status:503,body:'No external network in controlled tests'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {browser,context,page,calls,errors,unexpected};
}
async function launch(page,shell){
 await page.goto(base+shell.route,{waitUntil:'load'});
 await page.waitForFunction(()=>window.HubAccount?.user());
 const button=shell.route?page.locator('.play-game').first():page.locator('[data-game-catalog] [data-game-id="'+shell.game+'"]');
 await button.click();
 await page.waitForFunction(()=>window.HubPlayer?.trusted());
 const frame=page.frames().find(f=>['/crystal-front-demo/','/clutter-cup-playtest/'].includes(new URL(f.url()).pathname));
 assert.ok(frame,'controlled game iframe must be loaded');
 await frame.waitForFunction(()=>!!window.fixture?.player);
 return frame;
}
async function main(){
 const env=await setup({consent:'no'});const {browser,page,calls,errors,unexpected}=env;
 const checks=[];fs.mkdirSync('output/browser-check',{recursive:true});
 try {
  for(const shell of shells){
   let frame=await launch(page,shell);
   assert.equal(await page.evaluate(()=>document.fullscreenElement===null),true);
   const viewport=page.viewportSize(), bounds=await page.locator('#game-frame').boundingBox(), toolbar=await page.locator('.game-toolbar').boundingBox();
   assert.ok(bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height+1,'full-window fallback fits landscape');
   assert.ok(toolbar.y+toolbar.height<=bounds.y+1,'fallback controls do not cover playfield');
   assert.equal(await page.locator('#close-game').isVisible(),true,'unapproved releases keep fallback Exit');
   await frame.locator('#exit').click();await page.waitForFunction(()=>!window.HubPlayer.current());
   assert.equal(await page.locator('#game-overlay').isVisible(),false,'Exit message closes shell without analytics consent');
   frame=await launch(page,shell);await page.evaluate(()=>window.fixtureAuth('22222222-2222-4222-8222-222222222222'));
   await page.waitForFunction(()=>!window.HubPlayer.current());
   assert.equal(await page.locator('#game-overlay').isVisible(),false,'account switch retires iframe');
   checks.push({route:shell.route||'catalog',game:shell.game,exit:true,accountChange:true,fullscreenFallback:true});
  }
  await launch(page,shells[0]);await page.screenshot({path:'output/browser-check/controlled-landscape.png'});
  await page.locator('#close-game').click();assert.equal(await page.locator('#game-overlay').isVisible(),false);
  assert.equal(calls.filter(c=>c.name==='record_game_event').length,0,'no game telemetry without consent');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  fs.writeFileSync('output/browser-check/report.json',JSON.stringify({controlled:true,mockedAuth:true,mockedGame:true,mockedDatabase:true,realGameBuild:false,realDatabase:false,physicalPhone:false,checks,errors},null,2));
  console.log('PASS controlled Chromium: five official shells, Exit v1 without consent, account switch, landscape fullscreen fallback. Auth/game/database mocked; no external network.');
 } finally {await browser.close();}
}
module.exports={setup,launch,shells,base};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
