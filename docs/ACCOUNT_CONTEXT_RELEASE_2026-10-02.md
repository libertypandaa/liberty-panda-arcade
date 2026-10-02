# Контекст аккаунта LPA — выпуск 2026.10.02.3

Статус: опубликовано и проверено на публичном GitHub Pages. Baseline сайта — `8b9b8a3deb035170188f7e089c855ad7069e7df6`; remote main сверён перед работой. Прежний опубликованный выпуск — `2026.10.02.2`.

## Границы

Этап A подготавливает проверяемый контекст аккаунта и отдельное пространство локальных сохранений для агента Crystal Front. Код игры, существующий legacy save, игровая сборка и серверная экономика этим выпуском не изменяются. Продажи, реклама, синхронизация облачных сохранений и импорт старого прогресса не включаются.

Новый `account-context-host.js` подключён на главной странице и четырёх страницах игры/установки после `game-player.js`, перед экономическим bridge. Инициализация Auth завершается через согласованный lifecycle обработчик host. Три service worker включают новый точный shared asset. Query-версия — `20261002-3`, версия cache — `2026-10-02-3`. Нет принудительного `skipWaiting`, `clients.claim` или перезагрузки активной игры.

## Артефакт агента игры

- Проверенная SDK-версия: `LibertyPanda.version === '1.1.0'`.
- Локальный путь: `C:/Users/liber/OneDrive/Documents/ChatGPT/Сайт/docs/game-platform-sdk.js`.
- Проверенный публичный URL: `https://libertypandaa.github.io/liberty-panda-arcade/game-platform-sdk.js?v=20261002-3`.
- Code commit: e9a4b767d95c540385b359d90617c4375a5648dc. Неизменяемый SDK URL: https://raw.githubusercontent.com/libertypandaa/liberty-panda-arcade/e9a4b767d95c540385b359d90617c4375a5648dc/docs/game-platform-sdk.js . Query-параметр Pages не закрепляет содержимое.

Игровому агенту передаётся фиксированная копия SDK из конкретного commit. Подробный account contract и последовательность этапа A находятся в передаче Crystal Front; документ не разрешает использовать непривилегированный контекст как серверное доказательство личности.

## Приёмка и публикация

QA завершён; scoped code commit и обычный push main выполнены. Sandbox server, его README и восстановленные каталоги исключены. GitHub Pages run 37041925152 завершён success: https://github.com/libertypandaa/liberty-panda-arcade/actions/runs/37041925152 . Public version.json возвращает 2026.10.02.3/account-context-v1. SDK, account host, пять HTML entrypoints и три service worker совпадают с проверенными исходниками после нормализации CRLF/LF.

Реальный Google/OTP, физические телефоны/Safari и внедрение в Crystal Front не подтверждаются фикстурами. Полноценный offline account bootstrap и серверные accepted saves не объявляются готовыми.

## Финальная локальная проверка

2 октября 2026: последовательный запуск node --test --test-concurrency=1 tests/*.test.cjs — 104/104 PASS, 0 skipped. Включены 18 браузерных integration cases с реальными host/SDK и контролируемыми Auth/game fixtures: повторный вход, разные аккаунты/игры, A→B→A и поздние ответы, expiry/401, отсутствие контекста, offline revalidation, все пять HTML entrypoints, pagehide, безопасный Exit и async-write fence перед commit. Исправлены две тестовые фикстуры: ожидаемая cache query version и единые fake clock timestamps. Производственная логика ради прохождения тестов не ослаблялась. git diff --check без ошибок.
