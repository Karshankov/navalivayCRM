import { createRouter, createWebHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";
import { useAdminStore } from "@/stores/admin";

const requireAdminAuth = (to: any, from: any, next: any) => {
  const adminStore = useAdminStore();
  if (!adminStore.isAuthenticated) {
    next("/admin");
  } else {
    next();
  }
};

const DYNAMIC_IMPORT_RELOAD_KEY = "navalivay_dynamic_import_reload";
const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
];

function clearDynamicImportReloadGuard() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
}

function isDynamicImportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function reloadRouteOnce(targetPath: string) {
  if (typeof window === "undefined") return false;

  const normalizedTargetPath = targetPath || window.location.pathname || "/";
  const previousAttempt = sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY);

  if (previousAttempt === normalizedTargetPath) {
    sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
    return false;
  }

  sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, normalizedTargetPath);
  window.location.assign(normalizedTargetPath);
  return true;
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/opt/:code/:secret",
      name: "wholesale-entry",
      component: () => import("../views/WholesaleEntryView.vue"),
      props: true,
    },
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/category/:slug",
      name: "category",
      component: () => import("../views/CategoryView.vue"),
      props: true,
    },
    {
      path: "/p/:id",
      name: "product",
      component: () => import("../views/ProductView.vue"),
      props: true,
    },
    {
      path: "/checkout",
      name: "checkout",
      component: () => import("../views/CheckoutView.vue"),
    },
    {
      path: "/my-order",
      name: "my-order",
      component: () => import("../views/MyOrderView.vue"),
    },
    {
      path: "/profile",
      name: "profile",
      component: () => import("../views/ProfileView.vue"),
    },
    {
      path: "/profile/orders",
      name: "order-history",
      component: () => import("../views/OrderHistoryView.vue"),
    },
    {
      path: "/profile/orders/:orderId",
      name: "order-detail",
      component: () => import("../views/OrderDetailView.vue"),
      props: true,
    },
    {
      path: "/wheel",
      name: "wheel",
      component: () => import("../views/WheelView.vue"),
    },
    {
      path: "/wheel/how-it-works",
      name: "wheel-how-to",
      component: () => import("../views/WheelHowToView.vue"),
    },
    {
      path: "/wheel/my-prizes",
      name: "wheel-my-prizes",
      component: () => import("../views/WheelMyPrizesView.vue"),
    },
    {
      path: "/admin",
      name: "Admin",
      component: () => import("@/views/AdminView.vue"),
      children: [
        {
          path: "crm",
          redirect: { name: "CrmOrders" },
        },
        {
          path: "crm/orders",
          name: "CrmOrders",
          component: () => import("@/views/admin/crm/CrmOrders.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/orders/archive",
          name: "CrmOrdersArchive",
          component: () => import("@/views/admin/crm/CrmOrdersArchive.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/orders/:id",
          name: "CrmOrderDetail",
          component: () => import("@/views/admin/crm/CrmOrderDetail.vue"),
          props: true,
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/customers",
          name: "CrmCustomers",
          component: () => import("@/views/admin/crm/CrmCustomers.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/customers/:id",
          name: "CrmCustomerDetail",
          component: () => import("@/views/admin/crm/CrmCustomerDetail.vue"),
          props: true,
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/procurements",
          name: "CrmProcurements",
          component: () => import("@/views/admin/crm/CrmProcurements.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/finances",
          name: "CrmFinances",
          component: () => import("@/views/admin/crm/CrmFinances.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/employees",
          name: "CrmEmployees",
          component: () => import("@/views/admin/crm/CrmEmployees.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/write-offs",
          name: "CrmWriteOffs",
          component: () => import("@/views/admin/crm/CrmWriteOffs.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/pos-sales",
          name: "CrmPosSales",
          component: () => import("@/views/admin/crm/CrmPosSales.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/message-templates",
          name: "CrmMessageTemplates",
          component: () => import("@/views/admin/crm/CrmMessageTemplates.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/loyalty",
          name: "CrmLoyalty",
          component: () => import("@/views/admin/crm/CrmLoyalty.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/wheel",
          name: "CrmWheel",
          component: () => import("@/views/admin/crm/CrmWheel.vue"),
          beforeEnter: requireAdminAuth,
        },
        {
          path: "crm/reviews",
          name: "CrmReviews",
          component: () => import("@/views/admin/crm/CrmReviews.vue"),
          beforeEnter: requireAdminAuth,
        },
      ],
    },
    {
      path: "/:pathMatch(.*)*",
      name: "notFound",
      redirect: "/",
    },
  ],
});

const visitLogger = typeof window !== "undefined" ? createVisitLogger() : null;

router.onError((error, to) => {
  const fallbackPath = typeof window !== "undefined" ? window.location.pathname : "/";
  const targetPath = to?.fullPath || fallbackPath;

  if (isDynamicImportError(error) && reloadRouteOnce(targetPath)) {
    return;
  }

  console.error("[router] Navigation error", error);
});

router.afterEach(() => {
  clearDynamicImportReloadGuard();
});

if (visitLogger) {
  router.afterEach((to) => {
    visitLogger.log(to);
  });

  router.isReady().then(() => {
    clearDynamicImportReloadGuard();
    visitLogger.log(router.currentRoute.value);
  });
}

export default router;

function createVisitLogger() {
  let lastPath = "";
  let lastLoggedAt = 0;

  function shouldLog(path: string) {
    if (!path) return false;
    if (path.startsWith("/admin")) return false;
    const now = Date.now();
    if (path === lastPath && now - lastLoggedAt < 2000) return false;
    return true;
  }

  function resolveAction(path: string) {
    if (path === "/") return "view_home";
    if (path.startsWith("/p/")) return "view_product";
    if (path.startsWith("/category/")) return "view_category";
    return "view_page";
  }

  async function log(route: { fullPath: string }) {
    try {
      const fullPath = route.fullPath;
      if (!shouldLog(fullPath)) return;

      const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      if (!telegramUser?.id) return;

      const payload = {
        telegram_id: String(telegramUser.id),
        telegram_username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        page_path: fullPath,
        action: resolveAction(fullPath),
      };

      await fetch("/api/visits/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      lastPath = fullPath;
      lastLoggedAt = Date.now();
    } catch (error) {
      console.warn("[visitLogger] Failed to log visit", error);
    }
  }

  return { log };
}
