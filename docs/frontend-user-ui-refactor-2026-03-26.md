# Frontend User UI Refactor - 2026-03-26

## Scope

This document records the user-facing frontend work completed during the local refinement pass for the customer app. The goal of the pass was to bring the mobile UI closer to the Figma reference, restore temporarily disabled elements, and document the technical decisions that must not be accidentally reverted later.

This document is about the customer-facing interface only. It does not describe admin or CRM design rules.

Related design guidance for future agents:

- `docs/frontend-design-reference-for-agents.md`

The changes in this doc cover:

- bottom tab bar restoration and redesign
- cart floating button positioning
- checkout loyalty widget visibility and browser behavior
- checkout modal unification
- profile loyalty card redesign
- profile loyalty rules modal behavior

## Files Touched

Primary files:

- `frontend/src/App.vue`
- `frontend/src/components/CustomerModalShell.vue`
- `frontend/src/components/BottomTabBar.vue`
- `frontend/src/components/MinDeliveryBanner.vue`
- `frontend/src/components/DeliveryConditionsBanner.vue`
- `frontend/src/components/LoyaltyBonusPopup.vue`
- `frontend/src/views/HomeView.vue`
- `frontend/src/views/CategoryView.vue`
- `frontend/src/views/CheckoutView.vue`
- `frontend/src/views/ProfileView.vue`
- `frontend/src/views/__tests__/CheckoutView.spec.ts`
- `frontend/src/views/__tests__/ProfileView.spec.ts`

Secondary layout impact:

- `frontend/src/views/PlaceholderView.vue`

## User-Facing Changes

### 1. Bottom tab bar was re-enabled

The temporary production flag that fully hid the bottom navigation was removed.

Current route behavior:

- tab bar is visible on normal customer pages
- tab bar remains hidden on `/admin`
- tab bar remains hidden on `/checkout`
- tab bar remains hidden on `/my-order`

### 2. Bottom tab bar shape was reworked

The tab bar no longer uses a white overlay panel that sits on top of page content.

Current implementation:

- the footer shape is drawn as a single red SVG surface
- the top cutout is transparent
- page content remains visible above/behind the cutout area
- layout reserves space for the footer through `--app-bottom-tab-bar-height`

Important rule:

- do not reintroduce a white `cap` overlay above the footer
- if the top inverse rounding is changed in the future, preserve transparent cutout behavior
- the footer must remain a shape, not a white mask layer over content

### 3. Global app shell now reserves footer space

The app shell in `App.vue` now owns the footer spacing rather than leaving that responsibility to each page independently.

Current mechanism:

- `:root` defines `--app-bottom-tab-bar-height`
- `BottomTabBar.vue` updates that variable from its real rendered height via `ResizeObserver`
- `.app-shell--with-tab-bar` uses that variable as bottom padding

Why this matters:

- pages end before the footer area
- fixed elements can anchor relative to the tab bar height
- future responsive changes to the footer do not require hardcoding spacing across many pages

### 4. Floating cart button behavior changed

The floating cart button on home/category pages was adjusted to visually align with the tab bar.

Applied changes:

- removed the red glow and shadow from the button
- moved the button to sit flush with the top edge of the tab bar reserve
- kept only horizontal wrapper padding

Reason:

- the old shadow created a visible seam against the raised footer shape
- the old vertical offset exaggerated the gap above the footer

### 5. Checkout loyalty widget is visible in browser

The checkout loyalty block is no longer Telegram-only in practice.

Current behavior:

- loyalty preview can render in a normal browser without `window.Telegram`
- the checkout screen shows a single loyalty card with tabs for available categories
- browser testing can be done locally without Telegram WebApp context

### 6. Checkout loyalty widget layout was redesigned

The checkout loyalty area was rebuilt to match the Figma-style bonus block pattern.

Current behavior:

- only one loyalty card is rendered
- categories are switched via tabs
- progress is shown per active category
- descriptive copy and discount amount are shown inside the main text block
- rules link is shown inside the card

Important rule:

- keep a single active-category card in checkout
- do not return to stacked loyalty cards per category

### 7. Profile loyalty card was redesigned

The profile screen no longer uses multiple simple loyalty cards. It now uses one main promotional loyalty block.

Current profile card behavior:

- one red loyalty card
- category tabs inside the card
- progress bar with current count and threshold
- category-specific description lines
- discount amount integrated into the text flow
- fixed bottom rules link placement

Important visual rules:

- the rules link must not jump when changing tabs
- the discount amount must stay visually attached to the description
- liquids/disposables/devices may use different controlled line breaks if needed for stability on narrow screens

### 8. Profile rules link opens a modal

The rules area was moved out of the page flow and now opens a proper modal.

Current modal behavior:

- click on "Как работают скидки за покупки" opens a centered modal card
- overlay uses blur and dimming
- close button exists inside the modal
- bottom CTA "За покупками" exists inside the modal

### 9. Profile modal overlay was fixed for the new footer

After the tab bar became a transparent-cutout shape, the profile modal needed a different overlay strategy.

Current behavior:

- overlay now covers the full viewport
- modal card remains visually centered above the tab bar through bottom padding
- there is no open strip below the overlay where content can leak through the footer cutout

Important rule:

- modal overlays should cover the full screen
- positioning above the footer should be achieved with `padding-bottom`, not by shrinking the overlay with `bottom: var(--app-bottom-tab-bar-height)`

### 10. Checkout modals were unified to the profile modal design

Cart/checkout modals no longer mix multiple visual systems.

Current behavior:

- checkout username modal uses the same white card / blur overlay / round close button pattern
- checkout loyalty rules modal uses the same pattern
- minimum delivery banner uses the same pattern
- delivery conditions modal uses the same pattern
- loyalty bonus popup also uses the same shell

Implementation rule:

- customer-facing checkout modals should use `CustomerModalShell.vue`
- do not route checkout dialogs back through `AdminModal.vue`
- do not restore standalone black fullscreen modal designs for checkout-only overlays

## Technical Decisions That Must Be Preserved

### Footer architecture

Use this model:

- app shell reserves footer space
- footer reports its own height
- footer shape is drawn directly
- inverse top shape is transparent, not a white overlay

Avoid this model:

- fixed white mask panel sitting above content
- negative-position white cap
- page-specific magic numbers for footer spacing

### Modal architecture above fixed footer

Use this model:

- full-screen overlay
- modal card centered with top/bottom padding
- bottom padding includes `var(--app-bottom-tab-bar-height)`

Avoid this model:

- overlay with `bottom: var(--app-bottom-tab-bar-height)`
- leaving an uncovered strip between overlay and footer

### Customer modal architecture

Use this model:

- shared `CustomerModalShell.vue`
- profile-style blur backdrop
- white card with fixed header pattern
- red pill CTA for primary action

Avoid this model:

- using `AdminModal.vue` for customer checkout flows
- one-off modal CSS per checkout scenario
- different visual systems for username, rules, delivery, and bonus popups

### Loyalty card architecture

Use this model:

- one card with tabs
- active category determines progress/text
- stable fixed placement for low-priority affordances like the rules link

Avoid this model:

- one separate full card per category in checkout/profile
- progress rendering that looks filled at `0 / N`
- independent absolute discount label detached from the text block

## Verification Performed

The following checks were run during the refactor:

- `npm run build-only`
- `npm run test:unit -- src/views/__tests__/CheckoutView.spec.ts`
- `npm run test:unit -- src/views/__tests__/ProfileView.spec.ts`

Known non-blocking build warnings still exist and are not caused by this refactor:

- Vite warning about mixed static/dynamic import for `GroupLineItem.vue`
- esbuild CSS minify warning around `.scrollbar-hide`

## Regression Checklist

If this area is touched again, verify the following manually:

1. Home page categories remain visible above the footer cutout.
2. Floating cart button does not cast a red shadow and does not visually fight the footer.
3. Checkout loyalty widget renders in a normal browser without Telegram.
4. Profile loyalty card keeps the rules link in a stable position across tab changes.
5. Profile rules modal does not expose page content in the strip above the footer.
6. The footer keeps the Figma-like inverse top rounding without a white overlay covering content.

## Reason For The Final Footer Approach

Several footer approaches were explored during the refactor:

- white cap overlay above the footer
- full-height reserved white cap area
- route-specific spacing adjustments

Those approaches were rejected because they either:

- covered product content during scroll
- exposed an oversized white strip above the footer
- created visual seams when used together with modals and fixed buttons

The adopted approach is:

- footer rendered as a single responsive SVG shape
- transparent cutout at the top
- global footer-height reservation in app shell

This is the safest approach for keeping the Figma silhouette while preventing content occlusion.
