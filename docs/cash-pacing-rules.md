# Cash Pacing Rules

## Purpose

This document defines the current business rules and implementation assumptions for the CRM module:

- `Финансы -> План пробития`

Use it when a task touches:

- monthly cash pacing logic
- plan/fact calculations
- daily Z-report entry
- current/next month stock loading
- rounding or recommendation formulas

## Business Model

The module is not just a calculator. It is a monthly `plan + fact + recalculation` tool for one store and one cash register.

The accountant or manager:

1. creates a month
2. adds stock positions for that month
3. enters the actual amount punched through the cash register at the end of each day
4. gets an updated recommendation for the remaining days of the month

## Current Scope

The current implementation assumes:

- one store
- one cash register
- one total fact amount per day
- work happens every calendar day of the month

Do not add multi-store, multi-cashbox, or shift-level logic unless the task explicitly expands the scope.

## Core Month Rules

- Each month is stored separately by `YYYY-MM`.
- A month can be prepared in advance.
- The user can keep data for both:
  - the current month
  - the next month
- The month summary is recalculated after every item change and every daily fact change.

## Item Rules

Each item is entered manually with:

- title
- quantity
- cost with VAT
- markup percent
- effective date

The system calculates:

- retail price per unit
- retail total per line
- monthly limit contribution

There are two item types:

- `base`
  - the main stock for the month
- `addition`
  - an extra stock load added later

## Addition Date Rules

- For planned or future months, additions can start on any date inside that month.
- For the current month, an `addition` must start no earlier than the next business day.
- A current-month addition must not affect today's recommendation immediately.
- If the current month is already on its last day, the user should add the stock to the next month instead.

## Daily Fact Rules

- Daily fact is one total number for the whole store for each date, sourced from the end-of-day Z-report.
- Manual entry remains available. Saving manually for an existing date updates that date instead of creating a duplicate.
- Successful financial-day closing automatically inserts a missing daily fact: step 1 terminal cash + terminal card, not counted cash, CRM revenue, profit, or a ledger transfer.
- The target date is the closing's Minsk business date; its month is derived from that date, not the browser's date or the selected finance tab.
- Any existing fact, including zero, is preserved unchanged. The terminal total is never added to an existing amount.
- The target month must already exist. If absent, preview and final confirmation reject with a request to create the month manually; no financial movements, closure, fact, or notifications are committed.
- Automatic insertion, financial settlement, saved report and notification queue are one immediate transaction. Replaying a successful closing does not insert or restore a fact again.
- Local test reset removes only the unchanged fact inserted by that closure. A pre-existing fact is never touched. Changed, removed, or replaced automatic facts block reset rather than losing subsequent manual work.
- Legacy saved closings are not backfilled automatically.
- A daily fact can be deleted.
- Past days can be edited.
- Future dates are not allowed.
- Facts for future months are not allowed.

## Recalculation Rules

The recommendation logic is:

- monthly limit
- minus actual punched amount already entered
- divided by remaining calendar days

This recommendation must update when:

- a new base/addition item is created
- an item is edited
- an item is deleted
- a daily fact is added
- a daily fact is updated
- a daily fact is deleted

If the team over-punches today, the recommended amount for the remaining days goes down.

If the team under-punches today, the recommended amount for the remaining days goes up.

## Rounding Rules

- The line calculation may keep precise decimal values.
- The final monthly limit is rounded to whole BYN.
- Example: `472.98 -> 473`
- Separate per-unit retail display does not need forced whole-ruble rounding.

When changing rounding behavior, preserve this business expectation:

- the accountant cares primarily about the final monthly limit in whole rubles

## UI Expectations

Inside CRM:

- the module lives under `Финансы`
- the user must clearly see:
  - monthly limit
  - actual punched total
  - remaining amount
  - recommendation for the next relevant day
- item entry should stay manual and simple
- daily fact entry should stay manual and simple

Do not turn this into a procurement system, stock system, or POS integration unless the task explicitly asks for it.

## Validation Expectations

At minimum, cash pacing changes should preserve these behaviors:

- current-month addition starts from the next day
- future daily fact is rejected
- deleting a daily fact recalculates the plan
- editing a past daily fact recalculates the plan
- addition in the middle of a month changes later daily recommendations, not earlier ones

## Key Implementation References

When updating the module, inspect these files first:

- `server/utils/cash-pacing.js`
- `server/routes/crm-finance.js`
- `server/tests/cash-pacing.test.js`
- `frontend/src/components/admin/CrmCashPacingPanel.vue`
- `frontend/src/stores/crm.ts`

If the business rules change, update this document in the same task.
