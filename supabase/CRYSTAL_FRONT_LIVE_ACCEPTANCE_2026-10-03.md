# Crystal Front: live DB acceptance, 3 октября 2026

Проект `brvrlbahysbslkqntesl`, PostgreSQL 17.6. Снимки read-only SQL: **10:22:51 и 10:23:30 Asia/Jerusalem** (07:22:51 / 07:23:30 UTC). Начало этой проверки 10:21:31 (07:21:31 UTC). Источник: текущие production rows, metadata/ACL и security advisors через Supabase MCP. Доказательства без email, user/session UUID, токенов и event payload: [JSON](tests/crystal-front-live-2026-10-03.json). Аккаунты, события, деньги не создавались; SQL/Auth конфигурация не менялись.

## Реальные записи

| Показатель | crystal-front-demo | clutter-cup |
|---|---:|---:|
| Сессии, всего | 2 | 0 |
| Авторизованные / гостевые сессии | 1 / 1 | 0 / 0 |
| Analytics events | 4 | 0 |
| session_start / ready | 2 / 1 | 0 / 0 |
| match_start / match_end | 1 / **0** | 0 / 0 |
| session_end / active_time | 0 / 0 | 0 / 0 |
| Hub events | 4 | 0 |
| Сессии / события с 00:00 3 октября, Israel | 1 / 3 | 0 / 0 |

Crystal Front: старая гостевая сессия началась **28 сентября 12:05:03** Israel (09:05:03 UTC), содержит только session_start. Авторизованная сессия началась **3 октября 00:11:07** Israel (2 октября 21:11:07 UTC); ready записан в **00:11:11**, match_start — **00:11:47**. Последняя активность/analytics event: **3 октября 00:11:47.268734 Israel** (2 октября 21:11:47.268734 UTC). Последний hub event: **00:11:11.667922 Israel**. У обеих сессий ended_at=null, active_seconds=0; это не доказательство продолжающейся активной игры.

**Фактических завершений матча нет:** match_end=0, следовательно нет записанных win/loss/draw/abandon. Между началом этой проверки 10:21:31 и контрольным снимком 10:23:30 новых Crystal Front events и match_end — **0**. Отчёт не охватывает последующие действия QA/владельца.

## Атрибуция и отсутствие смешивания

Сессии привязаны к зарегистрированному game FK; events — FK к session. record_game_event содержит проверку зарегистрированной игры и actor+session+game. Счётчики выше сгруппированы по session.game, а не смешаны через общий hub history. Unregistered sessions/hub game, orphan events и дубли `(session,name,match)` — **0**; уникальный match index действует. Clutter Cup записей не имеет.

В sessions нет build/version/sourceCommit; в events нет таких metadata (**0** событий с build/buildId/version/sourceCommit), strict allowlist RPC не принимает произвольные поля. Поэтому поздняя авторизованная сессия подтверждает наличие реальной server-side account analytics записи, но **не доказывает 0.1.34, конкретный Google/OTP flow или текущий live QA run**. Зафиксировать причинную связь только по времени нельзя. По локальному документу игры 0.1.34 опубликована; её mock/HTTP evidence не является новой DB записью или real-auth acceptance.

Защита схемы проверена; невозможность семантической ошибки client gameId/фактической iframe сборки не доказана одними FK. Для текущей приёмки нет сопоставленного browser flow + нового session/match receipt. Account local save Stage A вообще не хранится в БД и этим запросом не проверяется.

## Права и gates

- Реестр: обе игры active=true, analytics_enabled=true, **economy_enabled=false**. Согласие игрока на аналитику отдельно контролирует host, SQL flag не доказывает consent текущей проверки.
- Все 12 lpa_private таблиц: RLS=true, прямые SELECT/INSERT/UPDATE/DELETE у anon/authenticated/service_role отозваны. Public analytics tables закрыты для anon/authenticated; service_role доступ сохраняется как исторический server access. Profiles имеют owner-only SELECT/INSERT/UPDATE policies с auth.uid(), UPDATE также WITH CHECK.
- Public lpa_* — INVOKER и authenticated-only; lpa_api authenticated-only; административные lpa_private функции service_role-only; trigger helpers без client EXECUTE. Старые guest analytics RPC доступны anon/authenticated, ownership/game guards сохраняются. Это не доказательство удаления guest backend.
- **Wallets теперь 1**, enabled=0, nonzero balance=0, blocked=0. Это изменение относительно нулевого deploy snapshot 2 октября; причина создания не выводится из агрегатов. lpa_wallet может создать zero/disabled wallet при реальном авторизованном чтении. Не называть её тестовым начислением или включённой продажей.
- Products/ledger/grants/orders — **0**. Реальных credit/spend/grant операций нет. Capabilities definition: providers=false, cloudSaves=false; все текущие wallets имеют spendEnabled=false. Approved products отсутствуют, bomb sale OFF.
- История миграций неизменна: четыре записи register_clutter_cup/registry/ACL/economy от 2 октября. Cloud saves/submissions/accepted consumption методы и таблицы не добавлены. lpa_inventory по-прежнему выдачи, не остаток consumable balance.

Advisors: ожидаемые INFO RLS без политик на закрытых таблицах; прежние WARN guest/signed-in SECURITY DEFINER analytics и leaked password protection disabled. Новых lpa_* warnings нет. Пояснения: [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [guest functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Это не security clearance без замечаний.

## Auth: доступ MCP и реальные блокеры

Инвентарь доступных Supabase MCP tools проверен заново: **нет API чтения/изменения Google provider, SMTP/OTP templates, Site URL или redirect allowlist**. get_project/SQL/advisors не дают эти настройки. Не читались auth secret/config blobs, user identities/email или токены. Advisors сообщает только отдельную password-protection настройку; из неё нельзя вывести SMTP/Google readiness.

Google button/signInWithOAuth и signInWithOtp присутствуют в коде сайта; это не подтверждение server provider settings или доставки. Последнее наблюдение dashboard от 2 октября требовало повторного входа; состояние browser сегодня этим DB агентом не проверялось. Текущие Google/SMTP/redirect настройки остаются **UNKNOWN через доступный MCP**, а не «отсутствуют» или «сломаны».

Для real-auth acceptance нужен нормальный вход владельца/QA в официальный сайт с собственным аккаунтом и фиксация успешного Auth→ready→игра→Exit; настройки при необходимости проверяются владельцем в обычной dashboard сессии. OTP delivery требует реального согласованного почтового ящика. Account credentials/service keys для этого отчёта не нужны и не запрашивались. Одна историческая authenticated session не закрывает Google/OTP или новую build acceptance.

Итог DB части: текущая схема и закрытые экономические gates подтверждены, analytics session/ready/match_start присутствуют, **match completion текущей приёмки не подтверждён**. Monetization и cloud Stage B не запускались. Следующий read-only snapshot имеет смысл после конкретного успешного browser матча с согласием на аналитику; analytics consent off законно даёт отсутствие новых rows и не означает отказ local saves.
