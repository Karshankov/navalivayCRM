<template>
  <section class="crm-hub-panel crm-hub-note" data-test="customer-hub-note-card">
    <div class="crm-hub-panel-head">
      <span class="crm-hub-head"><span class="crm-hub-head-icon" aria-hidden="true"><PencilSquareIcon /></span><span class="crm-hub-section-title">Заметка</span></span>
      <button type="button" class="crm-hub-btn" :disabled="disabled" data-test="customer-hub-note-edit" @click="$emit('edit')">Изменить</button>
    </div>
    <p class="crm-hub-note-text" data-test="customer-hub-note-text">{{ notes }}</p>
  </section>
</template>

<script setup lang="ts">
import { PencilSquareIcon } from '@heroicons/vue/24/outline'

defineProps<{ notes: string; disabled?: boolean }>()
defineEmits<{ (e: 'edit'): void }>()
</script>
