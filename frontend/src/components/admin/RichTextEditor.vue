<template>
  <!--
    Визуальный редактор текста «Подробнее» пометки значимости: как в MS Word —
    жирный, курсив, подчёркивание, зачёркивание, заголовки, списки,
    выравнивание, ссылки и вставка картинок. Работает через contenteditable
    и document.execCommand — их поддержка встроена во все браузеры.
    Сохраняемый HTML вычищается на сервере до белого списка тегов.
  -->
  <div class="rich-editor" data-test="rich-editor">
    <!-- Панель инструментов -->
    <div class="rich-editor__toolbar" role="toolbar" aria-label="Форматирование текста">
      <button
        v-for="tool in inlineTools"
        :key="tool.cmd"
        type="button"
        class="rich-editor__btn"
        :title="tool.title"
        :aria-label="tool.title"
        :data-test="`rich-${tool.cmd.toLowerCase()}`"
        @mousedown.prevent
        @click="exec(tool.cmd, tool.value)"
      >
        <span v-if="tool.label" class="rich-editor__btn-label" :class="{ mono: tool.mono }">{{ tool.label }}</span>
        <svg v-else class="rich-editor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path :d="tool.path" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <span class="rich-editor__sep" aria-hidden="true" />

      <button
        v-for="tool in alignTools"
        :key="tool.cmd"
        type="button"
        class="rich-editor__btn"
        :title="tool.title"
        :aria-label="tool.title"
        :data-test="`rich-${tool.cmd.toLowerCase()}`"
        @mousedown.prevent
        @click="exec('justify' + tool.value)"
      >
        <svg class="rich-editor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path :d="tool.path" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <span class="rich-editor__sep" aria-hidden="true" />

      <button
        type="button"
        class="rich-editor__btn"
        title="Вставить промокод (копируется по нажатию)"
        aria-label="Вставить промокод"
        data-test="rich-promo"
        @mousedown.prevent
        @click="insertPromoBlock"
      >
        <span class="rich-editor__btn-label">%</span>
      </button>

      <button
        type="button"
        class="rich-editor__btn"
        title="Вставить ссылку"
        aria-label="Вставить ссылку"
        data-test="rich-link"
        @mousedown.prevent
        @click="insertLink"
      >
        <svg class="rich-editor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <button
        type="button"
        class="rich-editor__btn"
        title="Вставить картинку"
        aria-label="Вставить картинку"
        data-test="rich-image"
        @mousedown.prevent
      >
        <label class="rich-editor__file-label">
          <svg class="rich-editor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="M21 15.5l-5-5L5 19" />
          </svg>
          <input
            ref="imageInput"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            class="sr-only"
            @change="onImageFile"
          />
        </label>
      </button>

      <span class="rich-editor__sep" aria-hidden="true" />

      <button
        type="button"
        class="rich-editor__btn rich-editor__btn--danger"
        title="Убрать форматирование"
        aria-label="Убрать форматирование"
        data-test="rich-removeformat"
        @mousedown.prevent
        @click="exec('removeFormat')"
      >
        <svg class="rich-editor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M6 18L18 6M9 6h6M8 12h4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- Поле редактирования -->
    <div
      ref="editorEl"
      class="rich-editor__area"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      aria-label="Текст «Подробнее»"
      data-test="rich-editor-area"
      @input="onInput"
      @blur="onInput"
      @click="onImageClick"
      @keydown="onEditorKeydown"
    ></div>

    <!-- Размер выделенной картинки: кликните картинку в тексте. -->
    <div class="rich-editor__img-controls" data-test="rich-img-controls">
      <span class="rich-editor__img-controls-label">Размер картинки:</span>
      <button type="button" data-test="rich-img-100" @mousedown.prevent @click="resizeSelectedImage(100)">100%</button>
      <button type="button" data-test="rich-img-75" @mousedown.prevent @click="resizeSelectedImage(75)">75%</button>
      <button type="button" data-test="rich-img-50" @mousedown.prevent @click="resizeSelectedImage(50)">50%</button>
      <button type="button" data-test="rich-img-30" @mousedown.prevent @click="resizeSelectedImage(30)">30%</button>
      <span class="rich-editor__img-controls-hint">кликните картинку в тексте, затем размер</span>
    </div>

    <p class="rich-editor__hint">
      Текст откроется в модалке «Подробнее» в мини-аппе. Картинки — до 5 МБ, сожмутся на сервере.
    </p>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * Модель — HTML-строка (может быть null). Синхронизация аккуратная:
 * пишем в contenteditable только при внешней смене значения, чтобы
 * не сбрасывать каретку во время набора.
 */
const props = defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
}>()

const editorEl = ref<HTMLElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)

/**
 * Сохранённое выделение: клики по тулбару и window.prompt сбивают каретку
 * в Safari/Telegram WebApp. Держим Range и восстанавливаем перед execCommand —
 * иначе форматирование применялось не к выделенному тексту.
 */
let savedRange: Range | null = null

function saveSelection() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (editorEl.value?.contains(range.commonAncestorContainer)) {
    savedRange = range.cloneRange()
  }
}

function restoreSelection() {
  if (!savedRange || !editorEl.value) return
  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  try {
    sel.addRange(savedRange)
  } catch {
    // Range устарел (DOM перестроен) — оставляем текущую каретку.
  }
}

const inlineTools = [
  { cmd: 'bold', title: 'Жирный (Ctrl+B)', label: 'Ж', mono: false },
  { cmd: 'italic', title: 'Курсив (Ctrl+I)', label: 'К', mono: false },
  { cmd: 'underline', title: 'Подчёркнутый (Ctrl+U)', label: 'Ч', mono: false },
  { cmd: 'strikeThrough', title: 'Зачёркнутый', label: '', path: 'M5 12h14M8 6a4 4 0 0 1 8 0c0 3-8 4-8 9a4 4 0 0 0 8 0' },
  { cmd: 'formatBlock', value: 'h2', title: 'Заголовок крупный', label: 'H1', mono: true },
  { cmd: 'formatBlock', value: 'h3', title: 'Заголовок средний', label: 'H2', mono: true },
  { cmd: 'formatBlock', value: 'p', title: 'Обычный текст', label: 'Aa', mono: false },
  { cmd: 'insertUnorderedList', title: 'Список', label: '', path: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  { cmd: 'insertOrderedList', title: 'Нумерованный список', label: '', path: 'M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 1-2 2-2s1 1 1 1-1 1-2 1M4 15l2-1' },
]

const alignTools = [
  { cmd: 'justifyLeft', value: 'Left', title: 'По левому краю', path: 'M3 6h18M3 12h12M3 18h15' },
  { cmd: 'justifyCenter', value: 'Center', title: 'По центру', path: 'M3 6h18M6 12h12M5 18h14' },
  { cmd: 'justifyRight', value: 'Right', title: 'По правому краю', path: 'M3 6h18M9 12h12M6 18h15' },
]

function exec(cmd: string, value?: string) {
  editorEl.value?.focus()
  restoreSelection()
  document.execCommand(cmd, false, value)
  syncValue()
}

/**
 * Блок промокода: в мини-аппе нажатие копирует код в буфер обмена.
 * Храним как <div data-promo="КОД"><span>КОД</span> + подпись</div> —
 * сервер оставляет только white-listed содержимое.
 */
function insertPromoBlock() {
  saveSelection()
  const code = window.prompt('Промокод (только код, например CATSWILL10):', '')
  if (!code || !code.trim()) return
  const label = window.prompt('Подпись под промокодом (необязательно):', 'Нажмите, чтобы скопировать') || ''
  const safeCode = code.trim().replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const html = `<div data-promo="${code.trim().replace(/"/g, '&quot;')}"><b>${safeCode}</b>${label ? ` — ${label.replace(/</g, '&lt;')}` : ''}</div><p><br></p>`
  editorEl.value?.focus()
  restoreSelection()
  document.execCommand('insertHTML', false, html)
  syncValue()
}

/**
 * Изменение размера картинки: клик по картинке выделяет её, клик мимо —
 * снимает выделение (иначе оно «залипало» навсегда).
 */
function onImageClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.tagName !== 'IMG') {
    clearImageSelection()
    return
  }
  editorEl.value?.querySelectorAll('img.rich-editor__img-selected').forEach((el) => {
    el.classList.remove('rich-editor__img-selected')
  })
  target.classList.add('rich-editor__img-selected')
}

function clearImageSelection() {
  editorEl.value?.querySelectorAll('img.rich-editor__img-selected').forEach((el) => {
    el.classList.remove('rich-editor__img-selected')
  })
}

/**
 * Рядом ли каретка с выделенной картинкой: удаление сработает только тогда,
 * а не при любом Backspace во время набора текста в другом месте.
 */
function isCaretAdjacentTo(selected: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  const container = range.startContainer
  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as HTMLElement)
  if (!element || !editorEl.value?.contains(element)) return false

  // Клик по картинке ставит каретку в неё или рядом — считаем соседством.
  if (selected.contains(element)) return true
  // Каретка в тексте сразу после картинки.
  if (element.previousElementSibling === selected) return true
  // Каретка в тексте сразу перед картинкой.
  if (element.nextElementSibling === selected) return true
  // Каретка в том же абзаце, что и картинка, без текста между ними.
  if (element.parentElement === selected.parentElement) {
    const nodes = Array.from(element.parentElement?.children || [])
    const between = nodes.slice(
      Math.min(nodes.indexOf(element), nodes.indexOf(selected)) + 1,
      Math.max(nodes.indexOf(element), nodes.indexOf(selected)),
    )
    if (between.length === 0) return true
    const hasText = between.some((n) => (n.textContent || '').trim().length > 0)
    if (!hasText) return true
  }
  return false
}

function onEditorKeydown(event: KeyboardEvent) {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  const selected = editorEl.value?.querySelector('img.rich-editor__img-selected')
  if (!selected) return

  const sel = window.getSelection()
  // Есть текстовое выделение — это работа с текстом, картинку не трогаем.
  if (sel && !sel.isCollapsed) {
    clearImageSelection()
    return
  }

  // Каретка не рядом с картинкой — Backspace работает по тексту как обычно.
  if (!isCaretAdjacentTo(selected as HTMLElement)) {
    // Снимаем выделение картинки: набор текста не должен удалять её.
    clearImageSelection()
    return
  }

  event.preventDefault()
  selected.remove()
  syncValue()
}

function resizeSelectedImage(percent: number) {
  const img = editorEl.value?.querySelector('img.rich-editor__img-selected') as HTMLImageElement | null
  if (!img) return
  img.style.width = `${percent}%`
  img.style.height = 'auto'
  img.removeAttribute('width')
  img.removeAttribute('height')
  syncValue()
}

function insertLink() {
  saveSelection()
  const selection = window.getSelection()
  const selected = savedRange?.toString() || selection?.toString() || ''
  const url = window.prompt(
    selected ? `Ссылка для «${selected.slice(0, 40)}»` : 'Адрес ссылки',
    'https://',
  )
  if (!url || url === 'https://') return
  editorEl.value?.focus()
  restoreSelection()
  document.execCommand('createLink', false, url)
  syncValue()
}

async function onImageFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    window.alert('Это не картинка.')
    input.value = ''
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    window.alert('Картинка больше 5 МБ. Возьмите поменьше.')
    input.value = ''
    return
  }
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    editorEl.value?.focus()
    restoreSelection()
    document.execCommand('insertImage', false, dataUrl)
    syncValue()
  } catch {
    window.alert('Не удалось прочитать файл.')
  } finally {
    input.value = ''
  }
}

function readEditor(): string | null {
  const html = (editorEl.value?.innerHTML || '').trim()
  if (!html) return null
  // Пустые абзацы (продукт execCommand'а) не считаем содержимым.
  const textOnly = html.replace(/<p>(&nbsp;|\s|<br\s*\/?>)*<\/p>/gi, '').replace(/<[^>]*>/g, '').trim()
  if (!textOnly && !/<img/i.test(html)) return null
  return html
}

function syncValue() {
  const value = readEditor()
  if (value !== (props.modelValue ?? null)) {
    emit('update:modelValue', value)
  }
}

function onInput() {
  syncValue()
}

// Внешняя смена (открытие другой пометки) — перезаливаем контент.
watch(() => props.modelValue, (value) => {
  if (!editorEl.value) return
  // Сравниваем побайтово: перезаливаем только при внешней смене модели
  // (открыли другую пометку). Собственные эмиты не должны перерисовывать
  // поле — иначе форматирование «слетало» сразу после применения.
  if ((editorEl.value.innerHTML || '') !== (value ?? '')) {
    editorEl.value.innerHTML = value || ''
  }
})

function onDocumentSelectionChange() {
  saveSelection()
}

onMounted(() => {
  if (editorEl.value) {
    editorEl.value.innerHTML = props.modelValue || ''
  }
  // Выделение меняется при наборе/кликах в поле — запоминаем каждый раз.
  document.addEventListener('selectionchange', onDocumentSelectionChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onDocumentSelectionChange)
})
</script>

<style scoped>
.rich-editor {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  overflow: hidden;
}

.rich-editor__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.rich-editor__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  padding: 0 6px;
  color: #374151;
  cursor: pointer;
  transition: background 0.12s ease;
}

.rich-editor__btn:hover {
  background: #e5e7eb;
}

.rich-editor__btn:active {
  background: #d1d5db;
}

.rich-editor__btn--danger {
  color: #b91c1c;
}

.rich-editor__btn--danger:hover {
  background: #fee2e2;
}

.rich-editor__btn-label {
  font-size: 13px;
  font-weight: 700;
  min-width: 22px;
  text-align: center;
}

.rich-editor__btn-label.mono {
  font-family: ui-monospace, monospace;
}

.rich-editor__icon {
  width: 18px;
  height: 18px;
}

.rich-editor__file-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.rich-editor__sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: #d1d5db;
}

.rich-editor__area {
  min-height: 180px;
  max-height: 360px;
  overflow-y: auto;
  padding: 12px;
  font-family: "Montserrat", sans-serif;
  font-size: 14px;
  line-height: 1.55;
  color: #191919;
  outline: none;
}

.rich-editor__area:empty::before {
  content: 'Расскажите, куда идут средства и почему это важно…';
  color: #9ca3af;
}

/* Типографика внутри редактора — как в модалке мини-аппа. */
.rich-editor__area :deep(h2) {
  margin: 12px 0 6px;
  font-size: 17px;
  font-weight: 700;
}

.rich-editor__area :deep(h3) {
  margin: 10px 0 6px;
  font-size: 15px;
  font-weight: 700;
}

.rich-editor__area :deep(p) {
  margin: 0 0 8px;
}

.rich-editor__area :deep(ul),
.rich-editor__area :deep(ol) {
  margin: 0 0 8px;
  padding-left: 22px;
}

.rich-editor__area :deep(a) {
  color: #0789ff;
  text-decoration: underline;
}

.rich-editor__area :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

/* Выделенная картинка и панель её размера. */
.rich-editor__area :deep(img) {
  cursor: pointer;
}

.rich-editor__area :deep(img.rich-editor__img-selected) {
  outline: 2px solid #0789ff;
  outline-offset: 2px;
}

.rich-editor__img-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 4px 8px;
  border-top: 1px solid #f3f4f6;
  background: #f9fafb;
}

.rich-editor__img-controls-label {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
}

.rich-editor__img-controls button {
  border: 1px solid #d1d5db;
  border-radius: 5px;
  background: #ffffff;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
}

.rich-editor__img-controls button:hover {
  background: #e5e7eb;
}

.rich-editor__img-controls-hint {
  margin-left: 4px;
  font-size: 10px;
  color: #9ca3af;
}

/* Блок промокода внутри редактора: как он будет выглядеть в мини-аппе. */
.rich-editor__area :deep([data-promo]) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  padding: 10px 14px;
  border: 1.5px dashed #0789ff;
  border-radius: 10px;
  background: #f0f9ff;
  color: #191919;
  font-size: 13px;
}

.rich-editor__hint {
  margin: 0;
  padding: 6px 12px 8px;
  font-size: 11px;
  color: #6b7280;
  border-top: 1px solid #f3f4f6;
  background: #f9fafb;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
