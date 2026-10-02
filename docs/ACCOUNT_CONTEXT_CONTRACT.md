# LPA account context v1 — SDK 1.1.0

Реализованный этап A: стабильный адрес локальных данных аккаунта/игры. Это не cloud save, не разрешение списать деньги и не серверный игровой результат. Нормативные файлы: `account-context-host.js`, `game-platform-sdk.js`. До опубликованного SHA/URL считать кандидатом; подтверждение выпуска добавляет релизный агент.

## Что получает игра

```js
const platform = window.LibertyPanda;
if (!platform || !await platform.ready) return showPlatformUnavailable();
const unsubscribe = platform.onAccountContextChange(onContext);
try { onContext(await platform.getAccountContext()); }
catch (error) { showContextUnavailable(error.message); }
```

Функции примера show/onContext — адаптеры игры, не SDK. `getAccountContext()` запрашивает контекст через postMessage; тайм-аут 15 сек. До связи/в standalone возвращает локальный unknown. `accountContext()` — последний снимок с проверкой срока. `onAccountContextChange(fn)` возвращает unsubscribe. `isAccountContextCurrent(captured)` — проверка после async операции: ready, не истёк, совпадают gameId/namespace/epoch/contextSessionId/локальная generation. SDK имеет явную `version: '1.1.0'`.

Снимок ready:

```json
{
  "status": "ready",
  "reason": "verified",
  "gameId": "crystal-front-demo",
  "storageNamespace": "lpa:save:v1:<64 lowercase hex characters>",
  "expiresAt": 1790000000000,
  "epoch": 3,
  "contextSessionId": "<UUID>",
  "generation": 4
}
```

expiresAt — Unix миллисекунды; значение в примере условное. generation добавляет SDK локально, по wire его нет. Для статусов unknown/changed/absent/expired storageNamespace и expiresAt — null. Не использовать null как имя новой папки/сохранения и не создавать «чистую» временную игру вместо прежней.

| Статус | Поведение игры |
|---|---|
| ready | Открыть локальное сохранение **только** по этому namespace; можно локально продолжать до срока контекста |
| changed | Проверка после смены/первой авторизации ещё идёт; остановить старый игровой контекст, не применять его async ответы к следующему |
| absent | Подтверждённый callback без session; показать вход через оболочку, прежние данные сохранить |
| expired | Session/контекст истёк; остановить аккаунтные действия и запросить восстановление через оболочку, данные не удалять |
| unknown | Начальная загрузка, нет SDK/Auth, не удалось проверить пользователя или crypto; не угадывать владельца и не начинать новое сохранение поверх старого |

Причины diagnostic: initializing/not_confirmed, verification_pending, signed_out, session_expired, auth_unavailable, verification_unavailable, verification_rejected, identity_mismatch, namespace_unavailable, page_closed. Не использовать текст reason для авторизации.

## Стабильность и доверие

Хаб получает actor из успешного `HubClient.auth.getUser()` **вне синхронного callback Auth**, сравнивает его с текущей session и проверяет expires_at. Изменение пользователя сначала синхронно инвалидирует generation проверки и rotate epoch/contextSessionId, затем выполняет async verification. A→B→A не восстанавливает старые ответы A. Same-actor INITIAL_SESSION/SIGNED_IN/TOKEN_REFRESHED после подтверждения не меняют namespace/epoch; успешная проверка может продлить expiresAt. Временная сетевая ошибка same-actor refresh оставляет только прежний verified контекст до прежнего срока. Серверные 401/403, другой actor или просроченная session немедленно закрывают контекст.

Единственная каноническая формула:

```js
const input = JSON.stringify([
  'lpa-storage-v1',
  new URL(LIBERTY_PANDA_AUTH_CONFIG.supabaseUrl).origin,
  verifiedActorUUID.toLowerCase(),
  gameId
]);
storageNamespace = 'lpa:save:v1:' + hexLower(SHA256(UTF8(input)));
```

JSON framing предотвращает неоднозначную конкатенацию. SHA-256 через Web Crypto в secure context; при отсутствии SubtleCrypto — unknown, без случайного fallback namespace. Один проект/actor/game даёт тот же namespace после reload, повторного входа, обновления SDK и на другом устройстве. Разные аккаунты или игры дают разные namespace. Это стабильный **псевдоним адреса хранения**, не секрет и не право доступа: зная namespace, нельзя обращаться к чужой БД. Игра не должна использовать его вместо auth.uid. Namespace не означает, что содержимое localStorage под ним достоверно или защищено от пользователя/скриптов общего origin.

Игре не передаются actor UUID, email, JWT, bearer/refresh token, Supabase client или secret key. Запрещено получать идентичность через parent DOM/storage/HubClient. Epoch/contextSessionId — эфемерная защита сообщений; их **нельзя** включать в ключ сохранения. generation — локальный fence SDK, тоже не часть storage key.

## Точный wire

Все сообщения имеют protocol=1 и launchId UUID активного iframe. Origin родителя фиксирован `https://libertypandaa.github.io`; targetOrigin никогда не `*`. Хаб проверяет source=current frame, origin игры, реальный путь загруженного документа и launch nonce через HubPlayer.trusted. Другие origin не включать без отдельного пересмотра модели.

- Request: `{type:'lpa:account:request', protocol:1, contextVersion:1, launchId, requestId:UUID, epoch:null|integer, contextSessionId:null|UUID}`. Последние два — наблюдаемая версия клиента, не авторизация; хаб всегда возвращает свой актуальный снимок.
- Response: `{type:'lpa:account:response', protocol:1, contextVersion:1, launchId, requestId, context:{status,reason,gameId,storageNamespace,expiresAt,epoch,contextSessionId}}`.
- Push: `{type:'lpa:account:changed', protocol:1, contextVersion:1, launchId, context:{...}}` без requestId. Высылается при смене/подтверждении/истечении и готовности iframe.

SDK принимает ответ только на незавершённый requestId, не принимает другой origin/source/launch/версию, меньший epoch или другой sessionId в том же epoch. Первый доверенный gameId закреплён за launch; переключение gameId внутри launch запрещено. После async derivation хаб повторно проверяет launch и generation. Смена контекста отвергает незавершённые account/economy promises с ACCOUNT_CONTEXT_CHANGED; обработчики игры должны ловить rejection. Тайм-аут сам по себе не подтверждает выход/вход и не создаёт новый namespace.

## Offline, закрытие и legacy

Если уже проверенный контекст остаётся в открытом документе, временное отсутствие сети не меняет namespace и позволяет локальную игру до expiresAt. Это **не** новый offline login: при offline reload/reopen без успешной verification состояние unknown/expired; сохранение остаётся на месте и ждёт восстановления входа. Коммерческие операции требуют сети. Stage A не гарантирует offline загрузку внешней сборки.

При pagehide SDK отменяет promises, помечает page_closed и больше не принимает сообщения в этом экземпляре. Автоматическое восстановление BFCache этим SDK не поддержано: после возврата нужен осознанный перезапуск через оболочку; прогресс не удаляется, активный матч ради обновления автоматически не reload. Отзыв может совпасть с удалением iframe: не полагаться на доставку последнего push для сохранения. Игра сохраняет после значимых действий и при своём Exit. Ошибка save отменяет Exit.

Асинхронная подготовка захватывает контекст и snapshot заранее; fence проверяется **до фактической записи**, без await между проверкой и синхронным commit:

```js
const owner = platform.accountContext();
if (!platform.isAccountContextCurrent(owner)) return;
const snapshot = captureDirtySnapshot();
const serialized = await serializeSnapshot(snapshot);
if (!platform.isAccountContextCurrent(owner)) return;
localStorage.setItem(owner.storageNamespace + ':progress', serialized);
```

captureDirtySnapshot/serializeSnapshot — адаптеры игры. Ошибку записи обработать и не сообщать об успешном сохранении. После revoke старую запись A1 нельзя автоматически завершать даже по прежнему ключу: A1→B→A2 имеет тот же namespace и поздняя запись A1 затрёт новый прогресс A2. Для IndexedDB нужна отмена старой transaction/очереди до commit либо сериализация с проверяемой generation/transaction version; произвольный async saveToKey не становится безопасным от проверки только после await. Dirty snapshot старого контекста допускается удержать отдельно в памяти с provenance для обработки ошибки, но не автоматически записывать после отзыва. Уже сохранённые данные остаются на месте; новый namespace после await не подставлять.

В примере autosave тихий return отменяет устаревшую работу. Для `Exit.save` такой return **недопустим**: fulfilled Promise выглядит как успешное сохранение. Guarded save для Exit при неактуальном контексте должен бросать `new Error('ACCOUNT_CONTEXT_CHANGED')`, а при storage error — передавать ошибку наружу. Тогда SDK не выполняет stop/close; UI сообщает о несохранённом состоянии. Например: после serialize и непосредственно перед setItem выполнить `if (!platform.isAccountContextCurrent(owner)) throw new Error('ACCOUNT_CONTEXT_CHANGED');`.

`crystalFrontProgressV1` и legacy Rays/bonuses остаются без изменений. Этот этап их не читает, не присваивает вошедшему игроку, не импортирует и не очищает. Оставить исходный legacy ключ неизменным; backup/import — только отдельное согласованное действие. Наличие namespace не доказывает владельца старых данных. Никаких одноразовых игровых сессий с потерей прогресса вместо аккаунтного сохранения.

Экономические методы SDK остаются совместимыми: до account ready они по-прежнему защищены существующим host/server auth; этот namespace не добавляет права списания. Новая игровая интеграция обязана дождаться ready для account-scoped queue/save. При unknown не выдавать новый operationId для обхода старой очереди. Stage B cloud save/baseRevision/submission/consume ещё не реализован: [review БД](../supabase/ACCOUNT_SAVE_CONTRACT_REVIEW.md).
