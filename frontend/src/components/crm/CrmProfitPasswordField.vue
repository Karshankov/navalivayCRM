<script setup lang="ts">
defineProps<{
  modelValue: string;
  passwordError?: string;
  verifyingPassword?: boolean;
  placeholder?: string;
  labelClass?: string;
  inputClass?: string;
}>();

defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<template>
  <div>
    <!-- Chrome: форма пароля без username → [DOM] Password forms… -->
    <input
      type="text"
      name="username"
      autocomplete="username"
      tabindex="-1"
      aria-hidden="true"
      class="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none"
      value="navalivay-profit"
      readonly
    />
    <label :class="labelClass ?? 'mb-1 block text-sm font-medium text-gray-700'">
      <slot name="label">Ключ</slot>
    </label>
    <input
      :value="modelValue"
      type="password"
      autocomplete="current-password"
      :class="
        inputClass ??
        'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100'
      "
      :placeholder="placeholder ?? 'XXX-XXX-XXX'"
      :disabled="verifyingPassword"
      @input="
        $emit('update:modelValue', ($event.target as HTMLInputElement).value)
      "
    />
    <p v-if="passwordError" class="mt-2 text-sm text-red-600">
      {{ passwordError }}
    </p>
  </div>
</template>
