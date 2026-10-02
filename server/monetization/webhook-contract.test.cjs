'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { verifyXsolla, verifyPaddle, canonicalEvent, createWebhookIngress } = require('./webhook-contract.cjs');
const key = 'test-only-not-a-real-provider-secret';
const body = Buffer.from('{ "id": "payment-1", "label": "שלום" }');
const xsolla = (b = body) => `Signature ${createHash('sha1').update(b).update(key).digest('hex')}`;
const paddle = (ts = 1000, b = body) => `ts=${ts};h1=${createHmac('sha256', key).update(`${ts}:`).update(b).digest('hex')}`;
const event = { kind: 'payment.captured', eventId: 'event-1', sourceId: 'payment-1', referenceId: 'order-1', amountMinor: 500, currency: 'ILS' };
function setup(overrides = {}) {
  const records = [];
  const ingress = createWebhookIngress({ provider: 'xsolla', project: 'project-1', environment: 'sandbox',
    verify: (b, h) => verifyXsolla(b, h, key), normalize: () => event,
    inbox: { putVerified: async (record) => { records.push(record); return { status: 'stored' }; } }, ...overrides });
  return { ingress, records };
}

test('Xsolla authenticates exact bytes; modified and reserialized JSON fail', () => {
  assert.equal(verifyXsolla(body, xsolla(), key), true);
  assert.equal(verifyXsolla(Buffer.from(JSON.stringify(JSON.parse(body))), xsolla(), key), false);
  assert.equal(verifyXsolla(body, xsolla(), 'different'), false);
  assert.equal(verifyXsolla(body, xsolla().slice(0, -1), key), false);
  assert.equal(verifyXsolla(body, undefined, key), false);
});
test('Paddle verifies rotation signatures and rejects tampering', () => {
  assert.equal(verifyPaddle(body, `${paddle()};h1=${'0'.repeat(64)}`, key, 1000), true);
  assert.equal(verifyPaddle(Buffer.from('{}'), paddle(), key, 1000), false);
  assert.equal(verifyPaddle(body, paddle(), 'wrong', 1000), false);
});
test('Paddle rejects stale/future/ambiguous headers', () => {
  assert.equal(verifyPaddle(body, paddle(), key, 1006), false);
  assert.equal(verifyPaddle(body, paddle(1006), key, 1000), false);
  assert.equal(verifyPaddle(body, `${paddle()};ts=1000`, key, 1000), false);
  assert.equal(verifyPaddle(body, paddle().replace('ts=1000', 'ts=1abc'), key, 1000), false);
  assert.equal(verifyPaddle(body, paddle(), key, 1005), true);
});
test('raw body and missing secrets fail closed', () => {
  assert.throws(() => verifyXsolla({}, xsolla(), key), { code: 'invalid_raw_body' });
  assert.throws(() => verifyPaddle(body, paddle(), ''), { code: 'missing_secret' });
  assert.throws(() => verifyXsolla(Buffer.alloc(262145), xsolla(), key), { code: 'invalid_raw_body' });
});
test('canonical events cannot carry client account, units or unsafe money', () => {
  for (const change of [{ accountId: 'attacker' }, { units: 100000 }, { amountMinor: 1.5 }, { amountMinor: -1 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'ils' }, { kind: 'ad_completed' }])
    assert.throws(() => canonicalEvent({ ...event, ...change }));
  assert.deepEqual(canonicalEvent({ kind: 'reward.verified', eventId: 'e1', sourceId: 'tid1', referenceId: 'attempt1' }),
    { kind: 'reward.verified', eventId: 'e1', sourceId: 'tid1', referenceId: 'attempt1' });
});
test('ingress persists normalized facts with server namespace; never grants', async () => {
  const { ingress, records } = setup();
  assert.deepEqual(await ingress({ rawBody: body, signatureHeader: xsolla() }), { status: 'stored', eventId: 'event-1' });
  assert.equal(records[0].environment, 'sandbox');
  assert.equal(records[0].event.referenceId, 'order-1');
  assert.equal(records[0].payloadHash, createHash('sha256').update(body).digest('hex'));
  assert.equal('rawBody' in records[0], false);
});
test('unauthenticated callbacks never normalize or write', async () => {
  const { ingress, records } = setup({ normalize: () => { throw new Error('must not run'); } });
  await assert.rejects(ingress({ rawBody: body, signatureHeader: 'payment_success' }), { code: 'invalid_signature' });
  assert.equal(records.length, 0);
});
test('invalid signed JSON and UTF8 never enter inbox', async () => {
  const { ingress, records } = setup();
  for (const b of [Buffer.from('{'), Buffer.from([0xff])])
    await assert.rejects(ingress({ rawBody: b, signatureHeader: xsolla(b) }), { code: 'invalid_json' });
  assert.equal(records.length, 0);
});
test('durable failure propagates; there is no early success ACK', async () => {
  const { ingress } = setup({ inbox: { putVerified: async () => { throw new Error('db unavailable'); } } });
  await assert.rejects(ingress({ rawBody: body, signatureHeader: xsolla() }), /db unavailable/);
  const broken = setup({ inbox: { putVerified: async () => undefined } }).ingress;
  await assert.rejects(broken({ rawBody: body, signatureHeader: xsolla() }), { code: 'inbox_not_durable' });
});
test('duplicate receipt is returned by injected persistent storage', async () => {
  const { ingress } = setup({ inbox: { putVerified: async () => ({ status: 'duplicate' }) } });
  assert.equal((await ingress({ rawBody: body, signatureHeader: xsolla() })).status, 'duplicate');
});
test('provider scope mismatch from trusted normalizer fails before persistence', async () => {
  const { ingress, records } = setup({ normalize: () => { throw new Error('wrong project'); } });
  await assert.rejects(ingress({ rawBody: body, signatureHeader: xsolla() }), /wrong project/);
  assert.equal(records.length, 0);
});
