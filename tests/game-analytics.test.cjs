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
  let enabled=false, context=0, sync, observe;
  const calls=[], messages=[], listeners={};
  const frame={ contentWindow:{ postMessage:data=>messages.push(data) },addEventListener() {} };
  const overlay={ hidden:false };
  const document={ hidden:false,querySelector:s=>s==='#game-frame'?frame:overlay };
  const stats={ enabled:()=>enabled,context:()=>context,subscribe:fn=>{sync=fn;},
    gameEvent:(...args)=>calls.push(args),track() {} };
  vm.runInNewContext(fs.readFileSync('docs/game-analytics-host.js','utf8'), {
    window:{ HubStats:stats,addEventListener:(key,fn)=>{listeners[key]=fn;} },document,
    crypto:{randomUUID},performance:{now:()=>1000},
    MutationObserver:class { constructor(fn){observe=fn;} observe(){} },
  });
  return { calls,messages,frame,document,
    consent(value){enabled=value;context++;sync();},
    close(){overlay.hidden=true;observe();},
    message(name,session,source=frame.contentWindow){listeners.message({source,origin,data:{type:'lpa:event',protocol:1,id:randomUUID(),session,name,data:{}}});},
  };
}
test('host binds messages to active iframe and session, revocation stops collection',()=>{
  const h=host(); assert.equal(h.calls.length,0); h.consent(true);
  const session=h.calls[0][0];
  h.message('ready',randomUUID()); h.message('ready',session,{});
  assert.equal(h.calls.length,1);
  h.message('ready',session); h.message('ready',session);
  assert.equal(h.calls.filter(x=>x[1]==='ready').length,1);
  h.consent(false); h.message('match_start',session);
  assert.equal(h.calls.length,2); assert.equal(h.messages.at(-1).enabled,false);
});
test('host closes session and does not reuse it after identity change',()=>{
  const h=host(); h.consent(true); const first=h.calls[0][0];
  h.consent(true); assert.notEqual(h.calls.at(-1)[0],first);
  h.close(); assert.equal(h.calls.at(-1)[1],'session_end');
});
