const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const origin='https://libertypandaa.github.io';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function host({rpc,confirm=true,storage=new Map(),denyStorage=false}={}) {
 const listeners={},calls=[],messages=[],events=[];
 let actor='actor-a',trusted=true,confirmCount=0,authListener=()=>{},now=1000;
 let launch={id:randomUUID(),game:{id:'new-game',title:'New game',url:origin+'/new-game/'},frame:{contentWindow:{postMessage(data,target){messages.push({data,target});}}}};
 const window={HubAccount:{user:()=>actor?{id:actor}:null},HubPlayer:{current:()=>launch,trusted:()=>trusted},HubClient:{auth:{onAuthStateChange(fn){authListener=fn;}},rpc:async(name,params)=>{calls.push({name,params,actor});return rpc?rpc(name,params):{data:name==='lpa_purchase_status'?null:name==='lpa_catalog'?[{id:'bomb',title:'Bomb',price:10,priceVersion:3}]:{balance:100}};}},confirm:()=>{confirmCount++;return confirm;},dispatchEvent:event=>events.push(event.type),addEventListener:(name,fn)=>{(listeners[name]||=[]).push(fn);}};
 vm.runInNewContext(fs.readFileSync('docs/economy-host.js','utf8'),{window,document:{readyState:'complete'},URL,Date:{now:()=>now},localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){if(denyStorage)throw Error('denied');storage.set(key,value);},removeItem:key=>storage.delete(key)},CustomEvent:class{constructor(type){this.type=type;}}});
 const request=(action='wallet',params={},extra={})=>({type:'lpa:economy:request',protocol:1,launchId:launch.id,requestId:randomUUID(),action,params,...extra});
 return {calls,messages,events,request,window,storage,advance(ms){now+=ms;},get confirms(){return confirmCount;},emit(data,extra={}){for(const fn of listeners.message||[])fn({source:launch.frame.contentWindow,origin,data,...extra});},actor(value){actor=value;authListener('SIGNED_IN',value?{user:{id:value}}:null);for(const fn of listeners['hub:accountchange']||[])fn({});},trusted(value){trusted=value;},replace(){launch={...launch,id:randomUUID()};}};
}
test('source, origin, launch, protocol and trust checks fail closed',async()=>{
 const h=host(),r=h.request();h.emit(r,{source:{}});h.emit(r,{origin:'https://evil.test'});h.emit({...r,launchId:randomUUID()});h.emit({...r,protocol:2});h.emit({...r,requestId:'bad'});h.trusted(false);h.emit(r);await flush();assert.equal(h.calls.length,0);assert.equal(h.messages.length,0);
});
test('RPC allowlist and payload validation reject price, actor and arbitrary methods',async()=>{
 const h=host();for(const action of ['execute_sql','lpa_purchase','grant','constructor'])h.emit(h.request(action));
 for(const extra of [{price:0},{actorId:'someone'},{p_user_id:'someone'},{quantity:20}])h.emit(h.request('purchase',{productId:'bomb',operationId:randomUUID(),...extra}));
 h.emit(h.request('wallet',{actor:'other'}));h.emit(h.request('purchase',{productId:'../bomb',operationId:randomUUID()}));await flush();assert.equal(h.calls.length,0);
 for(const action of ['wallet','catalog','inventory'])h.emit(h.request(action));await flush();assert.deepEqual(h.calls.map(x=>x.name),['lpa_wallet','lpa_catalog','lpa_inventory']);assert.ok(h.calls.slice(1).every(x=>x.params.p_game_id==='new-game'));
});
test('same request executes once; changed payload conflicts; server price wins',async()=>{
 const h=host(),r=h.request('purchase',{productId:'bomb',operationId:randomUUID()});h.emit(r);h.emit(r);h.emit({...r,params:{...r.params,productId:'other'}});await flush();
 assert.equal(h.calls.filter(x=>x.name==='lpa_purchase').length,1);assert.equal(h.confirms,1);assert.equal(h.calls.find(x=>x.name==='lpa_purchase').params.p_expected_price,undefined);
 assert.equal(h.calls.find(x=>x.name==='lpa_purchase').params.p_price_version,3);
 assert.equal(h.messages.filter(x=>x.data.ok===true).length,2);assert.ok(h.messages.some(x=>x.data.error==='IDEMPOTENCY_CONFLICT'));assert.ok(h.messages.every(x=>x.target===origin));
});
test('cancel never spends; insufficient funds preserves error and emits no balance change',async()=>{
 const cancelled=host({confirm:false});cancelled.emit(cancelled.request('purchase',{productId:'bomb',operationId:randomUUID()}));await flush();assert.deepEqual(cancelled.calls.map(x=>x.name),['lpa_purchase_status','lpa_catalog']);assert.equal(cancelled.messages[0].data.error,'CANCELLED');
 const poor=host({rpc:async name=>name==='lpa_purchase_status'?{data:null}:name==='lpa_catalog'?{data:[{id:'bomb',title:'Bomb',price:10,priceVersion:3}]}:{error:{message:'insufficient_funds'}}});poor.emit(poor.request('purchase',{productId:'bomb',operationId:randomUUID()}));await flush();assert.equal(poor.messages[0].data.error,'INSUFFICIENT_FUNDS');assert.equal(poor.events.length,0);
});
test('missing database RPC reports unavailable, not fake balance or success',async()=>{
 const h=host({rpc:async()=>({error:{code:'PGRST202',message:'Could not find function'}})});h.emit(h.request());await flush();assert.equal(h.messages[0].data.ok,false);assert.equal(h.messages[0].data.error,'ECONOMY_UNAVAILABLE');assert.equal(h.messages[0].data.result,undefined);
});
test('account switch during purchase status request prevents confirmation and spending',async()=>{
 let resolve;const h=host({rpc:()=>new Promise(r=>resolve=r)});h.emit(h.request('purchase',{productId:'bomb',operationId:randomUUID()}));h.actor('actor-b');resolve({data:[{id:'bomb',title:'Bomb',price:10,priceVersion:3}]});await flush();assert.equal(h.confirms,0);assert.equal(h.calls.length,1);assert.equal(h.messages.length,0);
});
test('cached requests never cross accounts even if launch survives account change',async()=>{
 const pending=[];const h=host({rpc:()=>new Promise(r=>pending.push(r))}),r=h.request();h.emit(r);h.actor('actor-b');h.emit(r);
 assert.equal(h.calls.length,2,'new account must issue its own RPC instead of using old promise');
 pending[0]({data:{balance:900}});await flush();assert.equal(h.messages.length,0);
 pending[1]({data:{balance:20}});await flush();assert.equal(h.messages.length,1);assert.equal(h.messages[0].data.result.balance,20);
});
test('signed-out callers receive ACCOUNT_REQUIRED without RPC',async()=>{const h=host();h.actor(null);h.emit(h.request());await flush();assert.equal(h.calls.length,0);assert.equal(h.messages[0].data.error,'ACCOUNT_REQUIRED');});
test('A to B to A switch invalidates pending A response even when actor matches again',async()=>{
 let resolve;const h=host({rpc:()=>new Promise(r=>resolve=r)});h.emit(h.request());h.actor('actor-b');h.actor('actor-a');resolve({data:{balance:900}});await flush();assert.equal(h.messages.length,0);
});
test('retry recovers original receipt without active catalog item, confirmation or second spend',async()=>{
 const receipt={gameId:'new-game',productId:'bomb',balance:40,receiptId:randomUUID()};
 const h=host({rpc:async name=>name==='lpa_purchase_status'?{data:receipt}:{error:{message:'product_unavailable'}}});const operationId=randomUUID();h.emit(h.request('purchase',{productId:'bomb',operationId}));await flush();
 assert.deepEqual(h.calls.map(x=>x.name),['lpa_purchase_status']);assert.equal(h.calls[0].params.p_request_id,operationId);assert.deepEqual(Object.keys(h.calls[0].params),['p_request_id']);assert.equal(h.confirms,0);assert.equal(h.messages[0].data.result,receipt);
});
test('receipt for different game or product conflicts and never purchases',async()=>{
 for(const receipt of [{gameId:'other-game',productId:'bomb'},{gameId:'new-game',productId:'other'}]){
 const h=host({rpc:async()=>({data:receipt})});h.emit(h.request('purchase',{productId:'bomb',operationId:randomUUID()}));await flush();assert.equal(h.messages[0].data.error,'IDEMPOTENCY_CONFLICT');assert.equal(h.calls.length,1);assert.equal(h.confirms,0);
 }
});
test('account switch during catalog load suppresses confirmation and purchase',async()=>{
 let resolve;const h=host({rpc:async name=>name==='lpa_purchase_status'?{data:null}:new Promise(r=>resolve=r)});h.emit(h.request('purchase',{productId:'bomb',operationId:randomUUID()}));await flush();h.actor('actor-b');resolve({data:[{id:'bomb',title:'Bomb',price:10,priceVersion:3}]});await flush();assert.equal(h.confirms,0);assert.deepEqual(h.calls.map(x=>x.name),['lpa_purchase_status','lpa_catalog']);assert.equal(h.messages.length,0);
});
test('lost response keeps durable quote; reopened shell retries original version after price change',async()=>{
 const storage=new Map(),operationId=randomUUID();
 const first=host({storage,rpc:async name=>name==='lpa_purchase_status'?{data:null}:name==='lpa_catalog'?{data:[{id:'bomb',title:'Bomb',price:10,priceVersion:3}]}:{error:{message:'network lost'}}});
 first.emit(first.request('purchase',{productId:'bomb',operationId}));await flush();assert.equal(storage.size,1);assert.equal(JSON.parse([...storage.values()][0]).priceVersion,3);
 const next=host({storage,rpc:async name=>name==='lpa_purchase_status'?{data:null}:name==='lpa_catalog'?{data:[{id:'bomb',title:'Bomb',price:99,priceVersion:4}]}:{error:{message:'PRICE_CHANGED'}}});
 next.emit(next.request('purchase',{productId:'bomb',operationId}));await flush();assert.deepEqual(next.calls.map(x=>x.name),['lpa_purchase_status','lpa_purchase']);assert.equal(next.calls[1].params.p_price_version,3);assert.equal(next.confirms,0);assert.equal(next.messages[0].data.error,'PRICE_CHANGED');assert.equal(storage.size,1);
});
test('storage denied prevents spending and malformed or mismatched quote fails closed',async()=>{
 const denied=host({denyStorage:true});denied.emit(denied.request('purchase',{productId:'bomb',operationId:randomUUID()}));await flush();assert.equal(denied.calls.some(x=>x.name==='lpa_purchase'),false);assert.equal(denied.messages[0].data.error,'STORAGE_UNAVAILABLE');
 for(const raw of ['broken','null',JSON.stringify({actor:'actor-a',gameId:'new-game',productId:'other',operationId:'wrong',price:0,priceVersion:1})]){
 const operationId=randomUUID(),storage=new Map([['lpa:purchase-quote:v1:actor-a:new-game:'+operationId,raw]]),h=host({storage});h.emit(h.request('purchase',{productId:'bomb',operationId}));await flush();assert.equal(h.calls.length,0);assert.equal(h.messages[0].data.error,'INVALID_SAVED_QUOTE');
 }
});
test('saved quotes are actor scoped and recovered receipt must match saved version',async()=>{
 const operationId=randomUUID(),key='lpa:purchase-quote:v1:actor-a:new-game:'+operationId;
 const storage=new Map([[key,JSON.stringify({actor:'actor-a',gameId:'new-game',operationId,productId:'bomb',price:10,priceVersion:3})]]);
 const a=host({storage,rpc:async()=>({data:{gameId:'new-game',productId:'bomb',priceVersion:4}})});a.emit(a.request('purchase',{productId:'bomb',operationId}));await flush();assert.equal(a.messages[0].data.error,'IDEMPOTENCY_CONFLICT');assert.ok(storage.has(key));
 const b=host({storage});b.actor('actor-b');b.emit(b.request('purchase',{productId:'bomb',operationId}));await flush();assert.equal(b.confirms,1);assert.ok(b.calls.some(x=>x.name==='lpa_catalog'));assert.ok(storage.has(key));
});
test('settled memo is evicted after capacity and TTL; pending promises remain deduplicated',async()=>{
 const h=host();for(let i=0;i<150;i++){if(i%30===0)h.advance(60001);h.emit(h.request());await flush();}assert.equal(h.calls.length,150);assert.equal(h.messages.filter(x=>x.data.error==='TOO_MANY_REQUESTS').length,0);
 h.advance(60001);const r=h.request();h.emit(r);await flush();h.advance(300001);h.emit(r);await flush();assert.equal(h.calls.length,152);
 let resolve;const pending=host({rpc:()=>new Promise(r=>resolve=r)}),request=pending.request();pending.emit(request);pending.advance(300001);pending.emit(request);assert.equal(pending.calls.length,1);resolve({data:{balance:1}});await flush();assert.equal(pending.messages.length,2);
});
test('minute rate and pending limits remain bounded',async()=>{
 const h=host();for(let i=0;i<31;i++){h.emit(h.request());await flush();}assert.equal(h.calls.length,30);assert.equal(h.messages.at(-1).data.error,'TOO_MANY_REQUESTS');
 const p=host({rpc:()=>new Promise(()=>{})});for(let i=0;i<17;i++)p.emit(p.request());assert.equal(p.calls.length,16);assert.equal(p.messages.at(-1).data.error,'TOO_MANY_REQUESTS');
});
test('product identifiers match database dots and 64-character bound',async()=>{
 const h=host();h.emit(h.request('purchase',{productId:'a'.repeat(65),operationId:randomUUID()}));assert.equal(h.calls.length,0);
 h.emit(h.request('purchase',{productId:'pack.bomb-1',operationId:randomUUID()}));await flush();assert.equal(h.calls[0].name,'lpa_purchase_status');
});
