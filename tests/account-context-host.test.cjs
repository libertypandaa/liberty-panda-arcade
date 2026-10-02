const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',origin='https://libertypandaa.github.io';
const flush=()=>new Promise(r=>setImmediate(r));
function host({verify,hash}={}){
 let now=100000,auth,actor=A,expiry=200;const events={},timers=new Map(),messages=[];let next=0;
 let launch={id:randomUUID(),game:{id:'crystal-front-demo',url:origin+'/crystal-front-demo/'},frame:{contentWindow:{postMessage(data){messages.push(data);}}}};
 const window={LIBERTY_PANDA_AUTH_CONFIG:{supabaseUrl:'https://brvrlbahysbslkqntesl.supabase.co'},HubPlayer:{current:()=>launch,trusted:l=>l===launch},HubClient:{auth:{onAuthStateChange(fn){auth=fn;},getUser:()=>verify?verify():Promise.resolve({data:{user:{id:actor}}})}},addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(fs.readFileSync('docs/account-context-host.js','utf8'),{window,document:{readyState:'complete'},URL,TextEncoder,Uint8Array,Date:{now:()=>now},crypto:{randomUUID,subtle:{digest:hash|| (async(_name,data)=>createHash('sha256').update(data).digest())}},setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 return {messages,auth(id=A,expires=200,event='SIGNED_IN'){actor=id;expiry=expires;auth(event,id?{user:{id},expires_at:expires}:null);},async verify(){for(const [id,t]of [...timers])if(t.ms===0){timers.delete(id);await t.fn();}await flush();},request(extra={},source){const requestId=randomUUID();events.message({origin,source:source||launch.frame.contentWindow,data:{type:'lpa:account:request',protocol:1,contextVersion:1,launchId:launch.id,requestId,...extra}});return requestId;},advance(ms){now+=ms;for(const [id,t]of [...timers])if(t.ms>0&&t.ms<=ms){timers.delete(id);t.fn();}},replace(gameId='crystal-front-demo'){launch={...launch,id:randomUUID(),game:{...launch.game,id:gameId}};},latest(){return messages.at(-1)?.context;}};
}
test('stable namespace across reauth/reload, separate account and game, no secrets',async()=>{
 const h=host();h.auth();await h.verify();const first=h.latest();assert.equal(first.status,'ready');assert.match(first.storageNamespace,/^lpa:save:v1:[a-f0-9]{64}$/);assert.equal(JSON.stringify(first).includes(A),false);
 h.auth(A,250,'TOKEN_REFRESHED');await h.verify();assert.equal(h.latest().storageNamespace,first.storageNamespace);assert.equal(h.latest().epoch,first.epoch);
 h.auth(B);await h.verify();assert.notEqual(h.latest().storageNamespace,first.storageNamespace);h.auth(A);await h.verify();assert.equal(h.latest().storageNamespace,first.storageNamespace);assert.notEqual(h.latest().contextSessionId,first.contextSessionId);
 const reloaded=host();reloaded.auth(A);await reloaded.verify();assert.equal(reloaded.latest().storageNamespace,first.storageNamespace);
 h.replace('clutter-cup');h.request();await flush();assert.notEqual(h.latest().storageNamespace,first.storageNamespace);
});
test('source and launch reject requests, offline fresh state stays unknown, signed out absent',async()=>{
 const h=host();h.request({},{});h.request({launchId:randomUUID()});await flush();assert.equal(h.messages.length,0);h.request();await flush();assert.equal(h.latest().status,'unknown');h.auth(null);await flush();assert.equal(h.latest().status,'absent');assert.equal(h.latest().storageNamespace,null);
});
test('late getUser A response cannot revive after A to B to A',async()=>{
 const resolvers=[];const h=host({verify:()=>new Promise(r=>resolvers.push(r))});h.auth(A);const one=h.verify();h.auth(B);const two=h.verify();h.auth(A);const three=h.verify();resolvers[2]({data:{user:{id:A}}});await three;const current=h.latest();resolvers[1]({data:{user:{id:B}}});resolvers[0]({data:{user:{id:A}}});await Promise.all([one,two]);assert.equal(h.latest(),current);
});
test('network failure retains verified until expiry; rejection401 rotates and revokes',async()=>{
 let reply={data:{user:{id:A}}};const h=host({verify:async()=>reply});h.auth();await h.verify();const initial=h.latest();reply={error:{message:'network'}};h.auth(A,250,'TOKEN_REFRESHED');await h.verify();h.request();await flush();assert.equal(h.latest().storageNamespace,initial.storageNamespace);assert.equal(h.latest().expiresAt,200000);
 reply={error:{status:401}};h.auth(A,250);await h.verify();assert.equal(h.latest().status,'unknown');assert.equal(h.latest().storageNamespace,null);assert.ok(h.latest().epoch>initial.epoch);
});
test('hard expiry rotates context and never exposes old namespace',async()=>{const h=host();h.auth();await h.verify();const before=h.latest();h.advance(100000);await flush();assert.equal(h.latest().status,'expired');assert.equal(h.latest().storageNamespace,null);assert.notEqual(h.latest().contextSessionId,before.contextSessionId);});
