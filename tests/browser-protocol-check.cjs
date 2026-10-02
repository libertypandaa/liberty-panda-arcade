const fs=require('node:fs'),assert=require('node:assert/strict');
const {setup,launch,shells}=require('./browser-check.cjs');
(async()=>{
 const {browser,page,calls,errors,unexpected}=await setup({consent:'yes',approvedExit:true,sessionEndDelayMs:120});
 const checks=[];fs.mkdirSync('output/browser-check',{recursive:true});
 const events=()=>calls.filter(c=>c.name==='record_game_event');
 const expectedSessions=new Map();
 const sessionEvents=session=>events().filter(c=>c.args.p_session===session);
 async function registerSession(frame,game){
  await frame.waitForFunction(()=>window.fixture.analytics?.enabled===true);
  const state=await frame.evaluate(()=>({session:fixture.analytics.session,launchId:fixture.player.launchId}));
  assert.ok(state.session,'an enabled analytics session must have an ID');
  const previous=expectedSessions.get(state.session);
  assert.ok(!previous||previous===game,'a session cannot move between games');
  expectedSessions.set(state.session,game);
  return state;
 }
 async function waitForEvent(session,name){
  for(let n=0;n<100&&!sessionEvents(session).some(c=>c.args.p_name===name);n++)await page.waitForTimeout(20);
  assert.ok(sessionEvents(session).some(c=>c.args.p_name===name),name+' must arrive in expected session');
 }
 try {
  for(const shell of shells){
   let frame=await launch(page,shell);
   await frame.waitForFunction(()=>window.fixture.analytics?.enabled===true);
   await page.waitForFunction(()=>document.querySelector('#game-overlay').classList.contains('game-has-exit'));
   assert.equal(await page.locator('.game-toolbar').isVisible(),false,'approved fixture Exit hides fallback toolbar');
   const bounds=await page.locator('#game-frame').boundingBox();assert.equal(Math.round(bounds.height),page.viewportSize().height,'approved fixture uses full viewport');
   const state=await registerSession(frame,shell.game);
   // Sender, origin, version, nonce and request schema must all match the active document.
   await page.evaluate(({launchId})=>{
    const message={type:'lpa:player:close',protocol:1,launchId,requestId:crypto.randomUUID()};
    const source=window.HubPlayer.current().frame.contentWindow;
    window.dispatchEvent(new MessageEvent('message',{data:message,origin:location.origin,source:window}));
    window.dispatchEvent(new MessageEvent('message',{data:message,origin:'https://evil.example',source}));
   },state);
   await frame.evaluate(()=>{sendClose({launchId:crypto.randomUUID()});sendClose({protocol:2});sendClose({requestId:'bad'});});
   await page.waitForTimeout(30);assert.equal(await page.locator('#game-overlay').isVisible(),true,'forged exits must not close');
   await frame.evaluate(()=>{
    sendEvent('active_time',{seconds:5}); // ignored before ready
    sendEvent('ready',{},crypto.randomUUID(),crypto.randomUUID()); // wrong analytics session
   });
   await page.waitForTimeout(30);
   assert.equal(sessionEvents(state.session).some(c=>['ready','active_time'].includes(c.args.p_name)),false);
   const match=await frame.evaluate(()=>{
    sendEvent('ready',{});sendEvent('active_time',{seconds:5});sendEvent('active_time',{seconds:31});
    const match=crypto.randomUUID();sendEvent('match_start',{match});
    const id=crypto.randomUUID(),payload={match,outcome:'win',score:42};
    sendEvent('match_end',payload,id);sendEvent('match_end',payload,id);sendEvent('match_end',payload);return match;
   });
   await waitForEvent(state.session,'match_end');
   const recorded=sessionEvents(state.session);
   assert.equal(recorded.filter(c=>c.args.p_name==='match_start').length,1);
   assert.equal(recorded.filter(c=>c.args.p_name==='match_end').length,1);
   assert.equal(recorded.filter(c=>c.args.p_name==='active_time').length,1);
   assert.equal(recorded.find(c=>c.args.p_name==='active_time').args.p_data.seconds,5);
   assert.ok(recorded.every(c=>c.args.p_game===shell.game&&c.args.p_guest===null&&c.actor==='11111111-1111-4111-8111-111111111111'),'events scoped to selected game and mocked account');
   await page.evaluate(()=>{window.retiredFixtureWindow=window.HubPlayer.current().frame.contentWindow;});
   await frame.locator('#exit').click();await page.waitForFunction(()=>!window.HubPlayer.current());
   // Reopen on the same page: the previous WindowProxy, launch and analytics session cannot control it.
   await page.evaluate(id=>window.HubPlayer.open(id),shell.game);
   await page.waitForFunction(()=>window.HubPlayer.trusted());
   frame=page.frames().find(f=>['/crystal-front-demo/','/clutter-cup-playtest/'].includes(new URL(f.url()).pathname));
   await frame.waitForFunction(()=>fixture.player&&fixture.analytics?.enabled);
   assert.notEqual(await frame.evaluate(()=>fixture.player.launchId),state.launchId);
   const reopenedState=await registerSession(frame,shell.game);
   assert.notEqual(reopenedState.session,state.session);
   await page.evaluate(({launchId})=>window.dispatchEvent(new MessageEvent('message',{data:{type:'lpa:player:close',protocol:1,launchId,requestId:crypto.randomUUID()},origin:location.origin,source:window.retiredFixtureWindow})),state);
   await frame.evaluate(old=>{sendClose({launchId:old.launchId});sendEvent('match_end',{match:crypto.randomUUID(),outcome:'win',score:999},crypto.randomUUID(),old.session);},state);
   await page.waitForTimeout(30);assert.equal(await page.locator('#game-overlay').isVisible(),true);
   assert.equal(sessionEvents(state.session).filter(c=>c.args.p_name==='match_end').length,1,'old session does not create another result');
   const unfinished=await frame.evaluate(()=>{const match=crypto.randomUUID();sendEvent('match_start',{match});return match;});
   await page.waitForTimeout(30);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.HubPlayer.current());
   for(let n=0;n<50&&!events().some(c=>c.args.p_name==='match_end'&&c.args.p_data.match===unfinished);n++)await page.waitForTimeout(20);
   assert.equal(events().filter(c=>c.args.p_name==='match_end'&&c.args.p_data.match===unfinished).length,1,'closing an unfinished match records one abandonment');
   assert.equal(events().find(c=>c.args.p_name==='match_end'&&c.args.p_data.match===unfinished).args.p_data.outcome,'abandon');
   checks.push({route:shell.route||'catalog',game:shell.game,match,duplicateEnds:0,senderGuards:true,staleSessionRejected:true,approvedExit:true});
  }
  // Switching games in a live document retires the previous telemetry session.
  const beforeSwitch=await launch(page,shells[0]);
  const priorState=await registerSession(beforeSwitch,shells[0].game);
  const oldGameSession=await page.evaluate(()=>window.HubPlayer.current().id);
  await page.evaluate(()=>window.HubPlayer.open('crystal-front-demo'));
  await page.waitForFunction(()=>window.HubPlayer.trusted()&&window.HubPlayer.current().game.id==='crystal-front-demo');
  assert.notEqual(await page.evaluate(()=>window.HubPlayer.current().id),oldGameSession);
  const switched=page.frames().find(f=>new URL(f.url()).pathname==='/crystal-front-demo/');
  await switched.waitForFunction(()=>fixture.analytics?.enabled);
  const switchedState=await registerSession(switched,'crystal-front-demo');
  assert.notEqual(switchedState.session,priorState.session);
  await switched.evaluate(()=>sendEvent('ready',{}));
  await waitForEvent(switchedState.session,'ready');
  assert.equal(sessionEvents(switchedState.session).find(c=>c.args.p_name==='ready').args.p_game,'crystal-front-demo');
  await page.screenshot({path:'output/browser-check/controlled-approved-exit.png'});
  await switched.locator('#exit').click();await page.waitForFunction(()=>!window.HubPlayer.current());
  // Consent revocation changes analytics only. Control-channel exit remains operational.
  let frame=await launch(page,shells[0]);
  const revokedState=await registerSession(frame,shells[0].game);
  await waitForEvent(revokedState.session,'session_start');
  await page.evaluate(()=>{const checkbox=document.querySelector('[data-stats-consent]');checkbox.checked=false;checkbox.dispatchEvent(new Event('change'));});
  await frame.waitForFunction(()=>fixture.analytics?.enabled===false);
  const before=sessionEvents(revokedState.session).length;
  await frame.evaluate(()=>sendEvent('ready',{}));await frame.locator('#exit').click();await page.waitForFunction(()=>!window.HubPlayer.current());
  await page.waitForTimeout(150);assert.equal(sessionEvents(revokedState.session).length,before,'revoked consent emits no game events');
  // Audit every collected event, including late session_end from earlier documents.
  // Filtering assertions by session does not exclude old events from identity checks.
  for(const event of events()){
   assert.ok(expectedSessions.has(event.args.p_session),'unexpected analytics session '+JSON.stringify(event));
   assert.equal(event.args.p_game,expectedSessions.get(event.args.p_session),'session/game mismatch '+JSON.stringify(event));
   assert.equal(event.args.p_guest,null,'mandatory authenticated play emitted a guest identity '+JSON.stringify(event));
   assert.equal(event.actor,'11111111-1111-4111-8111-111111111111','wrong account '+JSON.stringify(event));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  fs.writeFileSync('output/browser-check/protocol-report.json',JSON.stringify({controlled:true,mockedAuth:true,mockedGame:true,mockedDatabase:true,approvedExitOnlyInFixture:true,realRaceFinish:false,realDatabase:false,realGameSaveVerified:false,checks,consentRevocation:true,delayedSessionEndMs:120,allEventIdentitiesAudited:true,expectedSessions:Object.fromEntries(expectedSessions),errors,events:events()},null,2));
  console.log('PASS controlled Chromium protocol: five shells, close v1 sender/origin/nonce guards, session renewal, one result per match, synthetic active_time, Escape and consent revocation. No real game/DB/save claims.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
