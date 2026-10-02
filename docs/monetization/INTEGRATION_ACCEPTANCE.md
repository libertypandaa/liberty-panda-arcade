# Приёмка монетизации и игровых интеграций

Дата: **2 октября 2026**. Проект для немедленной разработки. Страна получателя **Израиль**, провайдер пока не настроен; РФ — возможная страна аудитории. Реальный баланс денег игрока не вводится. Ниже «доступно» означает разрешённую текущим поручением работу, а не работающий production функционал. Все игры и браузерные callbacks недоверенные. MVP без подписки, переводов и вывода; reward только по доверенной серверной проверке либо из принятой/валидированной игровой ветки.

Основной контракт: [DB_REQUIREMENTS](DB_REQUIREMENTS.md). Обоснования провайдеров и вопросы владельцу: [MVP_PLAN](MVP_PLAN.md). Агент монетизации пишет только docs/monetization; реализацию кода/БД выполняют соответствующие агенты в своей разрешённой области.

## Матрица работы и допуска

| Возможность | Текущая доступность | Условие / требуемое решение |
|---|---|---|
| Provider-neutral ledger, каталог и online spend | Доступно для локальной реализации агенту БД | Закрытые записи; цены/награды тестовые; production не менять |
| Inventory grants, cosmetics, consumptions | Доступно для локальной реализации | Независимость от save; server entitlement, stable IDs |
| First accepted save и candidates | Доступно для локального контракта/фикстур | Валидатор каждой игры; analytics не источник денег |
| Моки payment/reward и failure UX | Доступно локально | Явно test, без внешних аккаунтов/реальных средств |
| Webhook inbox/outbox и generic verifier interface | Доступно локально | Generic fake signature не считать приёмкой настоящего provider |
| Баланс и история игровой валюты | Доступно для локальной реализации | Не изображать денежный счёт; unknown/pending отдельно от spendable |
| Game-earned credit в production | Требует приёмки и разрешения выпуска | Accepted branch + rule validation/лимиты, возрастный сценарий |
| External sandbox account/SDK configuration | Требует approval/выбранного доступа | Текущая задача запрещает регистрацию внешних сервисов; доступ предоставляет владелец по согласованию |
| Xsolla/Paddle real checkout | Требует выбора и provider approval | Реальная страна/форма деятельности, KYC, банк, общая валюта нескольких игр, договор, возвраты |
| AppLixir live web video | Требует provider approval и технической приёмки | Traffic eligibility, территории/банк, signed attempt mapping, MD5+TID, PWA/iframe, возраст/consent |
| Google GAM web → постоянная награда | Недоступно при текущих требованиях | Документация исключает web SSV; client event не удовлетворяет контракту |
| Google H5 → постоянная награда | Не подтверждено, выключено | Нужен документированный проверяемый серверный механизм, H5 approval |
| Stripe для известных стран владельца | Недоступно как текущий выбор | Израиль/РФ не перечислены в global merchant list; счёт не заменяет eligibility |
| Возраст unknown / неподтверждённый child flow → реклама/платёж | Выключено до решения | Не считать Google login доказательством возраста; gate не заменяет правовую оценку аккаунта |
| Реальные цены/пакеты/limits/refund policy | Требует решения владельца | Независимый технический каркас готовить сейчас |
| Production migration/публикация сайта | Разрешено команде после тестов | Документационный исполнитель не выполняет deployment; реальные payments/ads только после настройки провайдера |
| Баннеры, принудительные interstitial, подписки, cash-out, transfers | Недоступно в MVP | Вне принятого scope |

## Что агент БД может начать немедленно

1. Зафиксировать единицы валюты и safe integer limits; реализовать append-only ledger, источник/уникальность, balance projection, atomic store debit + grant + receipt.
2. Добавить server-owned catalog versions, test prices и ownership checks. Игрок запрашивает SKU, не отправляет доверенную цену/количество/аккаунт получателя.
3. Реализовать paid/earned/ad provenance и reversal references без выбора денежного провайдера. Конкретные partial refund ratios пока policy hook/manual review.
4. Подготовить внутренние applyVerifiedPayment/applyVerifiedReward: вызываются только серверным адаптером, не публичным RPC игрока. Test fixtures используют отдельный environment.
5. Связать rewards/consumption с accepted submission; запретить произвольные credits через matchEnd. Согласовать inventory baseline с агентами игр.
6. Создать capability response с причинами unavailable (offline, no_auth, age_policy_pending, region_unsupported, provider_disabled, no_fill, economy_hold). Проверки повторяются сервером; UI-флаг не право доступа.

Физическая схема и API утверждаются тимлидом/агентом БД; приведённые названия не предписывают выдуманные методы в опубликованном SDK.

## Приёмка реального платёжного провайдера

| Проверка | Доказательство готовности |
|---|---|
| Получатель и страна | Письменный допуск конкретного legal payee, реального места деятельности и банка; проверены РФ/Израиль как реальные варианты, без обещаний обхода |
| Товар и MoR | Одобрены разовые пакеты общей валюты собственных игр; подтверждено, кто продавец, кто обрабатывает buyer taxes/refunds/disputes |
| Buyer coverage | Список разрешённых стран/методов/валют; checkout не обещает оплату неподдерживаемым покупателям |
| Экономика | Утверждены fees/reserve/payout thresholds/schedule, денежные цены, локализация и real-price display; sandbox цифры не переносятся незаметно |
| Create timeout | Один durable intent и один provider key; после неизвестного исхода lookup/retry не создают две покупки |
| Подпись | Реальный SDK/спецификация проверяют raw payload/header; bad signature, modified body, wrong project и test/live mismatch не кредитуют |
| Order binding | Доверенный order закреплён за account; чужой account, изменённая сумма/ISO currency/SKU/quantity отклоняются или quarantine |
| Fulfillment | Только признанный final paid статус даёт credit; redirect/client success сами не меняют баланс |
| Повторы | Повтор event и разные события одного transaction дают одну выдачу; webhook раньше create response безопасно коррелируется |
| Ошибки | Crash до/после durable inbox/credit, retry/dead-letter, поздний callback; receipt повторяем, lost response не теряет покупку |
| Refund/dispute | Refund-before-payment, duplicates, partial/cumulative refunds, dispute hold/won/lost проверены реальными sandbox event types |
| Сверка | API/report восстанавливает missed events; gross/refunds/fees/net payout сходятся отдельно от игровых units |
| Секреты и support | Нет card data/secret в frontend/logs; support видит order receipt и state, audited manual corrections |

Минимальные проверенные основания: [Xsolla webhooks](https://developers.xsolla.com/webhooks/payments), [Xsolla sandbox](https://developers.xsolla.com/dev-resources/testing/general-info/), [Paddle event model](https://developer.paddle.com/webhooks/about/how-webhooks-work/). Точные event names и методы сверки фиксируются после выбора адаптера; общая таблица не заменяет provider-specific implementation review.

## Приёмка server-verified rewarded video

1. Получить подтверждение **web/PWA**, а не native SDK: standalone Android Chrome, iOS Safari, browser и iframe. Проверить video-only, добровольный выбор и доступ к обычной игре после отказа/ошибки/no-fill.
2. Зафиксировать server-side proof schema, signed fields, unique transaction ID, правила reward completion и retry/reconciliation. Клиентский `complete` не proof.
3. Проверить связь attempt → signed provider context → account. Для AppLixir customData не подписана: её подмена не меняет reward/account; допустимость nonce в userId письменно согласована. Повтор tid/attempt не начисляет второй раз.
4. Сервер фиксирует reward units/policy перед показом; браузер не меняет reward quantity. Отказ, cancel, skip, no fill, partial view и consent decline не дают постоянной награды.
5. Callback раньше/позже client event, закрытие PWA, offline после видео, logout/смена account: награда остаётся исходному account, pending не расходуется, заслуженная поздняя награда не теряется только из-за UI timeout.
6. Установить signature verifier и redaction GET query для AppLixir; тест неверного секрета/TID/подписанного userId. Не использовать plaintext secret-only mode в production.
7. Проверить caps/concurrent attempts серверно; geo/age/consent restrictions не обходятся изменением browser payload. Fraud reversal отдельный от save rollback.
8. Reconcile provider reward IDs и persistent grants; revenue eligibility не приравнивать к full completion. Получить согласованные сроки выплат и допуск банка/получателя.

Основания: [AppLixir HTML5 S2S](https://support.applixir.com/applixir-integration/integration-for-html5-sites-apps/step-4-setting-up-local-callback-360053188774), [GAM: SSV app-only](https://support.google.com/admanager/answer/9116812?hl=en). До прохождения проверок capability `rewardedVideo` выключена.

## Приёмка недоверенной игры

| Сценарий | Ожидаемое поведение |
|---|---|
| Изменить client balance/price/grant/age/region | Не меняет серверную экономику или eligibility |
| Послать ad_completed/payment_success/matchEnd вручную | Не создаёт доверенный credit |
| Подменить gameId/account/origin/source/launchId в iframe | Запрос отвергается; секреты не выдаются игре |
| Два устройства с одной baseRevision | Только одна допустимая ветка увеличивает revision и даёт результат/earned credit/consumption |
| Отклонённая ветка повторяет reward отдельно | Нельзя обойти conflict через другой endpoint/analytics |
| Повтор accepted submission после новой revision | Возвращается старый receipt без новой награды |
| Онлайн-покупка/verified ad во время офлайн-ветки | Не теряются при conflict или старом snapshot |
| Inventory: 10, A тратит 6, B тратит 3, новая выдача 5 | После accepted A остаётся 9; rejected B не списывает; grant не дублируется |
| Косметика уже принадлежит игроку | Повторный store request не списывает валюту |
| Revocation while offline | Текущие серверные права проверяются до принятия; невозможный расход не даёт частичного рейтинга/награды |
| Auth истёк/сменился/аккаунт блокирован | Локальный прогресс сохраняется, online spend закрыт; очередь не отправляется чужому account |
| Consent analytics выключен | Обязательные save/economy работают независимо; рекламное согласие обрабатывается отдельно |

Для earned currency валидатор JSON и revision защищают структуру/конкуренцию, но не доказывают честное прохождение игры. Нужны серверные reward rules, стабильные match/achievement IDs, caps, plausibility checks; где доказать результат невозможно, явно утвердить ограниченный fraud risk и награды. Клиентский секрет/обфускация не создают доверенный серверный результат.

## Доказательства перед коммерческим выпуском

Тимлид собирает: approved provider contract/eligibility, выбранные region/age/refund policies, версии schema/SDK/adapters, автоматические тесты гонок/повторов/прав, redacted sandbox receipts, сверку отчётов, реальные mobile PWA/iframe результаты и список ограничений. Каждый кейс отмечается pass/fail/not-tested; моки и локальная SQL проверка не отмечаются как живой provider pass.

Kill switch блокирует новые checkout/ad attempts, но сохраняет чтение истории и обработку уже созданных платежей, refunds, delayed verified rewards и reconciliation. План восстановления БД включает сверку внешних IDs. Публикация сайта/проверенной БД разрешена; включение реальных коммерческих операций зависит от настройки и приёмки провайдера.

## Локальный серверный результат

[Webhook boundary](../../server/monetization/README.md) реализует raw-byte Xsolla/Paddle signature validation, timestamp check Paddle, строгий canonical event без accountId/units клиента и интерфейс durable inbox. 11 локальных Node тестов прошли. Не реализованы и не проверены реальные vendor schema normalization, durable storage, checkout, fulfillment, HTTP deployment и live provider delivery. Пример fake inbox в тестах не доказывает SQL идемпотентность. Приёмка этих частей остаётся обязательной по таблицам выше.
