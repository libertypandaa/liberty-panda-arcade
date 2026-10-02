const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const origin='https://libertypandaa.github.io';
function player(allowed=true){
 let currentFrame;const events=[],classes=new Set(),listeners={};
 const classList={add:x=>classes.add(x),remove:x=>classes.delete(x)};
 function frame(){const handlers={};return {dataset:{},contentWindow:{location:{href:'about:blank'},messages:[],postMessage(data,target){this.messages.push({data,target});}},addEventListener(n,fn){handlers[n]=fn;},load(href){this.contentWindow.location.href=href||this.src;handlers.load?.();},removeAttribute(key){delete this[key];},cloneNode(){return frame();},replaceWith(other){currentFrame=other;}};}
 currentFrame=frame();const overlay={hidden:true,classList,setAttribute(){},requestFullscreen:async()=>{throw Error('Fullscreen denied');}};
 const window={HubAccess:{allowed:typeof allowed==='function'?allowed:async()=>allowed},HubGames:{get:id=>['clutter-cup','crystal-front-demo'].includes(id)?{id,title:id,url:origin+'/'+id+'/',playerExit:id==='clutter-cup'}:null},dispatchEvent:e=>events.push(e.type),addEventListener:(n,fn)=>listeners[n]=fn};
 const document={activeElement:{focus(){}},body:{classList},querySelector:q=>q==='#game-frame'?currentFrame:q==='#game-overlay'?overlay:null};
 vm.runInNewContext(fs.readFileSync('docs/game-player.js','utf8'),{window,document,URL,crypto:{randomUUID},performance,CustomEvent:class{constructor(type){this.type=type;}}});
 return {api:window.HubPlayer,overlay,events,classes,message(data,options={}){listeners.message({source:options.source||currentFrame.contentWindow,origin:options.origin||origin,data});}};
}
test('player works without analytics and preserves viewport fallback when fullscreen fails',async()=>{
 const p=player();assert.equal(await p.api.open('clutter-cup'),true);assert.equal(p.overlay.hidden,false);assert.ok(p.classes.has('game-open'));assert.ok(p.api.current().url.includes('launch='));
 await p.api.close();assert.equal(p.overlay.hidden,true);assert.equal(p.api.current(),null);assert.equal(p.classes.size,0);
});
test('each launch replaces browsing context and unknown games cannot hijack it',async()=>{
 const p=player();await p.api.open('crystal-front-demo');const first=p.api.current();await p.api.open('clutter-cup');const second=p.api.current();assert.notEqual(first.frame,second.frame);assert.notEqual(first.id,second.id);
 assert.equal(await p.api.open('unknown'),false);assert.equal(p.api.current(),second);assert.ok(p.events.includes('hub:playerclosing'));
});
test('signed-out player cannot create launch or expose iframe',async()=>{const p=player(false);assert.equal(await p.api.open('clutter-cup'),false);assert.equal(p.api.current(),null);assert.equal(p.overlay.hidden,true);assert.deepEqual(p.events,[]);});
test('Exit accepts only loaded document, source, origin, launch and protocol',async()=>{
 const p=player();await p.api.open('clutter-cup');const current=p.api.current();
 const close={type:'lpa:player:close',protocol:1,launchId:current.id,requestId:randomUUID()};
 p.message(close);assert.equal(p.api.current(),current);
 current.frame.load();assert.equal(p.api.trusted(),true);
 p.message(close,{source:{}});p.message(close,{origin:'https://evil.example'});p.message({...close,launchId:randomUUID()});p.message({...close,protocol:2});p.message({...close,requestId:'bad'});assert.equal(p.api.current(),current);
 p.message(close);assert.equal(p.api.current(),null);p.message(close);assert.equal(p.events.filter(x=>x==='hub:playerclosing').length,1);
});
test('old iframe and redirected same-origin document cannot control new launch',async()=>{
 const p=player();await p.api.open('clutter-cup');const old=p.api.current();old.frame.load();await p.api.open('clutter-cup');const current=p.api.current();current.frame.load();
 p.message({type:'lpa:player:close',protocol:1,launchId:current.id,requestId:randomUUID()},{source:old.frame.contentWindow});assert.equal(p.api.current(),current);
 current.frame.contentWindow.location.href=origin+'/different/?launch='+current.id;
 p.message({type:'lpa:player:close',protocol:1,launchId:current.id,requestId:randomUUID()});assert.equal(p.api.current(),current);
});
test('toolbar hidden only after capability handshake of approved game',async()=>{
 const p=player();for(const game of ['crystal-front-demo','clutter-cup']){await p.api.open(game);const c=p.api.current();c.frame.load();p.message({type:'lpa:player:hello',protocol:1,launchId:c.id,capabilities:{close:true}});assert.equal(p.classes.has('game-has-exit'),game==='clutter-cup');assert.equal(c.frame.contentWindow.messages[0].target,origin);}
});
test('closing while account check is pending prevents delayed launch',async()=>{
 let resolve;const p=player(()=>new Promise(r=>resolve=r));const result=p.api.open('clutter-cup');await p.api.close();resolve(true);assert.equal(await result,false);assert.equal(p.api.current(),null);
});
test('last requested game wins concurrent account checks',async()=>{
 const pending=[];const p=player(()=>new Promise(r=>pending.push(r)));const first=p.api.open('crystal-front-demo'),second=p.api.open('clutter-cup');pending[1](true);assert.equal(await second,true);pending[0](true);assert.equal(await first,false);assert.equal(p.api.current().game.id,'clutter-cup');
});
