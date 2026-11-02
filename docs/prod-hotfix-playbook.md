# Prod Hotfix Playbook

## Purpose

This document defines how to investigate and stabilize production issues without creating avoidable churn while the customer is actively testing.

## Default Rules

- Prefer investigation first, code changes second.
- If the customer is actively testing on prod, do not rebuild, restart, or redeploy without explicit approval.
- Read-only checks on prod are allowed unless the user says otherwise.
- Safe verification actions are allowed if they do not restart services or rebuild frontend assets.

## Safe Actions During Active Testing

- inspect logs
- inspect DB rows
- run read-only API checks
- compare prod state with local code
- run isolated tests that do not touch live customer data
- if mutation-based verification is unavoidable, prefer an isolated temporary test DB instead of live business rows

## Actions That Need Explicit Approval

- server restart
- frontend rebuild
- service reload
- schema/data mutation on live business data
- manual hotfix that changes runtime behavior during a customer session

## Git Sync Rules

After any prod hotfix or prod-only investigation drift:

- local working tree
- `origin`
- prod checkout

must be reconciled to one known commit as soon as it is safe.

Do not leave the team guessing whether:

- prod has extra fixes
- local has unpushed fixes
- GitHub is behind prod

## Investigation Order

1. Reproduce or identify the exact prod symptom.
2. Confirm whether it is frontend-only, backend-only, or a data/runtime mismatch.
3. Check whether the issue can be proven with logs, DB state, or API output before editing code.
4. If a hotfix is required, keep the change as small as possible.
5. After the incident, sync local, remote, and prod Git state.

## Customer Testing Mode

When the customer is currently buying, issuing, cancelling, or validating critical business flows:

- treat prod as fragile
- avoid cosmetic redeploys
- batch non-urgent changes locally
- only touch prod for confirmed blockers

## Follow-Up Expectation

If a prod issue led to a real fix, the follow-up should usually include:

- a regression test if practical
- a short note in docs if the rule was previously implicit
- Git synchronization so the current source of truth is obvious

## Native Modules and Node Upgrades

`better-sqlite3` (and any other native module under `server/node_modules`)
is compiled against a specific Node.js ABI (NODE_MODULE_VERSION).

If the host Node major version changes, the prebuilt `.node` file becomes
incompatible and the API crash-loops with `ERR_DLOPEN_FAILED`. This took
prod down once after `unattended-upgrades` moved Node from 20 to 22.

Defenses (all must stay in place):

1. `apt-mark hold nodejs` on the prod host. Verify with `apt-mark showhold`.
2. `ops/systemd/navalivay-rebuild-native.sh` runs as `ExecStartPre` on
   `navalivay-server.service`. On a healthy boot it exits in ~100 ms.
   On ABI mismatch, missing, or corrupt canonical binary it runs
   `npm rebuild` for the offending module and then ExecStart proceeds.
3. `StartLimitIntervalSec=900` and `RestartSec=15` in the unit give the
   self-heal time to finish before systemd marks the service `failed`.

When intentionally upgrading Node major on prod, run
`cd /var/www/NAVALIVAY/server && npm rebuild` before starting the service.

## SSE для CRM (живой канбан) — ручной шаг nginx

`/api/admin/crm/events` (Server-Sent Events) требует отдельного `location` в
nginx ДО generic `location /api` — с `proxy_buffering off` и
`proxy_read_timeout 300s` (см. `ops/nginx.conf`). Актуальная копия конфига
лежит там; на сервере конфиг меняется руками, потом копия обновляется.

Проверка после деплоя:

```bash
# 1) получить тикет (нужен админский токен)
TICKET=$(curl -s -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://navalivay.store/api/admin/crm/events/ticket | jq -r .ticket)
# 2) стрим должен прийти немедленно и держаться открытым
curl -N -m 3 "https://navalivay.store/api/admin/crm/events?ticket=$TICKET"
# ожидание: event: summary + JSON в течение секунды, соединение живёт до -m
```

Если шаг не сделан, CRM не падает: фронт после трёх неудачных попыток
откатывается к обычному 15-секундному polling (см. `startRealtime()` в
`frontend/src/stores/crm.ts`).

## Сжатие картинок (compress-uploads.js) — порядок на проде

Код: `server/scripts/compress-uploads.js` + автосжатие при загрузке
(`server/utils/upload-image-optimize.js`, включено в `upload.js`).

Регламент (по шагам, каждый шаг отдельно):

```bash
cd /var/www/NAVALIVAY/server

# 1) Снимок ДО всего
./../ops/backup.sh   # БД + uploads + конфиги

# 2) Dry-run: только отчёт, ничего не меняется
node scripts/compress-uploads.js | tee /tmp/compress-dry-run.txt

# 3) Тест на 5 файлах (с бэкапом оригиналов)
node scripts/compress-uploads.js --apply --limit=5 \
  --backup-dir=/var/backups/NAVALIVAY/uploads-originals-$(date +%Y%m%d)
# -> проверить витрину глазами (карточки с большими фото), CRM, баннеры

# 4) Полный прогон
node scripts/compress-uploads.js --apply \
  --backup-dir=/var/backups/NAVALIVAY/uploads-originals-$(date +%Y%m%d)

# 5) Карантин осиротевших (после проверки, что витрина целая)
node scripts/compress-uploads.js --cleanup          # dry-run отчёт
node scripts/compress-uploads.js --cleanup --apply
```

Отчёт всегда сохраняйте (`tee`): там полный список файлов, битые ссылки
(файлы, которых нет на диске — «чинить» их скрипт не будет), объём до/после.

Откат: файлы — из `--backup-dir` (копируется исходная структура),
ссылки БД — из бэкапа `ops/backup.sh` (navalivay.db). Рестартов API не нужно:
меняются только файлы и строки в БД.

Карантин `_quarantine/` НЕ раздаётся nginx'ом (см. `ops/nginx.conf`,
`location ^~ /uploads/_quarantine/ { return 404; }` — добавить руками на
сервере, как SSE-локейшн). Удалять карантин и бэкап оригиналов — не раньше
чем через пару недель стабильной работы.
