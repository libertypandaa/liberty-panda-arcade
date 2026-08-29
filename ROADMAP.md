# Game Hub Roadmap

## Research Notes

- PWA installability requires a web app manifest, HTTPS or localhost, app icons, a start URL, and standalone/browser display settings.
- GitHub Pages is suitable for static browser game builds, but shared accounts, cloud saves, leaderboards, and achievements require a backend.
- Supabase is the preferred backend candidate for the first platform version because Auth, Postgres, generated APIs, and Row Level Security fit the shared-account model.
- Each game should talk to the platform through a small GameHub SDK instead of calling backend details directly.
- Every implementation phase must include build checks, smoke checks, and access/security checks where relevant.

## Phase 0: Project Foundation

Tasks:
- Create the site scaffold.
- Set up the app shell, routing, styling tokens, and content model.
- Add this roadmap to the repository.

Checks:
- The project starts locally.
- The home route renders a recognizable game hub, not starter content.
- The build command succeeds.

Tests:
- Run the production build.
- Run a local smoke check against the home route.

## Phase 1: MVP Game Hub

Tasks:
- Build the home page with a catalog of games.
- Add Crystal Front Demo as the first game.
- Add a game detail page for Crystal Front Demo.
- Add visible play and install-to-phone flows.
- Make the UI responsive for desktop and mobile.

Checks:
- The game card has title, genre, status, description, and play action.
- The Crystal Front page clearly explains browser play and PWA installation.
- Layout does not overflow on mobile.

Tests:
- Production build.
- Smoke check for `/`.
- Smoke check for `/games/crystal-front`.
- Optional browser visual QA before release.

## Phase 2: PWA Layer

Tasks:
- Add a web app manifest.
- Add 192px and 512px icons.
- Configure `start_url`, `scope`, `display`, theme color, and background color.
- Add service worker/offline fallback if supported by the chosen deployment stack.
- Add platform-specific install guidance for iOS and Android.

Checks:
- Manifest is reachable.
- Icons are reachable.
- HTTPS or localhost is used.
- Install guidance works even where custom install prompts are unsupported.

Tests:
- Manifest response check.
- Service worker registration check.
- Lighthouse PWA check during browser QA.

## Phase 3: Accounts And Backend

Tasks:
- Create Supabase project.
- Add environment variable template.
- Add authentication UI.
- Create database schema for profiles, games, progress, scores, achievements, and user achievements.
- Add Row Level Security policies.

Checks:
- Users can sign up, sign in, and sign out.
- Users can only access their own progress.
- Leaderboard writes are validated.
- No service-role secrets are exposed to the client.

Tests:
- Auth smoke test.
- RLS policy checks.
- Migration review.
- Build with missing env fallback behavior.

## Phase 4: GameHub SDK

Tasks:
- Create a small browser SDK for games.
- Add `getPlayer`, `loadProgress`, `saveProgress`, `submitScore`, and `unlockAchievement`.
- Support guest mode.
- Make network errors non-fatal for gameplay.

Checks:
- Games call the SDK, not raw backend APIs.
- Offline or failed-save states are visible but do not crash the game.
- SDK methods are stable for future games.

Tests:
- Unit tests with mocked backend responses.
- Integration test for save/load progress.
- Smoke test from a game page.

## Phase 5: Crystal Front Integration

Tasks:
- Keep the external GitHub Pages play link in the first release.
- Later embed or migrate the game build into the hub.
- Connect Crystal Front to the GameHub SDK.
- Add progress, score, and achievement events.

Checks:
- Game launches reliably.
- Game route and platform UI do not fight for focus, sizing, or scroll.
- Saves appear in the profile.

Tests:
- Game launch smoke test.
- Mobile viewport smoke test.
- Save/progress integration test.

## Phase 6: Admin Console

Tasks:
- Add admin-only game management.
- Create forms for title, description, genre, status, cover image, screenshots, and play URL.
- Add game visibility controls.
- Add changelog/news fields.

Checks:
- Only admins can edit games.
- Draft games are hidden from normal users.
- Published game pages have correct metadata.

Tests:
- Admin access tests.
- CRUD tests.
- Metadata checks for published games.

## Phase 7: Publishing And Operations

Tasks:
- Deploy the site.
- Connect a custom domain.
- Add privacy-conscious analytics.
- Add error monitoring.
- Define backup and rollback flow.

Checks:
- Production build succeeds.
- HTTPS is active.
- PWA installability is verified.
- Secrets are not committed.

Tests:
- Production smoke test.
- Lighthouse performance/accessibility/PWA pass.
- Auth and save smoke test in production.
