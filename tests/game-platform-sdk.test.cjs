const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const origin='https://libertypandaa.github.io';
function sdk(embedded=true){
 const listeners={},messages=[],timers=new Map();let serial=0;const launchId=randomUUID();
 const parent={postMessage(data,target){messages.push({data,target});}};
 const window={parent,addEventListener:(type,fn)=>listeners[type]=fn};if(!embedded)window.parent=window;
 vm.runInNewContext(fs.readFileSync('docs/game-platform-sdk.js','utf8'),{window,location:{href:origin+'/game/?launch='+launchId},URL,crypto:{randomUUID},setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
 const emit=(data,extra={})=>listeners.message({data:{protocol:1,launchId,...data},source:parent,origin,...extra});
 return {api:window.LibertyPanda,messages,emit,launchId,parent,configure(){emit({type:'lpa:player:config',capabilities:{close:true}});},fire(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}},pagehide(){listeners.pagehide();}};
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
