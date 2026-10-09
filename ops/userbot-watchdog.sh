#!/usr/bin/env bash
#
# Userbot watchdog: пингует /health, при двух подряд фейлах рестартует
# процесс через единый production-контур и шлёт алерт в Telegram админу.
#
# Запускается cron'ом раз в минуту:
#   * * * * * /var/www/NAVALIVAY/ops/userbot-watchdog.sh >> /var/log/navalivay-watchdog.log 2>&1
#
# Параметры через env (или /etc/default/navalivay-watchdog, если кому надо):
#   WATCHDOG_BOT_TOKEN  токен Telegram-бота для алертов (можно тот же BOT_TOKEN)
#   WATCHDOG_ADMIN_ID   chat_id админа, куда слать алерты
#   USERBOT_HTTP_PORT   порт userbot HTTP API (по умолчанию 8083)
#   WATCHDOG_STATE_FILE файл состояния (default: /var/lib/navalivay/userbot-watchdog.state)
#
# Логика двух фейлов подряд защищает от ложных тревог при кратком
# сетевом флапе или пока userbot переподключается после FloodWait.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${USERBOT_HTTP_PORT:-8083}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
STATE_FILE="${WATCHDOG_STATE_FILE:-/var/lib/navalivay/userbot-watchdog.state}"
ALERT_COOLDOWN_SEC=900  # не спамим алертами чаще раза в 15 минут

ADMIN_ID="${WATCHDOG_ADMIN_ID:-}"
BOT_TOKEN="${WATCHDOG_BOT_TOKEN:-}"

# Подгрузим .env проекта, если переменные не выставлены — там лежит BOT_TOKEN.
if [ -z "$BOT_TOKEN" ] && [ -f /var/www/NAVALIVAY/server/.env ]; then
  # shellcheck disable=SC1091
  set -a
  . /var/www/NAVALIVAY/server/.env
  set +a
  BOT_TOKEN="${WATCHDOG_BOT_TOKEN:-${BOT_TOKEN:-}}"
  ADMIN_ID="${WATCHDOG_ADMIN_ID:-${ADMIN_TELEGRAM_ID:-}}"
fi

now_ts() { date +%s; }

state_dir="$(dirname "$STATE_FILE")"
[ ! -L "$state_dir" ] || { echo "[watchdog] unsafe state directory" >&2; exit 1; }
if [ ! -e "$state_dir" ]; then mkdir -- "$state_dir"; chmod 0750 "$state_dir"; fi
[ -d "$state_dir" ] || { echo "[watchdog] state path is not a directory" >&2; exit 1; }
[ "$(stat -c %u "$state_dir")" = "$(id -u)" ] || { echo "[watchdog] wrong state directory owner" >&2; exit 1; }
state_mode="$(stat -c %a "$state_dir")"
(( (8#$state_mode & 8#022) == 0 )) || { echo "[watchdog] state directory is writable by group or others" >&2; exit 1; }
[ ! -L "$STATE_FILE" ] || { echo "[watchdog] state file must not be a symlink" >&2; exit 1; }
if [ -e "$STATE_FILE" ]; then
  [ -f "$STATE_FILE" ] && [ "$(stat -c %u "$STATE_FILE")" = "$(id -u)" ] && [ "$(stat -c %h "$STATE_FILE")" = 1 ] || {
    echo "[watchdog] unsafe state file" >&2
    exit 1
  }
fi

read_state_field() {
  local field="$1"
  if [ -f "$STATE_FILE" ]; then
    grep -E "^${field}=" "$STATE_FILE" | tail -n1 | cut -d= -f2- || true
  fi
}

write_state() {
  local fails="$1" last_alert="$2" temp="${STATE_FILE}.tmp.$$"
  (umask 077; printf 'fails=%s\nlast_alert=%s\n' "$fails" "$last_alert" >"$temp")
  mv -- "$temp" "$STATE_FILE"
}

send_alert() {
  local text="$1"
  if [ -z "$BOT_TOKEN" ] || [ -z "$ADMIN_ID" ]; then
    echo "[watchdog] no BOT_TOKEN/ADMIN_ID, skipping Telegram alert" >&2
    return 0
  fi
  # Алерт-бот сам ходит в Telegram через прокси (тот же путь, что navalivay-bot).
  # Используем proxychains для согласованности — в /etc/proxychains4.conf он уже есть.
  local payload
  payload=$(printf '{"chat_id":"%s","text":%s,"parse_mode":"HTML","disable_web_page_preview":true}' \
    "$ADMIN_ID" \
    "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
  if command -v proxychains4 >/dev/null 2>&1; then
    proxychains4 -q curl -fsS -m 10 \
      -H 'Content-Type: application/json' \
      -d "$payload" \
      "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" >/dev/null || true
  else
    curl -fsS -m 10 \
      -H 'Content-Type: application/json' \
      -d "$payload" \
      "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" >/dev/null || true
  fi
}

# Пингуем health (короткий таймаут — userbot должен отвечать мгновенно,
# это локальный HTTP без сетевых хопов).
http_ok=false
response=""
if response=$(curl -fsS -m 3 "$HEALTH_URL" 2>/dev/null); then
  if echo "$response" | grep -q '"connected":true'; then
    http_ok=true
  fi
fi

prev_fails="$(read_state_field fails)"
prev_fails="${prev_fails:-0}"
last_alert="$(read_state_field last_alert)"
last_alert="${last_alert:-0}"
[[ "$prev_fails" =~ ^[0-9]+$ ]] || prev_fails=0
[[ "$last_alert" =~ ^[0-9]+$ ]] || last_alert=0

if $http_ok; then
  # Сбрасываем счётчик при первом успехе после серии фейлов и
  # шлём recovery-алерт.
  if [ "$prev_fails" -ge 2 ]; then
    send_alert "<b>userbot recovered</b>%0A$(hostname): /health connected:true"
  fi
  write_state 0 "$last_alert"
  exit 0
fi

new_fails=$((prev_fails + 1))
echo "[watchdog] $(date -Iseconds) FAIL #${new_fails}: response='${response}'"

# Первый фейл — записываем и ждём следующего цикла. Может быть транзиент.
if [ "$new_fails" -lt 2 ]; then
  write_state "$new_fails" "$last_alert"
  exit 0
fi

# Два фейла подряд — просим единый production-контур выполнить рестарт.
echo "[watchdog] restarting userbot via ops/prod.sh..."
if ! bash "${SCRIPT_DIR}/prod.sh" restart userbot >/dev/null 2>&1; then
  echo "[watchdog] restart skipped or failed (deploy lock may be held)"
fi

# Алерт с rate-limit, чтобы не спамить ночью при долгом инциденте.
ts=$(now_ts)
since_alert=$(( ts - last_alert ))
if [ "$since_alert" -ge "$ALERT_COOLDOWN_SEC" ]; then
  pm2_status=$(pm2 jlist 2>/dev/null | python3 -c '
import json, sys
try:
  data = json.load(sys.stdin)
except Exception:
  print("(pm2 jlist failed)")
  sys.exit(0)
for p in data:
  if p.get("name") == "navalivay-userbot":
    pm2_env = p.get("pm2_env", {})
    print(f"status={pm2_env.get(\"status\")} restarts={pm2_env.get(\"restart_time\")} unstable={pm2_env.get(\"unstable_restarts\")}")
    break
else:
  print("(navalivay-userbot not in PM2)")
' 2>/dev/null || echo "(jlist parse failed)")
  send_alert "<b>userbot DOWN</b>%0A$(hostname): /health failing 2x.%0A${pm2_status}%0Acheck: ./ops/prod.sh logs userbot"
  write_state "$new_fails" "$ts"
else
  write_state "$new_fails" "$last_alert"
fi
