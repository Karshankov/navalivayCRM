<template>
  <CustomerModalShell
    :open="open"
    title="Лента выигрышей"
    reserve-tab-bar
    @close="emit('close')"
  >
    <div class="consent-body">
      <p class="consent-body__copy">
        В ленте рулетки мы показываем последние выигрыши других игроков —
        это часть веселья.
      </p>
      <p class="consent-body__copy">
        Можем ли мы показывать твоё имя и фото из Telegram, если ты
        выиграешь приз? Ты сможешь изменить решение в профиле в любой
        момент.
      </p>
    </div>

    <template #footer>
      <div class="consent-footer">
        <button
          type="button"
          class="consent-footer__primary"
          :disabled="busy"
          @click="emit('decide', true)"
        >
          Согласен
        </button>
        <button
          type="button"
          class="consent-footer__ghost"
          :disabled="busy"
          @click="emit('decide', false)"
        >
          Не сейчас
        </button>
      </div>
    </template>
  </CustomerModalShell>
</template>

<script setup lang="ts">
import CustomerModalShell from '@/components/CustomerModalShell.vue'

interface Props {
  open: boolean
  busy?: boolean
}

withDefaults(defineProps<Props>(), { busy: false })

const emit = defineEmits<{
  close: []
  decide: [consent: boolean]
}>()
</script>

<style scoped>
.consent-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.consent-body__copy {
  margin: 0;
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  line-height: 19px;
  color: #1f2933;
}

.consent-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.consent-footer__primary,
.consent-footer__ghost {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 24px;
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.15s ease;
}

.consent-footer__primary {
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
}

.consent-footer__primary:active {
  transform: scale(0.98);
}

.consent-footer__ghost {
  background: rgba(15, 23, 42, 0.05);
  color: #1f2933;
}

.consent-footer__primary:disabled,
.consent-footer__ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
