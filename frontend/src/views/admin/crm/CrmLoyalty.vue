<template>
  <div class="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col gap-6">
      <div class="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center">
        <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl shrink-0">Бонусы и промокоды</h1>
      </div>

      <div class="flex shrink-0 gap-2">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          class="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5"
          :class="activeTab === tab.id
            ? 'border-slate-300 bg-white text-slate-800 shadow-md'
            : 'border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 text-slate-500 hover:border-slate-300/50 hover:shadow-md'"
        >
          <component :is="tab.icon" class="h-4 w-4" />
          {{ tab.label }}
        </button>
      </div>

      <PromoCodesTab v-if="activeTab === 'promos'" class="min-h-0 flex-1" />
      <BonusSystemTab v-else class="min-h-0 flex-1" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ReceiptPercentIcon, StarIcon } from '@heroicons/vue/24/outline'
import PromoCodesTab from './loyalty/PromoCodesTab.vue'
import BonusSystemTab from './loyalty/BonusSystemTab.vue'

const tabs = [
  { id: 'promos', label: 'Промокоды', icon: ReceiptPercentIcon },
  { id: 'bonus', label: 'Бонусная система', icon: StarIcon },
] as const

const activeTab = ref<'promos' | 'bonus'>('promos')
</script>
