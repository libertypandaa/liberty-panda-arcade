# Clutter Cup in Liberty Panda Arcade — 27 September 2026

## Release scope

The existing static site in `docs/` launches Clutter Cup as a distinct game. Game sources are unchanged.

- Game ID: `clutter-cup`; studio: Lieberman Games.
- Game URL: https://libertypandaa.github.io/clutter-cup-playtest/
- Hub route: https://libertypandaa.github.io/liberty-panda-arcade/games/clutter-cup/
- Direct launch: https://libertypandaa.github.io/liberty-panda-arcade/games/clutter-cup/?launch=play
- Checked public game build: `vs-2026-09-27T08:36:58.581Z`.
- Public sourceCommit: `897c0f5dea81ff3ae9f4bec1c5acdd9a6be63b38`; the game's version metadata also reports `sourceDirty: true`.
- Contract: https://github.com/libertypandaa/clutter-cup/blob/main/clutter-cup/docs/ARCADE_HUB_HANDOFF.md

## Database deployment required

Apply **only** `supabase/migrations/20260927_clutter_cup.sql` to the existing Supabase project `brvrlbahysbslkqntesl`, after checking its current migration history. The migration was validated against the existing two analytics migrations on temporary PostgreSQL. Do not run the old prototype `docs/supabase-schema.sql` or rerun applied migrations.

At verification time, the live RPC rejected `clutter-cup` with `Invalid identity or game` (HTTP 400). No Supabase administrator connection was available to this task. Therefore live Clutter Cup statistics are **not deployed or accepted**. Play and local game saves do not depend on analytics. After applying the migration, reopen the game and verify records with consent in Profile and the owner report.

The new migration expands the two game constraints and `record_game_event`, retains existing RLS, actor/session ownership, payload validation, rate limits and deduplication. Clutter Cup finish scores are integer milliseconds; lower is better. Abandoned matches are excluded from the existing average. No Clutter Cup custom events are registered or claimed operational.

## Session and player behavior

- The registry chooses the allowed game URL. Neither iframe messages nor a query string choose a database game ID.
- Each launch gets a fresh iframe and launch nonce. A session is configured only after the loaded document's origin, path and nonce are verified; source/protocol/session are checked on each message.
- Events queued before switching games retain their original game ID and session. Account or consent changes discard unsent events from the earlier identity generation.
- Duplicate result IDs and duplicate results for the same match are suppressed, with the database uniqueness constraints as an additional boundary.
- Closing an unfinished recorded match produces one `abandon` before ending its session. Sudden crash/network loss remains best effort.
- Fullscreen failure leaves a viewport player. Close and fullscreen controls occupy their own toolbar, outside the canvas.

## Installation and updates

Clutter Cup has its own manifest ID, scope, icons and shell cache. Its shortcut starts the game directly. Standalone display alone is not represented as proof of installation. No guaranteed offline game or cloud save API is advertised.

Changed local script URLs include a release query version so the old cache-first worker cannot mix the new catalog with the old single-game analytics bundle. The player loads independently from the optional external auth SDK.

New shell service workers do not call `skipWaiting` or `clients.claim`. This intentionally protects already-open old shells that used to reload on controller changes. Close all old app tabs/windows and reopen to activate an update. New pages also defer reload requests while their player is open. No game IndexedDB or another game's cache is cleared.

## Checks and limitations

- 27 JavaScript tests passed: authentication/profile regression, consent, 60 active seconds across pauses/hidden time, game/account changes, URL/source/origin/protocol/session checks, duplicate results, closing matches, deferred updates.
- Both existing analytics migrations and the new migration passed on temporary PostgreSQL (PGlite 0.5.8).
- SQL suites passed for both games: private tables/reports, guest isolation, session ownership, duplicates, finish-time averages and disabled custom events. Test transactions rolled back.
- Inline JavaScript syntax checked for all five catalog/game/install pages.
- Controlled Chromium checks passed: catalog launch, game-page launch, no-consent play, SDK ready, 844×430 landscape layout, install page and direct shortcut launch; no JavaScript errors.
- Published SDK protocol fixture passed: one start/end despite duplicate result submission, active-time messages, real tutorial event, and unchanged local coins/reputation/achievements/blueprint/tutorial after closing and reopening. This was a labelled synthetic SDK match, not a manually completed race.
- Browser acceptance is recorded separately in the local `output/browser-check/` report; controlled tests use the real published game with a mocked statistics API and do not establish real database writes.
- Live signed-in account/owner report and live Clutter Cup database records remain unverified pending Supabase access and migration.
- Physical Android/iPhone/Safari installation and audio-effect rights documents (ElevenLabs) are unverified.
- Game saves remain local IndexedDB, not account-scoped cloud saves. A live race is not restored after reload.

## Reproduce checks

From the site root, install the pinned test-only dependencies from `package.json`, then run:

```text
npm test
npm run test:db
npm run test:browser
npm run test:protocol
```

`CHROME_PATH` may override the browser executable for browser checks. These tests do not build or modify the game. Local verification/recovery artifacts are excluded from Git.
