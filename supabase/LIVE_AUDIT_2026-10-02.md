# Supabase: фактическая проверка 2 октября 2026

## Актуальный production postcheck, 16:04 UTC

После отдельного разрешения на применение production получил четыре миграции: `register_clutter_cup` (20261002155351), `lpa_registry_core` (20261002155606), `lpa_registry_acl_hardening` (20261002160240), `lpa_economy_core` (20261002160305). Все SQL statements сверены с исходными файлами; SHA256 записаны в `DEPLOYMENT_MANIFEST.json`. Детальный итог и API — `DB_AGENT_HANDOFF.md`, metadata evidence — `tests/production-verification.json`.

Реестр содержит только Crystal Front и Clutter Cup. Обе игры имеют economy_enabled=false. Старые ограничения game заменены FK на реестр; record_game_event использует зарегистрированные игры. Экономические таблицы wallets/ledger/products/prices/lots/allocations/orders/grants/entitlements/audit пусты. Ни фиктивных начислений, ни товаров, ни покупок в production нет.

Реально установлены authenticated-only RPC lpa_games, lpa_wallet, lpa_catalog, lpa_inventory, lpa_purchase, lpa_purchase_status, lpa_capabilities. Purchase принимает p_price_version, без expectedPrice. Public wrappers SECURITY INVOKER; приватные backend функции service_role-only; стандартный PUBLIC EXECUTE явно отозван. Все 12 приватных таблиц имеют RLS и закрытые прямые табличные права.

Security Advisor после применения: новых warnings для lpa_* нет; INFO RLS без политик на закрытых таблицах ожидаем, прямые права отозваны. Прежние warnings о гостевых SECURITY DEFINER analytics и выключенной leaked password protection остаются. Это не полный security clearance. Тесты временного стенда проходят, но настоящая конкуренция нескольких соединений PostgreSQL 17 и пользовательский REST smoke test ещё не выполнены.

Crystal Front выбран первым пилотом монетизации. Это не включает продажи: accepted branch/cloud saves, consumable consumption, provider signatures/inbox/reconciliation/refunds пока отсутствуют. Провайдеры не подключены; frontend ad_completed не начисляет LPA. Auth/SMTP настройки и проверка доставки не изменились: dashboard требует повторного входа владельца. Git push/публикация сайта в этом ходе не выполнялись.

## Исторический снимок до применения

Следующие разделы сохранены как исходная проверка до четырёх миграций выше. Утверждения «production не изменён», «истории нет» и «кошелька нет» описывают только тот момент; актуальное состояние приведено выше.

Исходная проверка выполнена из нового чата в существующем корне проекта. Использованы Supabase MCP list_projects, get_project, list_tables, list_migrations, execute_sql и get_advisors. На этапе исходного снимка production не изменялся.

## Доступ и проект

- MCP доступен, запросы успешны.
- Единственный возвращённый проект: Liberty panda arcade, `brvrlbahysbslkqntesl`, `ACTIVE_HEALTHY`, `eu-central-1`.
- Версия проекта `17.6.1.166`, движок PostgreSQL 17; SQL `version()` подтверждает PostgreSQL 17.6.
- Локальная ветка `codex/clutter-cup`, HEAD `f97f7faf8ea20fe2bc8651a6d2b1f02b05991c4b`. Существующие изменённые файлы и untracked README/game-hub/projects сохранены.
- Корневой AGENTS.md не найден; найденный game-hub/AGENTS.md относится к восстановленному подкаталогу, который не менялся.

## Реально существующая база

В public шесть таблиц: profiles, hub_events, hub_analytics_admins, game_analytics_sessions, game_analytics_events, game_analytics_custom. На всех включён RLS. Облачных сохранений, кошелька, покупок и реестра установок в public нет; целевая спецификация не является реализованным backend.

list_migrations возвращает пустой список. `to_regclass('supabase_migrations.schema_migrations')` возвращает null: таблицы истории нет. Таблицы/функции профилей и аналитики существуют, но это не доказывает исполнение конкретных файлов миграций. Нельзя повторно применять старые миграции на основании пустой истории. Прототип docs/supabase-schema.sql не применять.

profiles: authenticated имеет SELECT/INSERT/UPDATE; три политики ограничивают id текущим auth.uid(), UPDATE содержит USING и WITH CHECK. Создание профиля подключено AFTER INSERT триггером auth.users. На таблицы аналитики прямых табличных прав anon/authenticated нет; RLS без политик здесь закрывает прямой доступ. Аналитика обслуживается ограниченными RPC.

Проверены определения RPC: my_game_stats/my_hub_stats фильтруют текущего actor; авторизованный actor определяется auth.uid(), гостевой UUID не подменяет его. record_game_event проверяет actor/game/session, структуру данных, лимиты и завершённую сессию. В базе есть уникальные индексы для разового ready/session и результата матча. Внутренний game_stats_for не предоставлен anon/authenticated. admin_game_stats и hub_admin_stats проверяют членство в серверной hub_analytics_admins; user_metadata для назначения администратора не используется.

Read-only транзакции с SET LOCAL ROLE authenticated и двумя синтетическими JWT sub: у каждого видимых профилей 0, my_game_stats=[], история хаба пустая. Транзакции завершены rollback, аккаунты и события не создавались. Это ограниченная проверка изоляции SQL, не два реальных OAuth-аккаунта и не проверка записи профиля.

## Clutter Cup

Живые hub_events_game_check и game_analytics_sessions_game_check допускают только crystal-front-demo. record_game_event также явно отвергает другой game ID. В текущей аналитике одна сессия crystal-front-demo, сессий Clutter Cup нет; allowlist custom events содержит только Crystal Front.

Подготовленная 20260927_clutter_cup.sql расширяет оба ограничения и RPC, сохраняя ownership/лимиты/дедупликацию. Живая база ещё не содержит этого расширения. Идентификаторы игр должны остаться раздельными. Наличие SQL и локальный тест не означают включённую статистику опубликованной игры. Миграция не применялась из-за действующего ограничения «пока ничего не публикуй».

## Advisor и границы проверки

Security Advisor сообщает RLS без политик на пяти закрытых таблицах, доступность SECURITY DEFINER RPC для anon/authenticated и выключенную leaked password protection. Закрытые таблицы и старые гостевые RPC объясняют часть замечаний; это не основание добавлять открытые политики или менять функции на INVOKER вслепую. Для перехода к обязательному аккаунту надо отдельно спланировать совместимость опубликованного гостевого поведения. Проверенные admin RPC содержат серверную проверку роли. Password protection не является проверкой Google/OTP, выбранных для нового интерфейса.

Ссылки на пояснения Advisor: [RLS без политик](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anon SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Auth: конкретный недостающий доступ

В доступном MCP нет чтения/изменения конфигурации Auth. Браузер открыл [SMTP Settings](https://supabase.com/dashboard/project/brvrlbahysbslkqntesl/auth/smtp), затем показал Session expired / Please sign in again to continue. Авторизованный MCP не переносит сессию в браузер. Новый OAuth, установка плагина, обход Cloudflare и запрос секретов не выполнялись.

Custom SMTP, отправитель, Magic Link/Confirm Signup, Site URL, redirect allowlist и Google OAuth credentials не прочитаны и не изменены. Их текущий статус неизвестен, а не «SMTP отсутствует». Доставка OTP, реальный Google-вход, записи статистики, физические PWA/Safari не подтверждены. Чтобы продолжить Auth-проверку, нужен обычный вход владельца в локальную панель Supabase, затем явно выбранный тестовый почтовый ящик для доставки; пароль БД/service_role не нужен.

По [документации SMTP](https://supabase.com/docs/guides/auth/auth-smtp) стандартная отправка ограничена адресами команды и не предназначена для production. Это правило сервиса, не доказательство конфигурации этого проекта. [Numeric OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) требует {{ .Token }} в письме; локальный шаблон подготовлен, применение на сервере не проверено.

## Локальная проверка

36 модульных тестов прошли повторно. player-ui-check прошёл в Chromium 390×844 с подставными Auth/RPC/игрой: вход перед запуском, приветствие, показатели, отдельная Library, скрытый admin, отсутствие overflow, маршруты PWA. Реальный сервер этим UI-тестом не проверяется.

database-check прошёл: две исходные миграции аналитики, расширение Clutter Cup, tests/analytics.sql и tests/game-analytics.sql. PGlite 0.5.8 взят из уже существующего output/qa/electric-sql-pglite/package через временный resolver процесса Node; исходник теста и package.json не менялись, новые зависимости не установлены. output/database-check.json подтверждает passed=true, production=false, rollbackVerified=true. Это временная база, не запись в Supabase. Старые browser-check/browser-protocol-check, рассчитанные на гостевой запуск, в этой итерации не запускались и не объявляются прошедшими.

До выпуска остаются: Auth-настройки/доставка, применение только необходимого расширения Clutter Cup после разрешения выпуска, реальная статистика двух пользователей и обеих игр, PWA/телефоны и обновление privacy-текста под email/обязательный вход. Добровольная аналитика сохраняется; обязательные сохранения/экономика требуют отдельного ещё не реализованного потока.
