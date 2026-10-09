# Dynamic Year Selector for Dashboard

## Problem statement
Today the dashboard shows a hardcoded list of years (currently `[2024, 2025]`) for the "за год" view. When we enter a new calendar year (e.g., 2026), the UI will not automatically expose that year until code is edited. We want the list of years to be derived from real data so that new years appear automatically when orders for that year exist, without code changes.

## Current state (researched)
- Frontend file: `frontend/src/views/AdminView.vue`
  - Year selector rendered from a hardcoded array (example):
    ```vue path=null start=null
    <div v-if="overviewPeriod === 'year'" class="flex gap-1">
      <button v-for="year in [2024, 2025]" ...>{{ year }}</button>
    </div>
    ```
  - Timeseries loading for year view already supports a `year` parameter via the store (`fetchDashboardTimeseries(period, offset, year?)`).
- Store: `frontend/src/stores/crm.ts`
  - Provides `fetchDashboardTimeseries(period: 'month' | 'year', offset?: number, year?: number)` and state for `dashboardTimeseries`.
  - There is no state or API call that returns "available years".
- Backend: `server/routes/crm.js`
  - Endpoints implemented:
    - `GET /api/admin/crm/dashboard` (aggregated KPIs)
    - `GET /api/admin/crm/dashboard-timeseries` (month: days, year: months)
  - No endpoint that returns which years have data.
  - Orders table has `created_at` (ISO timestamp) and relevant status fields; usable to compute distinct years with data.

## Proposed changes
We will make the selector data-driven by exposing available years from the backend and consuming that in the UI.

### Backend
- Add endpoint: `GET /api/admin/crm/years`
  - Returns `{ years: number[] }` where `years` are distinct years (ascending) extracted from `orders.created_at` that have relevant data.
  - Suggested SQL (SQLite):
    ```sql path=null start=null
    SELECT DISTINCT CAST(strftime('%Y', created_at) AS INTEGER) AS year
    FROM orders
    WHERE status IN ('completed', 'delivered')
    ORDER BY year ASC;
    ```
  - Rationale: we expose years only when there are completed/delivered orders, i.e., meaningful data.
  - Optional: include `currentYear` and/or `hasCurrentYearData` flags if needed later.

### Store (frontend)
- Add reactive state to `useCrmStore`:
  - `availableYears = ref<number[]>([])`
  - `loadingYears = ref(false)`
- Add method: `fetchAvailableYears()` that calls `/api/admin/crm/years` and populates `availableYears`.
- Export the new state and method from the store.

### UI (AdminView.vue)
- Replace hardcoded `[2024, 2025]` with dynamic `availableYears` from the store:
  ```vue path=null start=null
  <div v-if="overviewPeriod === 'year'" class="flex gap-1">
    <button v-for="year in availableYears" :key="year" @click="selectedYear = year" ...>
      {{ year }}
    </button>
  </div>
  ```
- Lifecycle:
  - On mount (when profit access is unlocked and user authenticated), call `fetchAvailableYears()` once.
  - Also call `fetchAvailableYears()` after successful profit unlock (`submitProfitPassword`), since the dashboard is gated behind the unlock.
- Default selection:
  - When `availableYears` loads, set `selectedYear` to the max of `availableYears`. If empty, fallback to `new Date().getFullYear()` (no timeseries until data appears).
  - Watch `availableYears` to adjust `selectedYear` only if the current `selectedYear` is not in the list (so we don't override explicit user choice later).

### Edge cases & UX
- If `availableYears` is empty (no data at all), show a single disabled pill with the current year or render nothing (and keep year buttons hidden) — choose the simpler approach: hide selector when `availableYears.length === 0`.
- When a new year starts, as soon as the first completed/delivered order appears for that year, it will automatically show up in `availableYears` on next fetch (page reload or we can periodically refresh on period change — optional).
- Accessibility: preserve button `:disabled` styling logic if needed.

## Implementation notes (minimal code footprint)
- Backend change is self-contained in `server/routes/crm.js`.
- Store change is additive and low risk.
- UI change is limited to replacing the hardcoded array and adding one store call in existing lifecycle hooks where we already fetch other dashboard data.

## Validation
- Seed/insert one completed order in a future year (e.g., 2026) locally; verify `/years` returns it and the UI shows the button without code changes.
- Verify that selecting any returned year updates the year timeseries correctly.

## Rollout plan
1. Implement backend endpoint `/api/admin/crm/years`.
2. Implement store method/state and export.
3. Replace hardcoded array in `AdminView.vue` and wire lifecycle to fetch years.
4. Manual verification for 2024/2025, then simulate 2026.
5. Deliver.
