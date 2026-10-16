# Card Payment Limits Rules

This document records the agreed business rules for card payments in the
customer Mini App and CRM. Card payments are a separate payment flow and must
not be treated as cash-register income.

## Shared Monthly and Daily Limits

- Each month has its own independently configured card-payment limit.
- The daily limit is derived from the monthly limit and the remaining monthly
  allowance, divided across the applicable remaining calendar days.
- Daily limits and daily usage use the `Europe/Minsk` business date.
- A manager can increase the shared limit for the current day from the orders
  page. The increase applies only to that day; it does not change the monthly
  limit or later days' base calculation.
- A manual card entry is always allowed, even if it exceeds the current daily
  limit. It counts toward monthly usage. When deriving future daily limits,
  exclude the day on which the manual entry was made; recalculate from the
  following day using the remaining monthly allowance and remaining days.
- Displayed usage includes both issued card payments and active reservations.
  A card order reserves its card amount when created so concurrent checkouts
  cannot spend the same shared capacity.
- If the shared daily limit has not yet been reached when a card order is
  submitted, allow that entire order even if it crosses the limit. Do not
  prorate or reject the final order. Once the limit is reached, reject later
  card orders.
- Always make the final shared-limit decision on the server, atomically with
  reservation and order creation. A stale checkout display is informational
  only. For a race loss, tell the customer:
  “Лимит оплаты по карте на сегодня уже занят другим заказом. Вы можете
  оформить этот заказ только за наличные.”

## Per-Account Eligibility

- Card payment is disabled by default. An authorized CRM user can enable it
  for an account, including one that has not placed an order yet.
- A manually entered Telegram username is a pending identity. Once the person
  is verified, bind the permission and settings to their Telegram ID; changing
  their username must not remove or transfer the permission.
- **There is no per-account monthly limit.** An account has a configurable
  maximum card amount for one order and a pause duration (default 10 days).
  Using any positive card amount consumes the account's allowance for the full
  cooldown; the pause starts when the order is issued, not when it is created.
- A normal card order must fit within the account's per-order limit and must
  not overlap the account's active pause. If it does not fit, return the actual
  personal limit and order amount in the message. The only monthly/daily
  constraints are the shared shop limits above.
- If an already-created card order is edited to exceed the eligible personal
  card amount, keep the allowed amount on card and make the excess payable in
  cash. Do not increase the card reservation beyond the allowed amount.
- Cancelling an unissued card order releases its reservation. Cancelling or
  reversing an issued card payment restores its card allowance/cooldown.
- The legacy `monthly_limit_minor` columns on
  `card_payment_accounts`/`card_payment_tariffs` are kept only for backward
  compatibility and are never enforced or shown anywhere.

## Order Lifecycle and Accounting

- Count an issued card amount against the Minsk business day on which the
  customer collects the order, even if it was created on an earlier day.
- Cancellation before collection releases the reservation; cancellation or
  payment reversal after collection reverses the recorded card operation and
  restores the personal cooldown.
- Card proceeds never increase a cash account. For a mixed card/cash order,
  only the cash portion is recorded as cash-register income.
- A seller may change a card order to cash before issue. Release its card
  reservation and record the cash payment through the normal cash flow.
- Customer-facing assembled/ready notifications must say “По карте” for card
  payments, not “Наличными”.
- Manual “passer-by” card operations reduce the shared daily allowance and
  monthly remainder, but do not consume any account's personal allowance.
  Store amount, time, entering CRM username, and optional comment.

## Requests to Increase an Account Limit

- Only accounts already enabled for card payment can view and submit a request.
- Tariffs are configurable in CRM. A tariff sets the **per-order limit** and
  optionally the **cooldown duration in days** (empty = keep the account's
  current pause). Name, position, active state, and informational
  transition-cost text are also configurable; transition-cost text is not a
  payment or charge in the system. Example: «Стандарт» — 45 BYN per order,
  10-day pause; «Старт» — 55 BYN per order, 8-day pause.
- Applying a tariff (directly or by approving a request) updates the account's
  per-order limit and, when the tariff sets it, the pause duration. It never
  touches any monthly value.
- A request records the account identity, username, selected tariff, current
  limit, requested limit, and timestamp. CRM users handle the request manually.
- Available request statuses are `Новая`, `Обработана`, and `Отклонена`.
- After submitting, only another request is blocked for one hour; card payment
  remains available subject to its normal limits.
- Confirm submission with a modal message that the request was accepted and
  that the customer will be contacted.

## CRM Access and Audit Boundary

- Show card-limit controls to users who are on the CRM orders page; this
  feature does not depend on an open shift or employee role.
- Do not change employee shifts, employee roles, or the employee action log to
  implement card limits or manual card entries.
- Keep card operations in their dedicated ledger and separate from cash
  transactions.
