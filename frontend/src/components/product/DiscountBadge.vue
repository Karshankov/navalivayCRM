<template>
  <!--
    Плашка «в этой линейке есть скидки». Числа на ней сознательно нет: на
    родительской линейке подешеветь могло что-то во вложенной, и процент с её
    обложки относился бы к товару, которого на этом уровне не видно. Точная
    глубина скидки живёт бейджем рядом с самой позицией.

    Компонент отвечает только за внешний вид. Где плашка стоит, решает тот, кто
    её показывает: на карточке линейки она в потоке, на карточке категории
    прижата к низу картинки.
  -->
  <p class="discount-badge">Скидки</p>
</template>

<style scoped>
.discount-badge {
  margin: 0;
  padding: 4px 12px;
  border-radius: 999px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  font-family: "Montserrat", sans-serif;
  font-weight: 800;
  font-size: 11px;
  line-height: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffffff;
  white-space: nowrap;
}
</style>
