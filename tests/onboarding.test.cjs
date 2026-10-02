'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {validate,filesFor,plan,writePlan} = require('../tools/add-game.cjs');
const descriptor = (id='new-racer') => ({gameId:id,title:'New Racer',studio:'Liberman Games',description:'A new game',url:'https://libertypandaa.github.io/new-racer/',assets:{cover:`assets/games/${id}/cover.webp`,icon192:`assets/games/${id}/icon-192.png`,icon512:`assets/games/${id}/icon-512.png`,maskable512:`assets/games/${id}/maskable.png`}});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lpa-onboarding-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'docs/games'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs/game-registry.js'),'const games = /* LPA_GAMES_START */ {"existing":{"shell":"games/existing/"}} /* LPA_GAMES_END */;\n// preserve me');
  return root;
}
test('rejects unsafe IDs, assets, URL credentials and unreviewed hosts', () => {
  for (const gameId of ['../oops','a/b','CON','a%2fb','a..b']) assert.throws(()=>validate({...descriptor(),gameId}));
  for (const url of ['javascript:alert(1)','https://evil.test/game/','http://libertypandaa.github.io/game/','https://user@libertypandaa.github.io/game/','https://libertypandaa.github.io/a/../b/','https://libertypandaa.github.io/%2e%2e/b/']) assert.throws(()=>validate({...descriptor(),url}));
  assert.throws(()=>validate({...descriptor(),assets:{...descriptor().assets,icon192:'assets/games/new-racer/../../../icon.png'}}));
});
test('dry plan does not change registry or create a shell; write inserts entry once', t => {
  const root=fixture(t), registry=path.join(root,'docs/game-registry.js'), original=fs.readFileSync(registry,'utf8');
  const result=plan(descriptor(),root);
  assert.equal(fs.existsSync(result.target),false); assert.equal(fs.readFileSync(registry,'utf8'),original);
  for(const asset of Object.values(result.game.assets)){ const file=path.join(root,'docs',asset); fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'asset'); }
  writePlan(result,root);
  assert.ok(fs.existsSync(path.join(result.target,'install/index.html')));
  assert.match(fs.readFileSync(registry,'utf8'),/"new-racer"/);
  assert.match(fs.readFileSync(registry,'utf8'),/preserve me/);
  assert.throws(()=>plan(descriptor(),root),/Duplicate/);
});
test('preflight refuses missing assets, marker errors and existing shell without mutations', t => {
  const root=fixture(t), result=plan(descriptor(),root);
  assert.throws(()=>writePlan(result,root)); assert.equal(fs.existsSync(result.target),false);
  fs.mkdirSync(result.target);assert.throws(()=>plan(descriptor(),root),/already exists/);
  fs.writeFileSync(path.join(root,'docs/game-registry.js'),'const games = {};');
  assert.throws(()=>plan(descriptor('other-game'),root),/markers/);
});
test('distinct games resolve to distinct app IDs, scopes, icons and cache prefixes', () => {
  const a=validate(descriptor()), b=validate(descriptor('second-game'));
  const fa=filesFor(a),fb=filesFor(b), ma=JSON.parse(fa['manifest.webmanifest']),mb=JSON.parse(fb['manifest.webmanifest']);
  const base=id=>`https://libertypandaa.github.io/liberty-panda-arcade/games/${id}/manifest.webmanifest`;
  for(const key of ['id','scope','start_url']) assert.notEqual(new URL(ma[key],base(a.id)).href,new URL(mb[key],base(b.id)).href);
  assert.notEqual(ma.icons[0].src,mb.icons[0].src);
  assert.notEqual(fa['service-worker.js'],fb['service-worker.js']);
  for(const file of ['index.html','install/index.html']) {
    assert.match(fa[file],/account-gate.js/);assert.match(fa[file],/game-analytics-host.js/);assert.match(fa[file],/game-player.js/);
    assert.doesNotMatch(fa[file],/crystal-front|clutter-cup/);
    assert.ok(fa[file].indexOf('game-registry.js') < fa[file].indexOf('stats.js'));
    assert.ok(fa[file].indexOf('game-player.js') < fa[file].indexOf('game-analytics-host.js'));
  }
  assert.match(fa['shell.js'],/HubAccess.allowed\(gameId\)/);
  assert.doesNotMatch(fa['service-worker.js'],/skipWaiting|clients.claim|location.reload/);
  new vm.Script(fa['shell.js']);new vm.Script(fa['service-worker.js']);
  assert.equal(JSON.parse(fa['registry-entry.json']).analyticsEnabled,false);
});
test('escapes user-facing HTML and prevents descriptor script injection', () => {
  const files=filesFor(validate({...descriptor(),title:'<script>alert("hi")</script>'}));
  assert.match(files['index.html'],/&lt;script&gt;/);assert.doesNotMatch(files['index.html'],/<script>alert/);
});
test('different game ID cannot reuse existing shell slug and changed registry aborts writing',t=>{
 const root=fixture(t);assert.throws(()=>plan({...descriptor(),slug:'existing',assets:{cover:'assets/games/existing/cover.webp',icon192:'assets/games/existing/icon-192.png',icon512:'assets/games/existing/icon-512.png',maskable512:'assets/games/existing/mask.png'}},root),/Duplicate/);
 const result=plan(descriptor(),root);
 for(const asset of Object.values(result.game.assets)){const file=path.join(root,'docs',asset);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'asset');}
 fs.appendFileSync(path.join(root,'docs/game-registry.js'),'\n// concurrent edit');assert.throws(()=>writePlan(result,root),/changed since planning/);assert.equal(fs.existsSync(result.target),false);
});
test('failed registry rename rolls back only generated shell and preserves original registry',t=>{
 const root=fixture(t),result=plan(descriptor(),root);
 for(const asset of Object.values(result.game.assets)){const file=path.join(root,'docs',asset);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'asset');}
 const originalRename=fs.renameSync;
 try{fs.renameSync=()=>{throw Error('simulated registry write failure');};assert.throws(()=>writePlan(result,root),/simulated/);}finally{fs.renameSync=originalRename;}
 assert.equal(fs.existsSync(result.target),false);assert.equal(fs.readFileSync(result.registry.file,'utf8'),result.registry.source);assert.equal(fs.existsSync(result.registry.file+'.onboarding-lock'),false);
});
test('generated worker handles its own scope and exact shared URLs, never other games or unknown query versions',async()=>{
 const handlers={},requests=[],script=filesFor(validate(descriptor()))['service-worker.js'];
 vm.runInNewContext(script,{URL,self:{location:{href:'https://libertypandaa.github.io/liberty-panda-arcade/games/new-racer/service-worker.js'},addEventListener:(type,fn)=>handlers[type]=fn},fetch:async request=>{requests.push(request.url);return 'network';},caches:{},Response});
 const visit=url=>{let captured;handlers.fetch({request:{method:'GET',url},respondWith(promise){captured=promise;}});return captured;};
 assert.equal(await visit('https://libertypandaa.github.io/liberty-panda-arcade/economy-host.js'),'network');
 assert.equal(await visit('https://libertypandaa.github.io/liberty-panda-arcade/games/new-racer/?launch=test'),'network');
 assert.equal(visit('https://libertypandaa.github.io/liberty-panda-arcade/economy-host.js?v=unknown'),undefined);
 assert.equal(visit('https://libertypandaa.github.io/liberty-panda-arcade/games/other/'),undefined);
 assert.equal(visit('https://evil.test/liberty-panda-arcade/economy-host.js'),undefined);assert.equal(requests.length,2);
});
