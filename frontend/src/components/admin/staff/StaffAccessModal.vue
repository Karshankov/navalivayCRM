<template>
  <AdminModal
    :is-open="open"
    title="Вход сотрудника"
    description="Введите личный ПИН. Он не сохраняется на устройстве."
    size="sm"
    :show-actions="false"
    :persistent="staffAccessLoading"
    :is-loading="staffAccessLoading"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <form class="space-y-5" @submit.prevent="submit">
      <div class="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Допуск нужен, чтобы действия, смены и показатели записывались на правильного сотрудника.
      </div>

      <div>
        <label for="staff-access-pin" class="mb-2 block text-sm font-medium text-slate-700">
          ПИН
        </label>
        <input
          id="staff-access-pin"
          ref="pinInput"
          v-model="pin"
          type="password"
          inputmode="numeric"
          pattern="[0-9]{4}"
          maxlength="4"
          autocomplete="one-time-code"
          placeholder="••••"
          class="min-h-[56px] w-full rounded-xl border border-slate-300 px-4 text-center text-2xl tracking-[0.55em] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          :disabled="staffAccessLoading"
          required
          @input="sanitizePin"
        />
      </div>

      <p
        v-if="errorMessage"
        class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        role="alert"
        aria-live="assertive"
      >
        {{ errorMessage }}
      </p>

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <CrmButton
          variant="secondary"
          type="button"
          :disabled="staffAccessLoading"
          @click="emit('close')"
        >
          Отмена
        </CrmButton>
        <CrmButton
          variant="primary"
          type="submit"
          :loading="staffAccessLoading"
          loading-label="Проверяем…"
          :disabled="pin.length !== 4"
        >
          Войти
        </CrmButton>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import AdminModal from "@/components/AdminModal.vue";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import { useCrmStore } from "@/stores/crm";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; success: [] }>();
const crmStore = useCrmStore();
const { staffAccessLoading } = storeToRefs(crmStore);
const pin = ref("");
const errorMessage = ref("");
const pinInput = ref<HTMLInputElement | null>(null);

function sanitizePin(event: Event) {
  const input = event.target as HTMLInputElement;
  pin.value = input.value.replace(/\D/g, "").slice(0, 4);
}

async function submit() {
  if (!/^\d{4}$/.test(pin.value) || staffAccessLoading.value) return;
  errorMessage.value = "";
  try {
    await crmStore.accessStaff(pin.value);
    pin.value = "";
    emit("success");
  } catch (error: any) {
    errorMessage.value =
      error?.code === "invalid_pin"
        ? "Неверный ПИН"
        : error?.message || "Не удалось войти";
    pin.value = "";
    await nextTick();
    pinInput.value?.focus();
  }
}

watch(
  () => props.open,
  async (open) => {
    errorMessage.value = "";
    pin.value = "";
    if (open) {
      await nextTick();
      pinInput.value?.focus();
    }
  },
);
</script>
