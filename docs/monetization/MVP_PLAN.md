# MVP монетизации Liberty Panda Arcade

Дата проверки первичных источников: **2 октября 2026**. Студия: Liberman Games. Статус: проект решений для тимлида, не реализованный функционал и не подтверждение юридической/налоговой пригодности провайдеров. Никаких аккаунтов, договоров, покупок, production изменений или публикаций в этой задаче не выполнялось.

**Актуальное решение владельца:** основной получатель дохода — **Израиль**; РФ остаётся возможной страной аудитории. Владелец разрешил публикацию сайта и проверенные production изменения БД после тестов. Эта задача не выполняет deployment: реальные платежи/реклама разрешены только после настройки провайдера. Упоминания неизвестной страны/общего запрета публикации в первоначальных проектных материалах больше не являются текущим ограничением команды.

## Предложение MVP

Сначала выполнить этап 4 платформы: общий серверный кошелёк, игровой заработок из принятой ветки, магазин и инвентарь без реальных денег. Затем подключить **одного платёжного провайдера для разовых покупок валюты**. Первым проверить Xsolla в модели merchant of record (MoR), запасным — Paddle после одобрения именно общей валюты собственных игр. Это приоритет исследования/пилота, а не выбранный договор.

Добровольный rewarded video подключать отдельным переключателем после допуска рекламного провайдера и проверки серверных подтверждений. AppLixir — технический кандидат; публичный порог трафика может сделать его недоступным стартующему проекту. Если доступного провайдера с проверяемым серверным reward нет, выпустить покупки и игровой заработок, рекламу оставить выключенной. Не ослаблять правило ради клиентского callback.

Общая валюта расходуется только онлайн. Подписки, вывод денег и перевод между игроками в MVP не включать. Отсутствие рекламы, отказ от просмотра, отмена платежа и недостаток валюты не блокируют обычную игру. Google — основной вход, email OTP — дополнительный; способы входа не доказывают возраст. PWA на телефоне — основная среда, браузер/iframe — дополнительная; native SDK не подтверждает поддержку PWA.

## Основания в проекте

Прочитаны [PLATFORM_SPEC](../PLATFORM_SPEC.md), [план реализации](../PLATFORM_IMPLEMENTATION_PLAN.md), [контракт игр](../GAME_PLATFORM_CONTRACT.md), [UI review](../PLAYER_UI_REVIEW.md), [live audit](../../supabase/LIVE_AUDIT_2026-10-02.md). Применимых AGENTS.md в корне/предках/docs не найдено; game-hub/AGENTS.md относится к другому подкаталогу. Чужие незакоммиченные изменения сохранены.

По live audit в public есть только профили и аналитика: кошелька, покупок и облачных сохранений нет. История миграций отсутствует; это не разрешение повторять старые SQL. Нынешний matchEnd/analytics v1 нельзя использовать для начисления валюты. Сохранения/экономика требуют обязательного серверного потока, отдельного от добровольной аналитики. Реальные Auth/OTP/PWA ещё требуют приёмки.

## Реклама: небольшой набор кандидатов

| Вариант | Поддержка и доступ | Серверная награда | Решение для MVP |
|---|---|---|---|
| AppLixir HTML5/JavaScript | Web rewarded video, отдельное одобрение сайта. На главной заявлены 100 000 показов/месяц для новых заявок; другая страница говорит об отсутствии публичного минимума. Нужен письменный ответ для малого проекта | Официальный HTML5 guide описывает S2S и режим MD5 + TID. Требуется проверить привязку попытки и защиту повтора | Первый технический кандидат, доступ не подтверждён |
| Google AdSense H5 Games / Ad Placement API | HTML5 сайт/страница/WebView; нужен AdSense и допуск H5 программы. API поддерживает rewarded и interstitial; использовать только rewarded | Документирован adViewed в браузере; доверенное S2S подтверждение конкретной награды в проверенной документации не найдено | Не подключать общую валюту до документированного решения от Google |
| Google Ad Manager GPT rewarded web | Desktop/mobile/tablet web; есть ограничения формата и отдельные настройки спроса | Google прямо пишет, что SSV доступна только для app, не web | Не подходит текущему правилу доверия. По умолчанию спрос включает display; для video-only требуется обращение к account manager |

Основания: [AppLixir web](https://www.applixir.com/), [противоречащая страница о минимуме](https://www.applixir.com/cpmstar-alternatives/), [одобрение сайтов](https://support.applixir.com/setting-up-applixir-account), [HTML5 S2S](https://support.applixir.com/applixir-integration/integration-for-html5-sites-apps/step-4-setting-up-local-callback-360053188774), [H5 getting started](https://support.google.com/adsense/answer/9959170?hl=en), [заявка H5](https://adsense.google.com/intl/en_kr/start/h5-game-ads-apply/), [adBreak API](https://developers.google.com/ad-placement/apis/adbreak), [GAM web restrictions](https://support.google.com/admanager/answer/9116812?hl=en). AdMob/Unity/AppLovin native интеграции не выбраны для браузерного MVP.

### AppLixir: условия, которые проверить до выбора

В [Payment FAQ](https://support.applixir.com/frequently-asked-questions/payment-questions/applixir-payment-faq-360053980313) допускается физлицо, указано Net-30, минимум $100, bank wire/PayPal и возможные комиссии. Выплаты подчиняются банковским санкциям; конкретный допуск получателя и банка в Израиле/РФ публично не подтверждён. [Маркетинговая how-it-works](https://www.applixir.com/how-it-works/) говорит Net-60: договорный срок нужно уточнить, FAQ не заменяет договор. Доход за частичный просмотр не равен выполненной rewarded-награде.

В HTML5 S2S guide `customData` не подписана, `userId` подписан; использовать непрозрачный серверный идентификатор попытки в подписанном поле, **если это разрешено провайдером**, с серверным отображением на accountId. Не брать accountId/сумму из customData. Режим без TID не годится для требования дедупликации. GET может содержать secretKey: закрыть query-логи, не отправлять секрет в сторонний webhook inspector. MD5-схему и границы подписанных полей проверить тестами и согласовать с провайдером; произвольная MD5-подпись не доказывает, что клиент не может менять неподписанный контекст.

Получить ответы: допустим ли signed userId как attempt nonce; гарантируется ли один TID на один заслуженный reward; сроки/повторы/сверка потерянных callback; аннулирование fraud rewards; поддержка standalone iOS/Android PWA и iframe; video-only; возрастные категории и non-personalized режим; фактический минимум трафика; приём физлица/ИП/компании с реальным местом деятельности и выбранным банком. Не обещать eCPM/fill rate по маркетинговым цифрам.

### Google: территории и выплаты

Google допускает [individual и business AdSense accounts](https://support.google.com/adsense/answer/10163?hl=en); для Израиля [таблица выплат AdSense](https://support.google.com/adsense/answer/1714397?hl=en-EN) указывает EFT и wire. Это не одобрение H5 конкретного сайта. [Russia-based AdSense accounts деактивируются](https://support.google.com/adsense/answer/15282937?hl=en); [региональная политика](https://support.google.com/publisherpolicies/answer/15766875?hl=en) ограничивает монетизацию Russia-based publishers. Израильский счёт сам по себе не меняет реальное место деятельности и eligibility.

Для Google reward должен оставаться внутри платформы, без вывода и передачи третьим лицам: [reward policies](https://support.google.com/adsense/answer/9121589?hl=en-EN). Предложение MVP — запрет переводов между игроками; при будущем пересмотре снова проверить правила.

## Разовые платежи

| Вариант | Пригодность web | Получатель / территории | Выплаты и незакрытые условия |
|---|---|---|---|
| Xsolla Pay Station, MoR | Игровые цифровые товары/валюта, checkout и webhooks; backend LPA остаётся источником общего кошелька | Регистрация описывает физлиц; реальный запуск требует лицензионного договора. Приём конкретного резидента/бизнеса Израиля либо РФ и банка не подтверждён | Договорить комиссию, payment method fees, резерв, сроки/минимум/валюту выплаты, возвраты и chargeback. Не переносить условия creator Partner Network на выплаты разработчику |
| Paddle MoR | Разовые цифровые покупки; game currency/items требуют проверки владения игрой и домена | Identity verification описывает individual/sole trader. Израиля нет в списке исключённых supplier countries; РФ исключена. Это возможность review, не гарантия | Опубликованы ежемесячные выплаты wire/Payoneer, минимум $100, отправка до 15-го; банк и фактическую валюту согласовать |
| Stripe direct acquiring | Технически подходящий checkout, но на опубликованном global list нет Израиля и РФ | Не соответствует нынешним известным странам владельца | Не выбирать по наличию иностранного счёта. Законное учреждение в поддерживаемой стране было бы отдельным бизнес-решением, не обходом |

Источники: [Xsolla onboarding](https://developers.xsolla.com/get-started/work-in-pa/create-first-project/), [sandbox/production](https://developers.xsolla.com/dev-resources/testing/general-info/), [virtual currency real-money prerequisite](https://developers.xsolla.com/api/catalog/virtual-payment), [Xsolla payment configuration](https://developers.xsolla.com/dev-resources/faq/payments/), [developer payout reconciliation](https://developers.xsolla.com/payment-ui-and-flow/features/management-via-account/), [Paddle domain review](https://www.paddle.com/help/start/account-verification/what-is-domain-verification), [identity](https://www.paddle.com/help/start/account-verification/what-is-identity-verification), [countries](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle), [payouts](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid), [Stripe global](https://stripe.com/global).

MoR может уменьшить операционную работу с покупательскими налогами, но обязанности владельца по доходам, регистрации и отчётности остаются предметом проверки. Прямые gateways Xsolla имеют другую модель обязанностей; не подменять ими MoR без нового решения. Нужен письменный допуск общей валюты **между несколькими собственными играми**, а не только валюты одного title, и перечень реально доступных buyer countries/methods. Международная аудитория не означает оплату из всех стран.

### Предлагаемый поток покупки

1. Сервер по текущему аккаунту и разрешённому региону создаёт orderId, сохраняет версию SKU, количество валюты, денежную цену/валюту и срок quote. Клиент не назначает цену или accountId получателя.
2. Сервер создаёт checkout с idempotency key; hosted checkout обрабатывает платёжные реквизиты. Пока provider create имеет неизвестный исход, искать/повторять ту же операцию, не создавать второй заказ.
3. Redirect/payment_success показывают только ожидание. Подписанный webhook поступает в доверенный обработчик; проверяются provider/project/environment, заказ, сумма, денежная валюта и финальный статус. Для Xsolla соблюдать выбранный product webhook contract; для Paddle ориентир — transaction.completed. Проверка подписи требует исходного тела, а не пересериализованного JSON.
4. Сохранить event во входящий журнал; один provider payment ID может дать только одно начисление, даже если события имеют разные event ID. Начисление и статус выдачи фиксируются одной транзакцией. Отвечать успехом после долговечной записи, обработку тяжёлой сверки выполнять из очереди.
5. Возврат/chargeback — отдельные события и компенсирующие записи. Поздний payment после refund не должен воскресить покупку. Периодически сверять незавершённые заказы и финансовые итоги с отчётами провайдера, без опоры на клиентские показы/успехи.

Основания: [Xsolla payment/refund webhooks и signature](https://developers.xsolla.com/webhooks/payments), [Paddle delivery, event_id, ordering и signature](https://developer.paddle.com/webhooks/about/how-webhooks-work/). Детальный проект идемпотентности/инвентаря/возвратов: [DB_REQUIREMENTS](DB_REQUIREMENTS.md).

## Возраст, согласия и потребительский сценарий

До коммерческого запуска классифицировать аудиторию каждой игры и общий аккаунт: general audience, mixed audience или child-directed по применимым правилам. Отсутствие отдельного детского UI не снимает обязанностей. [FTC COPPA FAQ](https://search.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) описывает различия и ограничения age screening; нельзя универсально решить вопрос кнопкой «13+». Для EU отдельно оценить GDPR/детские согласия и применимые требования к рекламе; рекламный CMP не заменяет согласие родителей на аккаунт.

Рекламные SDK/идентификаторы загружать только после разрешённого сценария; возраст unknown не приравнивать к adult. Аналитика, обязательная экономика и согласие на рекламу — отдельные цели. Google login/email не дают подтверждённого возраста. Предложение до согласованной политики — не включать коммерческие функции для неопределённой возрастной категории; это временный технический gate, не доказательство соответствия законам аккаунта.

В магазине показывать понятную реальную стоимость, количество валюты и предмета, подтверждение покупки, поддержку/историю; не проектировать пакеты с вынужденным избытком, таймеры давления или случайные платные награды в MVP. [EC/CPC principles](https://commission.europa.eu/news-and-media/news/european-commission-hosts-stakeholders-talks-application-cpc-networks-key-principles-games-virtual-2025-06-03_en) подчёркивают прозрачность цен, withdrawal и защиту детей. Для общей смешанной earned/paid валюты метод отображения эквивалента и возвратов требует согласования; виртуальная валюта не отменяет потребительских прав.

## Вопросы владельцу через тимлида

Не отправлены владельцу/провайдерам/агенту БД. Тимлид может сгруппировать решения перед соответствующим этапом.

| Решение | Что нужно зафиксировать | Что оно разблокирует |
|---|---|---|
| Получатель | Реальное место деятельности/налоговое резидентство, физлицо или допустимая форма бизнеса, банк и страна выплаты; проверить с профильным специалистом | KYC, договор, налоги, банковский маршрут |
| Первый рынок | Приоритетные страны/языки, прогноз месячных показов и покупателей | Проверка рекламного допуска, методов оплаты, стоимости поддержки |
| Возраст | Аудитория каждой игры, обработка unknown/minor, родительский сценарий и покупки детей | Допустимый login/реклама/checkout |
| Экономика | Название валюты, начальные SKU/цены, игровые и рекламные лимиты, ассортимент; подтвердить отсутствие переводов | Каталог и reward policy |
| Возвраты | Правила неиспользованной/потраченной валюты, inventory revocation, частичных возвратов, споров | Финализация DB state machine и текстов магазина |
| Провайдер | Xsolla или Paddle после письменного допуска; рекламный доступ/трафик; бюджет на комиссии/резерв | Sandbox интеграция и коммерческий pilot |
| Публичная инфраструктура | Домены PWA/checkout callback, SMTP, support address, условия/приватность, сроки хранения | Допуск домена, OTP, обработка претензий |

## Что готовить до этих решений

Разрабатывать provider-neutral schema/API и локальные фикстуры: ledger, каталог, атомарные траты, grants, branch acceptance, webhook inbox/outbox, компенсации и аудит. Подготовить UX «ожидает подтверждения/реклама недоступна/платёж отменён», матрицу возрастных/региональных capability gates и контрольный список для будущего sandbox. Не регистрировать сервисы и не включать production.

Обновление поручения тимлида: агент БД начинает локальный закрытый ledger/каталог/траты. Приоритет разработки — [DB_REQUIREMENTS](DB_REQUIREMENTS.md); страна получателя уже выбрана: Израиль. Провайдер и денежные цены не выбраны за владельца. Матрица возможностей и приёмка: [INTEGRATION_ACCEPTANCE](INTEGRATION_ACCEPTANCE.md).

Актуальный контекст EU: [страница EC о coordinated actions](https://commission.europa.eu/topics/consumers/consumer-rights-and-complaints/enforcement-consumer-protection/coordinated-actions/social-media-online-games-and-search-engines_en) содержит Joint Statement от 30 сентября 2026 и новые проверки практик virtual currency. Это усиливает необходимость проверки магазина/возвратов перед выпуском, но не означает, что LPA уже признана нарушителем или прошла legal review.

## Последовательность и критерии выпуска

1. База: аккаунты и синхронизация по first accepted baseRevision; отдельный поток признанных результатов. Нет наград из отвергнутых веток.
2. Экономика без денег: одна игра с бонусами и одна косметика, тестовые grants только в тестовом окружении. Проверить гонки покупок и межустройственные выдачи.
3. Решения владельца/провайдерский допуск: письменные eligibility и product approvals, согласованные тексты, возвраты, возраст/согласия и поддержка. Провайдеры всё ещё выключены для реальных операций.
4. Sandbox: валидные/невалидные подписи, повторы, refund-before-payment, поздние награды, потерянные ответы и финансовая сверка. Отдельно реальные Android Chrome PWA, iOS Safari standalone и iframe: callback возврата, экран видео, фон/закрытие, отключение сети, consent decline, no-fill/adblock.
5. Ограниченный коммерческий pilot после настройки/допуска провайдеров и тестов: региональные ограничения, мониторинг pending/ошибок/chargeback, kill switch новых операций без потери уже подтверждённых. Публикация сайта и проверенные изменения production БД разрешены владельцем команде; deployment не входит в работу этого исполнителя.

## Практический путь для получателя в Израиле

Рекомендация для следующего внешнего шага — **Xsolla Pay Station в модели Xsolla MoR**, разовые пакеты non-transferable валюты для собственных игр. Игровая специфика и web checkout подходят продукту; запрос должен прямо указывать физлицо/форму деятельности в Израиле, израильский payout bank и несколько игр одного владельца. Это выбор пути onboarding для одобрения владельцем/тимлидом, не утверждение заключённого договора. [Xsolla MoR](https://xsolla.com/merchant-of-record) и [onboarding individual](https://developers.xsolla.com/get-started/work-in-pa/create-first-project/) подтверждают модель/форму входа, но не гарантируют KYC конкретного получателя и банка. Не путать с Xsolla PSP, где MoR — сам разработчик.

**Запасной путь — Paddle MoR:** Израиль не в опубликованном supplier exclusion list, отдельная [gaming offering](https://www.paddle.com/solutions/paddle-for-games) существует. Допуск валюты/доменов/получателя всё равно обязателен. РФ покупателям не обещать: [country policy](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle) описывает ограничения suppliers и buyers. Для Xsolla РФ-покупки выяснить по конкретным разрешённым методам и территориям договора; наличие российского банка у владельца или старых EULA не доказывает текущую доступность. Игровой доступ и paid checkout capability разделяются.

**Реклама не должна задерживать платёжный MVP.** AppLixir остаётся единственным в исследованном наборе кандидатом с документированным web S2S, но Israel payout/traffic eligibility ещё не подтверждены. Google H5/GAM технический пробел по проверяемой награде не решается выбором Израиля. Реалистичный первый коммерческий набор — verified purchases + earned currency; рекламу добавлять после допуска, video-only и server-proof приёмки.

### Обязательные внешние настройки для запуска

| Настройка | Что должно быть получено/проверено |
|---|---|
| Израильский получатель | Legal name, фактический адрес/форма деятельности, KYC/identity, tax data в защищённом onboarding; израильский банковский получатель и подтверждённые payout реквизиты. Секреты/документы не присылать в чат |
| Provider approval и договор | Разовые пакеты общей валюты нескольких игр, права на игры, MoR роль, страны покупателей включая отдельный ответ по РФ; комиссия/резерв/валюта/срок payout, refund/dispute обязанности |
| Домены/информация | Проверенный домен каталога и каждой PWA, game URLs, support email, seller details, terms/privacy/refund policy, возрастный сценарий и consent infrastructure |
| Sandbox project | Project/merchant IDs, утверждённые currency SKU/price versions, API credentials в server secret storage, sandbox checkout + redirect/cancel URLs; server-generated order reference |
| HTTPS webhook | Реальный backend hosting/route, correct raw body capture, project-specific signing secret, актуальный event model, durable inbox/fulfillment и retry/reconciliation. Для нового Xsolla проекта проверить order_paid/order_canceled, не копировать legacy payment/refund вслепую |
| Live separation | Отдельные sandbox/live config и secrets, allowlist SKU/region/age, real quote amounts, мониторинг и kill switch. Secret не помещается в статический docs/ или игру |
| Payout/operations | Реальная payout настройка, отчёты/сверка, контакт поддержки, доступ владельца к спорам и ручным корректировкам; первые live операции только после sandbox/mobile приёмки |
| AppLixir, если допущен | Site/domain approval, ads.txt, public game API key отдельно от secret, server callback HTTPS + MD5/TID, verified nonce mapping, consent/age и video-only; сроки Net-30/60 и minimum traffic согласованы |

Для Xsolla event model основание: [current SDK webhooks](https://developers.xsolla.com/sdk/publisher-account/webhooks/). В коде нет выбранного production endpoint или реальных credentials. Подготовлен [локальный webhook boundary](../../server/monetization/README.md): exact-byte signature validators для двух кандидатов и provider-neutral durable inbox contract; 11 локальных тестов прошли. Нормализация реальных provider payloads, БД persistence, fulfillment и HTTP deployment ещё не реализованы этим модулем.

Прогноз дохода строить после пилота: rewarded revenue = подтверждённые оплачиваемые показы / 1000 × фактический net eCPM; payment net = продажи − refunds − chargebacks − fees − применимые удержания. Reward completion count и рекламная оплачиваемость — разные показатели. Не выдавать прогноз без трафика, стран и договорных расходов.
