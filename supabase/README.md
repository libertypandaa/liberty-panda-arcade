# Supabase deployment

Project: `brvrlbahysbslkqntesl` (Liberty panda arcade).

On 2026-09-20 the paused project was restored. Google OAuth was configured
with a web client in Google Cloud project `project-a329768b-12c7-4029-b55`.
The client secret is stored in Supabase Auth settings only.

Site URL and allowed redirect:
`https://libertypandaa.github.io/liberty-panda-arcade/`

Google callback:
`https://brvrlbahysbslkqntesl.supabase.co/auth/v1/callback`

Applied migration: `migrations/20260920_profiles.sql`.
Only the profiles table is deployed. Read, insert and update are restricted
to the authenticated owner using RLS. Anonymous access is revoked.
New Auth users receive profiles through a trigger.

Verified through the production website: Google sign-in, profile loading,
and saving the existing nickname. Game progress and leaderboard integration
are not deployed.

The legacy `docs/supabase-schema.sql` is a prototype, not the deployed schema.
Do not execute it against this project: its broader profile policies would
allow other signed-in users to read profiles. Future migrations must preserve
the owner-only access rules.

Google publishing status was Testing at the last check. Check Audience in
Google Cloud before announcing unrestricted registration to all players.
