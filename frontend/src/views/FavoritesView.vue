<template>
  <div class="favorites-app" :class="{ editing: isEditing }">
    <!-- Header: как в макете -->
    <header class="favorites-header">
      <button class="back" type="button" aria-label="Вернуться назад" @click="goBack">‹</button>
      <h1>Избранное</h1>
    </header>

    <!-- Требуется Telegram-контекст -->
    <div v-if="favoritesStore.isAuthError" class="state-block">
      <p class="state-title">Откройте мини-приложение из Telegram</p>
      <p class="state-text">Избранное привязано к вашему Telegram-аккаунту.</p>
    </div>

    <!-- Ошибка загрузки -->
    <div v-else-if="loadFailed && !hasGroups" class="state-block">
      <p class="state-title">Не удалось загрузить избранное</p>
      <button class="reorder" type="button" @click="reload">Повторить</button>
    </div>

    <!-- Пустое состояние -->
    <div v-else-if="!favoritesStore.isLoading && !hasGroups" class="state-block">
      <p class="state-title">В избранном пока пусто</p>
      <p class="state-text">Откройте категорию и нажмите «Избранное» на линейке.</p>
      <button class="reorder" type="button" @click="goHome">К категориям</button>
    </div>

    <!-- Скелетон -->
    <div v-else-if="favoritesStore.isLoading && !hasGroups" class="list" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="card card--skeleton"></div>
    </div>

    <template v-else>
      <!-- Toolbar: кнопка режима сортировки -->
      <div class="toolbar">
        <button class="reorder" id="edit" type="button" :aria-pressed="isEditing ? 'true' : 'false'"
          :disabled="reorderPending" @click="toggleEditing">
          {{ isEditing ? 'Сохранить изменения' : '↕ Изменить очередность' }}
        </button>
      </div>

      <!-- Список линеек: каталогные LiquidLineTree-карточки в свёрнутом виде;
           режим сортировки переключает их на грид-карточки макета. -->
      <div class="list" ref="listEl" @pointerdown="onPointerDown" @pointermove="onPointerMove"
        @pointerup="endDrag($event)" @pointercancel="endDrag($event, true)"
        @lostpointercapture="endDrag($event, true)" @keydown="onListKeydown">
        <!-- Обычный режим: карточки каталога 1в1 -->
        <template v-if="!isEditing">
          <LiquidLineTree v-for="group in liquidGroups" :key="group.id" :group="group"
            :fallback-image="PLACEHOLDER_IMAGE" :expanded-groups="liquidExpansionState"
            :show-promo-badges="false"
            @toggle="toggleLiquidExpansion" @showToast="showToast" />
        </template>

        <!-- Режим сортировки: компактные карточки с ручками.
             Источник — те же дедуплицированные корни liquidGroups:
             иначе «родитель + вложенная избранная» дублировались
             фантомами после сохранения. -->
        <template v-else>
          <article v-for="group in liquidGroups" :key="group.id" :data-id="group.id" class="card"
            :class="{ unavailable: group.unavailable }">
            <div class="card-hit">
              <div class="sort-controls">
                <span class="handle" role="button"
                  :aria-label="`Переместить ${group.name || 'линейку'}. Используйте стрелки вверх и вниз.`"
                  tabindex="0">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </span>
              </div>
              <div class="picture">
                <img v-if="group.coverImage" :src="group.coverImage" :alt="group.name" loading="lazy"
                  decoding="async" />
                <svg v-else viewBox="0 0 48 48" fill="none" aria-hidden="true">
                  <rect x="8" y="7" width="32" height="34" rx="7" stroke="currentColor" stroke-width="2" />
                  <path d="m13 32 8-8 6 6 5-5 5 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round" />
                  <circle cx="30" cy="17" r="3" fill="currentColor" />
                </svg>
              </div>
              <div class="card-body">
                <h2 class="name">{{ group.name || 'Линейка' }}</h2>
                <p v-if="group.unavailable" class="name-unavailable">Нет в наличии</p>
              </div>
            </div>
          </article>
        </template>
      </div>
      <p class="announcement" role="status" aria-live="polite">{{ announcement }}</p>
    </template>

    <!-- Кнопка корзины: 1в1 с главной (HomeView) -->
    <Transition name="cart-slide">
      <div v-if="!isEditing && cartItemCount > 0" class="cart-cta">
        <button class="cart-button" type="button" @click="goToCheckout">
          <svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg"
            class="cart-icon">
            <path d="M1 1H3.5L4.5 3M4.5 3L6.5 9H13.5L15.5 3H4.5Z" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="6" cy="13" r="1.5" stroke="currentColor" stroke-width="1.6" />
            <circle cx="13" cy="13" r="1.5" stroke="currentColor" stroke-width="1.6" />
          </svg>
          <span class="cart-text">Заказ на {{ cartAmount }} BYN</span>
        </button>
      </div>
    </Transition>

    <!-- Toast -->
    <ToastNotification v-if="toastMessage" :key="toastKey" :message="toastMessage" :type="toastType"
      :duration="toastDuration" bottom-offset="calc(env(safe-area-inset-bottom, 0px) + 96px)"
      @close="toastMessage = ''" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ToastNotification from '@/components/ToastNotification.vue'
import FavoriteGroupHeart from '@/components/product/FavoriteGroupHeart.vue'
import LiquidLineTree from '@/components/product/liquid/LiquidLineTree.vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useCartStore } from '@/stores/cart'
import { useCatalogStore, type Product, type ProductMark } from '@/stores/catalog'

const PLACEHOLDER_IMAGE = '/placeholder-category.png'

/** Линейка в дереве каталога — тот же интерфейс, что в CategoryView. */
interface LiquidGroup {
  id: string
  name: string
  slug: string
  order: number
  coverImage: string | null
  products: Product[]
  productCount: number
  badge?: string | null
  badgeColor?: string | null
  metaLabel?: string | null
  metaValue?: string | null
  strengthTier?: string | null
  isNew?: boolean
  newSince?: string | null
  mark?: ProductMark | null
  /** Линейка закончилась: серая карточка с пометкой «Нет в наличии». */
  unavailable?: boolean
  children: LiquidGroup[]
}

const router = useRouter()
const favoritesStore = useFavoritesStore()
const cartStore = useCartStore()
const catalogStore = useCatalogStore()

const toastMessage = ref('')
const toastType = ref<'error' | 'success' | 'info'>('info')
const toastKey = ref(0)
const toastDuration = ref(3500)

const isEditing = ref(false)
const reorderPending = ref(false)
const announcement = ref('')
const listEl = ref<HTMLElement | null>(null)
/** Раскрытие линеек каталога (как liquidExpansionState в CategoryView). */
const liquidExpansionState = ref<Record<string, boolean>>({})

const loadFailed = computed(() => Boolean(favoritesStore.loadError))
const hasGroups = computed(() => favoritesStore.groups.length > 0)

const cartItemCount = computed(() => cartStore.totalItems)
const cartAmount = computed(() => cartStore.totalAmount.toFixed(2))

/**
 * Каталог должен быть загружен, чтобы строить карточки линеек.
 * На странице избранного товары нужны все: инициализируем при входе.
 */
const catalogReady = computed(() => catalogStore.allProducts.length > 0)

/**
 * Дерево линеек избранного — 1в1 как в каталоге (CategoryView):
 * те же LiquidGroup-узлы из категорий и allProducts, только корни
 * ограничены избранными группами. Вложенные подлинейки разворачиваются
 * внутри карточки, как на странице категории.
 */
const liquidGroups = computed<LiquidGroup[]>(() => {
  if (!favoritesStore.groups.length) return []

  const productsPool = catalogStore.allProducts.length
    ? catalogStore.allProducts
    : catalogStore.products

  const favoriteIds = new Set(favoritesStore.groups.map((g) => g.groupId))
  // Идентификаторы всех товаров избранных линеек — для отсечения вкусов,
  // которых нет в избранном.
  const favoriteProductIds = new Set(
    favoritesStore.groups.flatMap((g) => g.items.map((i) => i.productId)),
  )

  // Каждая избранная группа — свой корень карточки. seenCategoryIds
  // здесь не годился: несколько избранных линеек одной категории
  // (PODONKI + ЗЛАЯ МОНАШКА + ...) пропускались после первой.
  const roots: LiquidGroup[] = []
  const builtIds = new Set<string>()

  for (const category of catalogStore.categories) {
    for (const group of category.groups) {
      if (!favoriteIds.has(group.id)) continue
      if (builtIds.has(group.id)) continue
      // Группа, вложенная в другую избранную, уже внутри родительского
      // дерева: отдельной карточкой не строим.
      const parentId = (group as { parentId?: string | null }).parentId
      if (parentId && favoriteIds.has(parentId)) continue
      builtIds.add(group.id)
      roots.push(buildGroupTree(group, category, productsPool, favoriteProductIds, builtIds))
    }
  }

  // Недоступные линейки, которых НЕТ в каталоге: витрина скрывает
  // группы с нулевым остатком (hide_empty/totalProductCount=0), поэтому
  // из каталога карточка не построится. Строим серую карточку из данных
  // избранного: имя, обложка, пометка «Нет в наличии».
  const unavailableGroups = favoritesStore.groups.filter(
    (g) => g.groupUnavailable && g.groupId && !builtIds.has(g.groupId),
  )
  for (const g of unavailableGroups) {
    builtIds.add(g.groupId)
    roots.push({
      id: g.groupId,
      name: g.groupName || 'Линейка',
      slug: g.groupSlug || '',
      order: 0,
      // Обложку отдаёт сервер избранного (группа → категория).
      coverImage: g.groupCover || null,
      products: [],
      productCount: 0,
      badge: null,
      badgeColor: null,
      metaLabel: null,
      metaValue: null,
      strengthTier: null,
      isNew: false,
      newSince: null,
      mark: null,
      unavailable: true,
      children: [],
    })
  }

  // Порядок карточек — как в favoritesStore.groups: сохранённый
  // drag-n-drop порядок (group_position) переживает перезаход.
  const position = new Map(favoritesStore.groups.map((g) => [g.groupId, g.groupPosition ?? Number.MAX_SAFE_INTEGER]))
  const unavailable = new Set(
    favoritesStore.groups.filter((g) => g.groupUnavailable).map((g) => g.groupId),
  )
  return roots.sort((a, b) => {
    // Доступные — выше закончившихся.
    const ua = unavailable.has(a.id)
    const ub = unavailable.has(b.id)
    if (ua !== ub) return ua ? 1 : -1
    return (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  })
})

/** Рекурсивное дерево подгрупп с товарами (как buildLiquidTree каталога). */
function buildGroupTree(
  group: { id: string; name: string; slug: string; order: number; coverImage?: string | null; parentId?: string | null; badge?: string | null; badgeColor?: string | null; metaLabel?: string | null; metaValue?: string | null; strengthTier?: string | null; isNew?: boolean; newSince?: string | null; mark?: ProductMark | null },
  category: { id: string; groups: Array<{ id: string }> },
  productsPool: Product[],
  favoriteProductIds: Set<string>,
  builtIds?: Set<string>,
): LiquidGroup {
  if (builtIds) builtIds.add(group.id)
  // Товары только этой группы; оставляем только избранные позиции
  // (в наличии — сервер уже отфильтровал).
  const groupProducts = productsPool.filter(
    (p) => p.groupId === group.id && favoriteProductIds.has(p.id),
  )
  const children = category.groups
    .filter((g) => (g as { parentId?: string | null }).parentId === group.id)
    .map((child) =>
      buildGroupTree(child as never, category, productsPool, favoriteProductIds, builtIds),
    )
    .filter((child) => child.products.length > 0 || child.children.length > 0)

  // Плашки акций/социальных товаров в избранном не показываем:
  // иконки-ярлыки каталога здесь только шумят.
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    order: group.order ?? 0,
    coverImage: group.coverImage || null,
    products: groupProducts,
    productCount: groupProducts.length,
    badge: null,
    badgeColor: null,
    metaLabel: group.metaLabel ?? null,
    metaValue: group.metaValue ?? null,
    strengthTier: group.strengthTier ?? null,
    isNew: false,
    newSince: null,
    mark: null,
    // Линейка есть в каталоге, но живых вкусов нет (сервер пометил
    // группу недоступной): серая карточка с пометкой.
    unavailable: groupProducts.length === 0 && children.length === 0,
    children,
  }
}

/** Раскрытие/свёртывание линейки — как в каталоге. */
function toggleLiquidExpansion(groupId: string) {
  liquidExpansionState.value = {
    ...liquidExpansionState.value,
    [groupId]: !(liquidExpansionState.value[groupId] ?? false),
  }
}

/* ===== Drag-n-drop: точный перенос логики макета ===== */
interface DragState {
  id: number
  handle: HTMLElement
  row: HTMLElement
  floating: HTMLElement
  startY: number
  offset: number
  rect: DOMRect
  order: HTMLElement[]
}

let drag: DragState | null = null
const reduceMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function plural(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function announcePosition(row: HTMLElement) {
  if (!listEl.value) return
  const name = row.querySelector('.name')?.textContent ?? ''
  const index = [...listEl.value.children].indexOf(row)
  announcement.value = `${name}: место ${index + 1} из ${listEl.value.children.length}`
}

async function toggleEditing() {
  if (drag) return
  if (isEditing.value) {
    // Сохраняем порядок на сервере.
    const ids = listEl.value ? [...listEl.value.children].map((row) => (row as HTMLElement).dataset.id ?? '') : []
    reorderPending.value = true
    try {
      await favoritesStore.reorderGroups(ids.filter(Boolean))
      announcement.value = 'Изменения сохранены.'
    } catch {
      showToast('Не удалось сохранить порядок', 'error')
      announcement.value = ''
    } finally {
      reorderPending.value = false
    }
  } else {
    announcement.value = ''
  }
  isEditing.value = !isEditing.value
}

/* Под указателем — отдельная плавающая копия. Оригинал резервирует место
   в списке. FLIP-анимация плавно сдвигает соседей при смене позиции. */
function placeRow(row: HTMLElement, next: HTMLElement | null) {
  if (!listEl.value) return
  if (row.nextElementSibling === next) return
  const others = [...listEl.value.children].filter(
    (el) => el !== row,
  ) as HTMLElement[]
  const before = new Map(others.map((el) => [el, el.getBoundingClientRect().top]))
  others.forEach((el) => el.getAnimations().forEach((animation) => animation.cancel()))
  listEl.value.insertBefore(row, next)
  if (!reduceMotion) {
    others.forEach((el) => {
      const dy = (before.get(el) ?? 0) - el.getBoundingClientRect().top
      if (dy) {
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' },
        )
      }
    })
  }
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement
  const handle = target.closest<HTMLElement>('.handle')
  if (!isEditing.value || !handle || drag || !event.isPrimary || event.button !== 0) return
  if (!listEl.value) return
  event.preventDefault()

  const row = handle.closest<HTMLElement>('.card')
  if (!row) return
  const rect = row.getBoundingClientRect()

  const floating = row.cloneNode(true) as HTMLElement
  floating.classList.add('floating')
  floating.setAttribute('aria-hidden', 'true')
  floating.querySelectorAll('button').forEach((button) => {
    button.tabIndex = -1
  })
  Object.assign(floating.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: 'scale(1)',
  })
  document.body.append(floating)

  drag = {
    id: event.pointerId,
    handle,
    row,
    floating,
    startY: event.clientY,
    offset: event.clientY - rect.top,
    rect,
    order: [...listEl.value.children] as HTMLElement[],
  }
  listEl.value.setPointerCapture(event.pointerId)
  row.classList.add('dragging')
  document.body.classList.add('is-dragging')
  floating.animate([{ scale: '1' }, { scale: '1.025' }], {
    duration: reduceMotion ? 0 : 140,
    easing: 'ease-out',
  })
  floating.style.scale = '1.025'
}

function onPointerMove(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId || !listEl.value) return
  const dy = event.clientY - drag.startY
  // Перемещение без transition: карточка точно следует за указателем.
  drag.floating.style.transform = `translateY(${dy}px)`

  const center = event.clientY - drag.offset + drag.rect.height / 2
  const others = [...listEl.value.children].filter(
    (row) => row !== drag!.row,
  ) as HTMLElement[]
  // offsetTop соседей — без учёта текущей анимации: нет дрожания порогов.
  const next = others.find(
    (row) => center < row.offsetTop - window.scrollY + row.offsetHeight / 2,
  )
  placeRow(drag.row, next ?? null)

  const edge = 80
  if (event.clientY < edge) window.scrollBy(0, -12)
  else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 12)
}

function endDrag(event: PointerEvent, cancelled = false) {
  if (!drag || event.pointerId !== drag.id || !listEl.value) return
  const current = drag
  drag = null
  if (cancelled) {
    // Возврат исходного порядка.
    current.order.forEach((row) => listEl.value?.append(row))
  }
  if (listEl.value.hasPointerCapture(current.id)) {
    listEl.value.releasePointerCapture(current.id)
  }
  document.body.classList.remove('is-dragging')

  const target = current.row.getBoundingClientRect()
  current.floating.getAnimations().forEach((a) => a.cancel())
  const animation = current.floating.animate(
    [
      { transform: current.floating.style.transform, scale: '1.025' },
      { transform: `translateY(${target.top - current.rect.top}px)`, scale: '1' },
    ],
    {
      duration: reduceMotion ? 0 : 180,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    },
  )
  const editButton = document.getElementById('edit') as HTMLButtonElement | null
  if (editButton) editButton.disabled = true
  animation.finished
    .catch(() => {})
    .then(() => {
      current.floating.remove()
      current.row.classList.remove('dragging')
      if (editButton) editButton.disabled = false
      current.handle.focus({ preventScroll: true })
      announcePosition(current.row)
    })
}

function onListKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const handle = target.closest<HTMLElement>('.handle')
  if (!isEditing.value || !handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  if (!listEl.value) return
  event.preventDefault()
  const row = handle.closest<HTMLElement>('.card')
  if (!row) return
  if (event.key === 'ArrowUp' && row.previousElementSibling) {
    listEl.value.insertBefore(row, row.previousElementSibling)
  } else if (event.key === 'ArrowDown' && row.nextElementSibling) {
    listEl.value.insertBefore(row.nextElementSibling, row)
  }
  handle.focus()
  announcePosition(row)
}

function goToCheckout() {
  hapticFeedback()
  router.push('/checkout')
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

function goHome() {
  router.push('/')
}

function reload() {
  void favoritesStore.fetchFavorites()
}

function showToast(message: string, type: 'error' | 'success' | 'info' = 'info') {
  toastMessage.value = message
  toastType.value = type
  toastKey.value++
}

function hapticFeedback() {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
}

onMounted(async () => {
  // Каталог нужен для карточек линеек: инициализируем, если ещё не загружен.
  if (!catalogStore.allProducts.length || !catalogStore.categories.length) {
    void catalogStore.initialize()
  }
  // Свежие остатки при каждом входе на экран.
  void favoritesStore.fetchFavorites()
})

onBeforeUnmount(() => {
  if (drag) {
    drag.floating.remove()
    drag.row.classList.remove('dragging')
    document.body.classList.remove('is-dragging')
    drag = null
  }
  document.body.classList.remove('is-dragging')
})
</script>

<style scoped>
/* ===== Точный перенос макета favorites-layout.html ===== */
.favorites-app {
  max-width: 430px;
  margin: auto;
  min-height: 100svh;
  padding-bottom: 110px;
  background: #f5f6fa;
  color: #1c1c1c;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  position: relative;
}

.favorites-header {
  background: white;
  border-radius: 0 0 24px 24px;
  padding: 24px 20px;
  text-align: center;
  position: relative;
}

.favorites-header h1 {
  font-size: 21px;
  margin: 0;
}

.back {
  position: absolute;
  left: 22px;
  top: 24px;
  font-size: 25px;
  line-height: 24px;
  width: 44px;
  height: 44px;
  margin: -10px 0 0 -10px;
  border: 0;
  background: transparent;
  color: #1c1c1c;
  cursor: pointer;
}

.toolbar {
  display: flex;
  justify-content: stretch;
  padding: 18px 10px 14px;
}

button {
  font: inherit;
  cursor: pointer;
}

.reorder {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  background: linear-gradient(110deg, #e62c20, #a92520);
  color: white;
  font-size: 13px;
  font-weight: 600;
}

.list {
  /* Grid без явных колонок раздувает дорожку под max-content длинных
     заголовков — карточка уезжает за экран вместе с кнопками.
     Одна колонка minmax(0,1fr) сжимает контент и включает ellipsis. */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  /* Дорожка не шире контейнера: длинные названия режутся, кнопки на месте. */
  max-width: 100%;
  min-width: 0;
  gap: 10px;
  /* В обычном режиме внутри — карточки каталога (LiquidLineTree):
     те же отступы, что в liquid-showcase категории. */
  padding: 0 10px;
}

.card {
  border-radius: 24px;
  background: #fff;
  overflow: hidden;
}

/* Кликабельная шапка карточки: повторяет грид макета. */
.card-hit {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) 36px;
  gap: 13px;
  align-items: center;
  padding: 16px;
  min-height: 138px;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Кнопка «Избранное» (убрать линейку) в теле карточки. */
.card-favorite {
  display: inline-flex;
  align-items: center;
  margin-top: 4px;
}

.card-hit:focus-visible {
  outline: 2px solid #95201c;
  outline-offset: -3px;
}

.editing .card-hit {
  grid-template-columns: 32px 72px minmax(0, 1fr);
  gap: 10px;
  padding: 16px 12px;
}

.card--skeleton {
  animation: card-skeleton 1.2s ease-in-out infinite;
  background: linear-gradient(100deg, #ffffff 40%, #eceff3 50%, #ffffff 60%);
  background-size: 200% 100%;
}

@keyframes card-skeleton {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -20% 0;
  }
}

.picture {
  height: 94px;
  border: 1px solid #e3e6ed;
  border-radius: 16px;
  background: linear-gradient(145deg, #f7f8fa, #e8ebf1);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.picture img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.picture svg {
  width: 44px;
  height: 44px;
  color: #abb2bf;
}

.name {
  font-size: 16px;
  line-height: 1.22;
  font-weight: 700;
  margin: 0 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.name-unavailable {
  margin: 0;
  font-family: -apple-system, 'SF Pro Display', sans-serif;
  font-weight: 600;
  font-size: 13px;
  line-height: 16px;
  color: #888e99;
}

.unavailable {
  background: #e5e7ec;
  color: #888e99;
}

.unavailable .picture {
  filter: grayscale(1);
  opacity: 0.55;
  background: #d9dde4;
  border-color: #d1d5dd;
}

.status {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  color: #737b89;
  margin-top: 3px;
}

.unavailable .arrow {
  opacity: 0.45;
}

/* Стрелка поворачивается при раскрытии — как шеврон каталога. */
.arrow {
  transition: transform 0.2s ease;
  border: 0;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  background: #f3f4f7;
  color: #747b85;
  font-size: 24px;
  display: grid;
  place-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  font-family: inherit;
}

.arrow--open {
  transform: rotate(90deg);
}

.sort-controls {
  display: none;
  align-items: center;
  flex-direction: column;
}

.editing .sort-controls {
  display: flex;
}

.handle {
  display: none;
  border: 0;
  background: transparent;
  color: #9299a6;
  width: 32px;
  height: 48px;
  padding: 5px;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.handle svg {
  width: 22px;
  height: 22px;
  pointer-events: none;
}

.editing .handle {
  display: flex;
}

.editing .arrow {
  display: none;
}

.editing .picture {
  height: 82px;
}

.card.dragging {
  visibility: hidden;
}

.card.floating {
  position: fixed;
  z-index: 1000;
  margin: 0;
  pointer-events: none;
  background: #fff;
  border-radius: 24px;
  transform-origin: center;
  box-shadow: 0 14px 34px #20283826;
  will-change: transform;
}

.card.floating .card-hit {
  grid-template-columns: 32px 72px minmax(0, 1fr);
  gap: 10px;
  padding: 16px 12px;
}

.floating .sort-controls,
.floating .handle {
  display: flex;
}

.floating .picture {
  height: 82px;
}

.floating .arrow {
  display: none;
}

:global(body.is-dragging),
:global(body.is-dragging *) {
  cursor: grabbing !important;
  user-select: none !important;
}

@media (max-width: 350px) {
  .card.floating .card-hit {
    grid-template-columns: 28px 58px minmax(0, 1fr);
    gap: 8px;
  }
  .floating .picture {
    height: 70px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card.floating {
    will-change: auto;
  }
  .card--skeleton {
    animation: none;
  }
}

.handle:active {
  cursor: grabbing;
}

.handle:focus-visible,
.reorder:focus-visible {
  outline: 2px solid #95201c;
  outline-offset: 3px;
}

.announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 350px) {
  .editing .card-hit {
    grid-template-columns: 28px 58px minmax(0, 1fr);
    gap: 8px;
  }
  .editing .picture {
    height: 70px;
  }
  .name {
    font-size: 14px;
  }
}

/* ===== Корзина: красный nav из макета ===== */
/* ===== Кнопка корзины: 1в1 с HomeView ===== */
.cart-cta {
  position: fixed;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  left: 0;
  right: 0;
  z-index: 50;
  padding: 0 1rem;
  pointer-events: none;
  transition: bottom 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

/* Figma: Red gradient */
.cart-button {
  width: 100%;
  max-width: 345px;
  height: 64px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0 2rem;
  position: relative;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  border: none;
  border-radius: 528px;
  color: #ffffff;
  cursor: pointer;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.25s ease;
}

.cart-button:hover {
  transform: translateY(-2px);
}

.cart-button:active {
  transform: translateY(-1px);
}

.cart-button:focus-visible {
  outline: 3px solid #ed0000;
  outline-offset: 2px;
}

.cart-icon {
  flex-shrink: 0;
  color: #ffffff;
  transition: transform 0.25s ease;
}

.cart-button:hover .cart-icon {
  transform: scale(1.1);
}

.cart-text {
  font-family: 'Montserrat', sans-serif;
  font-size: 16px;
  font-weight: 500;
  color: #ffffff;
}

/* Появление снизу с отскоком — как на главной. */
.cart-slide-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cart-slide-leave-active {
  transition: all 0.3s ease-out;
}

.cart-slide-enter-from,
.cart-slide-leave-to {
  transform: translateY(150%);
  opacity: 0;
}

@media (max-width: 768px) {
  .cart-cta {
    padding: 0 0.75rem;
  }
  .cart-button {
    max-width: 320px;
    height: 56px;
    padding: 0 1.5rem;
  }
  .cart-text {
    font-size: 15px;
  }
}

@media (max-width: 480px) {
  .cart-cta {
    padding: 0 0.5rem;
  }
  .cart-button {
    max-width: 300px;
    height: 52px;
    padding: 0 1.25rem;
    gap: 0.5rem;
  }
  .cart-text {
    font-size: 14px;
  }
}

/* ===== Служебные состояния ===== */
.state-block {
  padding: 48px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.state-block .reorder {
  margin-top: 12px;
  max-width: 260px;
}

.state-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1c;
}

.state-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #959cab;
}
</style>
