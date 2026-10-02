#!/usr/bin/env node
'use strict';
// Local scaffolding only. Neither database registration nor publication happens here.
const fs = require('node:fs');
const path = require('node:path');
const policy = require('./game-hosts.json');
const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
function slug(value, name) {
  if (typeof value !== 'string' || value.length > 64 || !slugPattern.test(value)) throw Error(`Invalid ${name}`);
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) throw Error(`Reserved ${name}`);
  return value;
}
function label(value, name, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw Error(`Invalid ${name}`);
  return value.trim();
}
function validate(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw Error('Descriptor must be an object');
  const keys = ['gameId','slug','title','studio','description','url','scoreUnit','orientation','assets'];
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw Error(`Unknown field: ${key}`);
  const id = slug(input.gameId, 'gameId'), shellSlug = slug(input.slug || id, 'slug');
  const title = label(input.title, 'title'), studio = label(input.studio, 'studio');
  const description = label(input.description, 'description', 600);
  let url;
  try { url = new URL(input.url); } catch { throw Error('Invalid launch URL'); }
  if (typeof input.url !== 'string' || /[\\\s]/.test(input.url) || /%2e|%2f|%5c/i.test(input.url) || input.url.split('/').includes('..') ||
      url.protocol !== 'https:' || !policy.launchHosts.includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw Error('Launch URL must be a clean HTTPS directory URL on a reviewed host');
  }
  const scoreUnit = input.scoreUnit || 'points';
  if (!['points','milliseconds','none'].includes(scoreUnit)) throw Error('Invalid scoreUnit');
  const orientation = input.orientation || 'any';
  if (!['any','landscape','portrait'].includes(orientation)) throw Error('Invalid orientation');
  const assets = {};
  if (!input.assets || typeof input.assets !== 'object') throw Error('Missing assets');
  for (const key of Object.keys(input.assets)) if (!['cover','icon192','icon512','maskable512'].includes(key)) throw Error(`Unknown asset: ${key}`);
  for (const key of ['cover','icon192','icon512','maskable512']) {
    const value = input.assets[key];
    if (typeof value !== 'string' || !value.startsWith(`assets/games/${shellSlug}/`) || !/^[a-zA-Z0-9_./-]+\.(png|jpg|webp)$/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..') || (key !== 'cover' && !value.endsWith('.png'))) throw Error(`Invalid local asset ${key}`);
    assets[key] = value;
  }
  if (new Set(Object.values(assets)).size !== 4) throw Error('Use distinct cover and icon assets');
  return { id, slug: shellSlug, title, studio, description, url: url.href, scoreUnit, orientation, assets };
}
const html = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(game, install) {
  const base = install ? '../../../' : '../../';
  const own = install ? '../' : './';
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f172a"><title>${html(game.title)} — Liberty Panda Arcade</title>
<link rel="manifest" href="${own}manifest.webmanifest"><link rel="icon" href="${base}${game.assets.icon192}"><link rel="apple-touch-icon" href="${base}${game.assets.icon192}">
<link rel="stylesheet" href="${base}game-player.css">
<style>body{margin:0;background:#f7fbff;color:#0f172a;font:16px system-ui}main{max-width:780px;margin:auto;padding:24px}img{max-width:100%;border-radius:12px}button,a{min-height:44px;display:inline-flex;align-items:center;margin:6px;padding:8px 16px}button{cursor:pointer}p{line-height:1.6}.game-overlay{position:fixed;inset:0;background:#020617;z-index:50}.game-overlay[hidden]{display:none}.game-overlay iframe{width:100%;height:100%;border:0}body.game-open{overflow:hidden}</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" defer></script>
${['game-registry.js','auth-config.js','auth.js','stats.js','account-gate.js','game-player.js','game-analytics-host.js','economy-host.js','update-guard.js'].map(file => `<script src="${base}${file}" defer></script>`).join('\n')}
<script src="${own}shell.js" defer></script></head><body>
<main><a href="${base}">Liberty Panda Arcade</a><h1>${install ? 'Установить ' : ''}${html(game.title)}</h1><p>${html(game.studio)}</p>
<img src="${base}${game.assets.cover}" alt="${html(game.title)}"><p>${html(game.description)}</p>
<button class="play-game" type="button">Играть</button>${install ? '<button id="install-button" type="button">Добавить на телефон</button>' : '<a href="./install/">Добавить на телефон</a>'}
<p id="status" role="status">Для запуска нужен аккаунт. Установка оболочки не гарантирует офлайн-работу игры.</p>
${install ? '<p>Если кнопка установки недоступна: Android Chrome — меню → Установить приложение; iPhone Safari — Поделиться → На экран «Домой».</p>' : ''}</main>
<section id="game-overlay" class="game-overlay" hidden aria-label="Игровой экран"><div class="game-toolbar"><button id="fullscreen-game" type="button">Fullscreen</button><button id="close-game" type="button">Close</button></div><iframe id="game-frame" title="${html(game.title)}" allow="fullscreen; autoplay; gamepad"></iframe></section>
</body></html>\n`;
}
function filesFor(game) {
  const entry = { id: game.id, title: game.title, studio: game.studio, description: game.description, url: game.url, shell: `games/${game.slug}/`, icon: game.assets.icon192, cover: game.assets.cover, scoreUnit: game.scoreUnit, analyticsEnabled: false };
  const manifest = { name: game.title, short_name: game.title.slice(0, 24), description: game.description, id: './', scope: './', start_url: './?launch=phone-shortcut', display: 'standalone', orientation: game.orientation, background_color: '#f7fbff', theme_color: '#0f172a', icons: [['icon192','192x192','any'],['icon512','512x512','any'],['maskable512','512x512','maskable']].map(([key,sizes,purpose]) => ({src: '../../'+game.assets[key],sizes,type:'image/png',purpose})) };
  return {
    'index.html': page(game, false), 'install/index.html': page(game, true),
    'manifest.webmanifest': JSON.stringify(manifest, null, 2)+'\n',
    'registry-entry.json': JSON.stringify(entry, null, 2)+'\n',
    'shell.js': `'use strict';\n(() => {
  const gameId = ${JSON.stringify(game.id)};
  const root = new URL('./', document.currentScript.src);
  const status = document.querySelector('#status');
  let prompt = null;
  document.querySelectorAll('.play-game').forEach(button => button.addEventListener('click', () => window.HubPlayer.open(gameId)));
  document.querySelector('#close-game').addEventListener('click', () => window.HubPlayer.close());
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; });
  document.querySelector('#install-button')?.addEventListener('click', async () => {
    if (!window.HubAccess || !await window.HubAccess.allowed(gameId)) return;
    if (!prompt) { status.textContent = 'Для установки используй меню браузера.'; return; }
    const current = prompt; prompt = null;
    await current.prompt();
    const choice = await current.userChoice;
    status.textContent = choice.outcome === 'accepted' ? 'Запрос установки отправлен браузеру.' : 'Установка отменена.';
  });
  window.addEventListener('appinstalled', () => { status.textContent = 'Браузер подтвердил установку.'; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('service-worker.js', root), {scope: root.href}).catch(() => { status.textContent = 'Не удалось подготовить оболочку для установки. Попробуй позже.'; });
  if (new URLSearchParams(location.search).has('launch')) window.HubPlayer.open(gameId);
})();\n`,
    'service-worker.js': `// Shell cache only; no automatic activation/reload during a game.\nconst PREFIX = ${JSON.stringify('lpa-'+game.id+'-shell-')};
const CACHE = PREFIX + '1';
const SHARED = ['game-registry.js','auth-config.js','auth.js','stats.js','account-gate.js','game-player.js','game-player.css','game-analytics-host.js','economy-host.js','update-guard.js'].map(file => new URL('../../'+file, self.location.href).href);
const ASSETS = ['./', './install/', './shell.js', './manifest.webmanifest', ...SHARED];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), scope = new URL('./', self.location.href);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || (!url.pathname.startsWith(scope.pathname) && !SHARED.includes(url.href))) return;
  event.respondWith(fetch(event.request).catch(async () => await (await caches.open(CACHE)).match(event.request) || Response.error()));
});\n`
  };
}
function existingGames(root) {
  const file = path.join(root, 'docs/game-registry.js');
  if (!fs.existsSync(file)) throw Error('Project must contain docs/game-registry.js');
  const source = fs.readFileSync(file,'utf8');
  const startMarker = '/* LPA_GAMES_START */', endMarker = '/* LPA_GAMES_END */';
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker);
  if (start < 0 || end < start || source.indexOf(startMarker,start+1) >= 0 || source.indexOf(endMarker,end+1) >= 0) throw Error('Registry markers missing or ambiguous');
  const offset = start + startMarker.length;
  const games = JSON.parse(source.slice(offset,end));
  if (!games || Array.isArray(games) || typeof games !== 'object') throw Error('Invalid registry object');
  return {file, source, games, offset, end};
}
function plan(input, root) {
  const game = validate(input), registry = existingGames(root);
  if (Object.hasOwn(registry.games,game.id) || Object.values(registry.games).some(value => value.shell === `games/${game.slug}/`)) throw Error('Duplicate game ID or shell');
  const target = path.join(root,'docs','games',game.slug);
  if (fs.existsSync(target)) throw Error('Game directory already exists; never overwritten');
  const files = filesFor(game);
  registry.games[game.id] = JSON.parse(files['registry-entry.json']);
  const registryNext = registry.source.slice(0,registry.offset)+'\n'+JSON.stringify(registry.games,null,2)+'\n'+registry.source.slice(registry.end);
  return {game, target, files, registry, registryNext};
}
function writePlan(result, root) {
  const docs = fs.realpathSync(path.join(root,'docs'));
  const parent = fs.realpathSync(path.join(root,'docs','games'));
  if (parent !== path.join(docs,'games')) throw Error('Symlinked games directory is not allowed');
  for (const asset of Object.values(result.game.assets)) {
    const actual = fs.realpathSync(path.join(docs, asset));
    if (!actual.startsWith(docs+path.sep) || !fs.statSync(actual).isFile()) throw Error('Assets must be regular files inside docs');
  }
  if (fs.readFileSync(result.registry.file,'utf8') !== result.registry.source) throw Error('Registry changed since planning');
  // A lock serializes this CLI; do not run simultaneous manual registry edits.
  const lock = result.registry.file + '.onboarding-lock';
  const lockFd = fs.openSync(lock,'wx');
  const stagedRegistry = lock + '.' + require('node:crypto').randomUUID() + '.json';
  let created = false, registryWritten = false;
  try {
    if (fs.readFileSync(result.registry.file,'utf8') !== result.registry.source) throw Error('Registry changed since planning');
    fs.mkdirSync(result.target); created = true;
    fs.mkdirSync(path.join(result.target,'install'));
    for (const [name, body] of Object.entries(result.files)) fs.writeFileSync(path.join(result.target,name),body,{flag:'wx'});
    if (fs.readFileSync(result.registry.file,'utf8') !== result.registry.source) throw Error('Registry changed while generating');
    fs.writeFileSync(stagedRegistry,result.registryNext,{flag:'wx'});
    fs.renameSync(stagedRegistry,result.registry.file); registryWritten = true;
  } catch (error) {
    if (registryWritten && fs.readFileSync(result.registry.file,'utf8') === result.registryNext) fs.writeFileSync(result.registry.file,result.registry.source);
    if (created) {
      // Only remove the files we generated, and only if nobody changed them.
      for (const [name,body] of Object.entries(result.files)) {
        const file = path.join(result.target,name);
        if (fs.existsSync(file) && fs.readFileSync(file,'utf8') === body) fs.unlinkSync(file);
      }
      for (const dir of [path.join(result.target,'install'),result.target]) if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }
    throw error;
  } finally { if (fs.existsSync(stagedRegistry)) fs.unlinkSync(stagedRegistry); fs.closeSync(lockFd); fs.unlinkSync(lock); }
}
function main(args) {
  const write = args.includes('--write');
  const positional = args.filter(arg => arg !== '--write');
  if (positional.length !== 1 || positional[0].startsWith('-')) throw Error('Usage: node tools/add-game.cjs descriptor.json [--write]');
  const root = path.resolve(__dirname,'..');
  const result = plan(JSON.parse(fs.readFileSync(path.resolve(positional[0]),'utf8')),root);
  if (write) writePlan(result,root);
  console.log(`${write ? 'Created locally' : 'DRY RUN; no files changed'}: ${result.target}`);
  console.log(Object.keys(result.files).join('\n'));
  console.log(`${write ? 'Registry entry added' : 'Registry insertion proposal'} (database activation remains separate):\n`+result.files['registry-entry.json']);
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = {validate, filesFor, plan, writePlan};
