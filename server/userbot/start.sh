#!/usr/bin/env bash
#
# Wrapper для PM2: запускает userbot через proxychains4.
# Telegram блокируется на хосте, поэтому весь MTProto-трафик идёт через
# HTTP-прокси, описанный в /etc/proxychains4.conf.
#
# Зачем proxychains4 (а не GramJS proxy option):
#   - GramJS proxy через socks работает, но пароль придётся хранить в .env.
#     proxychains читает /etc/proxychains4.conf (root: chmod 600), и
#     пароль не светится в env процесса (никто не увидит через `pm2 env`,
#     `cat /proc/<pid>/environ`).
#   - проще менять прокси без рестартов чужих сервисов и без правок в коде.
#
# Управление на production: ./ops/prod.sh restart userbot
#
set -euo pipefail

# Защита от запуска не из проектной директории — start.sh использует
# относительные пути дальше.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "${SCRIPT_DIR}")"
cd "${SERVER_DIR}"

# Sanity-check: proxychains4 установлен? Если apt-package сдох после
# переустановки сервера — упадём с понятной ошибкой, а не молчаливо
# полезем в Telegram напрямую и получим таймауты MTProto.
if ! command -v proxychains4 >/dev/null 2>&1; then
  echo '[userbot/start.sh] FATAL: proxychains4 not installed' >&2
  echo '  install: sudo apt-get update && sudo apt-get install -y proxychains4' >&2
  exit 127
fi

if [ ! -r /etc/proxychains4.conf ]; then
  echo '[userbot/start.sh] FATAL: /etc/proxychains4.conf is not readable' >&2
  exit 78  # EX_CONFIG
fi

# Sanity-check сессии: если файла нет, нет смысла стартовать —
# index.js всё равно вылетит с exit 1, лучше дать чёткий сигнал.
SESSION_FILE="${SERVER_DIR}/data/userbot.session"
if [ ! -s "${SESSION_FILE}" ]; then
  echo "[userbot/start.sh] FATAL: ${SESSION_FILE} is missing or empty" >&2
  echo '  run: PHONE=+375XXXXXXXXX node userbot/login.js' >&2
  exit 78  # EX_CONFIG
fi

# `-q` отключает баннер proxychains в логах. exec, чтобы PM2 видел node-PID
# как PID процесса (для корректных SIGTERM/SIGKILL).
exec proxychains4 -q node "${SERVER_DIR}/userbot/index.js"
