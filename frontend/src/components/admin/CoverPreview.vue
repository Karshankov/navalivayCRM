<template>
  <!-- Редактор обложки.
       Работают в окне, а смотрят на карточку: окно крупное, чтобы точно
       двигать, карточка — чтобы видеть результат у клиента. Обе берут
       один кадр из одного состояния, поэтому расходятся не могут. -->
  <div class="cover-preview">
    <!-- Окно: то же соотношение сторон, что у области фото в карточке.
         Всё, что внутри синей рамки, попадёт в карточку; за рамкой —
         запас, который обрежется. -->
    <div class="cover-editor" data-test="cover-editor">
      <div class="cover-editor__head">
        <span class="cover-editor__title">Кадр крупным планом</span>
        <span class="cover-editor__note">
          <template v-if="!touched">Тяните фото мышью.</template>
          В синей рамке — то, что увидит клиент
        </span>
      </div>

      <div class="cover-editor__body">
        <div class="cover-editor__stage">
          <div
            class="cover-editor__viewport"
            :class="{ 'cover-editor__viewport--dragging': dragging }"
            data-test="cover-viewport"
            @pointerdown="startDrag"
            @pointermove="onDrag"
            @pointerup="endDrag"
            @pointercancel="endDrag"
            @wheel.prevent="onWheel"
          >
            <!-- Слой фото: увеличен, сдвинут и обрезан рамкой окна. -->
            <div class="cover-editor__canvas">
              <ImageFade
                :src="src"
                :alt="alt"
                :zoom="zoom / 100"
                :shift-x="shiftX"
                :shift-y="shiftY"
                manual
              />
            </div>
          </div>
        </div>

        <div class="cover-editor__controls">
          <label class="cover-editor__control">
            <span class="cover-editor__control-label">
              Размер <b>{{ zoom }}%</b>
            </span>
            <input
              :value="zoom"
              type="range"
              min="60"
              max="400"
              step="5"
              class="cover-editor__slider"
              data-test="cover-zoom"
              @input="onZoomInput"
            />
          </label>

          <div class="cover-editor__position">
            <span class="cover-editor__control-label">Положение</span>
            <!-- Точное положение стрелками: мышь даёт грубо, а тут ровный
                 шаг. Кнопки нужны и для доступности с клавиатуры. -->
            <div class="cover-editor__nudge">
              <button
                v-for="dir in nudgeDirections"
                :key="dir.key"
                type="button"
                class="cover-editor__nudge-button"
                :data-test="`cover-nudge-${dir.key}`"
                :aria-label="dir.label"
                :title="dir.label"
                @click="nudge(dir.dx, dir.dy)"
              >
                {{ dir.glyph }}
              </button>
            </div>
            <span class="cover-editor__position-value">
              {{ positionLabel }}
            </span>
          </div>

          <button
            type="button"
            class="cover-editor__reset"
            data-test="cover-reset"
            :disabled="!manual"
            :title="manual ? 'Вернуть автоматический кадр' : 'Кадр и так автоматический'"
            @click="reset"
          >
            Вернуть автомат
          </button>
        </div>
      </div>
    </div>

    <!-- Карточка: собрана по составу настоящей (LiquidLineCard) — те же
         строки, шеврон справа и пилюля «Избранное». Это не украшение: от
         состава зависит высота карточки, а по высоте растянута область
         фото. Строкой меньше — и кадр обрежется иначе.

         Ширина задана жёстко (369px = телефон 393px минус отступы
         страницы), а не берётся от модалки. Иначе в узкой модалке
         название переносилось бы раньше, чем у покупателя, карточка
         вышла бы выше — и кадр разошёлся бы. На маленьких экранах
         превью масштабируется целиком, сохраняя внутренние размеры. -->
    <div class="cover-preview__result">
      <span class="cover-preview__result-title">Так увидит клиент</span>
      <div class="cover-preview__stage">
        <div class="cover-preview__frame">
          <div class="cover-preview__main">
            <div class="cover-preview__art">
              <ImageFade
                :src="src"
                :alt="alt"
                :zoom="zoom / 100"
                :shift-x="shiftX"
                :shift-y="shiftY"
                :manual="manual"
              />
            </div>
            <div class="cover-preview__info">
              <span class="cover-preview__title">{{ title }}</span>
              <span v-if="meta" class="cover-preview__meta">{{ meta }}</span>
              <span class="cover-preview__reviews">★ 5,0 · 12 отзывов</span>
              <span class="cover-preview__favorite">Избранное</span>
            </div>
          </div>
          <div class="cover-preview__side">
            <span class="cover-preview__toggle" aria-hidden="true">⌄</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ImageFade from "@/components/product/ImageFade.vue";

const props = withDefaults(
  defineProps<{
    src: string | null;
    title?: string;
    meta?: string;
    alt?: string;
    /** Размер фото в процентах: 100 — как вписалось в область. */
    zoom?: number;
    /** Сдвиг вбок в процентах видимой области: минус влево, плюс вправо. */
    shiftX?: number;
    /** Сдвиг по вертикали в процентах: минус вверх, плюс вниз. */
    shiftY?: number;
    /** Кадр настроен руками: автоподбор не применяется. */
    manual?: boolean;
  }>(),
  {
    title: "Название линейки",
    meta: "Крепость 20 мг",
    alt: "",
    zoom: 100,
    shiftX: 0,
    shiftY: 0,
    manual: false,
  },
);

const emit = defineEmits<{
  "update:zoom": [value: number];
  "update:shiftX": [value: number];
  "update:shiftY": [value: number];
  "update:manual": [value: boolean];
}>();

const dragging = ref(false);
/** Кадр трогали: подсказка в окне больше не нужна. */
const touched = ref(props.manual);

/** Шаг перемещения кнопками: мышью грубо, а тут ровно. */
const NUDGE_STEP = 2;

const nudgeDirections = [
  { key: "up", dx: 0, dy: -NUDGE_STEP, glyph: "↑", label: "Сдвинуть выше" },
  { key: "down", dx: 0, dy: NUDGE_STEP, glyph: "↓", label: "Сдвинуть ниже" },
  { key: "left", dx: -NUDGE_STEP, dy: 0, glyph: "←", label: "Сдвинуть левее" },
  { key: "right", dx: NUDGE_STEP, dy: 0, glyph: "→", label: "Сдвинуть правее" },
] as const;

/** Точка отсчёта перетаскивания: считаем от неё, а не от прошлого события,
 *  иначе мелкие прыжки указателя накапливают погрешность. */
const dragOrigin = ref({ x: 0, y: 0, shiftX: 0, shiftY: 0 });

/** Подпись положения словами: понять сдвиг без заглядывания в цифры. */
const positionLabel = computed(() => {
  const parts: string[] = [];
  if (props.shiftX === 0) parts.push("по центру");
  else parts.push(props.shiftX > 0 ? `${props.shiftX}% вправо` : `${-props.shiftX}% влево`);
  if (props.shiftY !== 0) {
    parts.push(props.shiftY > 0 ? `${props.shiftY}% вниз` : `${-props.shiftY}% вверх`);
  }
  return parts.join(", ");
});

/** Первое касание кадра переводит линейку в ручной режим: с этого момента
 *  автоподбор не участвует и в карточке будет ровно то, что в окне. */
function markManual() {
  if (!touched.value) touched.value = true;
  if (!props.manual) emit("update:manual", true);
}

function clampShift(value: number) {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

/** Границы зума. Ниже фото разваливается на пиксели, выше — мыло. */
const ZOOM_MIN = 60;
const ZOOM_MAX = 400;

function clampZoom(value: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
}

function startDrag(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target || !props.src) return;
  dragging.value = true;
  target.setPointerCapture?.(event.pointerId);
  dragOrigin.value = {
    x: event.clientX,
    y: event.clientY,
    shiftX: props.shiftX,
    shiftY: props.shiftY,
  };
  markManual();
}

function onDrag(event: PointerEvent) {
  if (!dragging.value) return;
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;

  /* Переводим пиксели указателя в проценты области. Проценты те же, что
     хранит база, поэтому сохранённое значение не зависит от того, на
     каком экране сотрудник настраивал кадр. */
  const rect = target.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;

  const dx = ((event.clientX - dragOrigin.value.x) / width) * 100;
  const dy = ((event.clientY - dragOrigin.value.y) / height) * 100;

  emit("update:shiftX", clampShift(dragOrigin.value.shiftX + dx));
  emit("update:shiftY", clampShift(dragOrigin.value.shiftY + dy));
}

function endDrag(event: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  const target = event.currentTarget as HTMLElement | null;
  target?.releasePointerCapture?.(event.pointerId);
}

/** Чувствительность колеса и тачпада: сколько процентов зума даёт
 *  единица deltaY. Подобрано так, чтобы одно движение колеса мыши
 *  (deltaY около 100) давало около 6%, а плавный жест по тачпаду
 *  набирал те же проценты постепенно, а не рывком. */
const WHEEL_SENSITIVITY = 0.06;

/** Предел шага за одно событие. Некоторые мыши и программы прокрутки
 *  шлют deltaY в сотни единиц — без потолка кадр прыгал бы сразу на
 *  треть. */
const WHEEL_MAX_STEP = 12;

/** Накопленная дробная часть зума. Тачпад присылает десятки событий с
 *  deltaY в единицы, и каждое по отдельности дало бы меньше десятой
 *  процента. Округлять на каждом шаге — значит терять движение целиком,
 *  поэтому копим дробь здесь, а наружу отдаём целое значение. */
let wheelRemainder = 0;

/** Колесо мыши и жест по тачпаду над окном приближают и отдаляют фото. */
function onWheel(event: WheelEvent) {
  if (!props.src) return;

  /* deltaY отрицательный при прокрутке вверх — это приближение. */
  const rawStep = -event.deltaY * WHEEL_SENSITIVITY;
  const step = Math.max(-WHEEL_MAX_STEP, Math.min(WHEEL_MAX_STEP, rawStep));

  const exact = props.zoom + wheelRemainder + step;
  const next = clampZoom(exact);

  /* Остаток — только дробная часть. Если упёрлись в границу, копить
     дальше нечего: иначе накопилось бы «в стену» и фото поехало бы
     обратно само. */
  const hitLimit = next === ZOOM_MIN || next === ZOOM_MAX;
  wheelRemainder = hitLimit ? 0 : exact - next;

  if (next !== props.zoom) emit("update:zoom", next);
  markManual();
}

function onZoomInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("update:zoom", clampZoom(value));
  markManual();
}

function nudge(dx: number, dy: number) {
  emit("update:shiftX", clampShift(props.shiftX + dx));
  emit("update:shiftY", clampShift(props.shiftY + dy));
  markManual();
}

/** Возврат к автоподбору: множитель 1 и без сдвига. */
function reset() {
  emit("update:zoom", 100);
  emit("update:shiftX", 0);
  emit("update:shiftY", 0);
  emit("update:manual", false);
  touched.value = false;
}
</script>

<style scoped>
.cover-preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Блок результата: карточка под окном. Отделён от редактора, чтобы
   взгляд сам находил ответ на вопрос «а как у клиента». */
.cover-preview__result {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cover-preview__result-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

/* Обёртка превью: держит настоящую ширину карточки независимо от того,
   сколько места даёт модалка. Если позволить превью сжиматься, длинное
   название перенесётся раньше, чем у покупателя: карточка станет выше,
   а вместе с ней вытянется область фото — и кадр разойдётся.
   369px = телефон 393px минус отступы страницы (12px с боков).

   max-width здесь НЕ ставим. Если разрешить сжатие, в узкой модалке
   карточка станет уже, название перенесётся в две строки, карточка
   вытянется — и кадр разойдётся с клиентским. Вместо сжатия превью
   целиком уменьшается через transform: внутренние размеры остаются
   настоящими, а на экран оно занимает меньше места. */
.cover-preview__stage {
  width: 369px;
}

/* Карточка в масштабе телефона: ширина мини-аппа, пропорции сохранены. */
.cover-preview__frame {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 16px 12px;
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid #e6e9ed;
}

/* Шапка карточки: ровно как .liquid-line-main в мини-аппе. */
.cover-preview__main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

/* Боковой блок с шевроном: в мини-аппе он занимает 40px по высоте.
   Без него карточка в превью была бы ниже настоящей. */
.cover-preview__side {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.cover-preview__toggle {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: #f5f6f8;
  color: #6b7280;
  font-size: 16px;
  line-height: 1;
}

/* Область фото: те же габариты и то же поведение, что в мини-аппе. */
.cover-preview__art {
  position: relative;
  flex: 0 0 auto;
  align-self: stretch;
  width: 76px;
  min-height: 92px;
  margin-top: -16px;
  margin-bottom: -16px;
  margin-right: 10px;
}

.cover-preview__info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
  font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.cover-preview__title {
  font-size: 16px;
  font-weight: 700;
  line-height: 20px;
  color: #3a3a3a;
  max-width: 100%;
  overflow-wrap: break-word;
}

.cover-preview__meta {
  font-size: 13.2px;
  font-weight: 400;
  line-height: 17px;
  color: #aab2bd;
}

.cover-preview__reviews {
  margin-top: 1px;
  min-height: 14px;
  font-size: 12px;
  font-weight: 400;
  line-height: 14px;
  color: #0273f5;
}

/* Пилюля «Избранное»: в мини-аппе она есть у каждого покупателя с
   Telegram-контекстом и добавляет карточке 30px высоты. Без неё
   карточка в превью была бы ниже настоящей, а область фото — уже. */
.cover-preview__favorite {
  display: inline-flex;
  align-items: center;
  margin-top: 2px;
  min-height: 30px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid #e6e9ed;
  background: #ffffff;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: #3a3a3a;
  white-space: nowrap;
}

.cover-preview__hint {
  margin: 0;
  font-size: 11px;
  color: #6b7280;
}

/* --- Окно редактора ---
   Оформление повторяет поля самой формы линейки: те же скругления
   (rounded-lg — 8px), рамки border-gray-200 и подписи text-gray-500/700.
   Клиентская палитра выше относится к превью карточки: оно намеренно
   копирует мини-апп и живёт по его правилам. */

.cover-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
}

/* Шапка окна: что это за поверхность и что в ней значит рамка. */
.cover-editor__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.cover-editor__title {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.cover-editor__note {
  font-size: 12px;
  color: #6b7280;
}

/* Окно и управление рядом: двигаешь фото и тут же тянешься к ползунку,
   не перескакивая взглядом через полкарточки. */
.cover-editor__body {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.cover-editor__stage {
  position: relative;
  display: grid;
  place-items: center;
  padding: 14px;
  border-radius: 8px;
  /* Шахматка: видно, где кончается картинка, а где пусто вокруг. */
  background-color: #eef1f5;
  background-image:
    linear-gradient(45deg, #e2e7ee 25%, transparent 25%, transparent 75%, #e2e7ee 75%),
    linear-gradient(45deg, #e2e7ee 25%, transparent 25%, transparent 75%, #e2e7ee 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}

/* Видимая зона: те же пропорции, что у области фото в карточке клиента.
   Область растянута по высоте карточки и выходит 76x124 (замерено в
   браузере, не по min-height) — пропорция 0.6129. Окно ровно вдвое
   крупнее: 152x248. Пропорции важнее размера, потому что от них зависит
   кадр: пока в окне был квадрат 141x171, сотрудник видел другую обрезку,
   чем покупатель. */
.cover-editor__viewport {
  position: relative;
  width: 152px;
  height: 248px;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 0 0 2px #0958ff;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.cover-editor__viewport--dragging {
  cursor: grabbing;
}

/* Слой фото: тот же компонент и та же геометрия, что в мини-аппе. */
.cover-editor__canvas {
  position: absolute;
  inset: 0;
}

/* Управление — столбиком справа от окна: подписи читаются сверху вниз,
   руками ни за что не задеваешь. */
.cover-editor__controls {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.cover-editor__control {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.cover-editor__control-label {
  flex-shrink: 0;
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.cover-editor__control-label b {
  color: #111827;
}

.cover-editor__slider {
  flex: 1;
  min-width: 80px;
  accent-color: #0958ff;
  cursor: pointer;
}

.cover-editor__position {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Крестовина: четыре кнопки, как в редакторах изображений. */
.cover-editor__nudge {
  display: grid;
  grid-template-areas:
    ". up ."
    "left . right"
    ". down .";
  gap: 2px;
}

.cover-editor__nudge-button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.cover-editor__nudge-button:hover {
  border-color: #9ca3af;
  color: #111827;
}

.cover-editor__nudge-button:focus-visible {
  outline: 2px solid #0958ff;
  outline-offset: 1px;
}

.cover-editor__nudge-button:nth-child(1) { grid-area: up; }
.cover-editor__nudge-button:nth-child(2) { grid-area: down; }
.cover-editor__nudge-button:nth-child(3) { grid-area: left; }
.cover-editor__nudge-button:nth-child(4) { grid-area: right; }

.cover-editor__position-value {
  font-size: 11px;
  color: #6b7280;
  min-width: 96px;
}

.cover-editor__reset {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
}

.cover-editor__reset:hover:not(:disabled) {
  border-color: #9ca3af;
  color: #111827;
}

.cover-editor__reset:disabled {
  opacity: 0.5;
  cursor: default;
}

/* До 640px модалка формы ещё во всю ширину экрана и места мало: управление
   встаёт в столбец, а окно уменьшается. Порог совпадает с точкой, где
   модалка становится широкой (sm:max-w-lg) — иначе на 480..640px строка
   управления ломалась бы на две. */
@media (max-width: 640px) {
  /* Окно и управление встают друг под друга: рядом им уже тесно, и
     подписи с ползунком начали бы наползать. Порядок сохраняем —
     сверху окно, под ним управление, как на большом экране. */
  .cover-editor__body {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .cover-editor__controls {
    flex-direction: column;
    align-items: stretch;
  }

  .cover-editor__position {
    justify-content: space-between;
  }

  .cover-editor__viewport {
    /* Те же пропорции 76:124, масштаб 1.4: 76*1.4 = 106.4, 124*1.4 = 173.6. */
    width: 106px;
    height: 174px;
  }
}

/* Совсем узкие экраны: окно ещё меньше, чтобы не упиралось в края. */
@media (max-width: 400px) {
  .cover-editor__stage {
    padding: 10px;
  }

  .cover-editor__viewport {
    /* Пропорции держим те же, масштаб 1.2: 76*1.2 = 91.2, 124*1.2 = 148.8. */
    width: 91px;
    height: 149px;
  }

  .cover-editor__position-value {
    min-width: 0;
  }
}

/* Превью шире модалки на телефоне. Уменьшаем его целиком, а не сжимаем
   содержимое: сжатие поменяло бы перенос строк и высоту карточки, а
   значит и обрезку фото. Масштаб сохраняет карточку 1в1 — она просто
   показывается меньше, как уменьшенный снимок экрана.

   Масштаб 0.75 подобран по самой узкой цели: 369 * 0.75 = 276.75, а это
   меньше 280 — ширины контента модалки на телефоне 360px. На 375px и
   393px остаётся запас. Обёртка получает усечённую высоту, иначе под
   превью осталась бы пустая полоса: высота карточки после масштаба
   составляет примерно 0.75 от исходной. */
@media (max-width: 640px) {
  .cover-preview__stage {
    transform: scale(0.75);
    transform-origin: left top;
  }

  .cover-preview__result {
    /* transform не влияет на разметку: сама обёртка осталась бы во всю
       высоту карточки и под уменьшенной картинкой зияла бы пустая
       полоса. Обрезаем обёртку по размерам после масштаба.

       В высоту входит и подпись: она лежит вне уменьшаемой части, поэтому
       складываем её с уже уменьшенной карточкой, а не умножаем целиком.
       17 (подпись) + 4 (зазор) + 126 * 0.75 = 116.

       Ширину берём с запасом к 369 * 0.75 = 276.75. Впритык правый край
       карточки (шеврон) срезался бы от одного округления. */
    max-width: 279px;
    max-height: 117px;
    overflow: hidden;
  }
}
</style>
