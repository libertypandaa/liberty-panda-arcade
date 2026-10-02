'use strict';

// Server-only boundary. Authentication permits durable inbox ingestion, never a grant.
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { TextDecoder } = require('node:util');

class WebhookError extends Error {
  constructor(code) { super(code); this.name = 'WebhookError'; this.code = code; }
}
const fail = (code) => { throw new WebhookError(code); };
function bytes(body) {
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > 262144) fail('invalid_raw_body');
  return body;
}
function secret(value) {
  if (typeof value !== 'string' || value.length < 1) fail('missing_secret');
  return value;
}
function equalHex(actual, expected) {
  return typeof actual === 'string' && /^[a-f0-9]+$/i.test(actual) &&
    actual.length === expected.length && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

// Official protocol: SHA1(raw body + project secret). No timestamp protection;
// persistent inbox and economic-source uniqueness are mandatory for replay safety.
function verifyXsolla(rawBody, signatureHeader, key) {
  bytes(rawBody); secret(key);
  if (typeof signatureHeader !== 'string') return false;
  const match = /^Signature ([a-f0-9]{40})$/i.exec(signatureHeader);
  const digest = createHash('sha1').update(rawBody).update(key, 'utf8').digest('hex');
  return !!match && equalHex(match[1], digest);
}

// Manual Paddle algorithm; timestamp refers to delivery, not event occurred_at.
function verifyPaddle(rawBody, signatureHeader, key, nowSeconds = Math.floor(Date.now() / 1000)) {
  bytes(rawBody); secret(key);
  if (!Number.isSafeInteger(nowSeconds) || typeof signatureHeader !== 'string' || signatureHeader.length > 4096) return false;
  let timestamp;
  const signatures = [];
  for (const part of signatureHeader.split(';')) {
    const match = /^(ts|h1)=([a-f0-9]+)$/i.exec(part.trim());
    if (!match) return false;
    if (match[1] === 'ts') {
      if (timestamp !== undefined || !/^\d{1,16}$/.test(match[2])) return false;
      timestamp = match[2];
    } else if (match[1] === 'h1' && match[2].length === 64) signatures.push(match[2]);
    else return false;
  }
  const deliveryTime = Number(timestamp);
  if (!Number.isSafeInteger(deliveryTime) || Math.abs(nowSeconds - deliveryTime) > 5 || !signatures.length) return false;
  const digest = createHmac('sha256', key).update(`${timestamp}:`, 'utf8').update(rawBody).digest('hex');
  return signatures.some((value) => equalHex(value, digest));
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) fail('invalid_identifier');
  return value;
}
function canonicalEvent(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) fail('invalid_event');
  const kinds = ['payment.captured', 'payment.refunded', 'reward.verified'];
  if (!kinds.includes(input.kind)) fail('unsupported_event');
  const fields = input.kind === 'reward.verified'
    ? ['kind', 'eventId', 'sourceId', 'referenceId']
    : ['kind', 'eventId', 'sourceId', 'referenceId', 'amountMinor', 'currency'];
  if (Object.keys(input).some((key) => !fields.includes(key))) fail('unexpected_event_field');
  const event = { kind: input.kind, eventId: identifier(input.eventId), sourceId: identifier(input.sourceId), referenceId: identifier(input.referenceId) };
  if (input.kind !== 'reward.verified') {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
      typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) fail('invalid_money');
    event.amountMinor = input.amountMinor;
    event.currency = input.currency;
  }
  return Object.freeze(event);
}

// verify + normalize are trusted server code, selected at startup, never request data.
// normalize must validate provider-specific project/order/environment/status fields.
function createWebhookIngress({ provider, project, environment, verify, normalize, inbox }) {
  identifier(provider); identifier(project);
  if (!['sandbox', 'live'].includes(environment)) fail('invalid_environment');
  if (typeof verify !== 'function' || typeof normalize !== 'function' || typeof inbox?.putVerified !== 'function') fail('invalid_configuration');
  const namespace = Object.freeze({ provider, project, environment });
  return async function ingest({ rawBody, signatureHeader }) {
    // Copy bytes so async verification cannot race with mutation of the caller buffer.
    const body = Buffer.from(bytes(rawBody));
    if (await verify(Buffer.from(body), signatureHeader) !== true) fail('invalid_signature');
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
    catch { fail('invalid_json'); }
    const event = canonicalEvent(await normalize(payload, namespace));
    const record = Object.freeze({ ...namespace, event, payloadHash: createHash('sha256').update(body).digest('hex') });
    // putVerified must atomically INSERT or compare an existing event's immutable
    // hash under (provider, project, environment, eventId). Never an in-memory store.
    const receipt = await inbox.putVerified(record);
    if (!receipt || !['stored', 'duplicate'].includes(receipt.status)) fail('inbox_not_durable');
    return Object.freeze({ status: receipt.status, eventId: event.eventId });
  };
}

module.exports = { WebhookError, verifyXsolla, verifyPaddle, canonicalEvent, createWebhookIngress };
