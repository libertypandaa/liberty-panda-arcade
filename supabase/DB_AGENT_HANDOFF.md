# Передача: реестр игр и экономический фундамент LPA

Обновлено 2 октября 2026, после применения и проверки production проекта `brvrlbahysbslkqntesl` (PostgreSQL 17.6). Реестр, поддержка аналитики Clutter Cup и экономические RPC применены. Продажи выключены: у обеих игр `economy_enabled=false`, экономические таблицы пусты. Провайдеры платежей, рекламные начисления и облачные сохранения не подключены. Frontend и документы других исполнителей в этом ходе не изменялись; git commit/push не выполнялись.

## Применение и доказательства

| Исходный файл | Имя в remote history | Remote version |
|---|---|---|
| migrations/20260927_clutter_cup.sql | register_clutter_cup | 20261002155351 |
| migrations/20261002152159_lpa_registry_core.sql | lpa_registry_core | 20261002155606 |
| migrations/20261002155750_lpa_registry_acl_hardening.sql | lpa_registry_acl_hardening | 20261002160240 |
| migrations/20261002152509_lpa_economy_core.sql | lpa_economy_core | 20261002160305 |

`DEPLOYMENT_MANIFEST.json` содержит SHA256 исходных файлов и нормализованного SQL. Все четыре исходника сверены с фактическими statements в `supabase_migrations.schema_migrations`: совпадают после CRLF→LF и удаления завершающих пробельных символов. MCP назначил remote timestamps, отличные от локальных имён. Старые исходники не переписывались.

`tests/production-verification.json` фиксирует постпроверку без пользовательских записей и секретов:

- В реестре ровно Crystal Front и Clutter Cup, обе с отключённой экономикой. Старые CHECK идентификаторов игр заменены FK на реестр.
- wallets, ledger, products, prices, credit_lots, debit_allocations, store_orders, inventory_grants, entitlements, economy_audit: по нулю строк. Тестовые деньги/товары/покупки в production не создавались.
- Все 12 таблиц `lpa_private` имеют RLS; прямые SELECT/INSERT/UPDATE/DELETE запрещены anon, authenticated и service_role.
- Клиентские public `lpa_*` — SECURITY INVOKER, EXECUTE только authenticated. Внутренние `lpa_api` проверяют auth.uid(); клиент не задаёт владельца.
- Административные функции `lpa_private` доступны только service_role; функции триггеров недоступны всем трём клиентским ролям. На этих функциях нет PUBLIC EXECUTE.

Обнаруженная особенность ACL устранена: REVOKE в per-schema default privileges не снимает глобальный стандартный PUBLIC EXECUTE. Отдельная миграция исправила реестр; экономическая миграция явно отзывает все права и выдаёт точный allowlist. Не менялись глобальные defaults других схем.

Миграционная история ранее отсутствовала. Теперь она содержит перечисленные четыре применения; три исторических файла с одинаковой версией `20260920` не backfill-ились. До обычного `supabase db push` необходимо отдельно согласовать baseline и соответствие локальных/remote версий. Не отправлять автоматически весь текущий каталог.

## Точный клиентский RPC-контракт v1

Типы: `rpc-contract.ts`. Все RPC требуют authenticated и ненулевой auth.uid(). Значения LPA — целые числа, максимум баланса 1e12, безопасный для JavaScript number.

| RPC | Аргументы | Результат |
|---|---|---|
| lpa_games | нет | массив {id,title,url,scoreUnit} |
| lpa_wallet | нет | {balance,currency:"LPA",walletVersion,status,economyEnabled} |
| lpa_catalog | p_game_id:text | массив {id,gameId,itemId,title,price,priceVersion,kind,quantity} |
| lpa_inventory | p_game_id:text | массив {id,gameId,itemId,kind,quantity} |
| lpa_purchase | p_game_id:text, p_product_id:text, p_request_id:uuid, p_price_version:integer | Receipt |
| lpa_purchase_status | p_request_id:uuid | Receipt либо null |
| lpa_capabilities | нет | {contractVersion:1,registry:true,economy:true,providers:false,cloudSaves:false,spendEnabled:boolean} |

`Receipt = {purchaseId,gameId,productId,priceVersion,status:"purchased"|"already_owned",balance,currency:"LPA",walletVersion,grant:{id,gameId,itemId,kind,quantity}}`.

В purchase используется только `p_price_version`; expectedPrice/p_expected_price отсутствует. SQL DEFAULT NULL позволяет безопасно отклонить старый вызов ошибкой `price_quote_required`; SDK передаёт обязательную версию из подтверждённого каталога. Изменение цены, количества или заголовка создаёт новую неизменяемую версию предложения. Связь product/game/item не редактируется: для другого предмета создаётся новый продукт.

Один requestId и неизменные game/product/priceVersion возвращают сохранённый receipt. Иной payload с тем же ID даёт `idempotency_conflict`. Replay проверяется до текущей цены, активности товара и блокировки кошелька. `purchase_status` ищет только собственный receipt и работает после деактивации товара. После тайм-аута проверить status и сопоставить gameId/productId/priceVersion; повторять исходный ID и payload. Баланс в receipt исторический: после принятой покупки/replay перечитать wallet.

Ошибки lower_snake_case: authentication_required, game_unavailable, product_unavailable, request_id_required, price_quote_required, price_changed, economy_disabled, account_blocked, insufficient_funds, idempotency_conflict, projection_mismatch. Сеть или missing RPC не означают успех и не разрешают показывать выдуманный баланс.

`lpa_wallet` создаёт реальную строку с нулём и отключённой экономикой при первом авторизованном вызове. `spendEnabled` отражает допуск аккаунта; конкретная покупка дополнительно требует включённую и активную игру. Это не признак готовности провайдера. `inventory` возвращает неизменяемые выдачи, а не остатки после расходования: протокол consumption ещё отсутствует.

Реестр допускает scoreUnit points, milliseconds и none. Для none ненулевой score отвергается. Регистрация третьей игры через backend проверена только на временном стенде; в production третья игра не добавлялась. Реестр не публикует frontend игры автоматически.

## Серверная экономика

Покупка в одной транзакции блокирует wallet, проверяет допуск/версию/средства, создаёт debit ledger, FIFO allocations по credit lots, grant, permanent entitlement и сохранённый receipt. Ошибка на любом шаге откатывает всё. Повторная покупка permanent предмета возвращает already_owned без повторного списания.

Ledger, цены, grants, allocations, entitlements, receipts и аудит защищены триггерами от UPDATE/DELETE. Paid/ad credit сохраняет provenance и не связан с ревизией game save. `record_verified_credit` строго дедуплицирует namespace/source ID и проверяет весь payload, включая actor. Earned без принятой ветки отклоняется `accepted_branch_required`.

Backend операции: register_game, register_product, reprice_product, set_account_controls, set_game_economy, set_product_active, record_verified_credit. Доступ через привилегированный SQL в закрытой схеме; защищённый HTTP adapter ещё не реализован. Клиентский service key не нужен и запрещён. `record_verified_credit` сам не проверяет подпись провайдера: его должен вызывать доверенный backend после проверки подлинного события. Ни ad_completed, ни клиентский amount не являются основанием для начисления.

## Проверки

`node supabase/tests/db-agent-check.cjs`: непустой временный стенд, два аккаунта × две игры, профили/RLS, статистика, защита чужих данных, дедупликация результатов, корректность миллисекунд Clutter Cup, rollback. PASS.

`node supabase/tests/economy-check.cjs`: 11 групп PASS. Воспроизведены PUBLIC и Supabase public-schema defaults; проверены сами EXECUTE ACL, запрет прямых таблиц, выключенные gates, backend credits и конфликтный replay, третий nonscored game, покупка и восстановление receipt после repricing/disable/block, permanent ownership, внедрённая ошибка между debit и grant, queued competing requests, неизменяемость и баланс=ledger=remaining lots. Все фикстуры откатываются. Подробные результаты в ignored `output/db-agent-check.json` и `output/economy-check.json`.

Стенд PGlite PostgreSQL 18.3 использует одно сериализованное соединение. Queued requests проверяют решения и replay, но не настоящую конкуренцию блокировок нескольких соединений PostgreSQL 17. Такие тесты обязательны перед активацией spend. Публичный REST вызов с настоящей пользовательской сессией в этом ходе не проверялся; production проверки выполнены через SQL metadata/ACL.

У старого record_game_event сохранено известное поведение: уже существующий p_id возвращает success/no-op до проверки владельца сессии; изменённый payload под тем же ID явно не отклоняется. Чужие данные при этом не меняются. Этот analytics RPC нельзя считать строгим submissionId-протоколом сохранений или наград.

## Advisors и незавершённые части

После применения security advisors не обнаружил warnings для новых lpa_* RPC. INFO RLS enabled/no policy ожидаем для закрытых таблиц: доступ только через проверенные функции, прямые права отозваны. [Описание linter](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Остались прежние предупреждения публичных SECURITY DEFINER analytics RPC (guest compatibility) и [отключённая защита утёкших паролей](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Новые функции не открывают эти права. Не следует описывать весь проект как прошедший security audit без замечаний.

Перед продажами остаются: проверка конкуренции PostgreSQL 17; реальный провайдер и signature verification/inbox/reconciliation; refund/reversal/revocation; consumption; accepted-save/earned protocol; account admission и продуктовые условия. FK wallet→auth.users ON DELETE RESTRICT защищает историю, но даже нулевая wallet-строка блокирует удаление auth пользователя. Нужна согласованная retention/pseudonymization/deletion процедура до запуска соответствующего пользовательского удаления.

SMTP, Auth redirect URLs и email templates этим применением не настраивались. Сессия dashboard истекла; MCP SQL работал независимо. Экономический фундамент завершён в разрешённом выключенном состоянии. Это не готовая платёжная система и не облачные сохранения.

## Следующий этап: Crystal Front — оценка, не применённая миграция

Приоритет первого пилота: consumable grants + accepted branch, затем настоящий sandbox fulfillment. Наличие wallet/purchase не завершает монетизацию. Ниже имена новых операций предложены для согласования; в production их нет.

| Область | Что уже есть | Что реально отсутствует |
|---|---|---|
| Выдача бонуса | inventory_grants от покупки, immutable source_operation_id | единый idempotent grant command для non-store источников; строгий source/payload receipt; актуальный remaining inventory |
| Облачная ветка | ничего; analytics не заменяет save | read-state, submit-branch и lookup submission receipt; account/game revision, accepted snapshot, immutable submission/hash/status |
| Расход бонуса | immutable purchased grant | consumption ledger и grant allocations; стабильные consumption IDs; branch baseline/token; revocation/remaining projection |
| Игровой заработок | branchless earned явно запрещён | серверные правила/проверка accepted results; атомарный earned credit внутри принятой ветки |
| Rewarded ad | service-only primitive record_verified_credit | attempts с actor/policy/placement/expiry/nonce; signature adapter; durable inbox; source/attempt uniqueness; fulfillment и status |
| Платёж | service-only primitive record_verified_credit | server order/quote/intent и actor mapping; provider inbox/facts; обработка capture/refund/dispute; reconciliation и audited reversals |

Предложенный RPC-набор для save: `lpa_game_state(p_game_id)`, `lpa_submit_branch(p_game_id,p_submission_id,p_base_revision,p_build_id,p_schema_version,p_branch)`, `lpa_submission_status(p_game_id,p_submission_id)`. Actor только auth.uid(). Это проект контракта, а не существующий API. Submission lookup возвращает свой исходный receipt независимо от текущей revision.

Submit порядок: авторизация и allowlist build/schema; дедупликация immutable payload по actor/game/submissionId; единая согласованная последовательность locks для wallet/game state/provider source; блокировка game revision; сравнение baseRevision. Первая валидная транзакция с этой базой принимает ветку и увеличивает revision; вторая получает conflict без начисления, списания или изменения рейтинга. Invalid/unauthorized также не дают частичных side effects. Первый receipt закрепляется; retry accepted после следующей revision возвращает первоначальный результат. Иной payload с тем же ID — idempotency_conflict. Не переиспользовать reward candidates отвергнутой ветки через analytics или отдельный credit RPC.

У consumption отдельный стабильный ID, количество и allocation на grants, разрешённые исходным baseline/token ветки. Сервер не принимает абсолютный inventory count из snapshot и не использует свежие выдачи для покрытия недопустимого перерасхода старой ветки. После проверки доступных grants и revocations атомарно записывает consumptions, snapshot/revision, accepted results/earned credit и receipt. Не вызывать произвольно существующий credit primitive внутри branch без проверки порядка locks: он сам берёт advisory source lock и wallet lock. Нужен общий внутренний transaction helper без изменения модели доверия.

Ключевая приёмка: старт десять бомб; A расходует шесть, B три; пока оба офлайн, покупка выдаёт пять. Accepted A оставляет девять; conflict B ничего не списывает; retry A и старый absolute local count ничего не восстанавливают/не дублируют. Добавить revoked grant при офлайн-ветке, одинаковый consumption ID с разным payload, источник одной награды в разных submissions, crash между consumption и save, два настоящих PostgreSQL 17 соединения.

Для provider worker текущий sandbox ingress contract в server/monetization имеет проверку подписи и интерфейс inbox, но durable inbox отсутствует в БД. Нужны таблицы attempts/orders, verified inbox с immutable payload hash и provider/project/environment/eventId uniqueness, источник payment/reward независимо от eventId, processing receipts/retry/quarantine. Account и LPA units брать из сохранённого server intent/attempt/policy; signed event не разрешает доверять client/customData сумме или actor. В одной transaction fulfillment сопоставляет события, блокирует источник, начисляет один раз и фиксирует processing receipt. Callback после UI timeout/logout может быть законным; replay уже принятого source возвращает прежний receipt. Client complete и redirect не кредитуют.

Partial refund/refund-before-capture/dispute требуют отдельной согласованной модели фактов и reversal; `reversal_of` в ledger сам по себе её не реализует. Текущая FIFO allocation — фундаментальный прототип, а не утверждённая refund/funding priority policy (предложение earned/ad-first из требований ещё не реализовано). Сохранения не должны откатывать подтверждённые внешние выдачи.

Следующая реализация начинается локально, без включения live товаров или начислений. Перед Crystal Front gameplay integration требуется согласовать build/schema и inventory baseline с аудитом игры; перед provider sandbox — durable persistence adapter с агентом монетизации. Production gates остаются выключены.
