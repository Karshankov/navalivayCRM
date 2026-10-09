# NAVALIVAY - E-commerce Platform with Telegram Mini App

## Project Overview

A full-featured e-commerce platform for a vape shop with:
- **Frontend**: Vue 3 + Vite + TypeScript customer app and admin panel
- **Backend**: Node.js + Express API server
- **Bot**: Telegram bot integration
- **Database**: SQLite with migrations
- **Deployment**: API в systemd, bot и userbot в PM2; управление только через `ops/prod.sh`

## Architecture

### Frontend (`frontend/`)
- Vue 3 application with customer-facing Telegram Mini App
- Admin panel for product/category/order management
- Built with Vite, TypeScript, and UnoCSS

### Backend (`server/`)
- Express.js REST API server
- SQLite database with migration support
- Image upload and processing
- Telegram WebApp authentication

### Bot (`server/bot.js`)
- Telegram bot for notifications and integration
- Optional production service depending on server setup
- Uses `BASE_URL` for `web_app` buttons and default menu button; does not replace storefront URLs with `t.me` links
- See `docs/telegram-mini-app.md` for `TELEGRAM_BOT_USERNAME`, `TELEGRAM_MINI_APP_SHORT_NAME`, and Mini App open behavior (no forced `expand()`)

## Development

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Install dependencies
```bash
npm install
npm --prefix frontend install
npm --prefix server install
```

### Run in development
```bash
# All services
npm run dev

# Individual services
npm run dev:frontend
npm run dev:server
npm run dev:bot
```

## Production Build

На production сборку и нужные рестарты определяет только `ops/prod.sh`.
Локальные команды разработки не являются инструкцией по выкладке.

## Production Deployment

Production deploy: [`docs/DEPLOY_REBUILD_RESTART.md`](docs/DEPLOY_REBUILD_RESTART.md). Использовать только `ops/prod.sh` и полный SHA.

## Production Process Management

| Компонент | Production runtime |
|---|---|
| API | systemd `navalivay-server` |
| Telegram-бот | PM2 `navalivay-bot` |
| Userbot | PM2 `navalivay-userbot` |

Прямые команды диспетчеров не использовать. Команды `doctor`, `plan`, `deploy`, `restart` и `logs` описаны в едином регламенте выше.

## File Structure

```
NAVALIVAY/
├── frontend/          # Vue.js frontend application
├── server/            # Node.js backend and bot
├── ops/               # Deployment and operations
│   ├── backup.sh      # Database backup script
│   └── monitor.sh     # Health monitoring script
├── deploy/            # Вспомогательные файлы окружения
├── uploads/           # User uploaded files
└── docs/              # Documentation
```

## Important Notes

### Frontend build nuance
На production используется сборка внутри `ops/prod.sh`; вручную её не запускать.

### vite-plugin-vue-devtools Known Issue
**CRITICAL:** `vite-plugin-vue-devtools` is disabled in `frontend/vite.config.ts` due to a RouterView compatibility issue that causes: `"TypeError: Cannot set properties of null (setting '__vrv_devtools')"`. Do not re-enable without testing thoroughly.

### Security
- Never commit `.env` files
- Keep Telegram bot tokens secure
- Use proper file permissions on `uploads/`
- Run deployment with least privilege

## Troubleshooting

### API not responding after restart
```bash
./ops/prod.sh doctor
./ops/prod.sh logs api
```

Bot unit в systemd должен быть `masked`; работой бота управляет `ops/prod.sh`.
