# SDK игры и подключение экономики LPA

Статус 2 октября 2026: оболочка/SDK реализованы, проверки с контролируемыми данными описаны в тестах. Обновление игровых сборок и включение провайдеров — отдельные этапы. Не считать существующие игры уже использующими этот SDK.

## Подключение игры

1. Подготовить публичную сборку и отдельную графику. Выполнить [GAME_ONBOARDING.md](GAME_ONBOARDING.md): валидируемый JSON, dry-run, затем --write. Каталог строится из реестра автоматически.
2. Агент БД регистрирует тот же gameId в серверном реестре по [DB_AGENT_HANDOFF.md](../supabase/DB_AGENT_HANDOFF.md). После теста включить analyticsEnabled. До этого новая игра не отправляет события в неподготовленную БД.
3. Скопировать game-platform-sdk.js в репозиторий игры и включить в публичную сборку фиксированную версию. Не загружать из изменяемого URL во время гонки. Секреты и токены аккаунта не передаются в игру.
4. Скопировать отдельный game-analytics-sdk.js, если игре нужна добровольная аналитика. Этот SDK не начисляет деньги и не подтверждает честность результата.

## Контекст аккаунта — SDK 1.1.0

Реализованы `getAccountContext()`, `accountContext()`, `onAccountContextChange(callback)` и `isAccountContextCurrent(captured)`. Полный нормативный wire, stable namespace formula, epoch/session fences и условия offline: [ACCOUNT_CONTEXT_CONTRACT.md](ACCOUNT_CONTEXT_CONTRACT.md). Для локальных сохранений и очереди покупок использовать только ready.storageNamespace; transient epoch/contextSessionId/generation никогда не включать в storage key. Unknown/expired не означают новое пустое сохранение. Legacy `crystalFrontProgressV1` не импортировать и не привязывать автоматически; local Rays не серверная валюта.

После async подготовки проверять `isAccountContextCurrent` **до фактической записи**, без await между fence и localStorage.setItem. Старую запись после revoke не завершать даже по прежнему namespace: A1→B→A2 повторно использует стабильный ключ. Для IndexedDB нужны отмена/сериализация с generation до commit. API не передаёт credentials и не предоставляет cloud save/consume/rewarded ads. Экономика остаётся защищена серверной авторизацией независимо от namespace.

## Выход

После создания видимой кнопки Exit и обработчика сохранения:

```js
LibertyPanda.enableExit();
exitButton.onclick = async () => {
  try {
    await LibertyPanda.exit({
      save: () => persistLocalProgress(),
      stop: () => stopSimulationAndAudio(),
      fallback: () => showMainMenu()
    });
  } catch (error) {
    showSaveErrorWithRetry();
  }
};
```

Вызовы persistLocalProgress/stopSimulationAndAudio/showMainMenu — адаптеры конкретной игры, их нужно реализовать. Ошибка save не закрывает iframe. В PWA Exit возвращает на стартовую страницу оболочки, не обещает закрыть окно ОС. В прямом запуске fallback возвращает меню. После совместной проверки релиза агент сайта включает playerExit в реестре; до этого внешний Close остаётся.

`enableExit()` допустимо вызвать во время инициализации игры до загрузки iframe: SDK один раз повторяет объявление готовой кнопки после подтверждения хаба. Повторные config не создают цикл сообщений. Одновременные нажатия Exit не запускают несколько сохранений/закрытий.

Протокол lpa:player:hello/config/close — protocol 1, launchId UUID из URL, requestId UUID при close. Обе стороны проверяют event.source, точный origin и launch. Хаб дополнительно проверяет фактический документ iframe и разрешённый путь. Новый origin требует пересмотра этого механизма: автоматическое ослабление проверки запрещено. Общее происхождение GitHub Pages не изолирует вредоносные игры; подключаются только проверенные собственные сборки.

## Экономика

```js
const supported = await LibertyPanda.ready;
if (!supported) return showStandaloneMenu();
const flags = await LibertyPanda.capabilities();
const wallet = await LibertyPanda.wallet();
const products = await LibertyPanda.catalog();
const inventory = await LibertyPanda.inventory();
```

flags.providers=false означает, что реальных платежей/рекламы нет. spendEnabled=false означает, что магазин ещё закрыт. Отсутствие сети/RPC/авторизации — ошибка, а не нулевой баланс. Не рисовать кнопку рекламной награды без доступного подтверждённого провайдера. SDK не имеет метода adCompleted или addBalance.

Игровая кнопка покупки показывает товар из catalog. Перед отправкой сохраняйте operationId и productId в очереди текущего аккаунта/игры. После тайм-аута повторять только ту же операцию; новую создавать лишь для новой осознанной покупки:

```js
const operationId = crypto.randomUUID();
await persistPendingPurchase({operationId, productId});
const receipt = await LibertyPanda.purchase(productId, operationId);
await reconcileInventory(await LibertyPanda.inventory());
await markPurchaseResolved(operationId, receipt.purchaseId);
```

Это пример, а не готовый формат сохранений конкретной игры. Не начислять предметы повторно по каждому receipt: учитывать grant.id и сверять инвентарь. Баланс в receipt исторический, текущий перечитать wallet(). При смене аккаунта нельзя переносить его очередь/сохранение другому владельцу; сам SDK не знает userId. Игра должна остановить старую сессию, оболочка закрывает iframe при смене аккаунта.

Хаб сам выбирает gameId, проверяет прежний receipt через lpa_purchase_status, затем для новой операции запрашивает серверный каталог и показывает подтверждение цены. До списания он сохраняет подтверждённое предложение в localStorage под отдельным ключом `lpa:purchase-quote:v1:<actor>:<gameId>:<operationId>`. Содержимое: actor, gameId, operationId, productId, priceVersion и показанная price; токенов в нём нет. Только затем вызывается `lpa_purchase` с исходной `priceVersion`; сумма списания определяется сервером. `p_expected_price` не передаётся.

После потери ответа или повторного открытия сначала проверяется прежний receipt. Его gameId/productId и сохранённая priceVersion должны совпасть. Если receipt ещё нет, используется сохранённое подтверждение и исходная priceVersion без нового каталога или незаметной смены цены. При изменённой серверной версии возвращается PRICE_CHANGED, а старое предложение сохраняется. Для новой осознанной покупки нужен новый operationId и подтверждение. Успешное получение receipt очищает сохранённое предложение; ошибки сети/сервера его сохраняют. Игра не должна удалять свою очередь только из-за тайм-аута.

STORAGE_UNAVAILABLE означает, что хаб не смог прочитать или надёжно записать предложение: новое списание не выполняется. INVALID_SAVED_QUOTE означает повреждённое либо не совпадающее с операцией предложение: автоматическое списание также запрещено. Не пытайтесь обходить эти ошибки сменой operationId в фоне. Данные другого аккаунта не используются. Очистка пользователем данных браузера уничтожает локальную очередь/котировку; серверный receipt можно получить по сохранённому operationId, но восстановление забытого идентификатора SDK не обещает.

Утерянный ответ восстанавливается даже после снятия товара с продажи. Клиент не задаёт actor или величину начисления; произвольные RPC из iframe не разрешены. Product ID соответствует серверному шаблону `^[a-z0-9][a-z0-9_.-]{0,63}$`.

Сообщения economy: request {type:'lpa:economy:request',protocol:1,launchId,requestId,action,params}; response {type:'lpa:economy:response',protocol:1,launchId,requestId,ok,result|error}. Для purchase params={productId,operationId}; для остальных пустой объект. Максимум 4 незавершённых запроса SDK, тайм-аут 15 сек. Хаб ограничивает новые запросы до 30 в минуту и 16 одновременно выполняемых. Завершённые ответы хранятся в ограниченном кэше до 128 записей с вытеснением старых и сроком 5 минут с последнего обращения; выполняющиеся обещания не вытесняются. Долгая сессия не блокируется после 128 суммарных запросов. После вытеснения повтор может дойти до сервера, поэтому гарантия однократного списания опирается на серверный operationId, а не на кэш браузера. Хаб проверяет источник/документ/аккаунт и не возвращает внутренние SQL-ошибки.

## До полноценного коммерческого запуска

Нужны провайдер, аккаунт получателя в Израиле, серверная проверка webhook, согласованные товары/цены и возрастной сценарий. [План монетизации](monetization/MVP_PLAN.md) и [приёмка](monetization/INTEGRATION_ACCEPTANCE.md) фиксируют ограничения. Принятая офлайн-ветка, облачные сохранения и расход локальных копий бонусов ещё требуют отдельной игровой интеграции; не выдавать текущий wallet API за реализованный cloud save.
