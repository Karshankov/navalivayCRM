# Telegram Mini App and bot integration

## Purpose

Single reference for Telegram WebApp behavior, environment variables, public settings, and wholesale deep links. Use together with `docs/wholesale-rules.md`.

## Source of truth

- Bootstrap (no forced fullscreen, wholesale `start_param`): `frontend/src/main.ts`, `frontend/src/utils/telegramMiniAppContext.ts`
- Public settings API: `GET /api/settings` in `server/routes/public.js`
- Bot (`web_app` button URL, menu button): `server/bot.js`
- Example env: `server/.env.example`
- Production-процессы и команды: [`DEPLOY_REBUILD_RESTART.md`](DEPLOY_REBUILD_RESTART.md)

## Environment variables (server)

| Variable | Role |
|----------|------|
| `NODE_ENV` | На новом проде ставится `production` после настройки сильного `SESSION_SECRET`. Защита Telegram остаётся закрытой и при пустом значении. |
| `BOT_TOKEN` | Telegram bot token (required for bot) |
| `BASE_URL` | HTTPS storefront root for `web_app` buttons and menu (trailing slash stripped). Default `https://navalivay.store` |
| `TELEGRAM_BOT_USERNAME` | Bot username **without** `@`. Exposed in `/api/settings` as `telegram_bot_username`. Needed for `t.me/...` wholesale and mini app open links |
| `TELEGRAM_MINI_APP_SHORT_NAME` | Direct Link mini app short name from BotFather (path segment `t.me/bot/SHORT/...`). Optional; improves compact open on some clients. Exposed as `telegram_mini_app_short_name` |
| `ALLOW_INSECURE_TELEGRAM_AUTH` | Только локальная разработка: при `NODE_ENV=development` значение `1` разрешает неподписанные `telegram_id/@username`. Во всех остальных режимах игнорируется. |

Заказы, бонусы и рулетка не должны принимать один лишь `@username`: он не
доказывает личность и может оставить заказ без `customer_id`. Даже если
`NODE_ENV` по ошибке отсутствует, сервер обязан требовать подписанный
`Telegram.WebApp.initData`.

## Public settings fields

`GET /api/settings` includes (among others):

- `telegram_bot_username` - string, no `@`
- `telegram_mini_app_short_name` - string or empty

Frontend defaults for these exist in `frontend/src/stores/settings.ts` until settings load.

## UX: viewport and compact mode

- The app **does not** call `Telegram.WebApp.expand()` on boot. The client can keep a compact (half-height) sheet if the user opens the mini app that way (e.g. BotFather links with `mode=compact`).
- `ready()` is still called where needed.

## Wholesale deep links

- In-app path remains: `/opt/:code/:secret` (HTTP router).
- For sharing **inside Telegram**, the app builds `https://t.me/<bot>?startapp=<param>&mode=compact` or, if `telegram_mini_app_short_name` is set, `https://t.me/<bot>/<short>?startapp=<param>&mode=compact`.
- `startapp` payload for wholesale is a short base64url form prefixed with `w` (see `wholesalePairToStartParam` / `parseWholesaleStartParam`). Telegram limits `startapp` length (64 chars); oversized pairs cannot be encoded.
- On startup, `applyTelegramWholesaleStartParam` navigates to `wholesale-entry` when `initData` contains a valid wholesale `start_param`.

## Wholesale outside Telegram

- `hasTelegramMiniAppUserContext()` requires non-empty `initData` and a user id from `initDataUnsafe.user`.
- Without that (plain browser), `WholesaleEntryView` shows "open in Telegram" and optional link built from settings; checkout blocks wholesale submit until the user is in a real Mini App session.

## Bot runtime notes

- On launch, the bot sets a **menu button** (`setChatMenuButton`) to `web_app` pointing at `BASE_URL` (see `getStoreWebAppUrl()` in `bot.js`).
- Inline "open catalog" buttons use the same HTTPS storefront URL, not `t.me` mini app links.

## Admin: wholesale link copy

- `AdminWholesaleLinksPanel` copies a **Telegram** open URL (not the site absolute URL). If `telegram_bot_username` is missing, it shows a warning to configure `TELEGRAM_BOT_USERNAME`.

## Cart and catalog (related)

- `fetchAllProducts` is serialized so parallel loads do not overwrite each other; after a successful load, cart line prices can be synced from catalog (`syncItemPricesFromCatalog` in `frontend/src/stores/cart.ts`).
