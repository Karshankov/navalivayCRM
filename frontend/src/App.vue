<script setup lang="ts">
import { RouterView } from "vue-router";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import VapeSmoke from "@/components/VapeSmoke.vue";
import BottomTabBar from "@/components/BottomTabBar.vue";
import BlockedScreen from "@/components/BlockedScreen.vue";
import WheelHomeWidget from "@/components/wheel/WheelHomeWidget.vue";
import ReviewPromptModal from "@/components/reviews/ReviewPromptModal.vue";
import ReferralAuthorizationGate from "@/components/ReferralAuthorizationGate.vue";
import { useCustomerBlock } from "@/composables/useCustomerBlock";
import { useUserStore } from "@/stores/user";
import { topLevelViewKey } from "@/router/view-key";
const route = useRoute();
const { currentBlock, isBlocked, refreshBlock } = useCustomerBlock();
const userStore = useUserStore();
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

const showTabBar = computed(() => {
  const path = route.path;
  if (path.startsWith("/admin")) return false;
  if (path === "/checkout") return false;
  if (path === "/my-order") return false;
  // Опт получает свой набор табов вместо скрытого футера -
  // см. docs/wholesale-rules.md и спецификацию рулетки.
  return true;
});

const showReviewPrompt = computed(() => showTabBar.value);
const showReferralGate = computed(
  () => !isAdminRoute.value && !isBlocked.value,
);

function handleReferralGateActive(active: boolean) {
  referralGateActive.value = active;
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
    :class="{ 'app-shell--with-tab-bar': showCustomerContent && showTabBar }"
    style="background: var(--app-page-background, #ffffff)"
  >
    <div v-if="showCustomerContent" class="app-shell__protected">
      <div class="app-shell__content">
        <RouterView v-slot="{ Component, route: viewRoute }">
          <Transition name="page-fade" mode="out-in">
            <component :is="Component" :key="topLevelViewKey(viewRoute)" />
          </Transition>
        </RouterView>
      </div>
      <VapeSmoke />
      <BottomTabBar v-if="showTabBar" />
      <ReviewPromptModal v-if="showReviewPrompt" />
      <WheelHomeWidget v-if="showWheelWidget" />
    </div>
    <ReferralAuthorizationGate
      v-if="showReferralGate"
      @gate-active="handleReferralGateActive"
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
  --app-bottom-tab-bar-height: 130px;
  --app-cart-bottom-offset: var(--app-bottom-tab-bar-height, 130px);
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

.app-shell--with-tab-bar {
  padding-bottom: var(--app-bottom-tab-bar-height, 130px);
  box-sizing: border-box;
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
