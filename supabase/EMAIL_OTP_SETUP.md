# Email code sign in for LPA

Decision: Google remains the primary button. Email one-time code is the secondary option; no password. Local implementation: docs/auth-email.js and the profile section of docs/index.html. This is not a verified live mail delivery feature yet.

## Server setup before release

In project brvrlbahysbslkqntesl, review Auth email templates for Magic Link and Confirm Signup used by the new and existing user flows. Include {{ .Token }} prominently so the user receives the numeric OTP, not only a clickable confirmation URL. Configure sender and production SMTP, allowed recipients and rate limits. Verify the configured OTP length (UI supports 6 to 10 digits) and expiry. Supabase remains responsible for verification, expiration and throttling. The 60-second UI resend guard is not server abuse protection.

Review automatic identity linking settings: email verification alone must not cause the UI to claim a particular identity merge. Test an existing Google account with the same verified email under the actual Supabase configuration before release.

Official references:
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-email-templates

## Required acceptance

Use explicitly designated test inboxes. Check a new address, existing email account, existing Google identity with same email, wrong/expired/reused code, resend, quota errors, actual delivery, sign-out and reopen. Never log OTP values or email bodies. No real emails were sent during local development.

The implementation uses signInWithOtp({ email, options: { shouldCreateUser: true } }) then verifyOtp({ email, token, type: 'email' }). The shared auth listener updates profile and statistics identity. Email/code stay in form memory; the handler does not persist or log them. The Supabase client persists the resulting auth session as before.

## Scope and release

The existing authentication UI exists on the catalog profile page only. Independent game/PWA authentication, mandatory account gating and returning to a particular game remain the next integration step. Do not claim those flows complete from this change. Keep published guest behavior until the full account flow is ready.

Before a future publication, include auth-email.js and the changed auth.js in the coordinated asset/cache release; the HTML already uses a new auth query version to avoid old cache-first code. There has been no service worker activation change, push or deployment here.

## Concrete setup checklist 2 October 2026

1. Open Authentication / Email / SMTP settings. Record whether custom SMTP is enabled; no credential values belong in chat. Default Supabase SMTP is for testing and restricts recipients to project team members: https://supabase.com/docs/guides/auth/auth-smtp . If no custom sender exists, first choose a sender domain and provider; do not invent credentials or promise delivery to all players.
2. Use templates/email-code.html for both Magic Link and Confirm Signup. Suggested subject: Ваш код входа в Liberty Panda Arcade. Keep {{ .Token }} unchanged. Review OTP expiration and length against the configured project values.
3. Keep Google enabled and email confirmation enabled. Site URL: https://libertypandaa.github.io/liberty-panda-arcade/ . Review the exact redirect URLs below; avoid an unrestricted wildcard.

https://libertypandaa.github.io/liberty-panda-arcade/
https://libertypandaa.github.io/liberty-panda-arcade/games/crystal-front/
https://libertypandaa.github.io/liberty-panda-arcade/games/crystal-front/install/
https://libertypandaa.github.io/liberty-panda-arcade/games/clutter-cup/
https://libertypandaa.github.io/liberty-panda-arcade/games/clutter-cup/install/

Google's OAuth authorized callback remains https://brvrlbahysbslkqntesl.supabase.co/auth/v1/callback . These are settings to review, not a claim they were changed.

4. Run DEPLOYMENT_PREFLIGHT.sql read-only before deciding which migration is missing. Never reapply the historic schema wholesale.
5. Use an explicitly designated test recipient to check a new and returning account. Delivery and Google sign-in must be verified in the real project, then in an actual PWA.

Local candidate now remembers the selected game for one hour in sessionStorage and offers an allowlisted continuation link after login. All five launch pages and three workers use the same candidate shared-asset version. No force activation or mid-game reload was added. Nothing has been pushed or deployed.
