# Dev Telegram Mock

Утилита для тестирования клиентского интерфейса в обычном браузере без реального Telegram Mini App.

## Использование

Открыть фронт с query-параметром `telegram_id` (или короткое `as`):

```
http://localhost:5173/?telegram_id=835143827
http://localhost:5173/wheel?as=835143827
http://localhost:5173/checkout?telegram_id=835143827&username=ivan&first_name=Ivan
```

После применения:

- В URL параметры удаляются автоматически (чтобы не мешать роутингу).
- Identity сохраняется в `sessionStorage` под ключом `navalivay_dev_telegram_mock`,
  поэтому SPA-переходы между страницами продолжают работать.
- В `window.Telegram.WebApp` инжектится минимальный мок с заполненным
  `initDataUnsafe.user.id` (и `username`/`first_name`, если переданы).
- В левом нижнем углу появляется красный баннер `dev mock: tg_id=…` —
  визуальный индикатор, что вы в режиме эмуляции. Клик по баннеру = очистить мок.

## Поддерживаемые query-параметры

| Параметр       | Алиас | Назначение                                                |
| -------------- | ----- | --------------------------------------------------------- |
| `telegram_id`  | `as`  | Telegram user id (число)                                  |
| `username`     | —     | Telegram username (без `@`), опционально                  |
| `first_name`   | —     | Имя, опционально (по умолчанию `Dev User <id>`)           |

## Очистка

В DevTools console:

```js
clearDevTelegramMock()
```

или вручную:

```js
sessionStorage.removeItem('navalivay_dev_telegram_mock')
location.reload()
```

Либо просто кликнуть по баннеру в левом нижнем углу.

## Безопасность

Мок завёрнут в `if (!import.meta.env.DEV) return` — Vite на этапе production build
заменяет это выражение константой и весь код функции вырезается минификатором.
После `npm run build-only` в `frontend/dist/` ни одно из имён
(`applyDevTelegramMockIfNeeded`, `clearDevTelegramMock`, `navalivay_dev_telegram_mock`,
`navalivay-dev-mock-banner`, `Dev User`) не встречается.

Реализация: `frontend/src/utils/devTelegramMock.ts`, точка вызова: `frontend/src/main.ts`
(до монтирования приложения).

## Когда мок НЕ применяется

- В production build (`import.meta.env.DEV === false`).
- Если на странице уже есть реальный `window.Telegram.WebApp.initData` (не пустой) —
  в этом случае мок ничего не перезаписывает.
- Если в URL не было `?telegram_id=` / `?as=` И в `sessionStorage` ничего не сохранено.

Иными словами: открыли фронт без параметра — поведение ровно как в Mini App
(или 401 от бэка, как и было). Параметр нужно передать один раз — дальше
identity жива до закрытия вкладки или вызова `clearDevTelegramMock()`.

## Отзывы на проде

Для проверки после деплоя на production см. [`docs/review-qa-checklist.md`](review-qa-checklist.md) — whitelist юзернеймов в CRM и чеклист A–G.

## Отзывы и «Мои заказы» (local dev)

1. Поднять dev-стек: `npm run dev` (frontend + API).
2. Создать смешанный демо-заказ (жидкости + расходники + снюс + устройства):

```bash
node server/scripts/seed-dev-reviews-demo.js
```

Карточка в «Мои заказы» покажет **«Жидкости и ещё 3»** и до 4 иконок категорий.
Флаг `--simple` — только 2 линейки без микса категорий.

3. Открыть с моком (один раз на вкладку):

```
http://localhost:5173/?telegram_id=900000001&username=review_demo&first_name=Review%20Demo
```

4. Проверить поток:
   - dock со звёздами на главной;
   - Профиль → «Мои заказы» → деталь заказа → форма отзыва;
   - CRM → `/admin/crm/reviews` (модерация).

Можно использовать реального клиента с `delivered`-заказом, например:

```
http://localhost:5173/?telegram_id=2035055116&username=rk0ff
```

Повторный демо-заказ для того же `telegram_id`:

```bash
node server/scripts/seed-dev-reviews-demo.js --telegram-id=900000001 --reset
```
