#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="${NAVALIVAY_PROJECT_DIR:-/var/www/NAVALIVAY}"
failures=0
warnings=0

fail() { echo -e "${RED}FAIL:${NC} $1"; failures=$((failures + 1)); }
warn() { echo -e "${YELLOW}WARN:${NC} $1"; warnings=$((warnings + 1)); }
ok() { echo -e "${GREEN}OK:${NC} $1"; }

port_pid() {
  lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

pm2_value() {
  local name="$1" field="$2"
  pm2 jlist 2>/dev/null | python3 -c '
import json, sys
name, field = sys.argv[1:]
for app in json.load(sys.stdin):
    if app.get("name") == name:
        value = app.get("pm2_env", {}).get(field) if field != "pid" else app.get("pid")
        print("" if value is None else value)
        break
' "$name" "$field" 2>/dev/null || true
}

dump_has() {
  local name="$1"
  python3 -c '
import json, sys
name=sys.argv[1]
with open(sys.argv[2], encoding="utf-8") as fh:
    apps=json.load(fh)
raise SystemExit(0 if any(app.get("name")==name for app in apps) else 1)
' "$name" /root/.pm2/dump.pm2 2>/dev/null
}

check_pm2_app() {
  local name="$1" expected_script="$2" expected_cwd="${3:-}" status script cwd
  status="$(pm2_value "$name" status)"
  script="$(pm2_value "$name" pm_exec_path)"
  cwd="$(pm2_value "$name" pm_cwd)"
  if [ "$status" = "online" ]; then ok "PM2 $name online"; else fail "PM2 $name не online"; fi
  if [ "$script" = "$expected_script" ]; then ok "$name запускает $expected_script"; else fail "$name запускает ${script:-неизвестный файл}, ожидали $expected_script"; fi
  if [ -n "$expected_cwd" ]; then
    if [ "$cwd" = "$expected_cwd" ]; then ok "$name cwd правильный"; else fail "$name cwd=${cwd:-неизвестен}"; fi
  fi
}

echo "=== NAVALIVAY prod runtime check ==="

for command in systemctl lsof curl pm2 python3; do
  command -v "$command" >/dev/null 2>&1 || fail "не найдена команда $command"
done

if systemctl is-active --quiet navalivay-server 2>/dev/null; then ok "navalivay-server active"; else fail "navalivay-server не active"; fi
if systemctl is-enabled --quiet navalivay-server 2>/dev/null; then ok "navalivay-server enabled"; else fail "navalivay-server не enabled"; fi

main_pid="$(systemctl show navalivay-server -p MainPID --value 2>/dev/null || true)"
listen_pid="$(port_pid 8082)"
if [ -z "$listen_pid" ]; then
  fail "порт 8082 никто не слушает"
elif [ -n "$main_pid" ] && [ "$main_pid" != "0" ] && [ "$listen_pid" = "$main_pid" ]; then
  ok ":8082 PID $listen_pid совпадает с systemd MainPID"
else
  fail ":8082 PID=$listen_pid, systemd MainPID=$main_pid"
fi

if curl -fsS -m 3 http://127.0.0.1:8082/api/health >/dev/null 2>&1; then ok "API health успешен"; else fail "API health не отвечает"; fi
poll_code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:8082/api/admin/crm/orders/poll-summary || true)"
if [ "$poll_code" = "401" ]; then ok "защищённый API без токена возвращает 401"; else warn "защищённый API вернул HTTP ${poll_code:-000}, ожидали 401"; fi

if command -v pm2 >/dev/null 2>&1; then
  check_pm2_app navalivay-bot "$PROJECT_DIR/server/bot.js" "$PROJECT_DIR/server"
  check_pm2_app navalivay-userbot "$PROJECT_DIR/server/userbot/start.sh"
  if [ -n "$(pm2_value navalivay-api status)" ]; then fail "navalivay-api присутствует в PM2"; else ok "API отсутствует в PM2"; fi
else
  fail "PM2 недоступен"
fi

if systemctl is-active --quiet pm2-root 2>/dev/null; then ok "PM2 автозапуск active"; else fail "PM2 автозапуск не active"; fi
if systemctl is-enabled --quiet pm2-root 2>/dev/null; then ok "PM2 автозапуск enabled"; else fail "PM2 автозапуск не enabled"; fi

if [ -r /root/.pm2/dump.pm2 ]; then
  for name in navalivay-bot navalivay-userbot; do
    if dump_has "$name"; then ok "$name сохранён в PM2 автозапуске"; else fail "$name отсутствует в PM2 автозапуске"; fi
  done
  if dump_has navalivay-api; then fail "API сохранён в PM2 автозапуске"; else ok "API отсутствует в PM2 автозапуске"; fi
else
  fail "не найден /root/.pm2/dump.pm2"
fi

if curl -fsS -m 3 http://127.0.0.1:8083/health 2>/dev/null | grep -q '"connected":true'; then ok "userbot health connected:true"; else fail "userbot не подключён"; fi

bot_unit_state="$(systemctl is-enabled navalivay-bot.service 2>/dev/null || true)"
if [ "$bot_unit_state" = "masked" ]; then ok "navalivay-bot.service masked"; else fail "navalivay-bot.service не masked (состояние: ${bot_unit_state:-неизвестно})"; fi
if systemctl is-active --quiet navalivay-bot.service 2>/dev/null; then fail "navalivay-bot.service active, возможен дубль"; else ok "navalivay-bot.service не active"; fi

echo
echo "Итого: failures=$failures warnings=$warnings"
[ "$failures" -eq 0 ] && [ "$warnings" -eq 0 ]
