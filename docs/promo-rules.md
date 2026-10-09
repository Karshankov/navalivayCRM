# Promo Rules

## Purpose

This document defines current promo-code behavior across backend, customer checkout, and CRM.

Use it when a task touches:

- promo-code validation
- promo validity periods
- CRM promo management
- gift-by-promo operational flow
- checkout promo UX and wording
- wholesale compatibility

## Source Of Truth

- Backend validation and lifecycle:
  - `server/promo-code-service.js`
- Admin promo CRUD API:
  - `server/routes/promo.js`
- Public promo validation endpoint:
  - `server/routes/public.js` (`POST /api/promo/validate`)
- CRM promo UI:
  - `frontend/src/views/admin/crm/loyalty/PromoCodesTab.vue`
- CRM orders (applied promo hints for staff):
  - `frontend/src/views/admin/crm/CrmOrders.vue`
  - `frontend/src/views/admin/crm/CrmOrderDetail.vue`
- Checkout promo UI:
  - `frontend/src/views/CheckoutView.vue`

## Promo Data Model

Current promo fields include:

- Core:
  - `code`
  - `discount_type` (`fixed` or `percent`)
  - `discount_value`
  - `min_order_amount`
  - `max_uses`
  - `active`
- Text:
  - `customer_description` (customer-facing)
  - `manager_description` (CRM manager-facing instructions)
  - legacy `description` is kept for compatibility
- Gift operations:
  - `has_gift` (`0/1`)
- Validity:
  - new model:
    - `valid_from_date` (`YYYY-MM-DD`)
    - `duration_days` (`null` or `> 0`)
  - legacy model (still supported):
    - `valid_from`
    - `valid_until`

## Validity Rules

### New validity model (preferred)

- Promo starts on `valid_from_date`.
- If `duration_days > 0`, promo ends on:
  - `valid_from_date + duration_days - 1` (inclusive).
- If `duration_days` is `null`, promo is perpetual after start date.
- Business date boundaries are Minsk-based (`Europe/Minsk`).

### Legacy validity model (compatibility)

- If new fields are absent, validation falls back to `valid_from` and `valid_until`.
- Legacy datetime behavior is retained to avoid breaking old promos.

## Validation Rules

- Code must exist and be active.
- Promo must be in active validity window.
- Usage must not exceed `max_uses` (except `0 = unlimited`).
- Order total must satisfy `min_order_amount`.
- Discount:
  - `fixed`: capped by order amount
  - `percent`: `0 < value <= 100`

## Checkout Rules

- Customer sees:
  - discount amount
  - `customer_description` (fallback to legacy `description`)
- Order payload should send `promo_code` only for validated promo state.
- Promo and loyalty cannot be combined in one order.
- In wholesale mode only gift promos (`has_gift = 1`) are allowed.
- A gift promo is attached to the wholesale order and reserves its usage, but its monetary discount is forced to `0` so wholesale pricing is unchanged.
- Regular discount promos are rejected in wholesale validation and again during order create/modify.
- Wholesale credentials are sent to `POST /api/promo/validate`; order create/modify remain the final authority.
- A customer-bound wheel promo in wholesale validation requires verified Telegram Mini App auth; unsigned or unknown identities must be rejected before the UI shows success.

## CRM Rules

### Promo form

- Use separate fields:
  - `Описание для клиента`
  - `Описание для менеджера`
- Regular promos do not show the legacy `description` field in the CRM form.
- Wheel templates show `description` as `Название приза`.
- `Название приза` is displayed on the wheel and in the win result.
- `Название приза` is required for wheel templates in both UI and API.
- Do not fill `description` from `customer_description` when reopening the form.
- Explicitly saving a regular promo clears its hidden legacy `description` so removed customer text cannot return through the fallback.
- Gift toggle:
  - `Есть подарок к заказу`
- Validity UX:
  - `Действует с` (date)
  - `На сколько дней` or `Бессрочно`
  - UI shows computed inclusive end date.
- A bounded regular promo requires both `valid_from_date` and `duration_days`.
- If days are entered without a start date, block saving and show the error near `Действует с`.
- A wheel template is the exception: its `duration_days` starts from the winner's issue date, so it does not require `valid_from_date`.

### Orders visibility

- If order promo has `has_gift = 1`, CRM should show a clear visual marker.
- Manager-facing instructions come from `manager_description` (API: `promo_manager_description` on orders).
- The orders board and order detail can show this text whenever it is present (including non-gift promos), as an assembly hint for staff.
- This is an operational hint, not an automated gift-picking subsystem.

## Wording Rules

- Use `Промокод` for promo input block.
- Use `Скидка по промокоду` for checkout summary row with applied promo discount.
- Use `За покупки` for loyalty discount.
- Avoid ambiguous generic `Скидка` if multiple discount sources are visible.

## Migration And Compatibility Notes

- Promo migration adds:
  - `customer_description`
  - `manager_description`
  - `has_gift`
  - `valid_from_date`
  - `duration_days`
- `customer_description` is backfilled from legacy `description` when possible.
- Legacy columns are intentionally preserved during transition.

## Regression Checklist

At minimum verify:

- create/edit regular promo
- create/edit gift promo
- regular promo rejects duration without a start date
- wheel template accepts relative duration without a start date
- perpetual promo (`duration_days = null`)
- bounded promo (`duration_days > 0`) with inclusive end date
- checkout shows customer description correctly
- CRM order card/detail shows gift marker and manager instructions
- old promos using legacy validity still validate as before
- wholesale gift promo is saved and reserved without changing the wholesale total
- wholesale discount promo and a wheel promo owned by another customer are rejected
- unsigned Telegram data cannot validate a customer-bound wheel promo
