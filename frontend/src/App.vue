<script setup lang="ts">
import { RouterView } from "vue-router";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import VapeSmoke from "@/components/VapeSmoke.vue";
import BlockedScreen from "@/components/BlockedScreen.vue";
import ReviewPromptModal from "@/components/reviews/ReviewPromptModal.vue";
import ReferralAuthorizationGate from "@/components/ReferralAuthorizationGate.vue";
import { useCustomerBlock } from "@/composables/useCustomerBlock";
import { useUserStore } from "@/stores/user";
import { useCatalogStore } from "@/stores/catalog";
import OfflinePlaceholder from "@/components/OfflinePlaceholder.vue";
import { topLevelViewKey } from "@/router/view-key";
const route = useRoute();
const { currentBlock, isBlocked, refreshBlock } = useCustomerBlock();
const userStore = useUserStore();
const catalogStore = useCatalogStore();
const isAdminRoute = computed(() => route.path.startsWith("/admin"));
// Клиентская часть закрыта до ответа сервера: каталог и цены даже не
// монтируются, пока новый клиент не пройдёт обязательную авторизацию.
const referralGateActive = ref(!isAdminRoute.value);

const showCustomerContent = computed(
  () => isAdminRoute.value || (!referralGateActive.value && !isBlocked.value),
);

watch(isAdminRoute, (isAdmin, wasAdmin) => {
  if (isAdmin) {
    referralGateActive.value = false;
  } else if (wasAdmin) {
    referralGateActive.value = true;
  }
});

// Экран блокировки клиента не показываем в админке —
// у админа другая аутентификация, а не клиентский telegram_id.
const showBlockedScreen = computed(
  () => isBlocked.value && !route.path.startsWith("/admin"),
);

/* ===== Оффлайн-заглушка =====
 * Сервер недоступен: браузер без сети ИЛИ первичная загрузка каталога
 * упала (offline-флаг стора). Заглушка с кнопкой «Попробовать снова»
 * (полная перезагрузка) закрывает весь клиентский контент —
 * в админке обычные механизмы ошибок. */
const browserOffline = ref(
  typeof navigator !== "undefined" ? !navigator.onLine : false,
);

function syncBrowserOffline() {
  browserOffline.value = !navigator.onLine;
}

onMounted(() => {
  window.addEventListener("offline", syncBrowserOffline);
  window.addEventListener("online", syncBrowserOffline);
});

const showOfflinePlaceholder = computed(
  () =>
    !isAdminRoute.value &&
    (browserOffline.value ||
      gateNetworkError.value ||
      (catalogStore.offline && !catalogStore.categories.length)),
);

/** Экраны с каруселью вкладок (TabShell сам рисует шапку и таб-бар). */
const TAB_SHELL_PATHS = new Set(["/", "/liquids", "/disposables", "/devices", "/accessories"]);

const isTabShellRoute = computed(() => TAB_SHELL_PATHS.has(route.path));

/**
 * Анимация перехода между топ-уровневыми экранами: глубокие экраны
 * (товар, чекаут, профиль) въезжают слайдом справа и уезжают обратно;
 * между вкладками карусели анимации нет — их живёт свайп.
 */
const pageTransitionName = computed(() => (isTabShellRoute.value ? "shell-fade" : "page-slide"));

const showTabBar = computed(() => {
  // Таб-бар живёт внутри TabShell; на остальных customer-экранах его нет.
  return false;
});

const showReviewPrompt = computed(() => isTabShellRoute.value);
// Гейт авторизации нужен только при живом сервере: когда сеть лежит,
// его модалки «Не удалось проверить доступ» перекрывают оффлайн-
// заглушку. Гейт смонтируется после перезагрузки по кнопке.
const showReferralGate = computed(
  () => !isAdminRoute.value && !isBlocked.value && !showOfflinePlaceholder.value,
);

function handleReferralGateActive(active: boolean) {
  referralGateActive.value = active;
}

/** Гейт не смог достучаться до сервера (сеть лежит) — показываем
 * оффлайн-заглушку; false — сервер ответил, заглушка не нужна. */
const gateNetworkError = ref(false);
function handleGateNetworkError(failed: boolean) {
  gateNetworkError.value = failed;
}

// Глобальный плавающий виджет рулетки. В новом шелле вход на рулетку —
// иконка в шапке главной вкладки, плавающий виджет отключаем.
const showWheelWidget = computed(() => false);

onMounted(() => {
  if (typeof window !== "undefined" && window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
  }
  // Проверяем статус блокировки клиента сразу при заходе в миниапку.
  // Если активен — ниже показываем BlockedScreen поверх всего.
  refreshBlock();
  // Прогреваем аватар и профиль: initData photo_url сохраняется на сервере
  // и становится доступен в отзывах без отдельного захода в «Профиль».
  if (window.Telegram?.WebApp?.initData) {
    userStore.fetchProfile().catch(() => undefined);
  }
});
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'app-shell--with-tab-bar': showCustomerContent && showTabBar, 'app-shell--admin': isAdminRoute }"
    style="background: var(--app-page-background, #ffffff)"
  >
    <!-- Оффлайн-заглушка: сервер недоступен — вместо всего клиентского
         контента макет с черепом и «Попробовать снова». -->
    <OfflinePlaceholder v-if="showOfflinePlaceholder" />

    <div v-else-if="showCustomerContent" class="app-shell__protected">
      <div class="app-shell__content">
        <RouterView v-slot="{ Component, route: viewRoute }">
          <KeepAlive>
            <Transition :name="pageTransitionName" mode="out-in">
              <component :is="Component" :key="topLevelViewKey(viewRoute)" />
            </Transition>
          </KeepAlive>
        </RouterView>
      </div>
      <VapeSmoke />
      <ReviewPromptModal v-if="showReviewPrompt" />
    </div>
    <ReferralAuthorizationGate
      v-if="showReferralGate"
      @gate-active="handleReferralGateActive"
      @network-error="handleGateNetworkError"
    />
    <BlockedScreen
      v-if="showBlockedScreen"
      :reason="currentBlock?.reason ?? null"
      :block-until="currentBlock?.block_until ?? null"
    />
  </div>
</template>

<style>
:root {
  --app-screen-max-width: 393px;
  --app-bottom-tab-bar-height: 52px;
  --app-cart-bottom-offset: var(--app-bottom-tab-bar-height, 52px);
  --app-page-background: #f5f7fa;
}

html,
body,
#app {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

.app-shell {
  min-height: 100vh;
  overflow-x: hidden;
}

/* Новый шелл вкладок фиксирован на экран (position: fixed), документ
 * под ним не скроллится. Документ-скролл оставляем только глубоким
 * экранам — их контент в обычном потоке. */
.app-shell:has(> .app-shell__protected > .app-shell__content > *) {
  min-height: 100vh;
}

.app-shell--with-tab-bar {
  padding-bottom: var(--app-bottom-tab-bar-height, 130px);
  box-sizing: border-box;
}

/* Desktop admin content owns its scroll; customer and mobile pages stay in document flow. */
@media (min-width: 768px) {
  .app-shell--admin {
    /* Keep absolutely positioned accessibility labels inside the clipped admin shell. */
    position: relative;
    height: 100vh;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
  }

  .app-shell--admin > .app-shell__protected,
  .app-shell--admin > .app-shell__protected > .app-shell__content {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
}

/* Плавные переходы между страницами - fade */
.page-fade-enter-active {
  transition: opacity 0.25s ease-out;
}

.page-fade-leave-active {
  transition: opacity 0.2s ease-in;
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

/* Возврат к карусели вкладок — короткий фейд, без слайда. */
.shell-fade-enter-active {
  transition: opacity 0.22s ease-out;
}

.shell-fade-leave-active {
  transition: opacity 0.18s ease-in;
}

.shell-fade-enter-from,
.shell-fade-leave-to {
  opacity: 0;
}

/* Глубокие экраны (товар, чекаут, профиль) — слайд справа. */
.page-slide-enter-active {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.28s ease-out;
}

.page-slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.22s ease-in;
}

.page-slide-enter-from {
  transform: translateX(30%);
  opacity: 0;
}

.page-slide-leave-to {
  transform: translateX(30%);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .page-slide-enter-active,
  .page-slide-leave-active,
  .shell-fade-enter-active,
  .shell-fade-leave-active {
    transition: opacity 0.15s ease;
  }

  .page-slide-enter-from,
  .page-slide-leave-to {
    transform: none;
  }
}
</style>
