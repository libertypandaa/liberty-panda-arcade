# Review: account-scoped saves Crystal Front

2 октября 2026. Scope: согласование этапа А (локальные сохранения) и проект этапа Б (cloud/accepted consumption). Новые миграции не применялись. Код игры/SDK/host этим review не изменён. Crystal Front gameId: `crystal-front-demo`. Реальные продажи, ad credits и продажа бомб остаются OFF.

## Решение для этапа А

Согласовано со стороны БД: этап А не требует server namespace RPC или новой таблицы. Namespace — непривилегированный адрес локального хранилища, не proof of auth, не entitlement и не источник серверного actor. Host получает actor из своего проверенного Auth-контекста, выбирает gameId из разрешённого launch registry и вычисляет устойчивое отображение. Игра получает только namespace и непривилегированный lifecycle context; токены, UUID actor, email, Auth session ID и service key ей не передаются. `contextSessionId` — отдельный случайный lifecycle identifier, не Auth session ID или credential.

Единственный нормативный источник формулы и wire: [ACCOUNT_CONTEXT_CONTRACT.md](../docs/ACCOUNT_CONTEXT_CONTRACT.md), сверенный с окончательным host/SDK контрактом. Этот review не является вторым нормативным документом. Ниже воспроизведена эта формула; прежний альтернативный пример удалён. Namespace ещё не является доказательством публикации SDK.

```text
input = UTF8(JSON.stringify([
  "lpa-storage-v1",
  new URL(LIBERTY_PANDA_AUTH_CONFIG.supabaseUrl).origin,
  verifiedActorUUID.toLowerCase(),
  gameId
]))
storageNamespace = "lpa:save:v1:" + lowercaseHex(SHA256(input))
```

Это host алгоритм этапа А, не deployed server API. UUID проверяется, gameId берётся из host registry, не из сообщения iframe. У алгоритма нет секрета: hash лишь убирает прямой идентификатор из wire/ключа. Namespace можно скопировать/подделать; он не предоставляет серверных прав и не является надёжной анонимизацией. Общий origin/localStorage не изолирует враждебные игры; namespace решает случайное смешивание аккаунтов для собственных доверенных сборок.

Для одного account+game+project namespace сохраняется между reload, token refresh и повторным входом A. Для другого actor/game/project отличается. Не включать launchId, generation, access token, случайный session nonce или buildId в hash: они разрушат устойчивость. Namespace algorithm version фиксируется; смена версии требует явной миграции локальных ключей, не silent reset. Игровая schemaVersion живёт в save envelope/суффиксе ключа, отдельно от namespace.

Минимальный источник verified actor: host использует `auth.getUser()` и успешный server-confirmed user.id, либо уже существующий проверенный механизм identity. Raw getSession().user или декодированный без verification JWT не называть server-verified. `getUser` делает запрос к Auth и подтверждает текущую user record; [документация](https://supabase.com/docs/reference/javascript/auth-getuser). `getSession` читает локальное session storage и само по себе не является такой проверкой; [документация](https://supabase.com/docs/reference/javascript/auth-getsession). Новый Auth/backend endpoint для namespace не нужен. Не требовать wallet/catalog/economy consent для получения локального контекста; чтение namespace не создаёт wallet row.

До завершения identity verification контекст не ready. Сеть/verification error означает unknown, не отсутствие save, нового пользователя или нулевой прогресс. Hard expiry даёт expired. Hard expiry, rejected verification и identity mismatch инвалидируют предыдущий контекст и меняют epoch + contextSessionId. Если уже установленный in-memory verified context допускается до локально известного истечения действующей сессии, это только host cache policy; после expiry/logout/identity uncertainty он отзывается. Перезапуск offline с одним неподтверждённым localStorage user не выдаёт новый verified ready. Namespace не может гарантировать удалённую revocation detection офлайн.

## Host/SDK wire этапа А

```typescript
type AccountContextWire = {
  status: 'ready' | 'absent' | 'expired' | 'changed' | 'unknown';
  reason: string;
  gameId: string;
  storageNamespace: string | null;
  expiresAt: number | null;
  epoch: number;
  contextSessionId: string;
};
```

Envelope сообщения `lpa:account:request/response/changed` использует protocol:1, contextVersion:1, launchId и requestId для request/response correlation; context находится внутри response/changed. Точные поля каждого envelope и причины — в нормативном документе выше. SDK 1.1.0: getAccountContext, onAccountContextChange, accountContext, isAccountContextCurrent. SDK может добавлять локальную generation к wire context. Далее generation означает lifecycle fence SDK, а не отдельное обязательное wire поле. Epoch/contextSessionId и launchId предотвращают возврат старого контекста. Они не credentials. Namespace и expiresAt ненулевые только при ready; expiresAt — deadline, не токен. До проверки actor и async hash SDK остаётся unknown, не guest save context.

| Status | Значение | Действие игры |
|---|---|---|
| ready | подтверждён текущий account/game context | открыть ровно его локальный ключ, затем разрешить чтение/запись |
| absent | host подтверждает отсутствие signed-in account | остановить scoped writes; не использовать legacy как fallback аккаунта |
| expired | истёк ранее действовавший контекст | остановить scoped writes, предложить восстановить вход; не reset storage |
| changed | старый контекст отозван при смене actor/game/launch | отменить старые операции, очистить только in-memory отображение; ожидать новый ready |
| unknown | identity ещё не проверена или verification недоступна | остановить scoped writes; не объявлять save отсутствующим |

Absent/expired/changed/unknown описывают Auth context, не наличие локального save. При ready отсутствие ключа — нормальный новый save данного аккаунта; malformed/quota/access errors — отдельные storage errors, не разрешение затереть старые данные. Игровой код различает «нет ключа» и «контекст недоступен».

Host инвалидирует старую generation синхронно при logout, переходе/неопределённости аккаунта или смене launch; pending verification/hash/response проверяет ticket до публикации. Переход A(g1)→B(g2)→A(g3) возвращает тот же namespace A, но g3 != g1. Старый async save/read/exit callback g1 не принимается, даже если actor/namespace снова совпал. Просто сравнивать UUID недостаточно. Повторная конфигурация старого launchId также отвергается.

Каждая save операция захватывает `{launchId, gameId, generation, storageNamespace}` до начала и проверяет тот же ready context непосредственно перед записью/применением результата. Для localStorage запись синхронна после проверки; не вставлять await между fence и setItem. Для IndexedDB операции отменяются/не ставятся в очередь при invalidation, а результаты проверяются перед изменением UI. Нельзя брать новый namespace в конце старого async callback. Вкладки согласуют auth invalidation через host Auth events/межвкладочные события; одна вкладка не продолжает пользоваться отозванным контекстом, пока другая переключила аккаунт.

После changed/expired старый dirty snapshot не переприсваивается новому account и не выгружается при позднем pagehide в новый ключ. При желании сохранить незаписанный snapshot его можно временно держать в памяти с исходным context для отдельного UX; автоматическая запись после invalidation запрещена. Same-actor token refresh может сохранять generation лишь при непрерывно подтверждённом ready контексте; восстановление после expired выдаёт новую generation.

`crystalFrontProgressV1` оставить без удаления, перезаписи, импорта или автоматического назначения текущему actor. Account keys использовать отдельно, например `${storageNamespace}:crystalFrontProgress:v1`, с validated save schema. Legacy данные не являются доказательством владельца. Local Rays, рейтинги и бонусы остаются локальными игровыми значениями: не записывать их в wallet/grants/серверный рейтинг и не выдавать LPA по analytics.

## Implemented / planned / blockers

Read-only SQL review выполнен по production объектам public/lpa_api/lpa_private. Namespace, game state, submissions, accepted branch и consumption функций/таблиц нет. Список новых public RPC по-прежнему: lpa_games, lpa_wallet, lpa_catalog, lpa_inventory, lpa_purchase, lpa_purchase_status, lpa_capabilities; у обеих игр economy_enabled=false. Существующая capabilities сообщает cloudSaves=false/providers=false.

| Функция | Состояние |
|---|---|
| Серверный namespace API | отсутствует; этапу А не требуется |
| Account local context и generation fence | planned, реализует SDK/host агент; этим review не объявляется completed |
| Actor/game-scoped локальный save | planned, реализует игровой агент после SDK контракта |
| Durable purchased grants / permanent entitlement | implemented в БД; экономические gates выключены |
| lpa_inventory | implemented: immutable grants, без consumption/revocation/remaining balance |
| Cloud state / submission receipt / first accepted wins | отсутствуют |
| Accepted-branch consumption / earned / validated rating | отсутствуют |
| Verified provider inbox / fulfillment / refunds | отсутствуют; trusted credit primitive не является provider integration |

Blockers этапа А: host verified identity source и lifecycle; согласованный SDK wire; игра должна ждать ready, проверять generation, разнести ключи и сохранить legacy; проверки logout/expiry/A→B→A/multitab/storage failure. SQL не blocker. При shared origin невозможно обещать защиту local saves от намеренной модификации другим same-origin кодом или пользователем.

## Этап Б: exact proposal, не implemented API

До конкретного согласования миграции live не применять. Actor всегда auth.uid() либо identity проверенного backend; storageNamespace не передаётся как основание авторизации. GameId проверяется реестром и допустимым build/schema. Предлагаемые public RPC:

```text
lpa_game_state(p_game_id text)
  -> {gameId, revision, schemaVersion, buildId, snapshot|null,
      inventory:{baselineId, grants:[{id,itemId,kind,remaining}]}}

lpa_submit_branch(p_game_id text, p_submission_id uuid,
                  p_base_revision bigint, p_build_id text,
                  p_schema_version integer, p_branch jsonb)
  p_branch = {inventoryBaselineId, snapshot,
              results:[...validated game-specific results...],
              rewardCandidates:[{candidateId,ruleVersion,...evidence}],
              consumptions:[{consumptionId,itemId,quantity,
                             allocations:[{grantId,quantity}]}]}
  -> BranchReceipt

lpa_submission_status(p_game_id text, p_submission_id uuid)
  -> BranchReceipt|null

BranchReceipt = {submissionId,gameId,baseRevision,
                 status:'accepted'|'conflict'|'invalid',
                 revision, reasonCode|null}
```

Read-state даёт revision=0/snapshot=null для отсутствующей облачной ветки; это реальный ответ сервера, не fallback при missing RPC. BaselineId — серверный immutable inventory baseline, привязанный к actor/game/revision и известным grants; namespace этапа А им не является. Серверные accepted result/reward rules и build/schema allowlist ещё должны быть специфицированы агентом игры. Указанные структуры — предлагаемый wire contract; нельзя уже вызывать их из production как существующие.

Hash канонического validated payload закрепляется под уникальным `(actor,gameId,submissionId)` и включает все поля baseRevision/build/schema/baseline/snapshot/results/candidates/consumptions. Replay ищется до сравнения текущей revision: тот же payload возвращает прежний receipt, другой — idempotency_conflict. Receipt conflict/invalid сохраняется неизменным без игровых/экономических side effects; unauthorized не раскрывает чужие receipts. Transport failure не означает conflict; lookup/retry исходного ID и тела. Receipt.revision — revision при первоначальном решении, не обещание актуального состояния: затем get-state.

В транзакции serialise `(actor,gameId)` state и необходимые wallet/inventory locks с единой lock order всех писателей. Проверить baseRevision, валидность snapshot/results/consumption baseline/current unrevoked grants. Первая валидная полностью committed ветка с данной baseRevision становится accepted и увеличивает revision на один. Вторая с той же baseRevision получает conflict. Невалидная или откатившаяся транзакция revision не занимает. Только accepted атомарно меняет snapshot, consumption ledger/allocations, validated results/rating, earned credit и receipt. Winning определяется успешным commit под блокировкой, не клиентским временем/скоростью доставки.

Consumption имеет отдельный стабильный ID и строгую immutable payload дедупликацию; повтор accepted submission не списывает снова. Не принимать absolute item quantities из snapshot и не перераспределять перерасход старой ветки на grants, выданные позже её baseline. Внешние paid/ad grants сохраняются независимо от save conflict. Пример приёмки: было 10 бомб; A тратит 6, B 3; online-покупка даёт 5; accepted A оставляет 9, losing B не списывает, replay A ничего не меняет. Revocation во время офлайн-ветки требует invalid/reconciliation_required и полного rollback, если заявленный расход уже невозможен.

Losing branch не начисляет reward/rating и не расходует grants. Candidate IDs отклонённой ветки нельзя переносить в новый submission/отдельный credit call после простого изменения baseRevision. Для этого нужны provenance rules и accepted result/candidate uniqueness, а не только уникальный submissionId. Старый record_game_event — аналитика и не строгий save/reward submission протокол.

Отсутствующие физические сущности: account/game state+revision; immutable submissions/receipts/hash; inventory baselines+known grants; consumption ledger+allocations+remaining projection; authoritative revocations; accepted results/reward rules/source uniqueness; validated rating projection. Отдельно для будущего external fulfillment: server-owned attempts/orders/policies; signature adapters; durable provider inbox/facts/processing receipts; reconciliation/reversal. Нельзя собрать production этап Б из одного текущего lpa_inventory и клиентского local count.

## Рекомендация game_onboarding и приёмка

В паспорте/документации игры разделять `accountLocalSave` и `cloudSave/acceptedConsumption/serverRewards`. Для Crystal Front этап А заявлять только после integration tests; этап Б false/planned. Local bonuses не отображать как купленные серверные grants. Registered game не означает cloud-ready или продажи.

Обязательная проверка этапа А: A reload восстанавливает только A; B первый вход не видит A; A→B→A сохраняет стабильный namespace и отклоняет callback первой generation; delayed verification/hash не публикует старый ready; logout/expiry/pagehide не пишут новым actor; другая игра имеет другой namespace; legacy ключ неизменён; storage missing/corrupt/quota разделены; game messages содержат ноль credentials; offline-unverified старт не становится server-confirmed; multitab switch отзывает stale writes.

Этап Б перед включением: независимые соединения PostgreSQL 17 с одной baseRevision; accepted retry после роста revision; changed payload; crash между consumption и save/credit; revoked grants; competing purchase/branch; reward candidate losing branch; provider duplicate/different events same source. Эти проверки отсутствуют и не заменяются PGlite queued requests.

Итог review: этап А разрешено строить без БД изменений по непривилегированному устойчивому namespace и отдельной generation. Этап Б согласован концептуально как atomic accepted branch, но контракты game results/inventory baseline, реализация и live применение остаются отдельным этапом. Данный документ не разрешает включать live товары, начисления или серверные рейтинги.
