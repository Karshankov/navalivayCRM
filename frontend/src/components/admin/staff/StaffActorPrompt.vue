<template>
  <AdminModal
    v-if="open"
    :is-open="true"
    :title="title"
    :description="description"
    size="sm"
    :show-actions="false"
    :persistent="loading"
    :is-loading="loading"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <form class="space-y-5" @submit.prevent="submit">
      <div
        v-if="context"
        class="whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800"
        data-testid="staff-actor-context"
      >
        {{ context }}
      </div>

      <div>
        <label for="staff-actor" class="mb-2 block text-sm font-medium text-slate-700">
          Сотрудник
        </label>
        <select
          id="staff-actor"
          v-model="employeeId"
          class="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          :disabled="loading || loadingEmployees"
          required
        >
          <option value="" disabled>
            {{ loadingEmployees ? "Загружаем сотрудников…" : "Выберите сотрудника" }}
          </option>
          <option
            v-for="employee in staffShiftCandidates"
            :key="employee.id"
            :value="employee.id"
          >
            {{ employee.first_name }} {{ employee.last_name }}{{ employee.position ? ` · ${employee.position}` : "" }}
          </option>
        </select>
        <button
          v-if="loadError"
          type="button"
          class="mt-2 min-h-[44px] text-sm font-semibold text-blue-700"
          @click="loadEmployees"
        >
          Не удалось загрузить. Повторить
        </button>
      </div>

      <div>
        <label for="staff-actor-pin" class="mb-2 block text-sm font-medium text-slate-700">
          ПИН сотрудника
        </label>
        <input
          id="staff-actor-pin"
          ref="pinInput"
          v-model="pin"
          type="password"
          inputmode="numeric"
          pattern="[0-9]{4}"
          maxlength="4"
          autocomplete="one-time-code"
          placeholder="4 цифры"
          class="min-h-[48px] w-full rounded-xl border border-slate-300 px-4 text-center text-xl tracking-[0.45em] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          :disabled="loading"
          required
          @input="sanitizePin"
        />
        <p class="mt-2 text-xs text-slate-500">ПИН используется только для этого действия.</p>
      </div>

      <p
        v-if="visibleError || localError"
        class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        role="alert"
        aria-live="assertive"
      >
        {{ visibleError || localError }}
      </p>

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <CrmButton
          variant="secondary"
          :disabled="loading"
          type="button"
          @click="emit('close')"
        >
          Назад
        </CrmButton>
        <CrmButton
          variant="primary"
          type="submit"
          :loading="loading"
          loading-label="Проверяем…"
          :disabled="!canSubmit"
        >
          {{ actionLabel }}
        </CrmButton>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import AdminModal from "@/components/AdminModal.vue";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import { useCrmStore } from "@/stores/crm";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    actionLabel?: string;
    loading?: boolean;
    error?: string;
    errorCode?: string;
    initialEmployeeId?: string;
    context?: string;
  }>(),
  {
    description: "Подтвердите, кто выполняет действие.",
    actionLabel: "Подтвердить",
    loading: false,
    error: "",
    errorCode: "",
    initialEmployeeId: "",
    context: "",
  },
);

const emit = defineEmits<{
  close: [];
  confirm: [payload: { employeeId: string; pin: string }];
}>();

const crmStore = useCrmStore();
const {
  staffShiftCandidates,
  staffShiftCandidatesLoading: loadingEmployees,
  staffIdentity,
} = storeToRefs(crmStore);
const employeeId = ref("");
const pin = ref("");
const localError = ref("");
const loadError = ref(false);
const pinInput = ref<HTMLInputElement | null>(null);

const canSubmit = computed(
  () => Boolean(employeeId.value) && /^\d{4}$/.test(pin.value) && !props.loading,
);
const visibleError = computed(() => {
  if (
    [
      "invalid_staff_credentials",
      "staff_employee_inactive",
      "staff_employee_not_found",
      "staff_actor_changed",
    ].includes(props.errorCode)
  ) {
    return "Не удалось подтвердить сотрудника или ПИН";
  }
  if (props.errorCode === "staff_auth_locked") {
    return "Слишком много попыток. Попробуйте позже";
  }
  return props.error;
});

async function loadEmployees() {
  loadError.value = false;
  try {
    await crmStore.fetchStaffShiftCandidates();
  } catch {
    loadError.value = true;
  }
}

function sanitizePin(event: Event) {
  const input = event.target as HTMLInputElement;
  pin.value = input.value.replace(/\D/g, "").slice(0, 4);
}

function submit() {
  localError.value = "";
  if (!employeeId.value) {
    localError.value = "Выберите сотрудника";
    return;
  }
  if (!/^\d{4}$/.test(pin.value)) {
    localError.value = "Введите четыре цифры";
    pinInput.value?.focus();
    return;
  }
  const submittedPin = pin.value;
  pin.value = "";
  emit("confirm", { employeeId: employeeId.value, pin: submittedPin });
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      pin.value = "";
      localError.value = "";
      return;
    }
    employeeId.value =
      props.initialEmployeeId || staffIdentity.value?.employee.id || "";
    if (!staffShiftCandidates.value.length) void loadEmployees();
    await nextTick();
    pinInput.value?.focus();
  },
);

watch(
  () => [props.errorCode, props.error],
  async ([errorCode, error], previous) => {
    if (!props.open || (!errorCode && !error)) return;
    if (previous && errorCode === previous[0] && error === previous[1]) return;
    pin.value = "";
    await nextTick();
    pinInput.value?.focus();
  },
);
</script>
