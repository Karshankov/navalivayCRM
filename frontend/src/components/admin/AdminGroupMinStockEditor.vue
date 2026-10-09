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
      <!-- Teleport в body. Родительское окно линеек на это время
           размонтируется, чтобы его ловушка фокуса не мешала вводу. -->
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[10050] flex items-center justify-center p-4"
        @mousedown.self.stop
      >
        <div
          class="absolute inset-0 bg-black/30 backdrop-blur-sm"
          aria-hidden="true"
          v-safe-backdrop-close="() => emit('close')"
          @mousedown.stop
        />

        <div
          role="dialog"
          aria-modal="true"
          :aria-label="modalTitle"
          class="relative w-full sm:max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-2xl ring-1 ring-black/5"
          @keydown.esc.stop="emit('close')"
          @mousedown.stop
        >
          <div class="mb-3 flex items-start justify-between gap-3">
            <h3 class="text-base font-semibold uppercase tracking-wide text-gray-900">
              {{ modalTitle }}
            </h3>
            <button
              type="button"
              class="-m-1 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              aria-label="Закрыть"
              @click="emit('close')"
            >
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
            </button>
          </div>

          <p class="text-sm text-gray-600">
            Когда суммарный остаток линейки опустится ниже этого числа, она появится в плашке «Заканчивающиеся» в разделе Закупки.
          </p>

          <div class="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
            <p class="text-xs uppercase tracking-wide text-gray-500">Сейчас на складе</p>
            <p class="mt-1 text-lg font-semibold text-gray-900">{{ currentStock }} шт</p>
            <p
              v-if="currentThreshold && currentStock < currentThreshold"
              class="mt-1 text-xs text-red-600"
            >
              Уже ниже текущего порога ({{ currentThreshold }} шт). Линейка попала в «Заканчивающиеся».
            </p>
          </div>

          <div class="mt-4 space-y-2">
            <label class="text-sm font-medium text-gray-700">Минимальный остаток</label>
            <!-- type="text" + inputmode="numeric": Vue не кастует в number,
                 .trim() безопасен. На мобильном выскакивает та же
                 цифровая клавиатура благодаря inputmode. -->
            <input
              ref="inputRef"
              v-model="inputValue"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              placeholder="Например 45"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              @keydown.enter="handleApply"
            />
            <p class="text-xs text-gray-500">
              Если пусто, оповещение появится только при полном обнулении товара.
            </p>
          </div>

          <div class="mt-4 space-y-1">
            <p class="text-xs uppercase tracking-wide text-gray-500">Быстро</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="preset in PRESETS"
                :key="preset"
                type="button"
                class="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:border-slate-400 hover:bg-slate-50"
                @click="inputValue = String(preset)"
              >
                {{ preset }} шт
              </button>
            </div>
          </div>

          <div v-if="errorText" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {{ errorText }}
          </div>

          <div class="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              v-if="currentThreshold"
              type="button"
              class="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="busy"
              @click="handleClear"
            >
              Очистить порог
            </button>
            <button
              type="button"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              :disabled="busy"
              @click="emit('close')"
            >
              Отмена
            </button>
            <button
              type="button"
              class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="busy || !canApply"
              @click="handleApply"
            >
              {{ busy ? 'Сохраняем…' : 'Применить' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { vSafeBackdropClose } from "@/directives/safeBackdropClose";

interface Props {
  isOpen: boolean;
  groupName: string;
  currentThreshold: number | null;
  currentStock: number;
  busy?: boolean;
  errorText?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  busy: false,
  errorText: null,
});

const emit = defineEmits<{
  close: [];
  apply: [value: number | null];
}>();

const PRESETS = [25, 45, 80, 120] as const;

const inputRef = ref<HTMLInputElement | null>(null);
const inputValue = ref<string>(
  props.currentThreshold ? String(props.currentThreshold) : "",
);

const modalTitle = computed(() =>
  `Минимальный остаток ${props.groupName ? `для ${props.groupName}` : ''}`.trim(),
);

const parsedValue = computed<number | null>(() => {
  const raw = String(inputValue.value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
});

const canApply = computed(() => {
  const raw = String(inputValue.value ?? "").trim();
  if (raw === "") {
    return props.currentThreshold !== null;
  }
  return parsedValue.value !== null;
});

onMounted(() => {
  nextTick(() => inputRef.value?.focus());
});

function handleApply() {
  if (!canApply.value) return;
  emit("apply", parsedValue.value);
}

function handleClear() {
  emit("apply", null);
}
</script>
