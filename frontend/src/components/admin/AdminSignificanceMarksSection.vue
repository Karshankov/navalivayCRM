<template>
  <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm col-span-full">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-gray-900">Пометки значимости</h3>
        <p class="text-sm text-gray-600">
          Ярлык для линеек («Социально значимый товар»): блок в карточке товара в мини-аппе
          и сообщение клиенту через 10 минут после выдачи заказа. Пометка ставится
          в настройках линейки (Категории → линейки).
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-brand-dark px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark/90"
        :disabled="loading"
        @click="openCreate"
      >
        + Новая пометка
      </button>
    </div>

    <div v-if="loading && !marks.length" class="mt-6 text-sm text-gray-500">Загрузка…</div>
    <div v-else-if="loadError" class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ loadError }}
    </div>

    <div v-else-if="!marks.length" class="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-6 py-10 text-center">
      <p class="text-sm font-semibold text-gray-800">Пометок пока нет</p>
      <p class="mt-1 text-sm text-gray-500">
        Создайте первую: задайте название, иконку, цвет блока и текст сообщения клиенту.
      </p>
      <button
        type="button"
        class="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark/90"
        @click="openCreate"
      >
        + Создать пометку
      </button>
    </div>

    <!-- Ошибка действия со строкой: список остаётся на экране -->
    <div
      v-if="actionError && marks.length"
      class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
      role="alert"
    >
      {{ actionError }}
    </div>

    <!-- Список пометок: живой превью слева, настройки справа -->
    <ul v-else class="mt-6 space-y-3">
      <li
        v-for="mark in marks"
        :key="mark.id"
        class="grid gap-4 rounded-xl border border-gray-200 bg-white p-4 lg:grid-cols-[320px_minmax(0,1fr)]"
      >
        <!-- Превью блока как в мини-аппе -->
        <div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Как увидит клиент</p>
          <div
            class="overflow-hidden rounded-2xl p-4 shadow-sm"
            :style="{ background: mark.color, color: readableTextColor(mark.color) }"
          >
            <div class="flex items-center gap-2.5">
              <img
                :src="mark.icon"
                :alt="mark.title"
                class="h-8 w-8 shrink-0 rounded-full bg-white/25 object-contain p-1"
                loading="lazy"
                decoding="async"
              />
              <p class="text-sm font-extrabold leading-tight">{{ mark.title }}</p>
            </div>
            <p v-if="mark.description" class="mt-2 text-xs leading-relaxed opacity-90">
              {{ mark.description }}
            </p>
            <span
              v-if="mark.detailUrl || mark.detailBody"
              class="mt-3 inline-flex items-center gap-1 rounded-full bg-white/25 px-3 py-1.5 text-xs font-bold"
            >
              {{ mark.detailButtonText || 'Подробнее' }}
            </span>
          </div>
        </div>

        <!-- Сводка настройки -->
        <div class="min-w-0 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
              :class="mark.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'"
            >
              {{ mark.active ? 'Активна' : 'Выключена' }}
            </span>
            <span
              v-if="mark.adminNote"
              class="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
            >
              {{ mark.adminNote }}
            </span>
            <span class="text-xs text-gray-400">код: {{ mark.code }}</span>
          </div>

          <div class="grid gap-2 text-sm">
            <div class="flex items-start gap-2">
              <span class="w-32 shrink-0 text-xs font-semibold text-gray-500">Сообщение после выдачи</span>
              <span
                class="min-w-0 line-clamp-3 whitespace-pre-line text-sm text-gray-700"
                :title="mark.notifyText || ''"
              >{{ mark.notifyText || '— не задано —' }}</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="w-32 shrink-0 text-xs font-semibold text-gray-500">«Подробнее»</span>
              <span class="min-w-0 break-all text-sm text-gray-700">{{ detailSummary(mark) }}</span>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
              @click="openEdit(mark)"
            >
              Редактировать
            </button>
            <button
              type="button"
              class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
              :disabled="togglingId === mark.id"
              @click="toggleActive(mark)"
            >
              {{ mark.active ? 'Выключить' : 'Включить' }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
              @click="confirmDelete(mark)"
            >
              Удалить
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- Модалка создания/редактирования -->
    <AdminModal
      :isOpen="modalOpen"
      :title="editingId ? 'Редактировать пометку' : 'Новая пометка'"
      size="lg"
      :showActions="false"
      @close="closeModal"
      @cancel="closeModal"
    >
      <form class="space-y-5" data-test="significance-mark-form" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700" for="mark-title">Название *</label>
            <input
              id="mark-title"
              v-model="form.title"
              type="text"
              maxlength="80"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              :class="{ 'border-red-300': formError && !form.title.trim() }"
              placeholder="Социально значимый товар"
              data-test="mark-title"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-gray-700" for="mark-button">Кнопка «Подробнее»</label>
            <input
              id="mark-button"
              v-model="form.detailButtonText"
              type="text"
              maxlength="60"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Подробнее"
            />
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-medium text-gray-700" for="mark-description">Описание в блоке</label>
          <textarea
            id="mark-description"
            v-model="form.description"
            rows="2"
            maxlength="300"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            placeholder="Часть средств с каждой покупки идёт на благотворительность"
          />
          <p class="mt-1 text-xs text-gray-500">Короткая строка под названием в карточке товара</p>
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-medium text-gray-700" for="mark-admin-note">
            Заметка для нас (клиенту не видна)
          </label>
          <input
            id="mark-admin-note"
            v-model="form.adminNote"
            type="text"
            maxlength="120"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            placeholder="Например: помощь детям / помощь животным"
            data-test="mark-admin-note"
          />
          <p class="mt-1 text-xs text-gray-500">
            Видна только в CRM — различайте одинаковые пометки при выборе в линейке
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <p class="mb-1.5 text-sm font-medium text-gray-700">Иконка *</p>
            <div class="flex items-center gap-3">
              <div
                class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-50"
                aria-hidden="true"
              >
                <img
                  v-if="form.icon"
                  :src="form.icon"
                  alt=""
                  class="h-full w-full object-contain p-1"
                />
                <svg v-else class="h-5 w-5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <label
                class="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Загрузить иконку
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  class="hidden"
                  data-test="mark-icon-file"
                  @change="onIconFile"
                />
              </label>
              <button
                v-if="form.icon"
                type="button"
                class="text-sm font-medium text-red-600 hover:text-red-700"
                data-test="mark-icon-remove"
                @click="removeIcon"
              >
                Убрать
              </button>
            </div>
            <p class="mt-1.5 text-xs text-gray-500">
              PNG/JPG/WebP/SVG, до 5 МБ; сервер сожмёт в WebP. Круглый вид — обрезайте заранее.
            </p>
          </div>

          <div>
            <p class="mb-1.5 text-sm font-medium text-gray-700">Цвет блока</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="preset in COLOR_PRESETS"
                :key="preset"
                type="button"
                class="h-9 w-9 rounded-lg border-2 transition"
                :class="form.color === preset ? 'border-gray-900' : 'border-transparent hover:border-gray-300'"
                :style="{ background: preset }"
                :aria-label="`Цвет ${preset}`"
                :aria-pressed="form.color === preset"
                @click="form.color = preset"
              />
              <label class="relative inline-flex h-9 items-center">
                <input
                  v-model="form.color"
                  type="color"
                  class="h-9 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white p-1"
                  aria-label="Свой цвет"
                />
              </label>
            </div>
          </div>
        </div>

        <!-- Сообщение после выдачи -->
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <label class="mb-1.5 block text-sm font-medium text-gray-700" for="mark-notify">
            Сообщение клиенту после выдачи заказа
          </label>
          <textarea
            id="mark-notify"
            v-model="form.notifyText"
            rows="3"
            maxlength="2000"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            placeholder="{имя}, спасибо за покупку! С каждой банки CATSWILL часть средств идёт на благотворительность."
          />
          <p class="mt-1.5 text-xs text-gray-500">
            Отправляется автоматически через 10 минут после выдачи заказа с товаром этой пометки.
            Подстановки: <code class="rounded bg-white px-1">{имя}</code>,
            <code class="rounded bg-white px-1">{название}</code>,
            <code class="rounded bg-white px-1">{номер}</code>.
          </p>
          <p v-if="form.notifyText.trim()" class="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
            <span class="font-semibold text-gray-500">Превью:</span> {{ notifyPreview }}
          </p>
        </div>

        <!-- «Подробнее» -->
        <div class="rounded-xl border border-gray-200 p-4">
          <p class="text-sm font-medium text-gray-700">Кнопка «Подробнее» ведёт на:</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg border px-3.5 py-2 text-sm font-medium transition"
              :class="detailMode === 'text'
                ? 'border-brand-dark bg-brand-dark/5 text-gray-900'
                : 'border-gray-200 text-gray-700 hover:border-gray-300'"
              @click="detailMode = 'text'"
            >
              Текст внутри мини-аппа
            </button>
            <button
              type="button"
              class="rounded-lg border px-3.5 py-2 text-sm font-medium transition"
              :class="detailMode === 'url'
                ? 'border-brand-dark bg-brand-dark/5 text-gray-900'
                : 'border-gray-200 text-gray-700 hover:border-gray-300'"
              @click="detailMode = 'url'"
            >
              Внешняя ссылка
            </button>
          </div>

          <div v-if="detailMode === 'text'" class="mt-3 space-y-3">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-gray-700" for="mark-detail-title">Заголовок</label>
              <input
                id="mark-detail-title"
                v-model="form.detailTitle"
                type="text"
                maxlength="120"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="О программе помощи"
              />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium text-gray-700">Текст</label>
              <RichTextEditor v-model="form.detailBody" />
            </div>
          </div>
          <div v-else class="mt-3">
            <label class="mb-1.5 block text-sm font-medium text-gray-700" for="mark-detail-url">Ссылка</label>
            <input
              id="mark-detail-url"
              v-model="form.detailUrl"
              type="url"
              maxlength="500"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="https://…"
            />
          </div>
        </div>

        <div class="flex items-center gap-3">
          <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input v-model="form.active" type="checkbox" class="h-4 w-4 rounded border-gray-300" />
            Пометка активна
          </label>
          <span class="text-xs text-gray-500">Выключенная пометка не показывается в мини-аппе и сообщения не уходят</span>
        </div>

        <div v-if="formError" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" data-test="mark-form-error">
          {{ formError }}
        </div>

        <!-- Живой превью -->
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Превью блока</p>
          <div
            class="overflow-hidden rounded-2xl p-4 shadow-sm"
            :style="{ background: form.color, color: readableTextColor(form.color) }"
          >
            <div class="flex items-center gap-2.5">
              <img
                v-if="form.icon"
                :src="form.icon"
                alt=""
                class="h-8 w-8 shrink-0 rounded-full bg-white/25 object-contain p-1"
              />
              <span v-else class="flex h-8 w-8 items-center justify-center rounded-full bg-white/25 text-xs font-bold opacity-60">
                ?
              </span>
              <p class="text-sm font-extrabold leading-tight">{{ form.title || 'Название пометки' }}</p>
            </div>
            <p v-if="form.description" class="mt-2 text-xs leading-relaxed opacity-90">{{ form.description }}</p>
            <span
              v-if="hasDetailInForm"
              class="mt-3 inline-flex items-center gap-1 rounded-full bg-white/25 px-3 py-1.5 text-xs font-bold"
            >
              {{ form.detailButtonText || 'Подробнее' }}
            </span>
            <p v-else class="mt-2 text-[11px] font-medium opacity-75">
              Кнопка «Подробнее» появится, когда задан текст или ссылка
            </p>
          </div>
        </div>
      </form>

      <template #footer>
        <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            @click="closeModal"
          >
            Отмена
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
            :disabled="saving || !form.title.trim()"
            data-test="mark-save"
            @click="save"
          >
            {{ saving ? 'Сохраняем…' : editingId ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </template>
    </AdminModal>

    <!-- Подтверждение удаления -->
    <AdminModal
      :isOpen="deleteTarget !== null"
      title="Удалить пометку"
      size="sm"
      :showActions="false"
      @close="deleteTarget = null"
      @cancel="deleteTarget = null"
    >
      <p class="text-sm text-gray-700">
        Пометка <b>{{ deleteTarget?.title }}</b> будет снята со всех линеек.
        Отложенные, но ещё не отправленные сообщения по ней отменятся.
      </p>
      <template #footer>
        <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            class="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700"
            @click="deleteTarget = null"
          >
            Отмена
          </button>
          <button
            type="button"
            class="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
            :disabled="deleting"
            @click="doDelete"
          >
            {{ deleting ? 'Удаляем…' : 'Удалить' }}
          </button>
        </div>
      </template>
    </AdminModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import RichTextEditor from '@/components/admin/RichTextEditor.vue'
import { useAdminStore, type SignificanceMark } from '@/stores/admin'

/**
 * Секция «Пометки значимости» в Настройках — единственное место настройки:
 * внешний вид блока, текст «Подробнее» и шаблон сообщения после выдачи.
 * Список линеек здесь не трогаем: пометка ставится в форме линейки.
 */

const adminStore = useAdminStore()

/** Список пометок. В моках тестов значением бывает ref — разворачиваем оба случая. */
const marks = computed(() => {
  const value = adminStore.significanceMarks as SignificanceMark[] | { value: SignificanceMark[] }
  return Array.isArray(value) ? value : (value as { value: SignificanceMark[] }).value
})
const loading = ref(false)
const loadError = ref('')

const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formError = ref('')

const deleteTarget = ref<SignificanceMark | null>(null)
const deleting = ref(false)
const togglingId = ref<string | null>(null)
/** Ошибка действия над строкой: не заменяет список, показывается над ним. */
const actionError = ref('')

const COLOR_PRESETS = ['#15803d', '#0369a1', '#6d28d9', '#be185d', '#c2410c', '#0f766e', '#374151', '#b91c1c']

const form = reactive({
  title: '',
  description: '',
  adminNote: '',
  icon: '',
  iconFileName: '',
  color: '#16a34a',
  detailTitle: '',
  detailBody: '',
  detailButtonText: '',
  detailUrl: '',
  notifyText: '',
  active: true,
})

const detailMode = ref<'text' | 'url'>('text')

const hasDetailInForm = computed(() =>
  detailMode.value === 'url'
    ? Boolean(form.detailUrl.trim())
    : Boolean(form.detailBody.trim()),
)

const notifyPreview = computed(() =>
  form.notifyText
    .split('{имя}').join('Пётр')
    .split('{название}').join(form.title || 'Название пометки')
    .split('{номер}').join('123'),
)

/**
 * Контрастный цвет текста по WCAG: относительная яркость (linearized sRGB)
 * и порог 0.35 — белому тексту нужен достаточно тёмный фон, иначе заголовок
 * блока теряет читабельность на светло-зелёных/голубых заливках.
 */
function readableTextColor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!match) return '#ffffff'
  const value = parseInt(match[1], 16)
  const channel = (raw: number) => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel((value >> 16) & 255)
    + 0.7152 * channel((value >> 8) & 255)
    + 0.0722 * channel(value & 255)
  return luminance < 0.35 ? '#ffffff' : '#1f2937'
}

function detailSummary(mark: SignificanceMark): string {
  if (mark.detailUrl) return `Ссылка: ${mark.detailUrl}`
  if (mark.detailBody) {
    const hasImage = /<img/i.test(mark.detailBody)
    return hasImage ? 'Текст с картинками внутри мини-аппа' : 'Текст внутри мини-аппа'
  }
  return '— не задано —'
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    await adminStore.fetchSignificanceMarks()
  } catch (error: any) {
    loadError.value = error?.message || 'Не удалось загрузить пометки.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  formError.value = ''
  Object.assign(form, {
    title: '',
    description: '',
    adminNote: '',
    icon: '',
    iconFileName: '',
    color: '#16a34a',
    detailTitle: '',
    detailBody: '',
    detailButtonText: '',
    detailUrl: '',
    notifyText: '',
    active: true,
  })
  detailMode.value = 'text'
  modalOpen.value = true
}

function openEdit(mark: SignificanceMark) {
  editingId.value = mark.id
  formError.value = ''
  Object.assign(form, {
    title: mark.title,
    description: mark.description ?? '',
    adminNote: mark.adminNote ?? '',
    icon: mark.icon,
    iconFileName: mark.icon ? 'сохранённая иконка' : '',
    color: mark.color,
    detailTitle: mark.detailTitle ?? '',
    detailBody: mark.detailBody ?? '',
    detailButtonText: mark.detailButtonText ?? '',
    detailUrl: mark.detailUrl ?? '',
    notifyText: mark.notifyText ?? '',
    active: mark.active,
  })
  detailMode.value = mark.detailUrl ? 'url' : 'text'
  modalOpen.value = true
}

function closeModal() {
  if (saving.value) return
  modalOpen.value = false
}

/** Загрузка своей иконки: читаем файл в data-URL, сервер конвертирует в WebP. */
async function onIconFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    formError.value = 'Иконка должна быть картинкой (PNG, JPG, WebP или SVG).'
    input.value = ''
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    formError.value = 'Файл больше 5 МБ. Возьмите картинку поменьше.'
    input.value = ''
    return
  }
  formError.value = ''
  try {
    form.icon = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    form.iconFileName = file.name
  } catch (error: any) {
    formError.value = error?.message || 'Не удалось прочитать файл.'
  } finally {
    input.value = ''
  }
}

function removeIcon() {
  form.icon = ''
  form.iconFileName = ''
}

async function save() {
  if (!form.title.trim() || saving.value) return
  if (!form.icon) {
    formError.value = 'Загрузите иконку пометки.'
    return
  }
  if (detailMode.value === 'url' && form.detailUrl.trim() && !/^https?:\/\//i.test(form.detailUrl.trim())) {
    formError.value = 'Ссылка должна начинаться с http:// или https://'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      adminNote: form.adminNote.trim() || null,
      icon: form.icon,
      color: form.color,
      detailTitle: form.detailTitle.trim() || null,
      detailBody: detailMode.value === 'text' ? (form.detailBody.trim() || null) : null,
      detailButtonText: form.detailButtonText.trim() || null,
      detailUrl: detailMode.value === 'url' ? (form.detailUrl.trim() || null) : null,
      notifyText: form.notifyText.trim() || null,
      active: form.active,
    }
    if (editingId.value) {
      await adminStore.updateSignificanceMark(editingId.value, payload)
    } else {
      await adminStore.createSignificanceMark(payload)
    }
    modalOpen.value = false
  } catch (error: any) {
    formError.value = error?.message || 'Не удалось сохранить пометку.'
  } finally {
    saving.value = false
  }
}

async function toggleActive(mark: SignificanceMark) {
  togglingId.value = mark.id
  actionError.value = ''
  try {
    await adminStore.updateSignificanceMark(mark.id, { active: !mark.active })
  } catch (error: any) {
    actionError.value = error?.message || 'Не удалось изменить пометку.'
  } finally {
    togglingId.value = null
  }
}

function confirmDelete(mark: SignificanceMark) {
  deleteTarget.value = mark
}

async function doDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await adminStore.deleteSignificanceMark(deleteTarget.value.id)
    deleteTarget.value = null
  } catch (error: any) {
    actionError.value = error?.message || 'Не удалось удалить пометку.'
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  if (!marks.value.length) {
    void load()
  }
})
</script>
