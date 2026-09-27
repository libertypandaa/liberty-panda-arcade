const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function player(){
 let currentFrame;const events=[],classes=new Set();
 function frame(){return {dataset:{},removeAttribute(key){delete this[key];},cloneNode(){return frame();},replaceWith(other){currentFrame=other;}};}
 currentFrame=frame();const overlay={hidden:true,setAttribute(){},requestFullscreen:async()=>{throw Error('Fullscreen denied');}};
 const window={HubGames:{get:id=>['clutter-cup','crystal-front-demo'].includes(id)?{id,title:id,url:'https://libertypandaa.github.io/'+id+'/'}:null},dispatchEvent:e=>events.push(e.type),addEventListener(){}};
 const document={activeElement:{focus(){}},body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},querySelector:q=>q==='#game-frame'?currentFrame:q==='#game-overlay'?overlay:null};
 vm.runInNewContext(fs.readFileSync('docs/game-player.js','utf8'),{window,document,URL,crypto:require('node:crypto'),performance,CustomEvent:class{constructor(type){this.type=type;}}});
 return {api:window.HubPlayer,overlay,events,classes};
}
test('player works without analytics and preserves the viewport fallback when fullscreen fails',async()=>{
 const p=player();assert.equal(await p.api.open('clutter-cup'),true);assert.equal(p.overlay.hidden,false);assert.ok(p.classes.has('game-open'));assert.ok(p.api.current().url.includes('launch='));
 await p.api.close();assert.equal(p.overlay.hidden,true);assert.equal(p.api.current(),null);assert.equal(p.classes.size,0);
});
test('each launch replaces the browsing context and unknown games cannot hijack it',async()=>{
 const p=player();await p.api.open('crystal-front-demo');const first=p.api.current();await p.api.open('clutter-cup');const second=p.api.current();assert.notEqual(first.frame,second.frame);assert.notEqual(first.id,second.id);
 assert.equal(await p.api.open('unknown'),false);assert.equal(p.api.current(),second);assert.ok(p.events.includes('hub:playerclosing'));
});
