# Userbot через MTProto (GramJS)

Авто-уведомления клиенту от лица аккаунта менеджера, без 24-часового окна
Telegram Business.

## Зачем

Telegram Business для ботов имеет жёсткое ограничение:
`BusinessBotRights.can_reply` действует **только в чатах с входящим
сообщением за последние 24 часа** ([core.telegram.org/bots/api](https://core.telegram.org/bots/api)).
Клиент молчит сутки → бот не может писать → менеджер видит
`BUSINESS_PEER_USAGE_MISSING`.

Userbot работает как обычный Telegram-клиент (типа iMe или Telegram X)
от имени аккаунта менеджера через MTProto. У него этого ограничения нет
— как и у любого другого Telegram-клиента.

Риск: формальная серая зона ToS Telegram. Митигируется консервативными
лимитами (1 сообщение/секунду, только триггеры на статусы, никаких
массовых рассылок).

## Архитектура

```
┌─────────────────────┐    HTTP 127.0.0.1:8083   ┌────────────────────┐
│ API (systemd)       │ ────────────────────────►│ navalivay-userbot  │
│ Express endpoints   │                          │ (PM2, GramJS)      │
│ auto-notify         │                          │                    │
│ /bot/send-custom    │ ◄──── auto-fallback ──── │ MTProto ↔ Telegram │
└─────────────────────┘    при недоступности     └────────────────────┘
                            (Business mode)              ↑
                                                         │ proxychains4
                                                         │ /etc/proxychains4.conf
```

- API процесс — Express endpoints (как сейчас).
- Userbot процесс — отдельный PM2-сервис, держит постоянное MTProto-
  соединение, слушает `NewMessage` от клиентов и логирует входящие в
  `bot_message_log` (`direction='in'`, `meta.source='userbot'`).
- Локальный HTTP API на 127.0.0.1:8083 для приёма команд от api.
- Если userbot недоступен (health-check 127.0.0.1:8083/health) —
  auto-notify фоллбэкается на Business mode (Bot API через прокси).
- MTProto-трафик идёт через HTTP-прокси, прописанный в
  `/etc/proxychains4.conf` (логин/пароль не светится в env процесса).

## Файлы

- `server/userbot/client.js` — конструктор GramJS клиента. Сессия
  лежит в `server/data/userbot.session` (в gitignore, chmod 600).
- `server/userbot/login.js` — CLI скрипт одноразовой SMS-авторизации
  (non-interactive flow через файлы `userbot.code` / `userbot.password`).
- `server/userbot/index.js` — основной процесс: слушает Telegram updates,
  логирует входящие, поднимает HTTP API для отправки.
- `server/userbot/start.sh` — wrapper: `proxychains4 -q node index.js`.
  PM2 запускает именно его.
- `server/utils/userbot-client.js` — bridge от api-процесса к userbot
  через локальный HTTP, с health-кэшем (30с success / 10с failure).
- `server/ecosystem.config.cjs` — PM2-конфиг бота и userbot. API в нём
  намеренно отсутствует.
- `ops/userbot-watchdog.sh` — cron-watchdog, при двух фейлах /health
  просит `ops/prod.sh` перезапустить userbot и шлёт алерт админу.
- `ops/backup.sh` — бэкап БД, .env, **userbot.session** (с GPG-шифром
  если задан `BACKUP_GPG_RECIPIENT`), proxychains4.conf.
- Интеграции:
  - `server/utils/auto-notify.js` — пробует userbot first, fallback на Business mode
  - `server/routes/crm.js` `/bot/send-custom` — то же самое для свободных сообщений

## Env переменные

В `server/.env` (на проде уже добавлены):

- `TELEGRAM_API_ID` — число, выдано через [my.telegram.org](https://my.telegram.org)
- `TELEGRAM_API_HASH` — длинная строка, выдана там же
- `USERBOT_HTTP_PORT` — опционально, по умолчанию 8083
- `USERBOT_SECRET` — опционально, shared secret для X-Userbot-Secret заголовка

Для watchdog (`ops/userbot-watchdog.sh`) — может переиспользовать `BOT_TOKEN`
и `ADMIN_TELEGRAM_ID` из основного `.env`, либо переопределить через
`WATCHDOG_BOT_TOKEN` / `WATCHDOG_ADMIN_ID`.

Для бэкапа — опциональный `BACKUP_GPG_RECIPIENT=fingerprint` для
шифрования `userbot.session` в архивах.

## Развёртывание с нуля (после переустановки сервера)

### 1. Зависимости OS

```bash
sudo apt-get update
sudo apt-get install -y proxychains4 gpg python3 curl
# node + npm — через nvm или nodesource, как у вас принято
# pm2: sudo npm install -g pm2
```

### 2. proxychains4 конфиг

```bash
sudo tee /etc/proxychains4.conf >/dev/null <<'EOF'
strict_chain
proxy_dns
remote_dns_subnet 224
tcp_read_time_out 15000
tcp_connect_time_out 8000
[ProxyList]
http  85.209.177.43  50100  psychewebmaster  ВАШ_ПАРОЛЬ
EOF
sudo chmod 600 /etc/proxychains4.conf
```

Проверка: `proxychains4 -q curl -fsS https://api.ipify.org` — должна
вернуть IP прокси, не вашего сервера.

### 3. Код и зависимости

Код выкладывается только по единому регламенту
[`DEPLOY_REBUILD_RESTART.md`](DEPLOY_REBUILD_RESTART.md).

### 4. .env

```bash
cp /path/to/backup/.env /var/www/NAVALIVAY/server/.env
chmod 600 /var/www/NAVALIVAY/server/.env
```

Минимум обязательных переменных:
- `BOT_TOKEN` — Telegram Bot API
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — userbot MTProto
- `USERBOT_SECRET` — пара api/userbot
- `JWT_SECRET`, `ADMIN_TELEGRAM_ID` — auth

### 5. Восстановить userbot.session

Если есть бэкап — расшифровать и положить:
```bash
gpg --decrypt /backup/userbot.session.gpg > /var/www/NAVALIVAY/server/data/userbot.session
chmod 600 /var/www/NAVALIVAY/server/data/userbot.session
```

Если бэкапа нет — пройти SMS-флоу заново:
```bash
cd /var/www/NAVALIVAY/server
PHONE=+375XXXXXXXXX node userbot/login.js &
# В отдельном терминале, когда придёт код от Telegram:
echo "12345" > data/userbot.code
# Если 2FA включена:
echo "your-cloud-password" > data/userbot.password
# Скрипт сам подберёт файлы (polling каждые 2с) и удалит после прочтения.
```

### 6. Управление процессом

Production-схема и команды находятся только в
[`DEPLOY_REBUILD_RESTART.md`](DEPLOY_REBUILD_RESTART.md). Для проверки после
настройки используйте `./ops/prod.sh doctor`.

### 7. PM2 logrotate (одноразово, иначе логи userbot забьют диск)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

### 8. Watchdog в cron

```bash
chmod +x /var/www/NAVALIVAY/ops/userbot-watchdog.sh
sudo touch /var/log/navalivay-watchdog.log
sudo chown $USER /var/log/navalivay-watchdog.log
crontab -e
# Добавить:
* * * * * /var/www/NAVALIVAY/ops/userbot-watchdog.sh >> /var/log/navalivay-watchdog.log 2>&1
```

### 9. Smoke-test

```bash
curl -fsS http://127.0.0.1:8083/health         # {ok:true, connected:true}
curl -fsS http://127.0.0.1:8082/api/health     # API
./ops/prod.sh doctor                           # вся схема процессов исправна
proxychains4 -q curl -s https://api.ipify.org  # IP прокси
```

## Operational runbook

### Где смотреть логи

| Что | Команда |
|---|---|
| Логи userbot | `./ops/prod.sh logs userbot` |
| Только ошибки | `tail -f /var/www/NAVALIVAY/server/logs/userbot-error.log` |
| Watchdog | `tail -f /var/log/navalivay-watchdog.log` |
| Файлы PM2 | `~/.pm2/logs/` (но мы переопределили в `out_file`/`error_file` ecosystem) |

### Restart policy

PM2 настроен:
- `min_uptime: 30s` — счётчик рестартов сбрасывается после 30с uptime
- `max_restarts: 10` — после 10 быстрых рестартов процесс уходит в `errored`
- `restart_delay: 5s` — пауза между рестартами
- `autorestart: true` — рестартует при non-zero exit

В `errored` сам не выйдет — нужен `./ops/prod.sh restart userbot`.
Watchdog поднимет алерт, что упало.

### Что делать при разных сбоях

| Симптом | Причина | Действие |
|---|---|---|
| `/health` отвечает `connected:false` | разрыв MTProto / прокси отвалился | подождать 30с, затем `./ops/prod.sh restart userbot` |
| Все запросы дают `FLOOD_WAIT_X` | Telegram rate-limit на аккаунт | подождать X секунд, проверить нет ли массовых рассылок в логах |
| `AUTH_KEY_UNREGISTERED` в логе | сессия инвалидирована (другой клиент завершил все сеансы) | пройти SMS-флоу заново (см. шаг 5 выше) |
| Процесс `errored` | 10 крэшей подряд | `./ops/prod.sh logs userbot`, устранить причину, затем `./ops/prod.sh restart userbot` |
| start.sh: `proxychains4 not installed` | пакет потерялся | `sudo apt-get install -y proxychains4` |
| `data/userbot.session is missing or empty` | сессия удалена / пустой файл | восстановить из бэкапа или пройти SMS-флоу |
| Watchdog шлёт алерты постоянно | userbot реально не может стартануть | проверить /etc/proxychains4.conf (пароль не протух?), `proxychains4 -q curl https://api.ipify.org` |

### Откат / выключение

Чтобы отключить userbot и вернуться к pure Business mode:
```bash
pm2 stop navalivay-userbot
```
Auto-notify сам сфоллбэкается на Business mode (health-check вернёт false
через 1.5с таймаут, кэш на 10с — следующие отправки идут сразу мимо userbot).
Никаких изменений в коде не нужно.

### Если Telegram разлогинит сессию

В Telegram-приложении: `Настройки → Активные сеансы → Завершить
другие сеансы` — это убьёт нашу сессию. Симптом: userbot процесс
получит ошибку `AUTH_KEY_UNREGISTERED` при следующем запросе. Решение:
```bash
pm2 stop navalivay-userbot
rm /var/www/NAVALIVAY/server/data/userbot.session
cd /var/www/NAVALIVAY/server
PHONE=+375XXXXXXXXX node userbot/login.js
# (см. SMS-флоу в шаге 5)
./ops/prod.sh restart userbot
```

## Безопасность

| Что | Где живёт | Защита |
|---|---|---|
| `userbot.session` (= ключ к Telegram-аккаунту менеджера) | `server/data/userbot.session` | gitignore, chmod 600, GPG-шифр в бэкапах |
| `TELEGRAM_API_ID` / `_API_HASH` | `server/.env` | gitignore, chmod 600 |
| `USERBOT_SECRET` | `server/.env` | gitignore, chmod 600 |
| Прокси login/password | `/etc/proxychains4.conf` | chmod 600, не в env, не в репо |
| `BOT_TOKEN` | `server/.env` | gitignore, chmod 600 |
| HTTP API userbot | `127.0.0.1:8083` | bind на loopback + опц. shared secret в заголовке |

**Что улучшить дальше** (если будет время):
- Перенести секреты из `.env` в HashiCorp Vault или `systemd-creds` —
  тогда они не светятся даже в `cat /proc/<pid>/environ`.
- Ротация `USERBOT_SECRET` (сейчас не вращается; не критично, т.к.
  доступен только с loopback).
- Алерт на пропадание `userbot.session` (например, file integrity check
  через `aide` / `auditd`).
- Перенести `userbot.session` на encrypted volume (LUKS) — тогда
  украденный диск не сможет быть использован для угона аккаунта.

## Idempotency и deploy

- `git pull` не трогает `server/data/userbot.session` (в gitignore)
- `git pull` не трогает `server/.env` (в gitignore)
- `git pull` не трогает `/etc/proxychains4.conf` (вне репо)
- `npm ci --production` — детерминированно, по lock-файлу
- Деплой по полному SHA и выбор рестартов выполняет `ops/prod.sh`.
- После рестарта проверьте `curl -fsS http://127.0.0.1:8083/health` — ожидается
  `"connected":true`. Если userbot не поднялся, auto-notify уйдёт в очередь retry.
