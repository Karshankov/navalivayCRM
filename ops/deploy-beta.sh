#!/usr/bin/env bash
# Бета-сборка мини-аппы для команды: /beta/ на проде.
#
# Отличие от prod.sh deploy: кладёт сборку в frontend/dist-beta, а не dist.
# Клиенты ходят через кнопку меню бота на «/» и беты не видят; команда
# открывает https://navalivay.store/beta/ прямой ссылкой в Telegram.
#
# «Выпустить всем» = обычный ./ops/prod.sh deploy <SHA>: свежая сборка
# становится основной на «/», бета и прод сравниваются.
#
# Запуск: bash ops/deploy-beta.sh <полный-SHA>   (как prod.sh)
set -Eeuo pipefail

PROJECT_DIR="${NAVALIVAY_PROJECT_DIR:-/var/www/NAVALIVAY}"

die() { echo "ОШИБКА: $*" >&2; exit 1; }
note() { echo "==> $*"; }

require_root() { [ "$(id -u)" -eq 0 ] || die "команда требует root"; }
require_sha() { [[ "${1:-}" =~ ^[0-9a-fA-F]{40}$ ]] || die "нужен полный SHA из 40 символов"; }
need_command() { command -v "$1" >/dev/null 2>&1 || die "не найдена команда: $1"; }

require_sha "$1"
require_root
need_command git; need_command node; need_command npm

cd "$PROJECT_DIR"

# Чистота репо обязательна: бета собирается из коммита, а не из рабочего
# стола — иначе на бету уедут несуществующие изменения.
git diff --quiet --ignore-submodules -- && git diff --cached --quiet --ignore-submodules -- ||
  die "есть изменения в отслеживаемых файлах; закоммитьте или сделайте stash"

git fetch --quiet origin master
git cat-file -e "${1}^{commit}" 2>/dev/null || die "коммит $1 не найден"
git merge-base --is-ancestor "$1" origin/master || die "$1 не входит в origin/master"

git merge --ff-only "$1"

BETA_DIR="$PROJECT_DIR/frontend/dist-beta"
NEXT_DIR="$PROJECT_DIR/frontend/dist-beta.next"

rm -rf -- "$NEXT_DIR"
note "Сборка беты (base=/beta/)..."
npm --prefix "$PROJECT_DIR/frontend" run build-only -- --outDir "$NEXT_DIR" --base=/beta/
[ -f "$NEXT_DIR/index.html" ] || die "сборка не создала index.html"

rm -rf -- "$BETA_DIR"
mv -- "$NEXT_DIR" "$BETA_DIR"

note "Бета обновлена: /beta/ -> $1"
note "Проверка: https://navalivay.store/beta/"
