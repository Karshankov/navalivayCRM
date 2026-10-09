# Loyalty Rules

## Purpose

This document defines the current loyalty behavior across the customer app, CRM, and backend-facing UI assumptions.

Promo-specific behavior is documented in:

- `docs/promo-rules.md`
- `docs/wholesale-rules.md`

Use it when a task touches:

- checkout loyalty application
- bonus accrual
- loyalty discount display
- CRM wording around order discounts

## Core Business Rules

- Loyalty categories are currently separated into:
  - `liquids`
  - `disposables`
  - `devices`
- The customer can earn bonuses independently in each category.
- One order can apply at most one loyalty bonus per category.
- A loyalty bonus never auto-applies.
- Loyalty application is always an explicit customer action.
- If a promo code is active on the order, loyalty bonuses are blocked for that order.
- If wholesale mode is active on the order, loyalty bonuses are blocked for that order.
- Products purchased with promo discount or loyalty bonus do not generate loyalty marks.
- CRM order-level discount (`orders.discount_amount`) — via kanban pencil or «Скидка BYN» on the order detail page — **does** generate loyalty marks.
- CRM position-level discount on a line item does **not** generate loyalty marks for that line item. This includes both lowered sale price (`order_items.price_per_unit` below catalog price) and «Ручная скидка на позицию, BYN» (`order_items.manual_discount_amount` > 0).

## Checkout UX Rules

- Do not represent bonus usage as `шт.` or quantity selection when the real rule is binary.
- In checkout, use a direct CTA such as `Применить`.
- Do not show loyalty progress, thresholds, or "remaining to discount" copy in checkout. That progress belongs only in the customer profile.
- Show the checkout loyalty card only when the customer already has an available bonus for a category represented by an eligible cart item.
- If no applicable bonus is available, hide the checkout loyalty card completely.
- Checkout shows one action per represented product type: liquid, snus, disposable, or device. Product names, flavors, and variants are not shown in the loyalty card.
- If liquid and snus are both in the cart, show separate `На жидкость` and `На снюс` actions.
- After applying a bonus to one product type in a loyalty category:
  - that type shows `Применено`
  - another type in the same loyalty category stays visible but shows `Бонус уже выбран`
- The concrete eligible cart line is selected internally. Prefer the highest-priced eligible line within the chosen type so a price cap does not unnecessarily reduce the advertised discount.
- The UI must match the business rule exactly. Do not allow the user to think they can apply two bonuses in one category within one order.

## Wording Rules

Use consistent labels:

- `Промокод`
  - promo input label in checkout
- `Скидка по промокоду`
  - applied promo discount in checkout summary
- `Скидка за покупки`
  - applied loyalty discount in checkout summary
- `На заказ`
  - order-level discount that is not the loyalty discount

Avoid ambiguous labels such as:

- `Покупки` without context
- generic `Скидка`, if there is more than one discount source visible nearby

## CRM Display Rules

When multiple discount sources are visible in CRM:

- separate loyalty discount from order-level discount
- do not show one total discount line plus a second loyalty line if that reads like the same money was subtracted twice
- use one visual pattern for all discount rows in the same card
- Current customer `MyOrder` screen uses a single aggregated row `Скидка` without source split. If source-specific rows are needed there, update both UI and this document.

## Order Editing / Cancellation Expectations

The validated expectation for the current system is:

- issued/delivered orders affect dashboards and cash summaries
- payment cancellation should remove the order from delivered-day summaries
- stock returns only after order cancellation, not merely after payment deletion
- loyalty behavior around cancellation must be checked separately when tasks touch earned bonuses

If a task changes these rules, update this document.
