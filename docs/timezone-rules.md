# Timezone Rules

## Business Timezone

The project business timezone is:

- `Europe/Minsk`

This is the source of truth for business days, dashboard periods, and customer/admin date labeling unless the task explicitly says otherwise.

## Required Rules

- Do not derive business day boundaries from the browser's local timezone.
- Do not assume the server runtime timezone matches business time.
- Frontend date labels for `today / month / year / week` must be computed in `Europe/Minsk`.
- Backend period grouping and frontend period labels must describe the same Minsk-based period.
- Promo validity that is date-based (start date + duration in days) must be evaluated by Minsk business date.

## Frontend Rules

- Avoid raw `new Date()` usage for business-period UI when the result depends on calendar date.
- Avoid `toLocaleDateString()` without an explicit `timeZone`.
- Use the shared Minsk business-time helper when the task touches dashboard ranges or current business date labels.
- Current frontend helper reference:
  - `frontend/src/utils/businessTime.ts`

## Backend Rules

- Server grouping for dashboards, summaries, and time-series must be Minsk-based.
- If there is a discrepancy between frontend labels and backend aggregates, treat it as a timezone bug first.
- Pay special attention near midnight and year/month boundaries.
- For promo-date logic, do not compare business dates using raw local-time browser dates.
- Current backend helper references:
  - `server/utils/business-time.js`
  - `server/utils/cash-pacing.js` when the task touches daily recommendation logic

## Regression Expectations

At minimum, timezone-sensitive changes should be checked against:

- day boundary near Minsk midnight
- previous-day offset behavior
- month/year boundary near New Year

## Debugging Notes

If the UI shows `yesterday` while the backend already counts `today`, the likely problem is:

- frontend label logic still uses local/browser time
- or a server-side business-time helper is parsing the boundary incorrectly

Timezone fixes should be treated as cross-surface consistency work, not as isolated text fixes.
