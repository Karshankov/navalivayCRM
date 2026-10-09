<template>
  <div
    v-if="staffTrackingEnabled"
    class="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
    :class="hasOpenShift
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : 'border-amber-200 bg-amber-50 text-amber-950'"
    aria-live="polite"
  >
    <span
      class="h-2.5 w-2.5 shrink-0 rounded-full"
      :class="hasOpenShift ? 'bg-emerald-500' : 'bg-amber-500'"
      aria-hidden="true"
    />
    <div class="min-w-0">
      <div class="font-semibold">
        {{ hasOpenShift ? `Текущая смена · ${employeeName}` : "Смена не открыта" }}
      </div>
      <div class="mt-0.5 text-xs opacity-75">
        {{
          hasOpenShift
            ? "Действие запишется на этого сотрудника."
            : "Для рабочего действия система предложит открыть смену."
        }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useCrmStore } from "@/stores/crm";

const crmStore = useCrmStore();
const {
  currentStaffShift,
  staffTrackingEnabled,
} = storeToRefs(crmStore);

const hasOpenShift = computed(
  () =>
    ["active", "open"].includes(String(currentStaffShift.value?.status || "")) &&
    !(currentStaffShift.value?.ended_at || currentStaffShift.value?.closed_at),
);
const employeeName = computed(() => {
  const shift = currentStaffShift.value as any;
  return (
    shift?.employee_name ||
    [shift?.employee?.first_name, shift?.employee?.last_name]
      .filter(Boolean)
      .join(" ") ||
    "сотрудник"
  );
});
</script>
