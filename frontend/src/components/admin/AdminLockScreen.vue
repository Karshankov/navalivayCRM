<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" data-no-smoke>
      <!-- Animated background -->
      <div class="absolute inset-0 overflow-hidden opacity-10">
        <div class="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-rose-500 to-pink-500 rounded-full blur-3xl animate-pulse"></div>
        <div class="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-emerald-500 to-teal-500 rounded-full blur-3xl animate-pulse" style="animation-delay: 1s"></div>
      </div>

      <!-- Lock screen content -->
      <div class="relative z-10 w-full max-w-md px-6">
        <div class="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <!-- Lock icon -->
          <div class="mb-6 flex justify-center">
            <div class="rounded-full bg-gradient-to-br from-rose-500/20 to-pink-500/20 p-6">
              <LockClosedIcon class="h-12 w-12 text-rose-400" />
            </div>
          </div>

          <!-- Title -->
          <h2 class="mb-2 text-center text-2xl font-bold text-white">
            Доступ заблокирован
          </h2>
          <p class="mb-8 text-center text-sm text-slate-400">
            Введите лицензионный ключ
          </p>

          <!-- Error message -->
          <div
            v-if="errorMessage"
            class="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400"
          >
            {{ errorMessage }}
          </div>

          <!-- Password form -->
          <form @submit.prevent="handleUnlock" class="space-y-4">
            <div>
              <label for="lock-password" class="sr-only">Пароль</label>
              <input
                id="lock-password"
                ref="passwordInput"
                v-model="password"
                type="password"
                placeholder="XXXX-XXXX-XXXX"
                class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 backdrop-blur-sm transition-all focus:border-rose-500/50 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                :disabled="isVerifying"
                autocomplete="off"
              />
            </div>

            <button
              type="submit"
              :disabled="!password.trim() || isVerifying"
              class="w-full rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 px-4 py-3 font-semibold text-white shadow-lg transition-all hover:shadow-rose-500/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-lg"
            >
              {{ isVerifying ? 'Проверка...' : 'Разблокировать' }}
            </button>
          </form>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { LockClosedIcon } from '@heroicons/vue/24/solid'
import { useAdminStore } from '@/stores/admin'

const emit = defineEmits<{
  (e: 'unlocked'): void
}>()

const adminStore = useAdminStore()

const password = ref('')
const errorMessage = ref('')
const isVerifying = ref(false)
const passwordInput = ref<HTMLInputElement>()

onMounted(() => {
  // Auto-focus password input
  setTimeout(() => {
    passwordInput.value?.focus()
  }, 100)
})

async function handleUnlock() {
  if (!password.value.trim() || isVerifying.value) return

  errorMessage.value = ''
  isVerifying.value = true

  try {
    // Всегда проверяем пароль администратора (не пароль финансов!)
    await adminStore.login({
      username: 'admin',
      password: password.value.trim()
    })
    
    if (adminStore.isAuthenticated) {
      emit('unlocked')
    } else {
      errorMessage.value = 'Неверный ключ'
      password.value = ''
      passwordInput.value?.focus()
    }
  } catch (error: any) {
    errorMessage.value = error?.data?.message || adminStore.error || 'Неверный ключ'
    password.value = ''
    passwordInput.value?.focus()
  } finally {
    isVerifying.value = false
  }
}
</script>
