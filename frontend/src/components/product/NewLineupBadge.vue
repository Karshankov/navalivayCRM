<template>
  <!--
    Плашка новинки: бегущая по кругу надпись во всю ширину строки линейки.
    Механика ленты повторяет прокрут выигрышей в рулетке: дорожка содержит два
    одинаковых набора слов и едет ровно на половину своей ширины, поэтому стык
    не виден.

    Роль img делает содержимое презентационным, а вся дорожка спрятана от
    скринридера: иначе он зачитал бы «Новинка» дюжину раз подряд. Название
    остаётся на контейнере.
  -->
  <div class="new-lineup-badge" role="img" aria-label="Новинка">
    <div class="new-lineup-badge__track" aria-hidden="true">
      <span v-for="set in 2" :key="set" class="new-lineup-badge__set">
        <span v-for="word in WORD_COUNT" :key="word" class="new-lineup-badge__word">
          Новинка
        </span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/** Слов в одном наборе: на узком экране в окно попадает три. */
const WORD_COUNT = 6
</script>

<style scoped>
.new-lineup-badge {
  overflow: hidden;
  margin: -16px -16px 12px;
  border-radius: 20px 20px 0 0;
  padding: 7px 0;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  box-shadow: 0 8px 16px rgba(97, 1, 0, 0.16);
}

.new-lineup-badge__track {
  display: flex;
  min-width: 200%;
  animation: new-lineup-marquee 12s linear infinite;
}

/*
  Каждый набор не уже плашки, иначе на широком экране за коротким набором
  тянулась бы пустота: дорожка едет на половину собственной ширины.
*/
.new-lineup-badge__set {
  display: flex;
  flex: 1 0 50%;
  justify-content: space-around;
}

.new-lineup-badge__word {
  padding: 0 14px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 800;
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #ffffff;
  white-space: nowrap;
}

@keyframes new-lineup-marquee {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-50%, 0, 0);
  }
}

@media (max-width: 360px) {
  .new-lineup-badge {
    margin: -14px -14px 12px;
    border-radius: 18px 18px 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .new-lineup-badge__track {
    animation: none;
  }
}
</style>
