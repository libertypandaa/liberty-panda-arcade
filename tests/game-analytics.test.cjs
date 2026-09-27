const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const origin = 'https://libertypandaa.github.io';

function sdk() {
  const messages = [], listeners = {}, docEvents = {}, timers = [];
  let now = 0;
  const parent = { postMessage: (data,target) => messages.push({ data,target }) };
  const window = { parent, addEventListener: (name,fn) => { listeners[name] = fn; } };
  const document = { hidden:false, addEventListener: (name,fn) => { docEvents[name] = fn; } };
  vm.runInNewContext(fs.readFileSync('docs/game-analytics-sdk.js','utf8'), {
    window, document, crypto: { randomUUID }, performance: { now: () => now },
    setInterval: fn => timers.push(fn),
  });
  return { api: window.LibertyPandaAnalytics, messages, listeners, parent, document,
    configure(enabled=true, session=randomUUID()) {
      listeners.message({ source:parent,origin,data:{ type:'lpa:config',protocol:1,enabled,session } });
      return session;
    },
    tick(seconds=1) { for(let i=0;i<seconds;i++) { now+=1000; timers.forEach(fn=>fn()); } },
  };
}
test('SDK sends no telemetry without consent and rejects foreign configuration', () => {
  const s=sdk(); s.api.ready(); s.api.matchStart(); s.api.setPlaying(true); s.tick(30);
  s.listeners.message({ source:{},origin,data:{ type:'lpa:config',protocol:1,enabled:true,session:randomUUID() } });
  s.api.achievement('first_win');
  assert.equal(s.messages.filter(x=>x.data.type==='lpa:event').length,0);
  assert.ok(s.messages.every(x=>x.target===origin));
});
test('readiness survives handshake and is sent once per session', () => {
  const s=sdk(); s.api.ready(); const id=s.configure(); s.configure(true,id); s.api.ready();
  assert.equal(s.messages.filter(x=>x.data.name==='ready').length,1);
  s.configure(true); assert.equal(s.messages.filter(x=>x.data.name==='ready').length,2);
});
test('active time excludes pause, hidden tabs and revoked consent', () => {
  const s=sdk(); s.configure(); s.api.ready(); s.api.setPlaying(true); s.tick(15);
  s.document.hidden=true; s.tick(15); s.document.hidden=false;
  s.api.setPlaying(false); s.tick(15); s.configure(false); s.api.setPlaying(true); s.tick(15);
  const events=s.messages.filter(x=>x.data.name==='active_time');
  assert.equal(events.length,1); assert.equal(events[0].data.data.seconds,15);
});
test('match lifecycle shares ID and rejects invalid outcome or custom text', () => {
  const s=sdk(); s.configure(); const id=s.api.matchStart('duel');
  assert.equal(s.api.matchEnd(id,'win',12),true);
  assert.equal(s.api.matchEnd(id,'winner',12),false);
  assert.equal(s.api.custom('player email',1),false);
  assert.equal(s.api.custom('bomb_used',Infinity),false);
  assert.equal(s.messages.find(x=>x.data.name==='match_end').data.data.match,id);
});


function host() {
 let enabled=false, generation=0, sync, current=null, now=1000;
 const calls=[], messages=[], listeners={};
 const games=Object.fromEntries(['crystal-front-demo','clutter-cup'].map(id=>[id,{id,url:origin+'/'+(id==='clutter-cup'?'clutter-cup-playtest':id)+'/'}]));
 const stats={enabled:()=>enabled,context:()=>generation,subscribe:fn=>sync=fn,gameEvent:(...args)=>calls.push(args),track() {}};
 const document={hidden:false};
 const window={HubStats:stats,HubPlayer:{current:()=>current},HubGames:{selected:frame=>games[frame.dataset.gameId]},addEventListener:(name,fn)=>listeners[name]=fn};
 vm.runInNewContext(fs.readFileSync('docs/game-analytics-host.js','utf8'),{window,document,URL,crypto:{randomUUID},performance:{now:()=>now}});
 function open(id='clutter-cup') {
  if(current) listeners['hub:playerclosing']();
  const callbacks={},frame={dataset:{gameId:id},addEventListener:(n,fn)=>callbacks[n]=fn,contentWindow:{location:{href:'about:blank'},postMessage:d=>messages.push(d)}};
  const nonce=randomUUID(), url=games[id].url+'?launch='+nonce;
  current={id:nonce,game:games[id],frame,url,started:now};
  listeners['hub:playerchange']();
  return {frame,load:(href=url)=>{frame.contentWindow.location.href=href;callbacks.load();}};
 }
 return {calls,messages,document,open,
  consent(value){enabled=value;generation++;sync();},
  close(){listeners['hub:playerclosing']();current=null;listeners['hub:playerchange']();},
  message(name,session,payload={},options={}) {listeners.message({source:options.source||current?.frame.contentWindow,origin:options.origin||origin,data:{type:'lpa:event',protocol:options.protocol||1,id:options.id||randomUUID(),session,name,data:payload}});},
  hello(frame){listeners.message({source:frame.contentWindow,origin,data:{type:'lpa:hello',protocol:1}});},
 };
}
test('host waits for the loaded allowlisted URL, never grants a stale document a session',()=>{
 const h=host();h.consent(true);const old=h.open('crystal-front-demo');h.hello(old.frame);assert.equal(h.calls.length,0);
 const next=h.open();old.load();h.hello(old.frame);assert.equal(h.calls.length,0);
 next.load(origin+'/crystal-front-demo/');assert.equal(h.calls.length,0);
 next.load();assert.equal(h.calls[0][0],'clutter-cup');assert.equal(h.calls[0][2],'session_start');
});
test('host validates origin, source, protocol and session, revokes immediately',()=>{
 const h=host();const launch=h.open();launch.load();assert.equal(h.calls.length,0);h.consent(true);
 const session=h.calls[0][1];h.message('ready',randomUUID());h.message('ready',session,{}, {source:{}});h.message('ready',session,{}, {origin:'https://evil.test'});h.message('ready',session,{}, {protocol:2});assert.equal(h.calls.length,1);
 h.message('ready',session);h.message('ready',session);assert.equal(h.calls.filter(x=>x[2]==='ready').length,1);
 h.consent(false);h.message('match_start',session,{match:randomUUID(),mode:'kitchen_safe'});assert.equal(h.calls.length,2);assert.equal(h.messages.at(-1).enabled,false);
});
test('game switch isolates identity, session, queue arguments and old iframe messages',()=>{
 const h=host();h.consent(true);const cf=h.open('crystal-front-demo');cf.load();const a=h.calls[0][1];
 const cc=h.open();cc.load();const b=h.calls.at(-1)[1];assert.notEqual(a,b);assert.deepEqual(h.calls.map(x=>[x[0],x[2]]),[['crystal-front-demo','session_start'],['crystal-front-demo','session_end'],['clutter-cup','session_start']]);
 h.message('ready',a,{}, {source:cf.frame.contentWindow});assert.equal(h.calls.length,3);
 h.message('ready',b);assert.equal(h.calls.at(-1)[0],'clutter-cup');
 h.consent(true);const c=h.calls.at(-1)[1];assert.notEqual(c,b);h.message('ready',b);assert.equal(h.calls.at(-1)[2],'session_start');
 h.close();assert.equal(h.calls.at(-1)[2],'session_end');
});
test('one match has one result; active time requires readiness and visibility; custom stays off',()=>{
 const h=host();h.consent(true);h.open().load();const s=h.calls[0][1], match=randomUUID();
 h.message('active_time',s,{seconds:15});assert.equal(h.calls.length,1);h.message('ready',s);
 const id=randomUUID();h.message('active_time',s,{seconds:15},{id});h.message('active_time',s,{seconds:15},{id});
 h.document.hidden=true;h.message('active_time',s,{seconds:15});h.document.hidden=false;
 h.message('active_time',s,{seconds:31});assert.equal(h.calls.filter(x=>x[2]==='active_time').length,1);
 h.message('match_end',s,{match,outcome:'win',score:60000});h.message('match_start',s,{match,mode:'kitchen_safe'});h.message('match_start',s,{match,mode:'kitchen_safe'});
 h.message('match_end',s,{match,outcome:'win',score:60000});h.message('match_end',s,{match,outcome:'win',score:60000});
 h.message('custom',s,{name:'cc_drive_mixer',value:1});assert.equal(h.calls.filter(x=>x[2]==='match_start').length,1);assert.equal(h.calls.filter(x=>x[2]==='match_end').length,1);assert.equal(h.calls.filter(x=>x[2]==='custom').length,0);
});

test('closing an unfinished match records one abandon before session_end',()=>{
 const h=host();h.consent(true);h.open().load();const session=h.calls[0][1],match=randomUUID();
 h.message('ready',session);h.message('match_start',session,{match,mode:'kitchen_safe'});h.close();
 const results=h.calls.filter(x=>x[2]==='match_end');assert.equal(results.length,1);assert.equal(results[0][3].outcome,'abandon');assert.equal(results[0][3].score,0);assert.equal(h.calls.at(-1)[2],'session_end');
});
test('SDK reports exactly sixty active seconds across pause and hidden time',()=>{
 const s=sdk();s.configure();s.api.ready();s.api.setPlaying(true);s.tick(30);s.api.setPlaying(false);s.tick(20);
 s.api.setPlaying(true);s.document.hidden=true;s.tick(20);s.document.hidden=false;s.tick(30);s.api.setPlaying(false);
 assert.equal(s.messages.filter(x=>x.data.name==='active_time').reduce((sum,x)=>sum+x.data.data.seconds,0),60);
});
test('update requests never reload an open player',()=>{
 const overlay={hidden:false},listeners={};let reloads=0,activations=0;
 const window={location:{reload:()=>reloads++},addEventListener:(name,fn)=>listeners[name]=fn};
 vm.runInNewContext(fs.readFileSync('docs/update-guard.js','utf8'),{window,document:{querySelector:()=>overlay}});
 window.HubUpdates.requestReload();window.HubUpdates.activate({postMessage:()=>activations++});
 assert.equal(reloads,0);assert.equal(activations,0);overlay.hidden=true;listeners['hub:playerchange']();assert.equal(reloads,1);assert.equal(activations,1);
});
test('registry rejects wrong path, origin and embedded credentials',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('docs/game-registry.js','utf8'),{window,URL,document:{currentScript:{src:origin+'/liberty-panda-arcade/game-registry.js'}},location:{pathname:'/liberty-panda-arcade/games/clutter-cup/'}});
 const frame={dataset:{gameId:'clutter-cup'},src:origin+'/clutter-cup-playtest/?launch=test'};
 assert.equal(window.HubGames.selected(frame).id,'clutter-cup');assert.equal(window.HubGames.forPage().id,'clutter-cup');
 for(const src of [origin+'/crystal-front-demo/',origin+'/clutter-cup-playtest-evil/','https://evil.test/clutter-cup-playtest/','https://user@libertypandaa.github.io/clutter-cup-playtest/']){frame.src=src;assert.equal(window.HubGames.selected(frame),null);}
});

test('updated pages bypass the old worker cache for the telemetry and player bundle',()=>{
 for(const p of ['docs/index.html','docs/games/crystal-front/index.html','docs/games/crystal-front/install/index.html','docs/games/clutter-cup/index.html','docs/games/clutter-cup/install/index.html']){
  const html=fs.readFileSync(p,'utf8');
  for(const name of ['stats.js','game-analytics-host.js','game-player.js','game-registry.js','update-guard.js'])assert.ok(html.includes(name+'?v=20260927-1'),p+' must not use the old cached '+name);
 }
});
