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
 * Slug-ы категорий — реальные из продовой БД (/api/categories):
 * zhidkosti, odnorazki, ustroyjstva, rashodniki, snyus-i-plastiny, kalyanka.
 */

export type TabId = "liquids" | "disposables" | "home" | "devices" | "accessories";

export interface TabDefinition {
  id: TabId;
  /** URL вкладки для роутера (двусторонняя синхронизация со свайпом). */
  path: string;
  /** Название вкладки для aria-label и локальных нужд. */
  label: string;
  /** Название, которое показывается в шапке когда вкладка активна. */
  headerTitle: string;
  /** Иконка таба: id svg-иконки в BottomTabBar. */
  icon: "liquids" | "disposables" | "home" | "devices" | "accessories";
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
    id: "devices",
    path: "/devices",
    label: "Устройства",
    headerTitle: "Устройства",
    icon: "devices",
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
 * по вкладкам. Вкладка может объединять несколько категорий: тогда
 * внутри pane они переключаются внутренним переключателем.
 *
 * «Снюс и кальянка» остаются без отдельных вкладок — прямые заходы
 * на /category/snyus-i-plastiny и /category/kalyanka продолжают работать
 * в полноэкранном режиме.
 */
export const CATEGORY_SLUGS_BY_TAB: Record<TabId, readonly string[]> = {
  liquids: ["zhidkosti"],
  disposables: ["odnorazki"],
  home: [],
  devices: ["ustrojstva"],
  accessories: ["rashodniki"],
};

/** Старые пути /category/:slug → новая вкладка (если есть маппинг). */
const LEGACY_PATH_BY_SLUG: Record<string, string> = {
  zhidkosti: "/liquids",
  liquids: "/liquids",
  "salt-liquids": "/liquids",
  "freebase-liquids": "/liquids",
  odnorazki: "/disposables",
  "disposable-vapes": "/disposables",
  ustroyjstva: "/devices",
  "pod-systems": "/devices",
  rashodniki: "/accessories",
  accessories: "/accessories",
};

export function legacyTabPath(slug: string): string | undefined {
  return LEGACY_PATH_BY_SLUG[slug];
}
