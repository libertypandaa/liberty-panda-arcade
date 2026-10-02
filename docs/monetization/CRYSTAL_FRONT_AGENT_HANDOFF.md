# Передача агенту Crystal Front: аккаунт, статистика и пилот магазина

Дата: 2 октября 2026. **Передача этапа A отдельному агенту игры. SDK 1.1.0: проверенный code commit e9a4b767d95c540385b359d90617c4375a5648dc.** Account context реализован в SDK 1.1.0; нормативный [ACCOUNT_CONTEXT_CONTRACT.md](../ACCOUNT_CONTEXT_CONTRACT.md) имеет приоритет над ранним аудитом [CRYSTAL_FRONT_PILOT.md](CRYSTAL_FRONT_PILOT.md). Команда сайта не изменяет игровые исходники. Перед началом агент игры сверяет свой HEAD и SDK-релиз с тимлидом; этот документ не разрешает включать реальные продажи или рекламу.

Игра: `libertypandaa/cristal-front-2`, локальный проверенный HEAD `d4b57e485c59c67739d698ac7060c8e0c42b24d5`, версия 0.1.32. Публичная сборка: https://libertypandaa.github.io/crystal-front-demo/. Идентификатор LPA **`crystal-front-demo`**, не имя исходного репозитория. Студия **Liberman Games**. Хаб: https://libertypandaa.github.io/liberty-panda-arcade/.

## Статус функций

| ДОСТУПНО в коде сайта | ПЛАН | БЛОКЕР коммерческого запуска |
|---|---|---|
| Проверка аккаунта оболочки и SDK 1.1.0 getAccountContext/onAccountContextChange с устойчивым account/game namespace | Интеграция namespace в сохранения Crystal Front | Нет getPlayer/cloud save/offline bootstrap; реальная доставка OTP проверяется командой сайта отдельно |
| `game-platform-sdk.js`: ready, available, enableExit, exit, capabilities, wallet, catalog, inventory, purchase | Подключение зафиксированной копии SDK в игру | Проверенная Crystal Front ещё не подключена к этому SDK |
| `game-analytics-sdk.js`: добровольная сессионная аналитика | Точки вызовов внутри Crystal Front | Существующий recordLocalAnalytics не отправляет данные в LPA |
| Серверные wallet/catalog/purchase/status и grant foundation по передаче БД | Расход consumable и атомарная синхронизация offline ветвей | consume/cloud save/revision контракт не готов; inventory выдач нельзя считать готовым учётом оставшихся бомб |
| Ограничение source/origin/launch/session и replay в host | Реальный рекламный provider adapter + intents | Rewarded intent API отсутствует, провайдер не подключён |

Последний postcheck БД, переданный тимлидом: экономические таблицы пусты, продажи обеих игр выключены, контракт purchase принимает `p_price_version`, status — `p_request_id`. Само наличие RPC не даёт права открывать магазин. Не подменять эти факты результатами mock-тестов.

## 1. Аккаунт и разделение игроков

Аккаунт обязателен для официального запуска через LPA. Хаб сам владеет Supabase-сессией и выбирает actor/gameId; iframe не получает bearer token, refresh token, service_role, secret key. Не читать `parent.HubClient`, cookies/localStorage хаба или его DOM и не создавать второй OAuth внутри игры.

Копировать зафиксированный `docs/game-platform-sdk.js` из сайта в сборку игры, загружать до commerce adapter. `await LibertyPanda.ready` сообщает об установленной связи с оболочкой, **не является отдельным доказательством личности, доступности продаж или подключения рекламы**. Затем запросить capabilities; RPC сам проверяет авторизацию. Offline запросы экономики недоступны.

В standalone без родителя SDK недоступен; покупки и аккаунтные действия выключены. Публичная статическая сборка может открываться напрямую — проверка хаба не делает её защищённой сервером. Не объявлять mandatory account для прямого URL уже реализованным. Официальная PWA — установленная оболочка LPA с iframe. Полный offline вход/восстановление verified context также не считать готовым.

Текущий ключ игры `crystalFrontProgressV1` общий для всех пользователей браузера. Нельзя загружать его как сохранение любого вошедшего аккаунта. SDK 1.1.0 предоставляет подтверждённый `storageNamespace` через `getAccountContext()` и `onAccountContextChange()`. Использовать только status=ready и неизменяемый namespace как адрес локального сейва/очереди: transient epoch/contextSessionId/generation не являются ключом хранения. Unknown/expired/changed/absent не обнуляют прогресс и не запускают пустую временную игру. Старый legacy ключ сохранить без auto-import, auto-assignment и перевода Rays. При смене аккаунта хаб закрывает iframe; очередь/результаты старого игрока нельзя переносить новому.

Получение и lifecycle:

```js
const platform = window.LibertyPanda;
if (!platform || !await platform.ready) return showPlatformUnavailable();
platform.onAccountContextChange(handleContext); // остановить старый контекст при отзыве
try { handleContext(await platform.getAccountContext()); }
catch (error) { showContextUnavailable(error.message); }
// В адаптере записи захватить старый контекст ДО await:
const owner = platform.accountContext();
if (!platform.isAccountContextCurrent(owner)) return;
const serialized = await serializeSnapshot(dirtySnapshot);
if (!platform.isAccountContextCurrent(owner)) return; // ДО записи; A→B→A имеет тот же ключ
localStorage.setItem(owner.storageNamespace + ':progress', serialized); // без await после fence
```

handleContext/serializeSnapshot/UI — функции игры. Dirty snapshot и прежний контекст захватываются вместе; проверка должна предшествовать фактической записи, а не только обновлению UI. Старые invalidated записи A1 не завершать по стабильному ключу A2. Для IndexedDB отменять старую transaction/очередь до commit либо применять generation/transaction version. Не выбирать новый accountContext().storageNamespace после await; dirty старого контекста можно удержать в памяти с provenance, но не автоматически записывать после revoke. Уже сохранённые данные остаются. SDK не читает и не удаляет legacy; оставить исходный ключ без auto-copy/assignment, возможная миграция отдельно opt-in. Offline открытую игру с ранее verified контекстом можно продолжать до expiresAt; новый offline reload не создаёт авторизацию и ждёт восстановления входа, сохраняя данные.

## 2. Статистика

Копировать отдельно `docs/game-analytics-sdk.js`. Геймплей работает при отказе от необязательной аналитики, отсутствии SDK и ошибке сети. Статистика активного времени/сессий/матчей — по текущему согласию сайта. Необходимые данные авторизации, подтверждённых покупок и будущих сохранений обрабатываются своими серверными контрактами; они не должны зависеть от telemetry checkbox. Нельзя тайно отправлять ту же необязательную статистику как «essential».

Фактические вызовы:

```js
const analytics = window.LibertyPandaAnalytics;
analytics?.ready(); // меню и необходимые ресурсы действительно готовы
analytics?.setPlaying(true); // активное участие игрока
const telemetryMatch = analytics?.matchStart('target_score') ?? null;
// Пауза, меню, реклама, скрытая вкладка: setPlaying(false).
if (telemetryMatch) analytics?.matchEnd(telemetryMatch, 'win', score);
analytics?.setPlaying(false);
```

`telemetryMatch` — только аналитический идентификатор, не авторитетный ID игрового результата, сохранения или submission. Отсутствие SDK не блокирует игровой цикл.

`matchStart` может вернуть null, если аналитика выключена: игра всё равно начинается. Результаты win/loss/draw/abandon, score конечное число в допустимом диапазоне; SDK ограничивает его ±1 000 000. Повторный callback победы не создаёт новый matchId: держать один ID и флаг завершения на матч. На restart сначала завершить старый матч как abandon, затем новый start. SDK считает активное время только при playing=true и видимой вкладке; не имитировать его игровым таймером и не считать меню/рекламу. Хаб завершает незаконченный матч при закрытии, но последнее сетевое сообщение не гарантировано.

Дополнительные методы: tutorial(step,state), progress(level,percent), achievement(id), error(code), custom(name,value). Пользовательский текст, email, токены, никнеймы в события не отправлять. Собственные имена custom регистрируются отдельно; SDK-метод не означает разрешение любого имени в БД. Progress не сохраняет игру, achievement не выдаёт предмет, matchEnd не начисляет валюту и не подтверждает честность рейтинга. Offline telemetry не является надёжной очередью: текущий SDK не реализует серверную синхронизацию offline результатов.

## 3. Один товар пилота

Предложение: `cf.bomb.single`, item `bomb`, quantity 1, consumable. Существующие точки: `main.js` shopItems/renderShop/buyBonus, core `useBonusWithTrace`. В игре Bomb стоит 35 **локальных Rays**; LPA-цена не утверждена. Не конвертировать начальные 260 Rays, mock ad Rays, локальный рейтинг и legacy бонусы в серверный баланс.

```js
const flags = await LibertyPanda.capabilities();
const wallet = await LibertyPanda.wallet();
const products = await LibertyPanda.catalog();
const grants = await LibertyPanda.inventory();
// Только при spendEnabled и разрешённом товаре, по осознанному нажатию:
const operationId = crypto.randomUUID();
await persistPendingPurchase({operationId, productId}); // адаптер игры, не SDK
const receipt = await LibertyPanda.purchase(productId, operationId);
```

Product ID: `^[a-z0-9][a-z0-9_.-]{0,63}$`. Игра передаёт только productId и operationId; цену/количество/actor задаёт сервер. Оболочка подтверждает цену, сохраняет исходную котировку по actor/game/operation, передаёт priceVersion, проверяет status перед retry. При неизвестном исходе повторять ту же operationId; новый UUID — только новая осознанная покупка. PRICE_CHANGED не обходить фоновым новым UUID. При STORAGE_UNAVAILABLE/INVALID_SAVED_QUOTE автоматического списания нет.

Receipt повторяем: не делать `bombs++` при каждом ответе. Применение grant.id и новый local save должны фиксироваться вместе; восстановление после crash не должно выдавать повторно или терять купленный предмет. Wallet в receipt исторический: актуальный перечитать через wallet(). Inventory пока показывает выдачи, не готовый остаток после потребления. Без серверного consume/revision безопасен технический тест receipt, но не готова публичная продажа используемых offline бомб.

## 4. Сохранения и offline

Сейчас persistProgress сохраняет profile/bonuses/shop с APP_VERSION, не всю доску; storage error проглатывается. Для покупки и Exit нужен явный результат записи/ошибка, а не best-effort success. Старый save сохранить отдельно, не уничтожать при миграции.

Будущий серверный контракт из PILOT должен атомарно принимать baseRevision + submissionId + save/results/consumptions и ID использованных grant. A/B могут играть offline от одной ревизии; первая корректная ветка принимается, вторая получает канонический save. Рейтинг, расход и игровые награды проигравшей ветки не применяются. Онлайн-покупки и рекламные grants — отдельный ledger, они не теряются при откате save. Точные API ещё не реализованы: не вызывать придуманные `saveProgress`, `consumeGrant`, `submitScore`.

## 5. Добровольная реклама

Нынешний MockRewardedAdProvider — таймер, дающий 40 local Rays. В режиме LPA его нельзя подключать к общему кошельку или показывать как настоящую рекламу. При providers=false рекламная монетизация недоступна.

Нужен отдельный согласованный rewarded intent: server actor/game/placement/requestId, фиксированная награда, provider callback verification, однократный credit, status recovery. Client completed/overlay closed/таймер не кредитуют баланс. UI может быть подготовлен под unavailable/loading/cancelled/no_fill/pending/rewarded; до готового контракта нет публичного SDK-вызова показа рекламы. Поддерживаются только добровольные rewarded ролики; баннеры, принудительные interstitial и подписки не добавлять.

## 6. Exit и обновления

После создания видимой кнопки вызвать `LibertyPanda.enableExit()`. Её обработчик: `LibertyPanda.exit({save,stop,fallback})`, где save действительно сохраняет локальное состояние и отвергает Promise при ошибке; stop останавливает симуляцию/звук; fallback открывает локальное меню. Ошибка save оставляет игру открытой. Не закрывать `window.parent` и не выполнять top navigation. Хаб скрывает внешние controls только после проверки игры и установки playerExit=true в реестре; до этого fallback Close сохраняется.

В отличие от отменяемого autosave, callback Exit.save не должен тихо возвращаться при устаревшем контексте: перед фактической записью выполнить `if (!platform.isAccountContextCurrent(owner)) throw new Error('ACCOUNT_CONTEXT_CHANGED');`. Иначе SDK примет отсутствие записи за успешное сохранение и закроет игру. Ошибки localStorage также пробрасывать, не превращать в fulfilled Promise.

PWA Exit возвращает в оболочку; обещать закрытие окна ОС нельзя. Текущую автоперезагрузку при новой версии через 420 мс заменить отложенным применением: активный матч/покупка/синхронизация не перезапускаются ради обновления. API проверки approved game build через сайт пока не опубликован; действующую проверку index.html игры не выдавать за такой API.

## 7. Реальный wire-протокол и границы

- Player: hello/config/close с type `lpa:player:*`, protocol 1, launchId UUID из URL; close содержит requestId UUID. Хаб проверяет source=current iframe, origin, фактический path и launch; SDK принимает только родителя origin `https://libertypandaa.github.io`. Не отправлять в `*`.
- Economy: `lpa:economy:request` с protocol/launchId/requestId/action/params; actions capabilities/wallet/catalog/inventory/purchase. Response `lpa:economy:response` содержит ok и result/error. Запросы только через SDK, тайм-аут 15 секунд, до четырёх pending. Внутренние RPC/токены iframe не получает.
- Analytics — **отдельный** протокол: `lpa:hello`, `lpa:config` с enabled/session; `lpa:event` содержит protocol/id/session/name/data. Не подставлять launchId вместо analytics session. GameId задаётся выбранной игрой хаба, не клиентским произвольным actor/game.

Текущая проверка фактического iframe URL рассчитана на доверенные игры общего origin. Перенос игры на другой домен требует отдельного согласования; ослаблять origin/source проверки нельзя. Общий origin не изолирует вредоносный игровой код от хаба.

## Приёмка и передача результата

Подробные критерии QA: [crystal-front-commerce-acceptance.md](../../tests/crystal-front-commerce-acceptance.md), сценарии A1–A12, R1–R5, конфликт двух устройств и PWA. Эти критерии дополняют, а не заменяют проверку актуального контракта БД.

Выполнить существующие core-smoke/cascade-chain; добавить тесты adapter для отказа аналитики, единственного match_end, pause/visibility, повторного receipt/grant, lost response/reopen, storage denied, смены аккаунта, изменённой цены, no-provider и Exit save error. Отдельно проверить реальный iframe с тестовым серверным SKU после разрешения БД; fake transport не заменяет эту проверку.

Account namespace этапа A реализован; после проверки опубликованного SDK игровой агент может подключать изолированные локальные сейвы. Обязательные блокеры перед публичным коммерческим пилотом: consume/save revision, утверждённая цена, включённый сервером тестовый/production режим по назначению и доказательство выдачи/расхода. Реальную рекламу блокирует provider+verified intent. Stage B отдельно согласован как план в [ACCOUNT_SAVE_CONTRACT_REVIEW.md](../../supabase/ACCOUNT_SAVE_CONTRACT_REVIEW.md). Физические телефоны/Safari, актуальность установленной PWA и права на аудио не объявлять проверенными.

Публикация игры — отдельный агент по `docs/DEMO_RELEASE.md`: проверенный source SHA → manifest bundle → публичный crystal-front-demo → тесты/Pages → проверка URL. Push в исходный repo сам по себе игру на LPA не обновляет. Передать source/public SHA, SDK-версию, фактические тесты и оставшиеся ограничения. Этап A согласован review БД; 104/104 теста пройдены, включая 18 браузерных integration cases. Облачный этап B остаётся проектом.

## Зафиксированный артефакт этапа A

Code commit: e9a4b767d95c540385b359d90617c4375a5648dc. SDK version: 1.1.0. Неизменяемая копия для игры: https://raw.githubusercontent.com/libertypandaa/liberty-panda-arcade/e9a4b767d95c540385b359d90617c4375a5648dc/docs/game-platform-sdk.js . Контракт: https://github.com/libertypandaa/liberty-panda-arcade/blob/e9a4b767d95c540385b359d90617c4375a5648dc/docs/ACCOUNT_CONTEXT_CONTRACT.md . Проверенный source опубликован в main; состояние Pages зафиксировано в ACCOUNT_CONTEXT_RELEASE_2026-10-02.md.

Скопировать SDK из этого commit в исходники игры; подключать только этап A согласно разделу 1. Не менять или удалять crystalFrontProgressV1, не запускать временную игру при недоступном контексте. После await повторно проверять isAccountContextCurrent ДО commit записи. Интеграция SDK в сборку Crystal Front 0.1.32 этим выпуском не выполнена.
