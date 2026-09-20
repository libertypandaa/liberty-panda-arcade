# Hub and game analytics

Status: database migration applied on 2026-09-20; SQL isolation tests passed.
Frontend published to GitHub Pages. Verified the consent notice, disabled
collection by default, and the owner's aggregate report in Settings in the live
browser. The user subsequently authorized the live opt-in test: one visit and
one Crystal Front launch appeared in both personal and owner reports.

The game extension migration `20260920_game_analytics.sql` was applied on
2026-09-20. `tests/game-analytics.sql` passed in a rolled-back transaction:
aggregates, deduplication, guest isolation, schema validation, private reports,
and deletion. Sixteen JavaScript tests pass. Expanded collection uses a new
consent key and does not reuse the previous limited consent.

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

The v1 SDK adds sessions, readiness/load time, active time, match outcomes,
score averages, tutorial steps, progress, achievements, error codes, and
registered custom numeric events. Personal and owner reports aggregate these
events. See `docs/GAME_ANALYTICS_GUIDE.md` for the developer handoff.
The existing game repository has not been instrumented in this task: game
metrics will remain empty until its developer connects the SDK. A Play click
alone is not a loaded game; client achievements are not server-issued rewards.

## Verification and limits

Run `node --test tests/auth.test.cjs tests/stats.test.cjs tests/game-analytics.test.cjs`.
Before deployment verify SQL execution, isolation between guest secrets,
rejection of non-owner aggregate access, event deduplication and deletion.
Client telemetry is untrusted and must never award competitive scores.
The per-identity daily cap is not bot protection: guests can rotate identifiers.
There is no automatic event-retention cleanup job yet.
SDK delivery is best-effort, with no durable offline queue. Missing endings
older than 24 hours are classified as unresolved, not defeats. Active time
excludes hidden tabs and explicit pauses but parallel sessions are summed.
Only trusted first-party games should run on the current shared GitHub origin.
