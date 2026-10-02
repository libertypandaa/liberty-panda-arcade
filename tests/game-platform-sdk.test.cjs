const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const origin='https://libertypandaa.github.io';
function sdk(embedded=true){
 const listeners={},messages=[],timers=new Map();let serial=0,now=Date.now();const launchId=randomUUID();
 const parent={postMessage(data,target){messages.push({data,target});}};
 const window={parent,addEventListener:(type,fn)=>listeners[type]=fn};if(!embedded)window.parent=window;
 vm.runInNewContext(fs.readFileSync('docs/game-platform-sdk.js','utf8'),{window,Date:{now:()=>now},location:{href:origin+'/game/?launch='+launchId},URL,crypto:{randomUUID},setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
 const emit=(data,extra={})=>listeners.message({data:{protocol:1,launchId,...data},source:parent,origin,...extra});
 return {api:window.LibertyPanda,messages,emit,launchId,parent,now:()=>now,advance(ms){now+=ms;for(const [id,timer]of [...timers])if(timer.delay<=ms){timers.delete(id);timer.fn();}},configure(){emit({type:'lpa:player:config',capabilities:{close:true}});},fire(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}},pagehide(){listeners.pagehide();}};
}
test('only parent origin/source/protocol/launch can configure SDK',async()=>{
 const s=sdk(),config={type:'lpa:player:config',capabilities:{close:true}};
 s.emit(config,{source:{}});s.emit(config,{origin:'https://evil.test'});s.emit({...config,protocol:2});s.emit({...config,launchId:randomUUID()});assert.equal(s.api.available(),false);await assert.rejects(s.api.wallet(),/PLATFORM_UNAVAILABLE/);s.configure();assert.equal(await s.api.ready,true);
});
test('save failure blocks Exit, stop and fallback; retry recovers',async()=>{
 const s=sdk();s.configure();let stopped=0,fallback=0;
 await assert.rejects(s.api.exit({save:async()=>{throw Error('storage full');},stop:()=>stopped++,fallback:()=>fallback++}),/storage full/);
 assert.equal(stopped,0);assert.equal(fallback,0);assert.equal(s.messages.filter(x=>x.data.type==='lpa:player:close').length,0);
 assert.equal(await s.api.exit({save:async()=>{},stop:()=>stopped++}),true);assert.equal(stopped,1);assert.equal(s.messages.at(-1).data.type,'lpa:player:close');
});
test('standalone Exit saves and uses local fallback, never tries to close browser',async()=>{
 const s=sdk(false),order=[];assert.equal(await s.api.exit({save:()=>order.push('save'),stop:()=>order.push('stop'),fallback:()=>order.push('menu')}),false);assert.deepEqual(order,['save','stop','menu']);assert.equal(s.messages.length,0);s.fire(5000);assert.equal(await s.api.ready,false);
});
test('concurrent Exit sends only one close after saving',async()=>{
 const s=sdk();s.configure();let resolve;const first=s.api.exit({save:()=>new Promise(r=>resolve=r)});assert.equal(await s.api.exit(),false);resolve();await first;assert.equal(s.messages.filter(x=>x.data.type==='lpa:player:close').length,1);
});
test('request validates purchase, pins operation ID and accepts response only once',async()=>{
 const s=sdk();s.configure();await assert.rejects(s.api.purchase('bomb','invalid'),/INVALID_PURCHASE/);const id=randomUUID(),promise=s.api.purchase('bomb',id),request=s.messages.at(-1).data;assert.equal(request.params.operationId,id);
 s.emit({type:'lpa:economy:response',requestId:request.requestId,ok:true,result:'wrong'},{origin:'https://evil.test'});
 s.emit({type:'lpa:economy:response',requestId:request.requestId,ok:true,result:'receipt'});s.emit({type:'lpa:economy:response',requestId:request.requestId,ok:true,result:'duplicate'});assert.equal(await promise,'receipt');
});
test('timeout and page close reject pending calls; late replies cannot revive them',async()=>{
 const s=sdk();s.configure();const promise=s.api.wallet(),request=s.messages.at(-1).data;const rejected=assert.rejects(promise,/REQUEST_TIMEOUT/);s.fire(15000);await rejected;s.emit({type:'lpa:economy:response',requestId:request.requestId,ok:true,result:100});const next=s.api.inventory(),closed=assert.rejects(next,/PAGE_CLOSED/);s.pagehide();await closed;
});
test('early Exit capability is acknowledged once after config without a message loop',()=>{
 const s=sdk();s.api.enableExit();const before=s.messages.length;s.configure();assert.equal(s.messages.length,before+1);assert.equal(s.messages.at(-1).data.capabilities.close,true);
 s.configure();s.configure();s.fire(300);s.fire(1000);s.fire(3000);assert.equal(s.messages.length,before+1);
});
test('product IDs accept database dot syntax and reject length above64',async()=>{
 const s=sdk();s.configure();await assert.rejects(s.api.purchase('a'.repeat(65),randomUUID()),/INVALID_PURCHASE/);
 const promise=s.api.purchase('pack.bomb-1',randomUUID()),message=s.messages.at(-1).data;assert.equal(message.params.productId,'pack.bomb-1');s.emit({type:'lpa:economy:response',requestId:message.requestId,ok:true,result:'receipt'});assert.equal(await promise,'receipt');
});
const context=(extra={})=>({status:'ready',reason:'verified',gameId:'crystal-front-demo',storageNamespace:'lpa:save:v1:'+'a'.repeat(64),expiresAt:Date.now()+60000,epoch:1,contextSessionId:randomUUID(),...extra});
test('account context requires matching request and pins game, discards old epoch/session',async()=>{
 const s=sdk();s.configure();const value=context(),promise=s.api.getAccountContext(),id=s.messages.at(-1).data.requestId;
 s.emit({type:'lpa:account:response',contextVersion:1,requestId:randomUUID(),context:value});assert.equal(s.api.accountContext().status,'unknown');
 s.emit({type:'lpa:account:response',contextVersion:1,requestId:id,context:value});const ready=await promise;assert.equal(s.api.isAccountContextCurrent(ready),true);
 for(const wrong of [{...value,epoch:0},{...value,contextSessionId:randomUUID()},{...value,gameId:'clutter-cup',epoch:2}])s.emit({type:'lpa:account:changed',contextVersion:1,context:wrong});assert.equal(s.api.accountContext(),ready);
});
test('account change rejects pending economy and A-B-A never validates stale async context',async()=>{
 const s=sdk();s.configure();const a=context();s.emit({type:'lpa:account:changed',contextVersion:1,context:a});const captured=s.api.accountContext(),promise=s.api.wallet(),rejected=assert.rejects(promise,/ACCOUNT_CONTEXT_CHANGED/);
 s.emit({type:'lpa:account:changed',contextVersion:1,context:{...a,status:'changed',reason:'verification_pending',storageNamespace:null,expiresAt:null,epoch:2,contextSessionId:randomUUID()}});await rejected;
 s.emit({type:'lpa:account:changed',contextVersion:1,context:{...a,epoch:3,contextSessionId:randomUUID()}});assert.equal(s.api.isAccountContextCurrent(captured),false);assert.equal(s.api.accountContext().storageNamespace,captured.storageNamespace);
});
test('expiry and pagehide fail closed without accepting late context revival',()=>{
 const s=sdk();s.configure();const value=context({expiresAt:s.now()+60000});s.emit({type:'lpa:account:changed',contextVersion:1,context:value});const captured=s.api.accountContext();s.advance(60001);assert.equal(s.api.accountContext().status,'expired');assert.equal(s.api.isAccountContextCurrent(captured),false);
 s.pagehide();s.emit({type:'lpa:account:changed',contextVersion:1,context:{...value,expiresAt:Date.now()+999999,epoch:2}});s.configure();assert.equal(s.api.accountContext().reason,'page_closed');assert.equal(s.api.available(),false);
});
