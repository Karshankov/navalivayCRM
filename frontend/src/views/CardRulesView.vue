<template>
  <div class="card-rules-page">
    <header class="card-rules-header">
      <button type="button" class="card-rules-back" aria-label="Назад" @click="goBack">
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
          <path
            d="M6 1L1 6L6 11"
            stroke="#191919"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h1 class="card-rules-title">Как работает оплата картой</h1>
    </header>

    <main class="card-rules-content">
      <section class="card-rules-card card-rules-card--hero">
        <span class="card-rules-card__icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <rect x="2.5" y="5" width="19" height="14" rx="3" stroke="currentColor" stroke-width="1.8" />
            <path d="M2.5 9.5H21.5" stroke="currentColor" stroke-width="1.8" />
            <path d="M6 15H10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </span>
        <div>
          <h2 class="card-rules-card__title card-rules-card__title--inverted">
            Оплата картой — по разрешению
          </h2>
          <p class="card-rules-card__text card-rules-card__text--inverted">
            Способ включается для аккаунта вручную продавцом. Если карты нет —
            заказ автоматически оформляется за наличные.
          </p>
        </div>
      </section>

      <section class="card-rules-card">
        <h2 class="card-rules-card__title">Лимит на заказ</h2>
        <ul class="card-rules-list">
          <li>Картой можно оплатить заказ <strong>не больше вашего лимита</strong> — например, при лимите 45 BYN максимальный заказ по карте тоже 45 BYN.</li>
          <li>Частичная оплата (часть картой, часть наличными) не предусмотрена: заказ либо целиком в лимите, либо оплачивается наличными.</li>
          <li>Точный лимит показывается в корзине при выборе оплаты картой.</li>
          <li>Лимит поднимается тарифом по заявке — продавец подберёт подходящий.</li>
        </ul>
      </section>

      <section class="card-rules-card">
        <h2 class="card-rules-card__title">Пауза после оплаты</h2>
        <ul class="card-rules-list">
          <li>После выдачи заказа, оплаченного картой, способ уходит на паузу.</li>
          <li>Стандартная пауза — 10 дней; точный срок и дата снятия показываются в корзине.</li>
          <li>На время паузы оплатить картой нельзя, наличные работают как обычно.</li>
        </ul>
      </section>

      <section class="card-rules-card">
        <h2 class="card-rules-card__title">Если лимит исчерпан или карта на паузе</h2>
        <ul class="card-rules-list">
          <li>Выбрать карту в корзине можно — вы увидите лимит и статус паузы.</li>
          <li>Оформить заказ картой в это время нельзя: уберите лишние товары до лимита или оплатите наличными.</li>
        </ul>
      </section>

      <section class="card-rules-card">
        <h2 class="card-rules-card__title">Увеличение лимита</h2>
        <ul class="card-rules-list">
          <li>Хотите больший лимит — отправьте заявку кнопкой «Увеличить лимиты» в корзине.</li>
          <li>Продавец рассматривает заявку вручную и связывается с вами.</li>
          <li>Повторную заявку можно отправить через час после предыдущей.</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();

function goBack() {
  // Исторически кнопка «Назад» вела на страницу лимитов; теперь правила
  // открываются из корзины — возвращаемся туда же.
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push({ name: "checkout" });
  }
}
</script>

<style scoped>
.card-rules-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 24px;
}

.card-rules-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding:
    calc(12px + env(safe-area-inset-top, 0px))
    16px
    12px;
  background: rgba(245, 247, 250, 0.96);
  backdrop-filter: blur(12px);
}

.card-rules-back {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
}

.card-rules-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 18px;
  line-height: 24px;
  color: #191919;
}

.card-rules-content {
  width: min(393px, 100%);
  margin: 0 auto;
  padding: 12px 18px 24px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-rules-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
}

.card-rules-card--hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: linear-gradient(110deg, #f50302 0%, #a90f0e 100%);
  box-shadow: 0 10px 24px rgba(245, 3, 2, 0.24);
}

.card-rules-card__icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.card-rules-card__title {
  margin: 0 0 10px;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 22px;
  color: #191919;
}

.card-rules-card__title--inverted {
  color: #ffffff;
}

.card-rules-card__text {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13.5px;
  line-height: 19px;
  color: #5c6470;
}

.card-rules-card__text--inverted {
  color: rgba(255, 255, 255, 0.92);
}

.card-rules-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-rules-list li {
  position: relative;
  padding-left: 22px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13.5px;
  line-height: 19px;
  color: #5c6470;
}

.card-rules-list li::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f50302;
}

.card-rules-list strong {
  color: #1f2933;
  font-weight: 650;
}
</style>
