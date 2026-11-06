import 'virtual:uno.css'
import '@/styles/navalivay-theme.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { applyTelegramWholesaleStartParam } from '@/utils/telegramMiniAppContext'
import { loadTelegramWebAppSdk } from '@/utils/loadTelegramWebAppSdk'
import { applyDevTelegramMockIfNeeded } from '@/utils/devTelegramMock'

function initTelegramChrome() {
  if (!window.Telegram?.WebApp) return
  const tg = window.Telegram.WebApp
  tg.ready()
  // Не вызываем expand(): иначе витрина всегда на полный экран. Компактный лист как на скрине
  // остаётся, если клиент открыл мини-приложение в обычном режиме (см. mode=compact в ссылке / BotFather).
}

async function bootstrap() {
  applyDevTelegramMockIfNeeded()
  await loadTelegramWebAppSdk()
  initTelegramChrome()

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)

  await router.isReady()
  await applyTelegramWholesaleStartParam(router)

  app.mount('#app')
}

void bootstrap()
