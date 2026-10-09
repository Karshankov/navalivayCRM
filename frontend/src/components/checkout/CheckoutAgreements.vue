<template>
  <div v-if="agreements.length" class="checkout-agreements">
    <label
      v-for="agreement in agreements"
      :key="agreement.id"
      class="checkout-agreement-row"
      :class="{ 'checkout-agreement-row--invalid': isMissing(agreement.id) }"
    >
      <input
        type="checkbox"
        class="checkout-agreement-checkbox"
        :checked="acceptedSet.has(agreement.id)"
        @change="onToggle(agreement.id, ($event.target as HTMLInputElement).checked)"
      />
      <span class="checkout-agreement-label">
        Соглашаюсь с
        <button type="button" class="checkout-agreement-link" @click.stop.prevent="openModal(agreement)">
          {{ agreement.title }}
        </button>
      </span>
    </label>

    <CustomerModalShell
      :open="Boolean(activeAgreement)"
      :title="modalTitle"
      close-label="Закрыть окно"
      @close="closeModal"
    >
      <div v-if="activeAgreement" class="checkout-agreement-modal-body">
        <p
          v-for="(paragraph, idx) in modalParagraphs"
          :key="idx"
          class="checkout-agreement-modal-paragraph"
        >
          {{ paragraph }}
        </p>
        <p
          v-if="!modalParagraphs.length"
          class="checkout-agreement-modal-paragraph checkout-agreement-modal-empty"
        >
          Текст соглашения ещё не заполнен. Уточните у продавца.
        </p>
      </div>
    </CustomerModalShell>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import CustomerModalShell from "@/components/CustomerModalShell.vue";

interface Agreement {
  id: number;
  title: string;
  /** Опциональный заголовок модалки. Если пустой, fallback на title. */
  modal_title?: string;
  body: string;
}

const props = defineProps<{
  modelValue: number[];
  missingIds?: number[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: number[]];
  loaded: [agreements: Agreement[]];
}>();

const agreements = ref<Agreement[]>([]);
const activeAgreement = ref<Agreement | null>(null);

const acceptedSet = computed(() => new Set<number>(props.modelValue || []));
const missingSet = computed(() => new Set<number>(props.missingIds || []));

function isMissing(id: number) {
  return missingSet.value.has(id);
}

function onToggle(id: number, checked: boolean) {
  const next = new Set<number>(props.modelValue || []);
  if (checked) {
    next.add(id);
  } else {
    next.delete(id);
  }
  emit("update:modelValue", Array.from(next));
}

function openModal(agreement: Agreement) {
  activeAgreement.value = agreement;
}

function closeModal() {
  activeAgreement.value = null;
}

// Заголовок модалки: если у соглашения есть собственный modal_title (поле
// «Заголовок модалки» в админке) — используем его. Иначе fallback на title
// (то самое слово-ссылка из чекбокса). Без fallback'а у админов которые не
// заполнили modal_title было бы пусто.
const modalTitle = computed(() => {
  const agreement = activeAgreement.value;
  if (!agreement) return "";
  return (agreement.modal_title || "").trim() || agreement.title;
});

const modalParagraphs = computed(() => {
  const body = (activeAgreement.value?.body || "").trim();
  if (!body) return [];
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
});

async function fetchAgreements() {
  try {
    const response = await fetch("/api/agreements", { credentials: "include" });
    if (!response.ok) {
      console.warn("[CheckoutAgreements] failed to load:", response.status);
      return;
    }
    const data = (await response.json()) as { items?: Agreement[] };
    agreements.value = Array.isArray(data?.items) ? data.items : [];
    emit("loaded", agreements.value);
  } catch (err) {
    console.warn("[CheckoutAgreements] load error:", err);
  }
}

// Чистим accepted-ids от тех, чьё соглашение убрали из активных в админке —
// иначе при сабмите бэк ничего не сделает (id просто проигнорится), но локально
// галочка останется. Лучше прибраться сразу.
// `immediate: true` нужен для случая, когда родитель пред-заполняет modelValue
// до того, как мы загрузили /api/agreements (например, persist в localStorage
// в будущем) — без immediate watch не сработает на первом значении.
watch(
  agreements,
  (list) => {
    // Guard: пока fetch не завершился (или пришёл пустой ответ), agreements
    // == []. Без этого guard immediate-watch при пред-заполненном modelValue
    // (например, восстановленном из localStorage в будущем) очистит весь
    // список «принятых» — потому что validIds окажется пустым.
    if (!list.length) return;
    if (!props.modelValue?.length) return;
    const validIds = new Set(list.map((a) => a.id));
    const filtered = props.modelValue.filter((id) => validIds.has(id));
    if (filtered.length !== props.modelValue.length) {
      emit("update:modelValue", filtered);
    }
  },
  { immediate: true },
);

onMounted(() => {
  fetchAgreements();
});

defineExpose({ refresh: fetchAgreements });
</script>

<style scoped>
.checkout-agreements {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0;
}

.checkout-agreement-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1.5px solid #e1e6ec;
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.checkout-agreement-row:hover {
  background: #f7f9fb;
}

.checkout-agreement-row--invalid {
  border-color: #e53935;
  background: #fdecea;
  animation: agreement-shake 0.4s ease;
}

@keyframes agreement-shake {
  0%, 100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-3px);
  }
  75% {
    transform: translateX(3px);
  }
}

.checkout-agreement-checkbox {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  accent-color: #191919;
  cursor: pointer;
}

.checkout-agreement-label {
  font-size: 14px;
  line-height: 1.4;
  color: #191919;
  font-weight: 500;
}

.checkout-agreement-link {
  display: inline;
  margin: 0;
  padding: 0;
  background: none;
  border: none;
  color: #1565c0;
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.checkout-agreement-link:hover {
  color: #0d47a1;
}

.checkout-agreement-modal-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  line-height: 1.55;
  color: #2a2a2a;
  white-space: pre-wrap;
  word-break: break-word;
}

.checkout-agreement-modal-paragraph {
  margin: 0;
}

.checkout-agreement-modal-empty {
  color: #888;
  font-style: italic;
}
</style>
