<template>
  <div
    ref="pageEl"
    class="checkout-page"
    :class="{ 'checkout-page--confirmation': isOrderConfirmation }"
    :style="pageMinHeight !== null ? { minHeight: `${pageMinHeight}px` } : undefined"
    @click="handlePageClick"
  >
    <!-- Хедер из демо: сетка назад / заголовок / очистить. -->
    <div class="header-area">
      <div class="checkout-header">
        <button class="icon-button" @click="handleBack" aria-label="Назад">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="m15 5-7 7 7 7" />
          </svg>
        </button>
        <h1 class="checkout-title">{{ checkoutTitle }}</h1>
        <button
          v-if="cartStore.items.length && !isOrderConfirmation"
          @click="handleClearCart"
          class="icon-button icon-button--muted"
          aria-label="Очистить корзину"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6h16M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
          </svg>
        </button>
        <span v-else class="icon-button icon-button--muted" aria-hidden="true"></span>
      </div>
    </div>

    <!-- main: единственный скроллируемый блок (демо). -->
    <main class="checkout-main">
    <div class="checkout-container">
      <div v-if="!cartStore.items.length" class="empty-cart">
        <div class="empty-cart-icon">🛒</div>
        <p>Корзина пуста</p>
        <button @click="handleBack" class="back-to-shop-btn">
          Вернуться к покупкам
        </button>
      </div>

      <div v-else-if="isOrderConfirmation" class="order-confirmation" role="status" aria-live="polite">
        <LottiePlayer
          class="order-confirmation__emoji"
          src="/lottie/confirmation-emoji.json"
          :size="88"
          :speed="1"
        />
        <p class="order-confirmation__title">{{ confirmationText }}</p>
        <p class="order-confirmation__small-text">{{ confirmationSmallText }}</p>
      </div>

      <div v-else class="checkout-content">
        <!-- Карточка заказа из демо: компактные строки, сворачивание
             «Ещё N товаров», итого внутри карточки. -->
        <div class="order-card">
          <section class="cart-items" aria-label="Товары в корзине">
            <!-- Первая строка — всегда видна. -->
            <article
              v-for="item in visibleItems"
              :key="item.productId + (item.variantId || '')"
              class="cart-item"
            >
                <div class="cart-item-visual">
                  <span class="cart-item-thumb">
                    <img
                      v-if="item.image"
                      :src="item.image"
                      :alt="item.title"
                    />
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      aria-hidden="true"
                    >
                      <path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" />
                    </svg>
                  </span>
                  <span v-if="isIceProduct(item)" class="ice-badge">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M5 0.5V9.5M0.5 5H9.5M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
                        stroke="white"
                        stroke-width="1.4"
                        stroke-linecap="round"
                      />
                    </svg>
                  </span>
                </div>

                <div class="cart-item-info">
                  <p v-if="item.groupName" class="cart-item-group">
                    {{ item.groupName }}
                  </p>
                  <h3 class="cart-item-title">
                    {{ item.title }}
                  </h3>
                  <p class="cart-item-meta" v-if="item.variantName">
                    {{ item.variantName }}
                  </p>
                  <p class="cart-item-price">
                    <span v-if="getItemOldTotal(item)" class="cart-item-price-old">
                      {{ formatPrice(getItemOldTotal(item)!) }}
                    </span>
                    {{ formatPrice(item.priceRub * item.quantity) }} BYN
                  </p>
                </div>

                <div class="cart-item-controls">
                  <button
                    @click="decrementQuantity(item.productId, item.variantId)"
                    class="qty-btn"
                    :aria-label="`Уменьшить количество: ${item.title}`"
                  >
                    <span>−</span>
                  </button>
                  <span class="qty-value">
                    <span>{{ item.quantity }}</span>
                  </span>
                  <button
                    @click="incrementQuantity(item.productId, item.variantId)"
                    class="qty-btn"
                    :class="{ 'qty-btn-disabled': !canIncrement(item) }"
                    :disabled="!canIncrement(item)"
                    :aria-label="`Увеличить количество: ${item.title}`"
                  >
                    <span>+</span>
                  </button>
                </div>
              </article>

            <!-- Сворачиваемый хвост «Ещё N товаров» (демо .more):
                 сначала список, кнопка — В КОНЦЕ, после строк. -->
            <div
              v-if="collapsedItems.length"
              class="cart-more"
              :class="{ 'cart-more--open': isItemsExpanded }"
            >
              <div class="cart-more-list">
                <div>
                  <article
                    v-for="item in collapsedItems"
                    :key="item.productId + (item.variantId || '')"
                    class="cart-item"
                  >
                    <div class="cart-item-visual">
                      <span class="cart-item-thumb">
                        <img
                          v-if="item.image"
                          :src="item.image"
                          :alt="item.title"
                        />
                        <svg
                          v-else
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          aria-hidden="true"
                        >
                          <path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" />
                        </svg>
                      </span>
                      <span v-if="isIceProduct(item)" class="ice-badge">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M5 0.5V9.5M0.5 5H9.5M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
                            stroke="white"
                            stroke-width="1.4"
                            stroke-linecap="round"
                          />
                        </svg>
                      </span>
                    </div>

                    <div class="cart-item-info">
                      <p v-if="item.groupName" class="cart-item-group">
                        {{ item.groupName }}
                      </p>
                      <h3 class="cart-item-title">
                        {{ item.title }}
                      </h3>
                      <p class="cart-item-meta" v-if="item.variantName">
                        {{ item.variantName }}
                      </p>
                      <p class="cart-item-price">
                        <span v-if="getItemOldTotal(item)" class="cart-item-price-old">
                          {{ formatPrice(getItemOldTotal(item)!) }}
                        </span>
                        {{ formatPrice(item.priceRub * item.quantity) }} BYN
                      </p>
                    </div>

                    <div class="cart-item-controls">
                      <button
                        @click="decrementQuantity(item.productId, item.variantId)"
                        class="qty-btn"
                        :aria-label="`Уменьшить количество: ${item.title}`"
                      >
                        <span>−</span>
                      </button>
                      <span class="qty-value">
                        <span>{{ item.quantity }}</span>
                      </span>
                      <button
                        @click="incrementQuantity(item.productId, item.variantId)"
                        class="qty-btn"
                        :class="{ 'qty-btn-disabled': !canIncrement(item) }"
                        :disabled="!canIncrement(item)"
                        :aria-label="`Увеличить количество: ${item.title}`"
                      >
                        <span>+</span>
                      </button>
                    </div>
                  </article>
                </div>
              </div>
              <!-- Кнопка — в конце списка (демо: label после .more-list). -->
              <button
                type="button"
                class="cart-more-link"
                :aria-expanded="isItemsExpanded ? 'true' : 'false'"
                aria-label="Показать остальные товары"
                @click="toggleMoreItems"
              >
                <span class="closed">Посмотреть все товары</span>
                <span class="opened">Свернуть список</span>
              </button>
            </div>
          </section>

          <!-- Незабранный заказ: анимированный восклицательный знак
               в треугольнике (Telegram Lottie, NewsEmoji red warning)
               + текст-подчерк и сумма — как строка итого. Разделения
               строк нет: дата и «подробнее» в одну строку;
               «подробнее» открывает модалку-согласие. -->
          <div v-if="unclaimedOrder" class="unclaimed-block">
            <LottiePlayer
              src="/lottie/red-warning.json"
              :size="28"
              :speed="1"
            />
            <span class="unclaimed-copy">
              <span class="unclaimed-title">Заказ который не забрали</span>
              <span class="unclaimed-date">
                {{ unclaimedOrder.date }}
                <button
                  type="button"
                  class="unclaimed-details"
                  @click="openUnclaimedAgreement"
                >подробнее</button>
              </span>
            </span>
            <span class="unclaimed-amount">{{ unclaimedOrder.amount }} BYN</span>
          </div>

          <div v-if="canChooseCheckoutPayment" class="payment-note">
            <!-- Нативная анимация Telegram-стикера «Heavy Dollar Sign»
                 (TGS → Lottie JSON) вместо статичного знака «?». -->
            <span class="payment-note__mark" aria-hidden="true">
              <LottiePlayer
                class="payment-note__dollar"
                src="/lottie/dollar-emoji.json"
                :size="26"
                :speed="1"
              />
            </span>
            <span class="payment-note__label">Способ оплаты</span>
            <div class="payment-note__choices" role="radiogroup" aria-label="Способ оплаты">
              <span
                class="payment-note__selection"
                :class="selectedPaymentMethod === 'card' ? 'payment-note__selection--card' : 'payment-note__selection--cash'"
                aria-hidden="true"
              ></span>
              <button
                type="button"
                class="payment-note__choice"
                role="radio"
                :class="{ 'payment-note__choice--selected': selectedPaymentMethod === 'cash' }"
                :aria-checked="selectedPaymentMethod === 'cash'"
                :tabindex="selectedPaymentMethod === 'cash' ? 0 : -1"
                aria-label="Наличными"
                @click="selectCheckoutPayment('cash')"
                @keydown="handlePaymentChoiceKeydown($event, 'cash')"
              >
                <img src="/checkout/cash-wallet.webp" alt="" />
              </button>
              <span class="payment-note__card" ref="cardChoiceWrapRef">
                <button
                  type="button"
                  role="radio"
                  :aria-checked="selectedPaymentMethod === 'card'"
                  :aria-disabled="isCardBlockedForOrder ? 'true' : 'false'"
                  :tabindex="selectedPaymentMethod === 'card' ? 0 : -1"
                  aria-label="Картой"
                  :class="[
                    'payment-note__choice',
                    'payment-note__choice--card',
                    { 'payment-note__choice--selected': selectedPaymentMethod === 'card', 'payment-note__choice--blocked': isCardBlockedForOrder },
                  ]"
                  :disabled="isCheckingCardPaymentStatus"
                  @click="selectCheckoutPayment('card')"
                  @keydown="handlePaymentChoiceKeydown($event, 'card')"
                >
                  <img src="/checkout/card-terminal.webp" alt="" />
                </button>
              </span>
            </div>
          </div>

          <!-- Плашка по демо-образцу navalivay-card-limit-popover.
               Рендерится через Teleport прямо в body: карточка заказа
               обрезает контент (overflow:hidden + скругление), из-за чего
               плашка резалась об край. Снаружи она лежит поверх всего. -->
          <Teleport to="body">
            <Transition name="payment-note-pop">
              <div
                v-if="cardErrorText && cardPopoverStyle"
                class="payment-note__popover"
                role="alert"
                :style="{ ...cardPopoverStyle, '--duration': `${CARD_ERROR_RESET_MS}ms` }"
              >
                <div class="payment-note__popover-copy">
                  <strong>{{ cardErrorTitle }}</strong>
                  <p>{{ cardErrorText }}</p>
                </div>
                <button
                  type="button"
                  class="payment-note__popover-close"
                  aria-label="Закрыть предупреждение"
                  @click="clearCardError"
                >
                  <svg viewBox="0 0 40 40" aria-hidden="true">
                    <circle class="payment-note__popover-track" cx="20" cy="20" r="17" />
                    <circle class="payment-note__popover-ring" cx="20" cy="20" r="17" />
                    <path d="m15 15 10 10m0-10L15 25" />
                  </svg>
                </button>
              </div>
            </Transition>
          </Teleport>

          <div class="total-block">
            <span class="total-label">Итого</span>
            <div class="total-value-with-payment">
              <strong class="total-amount">{{ formatPrice(finalTotal) }} BYN</strong>
              <!-- Способ оплаты — текущее состояние, а не результат клика:
                   «Наличными» видно сразу, до первого выбора. -->
              <span class="total-payment-label" aria-live="polite">
                <Transition name="total-payment-swap" mode="out-in">
                  <span :key="effectivePaymentMethod" class="total-payment-label__text">
                    {{ effectivePaymentMethod === 'card' ? 'Картой' : 'Наличными' }}
                  </span>
                </Transition>
              </span>
            </div>
          </div>
        </div>

        <div v-if="isEditingOrder" class="editing-order-card">
          <p class="editing-order-kicker">Редактирование заказа</p>
          <p class="editing-order-title">
            Вы меняете оформленный заказ
          </p>
          <p class="editing-order-text">
            После сохранения мы обновим состав заказа.
          </p>
        </div>

        <div v-if="wholesaleStore.isWholesale" class="editing-order-card">
          <p class="editing-order-kicker">Оптовый заказ</p>
          <p class="editing-order-title">{{ wholesaleStore.wholesaleLabel }}</p>
          <p class="editing-order-text">
            <template v-if="wholesaleMinimumQuantity">
              Минимальное количество заказа -
              {{ wholesaleMinimumQuantity }} {{ pluralPositions(wholesaleMinimumQuantity) }}
              <span v-if="wholesaleStore.minOverride"> · персональный минимум</span>.
              <template v-if="wholesaleRemaining > 0">
                Не хватает {{ wholesaleRemaining }} {{ genitivePositions(wholesaleRemaining) }}.
              </template>
              <template v-else>
                Минимум выполнен, можно оформлять заказ.
              </template>
            </template>
            <template v-else>
              Минимальная сумма заказа - {{ wholesaleStore.minOrderAmount.toFixed(0) }} BYN.
              <template v-if="wholesaleRemaining > 0">
                Не хватает {{ wholesaleRemaining.toFixed(2) }} BYN.
              </template>
              <template v-else>
                Минимум выполнен, можно оформлять заказ.
              </template>
            </template>
          </p>
          <p v-if="wholesaleMinimumQuantity" class="editing-order-note">
            В минимальном количестве учитываются только товары линеек. Товары без
            линейки (например, бустеры) покупаются по розничной цене и не
            приближают корзину к минимуму.
          </p>
        </div>

        <!-- Промокод: ВСЁ внутри модалки (ввод, применённый код,
             описание, снятие). На странице — только кнопка открытия
             над «Оформить заказ» и скидка в итогах summary. -->
        <div v-if="!wholesaleStore.isWholesale && promoResult" class="summary-row">
          <span class="summary-label">Скидка по промокоду</span>
          <span class="summary-discount">-{{ formatPrice(promoResult.calculated_discount) }} BYN</span>
        </div>

        <section
          v-if="!wholesaleStore.isWholesale && availableCheckoutLoyaltyCategories.length"
          class="loyalty-section"
        >
          <article class="loyalty-card loyalty-card--checkout" :class="{ 'loyalty-card--frozen': discountBlocked }">
            <div v-if="discountBlocked" class="loyalty-frozen-overlay loyalty-frozen-overlay--checkout" role="status">
              <div class="loyalty-frozen-icon loyalty-frozen-icon--checkout" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="9.2" />
                  <path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" />
                </svg>
              </div>
              <h3 class="loyalty-frozen-title">Скидки по бонусной карте заблокированы</h3>
              <p class="loyalty-frozen-date">до {{ discountBlockedUntilLabel }}</p>
              <p class="loyalty-frozen-note">Накопленные бонусы сохранятся</p>
            </div>

            <div class="loyalty-card-header">
              <h2 class="loyalty-card-title-main">Доступны скидки по бонусной карте</h2>
            </div>

            <div class="loyalty-available-list">
              <section
                v-for="choice in availableCheckoutLoyaltyChoices"
                :key="choice.key"
                class="loyalty-available-category"
              >
                <div class="loyalty-available-heading">
                  <div class="loyalty-available-copy">
                    <h3 class="loyalty-available-title">
                      {{ choice.label }}
                    </h3>
                    <p class="loyalty-available-discount">
                      Скидка на товар: {{ formatPrice(choice.category.discount_amount) }} BYN
                    </p>
                  </div>

                  <div class="loyalty-line-action">
                    <button
                      v-if="canToggleLoyaltyLine(choice.category, choice.line)"
                      type="button"
                      class="loyalty-line-button"
                      :class="{ 'loyalty-line-button--applied': isLoyaltyAppliedToLine(choice.line) }"
                      :aria-pressed="isLoyaltyAppliedToLine(choice.line)"
                      :disabled="loyaltyStore.loadingPreview || (discountBlocked && !isLoyaltyAppliedToLine(choice.line))"
                      @click="toggleLoyaltyLine(choice.category, choice.line)"
                    >
                      {{ isLoyaltyAppliedToLine(choice.line) ? "Применено" : "Применить" }}
                    </button>
                    <span v-else class="loyalty-line-state">
                      {{ loyaltyLineStateText(choice.category, choice.line) }}
                    </span>
                  </div>
                </div>
              </section>
            </div>

            <button
              type="button"
              class="loyalty-rules-link loyalty-rules-link--static"
              @click="showLoyaltyRulesModal = true"
            >
              <span>Как работают скидки за покупки</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M3 1.5L7.5 6L3 10.5"
                  stroke="white"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </article>
        </section>

        <div v-if="wholesaleStore.isWholesale" class="summary-row">
          <span class="summary-label">Минимум для опта</span>
          <span v-if="wholesaleMinimumQuantity">
            {{ wholesaleMinimumQuantity }} {{ pluralPositions(wholesaleMinimumQuantity) }}
          </span>
          <span v-else>{{ wholesaleStore.minOrderAmount.toFixed(0) }} BYN</span>
        </div>

        <div v-if="wholesaleStore.isWholesale && wholesaleRemaining > 0" class="summary-row">
          <span class="summary-label">Осталось добрать</span>
          <span v-if="wholesaleMinimumQuantity">
            {{ wholesaleRemaining }} {{ accusativePositions(wholesaleRemaining) }}
          </span>
          <span v-else>{{ wholesaleRemaining.toFixed(2) }} BYN</span>
        </div>

        <div v-if="!wholesaleStore.isWholesale && loyaltyDiscountAmount > 0" class="summary-row">
          <span class="summary-label">Скидка за покупки</span>
          <span class="summary-discount">-{{ formatPrice(loyaltyDiscountAmount) }} BYN</span>
        </div>

        <div
          v-if="shouldShowOpenInTelegramForWholesale"
          class="user-info-card user-info-card-warning"
        >
          <p class="user-info-label">Откройте в Telegram</p>
          <p class="username-warning-text">
            Оптовый заказ оформляется только в Telegram Mini App, чтобы использовать ваш профиль и @username.
          </p>
          <div class="username-warning-actions">
            <a
              v-if="wholesaleTelegramOpenUrl"
              :href="wholesaleTelegramOpenUrl"
              class="username-warning-primary"
              style="display: inline-block; text-align: center; text-decoration: none"
            >
              Открыть в Telegram
            </a>
            <p v-else class="username-warning-text" style="margin-top: 8px">
              Задайте TELEGRAM_BOT_USERNAME на сервере или откройте ту же ссылку из чата Telegram.
            </p>
          </div>
        </div>

        <!-- Вне Telegram Mini App даём ввести username вручную (розница) -->
        <div
          v-else-if="shouldShowManualUsernameInput"
          class="user-info-card"
        >
          <p class="user-info-label">Ваши данные</p>
          <div class="user-info-input-row">
            <input
              v-model.trim="form.telegramUsername"
              type="text"
              class="user-info-input"
              placeholder="@username"
              @input="errors.telegramUsername = ''"
            />
          </div>
          <p v-if="errors.telegramUsername" class="user-info-error">{{ errors.telegramUsername }}</p>
        </div>

        <div
          v-else-if="shouldShowUsernameWarning"
          class="user-info-card user-info-card-warning"
        >
          <p class="user-info-label">Нужен Telegram username</p>
          <p class="username-warning-text">
            Без username мы не сможем связаться с вами по заказу в Telegram.
          </p>
          <div class="username-warning-actions">
            <button
              type="button"
              class="username-warning-primary"
              @click="openUsernameRequiredModal"
            >
              Как поставить username
            </button>
          </div>
        </div>

        <div v-if="errors.phone" class="submit-error">{{ errors.phone }}</div>
        <div v-if="errors.address" class="submit-error">{{ errors.address }}</div>
      </div>
    </div>
    </main>

    <!-- Футер (демо .checkout-footer): обычный блок flex-колонки —
         НЕ fixed. main скроллится над ним, перекрытий нет. -->
    <div class="checkout-footer" v-if="cartStore.items.length">
      <div v-if="submitError" class="submit-error">{{ submitError }}</div>

      <template v-if="!isOrderConfirmation">
        <!-- Кнопка промокода — сразу над «Оформить заказ». -->
        <button
          v-if="!discountBlocked"
          type="button"
          class="promo-open-btn"
          data-test="promo-open-btn"
          @click="openPromoModal"
        >
          <span class="promo-open-btn__label">{{
            promoResult ? 'Промокод применён' : 'У меня есть промокод'
          }}</span>
        </button>
      </template>

      <button
        @click="beginCheckout"
        :disabled="isSubmitting || isConfirmingOrder || isCheckingCardPaymentStatus || checkoutCalculationPending || isWholesaleSubmitBlocked || shouldShowOpenInTelegramForWholesale"
        class="submit-button"
        type="button"
        style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
      >
        {{ submitButtonLabel }}
      </button>
    </div>

    <MinDeliveryBanner
      :isOpen="showMinDeliveryBanner"
      :minAmount="minDeliveryAmount"
      :currentAmount="cartStore.totalAmount"
      :bannerImage="settingsStore.settings.min_delivery_banner_image"
      :buttonText="settingsStore.settings.min_delivery_banner_button_text"
      :buttonColor="settingsStore.settings.min_delivery_banner_button_color"
      @close="showMinDeliveryBanner = false"
    />

    <DeliveryConditionsBanner
      :isOpen="showDeliveryConditionsBanner"
      :image="settingsStore.settings.delivery_conditions_image"
      @close="showDeliveryConditionsBanner = false"
    />

    <CardTariffSheet
      v-model="selectedCardTariff"
      :open="showCardTariffsModal"
      :tariffs="cardTariffs"
      :sending="cardRequestSending"
      :success="cardRequestSuccess"
      :success-text="cardRequestSuccessText"
      :error="cardRequestError"
      :request-blocked="Boolean(cardPaymentStatus?.request_cooldown_until)"
      :fallback-cooldown-days="cardPaymentStatus?.cooldown_days ?? 10"
      @close="closeCardTariffs"
      @submit="submitCardLimitRequest"
      @dismiss-success="closeCardTariffs"
    />

    <CustomerModalShell
      :open="showCardEditLimitModal"
      title="Лимит превышен"
      close-label="Закрыть окно"
      @close="closeCardEditLimitModal"
    >
      <div class="checkout-modal-copy">
        <div class="card-widget__state card-widget__state--blocked card-edit-limit-state" role="alert">
          <div class="card-widget__state-row">
            <span class="card-widget__state-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.9" />
                <path d="M12 7.4v5.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <circle cx="12" cy="16.6" r="1.25" fill="currentColor" />
              </svg>
            </span>
            <strong>{{ cardEditLimitMessage }}</strong>
          </div>
          <p class="card-widget__state-copy" v-if="cardEditLimitHint">
            {{ cardEditLimitHint }}
          </p>
        </div>
      </div>
      <template #footer>
        <div class="card-payment-modal-actions">
          <button
            v-if="isEditingOrder"
            type="button"
            class="checkout-modal-cta checkout-modal-cta--dark"
            @click="openCardTariffsFromEditLimit"
          >Увеличить лимиты</button>
          <button
            type="button"
            class="checkout-modal-cta"
            @click="closeCardEditLimitModal"
          >Понятно</button>
        </div>
      </template>
    </CustomerModalShell>

    <!-- Модалка промокода: ВСЕ действия и вся информация здесь —
         ввод, применённый код, описание скидки/подарка, снятие. -->
    <CustomerModalShell
      :open="showPromoModal"
      :title="promoResult ? 'Ваш промокод' : 'Ввести промокод'"
      close-label="Закрыть окно"
      @close="closePromoModal"
    >
      <div class="checkout-modal-copy">
        <!-- Применённый промокод: код с галочкой, описание и снятие. -->
        <template v-if="promoResult">
          <div class="promo-applied-row promo-applied-row--modal">
            <div class="promo-applied-info">
              <span class="promo-input-label">Промокод</span>
              <div class="promo-code-display">
                <span class="promo-code-text">{{ promoCode.toUpperCase() }}</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7L5.5 10.5L12 3.5" stroke="#34c759" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </div>
          </div>
          <p class="promo-discount-text">
            <template v-if="wholesaleStore.isWholesale">
              Подарок будет добавлен к заказу
              <template v-if="promoResult.customer_description || promoResult.description">
                · {{ promoResult.customer_description || promoResult.description }}
              </template>
            </template>
            <template v-else>
              Скидка: -{{ formatPrice(promoResult.calculated_discount) }} BYN
              <template v-if="promoResult.customer_description || promoResult.description">
                · {{ promoResult.customer_description || promoResult.description }}
              </template>
            </template>
          </p>
          <button
            type="button"
            class="promo-remove-btn"
            data-test="promo-modal-remove"
            :disabled="promoValidating"
            @click="handlePromoClear"
          >
            Убрать промокод
          </button>
        </template>

        <!-- Ввод нового промокода. -->
        <template v-else>
          <div class="promo-modal-input-row">
            <input
              ref="promoInputRef"
              id="checkout-promo-code"
              v-model="promoCode"
              type="text"
              class="promo-input"
              placeholder="Введите промокод"
              enterkeyhint="done"
              :disabled="promoValidating"
              :aria-describedby="promoError ? 'checkout-promo-error' : undefined"
              data-test="promo-modal-input"
              @keydown.enter="handlePromoApply"
              @input="promoError = ''"
            />
            <button
              class="promo-apply-btn"
              :disabled="!promoCode.trim() || promoValidating"
              data-test="promo-modal-apply"
              @click="handlePromoApply"
            >
              {{ promoValidating ? '...' : 'Применить' }}
            </button>
          </div>
          <p
            v-if="promoError"
            id="checkout-promo-error"
            class="promo-error-text"
            role="alert"
          >
            {{ promoError }}
          </p>
        </template>

        <!-- Предупреждение в оформлении CompatibilityNotice (каталог
             расходников): красный градиентный квадрат с треугольником,
             белый фон карточки, cqw-пропорции. -->
        <div class="promo-warning" role="alert">
          <div class="promo-warning__card">
            <div class="promo-warning__icon" aria-hidden="true">
              <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M60 15Q64 8 68 15L118 104Q122 112 113 112H15Q6 112 10 104Z"
                  stroke="white" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M64 48V76" stroke="white" stroke-width="9" stroke-linecap="round" />
                <circle cx="64" cy="93" r="5" fill="white" />
              </svg>
            </div>
            <div class="promo-warning__content">
              <h3 class="promo-warning__title">Внимание</h3>
              <p class="promo-warning__text">За неправильное использование промокода Вы можете получить блокировку скидочной системы</p>
            </div>
          </div>
        </div>
      </div>
    </CustomerModalShell>

    <CustomerModalShell
      :open="isUsernameModalOpen"
      title="Нужен Telegram username"
      close-label="Закрыть окно"
      @close="closeUsernameRequiredModal"
    >
      <div class="checkout-modal-copy">
        <p>Без username оформление заказа недоступно.</p>
        <ol class="checkout-modal-list">
          <li>Зайдите в настройки профиля Telegram.</li>
          <li>Найдите поле «@Имя Пользователя» и установите его.</li>
          <li>Вернитесь сюда и нажмите «Закрыть и перезайти».</li>
        </ol>
      </div>
      <template #footer>
        <button
          type="button"
          class="checkout-modal-cta"
          @click="closeMiniApp"
        >
          Закрыть и перезайти
        </button>
      </template>
    </CustomerModalShell>

    <CustomerModalShell
      :open="Boolean(activeAgreement)"
      :title="activeAgreement?.modal_title?.trim() || activeAgreement?.title || ''"
      close-label="Закрыть окно"
      @close="activeAgreement = null"
    >
      <div class="checkout-agreement-modal-body">
        <p v-for="(paragraph, index) in agreementModalParagraphs" :key="index" class="checkout-agreement-modal-paragraph">
          {{ paragraph }}
        </p>
        <p v-if="!agreementModalParagraphs.length" class="checkout-agreement-modal-empty">
          Текст соглашения ещё не заполнен. Уточните у продавца.
        </p>
      </div>
    </CustomerModalShell>

    <CustomerModalShell
      :open="showLoyaltyRulesModal"
      :title="LOYALTY_RULES_MODAL_TITLE"
      close-label="Закрыть окно"
      @close="showLoyaltyRulesModal = false"
    >
      <div class="checkout-modal-copy">
        <p v-for="paragraph in LOYALTY_RULES_MODAL_PARAGRAPHS" :key="paragraph">
          {{ paragraph }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="checkout-modal-cta"
          @click="showLoyaltyRulesModal = false"
        >
          Понятно
        </button>
      </template>
    </CustomerModalShell>

    <LoyaltyBonusPopup
      v-if="!wholesaleStore.isWholesale"
      :open="showLoyaltyPopup"
      :categories="loyaltyStore.availableCategories"
      @close="showLoyaltyPopup = false"
      @open-profile="openProfileFromLoyaltyPopup"
    />

    <ToastNotification
      v-if="toastMessage"
      :key="toastKey"
      :message="toastMessage"
      :type="toastType"
      :duration="toastDuration"
      @close="toastMessage = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore } from "@/stores/catalog";
import {
  useLoyaltyStore,
  type LoyaltyPreviewCategory,
  type LoyaltyPreviewLineItem,
} from "@/stores/loyalty";
import { useSettingsStore } from "@/stores/settings";
import { useWholesaleStore } from "@/stores/wholesale";
import { useCustomerBlock } from "@/composables/useCustomerBlock";
import MinDeliveryBanner from "@/components/MinDeliveryBanner.vue";
import DeliveryConditionsBanner from "@/components/DeliveryConditionsBanner.vue";
import CustomerModalShell from "@/components/CustomerModalShell.vue";
import CardTariffSheet, { type CardTariffPlan } from "@/components/CardTariffSheet.vue";
import LoyaltyBonusPopup from "@/components/LoyaltyBonusPopup.vue";
import {
  LOYALTY_RULES_MODAL_PARAGRAPHS,
  LOYALTY_RULES_MODAL_TITLE,
} from "@/constants/loyalty";
import LottiePlayer from "@/components/LottiePlayer.vue";
import ToastNotification from "@/components/ToastNotification.vue";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";
import { withTelegramAuthHeaders } from "@/utils/telegramAuth";
import {
  buildTelegramMiniAppOpenUrl,
  hasTelegramMiniAppUserContext,
  wholesalePairToStartParam,
} from "@/utils/telegramMiniAppContext";

interface TelegramMiniAppUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code: string;
  is_premium?: boolean;
}

const router = useRouter();
const cartStore = useCartStore();
const settingsStore = useSettingsStore();
const catalogStore = useCatalogStore();
const loyaltyStore = useLoyaltyStore();
const wholesaleStore = useWholesaleStore();
const { applyBlockFromResponse } = useCustomerBlock();
const LOYALTY_CATEGORY_ORDER = ["liquids", "disposables", "devices"];
const LOYALTY_CATEGORY_LABELS: Record<string, string> = {
  liquids: "Жидкости",
  disposables: "Одноразки",
  devices: "Устройства",
};

interface CheckoutLoyaltyChoice {
  key: string;
  label: string;
  category: LoyaltyPreviewCategory;
  line: LoyaltyPreviewLineItem;
}

const isItemsExpanded = ref(false);

/* ===== Высота страницы: явно из DOM =====
   Telegram WebView врёт и в 100vh, и в 100dvh (панель Telegram
   сверху/снизу): футер «не доходил» до низа экрана на 15-20%.
   Берём фактическую видимую высоту контейнера, который отвёл
   app-shell (окно минус верхняя панель), и применяем как
   min-height flex-колонки: футер прижимается к низу точно.
   Пересчёт на resize (поворот/панель Telegram). */
const pageEl = ref<HTMLElement | null>(null);
const pageMinHeight = ref<number | null>(null);

function syncPageMinHeight() {
  if (!pageEl.value) return;
  // Родитель app-shell__content занимает остаток экрана ниже
  // topbar-sizer'а: его видимая высота и есть доступное место.
  const host = pageEl.value.parentElement;
  if (!host) return;
  const viewport = window.innerHeight;
  const hostRect = host.getBoundingClientRect();
  // Если хост уже вытянут (длинный контент) — ограничение не нужно.
  if (hostRect.height >= viewport) {
    pageMinHeight.value = null;
    return;
  }
  // Доступно: от верха хоста до низа окна (topbar уже учтён позицией).
  const available = Math.round(viewport - hostRect.top);
  pageMinHeight.value = Math.max(available, 0);
}

onMounted(() => {
  syncPageMinHeight();
  window.addEventListener("resize", syncPageMinHeight);
  // Плашка ошибки карты в fixed-координатах — держим её у кнопки
  // при скролле и изменении окна.
  window.addEventListener("resize", handlePopoverReposition);
  window.addEventListener("scroll", handlePopoverReposition, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncPageMinHeight);
  window.removeEventListener("resize", handlePopoverReposition);
  window.removeEventListener("scroll", handlePopoverReposition);
});
const promoCode = ref("");
const promoValidating = ref(false);
const promoResult = ref<{
  discount_type: 'fixed' | 'percent';
  discount_value: number;
  calculated_discount: number;
  has_gift: number;
  customer_description?: string;
  description?: string;
} | null>(null);
const promoError = ref("");
const promoInputRef = ref<HTMLInputElement | null>(null);
/** Модалка ввода промокода (кнопка «Ввести промокод» на карточке). */
const showPromoModal = ref(false);

function openPromoModal() {
  if (discountBlocked.value) return;
  promoError.value = '';
  showPromoModal.value = true;
  // Фокус в поле ввода — только когда модалка открыта для ввода
  // (не для просмотра применённого кода).
  if (!promoResult.value) {
    nextTick(() => {
      promoInputRef.value?.focus();
    });
  }
}

function closePromoModal() {
  if (promoValidating.value) return;
  showPromoModal.value = false;
  promoError.value = '';
}
const telegramUser = ref<TelegramMiniAppUser | null>(null);
/** Окно «Нужен Telegram username» открывается только явными обработчиками
 *  (кнопка «Как поставить username» или попытка оформить заказ). При входе
 *  в корзину оно не показывается: данные Telegram ещё досинхронизируются,
 *  и окно успевало мигнуть на долю секунды. */
const showUsernameRequiredModal = ref(false);
// Окно «Лимит превышен» при изменении карточного заказа: сервер отклонил
// изменение, потому что новая сумма не проходит по лимиту.
const showCardEditLimitModal = ref(false);
const cardEditLimitMessage = ref("");
const cardEditLimitHint = ref("");
const telegramUsernameVerified = ref(false);
const detectedTelegramUsername = ref("");
const verifiedTelegramUsername = ref("");

const form = reactive({
  deliveryType: "pickup" as "pickup" | "delivery",
  telegramUsername: "",
  phone: "",
  address: "",
  notes: "",
});

const errors = reactive({
  telegramUsername: "",
  phone: "",
  address: "",
});

const isSubmitting = ref(false);
/** Финальное подтверждение заказа уже обрабатывается (сверка карты + отправка). */
const isConfirmingOrder = ref(false);
const submitError = ref("");

// Соглашения перед заказом. Активные id подставляются автоматически
// при финальном подтверждении; клиент больше не видит отдельные чекбоксы.
const acceptedAgreementIds = ref<number[]>([]);
const missingAgreementIds = ref<number[]>([]);
const loadedAgreements = ref<Array<{ id: number; title: string; modal_title?: string; body: string }>>([]);
const isOrderConfirmation = ref(false);
const confirmationPaymentMethod = ref<"cash" | "card">("cash");
const confirmationText = computed(() =>
  settingsStore.settings.order_agreement_main_text?.trim() ||
  settingsStore.settings.order_confirmation_text?.trim() ||
  "Нажав кнопку «Оформить заказ», вы автоматически соглашаетесь с условиями оформления заказа.",
);
const confirmationSmallText = computed(() =>
  settingsStore.settings.order_agreement_small_text?.trim() || "Проверьте состав заказа перед отправкой.",
);

const toastMessage = ref("");
const toastType = ref<"info" | "success" | "error">("info");
const toastDuration = ref(3500);
const toastKey = ref(0);

function showToast(message: string, type: "info" | "success" | "error" = "info") {
  toastMessage.value = message;
  toastType.value = type;
  toastKey.value += 1;
}

async function fetchCheckoutAgreements() {
  try {
    const response = await fetch("/api/agreements", { credentials: "include" });
    if (!response.ok) return;
    const data = (await response.json()) as { items?: Array<{ id: number; title: string; modal_title?: string; body: string }> };
    loadedAgreements.value = Array.isArray(data.items) ? data.items : [];
  } catch {
    loadedAgreements.value = [];
  }
}

onMounted(() => {
  void fetchCheckoutAgreements();
});

function computeLocalMissingAgreementIds(): number[] {
  if (!loadedAgreements.value.length) return [];
  const accepted = new Set(acceptedAgreementIds.value);
  return loadedAgreements.value
    .map((a) => a.id)
    .filter((id) => !accepted.has(id));
}
const stockLimits = ref<Map<string, number>>(new Map());
const stockLoading = ref(false);
const showMinDeliveryBanner = ref(false);
const showDeliveryConditionsBanner = ref(false);
const deliveryConditionsShown = ref(false);
const editingOrderDetails = ref<CustomerActiveOrder | null>(null);
const showLoyaltyRulesModal = ref(false);
const showLoyaltyPopup = ref(false);
const selectedPaymentMethod = ref<"cash" | "card">("cash");

/** Кэш статуса оплаты картой между заходами в корзину.
 *  Без него блок «Способ оплаты» появлялся последним: он виден только когда
 *  пришёл сетевой ответ, а запрос стартует уже после монтирования экрана.
 *  Кэш даёт мгновенный первый кадр, а свежий ответ затем его уточняет. */
const CARD_STATUS_CACHE_KEY = "navalivay_card_status_cache";
const CARD_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;

function readCachedCardStatus(): any | null {
  try {
    const raw = localStorage.getItem(CARD_STATUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; status?: any };
    if (!parsed?.status || !parsed?.at) return null;
    if (Date.now() - Number(parsed.at) > CARD_STATUS_CACHE_TTL_MS) return null;
    return parsed.status;
  } catch {
    return null;
  }
}

function writeCachedCardStatus(status: any) {
  try {
    localStorage.setItem(CARD_STATUS_CACHE_KEY, JSON.stringify({ at: Date.now(), status }));
  } catch {
    /* приватный режим или квота — кэш просто не сохранится */
  }
}

const cardPaymentStatus = ref<any>(readCachedCardStatus());
const isCheckingCardPaymentStatus = ref(false);
const canChooseCheckoutPayment = computed(
  () => !isEditingOrder.value && cardPaymentStatus.value?.enabled === true,
);
const effectivePaymentMethod = computed<"cash" | "card">(() =>
  canChooseCheckoutPayment.value && selectedPaymentMethod.value === "card" ? "card" : "cash",
);
const remainingDailyCardLimitMinor = computed(() => {
  const limits = cardPaymentStatus.value?.limits;
  if (!limits) return 0;
  return Math.max(
    0,
    Number(limits.daily_limit_minor || 0)
      - Number(limits.spent_today_minor || 0)
      - Number(limits.reserved_minor || 0),
  );
});
const isSharedCardLimitExhausted = computed(
  () => Boolean(cardPaymentStatus.value?.limits)
    && remainingDailyCardLimitMinor.value <= 0,
);
// Общий дневной лимит — жёсткий потолок: если корзина дороже остатка дня,
// картой этот заказ оплатить нельзя (сервер тоже отклонит).
const cardOrderTotalMinor = computed(() => {
  const amount = Number(cartStore.totalAmount || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
});
const cardOrderExceedsDailyMinor = computed(() => {
  if (!cardPaymentStatus.value?.limits) return false;
  const remaining = remainingDailyCardLimitMinor.value;
  return remaining > 0 && cardOrderTotalMinor.value > remaining;
});
// Личный лимит на заказ — главный ориентир для клиента: картой можно
// оплатить заказ, который целиком в него помещается. Смешанной оплаты
// (часть картой, часть наличными) больше нет.
const cardPersonalLimitMinor = computed(
  () => Math.max(0, Number(cardPaymentStatus.value?.max_order_minor || 0)),
);
const cardOrderExceedsPersonalLimitMinor = computed(() =>
  Math.max(0, cardOrderTotalMinor.value - cardPersonalLimitMinor.value),
);
// Пауза активна прямо сейчас: карту можно выбрать и посмотреть виджет,
// но «Оформить заказ» картой заблокирован.
const isCardPaused = computed(
  () => Boolean(cardPaymentStatus.value?.enabled)
    && Boolean(cardPaymentStatus.value?.cooldown_until)
    && new Date(cardPaymentStatus.value.cooldown_until).getTime() > Date.now(),
);
// Кнопка «Оформить заказ» неактивна, пока карта на паузе, дневной лимит
// магазина исчерпан или заказ больше личного лимита.
const isCardBlockedForOrder = computed(
  () => isCardPaused.value
    || isSharedCardLimitExhausted.value
    || cardOrderExceedsDailyMinor.value
    || cardOrderExceedsPersonalLimitMinor.value > 0,
);
// Общий дневной лимит магазина достигнут «в ноль» (исчерпан), но заказ
// меньше остатка — этого не бывает при exhausted; отдельный кейс для
// интерфейса, когда лимит потрачен полностью.
const isCardDailyLimitReached = computed(() =>
  Boolean(cardPaymentStatus.value?.limits)
    && remainingDailyCardLimitMinor.value <= 0,
);

function formatCardPauseDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-BY", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Minsk",
  }).format(date);
}

/** Точное сообщение при клике на заблокированную карту. */
const cardBlockToast = computed(() => {
  if (isCardPaused.value) {
    const until = formatCardPauseDate(cardPaymentStatus.value?.cooldown_until);
    return until
      ? `Оплата картой на паузе до ${until}. Выберите наличные.`
      : "Оплата картой на паузе. Выберите наличные.";
  }
  if (cardOrderExceedsPersonalLimitMinor.value > 0) {
    return `Ваш лимит на заказ — ${formatCardMoney(cardPersonalLimitMinor.value)} BYN, заказ — ${formatPrice(finalTotal.value)} BYN. Уберите товары или оплатите наличными.`;
  }
  if (isSharedCardLimitExhausted.value) {
    return "Дневной лимит оплаты картой в магазине исчерпан. Оплатите наличными.";
  }
  if (cardOrderExceedsDailyMinor.value) {
    return `Заказ больше дневного остатка (${formatCardMoney(remainingDailyCardLimitMinor.value)} BYN). Оплатите наличными или уменьшите корзину.`;
  }
  return "Оплата картой сейчас недоступна. Выберите наличные.";
});

/**
 * Плашка ошибки карты над кнопкой «Картой»
 * (демо-образец navalivay-card-limit-popover: тёмная капсула со стрелкой
 * к кнопке и кольцом-таймером у кнопки закрытия).
 */
const cardErrorText = ref("");

/** Обёртка кнопки «Картой»: плашка позиционируется от её границ.
 *  Плашка отрисована через Teleport в body (карточка заказа режет
 *  контент overflow:hidden), поэтому координаты считаем в viewport. */
const cardChoiceWrapRef = ref<HTMLElement | null>(null);
const cardPopoverStyle = ref<Record<string, string> | null>(null);

const POPOVER_WIDTH_PX = 272;

/** Считает позицию плашки под кнопкой «Картой»: капсула центрируется
 *  под кнопкой, стрелка — ровно под её центром; у краёв экрана плашка
 *  прижимается внутрь, а стрелка сдвигается вместе с центром кнопки. */
function syncCardPopoverPosition() {
  const anchor = cardChoiceWrapRef.value;
  if (!anchor || !cardErrorText.value) {
    cardPopoverStyle.value = null;
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const width = Math.min(POPOVER_WIDTH_PX, viewportWidth - 16);
  const buttonCenter = Math.round(rect.left + rect.width / 2);
  // Центр кнопки — центр плашки, но не дальше краёв экрана.
  const centeredLeft = Math.round(buttonCenter - width / 2);
  const left = Math.min(
    Math.max(8, centeredLeft),
    Math.max(8, viewportWidth - width - 8),
  );
  // Стрелка указывает на центр кнопки: расстояние от правого края плашки
  // до центра кнопки (стрелка 10px, минус полширины для центра).
  const arrowFromRight = Math.max(
    8,
    Math.round(left + width - buttonCenter - 5),
  );
  cardPopoverStyle.value = {
    position: "fixed",
    left: `${left}px`,
    top: `${Math.round(rect.bottom - 12)}px`,
    width: `${width}px`,
    "--popover-arrow-from-right": `${arrowFromRight}px`,
  };
}

/** Заголовок плашки — короткая суть проблемы (цифры в тексте ниже). */
const cardErrorTitle = computed(() => {
  if (isCardPaused.value) return "Оплата картой на паузе";
  if (cardOrderExceedsPersonalLimitMinor.value > 0) {
    return `Лимит оплаты картой — ${formatCardMoney(cardPersonalLimitMinor.value)} BYN`;
  }
  if (isSharedCardLimitExhausted.value || cardOrderExceedsDailyMinor.value) {
    return "Дневной лимит карты исчерпан";
  }
  return "Оплата картой недоступна";
});

/** Автоскрытие плашки: кольцо вокруг кнопки закрытия дотает,
 *  и плашка гаснет сама. */
const CARD_ERROR_RESET_MS = 7000;
let cardErrorTimer: number | null = null;

function showCardError(message: string) {
  if (!message) return;
  cardErrorText.value = message;
  nextTick(() => syncCardPopoverPosition());
  if (cardErrorTimer !== null) window.clearTimeout(cardErrorTimer);
  cardErrorTimer = window.setTimeout(() => {
    cardErrorTimer = null;
    cardErrorText.value = "";
    cardPopoverStyle.value = null;
  }, CARD_ERROR_RESET_MS);
}

/** Плашка живёт в fixed-координатах: при скролле/повороте экрана
 *  пересчитываем позицию, чтобы она не отставала от кнопки. */
function handlePopoverReposition() {
  if (cardErrorText.value) syncCardPopoverPosition();
}

function clearCardError() {
  cardErrorText.value = "";
  cardPopoverStyle.value = null;
  if (cardErrorTimer !== null) {
    window.clearTimeout(cardErrorTimer);
    cardErrorTimer = null;
  }
}
const showCardTariffsModal = ref(false);
const cardTariffs = ref<CardTariffPlan[]>([]);
const selectedCardTariff = ref("");
const cardRequestSending = ref(false);
const cardRequestSuccess = ref(false);
const cardRequestError = ref("");

const cardRequestSuccessText = computed(() => {
  const tariff = cardTariffs.value.find((t) => t.id === selectedCardTariff.value);
  if (!tariff) return "Заявка отправлена. Продавец свяжется с вами для подтверждения.";
  const limit = formatCardMoney(tariff.per_order_limit_minor ?? tariff.limit_minor);
  return `Тариф «${tariff.title}»: лимит заказа до ${limit} BYN. Продавец рассмотрит заявку и свяжется с вами.`;
});

const orderedCheckoutLoyaltyCategories = computed(() => {
  return [...loyaltyStore.previewCategories].sort((left, right) => {
    const leftIndex = LOYALTY_CATEGORY_ORDER.indexOf(left.category_key);
    const rightIndex = LOYALTY_CATEGORY_ORDER.indexOf(right.category_key);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }

    return left.title.localeCompare(right.title, "ru");
  });
});

const availableCheckoutLoyaltyCategories = computed(() => {
  if (promoResult.value) return [];

  return orderedCheckoutLoyaltyCategories.value.filter((category) => {
    const hasAvailableBonus =
      Number(category.current_available_bonus_count || 0) > 0 ||
      Number(category.loyalty_units_applied || 0) > 0;
    return hasAvailableBonus && availableLoyaltyLines(category).length > 0;
  });
});

const availableCheckoutLoyaltyChoices = computed<CheckoutLoyaltyChoice[]>(() =>
  availableCheckoutLoyaltyCategories.value.flatMap((category) =>
    buildCheckoutLoyaltyChoices(category),
  ),
);

const isEditingOrder = computed(() => Boolean(cartStore.editingOrderId));
const checkoutCalculationPending = computed(
  () => promoValidating.value || loyaltyStore.loadingPreview,
);
// Заморозка скидочной системы: промокоды и новые бонусы недоступны
const discountBlocked = computed(() => loyaltyStore.isDiscountBlocked);
const discountBlockedUntilLabel = computed(() => {
  const until = loyaltyStore.discountBlock?.until;
  if (!until) return "разморозки";
  const normalized = until.includes("T") ? until : until.replace(" ", "T") + "Z";
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return until;
  const minsk = new Date(parsed.getTime() + 3 * 60 * 60 * 1000);
  const day = String(minsk.getUTCDate()).padStart(2, "0");
  const month = String(minsk.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${minsk.getUTCFullYear()}`;
});
const checkoutTitle = computed(() =>
  isEditingOrder.value ? "Изменение заказа" : "Оформление заказа",
);
const submitButtonLabel = computed(() => {
  if (isSubmitting.value) {
    return isEditingOrder.value ? "Сохраняем..." : "Оформляем...";
  }
  if (checkoutCalculationPending.value) {
    return "Рассчитываем скидку...";
  }
  if (isWholesaleSubmitBlocked.value) {
    return wholesaleMinimumQuantity.value
      ? `Доберите еще ${wholesaleRemaining.value} ${accusativePositions(wholesaleRemaining.value)}`
      : `Доберите еще ${wholesaleRemaining.value.toFixed(2)} BYN`;
  }
  return isEditingOrder.value ? "Сохранить изменения" :
    isOrderConfirmation.value ? "Принимаю условия, отправить заказ" : "Оформить заказ";
});

const minDeliveryAmount = computed(() => {
  const val = parseFloat(settingsStore.settings.min_delivery_amount || "0");
  return isNaN(val) ? 0 : val;
});

const canUseDelivery = computed(() => {
  return (
    minDeliveryAmount.value <= 0 ||
    cartStore.totalAmount >= minDeliveryAmount.value
  );
});

/** Подписанный initData и id пользователя (не заглушка из внешнего браузера). */
const hasTelegramUserAuth = computed(() => hasTelegramMiniAppUserContext());

const requiresTelegramUsername = computed(() => {
  return hasTelegramUserAuth.value && !verifiedTelegramUsername.value;
});

/** Пока идёт первичная синхронизация данных Telegram, предупреждение
 *  «Нужен Telegram username» не показываем: username ещё не проверен,
 *  и блок успевал мигнуть на долю секунды при входе в корзину. */
const telegramSyncSettled = ref(false);

/** Предупреждение в карточке заказа: только после синхронизации Telegram. */
const shouldShowUsernameWarning = computed(
  () => telegramSyncSettled.value && requiresTelegramUsername.value,
);

/** Окно с инструкцией: пока данные Telegram не досинхронизированы, оно не
 *  открывается ни при каких условиях — иначе успевало мигнуть на входе. */
const isUsernameModalOpen = computed(
  () => telegramSyncSettled.value && showUsernameRequiredModal.value,
);

const shouldShowOpenInTelegramForWholesale = computed(() => {
  return wholesaleStore.isWholesale && !hasTelegramUserAuth.value;
});

const wholesaleTelegramOpenUrl = computed(() => {
  const bot = (settingsStore.settings.telegram_bot_username || "")
    .replace(/^@/, "")
    .trim();
  if (!bot || !wholesaleStore.isWholesale) {
    return "";
  }
  const code = wholesaleStore.wholesaleCode;
  const secret = wholesaleStore.wholesaleSecret;
  if (!code || !secret) {
    return "";
  }
  const sp = wholesalePairToStartParam(code, secret);
  if (!sp) {
    return "";
  }
  const short = (settingsStore.settings.telegram_mini_app_short_name || "").trim();
  return buildTelegramMiniAppOpenUrl(bot, sp, { miniAppShortName: short || null }) || "";
});

const shouldShowManualUsernameInput = computed(() => {
  return !wholesaleStore.isWholesale && !hasTelegramUserAuth.value;
});

/** Компактный список (демо): первая строка всегда видна,
 *  остальные — под сворачивающимся «Ещё N товаров».
 *  collapsedItems НЕ зависит от isItemsExpanded: хвост всегда
 *  есть в DOM (кнопка сворачивания не должна исчезать),
 *  видимость управляется классом cart-more--open. */
/** Незабранный прошлый заказ: показывается над итого строкой
 *  «Заказ который не забрали {дата} … {сумма}». Пока каркас:
 *  источник данных подключим к API истории заказов. */
const unclaimedOrder = computed<{ date: string; amount: string } | null>(() => {
  // TODO(backend): получать из fetchMyActiveOrder/history статус
  // не забранного заказа. Демо-значение для визуальной проверки:
  return { date: "04.11.2026", amount: "5" };
});

/** Открывает текст соглашения «заберу сегодня» в собственной
 * штатной модалке checkout, используя тот же ответ /api/agreements. */
const activeAgreement = ref<{ title: string; modal_title?: string; body: string } | null>(null);
const agreementModalParagraphs = computed(() =>
  (activeAgreement.value?.body || "").trim().split(/\n{2,}/).map((part) => part.trim()).filter(Boolean),
);

async function openUnclaimedAgreement() {
  if (!loadedAgreements.value.length) await fetchCheckoutAgreements();
  const needle = "заберу сегодня";
  activeAgreement.value = loadedAgreements.value.find((item) =>
    `${item.title} ${item.modal_title || ""} ${item.body}`.toLocaleLowerCase("ru-RU").includes(needle),
  ) || null;
  if (!activeAgreement.value) showToast("Соглашение «заберу сегодня» не найдено", "error");
}
const visibleItems = computed(() => {
  return cartStore.items.slice(0, 1);
});

const collapsedItems = computed(() => {
  return cartStore.items.slice(1);
});

/** Переключение «Ещё N товаров».
 *
 * Закрытие с большим списком «дёргало» экран: grid-анимация
 * сжимает страницу на сотни пикселей за 0.3 с, а скролл окна
 * оставался на месте — вьюпорт прыгал. Теперь при закрытии
 * доводим окно скроллом к кнопке тем же плавным темпом: viewport
 * едет вместе с сжимающейся страницей, рывка нет. */
const COLLAPSE_MS = 340;

function toggleMoreItems() {
  const wasExpanded = isItemsExpanded.value;
  isItemsExpanded.value = !isItemsExpanded.value;

  if (!wasExpanded) return; // дёргаем только при закрытии

  const list = document.querySelector(".cart-more-list");
  if (!list) return;
  const startY = window.scrollY;
  const targetY = Math.max(
    0,
    startY + list.getBoundingClientRect().top - window.innerHeight / 3,
  );
  if (Math.abs(targetY - startY) < 4) return;

  const startTime = performance.now();
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / COLLAPSE_MS);
    window.scrollTo(0, startY + (targetY - startY) * easeOut(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}



/**
 * Цены до скидки берём из каталога, а не из самой корзины. Корзина лежит в
 * localStorage неделями: сохрани мы старую цену туда, и после окончания акции
 * зачёркнутая цена висела бы вечно.
 */
const oldPriceMap = computed(() => {
  const map = new Map<string, number>();
  for (const product of catalogStore.allProducts) {
    if (product.hasDiscount && product.oldPriceRub) {
      map.set(`${product.id}::`, product.oldPriceRub);
    }
    for (const variant of product.variants || []) {
      if (variant.hasDiscount && variant.oldPriceRub) {
        map.set(`${product.id}::${variant.id}`, variant.oldPriceRub);
      }
    }
  }
  return map;
});

/** Старая цена всей позиции: в строке показан её итог, а не цена за штуку. */
function getItemOldTotal(item: (typeof cartStore.items)[0]): number | null {
  const oldPrice = oldPriceMap.value.get(`${item.productId}::${item.variantId ?? ""}`);
  if (!oldPrice || oldPrice <= item.priceRub) return null;
  return oldPrice * item.quantity;
}

function isIceProduct(item: (typeof cartStore.items)[0]): boolean {
  const title = (item.title || "").toLowerCase();
  const variant = (item.variantName || "").toLowerCase();
  return title.includes("ice") || variant.includes("ice");
}

const finalTotal = computed(() => {
  const base = cartStore.totalAmount;
  if (wholesaleStore.isWholesale) {
    return base;
  }
  if (loyaltyDiscountAmount.value > 0) {
    return Math.max(base - loyaltyDiscountAmount.value, 0);
  }
  if (promoResult.value) {
    return Math.max(base - promoResult.value.calculated_discount, 0);
  }
  return base;
});

const loyaltyDiscountAmount = computed(() =>
  wholesaleStore.isWholesale
    ? 0
    : (promoResult.value ? 0 : Number(loyaltyStore.totalLoyaltyDiscount || 0)),
);

const wholesaleMinimumQuantity = computed(() =>
  wholesaleStore.isWholesale ? wholesaleStore.effectiveMinQuantity : null,
);
const wholesaleRemaining = computed(() =>
  wholesaleStore.remainingToMinimum(cartStore.countableWholesaleUnits, cartStore.totalAmount),
);
const isWholesaleMinimumReached = computed(() =>
  wholesaleStore.meetsMinimum(cartStore.countableWholesaleUnits, cartStore.totalAmount),
);
const isWholesaleSubmitBlocked = computed(() =>
  wholesaleStore.isWholesale && cartStore.items.length > 0 && !isWholesaleMinimumReached.value,
);

function pluralPositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "позиции";
  return "позиций";
}

// «Не хватает N …» — родительный падеж.
function genitivePositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиции";
  return "позиций";
}

// «Доберите еще N …» — винительный падеж.
function accusativePositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позицию";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "позиции";
  return "позиций";
}

function checkoutLoyaltyCategoryLabel(category: LoyaltyPreviewCategory) {
  return LOYALTY_CATEGORY_LABELS[category.category_key] || category.title;
}

function handlePromoInputDone() {
  promoInputRef.value?.blur();
}

async function handlePromoApply() {
  const code = promoCode.value.trim();
  if (!code || promoValidating.value) return;
  if (discountBlocked.value) {
    // Промокоды недоступны при заморозке — сервер тоже откажет,
    // но здесь быстрее и без запроса.
    promoError.value = `Скидки и ввод промокодов недоступны до ${discountBlockedUntilLabel.value}`;
    return;
  }

  promoInputRef.value?.blur();
  promoError.value = '';
  promoResult.value = null;
  promoValidating.value = true;

  try {
    const response = await fetch('/api/promo/validate', {
      method: 'POST',
      headers: withTelegramAuthHeaders({
        'Content-Type': 'application/json',
        ...wholesaleStore.buildHeaders(),
      }),
      body: JSON.stringify({
        code,
        order_amount: cartStore.totalAmount,
        editing_order_id: isEditingOrder.value ? cartStore.editingOrderId : undefined,
      }),
    });

    const data = await response.json();

    if (data.valid) {
      cartStore.clearLoyaltySelections();
      promoResult.value = {
        discount_type: data.discount_type,
        discount_value: data.discount_value,
        calculated_discount: data.calculated_discount,
        has_gift: Number(data.has_gift || 0),
        customer_description: data.customer_description,
        description: data.description,
      };
      if (isEditingOrder.value) {
        cartStore.setEditingPromoCode(code);
      }
      // Модалку НЕ закрываем: применённый код, описание и кнопка
      // «Убрать» показываются здесь же — клиент видит результат.
    } else {
      promoError.value = data.message || 'Недействительный промокод';
    }
  } catch {
    promoError.value = 'Не удалось проверить промокод';
  } finally {
    promoValidating.value = false;
    await refreshLoyaltyPreview();
  }
}

function handlePromoClear() {
  promoCode.value = '';
  promoResult.value = null;
  promoError.value = '';
  if (isEditingOrder.value) {
    cartStore.setEditingPromoCode('');
  }
  void refreshLoyaltyPreview();
}

function buildLoyaltyIdentity() {
  const user = telegramUser.value;
  return {
    telegram_id: user?.id ? String(user.id) : undefined,
    telegram_username: normalizeTelegramUsername(
      verifiedTelegramUsername.value || detectedTelegramUsername.value || form.telegramUsername,
    ) || undefined,
  };
}

async function refreshLoyaltyPreview() {
  if (wholesaleStore.isWholesale) {
    loyaltyStore.resetPreview();
    return;
  }

  if (!cartStore.items.length) {
    loyaltyStore.resetPreview();
    return;
  }

  try {
    await loyaltyStore.fetchCheckoutPreview({
      ...buildLoyaltyIdentity(),
      promo_code: promoResult.value ? promoCode.value.trim() : undefined,
      editing_order_id: cartStore.editingOrderId || undefined,
      items: cartStore.items.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId || null,
        product_title: item.productTitle || item.title,
        quantity: item.quantity,
        price_per_unit: item.priceRub,
        loyalty_units_applied: Number(item.loyaltyUnitsApplied || 0),
      })),
    });
  } catch (error) {
    console.warn("[Checkout] Failed to refresh loyalty preview", error);
  }
}

function getItemLoyaltyUnits(productId: string | null, variantId: string | null) {
  const item = cartStore.items.find(
    (cartItem) =>
      cartItem.productId === productId &&
      (cartItem.variantId || null) === (variantId || null),
  );
  return Math.max(0, Number(item?.loyaltyUnitsApplied || 0));
}

function isLoyaltyAppliedToLine(line: LoyaltyPreviewLineItem) {
  return getItemLoyaltyUnits(line.product_id, line.variant_id) > 0;
}

function availableLoyaltyLines(category: LoyaltyPreviewCategory) {
  return category.line_items.filter(
    (line) => Number(line.max_redeemable_units || 0) > 0 || isLoyaltyAppliedToLine(line),
  );
}

function cartItemForLoyaltyLine(line: LoyaltyPreviewLineItem) {
  return cartStore.items.find(
    (item) =>
      item.productId === line.product_id &&
      (item.variantId || null) === (line.variant_id || null),
  );
}

function loyaltyChoiceType(category: LoyaltyPreviewCategory, line: LoyaltyPreviewLineItem) {
  if (category.category_key !== "liquids") {
    return category.category_key;
  }

  const cartItem = cartItemForLoyaltyLine(line);
  const catalogCategory = catalogStore.categories.find(
    (item) => item.id === cartItem?.categoryId,
  );
  const categoryText = [
    cartItem?.categoryId,
    catalogCategory?.slug,
    catalogCategory?.name,
    catalogCategory?.storefrontFiltersProfile,
    cartItem?.groupName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru");

  return /(snus|snyus|снюс|пластин)/i.test(categoryText) ? "snus" : "liquid";
}

function loyaltyChoiceLabel(category: LoyaltyPreviewCategory, type: string) {
  const labels: Record<string, string> = {
    liquid: "На жидкость",
    snus: "На снюс",
    disposables: "На одноразку",
    devices: "На устройство",
  };
  return labels[type] || `На категорию «${checkoutLoyaltyCategoryLabel(category)}»`;
}

function loyaltyLinePrice(line: LoyaltyPreviewLineItem) {
  return Number(cartItemForLoyaltyLine(line)?.priceRub || 0);
}

function buildCheckoutLoyaltyChoices(category: LoyaltyPreviewCategory): CheckoutLoyaltyChoice[] {
  const groupedLines = new Map<string, LoyaltyPreviewLineItem[]>();
  for (const line of availableLoyaltyLines(category)) {
    const type = loyaltyChoiceType(category, line);
    groupedLines.set(type, [...(groupedLines.get(type) || []), line]);
  }

  return [...groupedLines.entries()].map(([type, lines]) => {
    const appliedLine = lines.find((line) => isLoyaltyAppliedToLine(line));
    const bestLine = lines.reduce((best, line) =>
      loyaltyLinePrice(line) > loyaltyLinePrice(best) ? line : best,
    );
    return {
      key: `${category.category_id}:${type}`,
      label: loyaltyChoiceLabel(category, type),
      category,
      line: appliedLine || bestLine,
    };
  });
}

function getAppliedLoyaltyLineKey(category: LoyaltyPreviewCategory) {
  const appliedLine = category.line_items.find((line) => isLoyaltyAppliedToLine(line));
  return appliedLine?.key || null;
}

function canApplyLoyaltyToLine(category: LoyaltyPreviewCategory, line: LoyaltyPreviewLineItem) {
  return (
    Number(category.current_available_bonus_count || 0) > 0 &&
    Number(line.max_redeemable_units || 0) > 0
  );
}

function canToggleLoyaltyLine(category: LoyaltyPreviewCategory, line: LoyaltyPreviewLineItem) {
  if (promoResult.value) {
    return false;
  }

  if (isLoyaltyAppliedToLine(line)) {
    return true;
  }

  if (!canApplyLoyaltyToLine(category, line)) {
    return false;
  }

  const appliedLineKey = getAppliedLoyaltyLineKey(category);
  return !appliedLineKey || appliedLineKey === line.key;
}

function loyaltyLineStateText(category: LoyaltyPreviewCategory, line: LoyaltyPreviewLineItem) {
  if (!canApplyLoyaltyToLine(category, line)) {
    return "Недоступно";
  }

  if (getAppliedLoyaltyLineKey(category)) {
    return "Бонус уже выбран";
  }

  return "";
}

function setLoyaltyUnitsForLine(line: LoyaltyPreviewLineItem, nextUnits: number) {
  cartStore.setLoyaltyUnits(
    String(line.product_id || ""),
    Math.max(0, Math.min(1, nextUnits)),
    line.variant_id || null,
  );
}

function clearLoyaltySelectionInCategory(category: LoyaltyPreviewCategory, exceptLineKey?: string) {
  for (const currentLine of category.line_items) {
    if (currentLine.key === exceptLineKey) continue;
    if (!isLoyaltyAppliedToLine(currentLine)) continue;
    setLoyaltyUnitsForLine(currentLine, 0);
  }
}

function toggleLoyaltyLine(category: LoyaltyPreviewCategory, line: LoyaltyPreviewLineItem) {
  if (!canToggleLoyaltyLine(category, line)) {
    return;
  }

  if (isLoyaltyAppliedToLine(line)) {
    setLoyaltyUnitsForLine(line, 0);
    return;
  }

  clearLoyaltySelectionInCategory(category, line.key);
  setLoyaltyUnitsForLine(line, 1);
}

async function openProfileFromLoyaltyPopup() {
  showLoyaltyPopup.value = false;
  await router.push("/profile");
}

function blurActiveInput() {
  // Снимаем фокус с любого активного input (скрывает клавиатуру на iOS)
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function handlePageClick(event: MouseEvent) {
  // Скрываем клавиатуру при тапе вне input на iOS
  const target = event.target as HTMLElement;
  if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
    blurActiveInput();
  }
}

function normalizeTelegramUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
}

function readTelegramUser(): TelegramMiniAppUser | null {
  if (!hasTelegramMiniAppUserContext()) {
    return null;
  }
  return window.Telegram?.WebApp?.initDataUnsafe?.user ?? null;
}

function updateTelegramUserUsername(username: string) {
  const currentUser = telegramUser.value;
  if (!currentUser) {
    return;
  }

  telegramUser.value = username
    ? { ...currentUser, username }
    : { ...currentUser, username: undefined };
}

function applyDetectedUsername(username: string | null) {
  const normalizedUsername = normalizeTelegramUsername(username);
  detectedTelegramUsername.value = normalizedUsername;
  updateTelegramUserUsername(normalizedUsername);

  if (normalizedUsername) {
    form.telegramUsername = normalizedUsername;
    errors.telegramUsername = "";
  } else if (hasTelegramMiniAppUserContext() && !verifiedTelegramUsername.value) {
    form.telegramUsername = "";
  }

  return normalizedUsername;
}

function applyVerifiedUsername(username: string | null) {
  const normalizedUsername = applyDetectedUsername(username);
  verifiedTelegramUsername.value = normalizedUsername;
  telegramUsernameVerified.value = Boolean(normalizedUsername);

  if (normalizedUsername) {
    submitError.value = "";
    showUsernameRequiredModal.value = false;
  }

  return normalizedUsername;
}

function syncTelegramUserData(options: { trustCurrentUser?: boolean } = {}) {
  const { trustCurrentUser = false } = options;
  const user = readTelegramUser();
  telegramUser.value = user;

  const detectedUsername = applyDetectedUsername(user?.username ?? null);
  if (detectedUsername && trustCurrentUser) {
    applyVerifiedUsername(detectedUsername);
  }

  return { user, detectedUsername };
}

function openUsernameRequiredModal() {
  showUsernameRequiredModal.value = true;
}

function closeUsernameRequiredModal() {
  showUsernameRequiredModal.value = false;
}

function closeMiniApp() {
  // Закрываем Mini App через Telegram WebApp API
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.close) {
    tg.close();
  } else {
    // Fallback если API недоступен
    alert("Закройте магазин вручную и откройте заново");
  }
}

function cancelPromoCode() {
  handlePromoClear();
}

watch(
  () => form.deliveryType,
  (newType, oldType) => {
    if (newType === "delivery" && oldType === "pickup") {
      if (!canUseDelivery.value) {
        form.deliveryType = "pickup";
        showMinDeliveryBanner.value = true;
      } else if (
        !deliveryConditionsShown.value &&
        settingsStore.settings.delivery_conditions_image
      ) {
        setTimeout(() => {
          showDeliveryConditionsBanner.value = true;
          deliveryConditionsShown.value = true;
        }, 1000);
      }
    }
  },
);

onMounted(async () => {
  // Всё, что не зависит друг от друга, грузим параллельно: раньше статус
  // карты запрашивался последним в цепочке, из-за чего блок «Способ оплаты»
  // появлялся заметно позже остального экрана.
  const cardStatusPromise = loadCardPaymentStatus();
  const settingsPromise = settingsStore.fetchSettings();
  const stockPromise = fetchStockLimits();

  // Пока грузятся данные — сразу синхронизируем контекст Telegram из
  // уже доступного клиента, чтобы не ждать сетевых ответов.
  syncTelegramUserData({ trustCurrentUser: true });
  // Данные Telegram получены и username проверен — с этого момента
  // предупреждение «Нужен Telegram username» показывается по факту.
  telegramSyncSettled.value = true;

  await settingsPromise;
  if (!catalogStore.categories.length) {
    const hasGroupItems = cartStore.items.some((item) => item.groupId);
    if (hasGroupItems) {
      await catalogStore.fetchCategories();
    }
  }
  // Персональный минимум мог смениться админом среди сессии — обновляем
  // после восстановления контекста редактируемого заказа.
  await stockPromise;
  await hydrateEditingOrder();
  if (wholesaleStore.isWholesale) {
    await wholesaleStore.refreshEffectiveMinimum();
  }
  await refreshLoyaltyPreview();
  if (!wholesaleStore.isWholesale) {
    try {
      // Тянем snapshot чтобы посчитать накопленную скидку «за покупки»,
      // которая используется в сумме чека (loyaltyDiscountAmount).
      // Авто-показ LoyaltyBonusPopup при заходе в чекаут убран по просьбе
      // заказчика — попап «У вас уже есть доступные бонусы» дублировал
      // информацию, которая и так видна в карточке бонусов на витрине
      // и в профиле, и просто отвлекал.
      await loyaltyStore.fetchSnapshot(getTelegramIdentity());
    } catch (error) {
      console.warn("[Checkout] Failed to fetch loyalty snapshot", error);
    }
  }
  // Окно «Нужен Telegram username» намеренно НЕ открывается при входе:
  // в карточке заказа уже есть встроенное предупреждение с кнопкой
  // «Как поставить username», а при попытке оформления modal откроется сам
  // (см. beginCheckout/submitOrder). Автопоказ на монтировании успевал
  // мигнуть на долю секунды, пока данные Telegram ещё досинхронизируются.
  await cardStatusPromise;
});

watch(
  () =>
    JSON.stringify({
      promo: promoResult.value ? promoCode.value.trim() : "",
      edit: cartStore.editingOrderId,
      username: form.telegramUsername,
      items: cartStore.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId || null,
        quantity: item.quantity,
        priceRub: item.priceRub,
        loyaltyUnitsApplied: Number(item.loyaltyUnitsApplied || 0),
      })),
    }),
  () => {
    void refreshLoyaltyPreview();
  },
  { flush: "sync" },
);

async function hydrateEditingOrder() {
  if (!isEditingOrder.value) {
    editingOrderDetails.value = null;
    return;
  }

  try {
    const activeOrder = await fetchMyActiveOrder(getTelegramIdentity());
    if (!activeOrder || activeOrder.id !== cartStore.editingOrderId) {
      cartStore.clearOrderEdit();
      editingOrderDetails.value = null;
      return;
    }

    editingOrderDetails.value = activeOrder;
    if (activeOrder.is_wholesale) {
      wholesaleStore.applyOrderWholesaleContext({
        code: activeOrder.wholesale_code,
        secret: activeOrder.wholesale_secret,
        label: activeOrder.wholesale_tier_label,
        minOrderAmount: activeOrder.wholesale_min_amount,
        minQuantity: activeOrder.wholesale_min_quantity,
      });
    } else if (wholesaleStore.isWholesale) {
      wholesaleStore.clearContext();
    }

    form.deliveryType = activeOrder.delivery_type;
    form.phone = activeOrder.phone || "";
    form.address = activeOrder.delivery_address || "";
    form.notes = activeOrder.notes || "";

    const orderUsername = normalizeTelegramUsername(activeOrder.telegram_username);
    if (orderUsername && !form.telegramUsername) {
      form.telegramUsername = orderUsername;
    }

    const orderPromoCode = activeOrder.promo_code_text || cartStore.editingPromoCode;
    if (orderPromoCode) {
      promoCode.value = orderPromoCode;
      cartStore.setEditingPromoCode(orderPromoCode);
      await handlePromoApply();
    } else {
      handlePromoClear();
    }
  } catch (error) {
    console.warn("[Checkout] Failed to hydrate editing order", error);
  }
}

async function fetchStockLimits() {
  stockLoading.value = true;
  const newLimits = new Map<string, number>();
  try {
    for (const item of cartStore.items) {
      const response = await fetch(`/api/product/${item.productId}`, {
        headers: wholesaleStore.buildHeaders(),
      });
      if (response.ok) {
        const product = await response.json();
        let stock: number | null = null;
        if (item.variantId && product.variants) {
          const variant = product.variants.find(
            (v: any) => v.id === item.variantId,
          );
          stock = variant?.stock ?? null;
        } else if (!product.hasVariants) {
          stock = product.stock;
        }
        const key = item.variantId
          ? `${item.productId}_${item.variantId}`
          : item.productId;
        if (stock !== null) {
          newLimits.set(key, stock);
        }
      }
    }
    stockLimits.value = newLimits;
  } catch (error) {
    console.error("[Checkout] Failed to fetch stock limits:", error);
  } finally {
    stockLoading.value = false;
  }
}

function getMaxStock(
  productId: string,
  variantId?: string | null,
): number | null {
  const key = variantId ? `${productId}_${variantId}` : productId;
  return stockLimits.value.get(key) ?? null;
}

function canIncrement(item: (typeof cartStore.items)[0]): boolean {
  const maxStock = getMaxStock(item.productId, item.variantId);
  if (maxStock === null) return true;
  return item.quantity < maxStock;
}

function formatPrice(price: number): string {
  return price.toFixed(0);
}

function handleBack() {
  showMinDeliveryBanner.value = false;
  showDeliveryConditionsBanner.value = false;
  router.push("/");
}

function handleClearCart() {
  if (confirm("Очистить корзину?")) {
    cartStore.clearCart();
  }
}

function incrementQuantity(productId: string, variantId?: string | null) {
  const item = cartStore.items.find(
    (i) =>
      i.productId === productId && (!variantId || i.variantId === variantId),
  );
  if (item && canIncrement(item)) {
    cartStore.updateQuantity(productId, item.quantity + 1, variantId);
  }
}

function decrementQuantity(productId: string, variantId?: string | null) {
  const item = cartStore.items.find(
    (i) =>
      i.productId === productId && (!variantId || i.variantId === variantId),
  );
  if (item && item.quantity > 1) {
    cartStore.updateQuantity(productId, item.quantity - 1, variantId);
  } else if (item && item.quantity === 1) {
    cartStore.removeItem(productId, variantId);
  }
}

function validateForm(): boolean {
  errors.telegramUsername = "";
  errors.phone = "";
  errors.address = "";

  if (isWholesaleSubmitBlocked.value) {
    submitError.value = wholesaleMinimumQuantity.value
      ? `Для оформления нужно добрать еще ${wholesaleRemaining.value} ${accusativePositions(wholesaleRemaining.value)}`
      : `Для оформления нужно добрать еще ${wholesaleRemaining.value.toFixed(2)} BYN`;
    return false;
  }

  if (shouldShowOpenInTelegramForWholesale.value) {
    submitError.value =
      "Откройте магазин в Telegram, чтобы оформить оптовый заказ с вашим профилем.";
    return false;
  }

  if (requiresTelegramUsername.value) {
    submitError.value = "Без Telegram username оформить заказ нельзя.";
    showUsernameRequiredModal.value = true;
    return false;
  }

  if (!form.telegramUsername.trim()) {
    errors.telegramUsername = "Укажите ваш Telegram username";
    return false;
  }

  const username = form.telegramUsername.trim().replace(/^@/, "");
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
    errors.telegramUsername = "Username должен содержать от 5 до 32 символов";
    return false;
  }

  if (form.deliveryType === "delivery") {
    if (!form.phone.trim()) {
      errors.phone = "Укажите номер телефона";
      return false;
    }
    if (!form.address.trim()) {
      errors.address = "Укажите адрес доставки";
      return false;
    }
  }

  return true;
}

/**
 * Обновляет статус оплаты картой.
 * silent — фоновая сверка (например, при выборе «Картой»): не блокируем
 * кнопку «Оформить заказ», иначе она мигает на каждый клик по способу
 * оплаты. Гонки не будет: beginCheckout сам выходит, пока идёт проверка.
 */
async function loadCardPaymentStatus(options: { silent?: boolean } = {}) {
  const silent = options.silent === true;
  if (!silent) isCheckingCardPaymentStatus.value = true;
  try {
    const response = await fetch("/api/card-payment/status", {
      headers: withTelegramAuthHeaders(),
    });
    if (!response.ok) return;
    const status = await response.json();
    cardPaymentStatus.value = status;
    writeCachedCardStatus(status);
  } catch (error) {
    console.warn("[Checkout] Card payment status unavailable", error);
  } finally {
    if (!silent) isCheckingCardPaymentStatus.value = false;
  }
}

function formatCardMoney(amountMinor: number) {
  return (Number(amountMinor || 0) / 100).toFixed(2);
}

function handlePaymentChoiceKeydown(event: KeyboardEvent, current: "cash" | "card") {
  const target = event.currentTarget as HTMLButtonElement;
  let next: "cash" | "card" | null = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End") next = "card";
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home") next = "cash";
  if (!next) return;
  event.preventDefault();
  // Кнопка «Картой» обёрнута в span с плашкой ошибки, поэтому ищем пару
  // не в parentElement, а в общей группе радиокнопок.
  const group = target.closest('[role="radiogroup"]');
  const nextButton = group?.querySelector<HTMLButtonElement>(
    next === "cash" ? '[aria-label="Наличными"]' : '[aria-label="Картой"]',
  );
  if (!nextButton || nextButton.disabled) return;
  nextButton.focus();
  void selectCheckoutPayment(next);
}

async function selectCheckoutPayment(method: "cash" | "card") {
  if (method === "cash") {
    selectedPaymentMethod.value = method;
    submitError.value = "";
    clearCardError();
    return;
  }

  await loadCardPaymentStatus({ silent: true });
  if (!canChooseCheckoutPayment.value) {
    showCardError("Оплата картой для вашего аккаунта недоступна.");
    return;
  }

  selectedPaymentMethod.value = method;
  submitError.value = "";
  if (isCardBlockedForOrder.value) {
    // Плашка у способа оплаты вместо всплывашки снизу (демо-образец).
    showCardError(cardBlockToast.value);
  }
}

async function beginCheckout() {
  if (isSubmitting.value || isConfirmingOrder.value || isCheckingCardPaymentStatus.value || checkoutCalculationPending.value) return;
  if (isOrderConfirmation.value) {
    // Ветка финального подтверждения содержит сетевой запрос (сверка статуса
    // карты) до вызова submitOrder. Без отдельного флага второй клик в это
    // окно прошёл бы гейт выше и — так как isOrderConfirmation уже снят —
    // вернул клиента на экран подтверждения поверх летящего заказа.
    // isSubmitting здесь не подходит: submitOrder сам выходит по нему, поэтому
    // держим собственный флаг ровно на время подтверждения.
    isConfirmingOrder.value = true;
    try {
      acceptedAgreementIds.value = loadedAgreements.value.map((agreement) => agreement.id);
      const previousPaymentMethod = confirmationPaymentMethod.value;
      await loadCardPaymentStatus();
      const paymentMethod = effectivePaymentMethod.value;
      if (previousPaymentMethod === "card" && paymentMethod !== "card") {
        selectedPaymentMethod.value = "cash";
        confirmationPaymentMethod.value = "cash";
        isOrderConfirmation.value = false;
        showToast("Оплата картой больше недоступна. Проверьте способ оплаты и подтвердите заказ ещё раз.", "error");
        return;
      }
      confirmationPaymentMethod.value = paymentMethod;
      isOrderConfirmation.value = false;
      await submitOrder(paymentMethod);
    } finally {
      isConfirmingOrder.value = false;
    }
    return;
  }
  if (showCardTariffsModal.value) return;
  if (requiresTelegramUsername.value) {
    showUsernameRequiredModal.value = true;
    return;
  }
  await loadCardPaymentStatus();
  if (!isEditingOrder.value) {
    confirmationPaymentMethod.value = effectivePaymentMethod.value;
    isOrderConfirmation.value = true;
    return;
  }
  void submitOrder("cash");
}

function openCardEditLimitModal(message: string, hint: string) {
  cardEditLimitMessage.value = message;
  cardEditLimitHint.value = hint;
  showCardEditLimitModal.value = true;
}

function closeCardEditLimitModal() {
  showCardEditLimitModal.value = false;
  cardEditLimitMessage.value = "";
  cardEditLimitHint.value = "";
}

async function openCardTariffsFromEditLimit() {
  closeCardEditLimitModal();
  await openCardTariffs();
}

async function openCardTariffs() {
  cardRequestError.value = "";
  cardRequestSuccess.value = false;
  try {
    const response = await fetch("/api/card-payment/tariffs", {
      headers: withTelegramAuthHeaders(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error("Не удалось загрузить тарифы");
    cardTariffs.value = result.tariffs || [];
    selectedCardTariff.value = cardTariffs.value[0]?.id || "";
    showCardTariffsModal.value = true;
  } catch (error: any) {
    showToast(error?.message || "Не удалось загрузить тарифы", "error");
    selectedPaymentMethod.value = "cash";
    confirmationPaymentMethod.value = "cash";
  }
}

function closeCardTariffs() {
  if (cardRequestSending.value) return;
  cardRequestSuccess.value = false;
  showCardTariffsModal.value = false;
}

async function submitCardLimitRequest() {
  if (!selectedCardTariff.value || cardRequestSending.value) return;
  if (cardPaymentStatus.value?.request_cooldown_until) {
    cardRequestError.value = "Повторно отправить заявку можно через час после предыдущей.";
    return;
  }
  cardRequestSending.value = true;
  cardRequestError.value = "";
  try {
    const response = await fetch("/api/card-payment/requests", {
      method: "POST",
      headers: withTelegramAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tariff_id: selectedCardTariff.value }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result?.error === "card_request_cooldown") {
        cardPaymentStatus.value.request_cooldown_until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        throw new Error("Повторно отправить заявку можно через час после предыдущей.");
      }
      throw new Error(result?.message || "Не удалось отправить заявку");
    }
    cardRequestSuccess.value = true;
    cardPaymentStatus.value.request_cooldown_until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  } catch (error: any) {
    cardRequestError.value = error?.message || "Не удалось отправить заявку";
  } finally {
    cardRequestSending.value = false;
  }
}

async function submitOrder(paymentMethod: "cash" | "card" = "cash") {
  if (isSubmitting.value || checkoutCalculationPending.value) {
    return;
  }

  // Скрываем клавиатуру перед отправкой
  blurActiveInput();
  submitError.value = "";

  // Telegram кеширует initData — если username не был при открытии,
  // его не будет до перезапуска Mini App. Показываем модалку.
  if (requiresTelegramUsername.value) {
    showUsernameRequiredModal.value = true;
    return;
  }

  const validationResult = validateForm();
  if (!validationResult) return;

  // Локальная проверка соглашений (быстрая UX-валидация перед сетевым
  // запросом). Серверная проверка в /api/orders — основная и не зависит от
  // фронта. Если что-то не отмечено — подсвечиваем чекбоксы и показываем toast.
  // ВАЖНО: при модификации существующего заказа (PUT /api/orders/:id/...)
  // соглашения уже были приняты при изначальном оформлении и заново их
  // принимать не нужно. Бэк modify-by-customer тоже их не валидирует.
  if (!isEditingOrder.value) {
    const localMissing = computeLocalMissingAgreementIds();
    if (localMissing.length) {
      missingAgreementIds.value = localMissing;
      showToast("Подтвердите согласие для оформления заказа", "error");
      return;
    }
  }
  // Сабмит начинается с чистым списком ошибок — если сервер вернёт missing,
  // мы перезапишем (см. ниже).
  missingAgreementIds.value = [];

  isSubmitting.value = true;

  try {
    const user = telegramUser.value;
    const cleanUsername = normalizeTelegramUsername(
      verifiedTelegramUsername.value || detectedTelegramUsername.value || form.telegramUsername,
    );

    const orderData = {
      telegram_id: user?.id ? String(user.id) : undefined,
      telegram_username: cleanUsername,
      telegram_username_verified: user?.id ? telegramUsernameVerified.value : true,
      first_name: user?.first_name || undefined,
      last_name: user?.last_name || undefined,
      delivery_type: form.deliveryType,
      delivery_address:
        form.deliveryType === "delivery" ? form.address : undefined,
      phone: form.deliveryType === "delivery" ? form.phone : undefined,
      notes: form.notes || undefined,
      promo_code:
        promoResult.value ? promoCode.value.trim() : undefined,
      items: cartStore.items.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId || null,
        quantity: item.quantity,
        price_per_unit: item.priceRub,
        product_title: item.productTitle || item.title,
        variant_name: item.variantName || null,
        loyalty_units_applied: wholesaleStore.isWholesale
          ? 0
          : Number(item.loyaltyUnitsApplied || 0),
      })),
      accepted_agreement_ids: acceptedAgreementIds.value,
      payment_method: paymentMethod,
    };

    const response = await fetch(
      isEditingOrder.value && cartStore.editingOrderId
        ? `/api/orders/${cartStore.editingOrderId}/modify-by-customer`
        : "/api/orders",
      {
      method: isEditingOrder.value ? "PUT" : "POST",
      headers: withTelegramAuthHeaders({
        "Content-Type": "application/json",
        ...wholesaleStore.buildHeaders(),
      }),
      body: JSON.stringify(orderData),
    });

    let result: any;
    try {
      result = await response.json();
    } catch {
      if (!response.ok) throw new Error("Не удалось создать заказ");
    }

    if (!response.ok) {
      if (result?.error === "agreements_required") {
        // Бэк прислал список конкретных непринятых соглашений — подсвечиваем
        // именно их и показываем точное сообщение от сервера. Это покрывает
        // race-условие, когда между загрузкой /api/agreements и сабмитом
        // в админке могли активировать новое соглашение.
        const missing = Array.isArray(result?.missing) ? result.missing : [];
        missingAgreementIds.value = missing
          .map((m: { id?: number }) => Number(m?.id))
          .filter((id: number) => Number.isFinite(id) && id > 0);
        showToast(
          result?.message || "Подтвердите согласие для оформления заказа",
          "error",
        );
        return;
      }
      if (result?.error === "active_order_exists") {
        await router.push("/my-order");
        return;
      }
      if (
        result?.error === "daily_limit_exhausted" ||
        result?.error === "daily_limit_exceeded_by_order" ||
        result?.error === "card_payment_not_allowed"
      ) {
        selectedPaymentMethod.value = "cash";
        confirmationPaymentMethod.value = "cash";
        submitError.value = result?.error === "daily_limit_exhausted"
          ? (result?.message || "Лимит оплаты по карте на сегодня уже занят другим заказом. Вы можете оформить этот заказ только за наличные.")
          : result?.error === "daily_limit_exceeded_by_order"
            ? (result?.message || "Заказ превышает дневной лимит оплаты картой. Оформите его за наличные или уменьшите корзину.")
            : "Оплата картой больше недоступна для вашего аккаунта. Вы можете оформить этот заказ наличными.";
        await loadCardPaymentStatus();
        return;
      }
      if (
        result?.error === "personal_limit_exceeded" ||
        result?.error === "personal_monthly_limit_exceeded" ||
        result?.error === "personal_cooldown"
      ) {
        selectedPaymentMethod.value = "cash";
        confirmationPaymentMethod.value = "cash";
        submitError.value = result?.error === "personal_limit_exceeded"
          ? (result?.message || "Заказ больше вашего лимита на оплату картой. Уберите лишние товары, оплатите наличными или увеличьте лимиты.")
          : result?.error === "personal_monthly_limit_exceeded"
            ? (result?.message || "Личный лимит оплаты картой исчерпан. Оплатите заказ наличными.")
            : "Оплата картой на паузе для вашего аккаунта. Вы можете оформить этот заказ наличными.";
        await loadCardPaymentStatus();
        return;
      }
      if (result?.error === "customer_blocked") {
        // Сервер заблокировал заказ — обновляем глобальное состояние,
        // чтобы App.vue показал BlockedScreen поверх всего.
        // Защитный fallback: если backend не приложил block payload,
        // всё равно показываем экран без подробностей.
        applyBlockFromResponse(
          result.block ?? { reason: null, block_until: null },
        );
        return;
      }
      if (result?.error === "discount_blocked") {
        // Заморозка скидочной системы: обновляем статус в loyalty store,
        // чтобы плашка и disabled-состояния появились сразу.
        loyaltyStore.discountBlock = {
          blocked: true,
          until: result?.block?.until ?? null,
          comment: null,
        };
        showToast(
          result?.message || "Скидки и промокоды временно недоступны",
          "error",
        );
        return;
      }
      if (
        result?.error === "referral_authorization_required" ||
        String(result?.error || "").startsWith("referral_")
      ) {
        window.dispatchEvent(new CustomEvent("referral-authorization-required"));
        showToast("Сначала пройдите обязательную авторизацию", "error");
        return;
      }
      if (result?.error === "min_delivery_amount_not_met") {
        showMinDeliveryBanner.value = true;
        form.deliveryType = "pickup";
        throw new Error(
          result.message || "Сумма заказа меньше минимальной для доставки",
        );
      }
      if (result?.error === "wholesale_min_not_met") {
        throw new Error(
          result.message || "Количество позиций меньше минимального для выбранного оптового прайса",
        );
      }
      if (result?.error === "card_limit_exceeded_on_edit") {
        // Смешанной оплаты больше нет: изменение карточного заказа,
        // вылезшее за лимит (личный или дневной магазина), не проходит —
        // показываем отдельное окно с понятным объяснением.
        openCardEditLimitModal(
          result?.message
            || "Заказ больше суммы, зарезервированной картой. Оплатите наличными или оформите новый заказ в пределах лимита.",
          "Изменить заказ картой в этой сумме нельзя. Уберите лишние товары из корзины или оплатите заказ наличными.",
        );
        return;
      }
      if (isEditingOrder.value && result?.error === "not_found") {
        cartStore.clearOrderEdit();
        await router.push("/my-order");
        return;
      }
      if (
        result?.error === "promo_and_loyalty_conflict" ||
        result?.error === "loyalty_balance_not_enough" ||
        result?.error === "loyalty_category_not_available"
      ) {
        throw new Error("Не удалось применить скидку за покупки. Обновите корзину и попробуйте снова.");
      }
      throw new Error(result?.message || "Не удалось создать заказ");
    }

    const wasEditingOrder = isEditingOrder.value;
    cartStore.clearCart();
    cartStore.finishOrderEdit();
    // Смешанной оплаты больше нет: заказ либо целиком картой в пределах
    // лимита, либо целиком наличными. Отдельное уведомление о «наличной
    // части» не требуется.
    void wasEditingOrder;
    await router.push("/my-order");
  } catch (error: any) {
    console.error("[Checkout] Submit error", error);
    submitError.value =
      error?.message || "Не удалось оформить заказ. Попробуйте снова.";
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<style scoped>
/* Страница — flex-колонка на доступную высоту: min-height приходит
   инлайном из JS (реальная видимая высота, immune к vh/dvh-причудам
   Telegram WebView). Фолбэк на vh — только до первого измерения. */
.checkout-page {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--app-topbar-offset, 86px));
  background: #f2f3f6;
}

.header-area {
  position: relative;
  background: #ffffff;
  border-radius: 0 0 20px 20px;
  padding: 0;
  box-shadow: 0 4px 32px rgba(170, 178, 189, 0.32);
  z-index: 20;
}

.checkout-page--confirmation .checkout-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.checkout-page--confirmation .checkout-container {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}

.checkout-page--confirmation .checkout-footer {
  flex: 0 0 auto;
  margin-top: 0;
}

/* main — растягивается на всё свободное место (прижимая футер
   вниз), скроллит документ. Верхний отступ под хедер. */
.checkout-main {
  flex: 1 0 auto;
  display: block;
  padding-top: 14px;
}

/* Футер: короткая страница — прижат к низу ЭКРАНА (margin-top: auto
   дополнительно к flex-росту main — двойная страховка), длинная —
   стоит после контента. Sticky при прокрутке: кнопки всегда внизу. */
.checkout-footer {
  position: sticky;
  bottom: 0;
  z-index: 20;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 16px max(16px, env(safe-area-inset-bottom, 0px));
  background: #f2f3f6;
}

.checkout-footer .submit-error {
  margin: 0 0 -4px;
}

/* Хедер из демо: сетка назад/заголовок/очистить 44px. */
.checkout-header {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  padding: 8px 12px;
}

.icon-button {
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: #26272a;
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.2s ease;
}

.icon-button:hover {
  background: #f5f7fa;
}

.icon-button--muted {
  color: #7b8190;
}

.icon-button svg {
  width: 22px;
  height: 22px;
}

.checkout-title {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: clamp(17px, 5vw, 21px);
  line-height: 1.2;
  text-align: center;
  color: #18191b;
  margin: 0;
}

.checkout-container {
  padding: 0 16px;
}

.empty-cart {
  text-align: center;
  padding: 60px 20px;
  background: #ffffff;
  border-radius: 20px;
}

.empty-cart-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-cart p {
  font-size: 16px;
  color: #666;
  margin-bottom: 24px;
}

.back-to-shop-btn {
  padding: 16px 32px;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  color: #fff;
  border: none;
  border-radius: 528px;
  font-family: "Montserrat", sans-serif;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
}

.checkout-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.order-confirmation {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 20px;
  text-align: center;
  background: transparent;
  border-radius: 0;
}

.order-confirmation__emoji {
  margin: 0 0 8px;
}

.order-confirmation__title {
  max-width: 340px;
  margin: 0;
  color: #18191b;
  font-family: "Montserrat", sans-serif;
  font-size: 21px;
  font-weight: 800;
  line-height: 1.4;
  text-transform: uppercase;
}

.order-confirmation__text {
  margin: 0;
  color: #656b75;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.order-confirmation__small-text {
  max-width: 340px;
  margin: 0;
  color: #8a93a0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
}


.order-card {
  background: #ffffff;
  border-radius: 20px;
  overflow: hidden;
}

.cart-items {
  overflow: hidden;
}

/* Компактная строка из демо: сетка 49px / 1fr / 91px. */
.cart-item {
  display: grid;
  grid-template-columns: 49px minmax(0, 1fr) 91px;
  gap: 10px;
  align-items: center;
  padding: 9px 10px;
  min-height: 72px;
}

.cart-item + .cart-item {
  border-top: 1px solid #eceef2;
}

.cart-item-visual {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 4px;
}

/* Миниатюра: маленькая, с рамкой (демо .thumb). */
.cart-item-thumb {
  display: grid;
  place-items: center;
  width: 49px;
  height: 54px;
  border-radius: 9px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  overflow: hidden;
  color: #a0a7b3;
}

.cart-item-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  padding: 4px;
  object-fit: contain;
  object-position: center;
}

.cart-item-thumb svg {
  width: 20px;
  height: 20px;
}

.ice-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 20px;
  height: 20px;
  background: linear-gradient(90deg, #09b5fd 0%, #00499f 100%);
  box-shadow: 0px 4px 24px rgba(0, 73, 159, 0.12);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.cart-item-info {
  min-width: 0;
}

/* Линейка — бренд: цвет кнопки «посмотреть отзывы» (#0273f5). */
.cart-item-group {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 10px;
  line-height: 12px;
  color: #0273f5;
  margin: 0 0 2px;
}

.cart-item-title {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 13px;
  line-height: 1.25;
  color: #18191b;
  margin: 2px 0;
  overflow-wrap: anywhere;
}

.cart-item-meta {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 11px;
  line-height: 13px;
  color: #707684;
  margin: 0;
}

.cart-item-price {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 13px;
  line-height: 16px;
  color: #18191b;
  margin: 2px 0 0;
}

.cart-item-price-old {
  margin-right: 4px;
  color: #98a2b3;
  opacity: 0.6;
  text-decoration: line-through;
  font-size: 11px;
}

/* Ступенька количества: горизонтальная (демо .stepper). */
.cart-item-controls {
  display: grid;
  grid-template-columns: 34px 23px 34px;
  align-items: center;
  justify-content: end;
  text-align: right;
}

.qty-btn {
  height: 34px;
  border: none;
  border-radius: 11px;
  background: #f2f3f6;
  color: #18191b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  font-size: 20px;
  line-height: 1;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.qty-btn:hover:not(:disabled) {
  background: #e6e9ed;
}

.qty-btn-disabled,
.qty-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.qty-btn span {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 18px;
  line-height: 1;
  color: #18191b;
  margin-top: -2px;
}

.qty-value {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.qty-value span {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 650;
  font-size: 13px;
  line-height: 16px;
  color: #18191b;
}

/* ===== Сворачивание «Ещё N товаров» (демо .more) =====
   Состояние — класс cart-more--open (управляет Vue).
   Закрытие длинного списка мягче раскрытия: 0.45s и ease-out —
   страница сжимается без рывка (скролл доводится в JS тем же
   темпом, см. toggleMoreItems). */
.cart-more-list {
  display: grid;
  grid-template-rows: 0fr;
  visibility: hidden;
  transition:
    grid-template-rows 0.45s cubic-bezier(0.33, 1, 0.68, 1),
    visibility 0s linear 0.45s;
}

.cart-more-list > div {
  min-height: 0;
  overflow: hidden;
}

.cart-more--open .cart-more-list {
  grid-template-rows: 1fr;
  visibility: visible;
  transition-delay: 0s;
}

.cart-more-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 42px;
  padding: 0 12px;
  /* Цвет и шрифт — 1в1 с кнопкой «посмотреть отзывы»
     (ReviewRatingLink): #0273f5, SF Pro Display 12px.
     Кнопка по центру строки. */
  color: #0273f5;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  font-weight: 400;
  border: 0;
  background: none;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  width: 100%;
  transition: opacity 0.2s ease;
}

.cart-more-link:active {
  opacity: 0.72;
}

.cart-more-link::after {
  content: "";
  width: 6px;
  height: 6px;
  border: solid currentColor;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
  transition: transform 0.3s;
}

.cart-more--open .cart-more-link::after {
  transform: rotate(225deg);
}

.cart-more--open .cart-more-link .closed {
  display: none;
}

.cart-more-link .opened {
  display: none;
}

.cart-more--open .cart-more-link .opened {
  display: inline;
}

.cart-more-link:hover {
  opacity: 0.8;
}

.cart-more-link:focus-visible {
  outline: 2px solid #0273f5;
  outline-offset: -3px;
}

.editing-order-card {
  background: linear-gradient(145deg, #191919 0%, #363636 100%);
  border-radius: 20px;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #ffffff;
}

.editing-order-kicker {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.58);
}

.editing-order-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 18px;
  line-height: 22px;
}

.editing-order-text {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 19px;
  color: rgba(255, 255, 255, 0.78);
}

.editing-order-note {
  margin: 8px 0 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 16px;
  color: rgba(255, 255, 255, 0.55);
}

/* Кнопка «У меня есть промокод»: габариты кнопки заказа (64px, 528px,
 * Montserrat 16/500), чёрный фон — вторичное действие. */
.promo-open-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-height: 62px;
  padding: 12px;
  border: none;
  border-radius: 999px;
  background: #111111;
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
  box-sizing: border-box;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}

.promo-open-btn:active {
  transform: scale(0.985);
}

.promo-open-btn__label {
  letter-spacing: 0.01em;
  white-space: nowrap;
}

/* Модалка ввода: та же строка ввода, что была на карточке. */
.promo-modal-input-row {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid #e6e9ed;
  border-radius: 16px;
  height: 64px;
  padding: 0 10px 0 16px;
  box-sizing: border-box;
  overflow: hidden;
}

/* Предупреждение о блокировке скидочной системы — оформление
 * CompatibilityNotice (каталог расходников): пропорции cqw от ширины
 * модалки, красный градиентный квадрат с треугольником, белый фон. */
.promo-warning {
  --notice-red-start: #e62c20;
  --notice-red-end: #a92520;
  container-type: inline-size;
  width: 100%;
  color: #101010;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
}

.promo-warning,
.promo-warning * {
  box-sizing: border-box;
}

.promo-warning__card {
  display: grid;
  grid-template-columns: 18cqw minmax(0, 1fr);
  align-items: center;
  column-gap: 3.5cqw;
  padding: 4.85cqw 4.7cqw;
  border: 0;
  border-radius: 5.25cqw;
  background: #fff;
}

.promo-warning__icon {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 4cqw;
  background: linear-gradient(110deg, var(--notice-red-start), var(--notice-red-end));
}

.promo-warning__icon svg {
  display: block;
  width: 69%;
  height: 69%;
  overflow: visible;
}

.promo-warning__title {
  margin: 0 0 1.8cqw;
  font-size: 4.35cqw;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.045cqw;
}

.promo-warning__text {
  margin: 0;
  color: #7c818d;
  font-size: 3.77cqw;
  font-weight: 400;
  line-height: 1.19;
  letter-spacing: 0;
}

.promo-error-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 18px;
  color: #dc2626;
  margin: 12px 0 0;
}

.promo-info-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 18px;
  color: #aab2bd;
  margin: 12px 0 0;
}

.promo-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 16px;
  line-height: 19px;
  color: #191919;
  background: transparent;
}

.promo-input::placeholder {
  color: #aab2bd;
}

.promo-apply-btn {
  width: 112px;
  height: 44px;
  padding: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  background: linear-gradient(98.83deg, #f50302 0%, #c20b0c 119.75%);
  border: none;
  border-radius: 528px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 17px;
  color: #f5f7fa;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.promo-apply-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.promo-apply-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.promo-applied-row {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid #e6e9ed;
  border-radius: 16px;
  height: 64px;
  padding-left: 16px;
}

/* Чип применённого кода внутри модалки: с зелёной обводкой. */
.promo-applied-row--modal {
  border-color: #34c759;
}

.promo-applied-info {
  flex: 1;
}

.promo-input-label {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: #aab2bd;
  display: block;
}

.promo-code-display {
  display: flex;
  align-items: center;
  gap: 6px;
}

.promo-code-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
  color: #34c759;
}

/* «Убрать промокод» в модалке: на всю ширину, как остальные
 * вторичные кнопки модалок корзины. */
.promo-remove-btn {
  width: 100%;
  min-height: 48px;
  padding: 12px 18px;
  border: 1px solid #e6e9ed;
  border-radius: 528px;
  background: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 14px;
  line-height: 18px;
  color: #191919;
  cursor: pointer;
  box-sizing: border-box;
}

.promo-remove-btn:active:not(:disabled) {
  background: #f0f2f5;
}

.promo-remove-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.promo-discount-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 13px;
  line-height: 16px;
  color: #34c759;
  margin: 0;
}

.loyalty-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}

.loyalty-card {
  position: relative;
  overflow: hidden;
  padding: 22px 24px 20px;
  border-radius: 32px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  box-shadow: 0 8px 16px rgba(97, 1, 0, 0.16);
}

.loyalty-card--checkout {
  min-height: 0;
}

/* Заморозка бонусной карты на чекауте: лёд-оверлей поверх карточки */
.loyalty-card--frozen.loyalty-card--checkout > .loyalty-card-header,
.loyalty-card--frozen.loyalty-card--checkout > .loyalty-available-list,
.loyalty-card--frozen.loyalty-card--checkout > .loyalty-rules-link {
  opacity: 0.45;
  pointer-events: none;
}

.loyalty-frozen-overlay--checkout {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 20px 24px;
  text-align: center;
  background: linear-gradient(
    106.76deg,
    rgba(28, 70, 190, 0.82) 0%,
    rgba(13, 42, 130, 0.88) 100%
  );
  backdrop-filter: blur(2px);
}

.loyalty-frozen-icon--checkout {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 2px;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.loyalty-frozen-overlay--checkout .loyalty-frozen-title {
  margin: 0;
  color: #ffffff;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 800;
  font-size: 15px;
  line-height: 1.25;
}

.loyalty-frozen-overlay--checkout .loyalty-frozen-date {
  margin: 0;
  color: #ffffff;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 800;
  font-size: 17px;
}

.loyalty-frozen-overlay--checkout .loyalty-frozen-note {
  margin: 3px 0 0;
  color: rgba(255, 255, 255, 0.78);
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 11px;
  line-height: 1.4;
}

.loyalty-card-header,
.loyalty-available-list,
.loyalty-rules-link,
.loyalty-line-list {
  position: relative;
  z-index: 1;
}

.loyalty-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}

.loyalty-card-title-main {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #ffffff;
}

.loyalty-available-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.loyalty-available-category {
  padding: 12px 14px;
  border-radius: 17px;
  background: rgba(255, 255, 255, 0.12);
}

.loyalty-available-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.loyalty-available-copy {
  min-width: 0;
  flex: 1 1 auto;
}

.loyalty-available-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  line-height: 18px;
  font-weight: 700;
  color: #ffffff;
}

.loyalty-available-discount {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 15px;
  color: rgba(255, 255, 255, 0.82);
}

.loyalty-line-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.loyalty-line-list--choices {
  gap: 8px;
  margin-top: 10px;
}

.loyalty-line-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.12);
}

.loyalty-line-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}

.loyalty-line-title {
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}

.loyalty-line-action {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex: 0 0 auto;
  min-width: 112px;
}

.loyalty-line-button {
  min-width: 104px;
  min-height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  padding: 0 14px;
  font-family: "Montserrat", sans-serif;
  font-size: 13px;
  line-height: 16px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
}

.loyalty-line-button:active {
  transform: scale(0.98);
}

.loyalty-line-button:disabled {
  cursor: default;
  opacity: 0.65;
  transform: none;
}

.loyalty-line-button--applied {
  background: #ffffff;
  border-color: #ffffff;
  color: #c41515;
}

.loyalty-line-state {
  display: inline-flex;
  max-width: 112px;
  justify-content: flex-end;
  text-align: right;
  font-size: 12px;
  line-height: 14px;
  color: rgba(255, 255, 255, 0.72);
}

.loyalty-rules-link {
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: #ffffff;
  cursor: pointer;
}

.loyalty-rules-link--static {
  margin-top: 16px;
}

.loyalty-rules-link svg {
  flex-shrink: 0;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 0 8px;
}

.summary-label {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 17px;
  color: #aab2bd;
}

.summary-discount {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 17px;
  color: #aab2bd;
}

/* Незабранный заказ: строка над итого — Lottie-восклицание слева,
   заголовок; дата и «подробнее» В ОДНУ строку (без разделения),
   сумма справа (как итого). */
.unclaimed-block {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 0;
}

.unclaimed-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.unclaimed-title {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 600;
  font-size: 13px;
  line-height: 16px;
  color: #18191b;
}

/* Дата и «подробнее» одной строкой. */
.unclaimed-date {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: #8a93a0;
}

/* «подробнее» — цвет и шрифт «посмотреть отзывы» (#0273f5). */
.unclaimed-details {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: #0273f5;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.unclaimed-details:active {
  opacity: 0.72;
}

.unclaimed-amount {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 15px;
  line-height: 18px;
  color: #18191b;
  white-space: nowrap;
}

/* Модалка незабранного заказа. */
.unclaimed-modal-text {
  margin: 0 0 10px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 20px;
  color: #18191b;
}

.unclaimed-modal-hint {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 18px;
  color: #656b75;
}

/* Способ оплаты по референсу: две компактные 3D-иконки перед итогом. */
.payment-note {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: 4px 12px 0;
  padding-block: 4px;
}

.payment-note__mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
}

/* Стикер «Heavy Dollar Sign» в слоте 26×26: строка «Способ оплаты»
   держит постоянную высоту, пока Lottie проигрывает анимацию. */
.payment-note__dollar {
  width: 26px;
  height: 26px;
}

.payment-note__label {
  align-self: center;
  margin-left: -2px;
  color: #25262a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.23;
}

/* Кнопка «Картой» в своей ячейке группы выбора. */
.payment-note__card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

/* Плашка ошибки карты по демо-образцу navalivay-card-limit-popover:
   тёмная капсула #5d5c65 с хвостиком-стрелкой к кнопке «Картой»,
   заголовок + пояснение, справа кнопка закрытия с кольцом-таймером.
   Плашка отрендерена через Teleport в body (карточка заказа режет
   контент overflow:hidden), позиция задаётся inline: fixed-координаты
   пересчитываются от кнопки при показе, скролле и ресайзе. */
.payment-note__popover {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: center;
  gap: 9px;
  padding: 11px 10px 11px 13px;
  border-radius: 16px;
  background: #5d5c65;
  color: #ffffff;
  box-shadow: 0 10px 26px #1d1e2936;
  z-index: 9000;
}

/* Хвостик-стрелка, указывающий на кнопку «Картой» сверху. */
.payment-note__popover::before {
  content: "";
  position: absolute;
  right: var(--popover-arrow-from-right, 29px);
  top: -5px;
  width: 10px;
  height: 10px;
  background: inherit;
  transform: rotate(45deg);
}

.payment-note__popover-copy {
  min-width: 0;
}

.payment-note__popover-copy strong {
  display: block;
  font-family: "Montserrat", sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
}

.payment-note__popover-copy p {
  margin: 4px 0 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
}

.payment-note__popover-close {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  background: none;
  color: #ffffff;
  cursor: pointer;
  border-radius: 50%;
  -webkit-tap-highlight-color: transparent;
}

.payment-note__popover-close:active {
  opacity: 0.7;
}

.payment-note__popover-close:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}

.payment-note__popover-close svg {
  width: 40px;
  height: 40px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

/* Кольцо-таймер: дотает за время жизни плашки (r=17 → длина 106.814). */
.payment-note__popover-track {
  opacity: 0.23;
}

.payment-note__popover-ring {
  stroke-dasharray: 106.814;
  animation: payment-note-countdown var(--duration, 7s) linear both;
}

@keyframes payment-note-countdown {
  to {
    stroke-dashoffset: 106.814;
  }
}

/* Появление/исчезание плашки: выезжает снизу вверх,
   закрывается мягко — тем же движением вниз и медленным fade. */
.payment-note-pop-enter-active {
  transition: opacity 0.16s ease, transform 0.22s ease;
}

.payment-note-pop-leave-active {
  transition: opacity 0.28s ease, transform 0.26s ease;
}

.payment-note-pop-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.payment-note-pop-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

/* Появление и закрытие — только через Vue Transition (keyframes больше
   не нужны): появление снизу вверх, закрытие — мягкий уход вниз с fade. */

@media (prefers-reduced-motion: reduce) {
  .payment-note__popover-ring {
    animation-duration: 0.01ms;
  }

  .payment-note__popover,
  .payment-note-pop-enter-active,
  .payment-note-pop-leave-active {
    animation: none;
    transition: none;
  }
}

.payment-note__choices {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 0;
  padding: 2px;
  border-radius: 12px;
  background: #f6f7f8;
  isolation: isolate;
}

.payment-note__selection {
  position: absolute;
  z-index: -1;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(50% - 2px);
  border-radius: 9px;
  background: linear-gradient(105deg, #f80008, #ad1010);
  box-shadow: 0 2px 8px #c715152b;
  transition: transform 0.22s ease, opacity 0.16s ease;
}

.payment-note__selection--cash {
  transform: translateX(0);
}

.payment-note__selection--card {
  transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
  .payment-note__selection {
    transition: none;
  }
}

.payment-note__choice {
  display: grid;
  place-items: center;
  width: 68px;
  min-width: 68px;
  min-height: 56px;
  padding: 3px;
  border: 2px solid transparent;
  border-radius: 11px;
  background: transparent;
  color: #23242a;
  cursor: pointer;
  transition: box-shadow 0.18s ease, background 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.payment-note__choice img {
  display: block;
  width: 50px;
  height: 42px;
  object-fit: contain;
  transition: filter 0.18s ease, transform 0.18s ease;
}

.payment-note__choice--card img {
  width: 59px;
  height: 46px;
  transform: rotate(-8deg) scale(1.16);
}

.payment-note__choice--selected {
  background: transparent;
  box-shadow: none;
}

.payment-note__choice--selected img {
  filter: grayscale(1) brightness(2.6) contrast(0.72) brightness(1.12)
    drop-shadow(0 0 2px #ffffffba) drop-shadow(0 0 4px #ffffff70);
}

.payment-note__choice--blocked {
  opacity: 0.52;
  filter: grayscale(0.35);
}

.payment-note__choice--blocked:hover {
  opacity: 0.62;
}

.payment-note__choice:focus-visible {
  outline: 2px solid #286bf0;
  outline-offset: 2px;
}

.total-value-with-payment {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0;
  min-width: 0;
  white-space: nowrap;
}

.total-payment-label {
  display: block;
  width: max-content;
  padding-left: 0.28em;
  /* Как у суммы: подпись способа оплаты — часть той же строки итога,
     поэтому начертание и кегль совпадают с .total-amount. */
  color: inherit;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 19px;
  line-height: 23px;
  opacity: 1;
}

.total-payment-label__text {
  display: inline-block;
}

/* Смена способа оплаты: старая подпись уезжает вверх и гаснет,
   новая поднимается снизу — без дёрганья суммы слева. */
.total-payment-swap-enter-active,
.total-payment-swap-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.total-payment-swap-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.total-payment-swap-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

@media (max-width: 320px) {
  .payment-note {
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 3px;
    margin-inline: 4px;
  }

  .payment-note__choice {
    width: 54px;
    min-width: 54px;
    min-height: 52px;
  }

  .payment-note__choice img {
    width: 42px;
    height: 38px;
  }

  .payment-note__choice--card img {
    width: 48px;
    height: 40px;
  }
}

@media (max-width: 360px) {


  .payment-note__choice {
    width: 58px;
    min-width: 58px;
  }

  .payment-note__choice img {
    width: 46px;
  }

  .payment-note__choice--card img {
    width: 52px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .payment-note__choice,
  .payment-note__choice img,
  .total-payment-swap-enter-active,
  .total-payment-swap-leave-active {
    transition: none;
  }
}

/* Итого внутри карточки заказа: без полосы между предупреждением
   о незабранном заказе и итоговой суммой. */
.total-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 12px 13px;
  border-top: 0;
}

.total-label {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 15px;
  line-height: 18px;
  color: #656b75;
}

.total-amount {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 19px;
  line-height: 23px;
  color: #18191b;
}

.submit-button {
  width: 100%;
  min-height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(100deg, #e32d18 0%, #982119 100%);
  border: none;
  border-radius: 999px;
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  color: #ffffff;
  cursor: pointer;
  position: relative;
  z-index: 10;
  padding: 12px;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  /* Плавное изменение прозрачности: без перехода любой кратковременный
     disabled (сверка статуса карты) выглядел как резкое мигание. */
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.submit-button:hover:not(:disabled) {
  opacity: 0.95;
}

.submit-button:active:not(:disabled) {
  opacity: 0.9;
  transform: scale(0.98);
}

.submit-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

.submit-error {
  padding: 12px 16px;
  background: #fee2e2;
  border-radius: 12px;
  font-size: 14px;
  color: #dc2626;
  text-align: center;
}

.user-info-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 24px 16px;
}

.user-info-label {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
  margin: 0 0 16px;
}

.user-info-input-row {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid #e6e9ed;
  border-radius: 16px;
  height: 64px;
  padding: 0 16px;
  box-sizing: border-box;
}

.user-info-input-row:focus-within {
  border-color: #2563eb;
  outline: 2px solid rgba(37, 99, 235, 0.1);
  outline-offset: -2px;
}

.user-info-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 16px;
  line-height: 19px;
  color: #191919;
  background: transparent;
}

.user-info-input::placeholder {
  color: #aab2bd;
}

.user-info-error {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 18px;
  color: #dc2626;
  margin: 12px 0 0;
}

.user-info-card-warning {
  border: 1px solid #fdba74;
  background: #fff7ed;
}

.username-warning-text,
.username-modal-text,
.username-modal-hint {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 20px;
  color: #7c2d12;
  margin: 0;
}

.username-warning-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.username-warning-primary,
.username-warning-secondary {
  width: 100%;
  min-height: 52px;
  border-radius: 16px;
  padding: 14px 18px;
  font-family: "Montserrat", sans-serif;
  font-weight: 600;
  font-size: 14px;
  line-height: 18px;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.username-warning-primary:disabled,
.username-warning-secondary:disabled {
  opacity: 0.6;
  cursor: wait;
}

.username-warning-primary {
  border: none;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  color: #ffffff;
}

.username-warning-secondary {
  border: 1px solid #fdba74;
  background: #ffffff;
  color: #9a3412;
}

.username-warning-primary:hover,
.username-warning-secondary:hover {
  opacity: 0.95;
}

.username-warning-primary:active,
.username-warning-secondary:active {
  transform: scale(0.99);
}

.checkout-modal-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: #191919;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
}

.checkout-modal-copy p {
  margin: 0;
}

.checkout-modal-list {
  margin: 0;
  padding-left: 20px;
}

.checkout-modal-list li + li {
  margin-top: 10px;
}

.checkout-modal-cta {
  width: 100%;
  min-height: 64px;
  border: none;
  border-radius: 528px;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
}

.checkout-modal-cta:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.card-payment-choice {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.card-payment-choice button {
  min-height: 48px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
  color: #30343b;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.card-payment-choice--active {
  color: #fff !important;
  border-color: #f50302 !important;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%) !important;
}

/* ===== Виджет оплаты картой =====
   Лимит на заказ, состояние (пауза со шкалой / исчерпано / разрешено)
   и быстрые действия. Показывается при выборе «Картой». */
.card-widget {
  margin-top: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  background: #ffffff;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-widget__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.card-widget__badge {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  background: linear-gradient(110deg, #f50302 0%, #a90f0e 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 14px rgba(245, 3, 2, 0.22);
}

.card-widget__limit {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.card-widget__limit-value {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 15.5px;
  line-height: 20px;
  color: #191919;
}

.card-widget__limit-note {
  font-size: 12.5px;
  line-height: 16px;
  color: #687582;
}

.card-widget__state {
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-widget__state--ok {
  background: -webkit-linear-gradient(90deg, #00ff02, #07c100); /* Chrome 10-25, Safari 5.1-6 */
  background: linear-gradient(90deg, #00ff02, #07c100); /* W3C, IE 10+/ Edge, Firefox 16+, Chrome 26+, Opera 12+, Safari 7+ */
  border: none;
}

.card-widget__state--pause {
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  border: none;
}

.card-widget__state--blocked {
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  border: none;
}

.card-widget__state-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-widget__state-row strong {
  font-size: 14px;
  font-weight: 650;
  line-height: 1.25;
  color: #ffffff;
}

.card-widget__state--pause .card-widget__state-copy,
.card-widget__state--blocked .card-widget__state-copy,
.card-widget__state--ok .card-widget__state-copy {
  color: rgba(255, 255, 255, 0.92);
}

.card-widget__state-dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f59e0b;
}

.card-widget__state-dot--ok {
  background: #ffffff;
}

/* Дата следующей доступной оплаты — всегда отдельной строкой. */
.card-widget__state-date {
  display: block;
  margin-top: 3px;
  font-size: 13.5px;
  font-weight: 650;
  color: #ffffff;
}

/* Белый восклицательный знак в круге для недоступных состояний. */
.card-widget__state-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.card-widget__state-copy {
  margin: 0;
  font-size: 12.5px;
  line-height: 17px;
  color: #687582;
}

/* Окно «Лимит превышен» при изменении заказа: состояние виджета
   вписано в модалку отступом, чтобы не прижималось к краям. */
.card-edit-limit-state {
  margin: 4px 0 8px;
}

.card-payment-warning {
  color: #a90f0e;
}

.card-payment-modal-actions {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 10px;
}

.checkout-modal-cta--dark {
  background: #191919;
}

@media (max-width: 768px) {
  .header-area {
    border-radius: 0 0 20px 20px;
  }

  .checkout-title {
    font-size: 18px;
    line-height: 22px;
  }
}

@media (max-width: 480px) {
  .header-area {
    border-radius: 0 0 18px 18px;
  }

  .checkout-title {
    font-size: 16px;
    line-height: 20px;
  }
}

@media (max-width: 360px) {
  .checkout-container {
    padding: 0 10px;
  }

  /* Демо: на узких экранах строки компактнее. */
  .cart-item {
    gap: 7px;
    padding-inline: 7px;
  }

  .cart-item-title {
    font-size: 12px;
  }

  .header-area {
    border-radius: 0 0 16px 16px;
  }

  .checkout-title {
    font-size: 15px;
    line-height: 18px;
  }

  .checkout-footer {
    padding-inline: 10px;
  }

  .loyalty-card--checkout {
    padding: 20px 20px 16px;
  }

  .loyalty-available-category {
    padding: 11px 12px;
  }

  .loyalty-line-button {
    min-width: 100px;
    padding-inline: 12px;
  }
}

.fade-btn-enter-active,
.fade-btn-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-btn-enter-from,
.fade-btn-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
