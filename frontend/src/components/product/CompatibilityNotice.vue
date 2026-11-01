<template>
  <!-- Плашка консультации: точный перенос compatibility-notice.html.
       Закрепляется над списком линеек категории расходников. -->
  <section class="compatibility-notice" aria-labelledby="compatibility-notice-title">
    <div class="compatibility-notice__card">
      <div class="compatibility-notice__icon" aria-hidden="true">
        <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M60 15Q64 8 68 15L118 104Q122 112 113 112H15Q6 112 10 104Z"
            stroke="white" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M64 48V76" stroke="white" stroke-width="9" stroke-linecap="round" />
          <circle cx="64" cy="93" r="5" fill="white" />
        </svg>
      </div>
      <div class="compatibility-notice__content">
        <h2 class="compatibility-notice__title" id="compatibility-notice-title">Сначала уточните у нас</h2>
        <p class="compatibility-notice__text">Не обмениваем неподходящие расходники, выбранные без консультации. Сомневаетесь — напишите нам.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* КОМПОНЕНТ из макета: размеры пропорциональны ширине (cqw).
   При ширине 370px: квадрат 84px, заголовок 16px, текст 14px. */
.compatibility-notice {
  --notice-red-start: #e62c20;
  --notice-red-end: #a92520;
  --notice-title: #101010;
  --notice-text: #7c818d;
  container-type: inline-size;
  width: 100%;
  color: var(--notice-title);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

.compatibility-notice,
.compatibility-notice :deep(*) {
  box-sizing: border-box;
}

.compatibility-notice__card {
  display: grid;
  grid-template-columns: 22.8cqw minmax(0, 1fr);
  align-items: center;
  column-gap: 3.5cqw;
  padding: 4.85cqw 4.7cqw;
  border: 0;
  border-radius: 5.25cqw;
  background: #fff;
}

.compatibility-notice__icon {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 4cqw;
  background: linear-gradient(110deg, var(--notice-red-start), var(--notice-red-end));
}

.compatibility-notice__icon svg {
  display: block;
  width: 69%;
  height: 69%;
  overflow: visible;
}

.compatibility-notice__title {
  margin: 0 0 1.8cqw;
  font-size: 4.35cqw;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.045cqw;
}

.compatibility-notice__text {
  margin: 0;
  color: var(--notice-text);
  font-size: 3.77cqw;
  font-weight: 400;
  line-height: 1.19;
  letter-spacing: 0;
}
</style>
