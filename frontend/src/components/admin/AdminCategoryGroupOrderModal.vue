<template>
  <AdminModal :is-open="isOpen" :title="`Порядок: ${categoryName}`" size="screen"
    description="Перетаскивайте названия. Родитель перемещается вместе с вложенными линейками."
    :show-actions="false" :is-loading="busy" reference-design @close="requestClose" @cancel="requestClose">
    <div class="group-order" @keydown="onEscape">
      <p id="group-order-help" class="group-order-help">Порядок сохраняется автоматически. Вложенные линейки перемещаются внутри своего родителя.</p>
      <p v-if="errorText" class="group-order-error" role="alert">{{ errorText }}</p>
      <ol v-if="displayRows.length" ref="listRef" class="group-order-list" aria-label="Порядок линеек" :aria-busy="busy">
        <li v-for="(group, index) in displayRows" :key="group.id" :data-group-id="group.id"
          class="group-order-row" :class="{ 'group-order-row--empty-parent': emptyParentIds.has(group.id), 'group-order-row--moving': movingIds.has(group.id), 'group-order-row--before': dropBoundary === index, 'group-order-row--after': dropBoundary === displayRows.length && index === displayRows.length - 1 }"
          :style="{ paddingInlineStart: `${Math.min(group.depth, 8) * 12 + 6}px` }">
          <button type="button" class="group-order-handle" :disabled="busy"
            :aria-label="`Переместить ${group.name}, уровень ${group.depth + 1}`"
            :aria-pressed="keyboardId === group.id || pointer?.id === group.id"
            aria-describedby="group-order-keyboard-help" :data-handle-id="group.id"
            @pointerdown="startPointer($event, group.id)" @pointermove="movePointer"
            @pointerup="finishPointer" @pointercancel="cancelInteraction" @lostpointercapture="cancelPointer"
            @keydown="onHandleKey($event, group.id)" @click.prevent>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="7" cy="5" r="1.3"/><circle cx="13" cy="5" r="1.3"/><circle cx="7" cy="10" r="1.3"/><circle cx="13" cy="10" r="1.3"/><circle cx="7" cy="15" r="1.3"/><circle cx="13" cy="15" r="1.3"/></svg>
          </button>
          <span class="group-order-name" :title="emptyParentIds.has(group.id) ? 'Нет товаров в наличии, включая вложенные линейки' : undefined" :class="{ 'group-order-name--parent': displayRows[index + 1] && displayRows[index + 1]!.depth > group.depth }">{{ group.name }}</span>
        </li>
      </ol>
      <p v-else class="group-order-empty">Линеек пока нет.</p>
      <div class="group-order-footer">
        <span role="status" aria-live="polite">{{ busy ? 'Сохраняем порядок…' : keyboardId ? 'Выбрано для перемещения' : 'Перетаскивайте за ручку слева' }}</span>
        <button type="button" :disabled="busy" @click="requestClose">Готово</button>
      </div>
      <p id="group-order-keyboard-help" class="group-order-keyboard-help">Клавиатура: пробел — выбрать, ↑/↓ — переместить, Enter — применить, Esc — отменить перемещение.</p>
      <span class="group-order-sr" aria-live="polite">{{ announcement }}</span>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { areGroupSiblings, groupBlockRange, moveGroupSubtree, siblingGroupId, type GroupOrderRow } from '@/utils/categoryGroupOrder'

const props = withDefaults(defineProps<{ isOpen: boolean; categoryName: string; groups: GroupOrderRow[]; busy?: boolean; errorText?: string }>(), { busy: false, errorText: '' })
const emit = defineEmits<{ close: []; reorder: [groups: GroupOrderRow[]] }>()
const listRef = ref<HTMLOListElement | null>(null)
const pointer = ref<{ id: string; pointerId: number; x: number; y: number; started: boolean } | null>(null)
const drop = ref<{ id: string; placement: 'before' | 'after' } | null>(null)
const keyboardId = ref<string | null>(null)
const keyboardDraft = ref<GroupOrderRow[] | null>(null)
const announcement = ref('')
const displayRows = computed(() => keyboardDraft.value ?? props.groups)
const emptyParentIds = computed(() => {
  const rows = displayRows.value
  const emptyIds = new Set<string>()
  rows.forEach((group, index) => {
    if (!rows[index + 1] || rows[index + 1]!.depth <= group.depth) return
    const range = groupBlockRange(rows, group.id)!
    const hasStock = rows.slice(range.start, range.end).some(row => Number(row.totalStockSum ?? row.stockSum ?? 0) > 0)
    if (!hasStock) emptyIds.add(group.id)
  })
  return emptyIds
})
let pointerY = 0
let pointerX = 0
let scrollFrame = 0
const movingIds = computed(() => {
  const id = pointer.value?.started ? pointer.value.id : keyboardId.value
  const range = id ? groupBlockRange(displayRows.value, id) : null
  return new Set(range ? displayRows.value.slice(range.start, range.end).map(row => row.id) : [])
})
const dropBoundary = computed(() => {
  if (!drop.value) return -1
  const range = groupBlockRange(displayRows.value, drop.value.id)
  return range ? (drop.value.placement === 'before' ? range.start : range.end) : -1
})

function cancelPointer() {
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  pointer.value = null
  drop.value = null
}
function cancelInteraction() {
  cancelPointer()
  keyboardId.value = null
  keyboardDraft.value = null
}
watch(() => [props.isOpen, props.busy, props.groups] as const, cancelInteraction)
onBeforeUnmount(cancelInteraction)
function requestClose() {
  if (props.busy) return
  cancelInteraction()
  emit('close')
}
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!pointer.value && !keyboardId.value)) return
  event.preventDefault()
  event.stopPropagation()
  cancelInteraction()
  announcement.value = 'Перемещение отменено'
}
function updateDrop() {
  const list = listRef.value
  const source = props.groups.find(row => row.id === pointer.value?.id)
  if (!list || !source) { drop.value = null; return }
  const bounds = list.getBoundingClientRect()
  if (pointerX < bounds.left || pointerX > bounds.right || pointerY < bounds.top || pointerY > bounds.bottom) { drop.value = null; return }
  const elements = [...list.querySelectorAll<HTMLElement>('[data-group-id]')]
  const hovered = elements.find(element => {
    const rect = element.getBoundingClientRect()
    return pointerY >= rect.top && pointerY <= rect.bottom
  })
  let index = props.groups.findIndex(row => row.id === hovered?.dataset.groupId)
  if (index < 0) { drop.value = null; return }
  while (index > 0 && props.groups[index]!.depth > source.depth) index -= 1
  const candidate = props.groups[index]!
  if (candidate.id === source.id || !areGroupSiblings(source, candidate)) { drop.value = null; return }
  const element = elements.find(item => item.dataset.groupId === candidate.id)
  if (!element) { drop.value = null; return }
  const rect = element.getBoundingClientRect()
  drop.value = { id: candidate.id, placement: pointerY < rect.top + rect.height / 2 ? 'before' : 'after' }
}
function autoScroll() {
  scrollFrame = 0
  const list = listRef.value
  if (!list || !pointer.value?.started) return
  const bounds = list.getBoundingClientRect()
  if (pointerX >= bounds.left && pointerX <= bounds.right) {
    const speed = pointerY < bounds.top + 36 ? -10 : pointerY > bounds.bottom - 36 ? 10 : 0
    if (speed) { list.scrollTop += speed; updateDrop() }
  }
  scrollFrame = requestAnimationFrame(autoScroll)
}
function startPointer(event: PointerEvent, id: string) {
  if (props.busy || !props.isOpen || event.button !== 0 || event.isPrimary === false) return
  cancelInteraction()
  pointer.value = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false }
  pointerX = event.clientX
  pointerY = event.clientY
  const target = event.currentTarget as HTMLElement
  target.focus({ preventScroll: true })
  target.setPointerCapture?.(event.pointerId)
}
function movePointer(event: PointerEvent) {
  const active = pointer.value
  if (!active || active.pointerId !== event.pointerId) return
  pointerX = event.clientX
  pointerY = event.clientY
  if (!active.started && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5) return
  event.preventDefault()
  if (!active.started) {
    active.started = true
    announcement.value = 'Перемещайте линейку к нужному месту'
    scrollFrame = requestAnimationFrame(autoScroll)
  }
  updateDrop()
}
function finishPointer(event: PointerEvent) {
  const active = pointer.value
  if (!active || event.pointerId !== active.pointerId) return
  const target = drop.value
  const changed = active.started && target ? moveGroupSubtree(props.groups, active.id, target.id, target.placement) : props.groups
  cancelPointer()
  if (!props.busy && changed !== props.groups) emit('reorder', changed)
}
async function focusHandle(id: string) {
  await nextTick()
  const handle = [...(listRef.value?.querySelectorAll<HTMLButtonElement>('[data-handle-id]') ?? [])].find(element => element.dataset.handleId === id)
  handle?.focus({ preventScroll: true })
  handle?.scrollIntoView?.({ block: 'nearest' })
}
function onHandleKey(event: KeyboardEvent, id: string) {
  if (props.busy || !props.isOpen) return
  if (event.key === 'Escape') { onEscape(event); return }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    if (!keyboardId.value) {
      cancelPointer()
      keyboardId.value = id
      keyboardDraft.value = [...props.groups]
      announcement.value = 'Линейка выбрана. Используйте стрелки вверх и вниз'
    } else if (keyboardId.value === id) {
      const changed = keyboardDraft.value!
      cancelInteraction()
      if (changed.some((row, index) => row.id !== props.groups[index]?.id)) emit('reorder', changed)
      void focusHandle(id)
    }
    return
  }
  if (keyboardId.value !== id || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const direction = event.key === 'ArrowUp' ? -1 : 1
  const target = siblingGroupId(displayRows.value, id, direction)
  if (!target) { announcement.value = 'Достигнут край списка этого уровня'; return }
  keyboardDraft.value = moveGroupSubtree(displayRows.value, id, target, direction === -1 ? 'before' : 'after')
  announcement.value = `Линейка перемещена ${direction === -1 ? 'выше' : 'ниже'}. Enter — сохранить`
  void focusHandle(id)
}
</script>

<style scoped>
.group-order { display: flex; flex-direction: column; flex: 1; min-height: 0; color: #102456; }
.group-order-help, .group-order-keyboard-help { margin: 0 0 4px; font-size: 11px; line-height: 1.35; color: #52617b; }
.group-order-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin: 0; padding: 2px 0; list-style: none; border: 1px solid #e4e9f2; border-radius: 12px; scrollbar-width: thin; scrollbar-color: #8999b7 #f0f4fa; }
.group-order-row { position: relative; display: flex; align-items: center; min-height: 28px; padding: 0 8px 0 6px; gap: 2px; background: #fff; }
.group-order-row + .group-order-row { border-top: 1px solid #edf0f6; }
.group-order-row--moving { background: #edf3ff; color: #174ab9; }
.group-order-row--before::before, .group-order-row--after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 2px; background: #1759ed; z-index: 1; }
.group-order-row--before::before { top: -1px; }
.group-order-row--after::after { bottom: 0; }
.group-order-name { min-width: 0; overflow-wrap: anywhere; font-size: 12px; line-height: 1.35; }
.group-order-name--parent { font-weight: 700; }
.group-order-row--empty-parent .group-order-name { opacity: .2; }
.group-order-row--empty-parent .group-order-handle { opacity: .35; }
.group-order-row--empty-parent:hover .group-order-name, .group-order-row--empty-parent:focus-within .group-order-name { opacity: .65; }
.group-order-row--empty-parent:hover .group-order-handle, .group-order-row--empty-parent:focus-within .group-order-handle, .group-order-row--empty-parent.group-order-row--moving .group-order-name, .group-order-row--empty-parent.group-order-row--moving .group-order-handle { opacity: 1; }
.group-order-handle { flex: 0 0 28px; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; color: #596a85; background: transparent; cursor: grab; touch-action: none; user-select: none; }
.group-order-handle svg { width: 16px; height: 16px; }
.group-order-handle:hover { background: #edf3ff; color: #1759ed; }
.group-order-handle:active { cursor: grabbing; }
.group-order-handle:disabled { cursor: wait; opacity: .5; }
.group-order-handle:focus-visible, .group-order-footer button:focus-visible { outline: 2px solid #1759ed; outline-offset: -2px; }
.group-order-footer { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 8px; margin-top: 4px; font-size: 11px; color: #52617b; }
.group-order-footer button { flex-shrink: 0; min-height: 32px; padding: 4px 12px; border: 0; border-radius: 10px; background: #102456; color: #fff; font-size: 13px; font-weight: 600; }
.group-order-footer button:hover { background: #1c3975; }
.group-order-footer button:disabled { opacity: .5; cursor: wait; }
.group-order-keyboard-help { flex-shrink: 0; margin: 4px 0 0; font-size: 10px; }
.group-order-error { margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; color: #9b2539; background: #fff1f3; font-size: 12px; line-height: 1.5; }
.group-order-empty { flex: 1; padding: 24px 8px; text-align: center; font-size: 13px; color: #52617b; }
.group-order-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (pointer: coarse) {
  .group-order-row { min-height: 40px; }
  .group-order-handle { flex-basis: 40px; width: 40px; height: 40px; }
}
.group-order ::selection { background: #dce9ff; color: #102456; }
</style>
