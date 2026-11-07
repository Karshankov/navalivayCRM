<script setup lang="ts">
import { RouterView } from "vue-router";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import VapeSmoke from "@/components/VapeSmoke.vue";
import BlockedScreen from "@/components/BlockedScreen.vue";
import WheelHomeWidget from "@/components/wheel/WheelHomeWidget.vue";
import ReviewPromptModal from "@/components/reviews/ReviewPromptModal.vue";
import ReferralAuthorizationGate from "@/components/ReferralAuthorizationGate.vue";
import TopCartBar from "@/components/TopCartBar.vue";
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

/** Верхняя панель с корзиной и профилем: только на витринных экранах
 *  клиента — не в админке, чекауте, оформленном заказе и опт-лендинге. */
const showTopCartBar = computed(() => {
  const path = route.path;
  if (path.startsWith("/admin")) return false;
  if (path === "/checkout") return false;
  if (path === "/my-order") return false;
  if (path.startsWith("/opt")) return false;
  return true;
});

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

/* Нижний красный футер (домик/рулетка/человечек) удалён: главная и
   профиль доступны из верхней панели, корзина — там же, рулетка —
   через плавающий виджет на главном экране. Промпт отзывов живёт
   только на витринных экранах (не чекаут/заказ/админ). */
const showReviewPrompt = computed(() => {
  const path = route.path;
  if (path.startsWith("/admin")) return false;
  if (path === "/checkout") return false;
  if (path === "/my-order") return false;
  if (path === "/favorites") return false;
  return true;
});

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

// Глобальный плавающий виджет рулетки. Показываем на всех customer-
// экранах, кроме самой рулетки, чекаута, оформленного заказа,
// админки и лендинга опт-ссылки (/opt/...).
const showWheelWidget = computed(() => {
  const path = route.path;
  if (path.startsWith("/admin")) return false;
  if (path === "/wheel" || path.startsWith("/wheel/")) return false;
  if (path === "/checkout") return false;
  if (path === "/my-order") return false;
  if (path === "/favorites") return false;
  if (path.startsWith("/profile/orders")) return false;
  if (path.startsWith("/opt")) return false;
  return true;
});

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
    :class="{ 'app-shell--admin': isAdminRoute }"
    style="background: var(--app-page-background, #ffffff)"
  >
    <!-- Оффлайн-заглушка: сервер недоступен — вместо всего клиентского
         контента макет с черепом и «Попробовать снова». -->
    <OfflinePlaceholder v-if="showOfflinePlaceholder" />

    <div v-else-if="showCustomerContent" class="app-shell__protected">
      <!-- Верхняя закреплённая панель: корзина слева, профиль справа.
           app-shell__topbar-sizer резервирует высоту, чтобы контент
           не перекрывался панелью. -->
      <div
        v-if="showTopCartBar"
        class="app-shell__topbar-sizer"
        aria-hidden="true"
      ></div>
      <TopCartBar v-if="showTopCartBar" :visible="showTopCartBar" />
      <div class="app-shell__content">
        <RouterView v-slot="{ Component, route: viewRoute }">
          <Transition name="page-fade" mode="out-in">
            <component :is="Component" :key="topLevelViewKey(viewRoute)" />
          </Transition>
        </RouterView>
      </div>
      <VapeSmoke />
      <ReviewPromptModal v-if="showReviewPrompt" />
      <WheelHomeWidget v-if="showWheelWidget" />
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
  /* Нижний футер удалён, но переменную оставляем: отступы тостов,
     модалок и виджетов отсчитывались от неё — теперь она задаёт
     безопасный нижний отступ (safe-area) для тех же элементов. */
  --app-bottom-tab-bar-height: calc(24px + env(safe-area-inset-bottom, 0px));
  --app-cart-bottom-offset: var(--app-bottom-tab-bar-height, 130px);
  --app-page-background: #f5f7fa;
  /* Высота закреплённой верхней панели (16px + safe-area + 54px) и
     точка залипания sticky-элементов под ней. */
  --app-topbar-height: calc(16px + env(safe-area-inset-top, 0px) + 54px);
  --app-topbar-offset: calc(var(--app-topbar-height) + 8px);
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

/* Отступ под верхнюю панель: панель + зазор, чтобы контент страницы
   не перекрывался. */
.app-shell__topbar-sizer {
  height: var(--app-topbar-offset);
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
</style>
