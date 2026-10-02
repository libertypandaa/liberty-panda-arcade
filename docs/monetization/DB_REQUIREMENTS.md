# Требования к БД и серверной экономике LPA

**2 октября 2026. Проект контракта для тимлида и агента БД. Не миграция, не существующий API.** Область MVP: одна общая игровая валюта, online spend, игровой заработок, verified rewarded video, разовые покупки, магазин бонусов/косметики. Подписки, cash balance, cash-out и player transfers исключены. Имена ниже логические; агент БД выбирает wire-schema и физическую модель после review.

Согласовать с [PLATFORM_SPEC](../PLATFORM_SPEC.md), [GAME_PLATFORM_CONTRACT](../GAME_PLATFORM_CONTRACT.md) и [MVP_PLAN](MVP_PLAN.md). [Live audit](../../supabase/LIVE_AUDIT_2026-10-02.md) не обнаружил кошелёк/сохранения в public. Пустая история миграций не разрешает повторять старую схему. Текущая задача не меняет БД и не даёт разрешения на production.

Актуальное поручение владельца: получатель дохода Израиль; команда может публиковать сайт и применять проверенные production изменения БД после тестов. Эта документационная задача сама БД/deployment не выполняет. Реальные payment/ad операции — после настройки провайдера. Для реализации ingress подготовлен [server/monetization](../../server/monetization/README.md): signature validators и durable inbox interface, без HTTP route/БД/выдачи. Агент БД должен реализовать атомарный `putVerified`, hash-conflict handling и отдельный fulfillment worker; подпись сама по себе не разрешает grant.

## Инварианты

1. Только доверенный сервер назначает accountId, количество/цену, источник и результат операции. Клиент не пишет баланс/ledger/grants/provider status напрямую.
2. Валюта — целое число минимальных игровых единиц с верхними пределами и защитой overflow. Денежные суммы отдельно: minor units + ISO currency, не float и не общий реальный баланс игрока.
3. Ledger append-only; ошибки, refund и chargeback создают компенсации со ссылкой на оригинал. Snapshot игры не содержит авторитетного кошелька или права собственности.
4. Дедупликация не ограничена HTTP event ID: один экономический источник даёт одну выдачу; повтор возвращает прежний receipt. Тот же idempotency key с иным payload отклоняется.
5. Покупки и подтверждённые ad rewards независимы от game save revision. Конфликт ветки не удаляет их. Игровая награда и расход локальных бонусов применяются только вместе с принятой веткой.
6. Конкурентные расходы не приводят к отрицательному spendable balance или двойной выдаче. Purchase/refund/branch transactions согласуют блокировки в едином порядке.
7. Историю нельзя каскадно удалить с auth user: политика удаления/псевдонимизации и срок законного финансового хранения требуют отдельного решения.

## Логические сущности

| Сущность | Минимальные данные / ограничения |
|---|---|
| Wallet account | accountId, currencyCode, projection/version, status, spendable units; баланс сверяется с журналом |
| Economic operation / ledger entries | operationId, accountId, signed units, sourceKind/sourceId, occurred/recorded timestamps, policyVersion, reversalOf, reason; уникальный source key в provider/project/environment namespace |
| Credit lots + allocations | Paid/earned/ad provenance, original grant, credited/remaining/reversed units; расход связывается с исходными lots. Это одна валюта в UX, отдельное происхождение для возврата |
| Catalog / price version | productId, gameId, item/currency package, quantity, active/region/age eligibility, immutable priceVersion; клиентские цены не принимаются |
| Store order / spend receipt | accountId + requestId, request hash, server quote/product version, debit operation, fulfillment, status; атомарно debit + grant + receipt |
| External purchase | purchaseId/orderId, accountId, provider/project/environment, providerPaymentId, SKU/version/units, fiat amount/currency, captured/refunded totals, dispute state, reconciliation state; unique payment ID |
| Provider event inbox | provider namespace + event ID (или документированный stable key), authenticated raw payload hash, type, occurred/received timestamps, processing attempts/state; секреты/карточные данные не сохранять |
| Outbox / reconciliation job | durable task ID, operation reference, retry state; external calls не держат SQL lock |
| Reward attempt | attemptId, accountId, placement/game/build, server reward policy/version/units, issued/expires timestamps, signed-context mapping, pending/verified/granted/rejected state |
| Verified ad event | provider transaction/reward ID, attemptId, signature verification result/version, event hash, economic operation; unique provider reward ID и unique fulfilled attempt |
| Game submission / reward candidate | accountId/gameId/submissionId, payload hash, baseRevision, result, branch status; candidateId/ruleVersion/units до валидации не баланс |
| Inventory grants / entitlement | grantId, accountId, gameId/itemId, quantity/permanent right, source operation, status; stable уникальная связь на fulfillment |
| Inventory consumption | accepted submission + consumptionId + item/quantity + grant allocations; отдельный журнал, snapshot не восстанавливает spent items |
| Administrative audit | actor server role, action/reason, target, before/after references, timestamp; debug grant разрешён только тестовой среде |

Для постоянной косметики unique ownership на accountId/gameId/itemId; повторная покупка уже принадлежащего предмета не списывает деньги/валюту. Правила нескольких источников одного entitlement должны быть явными: отзыв одного grant не отнимает право, если остался другой действующий grant.

## Предлагаемые операции

| Операция | Вход / результат |
|---|---|
| readWallet/history/inventory | Текущий actor; walletVersion и authoritative balances/grants; pagination |
| buyStoreProduct | productId, quote/version, requestId; серверная price check; receipt либо price_changed/insufficient/blocked |
| createCheckout / getPurchaseStatus | packageId, requestId; opaque order и hosted URL; pending/confirmed/refunded/disputed |
| createRewardAttempt / getRewardStatus | Разрешённый placement; server offer/attempt; no-fill не создаёт кредит |
| submitGameBranch | submissionId, baseRevision, snapshot, results/candidates/consumptions; accepted/conflict/invalid и прежний receipt для повтора |
| ingestVerifiedProviderEvent | Только внутренний обработчик после криптографической проверки; durable inbox receipt |
| applyRefund / reconcile | Только сервер/авторизованная служба; provider refund ID, cumulatives, audited compensation |

Не принимать userId клиента как владельца; не передавать service_role, provider secret, платёжные реквизиты или Auth tokens игре/postMessage/URL. Внешний webhook аутентифицируется подписью провайдера, не JWT игрока. Его публичная доступность не даёт доступа к internal fulfillment RPC.

## Атомарность и повторяемость

**Spend:** проверить текущего actor, eligibility, quote, idempotency record и request hash; заблокировать wallet/projection; проверить доступные units; распределить debit по lots; добавить ledger, inventory grant и receipt; commit. Ошибка любого шага откатывает всё. Два одновременных запроса на последние units не могут оба пройти. Повтор после потери ответа не покупает второй экземпляр.

**External credit:** signature проверяется до допуска в доверенный поток. Durable inbox + retry processing; в transaction заблокировать purchase/attempt и wallet, проверить economic source unique, добавить credit lot/ledger/grant и receipt, завершить fulfillment. Возможны разные события одного payment — все сходятся к одной выдаче. ACK после долговечной записи; ошибка обработки остаётся в retry queue и видна оператору. Test/live namespace и ключи разделены.

**Provider calls:** SQL и внешняя сеть не образуют общую транзакцию. Сначала durable intent, затем вызов с тем же provider idempotency key, затем фиксация результата. При timeout выполнять lookup/reconciliation, не слепо повторять с новым ID. Подписанный webhook может прийти раньше ответа создания — разрешить безопасную корреляцию с intent. Неизвестное событие quarantine, без кредита.

Состояния не перезаписывать простым last-arrival-wins: вести факты capture/refund/dispute и допустимые переходы. Refund до payment создаёт tombstone/pending reversal; последующий capture не даёт чистую положительную выдачу уже возвращённой покупки. Partial refund использует cumulative refunded amount и stable refund IDs; отменённый/неуспешный refund не считается выполненным. Проверять provider API при неоднозначности.

## Verified advertising reward

Клиентский ad_completed/complete — UI сигнал «ожидает подтверждения». Для durable reward нужны signature, stable provider reward ID и связь с серверной попыткой, а сумма берётся из сохранённой policy. Rate limits применяются серверно к созданию attempts и выдачам; ограничения multi-account/fraud требуют отдельной политики, fingerprinting не добавлять.

Особенность кандидата AppLixir: [HTML5 S2S guide](https://support.applixir.com/applixir-integration/integration-for-html5-sites-apps/step-4-setting-up-local-callback-360053188774) описывает MD5 + TID; customData не покрыта подписью. В адаптере не доверять ей для аккаунта, суммы или placement. Проверить разрешённую привязку attempt через подписанный userId/непрозрачный nonce; хранить серверное отображение. Один tid и одна attempt не могут дать два кредита. Запретить secretKey/query попадать в access logs. Поздний валидный callback сверять по issued-at/политике и провайдеру; UI timeout сам по себе не уничтожает заслуженную награду. Replay уже принятого tid — no-op даже после expiry. Формат verification и expiry окончательно утвердить после провайдерского ответа.

Confirmed reward не откатывать из-за conflict save; fraud reversal — только отдельная доверенная корректировка с доказательством/аудитом, не по сообщению клиента. No-fill, skip, consent decline, error не дают кредит и не блокируют игру.

## Сохранения, bonus grants и два офлайн-устройства

В одной transaction submitGameBranch: сначала найти submission receipt/hash, затем lock account/game revision; сравнить baseRevision; проверить build/schema, results, candidates и consumptions. Только accepted branch меняет snapshot/revision, рейтинг, игровой кредит и inventory consumption. Conflict/invalid не меняют экономику. Повтор accepted submission возвращает прежний receipt даже после роста revision. Нельзя «перебазировать» отвергнутые reward IDs и прислать их отдельно.

Inventory хранится независимо: grants − accepted consumption − authoritative revocations. При отправке ветки **не принимать абсолютное количество предметов из snapshot**. Snapshot/grant cursor нужен игре для отображения; сервер не выдаёт grant повторно на основании отсутствующего курсора. Каждый consumption имеет стабильный ID и допустимое распределение по grants, известным ветке; внешние новые grants не должны случайно оплачивать недопустимый перерасход старой ветки. Конкретный baseline/token контракта инвентаря согласовать с агентами игр.

Пример: revision 1, десять бомб. A и B уходят офлайн. A тратит шесть; B тратит три. Пока они офлайн, сервер выдаёт пять бомб через онлайн-покупку другого устройства. Accepted A фиксирует расход шесть и оставляет **девять**; B получает conflict и ничего не списывает. Новые пять не исчезают и не прибавляются повторно. Следующее сохранение A с устаревшим local count не восстанавливает десять. Для revoked grant во время офлайна принятая ветка должна пройти проверку текущих доступных прав; при невозможном расходе вернуть invalid/reconciliation_required, без частичного рейтинга/наград. Этот UX требует согласования.

## Возвраты и chargeback: предложенная политика, ещё не утверждена

Предлагается происхождение paid lots сохранять при едином балансе, расходовать earned/ad сначала, затем paid FIFO; это реализационное предложение для review. Возврат конкретного paid lot отзывает его неиспользованный остаток. Chargeback hold и финальный reversal разделить: hold блокирует спорный доступный остаток, окончательный проигранный спор компенсирует; выигранный снимает hold, не создаёт второй grant.

Если refunded paid units уже потрачены: не делать обычный spendable отрицательным и не списывать случайно unrelated earned/ad grants. Создать отдельный **unresolved reversal в игровых единицах**, ограничить новые расходы экономики до решения и показать поддержку. Это не денежный долг пользователя и не обещание взыскания. Возможное снятие связанного entitlement/неиспользованных бонусов выполняется отдельной audited компенсацией, с защитой от двойного изъятия. Не переписывать принятый save/рейтинг; правила уже использованных бонусов решает владелец. Не включать автоматическое покрытие остатка будущими наградами без согласованной политики.

Partial refund: сохранить paid money/unit ratio и исходный пакет, согласовать округление и возврат бонусных units; cumulative reversal не превышает исходную выдачу. До утверждения formula неоднозначные случаи идут в manual review. Reinstatement после выигранного спора ссылается на reversal и восстанавливает только реально отозванные права/units. Не запрещать законный возврат только потому, что currency spent; eligibility возврата определяется применимыми правами и провайдером, модель БД лишь исполняет результат.

## Доступ и эксплуатация

Игрок видит только свою историю, pending attempts и инвентарь. Privileged write handlers закрыты клиентским ролям; операции игрока проходят контролируемые серверные функции. RLS плюс минимальные grants для exposed таблиц; безопасные views. Администратор назначается серверно, не user_metadata. Финансовые журналы и provider payloads в закрытой схеме; service secret только серверно. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [server secrets](https://supabase.com/docs/guides/functions/secrets). Документация проверена; changelog.md web-fetch вернул unsupported content-type, актуальные breaking changes нужно сверить при реализации.

Нужны reconciliation dashboards: stuck orders/attempts, inbox retries/dead-letter, unmatched provider records, сумма ledger vs projection, provider gross/refunds/fees/payout отдельно от units игрока. Доступ оператора/корректировки журналировать. Резервные копии и restore сверять с провайдером: восстановление старой БД может забыть обработанный tid/payment; повторная сверка должна вернуть записи, не платить/выдавать второй раз. Возвраты и webhooks продолжают обрабатываться при kill switch новых продаж.

## Приёмка будущей реализации

- Два конкурентных spend, insufficient funds, crash между debit/grant, повтор с изменённым телом; wallet и инвентарь сходятся.
- Дубликаты event ID и разные event ID одного payment; неверная signature/project/live-test/amount; redirect без webhook не кредитует.
- Callback до client complete, после logout/смены аккаунта/expiry; replay tid, подмена customData, no-fill и два показа одной attempt.
- Refund до capture, multiple partial refunds, duplicate refund, dispute won/lost, rollback после processing failure; ни resurrection, ни двойного отзыва.
- Два submission от одной revision; retry принятого после следующей revision; кандидат отвергнутой ветки не начисляется через analytics/API отдельно.
- Новая выдача на другом устройстве во время офлайна, repeated grant delivery, accepted/rejected consumptions, revoked entitlement; confirmed purchase/ad survives conflict.
- anon и два разных authenticated пользователя не читают/не меняют чужие данные и не вызывают internal grants; stale/blocked account проверяется сервером.
- Durable retry/reconciliation после outage/restore; финансовые ID не забываются, provider secrets не попадают в логи.

Результат агента БД для тимлида: выбранная схема/constraints/lock order, функции и минимальные privileges, согласованный inventory baseline, fixtures/test evidence, список нерешённых refund/provider условий и план новой миграции. Никаких объявлений «готово в production» по наличию SQL.
