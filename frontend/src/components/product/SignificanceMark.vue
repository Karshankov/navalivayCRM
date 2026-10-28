<template>
  <!--
    Блок пометки значимости линейки: задаётся в CRM (Настройки → Пометки
    значимости). Светлая карточка в духе референса «Помогаем животным»:
    градиентная квадратная плитка-иконка, крупный заголовок и широкая
    градиентная кнопка. Цвет из настройки красит плитку и кнопку, остальное
    (заголовок, описание, текст кнопки, иконка) настраивается менеджером.
    Кнопка открывает модалку с текстом или внешнюю ссылку.
  -->
  <div v-if="mark" class="sig-mark" role="note" :aria-label="mark.title">
    <!-- Сетка шапки повторяет заголовок линейки: колонка фото (88px) + текст. -->
    <div class="sig-mark__row">
      <span class="sig-mark__tile-col">
        <span class="sig-mark__tile" :style="tileStyle" aria-hidden="true">
          <img
            :src="mark.icon"
            :alt="mark.title"
            class="sig-mark__tile-img"
            loading="lazy"
            decoding="async"
          />
        </span>
      </span>
      <div class="sig-mark__text">
        <p class="sig-mark__title">{{ mark.title }}</p>
        <p v-if="mark.description" class="sig-mark__description">{{ mark.description }}</p>
        <button
          v-if="hasDetail"
          type="button"
          class="sig-mark__action"
          :style="actionStyle"
          :aria-label="`${mark.detailButtonText || 'Подробнее'}: ${mark.title}`"
          @click="openDetail"
        >
          <span class="sig-mark__action-label">{{ mark.detailButtonText || 'Подробнее' }}</span>
          <svg class="sig-mark__action-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M13.5 4.5L21 12L13.5 19.5M21 12H3"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- Модалка «Подробнее» -->
  <Teleport to="body">
    <Transition name="mark-fade">
      <div
        v-if="detailOpen"
        class="sig-mark-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="mark?.detailTitle || mark?.title || 'Подробнее'"
        @click.self="closeDetail"
      >
        <div class="sig-mark-sheet">
          <div class="sig-mark-sheet__head">
            <span class="sig-mark__tile sig-mark__tile--sheet" :style="tileStyle" aria-hidden="true">
              <img
                :src="mark?.icon"
                :alt="mark?.title || ''"
                class="sig-mark__tile-img"
                decoding="async"
              />
            </span>
            <p class="sig-mark-sheet__title">{{ mark?.detailTitle || mark?.title }}</p>
          </div>
          <div class="sig-mark-sheet__body">
            <p v-if="detailLoading" class="sig-mark-sheet__loading">Загружаем…</p>
            <!-- Текст пришёл с сервера уже санитайзированным (белый список тегов). -->
            <div
              v-else
              ref="sheetBodyEl"
              class="sig-mark-sheet__text"
              v-html="detailBody"
              @click="onBodyClick"
            ></div>
          </div>
          <div class="sig-mark-sheet__footer">
            <button
              type="button"
              class="sig-mark__action sig-mark__action--sheet"
              :style="actionStyle"
              @click="closeDetail"
            >
              <span class="sig-mark__action-label">Понятно</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ProductMark } from '@/stores/catalog'

const props = defineProps<{
  mark: ProductMark | null | undefined
}>()

/** Осветление/затемнение hex-цвета: второй стоп градиента из цвета пометки. */
function shade(hex: string, percent: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!match) return hex
  const value = parseInt(match[1], 16)
  const channel = (raw: number) => {
    const target = percent > 0 ? 255 : 0
    const shifted = Math.round(raw + (target - raw) * Math.abs(percent) / 100)
    return Math.max(0, Math.min(255, shifted))
  }
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(channel((value >> 16) & 255))}${toHex(channel((value >> 8) & 255))}${toHex(channel(value & 255))}`
}

/** Плитка-иконка: градиент из цвета пометки, как синяя в референсе. */
const tileStyle = computed(() => {
  const color = props.mark?.color || '#0789ff'
  return {
    background: `linear-gradient(128deg, ${shade(color, 22)} 0%, ${color} 49%, ${shade(color, -26)} 100%)`,
  }
})

/** Кнопка: градиент чуть темнее цвета пометки, текст белый. */
const actionStyle = computed(() => {
  const color = props.mark?.color || '#0789ff'
  return {
    background: `linear-gradient(110deg, ${shade(color, -8)}, ${shade(color, -18)})`,
  }
})

const detailOpen = ref(false)
const detailBody = ref('')
const detailLoading = ref(false)
const sheetBodyEl = ref<HTMLElement | null>(null)
/** Промокод, скопированный последним: показываем «Скопировано!» рядом. */
const copiedPromo = ref('')

const hasDetail = computed(() =>
  Boolean(props.mark?.detailUrl || props.mark?.detailBody),
)

async function openDetail() {
  if (!props.mark) return
  if (props.mark.detailUrl) {
    // Внутри Telegram Mini App window.open ненадёжен (особенно iOS):
    // открываем через WebApp.openLink, как баннеры витрины.
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(props.mark.detailUrl)
    } else {
      window.open(props.mark.detailUrl, '_blank', 'noopener,noreferrer')
    }
    return
  }
  // Текст «Подробнее» живёт на сервере: тянем по коду пометки. Пока грузится,
  // показываем модалку с индикатором — кнопка не выглядит «мёртвой».
  detailBody.value = ''
  detailOpen.value = true
  detailLoading.value = true
  try {
    const response = await fetch(`/api/significance-marks/${encodeURIComponent(props.mark.code)}/detail`)
    if (!response.ok) throw new Error('failed')
    const data = await response.json()
    const body = data.detailBody || ''
    // Старые пометки хранили plain text: оборачиваем в абзац.
    detailBody.value = body && body.startsWith('<')
      ? body
      : `<p>${body || data.description || props.mark.title}</p>`
  } catch {
    detailBody.value = `<p>${props.mark.description || props.mark.title}</p>`
  } finally {
    detailLoading.value = false
  }
}

/**
 * Нажатие на блок промокода: копируем код в буфер обмена (в Telegram Mini App
 * есть Clipboard API; на старых клиентах — запасной путь с выделением).
 */
async function onBodyClick(event: MouseEvent) {
  const target = (event.target as HTMLElement)?.closest?.('[data-promo]') as HTMLElement | null
  if (!target) return
  const code = target.getAttribute('data-promo') || ''
  if (!code) return
  event.preventDefault()
  event.stopPropagation()

  let copied = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code)
      copied = true
    }
  } catch {
    copied = false
  }
  if (!copied) {
    // Запасной путь: невидимое поле + execCommand('copy').
    try {
      const input = document.createElement('textarea')
      input.value = code
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      copied = document.execCommand('copy')
      input.remove()
    } catch {
      copied = false
    }
  }

  // Подтверждение прямо в блоке: «Скопировано!» вместо подписи.
  target.classList.toggle('sig-promo--copied', true)
  copiedPromo.value = code
  window.setTimeout(() => {
    target.classList.remove('sig-promo--copied')
    if (copiedPromo.value === code) copiedPromo.value = ''
  }, 2000)
}

function closeDetail() {
  detailOpen.value = false
}

// Пометка сменилась (перешли на другой товар) — модалку закрываем.
watch(() => props.mark?.code, () => {
  detailOpen.value = false
  detailLoading.value = false
})

// Esc закрывает модалку: слушатель живёт только пока она открыта.
watch(detailOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onDetailKeydown)
  } else {
    document.removeEventListener('keydown', onDetailKeydown)
  }
})

function onDetailKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDetail()
  }
}

onUnmounted(() => {
  document.removeEventListener('keydown', onDetailKeydown)
})
</script>

<style scoped>
/*
 * Без карточки: блок лежит прямо в строке линейки. Сетка повторяет шапку —
 * колонка фото (88px, плитка в ней по центру) + колонка текста. Ни фона,
 * ни тени, ни рамки; цвет пометки живёт в градиенте плитки и кнопки.
 */
.sig-mark {
  margin-top: 8px;
}

.sig-mark__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Колонка фото шапки: 88px — плитка центрируется под рамкой с фото. */
.sig-mark__tile-col {
  width: 88px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}

/* Плитка-иконка: квадрат с градиентом из цвета пометки, радиус как у фото. */
.sig-mark__tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 16px;
}

.sig-mark__tile--sheet {
  width: 46px;
  height: 46px;
  border-radius: 12px;
}

.sig-mark__tile-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 18%;
  border-radius: inherit;
  /* Мягкая тень, чтобы белая иконка не сливалась со светлым градиентом. */
  filter: drop-shadow(0 1px 2px rgba(8, 12, 20, 0.22));
}

.sig-mark__text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.sig-mark__title {
  margin: 0;
  /* Шрифт как у названия линейки («ЗЛАЯ МОНАШКА»): Montserrat 700 16/20 #191919. */
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 16px;
  line-height: 20px;
  color: #191919;
  /* Полное название, переносится — без обрезаний. */
  overflow-wrap: anywhere;
}

.sig-mark__description {
  margin: 3px 0 0;
  color: #555e6e;
  font-family: "Montserrat", sans-serif;
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  overflow-wrap: anywhere;
}

.sig-mark__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 12px;
  margin-top: 8px;
  align-self: flex-start;
  padding: 10px 16px;
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.sig-mark__action--sheet {
  margin: 0;
  width: 100%;
  border-radius: 14px;
}

.sig-mark__action:active {
  filter: brightness(0.94);
}

.sig-mark__action:focus-visible {
  outline: 2px solid #123a82;
  outline-offset: 2px;
}

.sig-mark__action-label {
  min-width: 0;
}

.sig-mark__action-arrow {
  width: 16px;
  height: 16px;
  flex: none;
}

/* Модалка «Подробнее» — в том же стиле. */
.sig-mark-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(18, 32, 59, 0.4);
  backdrop-filter: blur(4px);
}

.sig-mark-sheet {
  width: 100%;
  max-width: 400px;
  overflow: hidden;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 20px 80px rgba(0, 0, 0, 0.2);
}

.sig-mark-sheet__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 22px 14px;
}

/* Шрифт заголовка — как у названия линейки: Montserrat 700, мягкий чёрный. */
.sig-mark-sheet__title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-style: normal;
  font-weight: 700;
  font-size: 18px;
  line-height: 23px;
  color: #191919;
  min-width: 0;
}

.sig-mark-sheet__body {
  max-height: 50vh;
  overflow-y: auto;
  padding: 0 22px;
}

/* Текст «Подробнее» — HTML из редактора: типографика как в Word. */
.sig-mark-sheet__text {
  margin: 0;
  color: #191919;
  font-family: "Montserrat", sans-serif;
  font-size: 14px;
  line-height: 1.55;
}

.sig-mark-sheet__text :deep(p) {
  margin: 0 0 10px;
}

.sig-mark-sheet__text :deep(p:last-child) {
  margin-bottom: 0;
}

.sig-mark-sheet__text :deep(h2) {
  margin: 14px 0 8px;
  font-size: 17px;
  font-weight: 700;
  color: #191919;
}

.sig-mark-sheet__text :deep(h3) {
  margin: 12px 0 6px;
  font-size: 15px;
  font-weight: 700;
  color: #191919;
}

.sig-mark-sheet__text :deep(h4) {
  margin: 10px 0 6px;
  font-size: 14px;
  font-weight: 700;
  color: #191919;
}

.sig-mark-sheet__text :deep(ul),
.sig-mark-sheet__text :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}

.sig-mark-sheet__text :deep(li) {
  margin: 2px 0;
}

.sig-mark-sheet__text :deep(a) {
  color: #0789ff;
  text-decoration: underline;
}

.sig-mark-sheet__text :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 12px;
  margin: 8px 0;
}

.sig-mark-sheet__text :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 0 4px 14px;
  border-left: 3px solid #e6e9ed;
  color: #555e6e;
}

/*
 * Блок промокода: отдельная карточка с пунктиром; нажатие копирует код.
 * data-promo пришёл с сервера (там же вычищен до букв/цифр).
 */
.sig-mark-sheet__text :deep([data-promo]) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 12px 0;
  padding: 12px 14px;
  border: 1.5px dashed #0789ff;
  border-radius: 12px;
  background: #f0f9ff;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.sig-mark-sheet__text :deep([data-promo]:active) {
  background: #dbeefe;
}

.sig-mark-sheet__text :deep([data-promo] b) {
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #0789ff;
}

.sig-mark-sheet__text :deep([data-promo].sig-promo--copied) {
  border-color: #16a34a;
  background: #f0fdf4;
}

.sig-mark-sheet__text :deep([data-promo].sig-promo--copied b) {
  color: #15803d;
}

.sig-mark-sheet__loading {
  margin: 0;
  color: #9aa3b0;
  font-size: 14px;
}

.sig-mark-sheet__footer {
  padding: 18px 22px 22px;
}

.mark-fade-enter-active,
.mark-fade-leave-active {
  transition: opacity 0.2s ease;
}

.mark-fade-enter-from,
.mark-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sig-mark__action {
    transition: none;
  }
}
</style>
