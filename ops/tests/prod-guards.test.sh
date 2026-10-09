#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

if ! command -v python3 >/dev/null 2>&1; then
  mkdir -p "$TEST_ROOT/bin"
  cat >"$TEST_ROOT/bin/python3" <<'EOF'
#!/usr/bin/env bash
exec python "$@"
EOF
  chmod +x "$TEST_ROOT/bin/python3"
  export PATH="$TEST_ROOT/bin:$PATH"
fi

fail() { echo "FAIL: $*" >&2; exit 1; }

if NAVALIVAY_PROJECT_DIR="$TEST_ROOT/none" bash "$REPO_ROOT/ops/prod.sh" plan abc >/dev/null 2>&1; then
  fail "короткий SHA был принят"
fi
if NAVALIVAY_PROJECT_DIR="$TEST_ROOT/none" bash "$REPO_ROOT/ops/prod.sh" plan "$(printf 'a%.0s' {1..40})" extra >/dev/null 2>&1; then
  fail "лишний аргумент был принят"
fi

git init --bare --initial-branch=master "$TEST_ROOT/origin.git" >/dev/null
git clone "$TEST_ROOT/origin.git" "$TEST_ROOT/source" >/dev/null 2>&1
git -C "$TEST_ROOT/source" config user.email test@example.invalid
git -C "$TEST_ROOT/source" config user.name test
echo one >"$TEST_ROOT/source/README.md"
git -C "$TEST_ROOT/source" add README.md
git -C "$TEST_ROOT/source" commit -m one >/dev/null
git -C "$TEST_ROOT/source" push origin master >/dev/null 2>&1

git clone "$TEST_ROOT/origin.git" "$TEST_ROOT/prod" >/dev/null 2>&1
git -C "$TEST_ROOT/prod" config user.email test@example.invalid
git -C "$TEST_ROOT/prod" config user.name test

mkdir -p "$TEST_ROOT/prod/ops"
cp "$REPO_ROOT/ops/prod-impact.mjs" "$TEST_ROOT/prod/ops/prod-impact.mjs"

echo two >>"$TEST_ROOT/source/README.md"
git -C "$TEST_ROOT/source" commit -am two >/dev/null
git -C "$TEST_ROOT/source" push origin master >/dev/null 2>&1
TARGET="$(git -C "$TEST_ROOT/source" rev-parse HEAD)"

NAVALIVAY_PROJECT_DIR="$TEST_ROOT/prod" bash "$REPO_ROOT/ops/prod.sh" plan "$TARGET" >/dev/null || fail "валидный fast-forward отклонён"
NAVALIVAY_PROJECT_DIR="$TEST_ROOT/prod" bash "$REPO_ROOT/ops/prod.sh" plan "${TARGET^^}" >/dev/null || fail "SHA в верхнем регистре отклонён"

echo local >>"$TEST_ROOT/prod/README.md"
git -C "$TEST_ROOT/prod" commit -am local >/dev/null
if NAVALIVAY_PROJECT_DIR="$TEST_ROOT/prod" bash "$REPO_ROOT/ops/prod.sh" plan "$TARGET" >/dev/null 2>&1; then
  fail "не fast-forward был принят"
fi

echo dirty >>"$TEST_ROOT/prod/README.md"
NAVALIVAY_PROJECT_DIR="$TEST_ROOT/prod"
source "$REPO_ROOT/ops/prod.sh"
if repo_clean; then fail "грязные tracked-файлы не обнаружены"; fi

STATE_FILE="$TEST_ROOT/pending/state.json"
OLD="$(printf 'a%.0s' {1..40})"
NEW="$(printf 'b%.0s' {1..40})"
IMPACT='{"changedFiles":["docs/test.md"],"frontendBuild":false,"frontendInstall":false,"serverInstall":false,"pm2Reload":false,"components":[],"blocked":[],"noRuntimeActions":true}'
write_pending_state "$OLD" "$NEW" "$IMPACT"
load_pending_state || fail "маркер незавершённого деплоя не прочитан"
[ "$PENDING_OLD" = "$OLD" ] && [ "$PENDING_TARGET" = "$NEW" ] || fail "маркер деплоя повреждён"
[ "$PENDING_IMPACT" = "$IMPACT" ] || fail "план незавершённого деплоя не сохранён"
clear_pending_state
[ ! -e "$STATE_FILE" ] || fail "маркер завершённого деплоя не удалён"

# Имитируем повтор после сбоя: HEAD уже на target, но marker остался.
git clone "$TEST_ROOT/origin.git" "$TEST_ROOT/retry" >/dev/null 2>&1
PROJECT_DIR="$TEST_ROOT/retry"
STATE_FILE="$TEST_ROOT/retry-state/pending.json"
OLD_TARGET="$(git -C "$PROJECT_DIR" rev-parse "${TARGET}^")"
RETRY_IMPACT='{"changedFiles":["server/index.js"],"frontendBuild":false,"frontendInstall":false,"serverInstall":false,"pm2Reload":false,"components":["api"],"blocked":[],"noRuntimeActions":false}'
write_pending_state "$OLD_TARGET" "$TARGET" "$RETRY_IMPACT"
ACTION_FILE="$TEST_ROOT/retry-actions"
DOCTOR_FILE="$TEST_ROOT/retry-doctor"
require_root() { :; }
restart_component() { printf '%s\n' "$1" >>"$ACTION_FILE"; }
run_doctor() { printf 'doctor\n' >>"$DOCTOR_FILE"; }
deploy_locked "$TARGET"
[ "$(cat "$ACTION_FILE")" = api ] || fail "повтор не выполнил сохранённый рестарт API"
[ "$(wc -l <"$DOCTOR_FILE" | tr -d ' ')" = 2 ] || fail "повтор не выполнил предварительный и финальный doctor"
[ ! -e "$STATE_FILE" ] || fail "повтор не удалил marker после успешного doctor"

if command -v flock >/dev/null 2>&1; then
  LOCK_FILE="$TEST_ROOT/deploy.lock"
  READY="$TEST_ROOT/lock-ready"
  (
    source "$REPO_ROOT/ops/prod.sh"
    LOCK_FILE="$TEST_ROOT/deploy.lock"
    acquire_lock
    touch "$READY"
    sleep 2
  ) &
  holder=$!
  for _ in {1..20}; do [ -e "$READY" ] && break; sleep 0.1; done
  if (source "$REPO_ROOT/ops/prod.sh"; LOCK_FILE="$TEST_ROOT/deploy.lock"; acquire_lock) >/dev/null 2>&1; then
    fail "параллельная блокировка была захвачена дважды"
  fi
  wait "$holder"
fi

echo "prod guards: OK"
