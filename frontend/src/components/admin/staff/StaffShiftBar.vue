<template>
  <section
    v-if="staffTrackingEnabled !== false"
    class="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    aria-label="Смена сотрудника"
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div v-if="isShiftOpen" class="flex min-w-0 items-center gap-3">
        <span
          class="h-3 w-3 shrink-0 rounded-full ring-4 ring-slate-100"
          :style="{ backgroundColor: shiftColor }"
          aria-hidden="true"
        />
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-slate-900">
            {{ shiftEmployeeName }}
            <span v-if="shiftPosition" class="font-normal text-slate-500">· {{ shiftPosition }}</span>
          </div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span class="font-medium text-blue-700">
              Смена идёт {{ elapsedLabel }}
            </span>
          </div>
        </div>
      </div>
      <div v-else class="text-sm text-slate-600">
        Смена не открыта. Выберите сотрудника и подтвердите начало личным ПИН.
      </div>

      <div class="flex flex-wrap gap-2">
        <template v-if="isShiftOpen">
          <CrmButton v-if="hasStaffAccess" variant="soft" size="sm" @click="tasksOpen = true">
            {{ tasksButtonLabel }}
            <span
              v-if="openStaffTaskCount"
              class="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-bold text-white"
            >
              {{ openStaffTaskCount }}
            </span>
          </CrmButton>
          <CrmButton
            v-if="canCloseOwnShift"
            variant="secondary"
            size="sm"
            :loading="staffShiftLoading"
            @click="requestCloseShift"
          >
            Закрыть смену
          </CrmButton>
          <CrmButton
            v-if="!hasStaffAccess"
            variant="primary"
            size="sm"
            @click="accessOpen = true"
          >
            Открыть личную карточку
          </CrmButton>
          <CrmButton v-else variant="ghost" size="sm" @click="crmStore.lockStaffAccess()">
            Выйти из карточки
          </CrmButton>
        </template>
        <template v-else>
          <CrmButton
            variant="primary"
            size="sm"
            :loading="staffShiftCandidatesLoading"
            @click="showOpenShift"
          >
            Открыть смену
          </CrmButton>
          <CrmButton v-if="hasStaffAccess" variant="soft" size="sm" @click="tasksOpen = true">
            {{ tasksButtonLabel }}
            <span
              v-if="openStaffTaskCount"
              class="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-bold text-white"
            >
              {{ openStaffTaskCount }}
            </span>
          </CrmButton>
        </template>
      </div>
    </div>

    <div
      v-if="retryReady && pendingRetry"
      class="mt-3 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
    >
      <p class="text-sm text-blue-900">
        Смена открыта. Действие не повторялось: {{ pendingRetry.label }}.
      </p>
      <CrmButton
        variant="primary"
        size="sm"
        :loading="retrying"
        @click="runPendingRetry"
      >
        Повторить вручную
      </CrmButton>
    </div>

    <p
      v-if="barMessage"
      class="mt-3 text-sm"
      :class="barMessageKind === 'error' ? 'text-red-700' : 'text-blue-800'"
      :role="barMessageKind === 'error' ? 'alert' : 'status'"
      aria-live="polite"
    >
      {{ barMessage }}
    </p>
  </section>

  <section
    v-else
    class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm"
    aria-label="Учёт сотрудников выключен"
  >
    Учёт сотрудников выключен. Руководитель может включить его в разделе «Сотрудники и зарплаты».
  </section>

  <StaffAccessModal
    :open="accessOpen"
    @close="accessOpen = false"
    @success="handleAccessSuccess"
  />

  <StaffTasksModal
    :open="tasksOpen"
    @close="tasksOpen = false"
    @shift-required="handleTaskShiftRequired"
  />

  <AdminModal
    :is-open="shiftOpen"
    title="Открыть смену"
    description="Смену можно открыть с 10:00 до 21:15 по Минску. В 21:15 она закроется автоматически."
    size="sm"
    :show-actions="false"
    :persistent="staffShiftLoading"
    :is-loading="staffShiftLoading"
    @close="closeShiftPrompt"
    @cancel="closeShiftPrompt"
  >
    <form class="space-y-4" @submit.prevent="openShift">
      <div>
        <label for="shift-employee" class="mb-2 block text-sm font-medium text-slate-700">
          Сотрудник
        </label>
        <select
          id="shift-employee"
          v-model="shiftEmployeeId"
          class="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          :disabled="staffShiftLoading || staffShiftCandidatesLoading"
          required
        >
          <option value="" disabled>
            {{ staffShiftCandidatesLoading ? "Загружаем…" : "Выберите сотрудника" }}
          </option>
          <option v-for="candidate in staffShiftCandidates" :key="candidate.id" :value="candidate.id">
            {{ candidate.first_name }} {{ candidate.last_name || "" }}{{ candidate.position ? ` · ${candidate.position}` : "" }}
          </option>
        </select>
        <button
          v-if="staffShiftCandidatesError"
          type="button"
          class="mt-2 min-h-[44px] text-sm font-semibold text-blue-700"
          @click="loadShiftCandidates"
        >
          Не удалось загрузить. Повторить
        </button>
      </div>
      <div>
        <label for="shift-pin" class="mb-2 block text-sm font-medium text-slate-700">ПИН</label>
        <input
          id="shift-pin"
          ref="shiftPinInput"
          v-model="shiftPin"
          type="password"
          inputmode="numeric"
          pattern="[0-9]{4}"
          maxlength="4"
          autocomplete="one-time-code"
          class="min-h-[52px] w-full rounded-xl border border-slate-300 px-4 text-center text-2xl tracking-[0.5em] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          placeholder="••••"
          :disabled="staffShiftLoading"
          @input="sanitizeShiftPin"
        />
      </div>
      <p v-if="shiftPromptError" class="text-sm text-red-700" role="alert" aria-live="assertive">
        {{ shiftPromptError }}
      </p>
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <CrmButton variant="secondary" type="button" :disabled="staffShiftLoading" @click="closeShiftPrompt">
          Отмена
        </CrmButton>
        <CrmButton
          variant="primary"
          type="submit"
          :loading="staffShiftLoading"
          :disabled="!shiftEmployeeId || shiftPin.length !== 4"
        >
          Начать смену
        </CrmButton>
      </div>
    </form>
  </AdminModal>

  <AdminModal
    :is-open="closeShiftConfirmOpen"
    title="Закрыть смену?"
    description="После закрытия рабочие действия потребуют открытия новой смены."
    size="sm"
    :show-actions="false"
    :persistent="staffShiftLoading"
    :is-loading="staffShiftLoading"
    @close="closeShiftConfirmOpen = false"
    @cancel="closeShiftConfirmOpen = false"
  >
    <div class="space-y-5">
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <div class="font-semibold text-slate-950">{{ shiftEmployeeName }}</div>
        <div class="mt-1 text-slate-600">Смена идёт {{ elapsedLabel }}</div>
      </div>
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <CrmButton
          variant="secondary"
          type="button"
          :disabled="staffShiftLoading"
          @click="closeShiftConfirmOpen = false"
        >
          Продолжить смену
        </CrmButton>
        <CrmButton
          variant="danger"
          type="button"
          :loading="staffShiftLoading"
          @click="closeShift"
        >
          Закрыть смену
        </CrmButton>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import AdminModal from "@/components/AdminModal.vue";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import StaffAccessModal from "@/components/admin/staff/StaffAccessModal.vue";
import StaffTasksModal from "@/components/admin/staff/StaffTasksModal.vue";
import { useCrmStore } from "@/stores/crm";

interface PendingRetry {
  label: string;
  run: () => unknown | Promise<unknown>;
}

const crmStore = useCrmStore();
const {
  hasStaffAccess,
  staffIdentity,
  currentStaffShift,
  staffShiftLoading,
  staffShiftCandidates,
  staffShiftCandidatesLoading,
  staffShiftCandidatesError,
  openStaffTaskCount,
  staffTrackingEnabled,
  isStaffManager,
} = storeToRefs(crmStore);
const accessOpen = ref(false);
const tasksOpen = ref(false);
const shiftOpen = ref(false);
const closeShiftConfirmOpen = ref(false);
const shiftEmployeeId = ref("");
const shiftPin = ref("");
const shiftPromptError = ref("");
const shiftPinInput = ref<HTMLInputElement | null>(null);
const pendingRetry = ref<PendingRetry | null>(null);
const retryReady = ref(false);
const retrying = ref(false);
const barMessage = ref("");
const barMessageKind = ref<"info" | "error">("info");
const clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

const isShiftOpen = computed(
  () =>
    ["active", "open"].includes(String(currentStaffShift.value?.status || "")) &&
    !(
      currentStaffShift.value?.ended_at ||
      currentStaffShift.value?.closed_at
    ),
);
const shiftEmployeeName = computed(() => {
  const shift = currentStaffShift.value as any;
  const employee = shift?.employee;
  return (
    shift?.employee_name ||
    [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") ||
    [shift?.employee_first_name, shift?.employee_last_name]
      .filter(Boolean)
      .join(" ") ||
    "Сотрудник"
  );
});
const shiftPosition = computed(
  () =>
    (currentStaffShift.value as any)?.employee?.position ||
    (currentStaffShift.value as any)?.employee_position ||
    "",
);
const shiftColor = computed(() =>
  safeColor(
    currentStaffShift.value?.employee_color ||
      currentStaffShift.value?.employee?.color,
  ),
);
const canCloseOwnShift = computed(
  () =>
    hasStaffAccess.value &&
    staffIdentity.value?.employee.id === currentStaffShift.value?.employee_id,
);
const elapsedLabel = computed(() => {
  const openedAt =
    currentStaffShift.value?.started_at ||
    currentStaffShift.value?.opened_at;
  if (!openedAt) return "";
  const opened = new Date(openedAt).getTime();
  if (!Number.isFinite(opened)) return "";
  const minutes = Math.max(0, Math.floor((clock.value - opened) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} ч ${rest} мин` : `${rest} мин`;
});
const tasksButtonLabel = computed(() =>
  isStaffManager.value ? "Задачи команды" : "Мои задачи",
);

function safeColor(color?: string | null) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#2563eb";
}

function sanitizeShiftPin(event: Event) {
  const input = event.target as HTMLInputElement;
  shiftPin.value = input.value.replace(/\D/g, "").slice(0, 4);
}

async function handleAccessSuccess() {
  accessOpen.value = false;
  barMessage.value = "";
  await crmStore.refreshStaffWorkspace({ quiet: true });
}

async function loadShiftCandidates() {
  try {
    await crmStore.fetchStaffShiftCandidates();
    if (
      !staffShiftCandidates.value.some(
        (candidate) => candidate.id === shiftEmployeeId.value,
      )
    ) {
      shiftEmployeeId.value =
        staffShiftCandidates.value.find(
          (candidate) => candidate.id === staffIdentity.value?.employee.id,
        )?.id ||
        staffShiftCandidates.value[0]?.id ||
        "";
    }
  } catch {
    // Store exposes the inline error and retry state.
  }
}

async function showOpenShift() {
  shiftPromptError.value = "";
  shiftPin.value = "";
  shiftEmployeeId.value = staffIdentity.value?.employee.id || "";
  shiftOpen.value = true;
  await loadShiftCandidates();
  await nextTick();
  shiftPinInput.value?.focus();
}

function closeShiftPrompt() {
  if (staffShiftLoading.value) return;
  shiftOpen.value = false;
  shiftPin.value = "";
  shiftPromptError.value = "";
}

async function openShift() {
  if (
    !shiftEmployeeId.value ||
    !/^\d{4}$/.test(shiftPin.value) ||
    staffShiftLoading.value
  )
    return;
  shiftPromptError.value = "";
  try {
    await crmStore.openStaffShift({
      employee_id: shiftEmployeeId.value,
      pin: shiftPin.value,
    });
    shiftPin.value = "";
    shiftOpen.value = false;
    barMessageKind.value = "info";
    barMessage.value = "Смена открыта";
    retryReady.value = Boolean(pendingRetry.value);
    void crmStore.fetchStaffTasks();
  } catch (error: any) {
    shiftPromptError.value =
      error?.code === "invalid_pin"
        ? "Неверный ПИН"
        : error?.message || "Не удалось открыть смену";
    shiftPin.value = "";
    await nextTick();
    shiftPinInput.value?.focus();
  }
}

function requestCloseShift() {
  if (staffShiftLoading.value) return;
  closeShiftConfirmOpen.value = true;
}

async function closeShift() {
  if (staffShiftLoading.value) return;
  barMessage.value = "";
  try {
    await crmStore.closeStaffShift();
    closeShiftConfirmOpen.value = false;
    pendingRetry.value = null;
    retryReady.value = false;
    barMessageKind.value = "info";
    barMessage.value = "Смена закрыта";
  } catch (error: any) {
    barMessageKind.value = "error";
    barMessage.value = error?.message || "Не удалось закрыть смену";
  }
}

async function requestShiftRequired(
  label: string,
  retry: () => unknown | Promise<unknown>,
) {
  pendingRetry.value = { label, run: retry };
  retryReady.value = false;
  barMessage.value =
    "Для действия нужна открытая смена. Исходное действие не выполнено.";
  barMessageKind.value = "info";
  await showOpenShift();
}

function handleTaskShiftRequired(payload: {
  label: string;
  retry: () => Promise<unknown>;
}) {
  tasksOpen.value = false;
  void requestShiftRequired(payload.label, async () => {
    try {
      return await payload.retry();
    } finally {
      tasksOpen.value = true;
    }
  });
}

async function runPendingRetry() {
  if (!pendingRetry.value || retrying.value) return;
  retrying.value = true;
  const retry = pendingRetry.value;
  retryReady.value = false;
  try {
    const result = await retry.run();
    if (result === false) {
      retryReady.value = true;
      barMessageKind.value = "error";
      barMessage.value = "Действие не завершено. Проверьте сообщение рядом с ним.";
      return;
    }
    pendingRetry.value = null;
    barMessageKind.value = "info";
    barMessage.value = "Действие повторено по вашему подтверждению";
  } catch (error: any) {
    barMessageKind.value = "error";
    barMessage.value =
      error?.outcomeUnknown
        ? "Ответ сервера не получен. Проверьте результат перед новым повтором."
        : error?.message || "Не удалось повторить действие";
  } finally {
    retrying.value = false;
  }
}

defineExpose({ requestShiftRequired });

onMounted(async () => {
  clockTimer = setInterval(() => {
    clock.value = Date.now();
    if (staffTrackingEnabled.value !== false) {
      void crmStore.fetchStaffShift();
    }
  }, 60_000);
  await crmStore.fetchStaffSettings().catch(() => undefined);
  if (staffTrackingEnabled.value === false) return;
  void crmStore.fetchStaffShift();
  if (hasStaffAccess.value) void crmStore.refreshStaffWorkspace({ quiet: true });
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>
