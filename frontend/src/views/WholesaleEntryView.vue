<template>
  <div class="min-h-screen bg-[#f5f7fa] px-4 py-10">
    <div class="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
      <div v-if="needTelegramClient" class="space-y-4 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600 text-xl">
          ✈
        </div>
        <div>
          <h1 class="text-xl font-semibold text-gray-900">Откройте в Telegram</h1>
          <p class="mt-2 text-sm text-gray-500">
            Оптовый прайс и оформление с вашим @username доступны только внутри Telegram Mini App.
            В обычном браузере профиль не передаётся.
          </p>
        </div>
        <a
          v-if="telegramOpenHref"
          :href="telegramOpenHref"
          class="inline-flex w-full items-center justify-center rounded-2xl bg-[#229ED9] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1f8fc7]"
        >
          Открыть в Telegram
        </a>
        <p v-else class="text-left text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
          На сервере не задано имя бота (переменная TELEGRAM_BOT_USERNAME в .env).
          Попросите менеджера отправить вам эту же ссылку в чат Telegram и откройте её там.
        </p>
        <button
          type="button"
          class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          @click="copyCurrentUrl"
        >
          Скопировать ссылку на прайс
        </button>
        <button
          type="button"
          class="w-full rounded-2xl bg-brand-dark px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark/90"
          @click="router.replace('/')"
        >
          В каталог (без опта)
        </button>
      </div>

      <div v-else-if="isLoading" class="space-y-4 text-center">
        <div class="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-dark/20 border-t-brand-dark"></div>
        <div>
          <h1 class="text-xl font-semibold text-gray-900">Открываем оптовый прайс</h1>
          <p class="mt-2 text-sm text-gray-500">Проверяем ссылку и подготавливаем витрину...</p>
        </div>
      </div>

      <div v-else class="space-y-4 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          !
        </div>
        <div>
          <h1 class="text-xl font-semibold text-gray-900">Не удалось открыть прайс</h1>
          <p class="mt-2 text-sm text-gray-500">{{ errorMessage }}</p>
        </div>
        <button
          type="button"
          class="w-full rounded-2xl bg-brand-dark px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark/90"
          @click="router.replace('/')"
        >
          Вернуться в каталог
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useCartStore } from '@/stores/cart'
import { useCatalogStore } from '@/stores/catalog'
import { useSettingsStore } from '@/stores/settings'
import { useWholesaleStore } from '@/stores/wholesale'
import {
  buildTelegramMiniAppOpenUrl,
  hasTelegramMiniAppUserContext,
  wholesalePairToStartParam,
} from '@/utils/telegramMiniAppContext'

const route = useRoute()
const router = useRouter()
const cartStore = useCartStore()
const catalogStore = useCatalogStore()
const wholesaleStore = useWholesaleStore()
const settingsStore = useSettingsStore()

const isLoading = ref(true)
const errorMessage = ref('')
const needTelegramClient = ref(false)

const codeParam = computed(() => String(route.params.code || '').trim())
const secretParam = computed(() => String(route.params.secret || '').trim())

const telegramOpenHref = computed(() => {
  const bot = (settingsStore.settings.telegram_bot_username || '').replace(/^@/, '').trim()
  if (!bot || !codeParam.value || !secretParam.value) {
    return ''
  }
  const sp = wholesalePairToStartParam(codeParam.value, secretParam.value)
  if (!sp) return ''
  const short = (settingsStore.settings.telegram_mini_app_short_name || '').trim()
  return buildTelegramMiniAppOpenUrl(bot, sp, { miniAppShortName: short || null }) || ''
})

function copyCurrentUrl() {
  const url = typeof window !== 'undefined' ? window.location.href : ''
  if (!url) return
  void navigator.clipboard?.writeText(url)
}

onMounted(async () => {
  const code = codeParam.value
  const secret = secretParam.value

  if (!code || !secret) {
    isLoading.value = false
    errorMessage.value = 'Оптовая ссылка неполная'
    return
  }

  if (!hasTelegramMiniAppUserContext()) {
    await settingsStore.fetchSettings()
    needTelegramClient.value = true
    isLoading.value = false
    return
  }

  try {
    const switchingToAnotherLink = !wholesaleStore.isSameLink(code, secret)
    if (switchingToAnotherLink && (cartStore.items.length > 0 || cartStore.editingOrderId)) {
      const confirmed = window.confirm(
        'Текущая корзина будет очищена и открыт другой оптовый прайс. Продолжить?',
      )
      if (!confirmed) {
        await router.replace('/')
        return
      }

      cartStore.clearCart()
      cartStore.clearOrderEdit()
    }

    await wholesaleStore.activateFromLink(code, secret)
    await catalogStore.fetchAllProducts({ force: true })

    await router.replace('/')
  } catch (error: any) {
    console.error('[WholesaleEntry] Failed to activate wholesale link', error)
    errorMessage.value =
      error?.message || wholesaleStore.error || 'Оптовая ссылка недействительна'
    isLoading.value = false
  }
})
</script>
