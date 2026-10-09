import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import UnoCSS from '@unocss/vite'
import { DEV_BACKEND_PORT } from '../shared/runtime-ports.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Важно: скрытый вход в CashierLockScreen идёт через frontend origin
  // на /api/admin/login, поэтому Vite proxy должен смотреть на тот же backend
  // порт, который поднимает scripts/dev.js. Если здесь 3001, а backend запущен
  // на другом порту вручную, пароль на lock-screen будет выглядеть "нерабочим".
  const API_TARGET = process.env.VITE_API_TARGET || env.VITE_API_TARGET || `http://127.0.0.1:${DEV_BACKEND_PORT}`

  return {
    plugins: [
      vue(),
      // ⚠️ ВАЖНО: vueDevTools() ОТКЛЮЧЕН!
      // Причина: Вызывает критическую ошибку в RouterView:
      // "TypeError: Cannot set properties of null (setting '__vrv_devtools')"
      // Эта ошибка приводит к тому, что компоненты не рендерятся через RouterView.
      // Решение: Отключить vueDevTools() или обновить до совместимой версии.
      // Дата отключения: 2025-09-30
      // vueDevTools(),
      UnoCSS()
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
    build: {
      // Отключить кэширование
      manifest: false,
      rollupOptions: {
        output: {
          // Добавляем timestamp к именам файлов для предотвращения кэширования
          entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
          assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`,
          manualChunks: {
            vendor: ['vue', 'pinia'],
            ui: ['@headlessui/vue', '@vueuse/core']
          }
        }
      }
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      include: ['src/**/*.spec.ts']
    },
    server: {
      host: '0.0.0.0', // Разрешить доступ из локальной сети
      port: 5173,
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
          secure: false
        },
        '/uploads': {
          target: API_TARGET,
          changeOrigin: true,
          secure: false
        }
      }
    }
  }
})
