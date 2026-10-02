# Server webhook boundary (local, not deployed)

Run `node --test server/monetization/webhook-contract.test.cjs` from the repository root. Node built-ins only; no credentials, network, database writes or package changes.

`webhook-contract.cjs` provides exact-byte Xsolla/Paddle signature verification and a provider-neutral ingress contract. This is not a complete payment/reward integration. There is no HTTP route, checkout, database grant, live provider configuration, or advertising adapter. Selecting either verifier does not select that provider commercially.

The application injects **trusted server code** at startup:

- `verify(rawBodyBuffer, signatureHeader)`: bound to the correct endpoint secret; returns strictly `true` only after authenticating provider delivery.
- `normalize(payload, namespace)`: validates the selected provider's current event schema, project, environment, final status, order reference and monetary units. It returns `{ kind, eventId, sourceId, referenceId, amountMinor, currency }` for payment facts or `{ kind, eventId, sourceId, referenceId }` for verified ad reward facts. These are provider facts, not user credit instructions. Account and unit amount must come from server order/attempt lookup. Signature verification alone is insufficient.
- `inbox.putVerified(record)`: performs a durable atomic insert under provider/project/environment/eventId or returns `duplicate` only when immutable payload hash matches. Different hash with the same key must reject/quarantine. It must not be an in-memory Map. The tests use stubs only to exercise the boundary, not to prove database idempotency.

Ingress resolves only after `putVerified` acknowledges persistence. HTTP host must map errors to provider-specific responses, enforce HTTPS/method/content-type/body size before buffering, redact secrets, preserve raw bytes and handle retries. It must not ACK before persistence, log the body or accept adapter functions/configuration from requests. Use a separate endpoint and secret for each provider project and environment. Xsolla has no signed timestamp here: persistent dedupe and economic source uniqueness are essential. Paddle checks both old and future delivery timestamps with a five-second tolerance and requires a synchronized server clock.

A fulfillment worker later resolves `referenceId` to a server-owned order/attempt, verifies expected amount/SKU/region/age policy and applies the transaction described in [DB_REQUIREMENTS](../../docs/monetization/DB_REQUIREMENTS.md). Deduplication by eventId does not prevent different events for one payment from crediting twice: enforce source/payment uniqueness too. Refunds, chargeback holds and final dispute resolution need the selected provider's state machine; unsupported events must be persisted/quarantined by a dedicated adapter before acknowledgement when provider sequencing requires it. This module intentionally rejects unsupported canonical kinds; it is not a drop-in webhook listener.

Sources checked 2026-10-02: [Xsolla signature](https://developers.xsolla.com/webhooks/section/webhook-listener/generation-of-signature), [Paddle signature](https://developer.paddle.com/webhooks/about/signature-verification/). Replace/manual-verifier compare with the chosen provider's official SDK during integration review if appropriate. Real sandbox deliveries and live approval remain untested.
