# Admin analytics: production deployment, 3 октября 2026

Применена **только** `migrations/20261003154904_lpa_admin_analytics.sql` через Supabase MCP apply_migration к `brvrlbahysbslkqntesl` после независимого review и явного разрешения root. Remote name `lpa_admin_analytics`, version `20261003170928` (20:09:28 Asia/Jerusalem). До применения история содержала ровно четыре ранее согласованные registry/economy migrations; все требуемые schemas/tables существовали, новые RPC/index отсутствовали. После применения история содержит пять migrations; stage B и telemetry отсутствуют.

Исходный SQL не переписан после review/apply, включая исторический комментарий LOCAL CANDIDATE. Raw SHA256 `a559cf295edcd3403eb0eefcbf12a7f545b0d1461f51cf9a831adb18e9856442`; canonical SHA256 `43d691adcd9aec5dca2e8f1d9f787edc7e9f54baffdd737a15d281cd36d27bc3`. Remote statements совпали с исходником после CRLF→LF и trimEnd. Манифест обновлён; blanket db push не использовался.

## Проверки

До deployment: три SQL группы PASS в disposable PGlite; root сообщил независимые 10 UI unit tests и browser PASS. После deployment — проверка фактического PostgreSQL в read-only транзакции, затем ROLLBACK: anon не имеет EXECUTE обеих public RPC; authenticated nonmember получает admin_forbidden/42501; без auth.uid() authentication_required/28000; existing member получает v1 access и actual aggregate; неверный диапазон отвергается. После successful access смена actor на nonmember снова запрещает access: результат access не является authorization ticket.

В production нет существующего nonmember auth user. Поэтому live SQL deny использует не назначенный никому UUID, не создаёт аккаунт; локальные tests проверяли двух реальных fixture users. Member проверка использует server-side read существующего membership и transaction-local request claim. **Это SQL role/claim simulation, не настоящий owner browser login.** UI публикацию/вход подтверждает UI workflow.

Отдельный revocation check: existing membership удалён только внутри явной незавершённой транзакции; обе RPC отвергли тот же actor; ROLLBACK восстановил исходное состояние. После rollback membership count=1. Новых role assignments не было. Сопоставление existing member с существующим confirmed auth user и публичным owner contact read-only: `matchesExistingPublicOwnerContact=yes`, `emailconfirmed=yes`. UUID/email не выводятся и не используются как authorization policy.

Live ACL: public wrappers SECURITY INVOKER, authenticated EXECUTE=true, anon/service_role=false; internal APIs SECURITY DEFINER в lpa_api с тем же ограничением; private require_admin EXECUTE=false для всех трёх клиентских ролей. У всех пяти functions пустой search_path. Membership/events/sessions: RLS=true, SELECT anon/auth=false, INSERT auth=false. Access policy — auth.uid() плюс текущее server membership в каждом RPC, без user_metadata/email/client role.

## Фактический ответ

Snapshot aggregate generatedAt `2026-10-03T17:10:30.990043+00:00` (20:10:30 Asia/Jerusalem), диапазон 2026-10-03 UTC, все игры: players=1, sessions=2, activeSeconds=128, matches=1, completedMatches=1, wins=1, losses/draws/abandons/errors=0. Crystal Front meanScore=50 points; Clutter Cup completedMatches=0, meanScore=null milliseconds. У Clutter Cup daily counts=0. Versions/builds/sourceCommit=null; installations=null. Нет account IDs/emails/raw events. Это клиентская аналитика; serverValidatedResults=false, economyEnabled=false.

Машиночитаемое evidence: [tests/admin-live-deployment-2026-10-03.json](tests/admin-live-deployment-2026-10-03.json).

## Advisors

Security advisors не перечисляют новые admin RPC: public wrappers INVOKER. Сохранились 17 INFO [RLS enabled/no policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) для закрытых private/analytics tables; это default-deny модель. Также 5 WARN [anon definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) и 7 WARN [authenticated definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) на ранее существующие analytics RPC, не новые admin wrappers. [Leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) остаётся Auth finding вне этого deployment; Auth config не менялся.

Performance: 11 существующих INFO [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys); 3 INFO [unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), включая только что созданный game_events_created_session. Сразу после создания отсутствие usage stats не причина удалять проверенный индекс; оставлен для date-range query. Advisors не объявлены полностью чистыми, несвязанные схемы не менялись.

Supabase URL/domain/Free plan прежние. Accepted branch, optional metadata, продажи, рейтинги и начисления не включены. Для UI scoped publication backend v1 готов; настоящий browser owner login здесь не подтверждён.
