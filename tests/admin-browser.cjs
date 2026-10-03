/* Deterministic browser fixture only: no live identities or production RPCs. */
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
let chromium;try{({chromium}=require('playwright-core'));}catch{({chromium}=require('../output/qa/playwright-core/package'));}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const listeners=[];window.adminFixture={user:null,allowed:false,calls:[],fail:false};
  window.adminSignIn=(id)=>{window.adminFixture.user=id?{id,email:'fixture@example.invalid',user_metadata:{role:'owner',name:'Проверка'},app_metadata:{role:'owner'}}:null;listeners.forEach(fn=>fn(id?'SIGNED_IN':'SIGNED_OUT',window.adminFixture.user?{user:window.adminFixture.user}:null));};
  window.supabase={createClient:()=>({auth:{onAuthStateChange(fn){listeners.push(fn);queueMicrotask(()=>fn('INITIAL_SESSION',null));},async signOut(){window.adminSignIn(null);return{};}},from(){return{select(){return{eq(){return{async maybeSingle(){return{data:null};}};}};}};},async rpc(name,args){
   window.adminFixture.calls.push({name,args});
   if(window.adminFixture.fail)return{error:{message:'private error'}};
   if(!window.adminFixture.allowed)return{error:{code:'42501'}};
   if(name==='lpa_admin_access')return{data:{contractVersion:1,access:{allowed:true},permissions:['analytics:read']}};
   if(name!=='lpa_admin_analytics')throw Error('Unexpected RPC');
   return{data:{contractVersion:1,access:{allowed:true},generatedAt:'2026-10-03T15:00:00Z',games:[{id:'crystal-front-demo',title:'Crystal Front'},{id:'clutter-cup',title:'Clutter Cup'}],summary:{players:12,sessions:26,activeSeconds:3860,matches:18,completedMatches:16,wins:9,losses:6,draws:1,abandons:2,errors:0,installations:null},activity:[{date:'2026-10-03',gameId:'crystal-front-demo',players:12,sessions:26,activeSeconds:3860}],results:[{gameId:'crystal-front-demo',scoreUnit:'points',wins:9,losses:6,draws:1,abandons:2,meanScore:42}],versions:[{gameId:'crystal-front-demo',version:null,buildId:null,sessions:26}]}};
  }})};
 });
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
 await context.route('https://libertypandaa.github.io/**',r=>{
  const u=new URL(r.request().url());let file=path.resolve('docs',u.pathname.slice('/liberty-panda-arcade/'.length)||'index.html');
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  return fs.existsSync(file)?r.fulfill({path:file}):r.fulfill({status:404,body:''});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://libertypandaa.github.io/liberty-panda-arcade/admin/');
 await page.getByRole('button',{name:'Открыть кабинет',exact:true}).waitFor();
 assert.equal(await page.locator('[data-admin-open]').isDisabled(),true);
 assert.equal(await page.locator('[data-admin-dashboard]').isVisible(),false);
 await page.evaluate(()=>window.adminSignIn('ordinary'));
 await page.locator('[data-admin-open]').click();
 await page.locator('[data-admin-status]').filter({hasText:'Нет доступа'}).waitFor();
 assert.equal(await page.evaluate(()=>window.adminFixture.calls.length),1);
 assert.equal(await page.locator('[data-admin-dashboard]').isVisible(),false);
 fs.mkdirSync('output/admin-qa',{recursive:true});
 await page.screenshot({path:'output/admin-qa/denied.png',fullPage:true});
 await page.evaluate(()=>{window.adminFixture.allowed=true;});
 await page.locator('[data-admin-open]').click();
 await page.locator('[data-admin-dashboard]').waitFor();
 assert.equal(await page.locator('.metric').count(),6);
 assert.match(await page.locator('[data-admin-versions]').innerText(),/Неизвестно/);
 await page.locator('[data-admin-game]').selectOption('crystal-front-demo');
 await page.getByRole('button',{name:'Обновить',exact:true}).click();
 await page.locator('[data-admin-dashboard]').waitFor();
 const args=await page.evaluate(()=>window.adminFixture.calls.at(-1).args);
 assert.equal(args.p_game_id,'crystal-front-demo');assert.ok(args.p_date_from);assert.ok(args.p_date_to);
 await page.screenshot({path:'output/admin-qa/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'output/admin-qa/mobile.png',fullPage:true});
 await page.locator('[data-admin-close]').click();
 assert.equal(await page.locator('[data-admin-dashboard]').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.adminFixture.user.id),'ordinary');
 await page.locator('[data-admin-open]').click();await page.locator('[data-admin-dashboard]').waitFor();
 await page.evaluate(()=>window.adminSignIn(null));
 assert.equal(await page.locator('[data-admin-dashboard]').isVisible(),false);
 assert.equal(await page.locator('.metric').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS admin desktop/mobile, ordinary forged-role denial, explicit access, real-contract fixture, game filters, unknown versions, no overflow, close preserves player, logout clears data. Mock auth/RPC only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
