<template>
  <button
    type="button"
    class="crm-ref-switch"
    :class="{
      'crm-ref-switch--on': modelValue,
      'crm-ref-switch--busy': busy,
    }"
    :disabled="disabled || busy"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="crm-ref-switch-track" aria-hidden="true">
      <span class="crm-ref-switch-knob"></span>
    </span>
    <span>{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * Тумблер включения. В дизайн-системе CRM такого элемента не было — добавлен
 * как отдельная деталь, чтобы «включено/выключено» читалось одинаково везде.
 */
defineProps<{
  modelValue: boolean;
  label: string;
  busy?: boolean;
  disabled?: boolean;
}>();

defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>
