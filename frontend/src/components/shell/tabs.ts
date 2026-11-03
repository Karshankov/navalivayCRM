/**
 * Конфигурация нижних вкладок нового шелла мини-аппы.
 *
 * Модель — Instagram: 5 вкладок, центральная «Главная», по две категории
 * слева и справа. Переключение тапом по табу и горизонтальным свайпом
 * (карусельный контейнер с scroll-snap в TabShell.vue).
 *
 * Порядок вкладок и их маппинг на категории каталога живёт здесь, в одном
 * месте. Добавление/перестановка вкладки — правка этого файла.
 *
 * «Жидкости» — объединённая вкладка: две категории (солевые и обычные)
 * переключаются внутренними подтабами внутри pane (см. LiquidPane).
 */

export type TabId = "liquids" | "disposables" | "home" | "pods" | "accessories";export interface TabDefinition {
  id: TabId;
  /** URL вкладки для роутера (двусторонняя синхронизация со свайпом). */
  path: string;
  /** Название вкладки для aria-label и локальных нужд. */
  label: string;
  /** Название, которое показывается в шапке когда вкладка активна. */
  headerTitle: string;
  /** Иконка таба: id svg-иконки в BottomTabBar. */
  icon: "liquids" | "disposables" | "home" | "pods" | "accessories";
}

/** Порядок слева направо — он же порядок pane-ов в карусели. */
export const TABS: readonly TabDefinition[] = [
  {
    id: "liquids",
    path: "/liquids",
    label: "Жидкости",
    headerTitle: "Жидкости",
    icon: "liquids",
  },
  {
    id: "disposables",
    path: "/disposables",
    label: "Одноразки",
    headerTitle: "Одноразки",
    icon: "disposables",
  },
  {
    id: "home",
    path: "/",
    label: "Главная",
    headerTitle: "NAVALIVAY",
    icon: "home",
  },
  {
    id: "pods",
    path: "/pods",
    label: "POD-системы",
    headerTitle: "POD-системы",
    icon: "pods",
  },
  {
    id: "accessories",
    path: "/accessories",
    label: "Расходники",
    headerTitle: "Расходники",
    icon: "accessories",
  },
] as const;

export function tabByPath(path: string): TabDefinition | undefined {
  return TABS.find((tab) => tab.path === path);
}

export function tabById(id: TabId): TabDefinition {
  const tab = TABS.find((item) => item.id === id);
  if (!tab) {
    throw new Error(`Unknown tab id: ${id}`);
  }
  return tab;
}

/**
 * Slug-ы категорий каталога (backend /api/categories), сгруппированные
 * по вкладкам. Вкладка может объединять несколько категорий (жидкости)
 * или резервировать slug, который сейчас в БД зовётся иначе.
 */
export const CATEGORY_SLUGS_BY_TAB: Record<TabId, readonly string[]> = {
  liquids: ["salt-liquids", "freebase-liquids", "liquids"],
  disposables: ["disposable-vapes", "disposables", "odnorazki"],
  home: [],
  pods: ["pod-systems", "pods"],
  accessories: ["rashodniki", "accessories", "raskhodniki"],
};

/** Старые пути /category/:slug → новая вкладка. */
const LEGACY_PATH_BY_SLUG: Record<string, string> = {
  "salt-liquids": "/liquids",
  "freebase-liquids": "/liquids",
  liquids: "/liquids",
  "disposable-vapes": "/disposables",
  disposables: "/disposables",
  odnorazki: "/disposables",
  "pod-systems": "/pods",
  pods: "/pods",
  rashodniki: "/accessories",
  accessories: "/accessories",
  raskhodniki: "/accessories",
};

export function legacyTabPath(slug: string): string | undefined {
  return LEGACY_PATH_BY_SLUG[slug];
}

