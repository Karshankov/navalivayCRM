# Wheel rarity prize pools — implementation plan

## Goal

Переделать CRM и backend рулетки с текущей модели `прямой выбор отдельного prize по weight`
на модель:

- шанс настраивается **на уровне редкости**;
- внутри редкости хранится **пул из нескольких призов**;
- каждый приз в пуле привязан к `promo template`;
- если в редкости нет доступных призов, редкость автоматически исключается из выпадения;
- `valuable` не участвует в обычной chance-механике и работает только как скрытый special rule:
  `горячий пул = N qualified customers + threshold BYN`, победитель — первый eligible клиент,
  который сделает следующий спин после активации пула;
- `nothing` не настраивается вручную, а считается как остаток до `100%`.

## What exists now

### Backend

Current wheel model is prize-centric:

- `wheel_prizes` already stores:
  - `rarity_code`
  - `weight`
  - `promo_template_id`
  - `max_total`, `issued_count`
  - `epic_pool_size`, `epic_pool_threshold_byn`
- spin logic in `server/wheel/wheel-service.js`:
  - loads active prizes
  - uses `pickWeightedRandom(prizes)` by `prize.weight`
  - excludes elite rarities from normal pity flow
  - handles epic/valuable via `wheel_epic_pools`

### Frontend CRM

`frontend/src/views/admin/crm/CrmWheel.vue` currently manages:

- rarity list
- flat prize list
- prize create/edit modal
- wheel settings
- dashboard

### Promo subsystem

`PromoCodesTab.vue` already has a solid modal/UI pattern and `crmStore.createPromoCode(...)`.
Wheel prizes already depend on `promo template`, and generated one-time codes are created on win.

## Target product model

### 1. Rarity-centric wheel configuration

Each rarity becomes the primary configurable entity:

- rarity code
- rarity label
- chance percent
- enabled/disabled by availability
- derived availability counters / analytics

`nothing`:

- not manually edited as a separate chance field;
- computed as `100 - sum(normal rarity chances)`;
- shown in CRM as derived read-only value.

### 2. Prize pools inside rarity

Each normal rarity contains multiple prizes:

- title
- client description
- image
- promo template
- active flag
- issuance limit / derived availability
- optional internal weight **inside the rarity only** if we later need non-uniform selection among prizes of the same rarity

Initial recommendation:

- keep equal random selection among available prizes inside a rarity;
- if business later needs bias inside a rarity, add `intra_rarity_weight` as a second-phase enhancement.

### 3. Valuable special rule

`valuable` becomes hard-coded special behavior:

- removed from normal rarity chance roll;
- configured by:
  - pool size
  - threshold BYN
- pool becomes active once there are `N` qualified customers with accumulated profit since wheel start;
- winner is the **first eligible customer who spins after the pool becomes hot**;
- users are never shown this internal logic.

### 4. Availability rules

A rarity is considered available only if it has at least one usable prize:

- prize is active;
- prize has valid `promo_template_id`;
- prize is not exhausted by its own limit;
- promo template is active and valid for wheel usage.

If no available prizes exist:

- rarity is excluded from roll;
- its configured chance is treated as inactive in runtime;
- CRM shows the reason/availability state.

## Recommended analytics

### Per rarity

- configured chance %
- effective status: available / unavailable
- number of active prizes in pool
- number of issuable prizes
- issued count total
- last issued at

### Valuable

- pool size
- threshold BYN
- qualified customers count
- hot / not hot state
- last releases count

### Wheel summary

- effective chance map for current runtime
- computed `nothing` chance
- spins by rarity
- issued by rarity
- unavailable rarities skipped due to no inventory

## Data model changes

## Phase A — minimal compatible extension

Keep `wheel_prizes`, but reinterpret it:

- one row = one prize item inside a rarity pool
- `weight` is no longer the top-level rarity chance

Add rarity-level settings, likely via new table:

`wheel_rarity_rules`

- `rarity_code` PK / FK to `wheel_rarities`
- `chance_percent` REAL NOT NULL
- `valuable_pool_size` INTEGER NULL
- `valuable_threshold_byn` REAL NULL
- `updated_at`

Notes:

- for normal rarities, only `chance_percent` matters;
- for `valuable`, `chance_percent` is ignored;
- current `wheel_rarities.is_elite` can become obsolete if `valuable` is the only special rarity.

## Phase B — cleanup after rollout

After successful migration:

- remove dependency on `elite_rarities_json` in `wheel_settings`;
- stop using prize-level `weight` as top-level roll source;
- optionally deprecate `epic_pool_size` / `epic_pool_threshold_byn` from `wheel_prizes` and move them fully to rarity rule level.

## Runtime algorithm

### Normal spin

1. Load wheel settings and rarity rules.
2. Build list of normal rarities excluding `valuable`.
3. For each rarity, compute availability from its prize pool.
4. Drop unavailable rarities from effective roll.
5. Sum configured rarity chances.
6. Derive `nothing = max(0, 100 - sum(active rarity chances))`.
7. Roll rarity by effective chance map.
8. If selected rarity is normal rarity:
   - pick one available prize from that rarity pool;
   - generate one-time promo from its template.
9. If selected outcome is `nothing`, return nothing.
10. Before normal roll, check whether current customer is eligible for hot `valuable` release and grant it first.

### Valuable flow

1. Keep/update qualified customer list based on profit since wheel launch.
2. Once count reaches configured pool size, mark pool hot.
3. Hot pool is not instantly assigned.
4. First eligible qualified customer who spins after that receives `valuable`.
5. Close current pool and start next cycle.

## CRM UX changes

### Replace flat “prizes” tab with rarity-first layout

Recommended layout:

- rarity cards/table at top:
  - label
  - chance
  - availability
  - issued
  - actions
- clicking rarity opens pool management:
  - prize list inside rarity
  - add/edit/hide prize
  - quick create promo template

### Prize modal

Keep current improved modal style, but contextualize under selected rarity:

- rarity is preselected from the chosen rarity container;
- manager edits prize item, not top-level chance;
- `valuable` prize modal shows special note that top-level chance does not apply.

### Quick promo template creation

Use recommended “embedded shortcut, not duplicate subsystem” approach:

- from wheel prize modal:
  - select existing template
  - or click `Создать шаблон`
- open compact promo-template modal reusing PromoCodes patterns / validation
- after create:
  - add template to local list
  - auto-select it in prize form

Do **not** introduce raw free-text one-time code entry in wheel UI.

## API changes

### Backend endpoints

Add/adjust admin endpoints roughly to this shape:

- `GET /api/admin/crm/wheel/rarity-rules`
- `PUT /api/admin/crm/wheel/rarity-rules/:rarityCode`
- `GET /api/admin/crm/wheel/rarities/:rarityCode/prizes`
- existing prize CRUD can stay, but should operate in rarity context
- optional quick-create promo template endpoint can reuse existing promo create flow if payload is compatible

### Dashboard payload

Extend wheel dashboard with:

- rarity chance config
- effective chance map
- rarity availability counters
- valuable hot-pool state

## Migration strategy

### Data migration

1. Create `wheel_rarity_rules`.
2. Seed rules from existing rarities.
3. Convert current flat `wheel_prizes.weight` into initial rarity chance proposal:
   - aggregate by rarity;
   - use summed weights as migration baseline;
   - normalize in CRM after deploy by manual review.
4. Preserve all existing prize rows.
5. For `valuable`, move epic parameters to rarity rule while keeping legacy columns temporarily for safe fallback.

### Backward compatibility

During transition:

- keep old fields readable;
- if rarity rules missing, fall back to legacy behavior;
- once admin saves new config, switch that rarity to new behavior.

This reduces rollout risk.

## Validation and regression coverage

### Backend tests

Need new tests for:

- rarity chance selection
- computed `nothing`
- rarity excluded when pool empty
- prize selection within rarity
- valuable hot-pool release to first eligible spinner
- no release to ineligible spinner
- migration compatibility with old data

### Frontend tests

Need tests for:

- rarity rule save/load
- derived `nothing` display
- unavailable rarity state
- quick promo template creation from wheel modal
- prize list filtered by rarity

## Rollout notes

- Existing production runtime is systemd API on `8082`; bot/userbot are currently PM2-managed on prod.
- Wheel refactor should be shipped behind data compatibility safeguards because current prod checkout is not clean.
- Before deploy, reconcile prod/local/git state to one known commit.

## Implementation order

1. Add new rarity-rules table + migration.
2. Refactor wheel-service selection algorithm to rarity-first model.
3. Preserve valuable flow but move config ownership to rarity-level rule.
4. Update admin APIs.
5. Refactor CRM wheel UI to rarity-first management.
6. Add quick promo template creation flow.
7. Extend dashboard analytics.
8. Add regression tests.
9. Validate local end-to-end.

## Final recommendation

Implement in two internal milestones:

### Milestone 1

- rarity chances
- computed nothing
- rarity availability filtering
- valuable hot-pool clarification
- analytics basics

### Milestone 2

- multi-prize pools per rarity
- quick promo template creation in wheel UI
- richer CRM analytics

This is the safest path technically, but if needed we can still build both milestones in one branch as long as migrations remain backward-compatible.

## Adversarial + functional test checkpoints

Ниже — точки, где тесты нужно запускать не “в конце”, а сразу после каждого рискованного блока.
Идея: ловить архитектурные баги на берегу, пока контекст изменения ещё узкий.

### Checkpoint 1 — after DB migration and compatibility layer

Run immediately after:

- creating `wheel_rarity_rules`
- seeding/backfilling initial data
- wiring backward-compat reads

Functional tests:

- fresh install creates new table correctly
- existing DB migrates without data loss
- old wheel prizes still читаются
- legacy config still works before CRM resave

Adversarial tests:

- missing rarity rule rows
- duplicated rarity rule rows attempt
- invalid chance values (`< 0`, `> 100`, `NaN`)
- valuable with accidental chance set
- migration on partially dirty DB
- migration rerun is idempotent

Bug classes we expect here:

- broken old data
- wrong default seeding
- impossible admin state after migration
- prod boot crash because of unexpected schema shape

### Checkpoint 2 — after rarity-first selection algorithm

Run immediately after:

- replacing prize-level top roll with rarity-level roll
- computing derived `nothing`
- excluding unavailable rarities

Functional tests:

- configured rarity chances are respected
- `nothing` equals remainder to 100
- unavailable rarity is skipped
- available rarity can still win
- equal/random prize pick within rarity works

Adversarial tests:

- sum of configured chances is exactly 100
- sum is below 100
- sum is above 100
- only one rarity is available
- no rarity is available
- rarity has chance but zero usable prizes
- prize exists but promo template inactive
- prize exists but exhausted by limit

Bug classes we expect here:

- wrong effective probability map
- negative/incorrect `nothing`
- invisible dead rarity still participating
- null selection when fallback should work

### Checkpoint 3 — after valuable hot-pool refactor

Run immediately after:

- moving valuable config to rarity-level rule
- implementing “first eligible spinner after hot pool” behavior

Functional tests:

- pool activates when `N` qualified customers exist
- customer below threshold is not qualified
- first eligible spinner after hot state gets valuable
- pool closes and next cycle starts cleanly

Adversarial tests:

- candidate reaches threshold with no spins left
- multiple eligible customers race for first spin
- non-eligible customer spins while pool is hot
- valuable prize unavailable while pool is hot
- threshold boundary (`299.99`, `300`, `300.01`)
- customer appears in pool twice
- qualified list corrupted / stale

Bug classes we expect here:

- double release of valuable
- stuck hot-pool that never closes
- wrong winner due to race/order bug
- issuing valuable when inventory is empty

### Checkpoint 4 — after admin APIs

Run immediately after:

- adding rarity-rules endpoints
- updating prize CRUD for rarity context
- quick-create promo template flow

Functional tests:

- load/save rarity chances
- load prizes by rarity
- create/edit/hide prize in rarity
- quick promo template create returns reusable template

Adversarial tests:

- invalid rarity code
- invalid promo template binding
- inactive template binding
- concurrent edits from two tabs
- stale form saves after another admin changed data
- valuable config submitted on non-valuable rarity
- normal chance submitted for valuable

Bug classes we expect here:

- malformed admin state
- wrong validation gaps
- hidden race conditions in CRM save flow

### Checkpoint 5 — after CRM wheel UI refactor

Run immediately after:

- replacing flat list with rarity-first management
- adding derived availability and `nothing`
- embedding quick template create

Functional tests:

- rarity cards render correct chance/availability
- `nothing` displayed as derived read-only value
- entering chance updates totals correctly
- quick-create template auto-selects in prize modal
- hidden/empty rarity clearly shown as unavailable

Adversarial tests:

- manager enters chances exceeding 100
- manager removes all chances
- manager creates prize but closes nested modal midway
- manager saves rarity while prize modal is open
- manager creates template then savePrize fails
- browser reload during partially edited wheel config

Bug classes we expect here:

- UI state desync
- stale computed totals
- orphaned modal state
- newly created template not attached properly

### Checkpoint 6 — after dashboard analytics

Run immediately after:

- adding rarity availability analytics
- adding valuable hot-pool metrics

Functional tests:

- issued counters match spin history
- availability counters match real prize pool state
- valuable metrics reflect current pool state

Adversarial tests:

- empty history
- hidden/inactive prizes
- partially exhausted rarity
- migrated legacy prizes mixed with new pools

Bug classes we expect here:

- analytics lying to managers
- mismatched counts between dashboard and runtime logic

### Final pre-release gate

Before shipping, run one combined scenario suite that simulates:

1. admin configures rarity chances
2. admin creates several prizes inside one rarity
3. admin creates promo template from wheel UI
4. customer earns spins
5. normal rarity spin generates one-time code
6. unavailable rarity stops participating
7. valuable pool heats up and releases correctly
8. dashboard reflects all of the above

### Mandatory adversarial scenarios in final gate

- all normal rarities unavailable
- only one normal rarity available
- `nothing` should dominate because configured chances are low
- valuable hot but no available valuable prize
- promo template deleted/deactivated after prize bind
- repeated spin request / idempotency edge
- customer crosses threshold after spending but before next spin
- CRM manager edits config while users are spinning

### Recommended implementation discipline

For this feature, bugs are most likely in four zones:

1. migration compatibility
2. probability math
3. valuable pool state transitions
4. nested admin UX with promo-template creation

So the practical rule should be:

- implement one zone
- immediately add adversarial tests for that zone
- run focused suite
- only then move to the next zone

This will be much safer than trying to wire the whole feature first and only then running the full suite.
