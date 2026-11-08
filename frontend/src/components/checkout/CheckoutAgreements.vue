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

/** Открывает соглашение из внешнего триггера, например «подробнее».
 * Ищем по заголовку и тексту, чтобы не зависеть от регистра или
 * небольшой редакторской правки названия в админке. */
async function openAgreementByQuery(query: string): Promise<boolean> {
  if (!agreements.value.length) await fetchAgreements();
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  if (!needle) return false;
  const agreement = agreements.value.find((item) => {
    const haystack = `${item.title} ${item.modal_title || ""} ${item.body}`.toLocaleLowerCase("ru-RU");
    return haystack.includes(needle);
  });
  if (!agreement) return false;
  openModal(agreement);
  return true;
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

defineExpose({ refresh: fetchAgreements, openAgreementByQuery });
</script>

<style scoped>
/* Согласия в футере чекаута (демо .consents): без карточки,
 * сетка чекбокс-текст, компактные строки. */
.checkout-agreements {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
}

.checkout-agreement-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  padding: 4px 0;
  min-height: 42px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  background: transparent;
  border: 0;
  border-radius: 0;
  transition: none;
}

.checkout-agreement-row--invalid {
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

/* Чекбокс из демо: кастомный квадрат с красной галочкой. */
.checkout-agreement-checkbox {
  appearance: none;
  -webkit-appearance: none;
  flex: none;
  width: 22px;
  height: 22px;
  margin: 0;
  border-radius: 6px;
  border: 1.5px solid #a6abb5;
  background: #ffffff;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.checkout-agreement-checkbox:checked {
  background: linear-gradient(120deg, #ef3933, #df302a);
  border-color: transparent;
}

.checkout-agreement-checkbox:checked::after {
  content: "";
  width: 6px;
  height: 10px;
  border: solid #ffffff;
  border-width: 0 2px 2px 0;
  transform: translateY(-1px) rotate(45deg);
}

.checkout-agreement-checkbox:focus-visible {
  outline: 2px solid #0273f5;
  outline-offset: 2px;
}

/* Текст «Соглашаюсь с …»: чёрный, ссылка — цвет кнопки
   «посмотреть отзывы» (#0273f5), SF Pro 12px. */
.checkout-agreement-label {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 1.3;
  color: #151515;
  font-weight: 400;
}

.checkout-agreement-link {
  display: inline;
  margin: 0;
  padding: 0;
  background: none;
  border: none;
  color: #0273f5;
  font: inherit;
  font-weight: 400;
  text-decoration: underline;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.checkout-agreement-link:hover {
  color: #0156b8;
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
