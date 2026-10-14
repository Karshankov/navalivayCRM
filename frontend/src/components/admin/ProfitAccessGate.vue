<script setup lang="ts">
/**
 * Окно ввода ключа доступа к финансовым данным — эталонный дизайн страницы
 * «Заказы» (crm-reference-page.css): белая карточка с синим градиентным
 * отблеском, чернила #081b4b, кнопка на фирменном градиенте. Ставится по
 * центру страницы, пока допуск не открыт.
 */
import { ref, watch } from 'vue'
import { LockClosedIcon } from '@heroicons/vue/24/outline'

const props = withDefaults(defineProps<{
  /** Заголовок окна. */
  title?: string
  /** Пояснение под заголовком. */
  description?: string
  /** Текст основной кнопки. */
  submitText?: string
  /** Идёт ли проверка ключа прямо сейчас. */
  verifying?: boolean
  /** Ошибка последней проверки (пусто — не показываем). */
  error?: string
}>(), {
  title: 'Введите код доступа',
  description: 'Финансовые данные закрыты ключом доступа. Введите его, чтобы продолжить.',
  submitText: 'Войти',
  verifying: false,
  error: '',
})

const emit = defineEmits<{
  (e: 'submit', password: string): void
}>()

const password = ref('')

watch(() => props.verifying, (checking) => {
  // После неудачной проверки возвращаем фокус в поле и выделяем ввод.
  if (!checking && password.value) {
    // Ничего не делаем автоматически: пользователь кликнет по полю сам.
  }
})

function submit() {
  if (!password.value.trim() || props.verifying) return
  emit('submit', password.value.trim())
}
</script>

<template>
  <div class="crm-ref crm-ref-gate-wrap">
    <form class="crm-ref-gate" autocomplete="on" @submit.prevent="submit">
      <span class="crm-ref-gate-icon" aria-hidden="true">
        <LockClosedIcon />
      </span>
      <h3 class="crm-ref-gate-title">{{ title }}</h3>
      <p class="crm-ref-gate-text">{{ description }}</p>
      <div class="crm-ref-gate-form">
        <label for="crm-profit-gate-input">Ключ</label>
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
        <input
          id="crm-profit-gate-input"
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="crm-ref-input"
          placeholder="XXX-XXX-XXX"
          :disabled="verifying"
        />
        <p v-if="error" class="crm-ref-gate-error" role="alert">{{ error }}</p>
        <div class="crm-ref-gate-actions">
          <button type="submit" class="crm-ref-button crm-ref-button--primary" :disabled="verifying">
            {{ verifying ? 'Проверяем…' : submitText }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>
