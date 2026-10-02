const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
let playwright; try { playwright=require('playwright-core'); } catch { playwright=require('../output/qa/playwright-core/package'); }
const {chromium}=playwright;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  localStorage.setItem('lpa:analytics-consent-v2','yes');
  const listeners=[];window.testUser=null;
  window.testSignIn=()=>{window.testUser={id:'test-player',email:'test@example.invalid',user_metadata:{name:'Alex'},app_metadata:{provider:'google'}};listeners.forEach(f=>f('SIGNED_IN',{user:window.testUser}));};
  const client={auth:{onAuthStateChange(f){listeners.push(f);queueMicrotask(()=>f('INITIAL_SESSION',{user:window.testUser}));},async signOut(){window.testUser=null;listeners.forEach(f=>f('SIGNED_OUT',null));return {error:null};}},from(){return {select(){return {eq(){return {async maybeSingle(){return {data:{display_name:'Алекс'}};}}}}}}},async rpc(name){if(name==='hub_admin_stats'||name==='admin_game_stats')return {error:{message:'denied'}};if(name==='my_game_stats')return {data:[{game:'clutter-cup',activeSeconds:120,matches:2}]};return {data:{launches:2,visits:1,history:[]}};}};
  window.supabase={createClient:()=>client};
 });
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
 await context.route('https://libertypandaa.github.io/**',r=>{
  const u=new URL(r.request().url());if(!u.pathname.startsWith('/liberty-panda-arcade/'))return r.fulfill({body:'<p>Game fixture</p>',contentType:'text/html'});
  let file=path.resolve('docs',u.pathname.slice('/liberty-panda-arcade/'.length)||'index.html');if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file))return r.fulfill({status:404,body:''});if(file.endsWith('game-registry.js')) {
   const extra=";{const registry=window.HubGames;const fixture={id:'registry-fixture',title:'Fixture <img onerror=alert(1)>',studio:'Fixture studio',description:'Added only in the browser test',shell:'games/fixture/',cover:'assets/games/crystal-front-feature.png'};window.HubGames={...registry,list:()=>[...registry.list(),fixture],get:id=>id===fixture.id?fixture:registry.get(id)};}";
   return r.fulfill({body:fs.readFileSync(file,'utf8')+extra,contentType:'application/javascript'});
  }return r.fulfill({path:file});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='https://libertypandaa.github.io/liberty-panda-arcade/';
 await page.goto(base);await page.waitForTimeout(250);
 assert.equal(await page.locator('#home.is-active').count(),1);assert.equal(await page.locator('#library.is-active').count(),0);
 assert.equal(await page.locator('[data-game-catalog] .game-card').count(),3);
 assert.equal(await page.locator('[data-game-card="registry-fixture"] h3').innerText(),'Fixture <img onerror=alert(1)>');
 assert.equal(await page.locator('[data-game-card="registry-fixture"] h3 img').count(),0);
 await page.locator('#catalog-search').fill('clutter'); assert.equal(await page.locator('[data-game-catalog] .game-card').count(),1);
 await page.locator('#catalog-search').fill('missing'); assert.equal(await page.locator('[data-catalog-empty]').isVisible(),true);
 await page.locator('#catalog-search').fill('');
 assert.equal(await page.locator('[data-game-library] .game-card').count(),0);
 await page.locator('#home .play-game').first().click();await page.waitForURL('**/#profile');await page.locator('#profile.is-active').waitFor();assert.equal(await page.locator('#game-overlay').isVisible(),false);
 assert.equal(await page.locator('[data-auth-action="sign-in"]').isVisible(),true);
 await page.screenshot({path:'output/player-ui-login.png',fullPage:true});
 await page.evaluate(()=>window.testSignIn());await page.waitForTimeout(200);
 assert.equal(await page.locator('[data-auth-greeting]').innerText(),'Привет, Алекс!');assert.equal(await page.locator('[data-auth-continue]').getAttribute('href'),base+'games/crystal-front/?launch=after-sign-in');assert.equal(await page.locator('[data-auth-continue]').isVisible(),true);assert.equal(await page.locator('[data-stats-admin]').isVisible(),false);
 assert.equal(await page.locator('[data-player-games]').innerText(),'Clutter Cup · 2 мин игры · 2 матчей');
 await page.screenshot({path:'output/player-ui-profile.png',fullPage:true});
 await page.evaluate(()=>location.hash='library');await page.waitForTimeout(100);
 assert.equal(await page.locator('#library.is-active').count(),1);assert.equal(await page.locator('#home.is-active').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('[data-game-library] .game-card').count(),1);
 assert.equal(await page.locator('[data-game-library] [data-game-id="clutter-cup"]').count(),1);
 const playBox=await page.locator('[data-game-library] .play-game').boundingBox();
 const cardBox=await page.locator('[data-game-library] .game-card').boundingBox();
 assert.ok(playBox.y+playBox.height<=cardBox.y+cardBox.height,'Play button must not be clipped by card');
 await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo({top:0,behavior:'instant'});});
 await page.waitForTimeout(500);
 await page.screenshot({path:'output/player-ui-library.png',fullPage:true});
 await page.evaluate(()=>window.HubClient.auth.signOut());await page.waitForTimeout(100);
 assert.equal(await page.locator('[data-game-library] .game-card').count(),0);
 assert.equal(await page.locator('[data-auth-greeting]').innerText(),'Добро пожаловать!');
 await page.evaluate(()=>location.hash='home');await page.waitForTimeout(100);
 await page.locator('[data-game-id="clutter-cup"]').click(); await page.waitForURL('**/#profile');
 assert.equal(await page.locator('#game-overlay').isVisible(),false);
 for(const route of ['games/crystal-front/','games/clutter-cup/']){
  await page.goto(base+route+'?launch=phone-shortcut');await page.waitForURL('**/#profile');assert.equal(await page.locator('#game-overlay').isVisible(),false);
 }
 assert.deepEqual(errors,[]);console.log('PASS mobile login gate, greeting, player summary, hidden admin, separate library, no overflow, PWA guest routes; mocked auth/data.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
