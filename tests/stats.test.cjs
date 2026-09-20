const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync('docs/stats.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(storage = new Map(), withOverlay = false) {
  const calls = [], nodes = [], listeners = {};
  let auth, observe;
  const overlay = { hidden: true }, frame = { contentWindow: {}, addEventListener() {} };
  const checkbox = { addEventListener() {}, checked: false };
  const client = {
    auth: { onAuthStateChange(fn) { auth = fn; } },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { visits: 1, launches: 0, history: [] } };
    },
  };
  const window = {
    LIBERTY_PANDA_AUTH_CONFIG: {}, supabase: { createClient: () => client },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  vm.runInNewContext(source, {
    window, URL, crypto: { randomUUID }, setTimeout,
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} },
    location: { pathname: '/', href: 'https://hub.test/' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    document: {
      currentScript: { src: 'https://hub.test/stats.js' },
      body: { append() {} }, querySelector: selector => withOverlay ? ({ '#game-overlay': overlay, '#game-frame': frame }[selector] || null) : null,
      querySelectorAll: s => s === '[data-stats-consent]' ? [checkbox] : [],
      addEventListener() {},
      createElement(tag) {
        const node = { tag, style: {}, setAttribute() {}, append() {},
          addEventListener(type, fn) { this[type] = fn; } };
        nodes.push(node); return node;
      },
    },
  });
  return { calls, storage, window, checkbox, listeners, frame,
    open: () => { overlay.hidden = false; observe(); },
    auth: id => auth('INITIAL_SESSION', id ? { user: { id } } : null),
    allow: () => nodes.find(n => n.tag === 'button').click(),
  };
}

test('no guest identifier or events before consent', async () => {
  const s = setup(); s.auth(null); await new Promise(r => setTimeout(r, 10));
  s.window.HubStats.track('launch'); await flush();
  assert.equal(s.calls.length, 0);
  assert.equal(s.storage.has('lpa:guest-secret'), false);
});

test('old limited consent does not authorize expanded gameplay collection', async () => {
  const s = setup(new Map([['lpa:analytics-consent','yes']]));
  s.auth(null); await new Promise(r => setTimeout(r, 10));
  s.window.HubStats.gameEvent(randomUUID(),'session_start',{}); await flush();
  assert.equal(s.calls.length,0);
  assert.equal(s.window.HubStats.enabled(),false);
});

test('consented guest identity persists across visits', async () => {
  const s = setup(); s.auth(null); s.allow(); await flush();
  const first = s.calls.find(c => c.name === 'record_hub_event');
  assert.equal(first.args.p_kind, 'visit');
  const next = setup(s.storage); next.auth(null);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(next.calls.find(c => c.name === 'record_hub_event').args.p_guest, first.args.p_guest);
});

test('opt-out from another tab stops events and updates checkbox', async () => {
  const s = setup(); s.auth(null); s.allow(); await flush();
  s.listeners.storage({ key: 'lpa:analytics-consent-v2', newValue: 'no' });
  const count = s.calls.length;
  s.window.HubStats.track('launch'); await flush();
  assert.equal(s.calls.length, count);
  assert.equal(s.checkbox.checked, false);
});

test('authenticated events never submit the guest identity', async () => {
  const s = setup(new Map([['lpa:analytics-consent-v2','yes']]));
  s.auth('account'); await new Promise(r => setTimeout(r, 10));
  assert.equal(s.calls.find(c => c.name === 'record_hub_event').args.p_guest, null);
  assert.equal(s.storage.has('lpa:guest-secret'), false);
});

test('early launch is counted once when auth initialization finishes', async () => {
  const s = setup(new Map([['lpa:analytics-consent-v2','yes']]), true);
  s.open(); s.auth(null); await new Promise(r => setTimeout(r, 10));
  s.open(); await flush();
  assert.equal(s.calls.filter(c => c.args?.p_kind === 'launch').length, 1);
});

test('game readiness requires the active iframe source and trusted origin', async () => {
  const s = setup(new Map([['lpa:analytics-consent-v2','yes']]), true);
  s.auth(null); s.open(); await new Promise(r => setTimeout(r, 10));
  const event = { data: { type: 'game_ready' }, source: s.frame.contentWindow, origin: 'https://libertypandaa.github.io' };
  s.listeners.message({ ...event, origin: 'https://other.test' });
  s.listeners.message({ ...event, source: {} }); await flush();
  assert.equal(s.calls.filter(c => c.args?.p_kind === 'game_ready').length, 0);
  s.listeners.message(event); s.listeners.message(event); await flush();
  assert.equal(s.calls.filter(c => c.args?.p_kind === 'game_ready').length, 1);
});
