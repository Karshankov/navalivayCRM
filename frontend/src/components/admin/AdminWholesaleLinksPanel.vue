<template>
  <div class="space-y-4">
    <div v-if="isLoading" class="rounded-2xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
      Загружаем оптовые ссылки...
    </div>

    <div v-else-if="!links.length" class="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
      Оптовые ссылки пока недоступны
    </div>

    <div v-else class="grid gap-4">
      <article
        v-for="link in sortedLinks"
        :key="link.id"
        class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-gray-900">{{ link.label }}</h3>
            <p class="mt-1 text-sm text-gray-500">
              Минимальный заказ: {{ formatAmount(link.minOrderAmount) }} BYN
            </p>
          </div>
          <div
            class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
            :class="link.missingGroupCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'"
          >
            {{ link.filledGroupCount }}/{{ link.totalTargetGroups }} линеек заполнено
          </div>
        </div>

        <div class="mt-3 flex flex-col gap-1">
          <button
            type="button"
            class="w-fit rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!buildTelegramDeepLink(link)"
            @click="copyTelegramLink(link)"
          >
            Скопировать ссылку
          </button>
          <p v-if="!buildTelegramDeepLink(link)" class="text-xs text-amber-700">
            Задайте TELEGRAM_BOT_USERNAME на сервере или проверьте путь ссылки.
          </p>
        </div>

        <p v-if="link.missingGroupCount > 0" class="mt-3 text-xs text-amber-700">
          Для {{ link.missingGroupCount }} линеек цены еще не заполнены. Они не попадут в этот прайс.
        </p>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  buildTelegramMiniAppOpenUrl,
  wholesalePairToStartParam,
} from '@/utils/telegramMiniAppContext'

interface WholesaleLink {
  id: string
  code: string
  label: string
  minOrderAmount: number
  sortOrder: number
  path: string | null
  totalTargetGroups: number
  filledGroupCount: number
  missingGroupCount: number
}

const props = withDefaults(defineProps<{
  links?: WholesaleLink[]
  isLoading?: boolean
}>(), {
  links: () => [],
  isLoading: false
})

const telegramBotUsername = ref('')
const telegramMiniAppShortName = ref('')

const sortedLinks = computed(() => {
  return [...(props.links || [])].sort((left, right) => left.sortOrder - right.sortOrder)
})

onMounted(async () => {
  try {
    const r = await fetch('/api/settings')
    const j = await r.json()
    telegramBotUsername.value = String(j.telegram_bot_username || '')
      .replace(/^@/, '')
      .trim()
    telegramMiniAppShortName.value = String(j.telegram_mini_app_short_name || '')
      .trim()
      .replace(/^\/+|\/+$/g, '')
  } catch {
    telegramBotUsername.value = ''
  }
})

function buildTelegramDeepLink(link: WholesaleLink): string {
  const bot = telegramBotUsername.value
  if (!bot || !link.path) {
    return ''
  }
  const m = link.path.replace(/\/+$/, '').match(/^\/opt\/([^/]+)\/([^/]+)$/)
  if (!m) {
    return ''
  }
  const sp = wholesalePairToStartParam(m[1], m[2])
  if (!sp) {
    return ''
  }
  return (
    buildTelegramMiniAppOpenUrl(bot, sp, {
      miniAppShortName: telegramMiniAppShortName.value || null,
    }) || ''
  )
}

async function copyTelegramLink(link: WholesaleLink) {
  const text = buildTelegramDeepLink(link)
  if (!text) {
    return
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    console.error('[AdminWholesaleLinksPanel] Failed to copy telegram link', error)
  }
}

function formatAmount(value: number) {
  return Number(value || 0).toFixed(0)
}
</script>
