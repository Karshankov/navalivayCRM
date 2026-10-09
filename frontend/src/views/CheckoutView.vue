<template>
  <div class="checkout-page" @click="handlePageClick">
    <div class="header-area">
      <div class="checkout-header">
        <button class="checkout-back-button" @click="handleBack" aria-label="Назад">
          <svg
            class="checkout-back-icon"
            width="7"
            height="12"
            viewBox="0 0 7 12"
            fill="none"
          >
            <path
              d="M6 1L1 6L6 11"
              stroke="#191919"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <h1 class="checkout-title">{{ checkoutTitle }}</h1>
        <button
          v-if="cartStore.items.length"
          @click="handleClearCart"
          class="header-trash-btn"
          aria-label="Очистить корзину"
        >
          <svg width="18" height="20" viewBox="0 0 18 20" fill="none">
            <path
              d="M1 5H17M15 5V17C15 18 14 19 13 19H5C4 19 3 18 3 17V5M6 5V3C6 2 7 1 8 1H10C11 1 12 2 12 3V5"
              stroke="#AAB2BD"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="checkout-container">
      <div v-if="!cartStore.items.length" class="empty-cart">
        <div class="empty-cart-icon">🛒</div>
        <p>Корзина пуста</p>
        <button @click="handleBack" class="back-to-shop-btn">
          Вернуться к покупкам
        </button>
      </div>

      <div v-else class="checkout-content">
        <div class="cart-card">
          <div class="cart-items">
            <TransitionGroup name="list" tag="div">
              <div
                v-for="(item, index) in displayedItems"
                :key="item.productId + (item.variantId || '')"
                class="cart-item"
                :class="{
                  'cart-item-border': index < displayedItems.length - 1,
                }"
              >
                <div class="cart-item-image-wrap">
                  <div class="cart-item-image">
                    <img
                      v-if="item.image"
                      :src="item.image"
                      :alt="item.title"
                    />
                    <div v-else class="cart-item-placeholder">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#ccc"
                        stroke-width="1.5"
                      >
                        <rect
                          x="3"
                          y="3"
                          width="18"
                          height="18"
                          rx="2"
                          ry="2"
                        />
                      </svg>
                    </div>
                  </div>
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
                  <p v-if="getItemMetaText(item)" class="cart-item-meta cart-item-meta-info">
                    {{ getItemMetaText(item) }}
                  </p>

                  <!-- <div class="item-badge-new">
                    <svg width="7" height="10" viewBox="0 0 7 10" fill="white">
                      <path d="M4.5 0L0 5.5H3L2.5 10L7 4.5H4L4.5 0Z" />
                    </svg>
                    <span>Новинка</span>
                  </div> -->

                  <p class="cart-item-price">
                    <span v-if="getItemOldTotal(item)" class="cart-item-price-old">
                      {{ formatPrice(getItemOldTotal(item)!) }}
                    </span>
                    {{ formatPrice(item.priceRub * item.quantity) }} BYN
                  </p>
                </div>

                <div class="cart-item-controls">
                  <button
                    @click="incrementQuantity(item.productId, item.variantId)"
                    class="qty-btn"
                    :class="{ 'qty-btn-disabled': !canIncrement(item) }"
                    :disabled="!canIncrement(item)"
                    aria-label="Увеличить количество"
                  >
                    <span>+</span>
                  </button>
                  <div class="qty-value">
                    <span>{{ item.quantity }}</span>
                  </div>
                  <button
                    @click="decrementQuantity(item.productId, item.variantId)"
                    class="qty-btn"
                    aria-label="Уменьшить количество"
                  >
                    <span>−</span>
                  </button>
                </div>
              </div>
            </TransitionGroup>
          </div>
        </div>

        <button
          v-if="cartStore.items.length > 1"
          @click="toggleItemsExpanded"
          class="toggle-items-btn"
        >
          <span>{{
            isItemsExpanded ? "Скрыть товары" : "Показать товары"
          }}</span>
          <span class="toggle-count">{{ cartStore.items.length }}</span>
        </button>

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
            Минимальная сумма заказа - {{ wholesaleStore.minOrderAmount.toFixed(0) }} BYN.
            <template v-if="wholesaleRemainingAmount > 0">
              Не хватает {{ wholesaleRemainingAmount.toFixed(2) }} BYN.
            </template>
            <template v-else>
              Минимум выполнен, можно оформлять заказ.
            </template>
          </p>
        </div>

        <div class="promo-card" :class="{ 'promo-card-applied': promoResult, 'promo-card-error': promoError }">
          <label class="promo-label" for="checkout-promo-code">
            {{ wholesaleStore.isWholesale ? 'Есть промокод на подарок?' : 'Есть промокод?' }}
          </label>

          <div v-if="!promoResult" class="promo-input-row">
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
              @keydown.enter="handlePromoApply"
              @input="promoError = ''"
            />
            <button
              class="promo-apply-btn"
              :disabled="!promoCode.trim() || promoValidating"
              @click="handlePromoApply"
            >
              {{ promoValidating ? '...' : 'Применить' }}
            </button>
          </div>

          <div v-else class="promo-applied-row">
            <div class="promo-applied-info">
              <span class="promo-input-label">Промокод</span>
              <div class="promo-code-display">
                <span class="promo-code-text">{{ promoCode.toUpperCase() }}</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7L5.5 10.5L12 3.5" stroke="#34c759" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </div>
            <button class="promo-cancel-btn" @click="handlePromoClear">Убрать</button>
          </div>

          <p
            v-if="promoError"
            id="checkout-promo-error"
            class="promo-error-text"
            role="alert"
          >
            {{ promoError }}
          </p>

          <p v-if="promoResult" class="promo-discount-text">
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
        </div>

        <div v-if="!wholesaleStore.isWholesale && promoResult" class="summary-row">
          <span class="summary-label">Скидка по промокоду</span>
          <span class="summary-discount">-{{ formatPrice(promoResult.calculated_discount) }} BYN</span>
        </div>

        <section
          v-if="!wholesaleStore.isWholesale && availableCheckoutLoyaltyCategories.length"
          class="loyalty-section"
        >
          <article class="loyalty-card loyalty-card--checkout">
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
                      :disabled="loyaltyStore.loadingPreview"
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
          <span>{{ wholesaleStore.minOrderAmount.toFixed(0) }} BYN</span>
        </div>

        <div v-if="wholesaleStore.isWholesale && wholesaleRemainingAmount > 0" class="summary-row">
          <span class="summary-label">Осталось добрать</span>
          <span>{{ wholesaleRemainingAmount.toFixed(2) }} BYN</span>
        </div>

        <div v-if="!wholesaleStore.isWholesale && loyaltyDiscountAmount > 0" class="summary-row">
          <span class="summary-label">Скидка за покупки</span>
          <span class="summary-discount">-{{ formatPrice(loyaltyDiscountAmount) }} BYN</span>
        </div>

        <div class="total-block">
          <span class="total-label">Итого</span>
          <span class="total-amount"
            >{{ formatPrice(finalTotal) }} BYN</span
          >
        </div>

        <CheckoutAgreements
          v-if="!isEditingOrder"
          v-model="acceptedAgreementIds"
          :missing-ids="missingAgreementIds"
          @loaded="onAgreementsLoaded"
        />

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
          v-else-if="requiresTelegramUsername"
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

        <button
          @click="beginCheckout"
          :disabled="isSubmitting || isCheckingCardPaymentStatus || checkoutCalculationPending || isWholesaleSubmitBlocked || shouldShowOpenInTelegramForWholesale"
          class="submit-button"
          type="button"
          style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
        >
          {{ submitButtonLabel }}
        </button>

        <div v-if="submitError" class="submit-error">{{ submitError }}</div>
      </div>
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

    <CustomerModalShell
      :open="showCardPaymentModal"
      title="Как хотите оплатить заказ?"
      close-label="Закрыть окно"
      @close="showCardPaymentModal = false"
    >
      <div class="checkout-modal-copy">
        <div class="card-payment-choice">
          <button
            type="button"
            :class="{ 'card-payment-choice--active': selectedPaymentMethod === 'cash' }"
            @click="selectedPaymentMethod = 'cash'"
          >Наличными</button>
          <button
            type="button"
            :class="{
              'card-payment-choice--active': selectedPaymentMethod === 'card',
              'card-payment-choice--disabled': isCardPaused || cardOrderExceedsDailyMinor,
            }"
            :disabled="isCardPaused || cardOrderExceedsDailyMinor"
            :title="isCardPaused ? 'Оплата картой на паузе'
              : cardOrderExceedsDailyMinor ? 'Заказ превышает дневной лимит оплаты картой' : undefined"
            @click="selectCardPayment"
          >Картой</button>
        </div>
        <div
          v-if="cardOrderExceedsDailyMinor"
          class="card-status-card card-status-card--unavailable"
          role="alert"
        >
          <span class="card-status-dot" aria-hidden="true" />
          <div class="card-status-info">
            <strong>Заказ больше дневного лимита по карте</strong>
            <span>
              Остаток на сегодня — {{ formatCardMoney(remainingDailyCardLimitMinor) }} BYN,
              заказ превышает его на {{ formatCardMoney(cardOrderExceededByMinor) }} BYN.
              Оплатите заказ наличными или уменьшите корзину.
            </span>
          </div>
        </div>
        <template v-if="selectedPaymentMethod === 'card'">
          <div
            v-if="cardCooldownDaysLeft !== null"
            class="card-status-card card-status-card--waiting"
            role="status"
          >
            <span class="card-status-dot" aria-hidden="true" />
            <div class="card-status-info">
              <strong>Карта доступна через {{ cardCooldownDaysLeft }}</strong>
              <span>Пауза после прошлой покупки</span>
            </div>
          </div>
          <div
            v-else-if="isSharedCardLimitExhausted"
            class="card-status-card card-status-card--unavailable"
            role="alert"
          >
            <span class="card-status-dot" aria-hidden="true" />
            <div class="card-status-info">
              <strong>Общий лимит на день по карте исчерпан</strong>
              <span>Заказ можно оплатить наличными</span>
            </div>
          </div>
          <div
            v-else-if="cardMonthlyRemainingMinor <= 0"
            class="card-status-card card-status-card--unavailable"
            role="status"
          >
            <span class="card-status-dot" aria-hidden="true" />
            <div class="card-status-info">
              <strong>Месячный лимит по карте исчерпан</strong>
              <span>Обновится в следующем месяце</span>
            </div>
          </div>
          <div v-else-if="cardPaymentStatus?.enabled" class="card-status-card" role="status">
            <span class="card-status-dot card-status-dot--ok" aria-hidden="true" />
            <div class="card-status-info">
              <strong>Оплата картой доступна</strong>
              <span>{{ formatCardMoney(cardMonthlyRemainingMinor) }} BYN осталось в этом месяце</span>
            </div>
            <div class="card-status-limit" :data-level="cardLimitLevel">
              <div class="card-status-limit-bar">
                <span :style="{ width: cardMonthlyProgressPercent + '%' }" :data-level="cardLimitLevel" />
              </div>
              <em>лимит {{ formatCardMoney(cardMonthlyLimitMinor) }} BYN</em>
            </div>
          </div>
        </template>
        <p v-if="submitError" class="card-payment-warning" role="alert">
          {{ submitError }}
        </p>
      </div>
      <template #footer>
        <div class="card-payment-modal-actions">
          <button
            v-if="selectedPaymentMethod === 'card'"
            type="button"
            class="checkout-modal-cta checkout-modal-cta--dark"
            @click="openCardTariffs"
          >Увеличить лимит</button>
          <button
            type="button"
            class="checkout-modal-cta"
            :disabled="isSubmitting || isCheckingCardPaymentStatus || (selectedPaymentMethod === 'card' && (isSharedCardLimitExhausted || cardOrderExceedsDailyMinor))"
            @click="submitOrder(selectedPaymentMethod)"
          >Оформить заказ</button>
        </div>
      </template>
    </CustomerModalShell>

    <CustomerModalShell
      :open="showMixedPaymentNotice"
      title="Заказ изменён"
      close-label="Закрыть окно"
      @close="finishMixedPaymentNotice"
    >
      <div class="checkout-modal-copy">
        <p role="status">{{ mixedPaymentNotice }}</p>
      </div>
      <template #footer>
        <button
          type="button"
          class="checkout-modal-cta"
          @click="finishMixedPaymentNotice"
        >Перейти к заказу</button>
      </template>
    </CustomerModalShell>

    <CustomerModalShell
      :open="showCardTariffsModal"
      title="Увеличение лимита"
      close-label="Закрыть окно"
      @close="showCardTariffsModal = false"
    >
      <div class="checkout-modal-copy">
        <p>Выберите тариф и отправьте заявку. С вами свяжутся для обработки.</p>
        <label v-for="tariff in cardTariffs" :key="tariff.id" class="card-tariff-option">
          <input v-model="selectedCardTariff" type="radio" :value="tariff.id">
          <span>
            <strong>{{ tariff.title }}</strong>
            <small>Лимит {{ (tariff.limit_minor / 100).toFixed(2) }} BYN · {{ tariff.transition_cost_text }}</small>
          </span>
        </label>
        <p v-if="cardRequestSuccess" role="status">Ваша заявка принята, с вами свяжутся.</p>
        <p v-if="cardRequestError" class="card-payment-warning" role="alert">{{ cardRequestError }}</p>
      </div>
      <template #footer>
        <button
          type="button"
          class="checkout-modal-cta"
          :disabled="!selectedCardTariff || cardRequestSending || Boolean(cardPaymentStatus?.request_cooldown_until)"
          @click="submitCardLimitRequest"
        >{{ cardRequestSuccess ? 'Готово' : cardRequestSending ? 'Отправляем…' : 'Отправить заявку' }}</button>
      </template>
    </CustomerModalShell>

    <CustomerModalShell
      :open="showUsernameRequiredModal"
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
import { ref, reactive, computed, onMounted, watch } from "vue";
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
import LoyaltyBonusPopup from "@/components/LoyaltyBonusPopup.vue";
import {
  LOYALTY_RULES_MODAL_PARAGRAPHS,
  LOYALTY_RULES_MODAL_TITLE,
} from "@/constants/loyalty";
import CheckoutAgreements from "@/components/checkout/CheckoutAgreements.vue";
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
const telegramUser = ref<TelegramMiniAppUser | null>(null);
const showUsernameRequiredModal = ref(false);
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
const submitError = ref("");

// Соглашения перед заказом. acceptedAgreementIds — список id принятых
// чекбоксов; missingAgreementIds — те, что фронт (или бэк после ответа)
// помечает как непринятые при попытке сабмита (используются для подсветки
// в CheckoutAgreements). loadedAgreements — полный список активных
// соглашений, опубликованный компонентом через @loaded.
const acceptedAgreementIds = ref<number[]>([]);
const missingAgreementIds = ref<number[]>([]);
const loadedAgreements = ref<Array<{ id: number; title: string }>>([]);

const toastMessage = ref("");
const toastType = ref<"info" | "success" | "error">("info");
const toastDuration = ref(3500);
const toastKey = ref(0);

function showToast(message: string, type: "info" | "success" | "error" = "info") {
  toastMessage.value = message;
  toastType.value = type;
  toastKey.value += 1;
}

function onAgreementsLoaded(items: Array<{ id: number; title: string }>) {
  loadedAgreements.value = items;
}

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
const showCardPaymentModal = ref(false);
const selectedPaymentMethod = ref<"cash" | "card">("cash");
const cardPaymentStatus = ref<any>(null);
const isCheckingCardPaymentStatus = ref(false);
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
const cardOrderExceededByMinor = computed(() =>
  Math.max(0, cardOrderTotalMinor.value - remainingDailyCardLimitMinor.value),
);
// Персональный месячный лимит клиента — единственная цифра про деньги,
// которую показываем в чекауте. Общая дневная механика магазина —
// внутренняя информация, клиенту её не показываем.
const cardMonthlyLimitMinor = computed(
  () => Math.max(0, Number(cardPaymentStatus.value?.monthly_limit_minor || 0)),
);
const cardMonthlyRemainingMinor = computed(
  () => Math.max(0, Number(cardPaymentStatus.value?.monthly_remaining_minor || 0)),
);
const cardMonthlyProgressPercent = computed(() => {
  const limit = cardMonthlyLimitMinor.value;
  if (limit <= 0) return 0;
  const remainingPercent = (cardMonthlyRemainingMinor.value / limit) * 100;
  return Math.min(100, Math.max(0, Math.round(remainingPercent)));
});
// Цвет прогресс-бара: >50% зелёный, 20–50% жёлтый, <20% красный.
const cardLimitLevel = computed(() => {
  const percent = cardMonthlyProgressPercent.value;
  if (percent > 50) return "ok";
  if (percent >= 20) return "warn";
  return "low";
});
// Пауза активна прямо сейчас: кнопка «Картой» серая и неактивна.
const isCardPaused = computed(
  () => Boolean(cardPaymentStatus.value?.enabled)
    && Boolean(cardPaymentStatus.value?.cooldown_until)
    && new Date(cardPaymentStatus.value.cooldown_until).getTime() > Date.now(),
);
const cardCooldownDaysLeft = computed(() => {
  const until = cardPaymentStatus.value?.cooldown_until;
  if (!until) return null;
  const milliseconds = new Date(until).getTime() - Date.now();
  if (milliseconds <= 0) return null;
  const days = Math.ceil(milliseconds / 86400000);
  return `${days} ${pluralDays(days)}`;
});

function pluralDays(days: number) {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}
const showMixedPaymentNotice = ref(false);
const mixedPaymentNotice = ref("");
const showCardTariffsModal = ref(false);
const cardTariffs = ref<Array<{ id: string; title: string; limit_minor: number; transition_cost_text: string }>>([]);
const selectedCardTariff = ref("");
const cardRequestSending = ref(false);
const cardRequestSuccess = ref(false);
const cardRequestError = ref("");

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
    return `Доберите еще ${wholesaleRemainingAmount.value.toFixed(2)} BYN`;
  }
  return isEditingOrder.value ? "Сохранить изменения" : "Оформить заказ";
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

const displayedItems = computed(() => {
  if (isItemsExpanded.value || cartStore.items.length <= 1) {
    return cartStore.items;
  }
  return cartStore.items.slice(0, 1);
});

const groupMetaMap = computed(() => {
  const map = new Map<string, string>();
  for (const category of catalogStore.categories) {
    for (const group of category.groups || []) {
      const label = (group.metaLabel ?? "").trim();
      const value = (group.metaValue ?? "").trim();
      const text = label && value ? `${label} ${value}` : (label || value);
      if (text) {
        map.set(group.id, text);
      }
    }
  }
  return map;
});

function getItemMetaText(item: (typeof cartStore.items)[0]): string | null {
  if (!item.groupId) return null;
  return groupMetaMap.value.get(item.groupId) || null;
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

const wholesaleRemainingAmount = computed(() =>
  wholesaleStore.remainingToMinimum(cartStore.totalAmount),
);
const isWholesaleMinimumReached = computed(() =>
  wholesaleStore.meetsMinimum(cartStore.totalAmount),
);
const isWholesaleSubmitBlocked = computed(() =>
  wholesaleStore.isWholesale && cartStore.items.length > 0 && !isWholesaleMinimumReached.value,
);

function checkoutLoyaltyCategoryLabel(category: LoyaltyPreviewCategory) {
  return LOYALTY_CATEGORY_LABELS[category.category_key] || category.title;
}

function toggleItemsExpanded() {
  isItemsExpanded.value = !isItemsExpanded.value;
}

function handlePromoInputDone() {
  promoInputRef.value?.blur();
}

async function handlePromoApply() {
  const code = promoCode.value.trim();
  if (!code || promoValidating.value) return;

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
  await settingsStore.fetchSettings();
  if (!catalogStore.categories.length) {
    const hasGroupItems = cartStore.items.some((item) => item.groupId);
    if (hasGroupItems) {
      await catalogStore.fetchCategories();
    }
  }
  await fetchStockLimits();
  syncTelegramUserData({ trustCurrentUser: true });
  await hydrateEditingOrder();
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
  if (requiresTelegramUsername.value) {
    showUsernameRequiredModal.value = true;
  }
  await loadCardPaymentStatus();
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
    submitError.value = `Для оформления нужно добрать еще ${wholesaleRemainingAmount.value.toFixed(2)} BYN`;
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

async function loadCardPaymentStatus() {
  isCheckingCardPaymentStatus.value = true;
  try {
    const response = await fetch("/api/card-payment/status", {
      headers: withTelegramAuthHeaders(),
    });
    if (!response.ok) return;
    cardPaymentStatus.value = await response.json();
  } catch (error) {
    console.warn("[Checkout] Card payment status unavailable", error);
  } finally {
    isCheckingCardPaymentStatus.value = false;
  }
}

function formatCardMoney(amountMinor: number) {
  return (Number(amountMinor || 0) / 100).toFixed(2);
}

async function selectCardPayment() {
  selectedPaymentMethod.value = "card";
  submitError.value = "";
  await loadCardPaymentStatus();
}

function finishMixedPaymentNotice() {
  showMixedPaymentNotice.value = false;
  void router.push("/my-order");
}

async function beginCheckout() {
  if (isSubmitting.value || isCheckingCardPaymentStatus.value || checkoutCalculationPending.value) return;
  if (showCardPaymentModal.value || showCardTariffsModal.value) return;
  if (requiresTelegramUsername.value) {
    showUsernameRequiredModal.value = true;
    return;
  }
  await loadCardPaymentStatus();
  // Показываем выбор оплаты, если карта вообще включена аккаунту — даже
  // когда карта на паузе: кнопка «Картой» станет серой, а рядом будет
  // написано, через сколько дней пауза снимется (запрос владельца 2026-10-09).
  if (cardPaymentStatus.value?.enabled && !isEditingOrder.value) {
    selectedPaymentMethod.value = "cash";
    showCardPaymentModal.value = true;
    return;
  }
  void submitOrder("cash");
}

async function openCardTariffs() {
  cardRequestError.value = "";
  cardRequestSuccess.value = false;
  showCardPaymentModal.value = false;
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
    showCardPaymentModal.value = true;
  }
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
        showCardPaymentModal.value = true;
        selectedPaymentMethod.value = "cash";
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
        showCardPaymentModal.value = true;
        selectedPaymentMethod.value = "cash";
        submitError.value = result?.message || "Оплата картой сейчас недоступна для вашего аккаунта.";
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
          result.message || "Сумма заказа меньше минимальной для выбранного оптового прайса",
        );
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
    showCardPaymentModal.value = false;
    if (
      wasEditingOrder &&
      Number(result?.cash_due_minor || 0) > 0 &&
      Number(result?.card_amount_minor || 0) > 0
    ) {
      mixedPaymentNotice.value =
        `Лимит оплаты картой использован. Остаток ${(Number(result.cash_due_minor) / 100).toFixed(2)} BYN нужно будет оплатить наличными.`;
      showMixedPaymentNotice.value = true;
      return;
    }
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
.checkout-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 32px;
}

.header-area {
  position: sticky;
  top: 0;
  z-index: 20;
  background: #ffffff;
  backdrop-filter: blur(11.5px);
  border-radius: 0 0 24px 24px;
  padding: 0;
  margin-bottom: 16px;
  box-shadow: 0 4px 32px rgba(170, 178, 189, 0.32);
}

.checkout-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 16px 16px 20px 16px;
  min-height: 56px;
}

.checkout-back-button {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.2s ease;
}

.checkout-back-button:hover {
  background: #f5f7fa;
}

.checkout-back-button:active {
  background: #e6e9ed;
}

.checkout-back-icon {
  flex-shrink: 0;
  width: 7px;
  height: 12px;
}

.checkout-title {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
  margin: 0;
}

.header-trash-btn {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
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

.cart-card {
  background: #ffffff;
  border-radius: 20px;
  overflow: hidden;
}

.cart-items {
  padding: 16px;
}

.cart-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 16px;
}

.cart-item-border {
  border-bottom: 1px solid #e6e9ed;
  margin-bottom: 16px;
}

.cart-item-image-wrap {
  position: relative;
  flex-shrink: 0;
}

.cart-item-image {
  width: 88px;
  height: 104px;
  border: 1px solid #e6e9ed;
  border-radius: 16px;
  overflow: hidden;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cart-item-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.cart-item-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ice-badge {
  position: absolute;
  bottom: 0px;
  right: 0px;
  width: 24px;
  height: 24px;
  background: linear-gradient(90deg, #09b5fd 0%, #00499f 100%);
  box-shadow: 0px 4px 24px rgba(0, 73, 159, 0.12);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.cart-item-info {
  flex: 1;
  min-width: 0;
}

.cart-item-group {
  font-family: "Montserrat", sans-serif;
  font-weight: 600;
  font-size: 12px;
  line-height: 16px;
  color: #2563eb;
  margin: 0 0 2px;
}

.cart-item-title {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
  margin: 0 0 4px;
}

.cart-item-meta {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 17px;
  color: #aab2bd;
  margin: 0 0 8px;
}

.cart-item-meta-info {
  font-weight: 500;
  font-size: 16.8px;
  line-height: 20.2px;
}

.item-badge-new {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  border-radius: 23px;
  margin-bottom: 8px;
}

.item-badge-new span {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 10px;
  line-height: 12px;
  text-transform: uppercase;
  color: #ffffff;
}

.cart-item-price {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
  margin: 0;
}

.cart-item-price-old {
  margin-right: 6px;
  color: #98a2b3;
  opacity: 0.6;
  text-decoration: line-through;
}

.cart-item-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.qty-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  border: none;
  border-radius: 512px;
  cursor: pointer;
  transition: background 0.15s;
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
  font-size: 16px;
  line-height: 19px;
  color: #191919;
}

.qty-value {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border: 1px solid #e6e9ed;
  border-radius: 12px;
}

.qty-value span {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
  color: #191919;
}

.toggle-items-btn {
  width: 100%;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #e6e9ed;
  border-radius: 528px;
  cursor: pointer;
}

.toggle-items-btn:hover {
  background: #fafafa;
}

.toggle-items-btn span:first-child {
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
}

.toggle-count {
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  color: #aab2be;
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

.promo-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 24px 16px;
  transition: border-color 0.2s ease;
  border: 1px solid transparent;
}

.promo-card-applied {
  border-color: #34c759;
}

.promo-card-error {
  border-color: #dc2626;
}

.promo-error-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 18px;
  color: #dc2626;
  margin: 12px 0 0;
}

.promo-label {
  display: block;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
  margin: 0 0 16px;
}

.promo-info-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 18px;
  color: #aab2bd;
  margin: 12px 0 0;
}

.promo-input-row {
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

.promo-cancel-btn {
  margin: 10px;
  padding: 0 20px;
  height: 44px;
  background: #e6e9ed;
  border: none;
  border-radius: 528px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 14px;
  line-height: 17px;
  color: #191919;
  cursor: pointer;
  white-space: nowrap;
}

.promo-discount-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: #34c759;
  margin: 12px 0 0;
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

.total-block {
  display: flex;
  flex-direction: column;
  gap: 0px;
  padding: 0 8px;
  margin-top: 10px;
}

.total-label {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
  margin-bottom: 4px;
}

.total-amount {
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 24px;
  line-height: 29px;
  color: #191919;
}

.submit-button {
  width: 100%;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  border: none;
  border-radius: 528px;
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  color: #ffffff;
  cursor: pointer;
  position: relative;
  z-index: 10;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
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
}

.card-payment-choice--active {
  color: #fff !important;
  border-color: #f50302 !important;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%) !important;
}

.card-payment-choice--disabled {
  color: #b3bcc7 !important;
  background: #f1f3f6 !important;
  border-color: #e5e7eb !important;
  cursor: not-allowed;
}

/* Карточка статуса оплаты картой: одна цифра + прогресс-бар + бейдж.
   Тон: спокоен, без «кричащего» красного (красный — только у бренда-CTA). */
.card-status-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 15px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #f7f8fa;
}

.card-status-card--waiting,
.card-status-card--unavailable {
  background: #fff7ed;
  border-color: #fed7aa;
}

.card-status-dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f59e0b;
}

.card-status-dot--ok {
  background: #22c55e;
}

.card-status-info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.card-status-info strong {
  color: #1f2933;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.2;
}

.card-status-info span {
  color: #687582;
  font-size: 12.5px;
  line-height: 1.3;
}

.card-status-limit {
  flex-shrink: 0;
  width: 108px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-status-limit-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #e6e8ec;
}

.card-status-limit-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.25s ease;
}

/* Уровни остатка лимита: зелёный / жёлтый / красный */
.card-status-limit-bar span[data-level="ok"] {
  background: linear-gradient(90deg, #16a34a, #22c55e);
}

.card-status-limit-bar span[data-level="warn"] {
  background: linear-gradient(90deg, #d97706, #f59e0b);
}

.card-status-limit-bar span[data-level="low"] {
  background: linear-gradient(90deg, #dc2626, #ef4444);
}

.card-status-limit em {
  color: #9aa5b1;
  font-size: 10.5px;
  font-style: normal;
  text-align: right;
}

@media (max-width: 380px) {
  .card-status-card {
    flex-wrap: wrap;
  }

  .card-status-limit {
    width: 100%;
  }

  .card-status-limit em {
    text-align: left;
  }
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

.card-tariff-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
}

.card-tariff-option span {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-tariff-option small {
  color: #6b7280;
}

@media (max-width: 768px) {
  .header-area {
    border-radius: 0 0 20px 20px;
  }

  .checkout-header {
    padding: 14px 14px 18px 14px;
    min-height: 52px;
  }

  .checkout-back-button {
    left: 14px;
    width: 30px;
    height: 30px;
  }

  .header-trash-btn {
    right: 14px;
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

  .checkout-header {
    padding: 12px 12px 16px 12px;
    min-height: 48px;
  }

  .checkout-back-button {
    left: 12px;
    width: 28px;
    height: 28px;
  }

  .header-trash-btn {
    right: 12px;
  }

  .checkout-title {
    font-size: 16px;
    line-height: 20px;
  }
}

@media (max-width: 360px) {
  .checkout-container {
    padding: 0 12px;
  }

  .cart-item-image {
    width: 72px;
    height: 88px;
  }

  .cart-item-title {
    font-size: 14px;
  }

  .cart-item-price {
    font-size: 18px;
  }

  .qty-btn,
  .qty-value {
    width: 36px;
    height: 36px;
  }

  .checkout-back-button {
    left: 10px;
    width: 26px;
    height: 26px;
  }

  .checkout-back-icon {
    width: 6px;
    height: 10px;
  }

  .header-area {
    border-radius: 0 0 16px 16px;
  }

  .checkout-header {
    padding: 10px 10px 14px 10px;
    min-height: 44px;
  }

  .header-trash-btn {
    right: 10px;
  }

  .checkout-title {
    font-size: 15px;
    line-height: 18px;
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
