# Hub analytics: first stage

Status: database migration applied on 2026-09-20; SQL isolation tests passed.
Frontend published to GitHub Pages. Verified the consent notice, disabled
collection by default, and the owner's aggregate report in Settings in the live
browser. Nine automated JavaScript tests passed. `tests/analytics.sql` passed
against Supabase in a rolled-back transaction. Opt-in collection in the user's
live browser was not enabled: separate permission for that privacy choice is
pending. Synthetic SQL and JavaScript checks cover event recording.

Run `migrations/20260920_analytics.sql` after the profiles migration.
The owner account must already exist in Supabase Auth. The migration assigns
the aggregate report to the existing libertypandaa@gmail.com account only.

## Identity and consent

- No telemetry or guest identifier before opt-in.
- A random UUID in localStorage identifies a browser, not a person.
- The database stores the hash of the guest bearer identifier.
- Clearing storage, another device or private browsing creates a new guest.
- Authenticated identity comes from auth.uid(), never a client-supplied user ID.
- Guest and account histories are not automatically merged.
- Settings allow disabling collection and deleting the current identity's events.
- No direct table access for anon/authenticated; RPC functions scope access.

## Metrics

Visits (30-minute deduplication), Play activations, installation-link clicks,
browser install availability and installation events, supported error signals,
personal launch history, active identities over 1/7/30 days, registrations,
returning identities and exact UTC-calendar D1/D7/D30 retention.
Totals describe consented identities, not all visitors or unique humans.
Installation events are signals, not a complete inventory of installed apps.

Game readiness requires the active game iframe to send
`parent.postMessage({type: 'game_ready'}, 'https://libertypandaa.github.io')`.
The hub validates source and origin. A Play click alone is not a loaded game.
Active gameplay duration, matches, wins and scores are not collected yet.

## Verification and limits

Run `node --test tests/auth.test.cjs tests/stats.test.cjs`.
Before deployment verify SQL execution, isolation between guest secrets,
rejection of non-owner aggregate access, event deduplication and deletion.
Client telemetry is untrusted and must never award competitive scores.
The per-identity daily cap is not bot protection: guests can rotate identifiers.
There is no automatic event-retention cleanup job yet.
