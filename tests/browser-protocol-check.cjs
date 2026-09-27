const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const base='https://libertypandaa.github.io/liberty-panda-arcade/';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:800}});
 const calls=[], errors=[], screenshots='output/browser-check';fs.mkdirSync(screenshots,{recursive:true});
 await context.route(base+'**',async route=>{
  const u=new URL(route.request().url());const rel=decodeURIComponent(u.pathname.slice(new URL(base).pathname.length));
  let file=path.resolve('docs',rel||'index.html');if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!file.startsWith(path.resolve('docs')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
  await route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});
 });
 await context.route('**/rest/v1/rpc/**',async route=>{
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,x-client-info,content-type,x-supabase-api-version','access-control-allow-methods':'POST,OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const name=route.request().url().split('/').pop();const args=route.request().postDataJSON();calls.push({name,args});
  let data=null;
  if(name==='my_hub_stats')data={launches:calls.filter(x=>x.args?.p_kind==='launch').length,visits:1,lastGame:'clutter-cup',history:[{game:'clutter-cup',created_at:new Date().toISOString()}]};
  if(name==='my_game_stats')data=[];
  await route.fulfill({json:data,headers});
 });

 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('lpa:analytics-consent-v2','yes');});
 await page.goto(base+'games/clutter-cup/?launch=test',{waitUntil:'networkidle',timeout:120000});
 for(let n=0;n<90&&!calls.some(c=>c.args?.p_name==='ready');n++)await page.waitForTimeout(1000);
 const frame=page.frames().find(f=>f.url().includes('/clutter-cup-playtest/'));
 if(!frame)throw Error('No iframe');
 async function saveSnapshot(f){return f.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('clutter-cup');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('profile','readonly').objectStore('profile').get('current');q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=()=>reject(q.error);};}));}
 const before=await saveSnapshot(frame);console.log('SAVE KEYS',Object.keys(before||{}));
 await frame.getByRole('button',{name:'Гонка',exact:true}).click();await page.waitForTimeout(4000);
 console.log('RACE UI',await frame.locator('body').innerText());await page.screenshot({path:screenshots+'/race-start.png'});
 // Labelled protocol fixture, not a claimed physical race finish.
 const match=await frame.evaluate(()=>{window.LibertyPandaAnalytics.setPlaying(true);return window.LibertyPandaAnalytics.matchStart('kitchen_safe');});
 await page.waitForTimeout(16000);
 await frame.evaluate(id=>{window.LibertyPandaAnalytics.setPlaying(false);window.LibertyPandaAnalytics.matchEnd(id,'win',65432);window.LibertyPandaAnalytics.matchEnd(id,'win',65432);},match);
 await page.waitForTimeout(1000);
 console.log('RACE EVENTS',JSON.stringify(calls.filter(c=>c.name==='record_game_event').map(c=>({name:c.args.p_name,data:c.args.p_data}))));
 await page.screenshot({path:screenshots+'/race.png'});
 const after=await saveSnapshot(frame);
 await page.locator('#close-game').click();await page.waitForTimeout(1000);
 await page.locator('.play-game').click();
 await page.frameLocator('#game-frame').getByRole('button',{name:'Гонка',exact:true}).waitFor({timeout:120000});
 const next=page.frames().find(f=>f.url().includes('/clutter-cup-playtest/'));
 const reopened=await saveSnapshot(next);
 await page.screenshot({path:screenshots+'/reopened.png'});
 const events=calls.filter(c=>c.name==='record_game_event');
 for(const key of ['coins','reputation','achievements','blueprint','tutorial'])if(JSON.stringify(after[key])!==JSON.stringify(reopened[key]))throw Error('Save changed on reopen: '+key);
 if(events.filter(c=>c.args.p_name==='match_end').length!==1)throw Error('Duplicate/missing result');
 if(!events.some(c=>c.args.p_name==='active_time'&&c.args.p_data.seconds>0))throw Error('Missing active time');
 fs.writeFileSync(screenshots+'/gameplay-report.json',JSON.stringify({controlled:true,protocolFixture:true,realRaceFinish:false,realDatabase:false,savePreserved:true,errors,before,after,reopened,events},null,2));
 console.log('Gameplay check captured',JSON.stringify({errors,saved:!!reopened,starts:events.filter(c=>c.args.p_name==='match_start').length,ends:events.filter(c=>c.args.p_name==='match_end').length}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
