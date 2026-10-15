# Wholesale Rules

## Purpose

This document defines the current wholesale storefront behavior across backend, admin, customer flow, and CRM.

Use it when a task touches:

- wholesale link access
- tier-based pricing
- category group wholesale pricing in admin
- wholesale checkout restrictions
- wholesale order editing and CRM visibility

Related documents:

- `docs/telegram-mini-app.md` (Telegram env, `/api/settings`, deep links, Mini App vs browser)
- `docs/loyalty-rules.md`
- `docs/promo-rules.md`

## Source Of Truth

- Wholesale data model and helpers:
  - `server/migrations/add_wholesale_pricing.js`
  - `server/wholesale-service.js`
- Admin API:
  - `server/routes/admin.js`
- Public storefront and order API:
  - `server/routes/public.js`
- Admin UI:
  - `frontend/src/components/admin/AdminCategoryGroupForm.vue`
  - `frontend/src/components/admin/AdminWholesaleLinksPanel.vue`
  - `frontend/src/views/AdminView.vue`
- Customer wholesale mode:
  - `frontend/src/stores/wholesale.ts`
  - `frontend/src/utils/telegramMiniAppContext.ts`
  - `frontend/src/main.ts` (bootstrap + `applyTelegramWholesaleStartParam`)
  - `frontend/src/components/WholesaleStatusBar.vue`
  - `frontend/src/views/WholesaleEntryView.vue`
  - `frontend/src/views/CheckoutView.vue` (wholesale requires real Mini App user context)

## Core Business Model

- Wholesale works as a special mode of the same storefront, not a separate B2B frontend.
- Access is granted by a secret link.
- Price is set on the category group level, not on the product or variant level.
- If a group has no wholesale price for the active tier, its products must not be visible in that wholesale storefront.
- Parent groups may still be visible in catalog navigation if they contain child groups with wholesale prices.
- Products without `groupId` (direct products, e.g. «Никобустер») are **visible and purchasable in wholesale at their retail price** and never count toward the minimum.
- Group products with `products.excluded_from_wholesale_min = 1` are purchasable at the tier price but do not count toward the minimum.
- The minimum is a **quantity of positions (units)**, not a sum: the customer cannot submit an order until the cart holds at least the minimum number of countable units (sum of штук across items that are not excluded).
- Wholesale tiers (`wholesale_tiers`, ids unchanged):
  - `wt_100` → code `25`, minimum 25 позиций
  - `wt_250` → code `50`, minimum 50 позиций
  - `wt_500` → code `100`, minimum 100 позиций
  - `wt_1000` → code `150`, minimum 150 позиций
- `min_order_amount` is legacy: kept only for old orders/contexts created before the quantity switch. New validation uses `min_order_quantity`.
- A customer may have a **personal minimum override** (`customers.wholesale_min_override`, NULL = tier default): the tier link and prices stay the same, only the enforced minimum changes. The server resolves the override from verified Telegram Mini App identity and snapshots the applied minimum into `orders.wholesale_min_quantity`.

## Link Rules

- Public wholesale link format (same origin):
  - `/opt/:code/:secret`
- For Telegram, the storefront may be opened with `startapp` carrying an encoded wholesale pair (see `docs/telegram-mini-app.md`). That path still ends up on `wholesale-entry` with the same `code` and `secret`.
- Admin "copy link" for tiers produces a `t.me` mini app URL when `TELEGRAM_BOT_USERNAME` (and valid `/opt/...` path) are configured.
- Entering that link activates wholesale mode in the frontend session **only with valid Telegram Mini App user context** (signed `initData`). In an external browser, the entry screen prompts to open Telegram instead of activating the tier.
- When opening another wholesale link while cart is not empty or customer is editing an order, frontend asks for confirmation and clears cart/edit state only after confirmation.
- Backend must validate both tier code and secret.
- Invalid or incomplete wholesale links must not expose wholesale pricing.
- API accepts wholesale credentials through:
  - headers: `x-wholesale-code`, `x-wholesale-secret`
  - query/body: `wholesale_code`, `wholesale_secret`
  - compatibility aliases: `wholesaleCode`, `wholesaleSecret`

## Pricing Rules

- Wholesale price comes from `category_group_wholesale_prices`.
- In **wholesale** mode, product and variant retail list prices are ignored for the public API: variants use the resolved wholesale **effective** unit price for the tier.
- In **retail** mode, if a variant row has `priceRub` set and it is a finite number `> 0`, the public product APIs expose that per-variant price; otherwise the variant uses the same effective retail price as the product line (existing behavior).
- All variants inside the same priced group use the same wholesale unit price for the active tier.
- Average cost shown in admin is informational and auto-calculated from products in the group.

## Admin Rules

- Managers edit wholesale prices inside the category group modal.
- Admin should show:
  - average group cost
  - one price field per wholesale tier (with the tier's quantity minimum)
- The product form has the «Не считать в минимальном количестве опта» flag (`excluded_from_wholesale_min`); direct products (no group) never count regardless of the flag.
- Admin should provide easy copyable wholesale links for each tier.
- Coverage should be visible:
  - how many line groups already have a price for that tier
  - how many are still missing

## CRM Rules

- CRM orders should clearly indicate if the order is wholesale.
- CRM should show:
  - that the order is wholesale
  - the wholesale tier label
  - the minimum order quantity (or legacy sum) applied to that order
- «Настройки клиента» (Orders page toolbar) opens a modal where a manager finds a client by Telegram username and can set or reset the client's personal wholesale minimum (`GET/PUT /api/admin/crm/wholesale-settings/:username`). Prices and tier are not affected; the modal is the extension point for future per-customer settings.

## Customer Storefront Rules

- In wholesale mode:
  - retail banners are hidden
  - loyalty mechanics are hidden and disabled
  - the promo field is available for gift promos only
  - regular promo discounts remain disabled
  - retail bottom navigation is hidden
  - wholesale status bar is shown on home and category screens
  - wholesale status bar is hidden on `product`, `checkout`, `my-order`, and `wholesale-entry` screens
- Routes `profile`, `section-2`, and `section-3` are blocked in wholesale mode and redirected to home.
- The customer sees an informational wholesale banner with:
  - chosen wholesale tier
  - minimum order quantity in positions (with a personal-minimum marker when an override applies)
  - remaining positions to reach the minimum
- On mount of home and checkout, the wholesale store re-fetches `/api/wholesale/context` (`refreshEffectiveMinimum`) so a mid-session admin override takes effect without re-activating the link.

## Checkout Rules

- Wholesale checkout uses the same order flow as retail, but with different restrictions.
- Wholesale checkout in the customer UI is allowed only when there is a real Mini App session (`initData` + user id). Otherwise the user must open the app from Telegram.
- The server is the final authority for:
  - wholesale price resolution
  - minimum quantity validation (error `wholesale_min_not_met` with `min_quantity`, `current_quantity`, `remaining_quantity`)
  - allowing only gift promos and forcing their monetary discount to zero
  - disabling loyalty usage
- The effective minimum = `customers.wholesale_min_override ?? tier.min_order_quantity` and is validated in three places: order preflight, order creation, and order modify. Each submission snapshots the applied minimum into `orders.wholesale_min_quantity`.
- Countable units = sum of item quantities for items whose product is not excluded (`groupId` set and `excluded_from_wholesale_min = 0`).
- Legacy orders created before the quantity switch keep their sum-based minimum: the UI shows the old «Минимальная сумма» line from the stored snapshot, and the legacy amount validation remains as a fallback.
- Gift promos (`has_gift = 1`), including customer-bound roulette prizes, may be attached to wholesale orders.
- Customer-bound roulette promos require verified Telegram Mini App identity during both validation and order submission.
- Gift promo usage is reserved and consumed through the normal promo lifecycle.
- Ordinary discount promos must be rejected even if a client sends one directly to the API.
- The checkout UI must clearly show:
  - minimum wholesale quantity in positions
  - whether the minimum is already met
  - how many more positions must be added if not met (submit is blocked below the minimum)

## Order Editing Rules

- Customer order editing stays enabled for wholesale orders.
- When the customer opens editing for an existing wholesale order:
  - wholesale context must be restored
  - cart must keep wholesale prices
  - minimum validation still applies on save (in countable units for quantity-based orders; the stored snapshot minimum is used when the admin later clears a personal override)

## Compatibility Rules

- Retail flow must continue working unchanged when wholesale mode is not active.
- Wholesale logic must be additive:
  - do not change retail prices
  - do not apply wholesale restrictions outside wholesale mode
