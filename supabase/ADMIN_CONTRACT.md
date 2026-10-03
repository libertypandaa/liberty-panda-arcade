# Admin RPC contract v1 — отдельный кабинет

3 октября 2026. **DEPLOYED:** lpa_admin_analytics, remote version 20261003170928, project brvrlbahysbslkqntesl. Применён только проверенный SQL migrations/20261003154904_lpa_admin_analytics.sql; remote source совпадает с локальным после CRLF→LF/trimEnd. Postchecks PASS, точный [отчёт](ADMIN_DEPLOYMENT_2026-10-03.md). UI использует mapping по этому контракту; missing RPC означает «кабинет недоступен», не mock fallback. Старые admin_game_stats()/hub_admin_stats() сохранены, membershipCount=1 в public.hub_analytics_admins. Assignment не выполняется; save/consume и telemetry не применены.

## Access / authorization

`lpa_admin_access()` без аргументов:

```json
{"contractVersion":1,"access":{"allowed":true},"permissions":["analytics:read"]}
```

Только authenticated с auth.uid() в серверной public.hub_analytics_admins. Anon не имеет EXECUTE. Signed-in ordinary player получает SQLSTATE42501/message admin_forbidden, не данные; UI преобразует это в denied. Auth uid отсутствует: authentication_required. На client user_metadata/email/profile flags не смотреть. Existing membership count не доказывает, что конкретный пользователь чата владелец. Никакая новая роль или запись membership не назначена.

Отдельная /admin/ страница, явно открываемая пользователем после обычного входа. Игровой UI всегда игрок, без auto-open, owner controls, role toggle или email whitelist. Логин — обычная user session, не service key. Сервер проверяет membership заново в каждом aggregate RPC; successful access не выдаёт доверенный ticket. Явный вход в кабинет — действие UI, не отдельное право из query string. Session expiry/revocation/403 закрывают dashboard.

## Dashboard exact wire

`lpa_admin_analytics(p_game_id text DEFAULT NULL, p_date_from date, p_date_to date)`.

Передавать все три аргумента: gameId либо null для всех registered games; обе даты ISO YYYY-MM-DD. Диапазон **UTC, inclusive**, максимум 31 день (dateTo-dateFrom <=30), dateTo>=dateFrom. Неизвестный gameId -> game_unavailable. Неверный диапазон -> invalid_date_range. Dates обязательны; SQL signature defaults определит миграция, UI не полагается на них.

```json
{
  "contractVersion":1,
  "access":{"allowed":true},
  "generatedAt":"2026-10-03T16:00:00Z",
  "filter":{"gameId":null,"dateFrom":"2026-10-03","dateTo":"2026-10-03","timeZone":"UTC"},
  "games":[{"id":"crystal-front-demo","title":"Crystal Front","scoreUnit":"points"}],
  "summary":{"players":1,"sessions":1,"activeSeconds":128,"matches":1,"completedMatches":1,"wins":1,"losses":0,"draws":0,"abandons":0,"errors":0,"installations":null},
  "activity":[{"date":"2026-10-03","gameId":"crystal-front-demo","players":1,"sessions":1,"activeSeconds":128,"matches":1,"completedMatches":1,"wins":1,"losses":0,"draws":0,"abandons":0,"errors":0}],
  "results":[{"gameId":"crystal-front-demo","scoreUnit":"points","matches":1,"completedMatches":1,"wins":1,"losses":0,"draws":0,"abandons":0,"meanScore":50}],
  "versions":[{"gameId":"crystal-front-demo","version":null,"buildId":null,"sourceCommit":null,"sessions":1}],
  "limitations":{"buildMetadata":"unavailable","installations":"unavailable","serverValidatedResults":false,"economyEnabled":false}
}
```

Пример условный, не ответ live API или фикстура пользователя. Games возвращает реестр для selector (включая обе зарегистрированные игры); activity/results/versions ограничены filter.gameId. Activity содержит строку на каждый UTC день и выбранную игру, включая zero rows. Results содержит строку на выбранную игру даже без матчей. Versions пока только unknown version row на игру с sessions>0; при zero sessions массив не получает такую строку.

Метрики:

- players — distinct session.actor с events в диапазоне; summary distinct за весь диапазон (не сумма ежедневных); обезличенный агрегат guest/account, никаких actor IDs.
- sessions — sessions.started_at в диапазоне. ActiveSeconds — сумма active_time.data.seconds по event.created_at в диапазоне, не lifetime sessions.active_seconds.
- matches — число match_end; completedMatches — win/loss/draw; abandon отдельно. Result day задаётся event.created_at, start может быть в предыдущем дне.
- meanScore — среднее score для win/loss/draw; null при отсутствии завершений или scoreUnit none. Не складывать points и milliseconds; results per game с scoreUnit. Это клиентская аналитика, не verified рейтинг/приз.
- errors — error events; никаких raw payload/PII.
- installations всегда null: текущий backend не знает реестр реальных установленных устройств. Hub installed/install_click не список устройств.
- versions содержит только null version/buildId/sourceCommit до отдельной metadata миграции; historical rows не приписываются current release.
- count 0 — известное отсутствие rows, null — unavailable/unknown. Не заменять null на 0 или текущую версию игры. Safe JS integer aggregates; timestamps ISO UTC.

Ни wallet/credits/платежные детали, ни пользовательские emails/UUID, ни сырые saves/events API не возвращает. Economy false — граница данного read-only кабинета; денег он не включает.

## Assignment и readiness

Existing hub_analytics_admins: прямые права anon/authenticated отсутствуют, RLS включён. Старые admin RPC проверяют membership через auth.uid(), но не имеют date filter/version contract. Новые public wrappers INVOKER, внутренние API definer+membership guard, private helper закрыт. Нужны tests anon/ordinary/foreign/member, закрытые таблицы, date filters, unknown versions, zero/null semantics, revoke membership после access.

Первичное назначение/смена owner — отдельно: владелец проходит обычный verified login, выбранный существующий auth.users UUID подтверждается доверенной owner процедурой и сопоставляется без client supplied email; потом конкретный privileged audited membership change с подтверждением идентичности. Этот файл не назначает owner по email и не объявляет existing membership принадлежащим владельцу чата.

Server RPC deployed и проверены; публикацию UI и настоящий owner browser login подтверждает отдельный UI workflow. Stage B save/consume и telemetry остаются локальными; продажи OFF.

## Проверенный локальный кандидат

`migrations/20261003154904_lpa_admin_analytics.sql` применена после независимого review и разрешения root. `node supabase/tests/admin-check.cjs`: три группы PASS (anon/player/metadata spoof denied; UTC/day/game aggregation and null semantics; ACL/range/revocation). Snapshot fixtures только disposable PGlite, не production. Live SQL role/claim checks, RLS/ACL и rollback revocation PASS; это не настоящий browser login. Миграция зависит только от уже применённого registry/economy baseline, **не от save/consume migration**. Frozen v1 wire выше не расширяется. Existing member read-only сопоставлен с публичным owner contact: matchesExistingPublicOwnerContact=yes, emailconfirmed=yes. Email не участвует в authorization и новый member не назначен.
