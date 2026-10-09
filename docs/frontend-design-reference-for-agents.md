# Frontend Design Reference For Agents

## Purpose

This document defines the current customer-facing design language of the NAVALIVAY frontend. Use it when implementing or restyling user UI so new work stays aligned with the mobile reference screens already approved locally.

This is not a generic design wishlist. It is a practical source of truth for future agents.

This document applies only to the customer-facing user interface.

It does not define the visual rules for:

- CRM screens
- admin pages
- internal operational tools
- backoffice interfaces

## Reference Priority

When there is ambiguity, use this priority order:

1. The current implemented customer UI in the files listed below.
2. A newer screenshot or Figma correction explicitly provided by the user.
3. This document.
4. Older UI that still exists elsewhere in the repo.

Do not revive older visual systems just because they still exist in the codebase.

If you are working on admin or CRM UI, do not use this document as the primary visual source unless the user explicitly tells you to unify those surfaces with the customer app.

## Canonical Reference Files

If you need to copy an existing visual pattern, start here:

- `frontend/src/views/ProfileView.vue`
  - canonical red loyalty card
  - canonical white profile cards
  - canonical customer modal visual language
- `frontend/src/views/CheckoutView.vue`
  - canonical fixed-width loyalty tabs behavior
  - canonical checkout loyalty card adaptation
- `frontend/src/components/CustomerModalShell.vue`
  - canonical customer modal shell
  - blur overlay, white card, round close button, centered presentation
- `frontend/src/components/BottomTabBar.vue`
  - canonical footer shape
  - transparent inverse cutout behavior
- `frontend/src/views/HomeView.vue`
  - canonical active-order red card on the home page
  - canonical floating cart CTA placement above the footer reserve

If a new customer component needs a modal, tabbed red promo card, or footer-aware layout, reuse these patterns instead of inventing a new one.

## Visual Thesis

The customer app is:

- mobile-first
- iOS-like in spacing and softness
- clean and bright on the page surface
- aggressive red only where the product wants attention
- restrained everywhere else

The UI should feel intentional and product-led, not dashboard-like and not generic SaaS.

## Baseline Screen Assumption

Primary design target:

- `393 x 852` mobile screen

Secondary checks:

- `375px` width
- `360px` width

All customer-facing work must remain visually stable at those widths.

## Core Surface Rules

### App background

- default page background: `#F5F7FA`
- large white surfaces should feel embedded into that background, not outlined with heavy borders

### Cards

- primary white cards usually use large radii in the `20px` to `24px` range
- white cards should look soft and clean, with either no border or extremely subtle separation
- avoid dark cards unless the user explicitly requests a different treatment

### Red accent system

The approved red gradient language is:

- `linear-gradient(106.76deg, #F50302 -2.64%, #A90F0E 85.78%)`

Use it for:

- loyalty feature card
- major promo-style customer card
- high-priority CTA surfaces
- footer red surface

Do not swap this for unrelated pink, purple, burgundy, or neutral gradients.

### Shadows

- shadows are soft and restrained
- avoid large glowing red shadows on customer CTAs
- if a surface works without a shadow, prefer the cleaner version

## Typography Rules

Use the existing type split:

- `Montserrat`
  - headings
  - strong CTA labels
  - emphasized product-level statements
- `SF Pro Display` or the existing iOS/system stack
  - body copy
  - helper text
  - tabs
  - labels
  - counters

Do not introduce a third visual type system for customer screens unless the user explicitly asks for it.

## Component Rules

### Loyalty card

The loyalty card on the profile screen is the main promotional reference.

Required characteristics:

- one red card, not multiple separate cards
- category switching through tabs
- active tab uses a white pill
- inactive tabs sit directly on the red surface
- progress bar is a continuous bar, not segmented
- track behind the fill is light and translucent, not dark
- discount amount stays visually attached to the description text
- rules link sits in a stable place and must not jump when tabs change

When building other promo widgets, this card is the closest approved reference.

### Checkout loyalty application

In checkout, loyalty application is not a quantity-picker interaction anymore.

Required characteristics:

- do not expose bonus application as `0 шт. / 1 шт.`
- do not show the loyalty progress calculator in checkout; progress stays in the profile
- show the red checkout loyalty card only for bonuses that can be applied to an eligible item in the current cart
- list available product types vertically (`На жидкость`, `На снюс`, `На одноразку`, `На устройство`) instead of exposing unavailable categories as tabs
- do not show product names, flavors, or variants inside the loyalty card
- use a direct action pattern like `Применить`
- once a bonus is applied inside a loyalty category, another product type in that same category stays visible with the passive state `Бонус уже выбран`
- keep the payload/business logic unchanged unless the task explicitly changes loyalty rules

The UX here must express the real rule: one applied loyalty bonus per category per order.

### My order screen

`frontend/src/views/MyOrderView.vue` is now its own reference for the active order flow.

Required characteristics:

- status information is visually separated from the rest of the page
- the top status card may use a dark neutral gradient when explicitly requested by the user
- do not show the order number inside the status hero block unless the user explicitly asks for it
- the `Изменить заказ` / `Отменить заказ` actions are fixed to the bottom of the screen on long orders
- when the bottom tab bar is hidden for this route, sticky actions must anchor to the real screen bottom, not to the tab-bar reserve
- for `in_progress` orders, the approved pickup copy currently includes the pickup window `10:30–21:00`

This is a screen where clarity beats reuse. The status card and sticky actions should reduce scanning effort first.

### Tabs

For customer tabs inside a shared horizontal row:

- tabs must have stable width
- switching active state must not move neighboring tabs
- prefer the checkout/profile model where each tab uses flexible equal-width slots
- do not let active state add width that changes layout

If you need fixed tabs, follow `CheckoutView.vue` and the updated `ProfileView.vue`.

### Customer modals

Use `CustomerModalShell.vue` for customer-facing modal work.

Required modal traits:

- full-screen dimmed blur overlay
- centered white card
- round light close button
- red pill CTA for the main action
- spacing that stays clear of the bottom tab bar

Do not send customer dialogs through the admin modal system.

### Bottom tab bar

The footer is a shape, not an overlay hack.

Required traits:

- red footer surface
- inverse rounded top cutout
- content must not be covered by a white cap layer
- page layout must reserve footer space globally
- floating elements should anchor relative to the footer reserve

Never reintroduce:

- a white block that sits on top of page content
- a fake cap layer that hides products while scrolling
- page-specific magic offsets instead of the shared footer height variable

### Floating cart button

The floating cart CTA should:

- sit flush against the top of the reserved footer zone
- not use a red glow
- feel aligned with the footer shape

### Active order widget

The home-page active order widget now uses the same red promotional language as the loyalty card.

If restyling similar high-priority widgets:

- prefer the approved red gradient
- keep white text
- use a clean white secondary pill for the local action when needed

## Layout Rules

- mobile-first first, then adapt upward
- preserve generous horizontal padding around major cards
- avoid crowded card stacks and unnecessary dividers
- keep the interface visually calm between red highlight surfaces
- use large radii and soft spacing instead of heavy borders

## Interaction Rules

- no jumping controls
- no layout shift when toggling tabs or opening small stateful elements
- motion should be short and smooth, not flashy
- if a modal opens, it should ease in rather than pop abruptly
- fixed UI must not create visual seams against content

## Do And Do Not

### Do

- reuse the existing approved customer patterns
- compare against the profile loyalty card before inventing a new promo block
- compare against `CustomerModalShell.vue` before styling a new modal
- verify screens at `393`, `375`, and `360`
- check that footer-aware layouts do not cover real content

### Do not

- introduce a second customer design language
- add generic boxed UI chrome everywhere
- use dark neutral cards when the approved reference is white or red
- rely on white overlays to fake footer curvature
- let tab labels resize the layout when active

## Recommended Workflow For Future Agents

Before editing customer UI:

1. Read this document.
2. Open the closest existing reference component.
3. Reuse the pattern rather than recreating it.
4. Compare your result on a narrow mobile width.
5. Verify that fixed elements do not cover content.

If the user sends a screenshot that conflicts with the current implementation, treat the user screenshot as the newest source of truth and update both the code and this document if the change becomes the new standard.
