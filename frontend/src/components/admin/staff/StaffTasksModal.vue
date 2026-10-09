<template>
  <AdminModal
    :is-open="open"
    :title="modalTitle"
    size="lg"
    :show-actions="false"
    :persistent="taskBusy || Boolean(actionDialog)"
    :is-loading="taskBusy"
    :show-close-button="!actionDialog"
    @close="requestClose"
    @cancel="requestClose"
  >
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Фильтр задач">
        <CrmButton
          v-for="option in filters"
          :key="option.value"
          class="whitespace-nowrap"
          variant="filter"
          size="sm"
          block
          :pressed="filter === option.value"
          :disabled="Boolean(actionDialog)"
          @click="filter = option.value"
        >
          {{ option.label }}
          <span class="ml-1 rounded-full bg-white/80 px-1.5 py-0.5 text-[11px]">
            {{ filterCount(option.value) }}
          </span>
        </CrmButton>
      </div>

      <div v-if="isStaffManager" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div
          v-for="metric in taskSummary"
          :key="metric.label"
          class="rounded-xl border px-3 py-2"
          :class="metric.tone === 'danger'
            ? 'border-red-200 bg-red-50'
            : metric.tone === 'attention'
              ? 'border-amber-200 bg-amber-50'
              : 'border-slate-200 bg-slate-50'"
        >
          <div class="text-[11px] text-slate-500">{{ metric.label }}</div>
          <div class="mt-0.5 text-lg font-bold text-slate-950">{{ metric.value }}</div>
        </div>
      </div>

      <!-- Поиск, отбор и действия одной панелью: раньше кнопки висели отдельной строкой. -->
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-if="isStaffManager"
          v-model.trim="taskSearch"
          type="search"
          placeholder="Найти задачу"
          class="min-h-[44px] w-full min-w-40 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm sm:w-auto"
          aria-label="Поиск задач"
        />
        <select
          v-if="isStaffManager"
          v-model="assigneeFilter"
          class="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm sm:w-52"
          aria-label="Исполнитель задачи"
        >
          <option value="">Все исполнители</option>
          <option value="free">Свободные задачи</option>
          <option
            v-for="assignee in taskAssignees"
            :key="assignee.id"
            :value="assignee.id"
          >
            {{ assignee.name }}
          </option>
        </select>
        <div class="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <CrmButton
            v-if="isStaffManager"
            class="flex-1 sm:flex-none"
            variant="primary"
            :disabled="Boolean(actionDialog)"
            @click="createOpen = !createOpen"
          >
            Новая задача
          </CrmButton>
          <CrmButton
            class="flex-1 sm:flex-none"
            variant="secondary"
            refresh-icon
            :loading="staffTasksLoading"
            :disabled="Boolean(actionDialog)"
            @click="loadTasks"
          >
            Обновить
          </CrmButton>
        </div>
      </div>

      <p
        v-if="claimBlockedByOtherShift"
        class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        Сейчас смена {{ currentShiftOwnerName }}. Руководитель может проверять и распределять задачи,
        но взять или сдать свою задачу сможет только сотрудник этой смены.
      </p>

      <form
        v-if="isStaffManager && createOpen"
        class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"
        @submit.prevent="createTask"
      >
        <label class="block sm:col-span-2">
          <span class="mb-1 block text-sm font-medium text-slate-700">
            Название задачи <span aria-hidden="true">*</span>
          </span>
          <input
            v-model.trim="taskForm.title"
            required
            maxlength="200"
            :disabled="Boolean(actionDialog)"
            class="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium text-slate-700">
            Срок <span aria-hidden="true">*</span>
          </span>
          <input
            v-model="taskForm.due_at"
            type="datetime-local"
            required
            :disabled="Boolean(actionDialog)"
            class="min-h-[44px] w-full rounded-xl border bg-white px-3"
            :class="taskDueError ? 'border-red-400' : 'border-slate-300'"
            :aria-invalid="Boolean(taskDueError)"
            :aria-describedby="taskDueError ? 'staff-task-due-error' : undefined"
          />
          <span
            v-if="taskDueError"
            id="staff-task-due-error"
            class="mt-1 block text-xs text-red-700"
            role="alert"
          >
            {{ taskDueError }}
          </span>
        </label>
        <label class="block">
          <span class="mb-1 block text-sm font-medium text-slate-700">Кому поручить</span>
          <select
            v-model="taskForm.employee_id"
            :disabled="Boolean(actionDialog)"
            class="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3"
          >
            <option value="">Свободная, возьмёт любой на смене</option>
            <option
              v-for="employee in assignableEmployees"
              :key="employee.id"
              :value="employee.id"
            >
              {{ [employee.first_name, employee.last_name].filter(Boolean).join(" ") }}
            </option>
          </select>
        </label>
        <label class="block sm:col-span-2">
          <span class="mb-1 block text-sm font-medium text-slate-700">
            Описание задачи <span aria-hidden="true">*</span>
          </span>
          <textarea
            v-model.trim="taskForm.description"
            rows="3"
            maxlength="4000"
            required
            :disabled="Boolean(actionDialog)"
            class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <div class="sm:col-span-2">
          <p class="mb-3 text-xs text-slate-500">
            <span aria-hidden="true">*</span> Обязательные поля
          </p>
          <p
            v-if="createTaskHint"
            class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
            aria-live="polite"
          >
            {{ createTaskHint }}
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton
              type="button"
              variant="secondary"
              :disabled="creatingTask || Boolean(actionDialog)"
              @click="createOpen = false"
            >
              Отмена
            </CrmButton>
            <CrmButton
              type="submit"
              variant="primary"
              :loading="creatingTask"
              :disabled="!canCreateTask || Boolean(actionDialog)"
            >
              Создать задачу
            </CrmButton>
          </div>
        </div>
      </form>

      <p
        v-if="message"
        class="rounded-xl border px-4 py-3 text-sm"
        :class="messageKind === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-blue-200 bg-blue-50 text-blue-800'"
        :role="messageKind === 'error' ? 'alert' : 'status'"
        aria-live="polite"
      >
        {{ message }}
      </p>

      <section
        v-if="actionDialog"
        class="rounded-2xl border border-blue-200 bg-blue-50 p-4"
        aria-labelledby="staff-task-action-title"
      >
        <h3 id="staff-task-action-title" class="text-base font-semibold text-slate-950">
          {{ actionDialogTitle }}
        </h3>
        <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-[120px_minmax(0,1fr)]">
          <dt class="text-slate-500">Задача</dt>
          <dd class="font-medium text-slate-900">{{ actionDialog.task.title }}</dd>
          <template v-if="actionDialog.task.assignee_name">
            <dt class="text-slate-500">Исполнитель</dt>
            <dd class="font-medium text-slate-900">{{ actionDialog.task.assignee_name }}</dd>
          </template>
          <template v-if="actionDialog.task.result_note">
            <dt class="text-slate-500">Отчёт</dt>
            <dd class="whitespace-pre-line text-slate-800">{{ actionDialog.task.result_note }}</dd>
          </template>
        </dl>
        <p
          v-if="actionDialog.action === 'cancel'"
          class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Задача исчезнет из рабочего списка, но запись останется в истории.
        </p>
        <label v-if="actionDialog.action !== 'approve'" class="mt-4 block">
          <span class="mb-1 block text-sm font-medium text-slate-700">
            {{ actionDialog.action === "cancel" ? "Причина отмены" : "Результат работы (необязательно)" }}
          </span>
          <textarea
            ref="actionNoteInput"
            v-model.trim="actionDialog.note"
            rows="4"
            :required="actionDialog.action === 'cancel'"
            maxlength="4000"
            class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            :placeholder="actionDialog.action === 'cancel'
              ? 'Почему задача отменяется'
              : 'Например: пересчитал витрину, расхождений нет'"
            :disabled="taskBusy"
          />
        </label>
        <p v-if="actionDialog.action === 'approve'" class="mt-4 text-sm text-slate-700">
          После подтверждения задача закроется, а сотруднику добавится одна положительная отметка.
        </p>
        <div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <CrmButton type="button" variant="secondary" :disabled="taskBusy" @click="closeActionDialog">
            Назад
          </CrmButton>
          <CrmButton
            type="button"
            :variant="actionDialog.action === 'cancel' ? 'danger' : 'success'"
            :loading="taskBusy"
            :disabled="!canConfirmActionDialog"
            @click="confirmActionDialog"
          >
            {{ actionDialogConfirmLabel }}
          </CrmButton>
        </div>
      </section>

      <div v-if="staffTasksLoading && !staffTasks.length" class="py-12 text-center text-sm text-slate-500">
        Загружаем задачи…
      </div>
      <div v-else-if="staffTasksError && !staffTasks.length" class="py-8 text-center">
        <p class="text-sm text-red-700">{{ staffTasksError }}</p>
        <CrmButton class="mt-4" variant="secondary" @click="loadTasks">Повторить</CrmButton>
      </div>
      <div v-else-if="!visibleTasks.length" class="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center">
        <p class="font-medium text-slate-800">{{ emptyState.title }}</p>
        <p class="mt-1 text-sm text-slate-500">{{ emptyState.description }}</p>
      </div>
      <ul v-else class="divide-y divide-slate-200 border-y border-slate-200">
        <li
          v-for="task in visibleTasks"
          :key="task.id"
          class="rounded-xl px-3 py-4"
          :class="isTaskOverdue(task)
            ? 'bg-red-50/70'
            : task.status === 'submitted'
              ? 'bg-amber-50/70'
              : ''"
        >
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="h-2 w-2 rounded-full" :class="priorityClass(task.priority)" aria-hidden="true" />
                <h3 class="font-semibold text-slate-900">{{ task.title }}</h3>
                <span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  {{ statusLabel(task.status) }}
                </span>
                <span
                  v-if="isTaskOverdue(task)"
                  class="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700"
                >
                  Просрочена
                </span>
              </div>
              <p v-if="task.description" class="mt-2 whitespace-pre-line text-sm text-slate-600">
                {{ task.description }}
              </p>
              <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span v-if="task.assignee_name">Исполнитель: {{ task.assignee_name }}</span>
                <span v-else-if="task.target_employee_name_snapshot">
                  Назначена: {{ task.target_employee_name_snapshot }}
                </span>
                <span
                  v-if="task.due_at"
                  :class="isTaskOverdue(task) ? 'font-semibold text-red-700' : ''"
                >
                  Срок: {{ formatDate(task.due_at) }}
                </span>
              </div>
              <div
                v-if="task.result_note"
                class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              >
                <span class="block font-medium">Результат сотрудника</span>
                <span class="mt-1 block whitespace-pre-line">{{ task.result_note }}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-2 sm:max-w-[260px] sm:justify-end">
              <CrmButton
                v-for="action in actionsFor(task)"
                :key="action.value"
                :variant="action.variant"
                size="sm"
                :loading="pendingActionId === `${task.id}:${action.value}`"
                :disabled="Boolean(actionDialog) || Boolean(pendingActionId)"
                @click="handleActionClick(task, action.value)"
              >
                {{ action.label }}
              </CrmButton>
              <CrmButton
                v-if="canViewTaskHistory(task)"
                variant="soft"
                size="sm"
                :loading="historyLoadingId === task.id"
                :disabled="Boolean(actionDialog) || Boolean(historyLoadingId)"
                @click="toggleTaskHistory(task)"
              >
                {{ historyTaskId === task.id ? "Скрыть историю" : "История" }}
              </CrmButton>
              <span
                v-if="claimUnavailableReason(task)"
                class="w-full text-right text-xs text-amber-700"
              >
                {{ claimUnavailableReason(task) }}
              </span>
            </div>
          </div>
          <div
            v-if="historyTaskId === task.id"
            class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <p v-if="historyError" class="text-sm text-red-700" role="alert">
              {{ historyError }}
            </p>
            <p v-else-if="!taskHistory.length" class="text-sm text-slate-500">
              Записей пока нет
            </p>
            <ol v-else class="space-y-3">
              <li
                v-for="(entry, index) in taskHistory"
                :key="String(entry.id || `${entry.action}-${entry.created_at}`)"
                class="flex gap-2 text-sm"
              >
                <span class="w-5 shrink-0 pt-0.5 text-right text-xs font-medium text-slate-400">
                  {{ index + 1 }}.
                </span>
                <div class="min-w-0 flex-1 border-l-2 border-slate-300 pl-3">
                  <div class="font-medium text-slate-800">
                    {{ taskHistoryActionLabel(String(entry.action || "")) }}
                  </div>
                  <div class="mt-0.5 text-xs text-slate-500">
                    {{ entry.actor_name_snapshot || "Система" }}
                    <template v-if="entry.created_at">
                      · {{ formatDate(String(entry.created_at)) }}
                    </template>
                  </div>
                  <p v-if="entry.note" class="mt-1 whitespace-pre-line text-slate-600">
                    {{ entry.note }}
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </li>
      </ul>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import AdminModal from "@/components/AdminModal.vue";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import {
  useCrmStore,
  type StaffApiError,
  type StaffTask,
  type StaffTaskStatus,
} from "@/stores/crm";
import {
  BUSINESS_TIME_ZONE,
  businessDateTimeInputToIso,
} from "@/utils/businessTime";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  shiftRequired: [payload: { label: string; retry: () => Promise<unknown> }];
}>();
const crmStore = useCrmStore();
const {
  staffTasks,
  staffTasksLoading,
  staffTasksError,
  staffIdentity,
  isStaffManager,
  currentStaffShift,
  staffEmployees,
} = storeToRefs(crmStore);
type TaskFilter = "active" | "submitted" | "overdue" | "done";
const filter = ref<TaskFilter>("active");
const taskSearch = ref("");
const assigneeFilter = ref("");
const pendingActionId = ref("");
const message = ref("");
const messageKind = ref<"info" | "error">("info");
const createOpen = ref(false);
const creatingTask = ref(false);
const historyTaskId = ref("");
const historyLoadingId = ref("");
const historyError = ref("");
const taskHistory = ref<Array<Record<string, any>>>([]);
type TaskAction = "claim" | "submit" | "approve" | "cancel" | "release";
type ConfirmedTaskAction = Extract<TaskAction, "submit" | "approve" | "cancel">;
const actionDialog = ref<{
  task: StaffTask;
  action: ConfirmedTaskAction;
  note: string;
} | null>(null);
const actionNoteInput = ref<HTMLTextAreaElement | null>(null);
const taskForm = ref({
  title: "",
  description: "",
  due_at: "",
  employee_id: "",
});

/** Кому можно поручить задачу: только действующие сотрудники. */
const assignableEmployees = computed(() =>
  staffEmployees.value.filter((employee) => Boolean(Number(employee.active))),
);
const taskDueError = computed(() => {
  if (!taskForm.value.due_at) return "";
  const dueAt = businessDateTimeInputToIso(taskForm.value.due_at);
  if (!dueAt) return "Укажите корректные дату и время";
  return new Date(dueAt).getTime() <= Date.now()
    ? "Срок должен быть в будущем по времени Минска"
    : "";
});
const canCreateTask = computed(() =>
  Boolean(
    taskForm.value.title.trim() &&
      taskForm.value.description.trim() &&
      taskForm.value.due_at &&
      !taskDueError.value,
  ),
);
const createTaskHint = computed(() => {
  const missing = [
    !taskForm.value.title.trim() ? "название" : "",
    !taskForm.value.due_at ? "срок" : "",
    !taskForm.value.description.trim() ? "описание" : "",
  ].filter(Boolean);
  if (missing.length) return `Чтобы создать задачу, заполните: ${missing.join(", ")}.`;
  return taskDueError.value;
});
const taskBusy = computed(
  () => creatingTask.value || Boolean(pendingActionId.value),
);
const actionDialogTitle = computed(() => {
  if (actionDialog.value?.action === "approve") return "Подтвердить выполнение?";
  if (actionDialog.value?.action === "cancel") return "Отменить задачу?";
  return actionDialog.value?.task.status === "submitted"
    ? "Сдать задачу повторно"
    : "Отправить задачу на проверку";
});
const actionDialogConfirmLabel = computed(() => ({
  approve: "Подтвердить выполнение",
  cancel: "Отменить задачу",
  submit: "Отправить на проверку",
}[actionDialog.value?.action || "submit"]));
const canConfirmActionDialog = computed(() => {
  if (!actionDialog.value || taskBusy.value) return false;
  return actionDialog.value.action !== "cancel"
    || Boolean(actionDialog.value.note.trim());
});

const filters = computed<Array<{ value: TaskFilter; label: string }>>(() => [
  { value: "active", label: "Активные" },
  ...(isStaffManager.value
    ? [
        { value: "submitted" as const, label: "На проверке" },
        { value: "overdue" as const, label: "Просрочены" },
      ]
    : []),
  { value: "done", label: "Завершённые" },
]);
const modalTitle = computed(() =>
  isStaffManager.value ? "Задачи команды" : "Мои задачи",
);
const currentShiftOwnerId = computed(() => {
  const shift = currentStaffShift.value;
  if (
    !shift ||
    !["active", "open"].includes(String(shift.status || "")) ||
    shift.ended_at ||
    shift.closed_at
  ) return "";
  return String(shift.employee_id || "");
});
const currentShiftOwnerName = computed(() => {
  const shift = currentStaffShift.value as any;
  return (
    shift?.employee_name ||
    [shift?.employee?.first_name, shift?.employee?.last_name]
      .filter(Boolean)
      .join(" ") ||
    "другого сотрудника"
  );
});
const claimBlockedByOtherShift = computed(
  () =>
    Boolean(currentShiftOwnerId.value) &&
    currentShiftOwnerId.value !== staffIdentity.value?.employee.id,
);
const taskAssignees = computed(() => {
  const result = new Map<string, string>();
  for (const task of staffTasks.value) {
    const id = String(
      task.assignee_employee_id || task.target_employee_id || "",
    );
    const name = String(
      task.assignee_name || task.target_employee_name_snapshot || "",
    );
    if (id && name) result.set(id, name);
  }
  return [...result].map(([id, name]) => ({ id, name }));
});
const taskSummary = computed(() => [
  {
    label: "Свободные",
    value: staffTasks.value.filter((task) => task.status === "open").length,
    tone: "neutral",
  },
  {
    label: "В работе",
    value: staffTasks.value.filter((task) => task.status === "claimed").length,
    tone: "neutral",
  },
  {
    label: "На проверке",
    value: staffTasks.value.filter((task) => task.status === "submitted").length,
    tone: "attention",
  },
  {
    label: "Просрочены",
    value: staffTasks.value.filter(isTaskOverdue).length,
    tone: "danger",
  },
]);
const visibleTasks = computed(() => {
  const query = taskSearch.value.trim().toLocaleLowerCase("ru");
  return staffTasks.value
    .filter((task) => {
      if (
        query &&
        !`${task.title} ${task.description || ""} ${task.assignee_name || ""}`
          .toLocaleLowerCase("ru")
          .includes(query)
      ) return false;
      if (assigneeFilter.value === "free" && task.assignee_employee_id) {
        return false;
      }
      if (
        assigneeFilter.value &&
        assigneeFilter.value !== "free" &&
        ![
          task.assignee_employee_id,
          task.target_employee_id,
        ].includes(assigneeFilter.value)
      ) return false;
      if (filter.value === "done") {
        return ["approved", "cancelled"].includes(task.status);
      }
      if (filter.value === "submitted") return task.status === "submitted";
      if (filter.value === "overdue") return isTaskOverdue(task);
      return isStaffManager.value
        ? ["open", "claimed"].includes(task.status)
        : !["approved", "cancelled"].includes(task.status);
    })
    .sort((left, right) => {
      const overdueDelta =
        Number(isTaskOverdue(right)) - Number(isTaskOverdue(left));
      if (overdueDelta) return overdueDelta;
      const reviewDelta =
        Number(right.status === "submitted") -
        Number(left.status === "submitted");
      if (reviewDelta) return reviewDelta;
      const leftDue = left.due_at
        ? new Date(left.due_at).getTime()
        : Number.POSITIVE_INFINITY;
      const rightDue = right.due_at
        ? new Date(right.due_at).getTime()
        : Number.POSITIVE_INFINITY;
      return leftDue - rightDue;
    });
});
const emptyState = computed(() => {
  if (taskSearch.value.trim() || assigneeFilter.value) {
    return {
      title: "Ничего не найдено",
      description: "Измените поиск или фильтр сотрудника.",
    };
  }
  if (filter.value === "submitted") {
    return {
      title: "Нет задач на проверке",
      description: "Когда сотрудник отправит результат, задача появится здесь.",
    };
  }
  if (filter.value === "overdue") {
    return {
      title: "Просроченных задач нет",
      description: "Все текущие задачи укладываются в срок.",
    };
  }
  if (filter.value === "done") {
    return {
      title: "Завершённых задач пока нет",
      description: "Здесь появятся выполненные и отменённые задачи.",
    };
  }
  return {
    title: "Активных задач пока нет",
    description: isStaffManager.value
      ? "Создайте новую задачу, она сразу появится в списке."
      : "Новые задачи появятся здесь.",
  };
});
function isTaskOverdue(task: StaffTask) {
  if (
    !task.due_at ||
    ["approved", "cancelled"].includes(task.status)
  ) return false;
  const dueAt = new Date(task.due_at).getTime();
  return Number.isFinite(dueAt) && dueAt < Date.now();
}
function filterCount(value: TaskFilter) {
  if (value === "done") {
    return staffTasks.value.filter((task) =>
      ["approved", "cancelled"].includes(task.status),
    ).length;
  }
  if (value === "submitted") {
    return staffTasks.value.filter((task) => task.status === "submitted").length;
  }
  if (value === "overdue") {
    return staffTasks.value.filter(isTaskOverdue).length;
  }
  return staffTasks.value.filter((task) =>
    isStaffManager.value
      ? ["open", "claimed"].includes(task.status)
      : !["approved", "cancelled"].includes(task.status),
  ).length;
}
function statusLabel(status: StaffTaskStatus) {
  return {
    open: "Свободна",
    claimed: "В работе",
    submitted: "На проверке",
    approved: "Завершена",
    cancelled: "Отменена",
  }[status];
}

function priorityClass(priority?: string) {
  if (priority === "high") return "bg-red-500";
  if (priority === "low") return "bg-slate-300";
  return "bg-blue-500";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: BUSINESS_TIME_ZONE,
      }).format(date);
}

type ButtonVariant = "primary" | "secondary" | "soft" | "success" | "danger";

function actionsFor(task: StaffTask): Array<{
  value: TaskAction;
  label: string;
  variant: ButtonVariant;
}> {
  const selfId = staffIdentity.value?.employee.id;
  const actions: Array<{ value: TaskAction; label: string; variant: ButtonVariant }> = [];
  if (
    task.status === "open" &&
    (!task.target_employee_id || task.target_employee_id === selfId) &&
    !claimBlockedByOtherShift.value
  ) {
    actions.push({ value: "claim", label: "Взять задачу", variant: "primary" });
  }
  if (
    task.status === "claimed" &&
    task.assignee_employee_id === selfId &&
    !claimBlockedByOtherShift.value
  ) {
    actions.push({ value: "submit", label: "Отправить на проверку", variant: "success" });
  }
  if (
    task.status === "submitted" &&
    task.assignee_employee_id === selfId &&
    !claimBlockedByOtherShift.value
  ) {
    actions.push({ value: "submit", label: "Сдать повторно", variant: "primary" });
  }
  if (task.status === "claimed" && isStaffManager.value) {
    actions.push({ value: "release", label: "Вернуть задачу в общий пул", variant: "secondary" });
  }
  if (task.status === "submitted" && isStaffManager.value) {
    actions.push({
      value: "approve",
      label: "Проверить и подтвердить",
      variant: "success",
    });
  }
  if (
    isStaffManager.value &&
    !["approved", "cancelled"].includes(task.status)
  ) {
    actions.push({ value: "cancel", label: "Отменить задачу", variant: "danger" });
  }
  return actions;
}
function claimUnavailableReason(task: StaffTask) {
  if (
    task.status === "open" &&
    (!task.target_employee_id ||
      task.target_employee_id === staffIdentity.value?.employee.id) &&
    claimBlockedByOtherShift.value
  ) {
    return `Сейчас смена ${currentShiftOwnerName.value}`;
  }
  if (
    ["claimed", "submitted"].includes(task.status) &&
    task.assignee_employee_id === staffIdentity.value?.employee.id &&
    claimBlockedByOtherShift.value
  ) {
    return `Сейчас смена ${currentShiftOwnerName.value}. Сдать задачу можно в своей смене`;
  }
  return "";
}

function canViewTaskHistory(task: StaffTask) {
  return isStaffManager.value
    || task.assignee_employee_id === staffIdentity.value?.employee.id;
}

async function loadTasks() {
  message.value = "";
  try {
    await crmStore.fetchStaffTasks();
  } catch {
    // The store owns the visible error and retry state.
  }
}

async function createTask() {
  if (creatingTask.value) return false;
  if (!canCreateTask.value) {
    messageKind.value = "error";
    message.value = "Заполните заголовок, описание и срок задачи";
    return false;
  }
  const dueAt = businessDateTimeInputToIso(taskForm.value.due_at);
  if (!dueAt || new Date(dueAt).getTime() <= Date.now()) {
    messageKind.value = "error";
    message.value = "Срок задачи должен быть в будущем по времени Минска";
    return false;
  }
  creatingTask.value = true;
  message.value = "";
  try {
    await crmStore.createStaffTask({
      title: taskForm.value.title,
      description: taskForm.value.description || undefined,
      due_at: dueAt,
      employee_id: taskForm.value.employee_id || null,
    });
    taskForm.value = {
      title: "",
      description: "",
      due_at: "",
      employee_id: "",
    };
    createOpen.value = false;
    filter.value = "active";
    messageKind.value = "info";
    message.value = "Задача создана";
    return true;
  } catch (error: any) {
    messageKind.value = "error";
    message.value = error?.outcomeUnknown
      ? "Ответ сервера не получен. Обновите список перед повтором."
      : error?.message || "Не удалось создать задачу";
    if (error?.outcomeUnknown) void loadTasks();
    return false;
  } finally {
    creatingTask.value = false;
  }
}

function requestClose() {
  if (taskBusy.value || actionDialog.value) return;
  emit("close");
}

async function openActionDialog(
  task: StaffTask,
  action: ConfirmedTaskAction,
) {
  if (taskBusy.value) return;
  actionDialog.value = {
    task,
    action,
    note: action === "submit" ? String(task.result_note || "") : "",
  };
  if (action !== "approve") {
    await nextTick();
    actionNoteInput.value?.focus();
  }
}

function closeActionDialog() {
  if (taskBusy.value) return;
  actionDialog.value = null;
}

function handleActionClick(task: StaffTask, action: TaskAction) {
  if (["submit", "approve", "cancel"].includes(action)) {
    void openActionDialog(task, action as ConfirmedTaskAction);
    return;
  }
  void runAction(task, action);
}

async function confirmActionDialog() {
  const dialog = actionDialog.value;
  if (!dialog || !canConfirmActionDialog.value) return false;
  const data: Record<string, string> = {};
  if (dialog.action === "cancel") data.reason = dialog.note.trim();
  if (dialog.action === "submit" && dialog.note.trim()) {
    data.result_note = dialog.note.trim();
  }
  return runAction(dialog.task, dialog.action, data);
}

async function runAction(
  task: StaffTask,
  action: TaskAction,
  data: Record<string, string> = {},
) {
  if (pendingActionId.value) return false;
  pendingActionId.value = `${task.id}:${action}`;
  message.value = "";
  try {
    await crmStore.performStaffTaskAction(task.id, action, data);
    if (
      actionDialog.value?.task.id === task.id
      && actionDialog.value.action === action
    ) {
      actionDialog.value = null;
    }
    messageKind.value = "info";
    message.value = "Задача обновлена";
    return true;
  } catch (error: any) {
    const staffError = error as StaffApiError;
    if (staffError.code === "shift_required") {
      emit("shiftRequired", {
        label: `${actionLabel(action)} задачу «${task.title}»`,
        retry: () => runAction(task, action, data),
      });
      return false;
    }
    messageKind.value = "error";
    if (staffError.outcomeUnknown) {
      message.value =
        "Ответ сервера не получен. Обновите список перед повтором, чтобы не выполнить действие дважды.";
      void loadTasks();
    } else if (staffError.status === 409) {
      message.value = "Задача уже изменилась. Список обновлён.";
      void loadTasks();
    } else {
      message.value = staffError.message || "Не удалось обновить задачу";
    }
    return false;
  } finally {
    pendingActionId.value = "";
  }
}

function actionLabel(action: TaskAction) {
  return {
    claim: "Взять задачу",
    submit: "Отправить на проверку",
    approve: "Подтвердить выполнение",
    cancel: "Отменить задачу",
    release: "Вернуть задачу в общий пул",
  }[action];
}

function taskHistoryActionLabel(action: string) {
  const labels: Record<string, string> = {
    create: "Задача создана",
    claim: "Задача принята",
    submit: "Отправлена на проверку",
    approve: "Выполнение подтверждено",
    cancel: "Задача отменена",
    release: "Исполнитель освобождён",
  };
  return labels[action] || action || "Изменение";
}

async function toggleTaskHistory(task: StaffTask) {
  if (historyLoadingId.value) return;
  if (historyTaskId.value === task.id) {
    historyTaskId.value = "";
    taskHistory.value = [];
    historyError.value = "";
    return;
  }
  historyTaskId.value = task.id;
  historyLoadingId.value = task.id;
  historyError.value = "";
  taskHistory.value = [];
  try {
    const response = await crmStore.fetchStaffTaskHistory(task.id);
    if (historyTaskId.value === task.id) {
      taskHistory.value = response.history || [];
    }
  } catch (error: any) {
    if (historyTaskId.value === task.id) {
      historyError.value = error?.message || "Не удалось загрузить историю";
    }
  } finally {
    if (historyLoadingId.value === task.id) {
      historyLoadingId.value = "";
    }
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      taskSearch.value = "";
      assigneeFilter.value = "";
      // Модалку открывают и вне раздела сотрудников, а список нужен для выбора,
      // кому поручить задачу.
      if (isStaffManager.value && !staffEmployees.value.length) {
        void crmStore.fetchStaffEmployees().catch(() => undefined);
      }
      void loadTasks().then(() => {
        filter.value =
          isStaffManager.value &&
          staffTasks.value.some((task) => task.status === "submitted")
            ? "submitted"
            : "active";
      });
    } else if (!taskBusy.value) {
      actionDialog.value = null;
    }
  },
);
</script>
