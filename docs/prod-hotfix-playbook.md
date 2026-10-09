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
