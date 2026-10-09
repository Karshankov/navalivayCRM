<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[10050] flex items-center justify-center p-4"
      >
        <div
          class="absolute inset-0 bg-black/30 backdrop-blur-sm"
          aria-hidden="true"
          v-safe-backdrop-close="() => emit('close')"
        />

        <section
          ref="dialogRef"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          class="relative flex max-h-[min(80vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
          @click.stop
        >
          <header class="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div class="min-w-0">
              <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Остатки по вкусам</p>
              <h3 :id="titleId" class="mt-0.5 break-words text-base font-semibold text-gray-900">
                {{ groupName }}
              </h3>
              <p class="mt-1 text-xs text-gray-500">
                От меньшего розничного остатка к большему. Склад показан рядом:
                видно, что закупать, а что достаточно переместить.
              </p>
            </div>
            <button
              ref="closeButtonRef"
              type="button"
              class="-m-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              aria-label="Закрыть"
              @click="emit('close')"
            >
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </header>

          <div class="min-h-0 overflow-y-auto px-5 py-4">
            <div
              v-if="loading"
              class="py-10 text-center text-sm text-gray-500"
              role="status"
              aria-live="polite"
            >
              Загружаем остатки…
            </div>
            <div
              v-else-if="errorText"
              class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              <span>{{ errorText }}</span>
              <button
                type="button"
                class="min-h-10 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                @click="emit('retry')"
              >
                Повторить
              </button>
            </div>
            <div
              v-else-if="!items.length"
              class="py-10 text-center text-sm text-gray-500"
              role="status"
            >
              В этой линейке пока нет позиций
            </div>
            <ol v-else class="divide-y divide-gray-100">
              <li
                v-for="item in items"
                :key="item.id"
                class="flex items-center justify-between gap-4 py-2.5"
              >
                <span class="min-w-0 break-words text-sm text-gray-800">{{ item.name }}</span>
                <span class="flex flex-shrink-0 items-center gap-1.5">
                  <span
                    class="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
                    :class="item.stock === 0
                      ? 'bg-red-100 text-red-700'
                      : item.stock <= 3
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-50 text-emerald-700'"
                    :title="`В рознице: ${item.stock} шт`"
                  >
                    {{ item.stock }} шт
                  </span>
                  <span
                    class="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
                    :class="Number(item.warehouse_stock || 0) > 0
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-gray-100 text-gray-500'"
                    :title="`На складе: ${Number(item.warehouse_stock || 0)} шт`"
                  >
                    склад {{ Number(item.warehouse_stock || 0) }}
                  </span>
                </span>
              </li>
            </ol>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { LowStockFlavor } from "@/stores/crm";
import { vSafeBackdropClose } from "@/directives/safeBackdropClose";

const props = defineProps<{
  isOpen: boolean;
  groupName: string;
  items: LowStockFlavor[];
  loading: boolean;
  errorText: string | null;
}>();

const emit = defineEmits<{ close: []; retry: [] }>();
const titleId = `low-stock-flavors-title-${Math.random().toString(36).slice(2)}`;
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);
let returnFocusTo: HTMLElement | null = null;

function handleKeydown(event: KeyboardEvent) {
  if (!props.isOpen) return;
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = Array.from(
    dialogRef.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!dialogRef.value?.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      returnFocusTo = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      nextTick(() => closeButtonRef.value?.focus());
    } else if (returnFocusTo) {
      const target = returnFocusTo;
      returnFocusTo = null;
      nextTick(() => target.focus());
    }
  },
  { immediate: true },
);

watch(
  () => props.loading,
  (loading) => {
    if (props.isOpen && loading) nextTick(() => closeButtonRef.value?.focus());
  },
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>
