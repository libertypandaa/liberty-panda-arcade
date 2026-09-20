const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('docs/auth.js', 'utf8');

function setup() {
  const nodes = new Map();
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { style: {}, value: '', hidden: false,
      addEventListener(type, fn) { this[type] = fn; },
      querySelector() { return node('save'); } });
    return nodes.get(key);
  };
  const timers = [];
  let listener, resolveRead, submitted;
  const client = {
    auth: {
      onAuthStateChange(fn) { listener = fn; },
      async signInWithOAuth() { return { error: new Error('Disabled') }; },
      async signOut() { return { error: new Error('Offline') }; },
    },
    from() { return {
      select() { return { eq() { return { maybeSingle() {
        return new Promise(resolve => { resolveRead = resolve; });
      } }; } }; },
      upsert(value) { submitted = value; return { select() { return {
        async single() { return { data: { display_name: value.display_name } }; },
      }; } }; },
    }; },
  };
  vm.runInNewContext(source, {
    window: { LIBERTY_PANDA_AUTH_CONFIG: { supabaseUrl: 'test', supabaseAnonKey: 'public' },
      supabase: { createClient: () => client }, location: { origin: 'https://hub.test', pathname: '/' } },
    document: { querySelector: node, querySelectorAll: key => [node(key)] },
    setTimeout: fn => timers.push(fn),
  });
  return { node, timers, event: user => listener('SIGNED_IN', { user }),
    resolve: value => resolveRead(value), submitted: () => submitted };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const user = { id: 'player-1', email: 'player@example.com', user_metadata: { name: 'Player' } };

test('loads a profile and saves a nickname for the current user', async () => {
  const s = setup();
  s.event(user); s.timers.shift()();
  s.resolve({ data: { display_name: 'Saved name' } }); await flush();
  assert.equal(s.node('[data-profile-name]').value, 'Saved name');
  s.node('[data-profile-name]').value = 'New name';
  await s.node('[data-profile-form]').submit({ preventDefault() {} });
  assert.equal(s.submitted().id, user.id);
  assert.equal(s.node('[data-auth-name]').textContent, 'New name');
});

test('ignores a profile response arriving after sign-out', async () => {
  const s = setup();
  s.event(user); s.timers.shift()(); s.event(null);
  s.resolve({ data: { display_name: 'Stale' } }); await flush();
  assert.equal(s.node('[data-auth-name]').textContent, 'Guest player');
  assert.equal(s.node('[data-profile-form]').hidden, true);
});

test('failed sign-out keeps the account and failed OAuth restores button', async () => {
  const s = setup(); s.event(user);
  await s.node("[data-auth-action='sign-out']").click();
  assert.equal(s.node('[data-auth-name]').textContent, 'Player');
  assert.match(s.node('[data-auth-status]').textContent, /Could not sign out/);
  await s.node("[data-auth-action='sign-in']").click();
  assert.equal(s.node("[data-auth-action='sign-in']").disabled, false);
  assert.match(s.node('[data-auth-status]').textContent, /unavailable/);
});
