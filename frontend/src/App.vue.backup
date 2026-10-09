<script setup lang="ts">
import { RouterView } from 'vue-router'
import { onMounted } from 'vue'
import VapeSmoke from '@/components/VapeSmoke.vue'
import TelegramDebugPanel from '@/components/TelegramDebugPanel.vue'

onMounted(() => {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    const tg = window.Telegram.WebApp
    tg.ready()
    tg.expand()
  }
})
</script>

<template>
  <div class="min-h-screen" style="background: #ffffff;">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>

    <VapeSmoke />
    <TelegramDebugPanel />
  </div>
</template>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

.page-enter-active,
.page-leave-active {
  transition: all 0.3s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

.page-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
</style>
