#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="${NAVALIVAY_PROJECT_DIR:-/var/www/NAVALIVAY}"
RUNTIME_DIR="${NAVALIVAY_RUNTIME_DIR:-/var/lib/navalivay}"
LOCK_FILE="$RUNTIME_DIR/prod.lock"
STATE_FILE="$RUNTIME_DIR/prod-deploy.pending.json"
API_SERVICE="navalivay-server"
BOT_PROCESS="navalivay-bot"
USERBOT_PROCESS="navalivay-userbot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ОШИБКА: $*" >&2; exit 1; }
note() { echo "==> $*"; }

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "не найдена команда: $1"
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "команда требует root"
}

require_sha() {
  [[ "${1:-}" =~ ^[0-9a-fA-F]{40}$ ]] || die "нужен полный SHA из 40 шестнадцатеричных символов"
}

expect_args() { [ "$1" -eq "$2" ] || die "неверное количество аргументов"; }

prepare_secure_dir() {
  local dir="$1" owner mode
  [ ! -L "$dir" ] || die "служебный каталог не должен быть ссылкой: $dir"
  if [ ! -e "$dir" ]; then mkdir -- "$dir"; chmod 0750 "$dir"; fi
  [ -d "$dir" ] || die "служебный путь не является каталогом: $dir"
  owner="$(stat -c %u "$dir")"
  [ "$owner" = "$(id -u)" ] || die "неверный владелец служебного каталога $dir"
  mode="$(stat -c %a "$dir")"
  (( (8#$mode & 8#022) == 0 )) || die "служебный каталог доступен для записи группе или всем: $dir"
}

acquire_lock() {
  local lock_dir owner links
  need_command flock
  lock_dir="$(dirname "$LOCK_FILE")"
  prepare_secure_dir "$lock_dir"
  [ ! -L "$LOCK_FILE" ] || die "lock-файл не должен быть ссылкой: $LOCK_FILE"
  if [ ! -e "$LOCK_FILE" ]; then (umask 077; : >"$LOCK_FILE"); fi
  [ -f "$LOCK_FILE" ] || die "lock-файл не является обычным файлом"
  owner="$(stat -c %u "$LOCK_FILE")"
  links="$(stat -c %h "$LOCK_FILE")"
  [ "$owner" = "$(id -u)" ] && [ "$links" = 1 ] || die "небезопасный lock-файл $LOCK_FILE"
  chmod 0640 "$LOCK_FILE"
  exec 9>>"$LOCK_FILE"
  flock -n 9 || die "идёт деплой или другой рестарт"
}

load_pending_state() {
  [ -e "$STATE_FILE" ] || return 1
  [ ! -L "$STATE_FILE" ] || die "маркер деплоя не должен быть ссылкой: $STATE_FILE"
  PENDING_OLD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["old"])' "$STATE_FILE")"
  PENDING_TARGET="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["target"])' "$STATE_FILE")"
  PENDING_IMPACT="$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["impact"], separators=(",",":")))' "$STATE_FILE")"
  require_sha "$PENDING_OLD"
  require_sha "$PENDING_TARGET"
}

write_pending_state() (
  local old_sha="$1" target_sha="$2" data="$3" state_dir temp
  state_dir="$(dirname "$STATE_FILE")"
  prepare_secure_dir "$state_dir"
  [ ! -L "$STATE_FILE" ] || die "маркер деплоя не должен быть ссылкой: $STATE_FILE"
  temp="${STATE_FILE}.tmp.$$"
  umask 077
  printf '%s' "$data" | python3 -c '
import json, os, sys
impact=json.load(sys.stdin)
with open(sys.argv[1], "w", encoding="utf-8") as fh:
    json.dump({"old": sys.argv[2], "target": sys.argv[3], "impact": impact}, fh, separators=(",", ":"))
' "$temp" "$old_sha" "$target_sha"
  mv -- "$temp" "$STATE_FILE"
)

clear_pending_state() {
  [ ! -e "$STATE_FILE" ] || rm -- "$STATE_FILE"
}

repo_clean() {
  git -C "$PROJECT_DIR" diff --quiet --ignore-submodules -- &&
    git -C "$PROJECT_DIR" diff --cached --quiet --ignore-submodules --
}

fetch_target() {
  local sha="$1"
  git -C "$PROJECT_DIR" fetch --quiet origin master
  git -C "$PROJECT_DIR" cat-file -e "${sha}^{commit}" 2>/dev/null || die "коммит $sha не найден"
  git -C "$PROJECT_DIR" merge-base --is-ancestor "$sha" origin/master || die "$sha не входит в origin/master"
}

impact_json() {
  local old_sha="$1" target_sha="$2"
  node "$SCRIPT_DIR/prod-impact.mjs" "$PROJECT_DIR" "$old_sha" "$target_sha"
}

print_plan() {
  python3 -c '
import json, sys
p=json.load(sys.stdin)
print("Изменённые файлы:", len(p["changedFiles"]))
print("Frontend:", "сборка" if p["frontendBuild"] else "без действий")
print("Зависимости frontend:", "npm ci" if p["frontendInstall"] else "без npm ci")
print("Зависимости server:", "npm ci" if p["serverInstall"] else "без npm ci")
print("PM2-конфиг:", "применить" if p["pm2Reload"] else "без изменений")
print("Рестарты:", ", ".join(p["components"]) or "нет")
if p["blocked"]:
    print("Блокировки:")
    for item in p["blocked"]: print(" -", item)
'
}

json_field_true() {
  local field="$1"
  python3 -c "import json,sys; raise SystemExit(0 if json.load(sys.stdin).get('$field') else 1)"
}

json_components() {
  python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["components"]))'
}

json_has_blockers() {
  python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin)["blocked"] else 1)'
}

wait_api() {
  local deadline=$((SECONDS + 60))
  until curl -fsS -m 3 http://127.0.0.1:8082/api/health >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 2
  done
}

wait_pm2_online() {
  local name="$1" deadline=$((SECONDS + 60))
  until pm2 jlist 2>/dev/null | python3 -c '
import json,sys
name=sys.argv[1]
apps=json.load(sys.stdin)
raise SystemExit(0 if any(a.get("name")==name and a.get("pm2_env",{}).get("status")=="online" for a in apps) else 1)
' "$name"; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 2
  done
}

wait_userbot() {
  local deadline=$((SECONDS + 60))
  until curl -fsS -m 3 http://127.0.0.1:8083/health 2>/dev/null | grep -q '"connected":true'; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 2
  done
}

restart_component() {
  local component="$1"
  case "$component" in
    api)
      note "Рестарт API"
      if ! systemctl restart "$API_SERVICE"; then
        journalctl -u "$API_SERVICE" -n 100 --no-pager >&2 || true
        die "не удалось перезапустить API"
      fi
      wait_api || { journalctl -u "$API_SERVICE" -n 100 --no-pager >&2; die "API не прошёл health за 60 секунд"; }
      ;;
    bot)
      note "Рестарт Telegram-бота"
      if ! pm2 restart "$BOT_PROCESS" --update-env >/dev/null; then
        pm2 logs "$BOT_PROCESS" --lines 100 --nostream >&2 || true
        die "не удалось перезапустить бота"
      fi
      wait_pm2_online "$BOT_PROCESS" || { pm2 logs "$BOT_PROCESS" --lines 100 --nostream >&2; die "бот не стал online за 60 секунд"; }
      ;;
    userbot)
      note "Рестарт userbot"
      if ! pm2 restart "$USERBOT_PROCESS" --update-env >/dev/null; then
        pm2 logs "$USERBOT_PROCESS" --lines 100 --nostream >&2 || true
        die "не удалось перезапустить userbot"
      fi
      wait_pm2_online "$USERBOT_PROCESS" || { pm2 logs "$USERBOT_PROCESS" --lines 100 --nostream >&2; die "userbot не стал online за 60 секунд"; }
      wait_userbot || { pm2 logs "$USERBOT_PROCESS" --lines 100 --nostream >&2; die "userbot не подключился за 60 секунд"; }
      ;;
    *) die "компонент должен быть api, bot или userbot" ;;
  esac
}

reload_pm2_config() {
  note "Применение PM2-конфига bot и userbot"
  if ! pm2 startOrReload "$PROJECT_DIR/server/ecosystem.config.cjs" --only "$BOT_PROCESS" --env production --update-env >/dev/null; then
    pm2 logs "$BOT_PROCESS" --lines 100 --nostream >&2 || true
    die "не удалось применить PM2-конфиг бота"
  fi
  if ! pm2 startOrReload "$PROJECT_DIR/server/ecosystem.config.cjs" --only "$USERBOT_PROCESS" --env production --update-env >/dev/null; then
    pm2 logs "$USERBOT_PROCESS" --lines 100 --nostream >&2 || true
    die "не удалось применить PM2-конфиг userbot"
  fi
  if ! pm2 save >/dev/null; then
    pm2 status >&2 || true
    die "не удалось сохранить PM2 автозапуск"
  fi
  wait_pm2_online "$BOT_PROCESS" || { pm2 logs "$BOT_PROCESS" --lines 100 --nostream >&2; die "бот не стал online за 60 секунд"; }
  wait_pm2_online "$USERBOT_PROCESS" || { pm2 logs "$USERBOT_PROCESS" --lines 100 --nostream >&2; die "userbot не стал online за 60 секунд"; }
  wait_userbot || { pm2 logs "$USERBOT_PROCESS" --lines 100 --nostream >&2; die "userbot не подключился за 60 секунд"; }
}

atomic_frontend_build() {
  local short_sha="$1"
  local next_dir="$PROJECT_DIR/frontend/dist.next.$short_sha"
  local dist_dir="$PROJECT_DIR/frontend/dist"
  [[ "$next_dir" == "$PROJECT_DIR/frontend/dist.next."* ]] || die "небезопасный временный путь frontend"
  rm -rf -- "$next_dir"
  npm --prefix "$PROJECT_DIR/frontend" run build-only -- --outDir "$next_dir"
  [ -f "$next_dir/index.html" ] || die "сборка frontend не создала index.html"
  python3 - "$next_dir" "$dist_dir" <<'PY'
import ctypes
import os
import sys

new, current = map(os.fsencode, sys.argv[1:])
if not os.path.exists(current):
    os.rename(new, current)
    raise SystemExit

libc = ctypes.CDLL(None, use_errno=True)
renameat2 = libc.renameat2
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
if renameat2(-100, new, -100, current, 2) != 0:  # AT_FDCWD, RENAME_EXCHANGE
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))
PY
  # После обмена по next_dir лежит предыдущая сборка.
  rm -rf -- "$next_dir"
}

run_doctor() { bash "$SCRIPT_DIR/check-prod-runtime.sh"; }
doctor() { run_doctor; }

plan() {
  local target="${1:-}" current old_sha data
  require_sha "$target"
  need_command git; need_command node; need_command python3
  [ -d "$PROJECT_DIR/.git" ] || die "не найден репозиторий $PROJECT_DIR"
  fetch_target "$target"
  current="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
  old_sha="$current"
  if load_pending_state; then
    [ "$target" = "$PENDING_TARGET" ] || die "не завершён деплой $PENDING_TARGET; сначала завершите его"
    old_sha="$PENDING_OLD"
    [ "$current" = "$old_sha" ] || [ "$current" = "$target" ] || die "HEAD не совпадает с маркером незавершённого деплоя"
    data="$PENDING_IMPACT"
    note "Найден незавершённый деплой $old_sha -> $target"
  else
    git -C "$PROJECT_DIR" merge-base --is-ancestor "$current" "$target" || die "переход $current -> $target не fast-forward"
    data="$(impact_json "$current" "$target")"
  fi
  printf '%s' "$data" | print_plan
  if printf '%s' "$data" | json_has_blockers; then return 3; fi
}

deploy_locked() {
  local target="$1" current old_sha data components component pm2_reloaded=false resumed=false
  require_root
  need_command git; need_command node; need_command npm; need_command python3; need_command curl
  [ -d "$PROJECT_DIR/.git" ] || die "не найден репозиторий $PROJECT_DIR"
  repo_clean || die "есть изменения в отслеживаемых файлах; деплой остановлен"
  fetch_target "$target"
  current="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
  old_sha="$current"
  if load_pending_state; then
    resumed=true
    [ "$target" = "$PENDING_TARGET" ] || die "не завершён деплой $PENDING_TARGET; другой SHA запрещён"
    old_sha="$PENDING_OLD"
    data="$PENDING_IMPACT"
    [ "$current" = "$old_sha" ] || [ "$current" = "$target" ] || die "HEAD не совпадает с маркером незавершённого деплоя"
    note "Повтор незавершённого деплоя $old_sha -> $target"
    run_doctor || note "Предварительный doctor неуспешен; повтор продолжается для восстановления"
  else
    run_doctor
    git -C "$PROJECT_DIR" merge-base --is-ancestor "$current" "$target" || die "переход $current -> $target не fast-forward"
    data="$(impact_json "$current" "$target")"
  fi
  printf '%s' "$data" | print_plan
  if printf '%s' "$data" | json_has_blockers; then die "план содержит неизвестные или инфраструктурные изменения"; fi

  if [ "$resumed" = false ]; then write_pending_state "$old_sha" "$target" "$data"; fi
  if [ "$current" = "$old_sha" ]; then git -C "$PROJECT_DIR" merge --ff-only "$target"; fi

  if printf '%s' "$data" | json_field_true serverInstall; then npm --prefix "$PROJECT_DIR/server" ci --omit=dev; fi
  if printf '%s' "$data" | json_field_true frontendInstall; then npm --prefix "$PROJECT_DIR/frontend" ci; fi
  if printf '%s' "$data" | json_field_true frontendBuild; then atomic_frontend_build "${target:0:12}"; fi
  if printf '%s' "$data" | json_field_true pm2Reload; then reload_pm2_config; pm2_reloaded=true; fi

  components="$(printf '%s' "$data" | json_components)"
  for component in $components; do
    if [ "$pm2_reloaded" = true ] && { [ "$component" = bot ] || [ "$component" = userbot ]; }; then continue; fi
    restart_component "$component"
  done
  run_doctor
  clear_pending_state
  note "Деплой завершён: $target"
}

deploy() {
  local target="${1:-}"
  require_sha "$target"
  require_root
  acquire_lock
  deploy_locked "$target"
}

restart() {
  local component="$1"
  require_root
  acquire_lock
  restart_component "$component"
}

logs() {
  case "${1:-}" in
    api) journalctl -u "$API_SERVICE" -n "${LINES:-100}" --no-pager ;;
    bot) pm2 logs "$BOT_PROCESS" --lines "${LINES:-100}" --nostream ;;
    userbot) pm2 logs "$USERBOT_PROCESS" --lines "${LINES:-100}" --nostream ;;
    *) die "компонент должен быть api, bot или userbot" ;;
  esac
}

usage() {
  cat <<'EOF'
Использование:
  ops/prod.sh doctor
  ops/prod.sh plan <полный SHA>
  ops/prod.sh deploy <полный SHA>
  ops/prod.sh restart api|bot|userbot
  ops/prod.sh logs api|bot|userbot
EOF
}

main() {
  case "${1:-}" in
    doctor) expect_args "$#" 1; doctor ;;
    plan) expect_args "$#" 2; plan "${2,,}" ;;
    deploy) expect_args "$#" 2; deploy "${2,,}" ;;
    restart) expect_args "$#" 2; restart "$2" ;;
    logs) expect_args "$#" 2; logs "$2" ;;
    *) usage; exit 2 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
