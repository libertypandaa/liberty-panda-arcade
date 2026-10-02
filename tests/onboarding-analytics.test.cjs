const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(enabled){
 const calls=[],listeners={},timers=[],messages=[];let auth,current=null;
 const game={id:'future-game',title:'Future',url:'https://libertypandaa.github.io/future-game/',analyticsEnabled:enabled};
 const client={auth:{onAuthStateChange(fn){auth=fn;}},async rpc(name,args){calls.push({name,args});return {data:{visits:1,launches:0,history:[]}};}};
 const window={LIBERTY_PANDA_AUTH_CONFIG:{},supabase:{createClient:()=>client},HubGames:{get:id=>id===game.id?game:null,selected:()=>game},HubPlayer:{current:()=>current},addEventListener(name,fn){(listeners[name]||=[]).push(fn);}};
 const document={hidden:false,currentScript:{src:'https://libertypandaa.github.io/liberty-panda-arcade/stats.js'},body:{append(){}},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement(){return {style:{},setAttribute(){},append(){},addEventListener(){}};}};
 const context={window,document,URL,crypto:{randomUUID},performance:{now:()=>1000},setTimeout:fn=>timers.push(fn),localStorage:{getItem:key=>key==='lpa:analytics-consent-v2'?'yes':null,setItem(){}}};
 vm.runInNewContext(fs.readFileSync('docs/stats.js','utf8'),context);
 vm.runInNewContext(fs.readFileSync('docs/game-analytics-host.js','utf8'),context);
 const emit=(name,event)=>{for(const fn of listeners[name]||[])fn(event);};
 return {calls,game,stats:window.HubStats,async login(){auth('INITIAL_SESSION',{user:{id:'account'}});timers.splice(0).forEach(fn=>fn());await flush();calls.length=0;},open(){const id=randomUUID(),callbacks={};const url=game.url+'?launch='+id;const frame={dataset:{gameId:game.id},addEventListener:(name,fn)=>callbacks[name]=fn,contentWindow:{location:{href:url},postMessage:data=>messages.push(data)}};current={id,game,frame,url,started:1000};emit('hub:playerchange');callbacks.load();},messages};
}
test('new registered game with analytics disabled records neither launch nor session',async()=>{
 const r=runtime(false);await r.login();r.open();r.stats.track('install_click',r.game.id);r.stats.gameEvent(r.game.id,randomUUID(),'session_start',{});await flush();
 assert.equal(r.calls.filter(c=>c.name.startsWith('record_')).length,0);
 assert.equal(r.messages.at(-1).enabled,false);
});
test('enabled new game records own ID without Crystal Front fallback',async()=>{
 const r=runtime(true);await r.login();r.open();await flush();const records=r.calls.filter(c=>c.name.startsWith('record_'));
 assert.ok(records.some(c=>c.args.p_kind==='launch'));assert.ok(records.some(c=>c.args.p_name==='session_start'));assert.ok(records.every(c=>c.args.p_game==='future-game'));
});
test('disable before queued RPC executes cancels launch and gameplay submission',async()=>{
 const r=runtime(true);await r.login();r.stats.track('launch',r.game.id);r.stats.gameEvent(r.game.id,randomUUID(),'session_start',{});r.game.analyticsEnabled=false;await flush();assert.equal(r.calls.filter(c=>c.name.startsWith('record_')).length,0);
});
