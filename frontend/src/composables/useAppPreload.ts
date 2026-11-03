/**
 * Полная предзагрузка мини-аппы до показа интерфейса.
 *
 * Философия: приложение стартует чуть дольше (сплэш с анимацией), зато
 * внутри — ноль загрузок: каталог, обложки категорий и линеек, лояльность,
 * избранное уже в сторах, свайпы и вкладки открываются моментально.
 *
 * Прогресс шагов транслируется в сплэш, шаги идут параллельно группами:
 * сначала критичные данные, потом картинки (Image() decode).
 */
import type { Ref } from "vue";
import { ref } from "vue";

import { useCatalogStore } from "@/stores/catalog";
import { useFavoritesStore } from "@/stores/favorites";
import { useLoyaltyStore } from "@/stores/loyalty";

export interface PreloadState {
  visible: Ref<boolean>;
  progress: Ref<number>;
  label: Ref<string>;
}

export function useAppPreload() {
  const visible = ref(true);
  const progress = ref(0);
  const label = ref("Проверяем доступ...");

  /** Всего весов: каталог 30, картинки 40, лояльность 15, избранное 15. */
  const TOTAL_WEIGHT = 100;

  function advance(delta: number, nextLabel: string) {
    progress.value = Math.min(TOTAL_WEIGHT, progress.value + delta);
    label.value = nextLabel;
  }

  /** Предзагрузка списка URL картинок через decode браузера. */
  async function preloadImages(
    urls: readonly string[],
    onBatchDone: () => void,
    timeoutMs = 6000,
  ): Promise<void> {
    const unique = [...new Set(urls.filter(Boolean))];
    // Картинки греем пачками, чтобы не забивать сеть.
    const BATCH = 24;
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      await Promise.race([
        Promise.all(
          batch.map(
            (url) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => resolve();
                img.decoding = "async";
                img.src = url;
                // Предохранитель: зависший запрос не вешает сплэш.
                setTimeout(resolve, timeoutMs);
              }),
          ),
        ),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs + 500)),
      ]);
      onBatchDone();
    }
  }

  async function run(): Promise<void> {
    const catalogStore = useCatalogStore();

    // 1. Каталог: категории + товары + баннеры (кэш даёт мгновенный старт).
    try {
      await catalogStore.initialize();
    } catch {
      // Оффлайн/сбой: App.vue покажет заглушку, сплэш скрываем.
      visible.value = false;
      return;
    }
    advance(30, "Загружаем каталог...");

    // Параллельно: лояльность + избранное (не блокируют друг друга).
    const loyaltyStore = useLoyaltyStore();
    const favoritesStore = useFavoritesStore();

    const auxiliary = Promise.race([
      Promise.allSettled([
        loyaltyStore.fetchSnapshot().catch((e) => console.warn("[preload] loyalty failed:", e)),
        favoritesStore.fetchFavorites().catch((e) => console.warn("[preload] favorites failed:", e)),
      ]),
      // Предохранитель: сеть молчит — не держим сплэш дольше 3.5с.
      new Promise<unknown[]>((resolve) => setTimeout(resolve, 3500)),
    ]).then(() => {
      advance(30, "Проверяем бонусы и избранное...");
    });

    // 2. Обложки категорий и линеек всех вкладок.
    const imageUrls: string[] = [];
    for (const category of catalogStore.categories) {
      if (category.coverImage) imageUrls.push(category.coverImage);
      for (const group of category.groups ?? []) {
        if (group.coverImage) imageUrls.push(group.coverImage);
      }
    }

    const IMAGES_WEIGHT = 40;
    const batches = Math.max(1, Math.ceil(imageUrls.length / 24));
    let doneBatches = 0;
    label.value = "Подогреваем картинки...";

    await Promise.all([
      preloadImages(imageUrls, () => {
        doneBatches += 1;
        progress.value = Math.min(TOTAL_WEIGHT, 30 + Math.round((doneBatches / batches) * IMAGES_WEIGHT));
      }),
      auxiliary,
    ]);

    progress.value = TOTAL_WEIGHT;
    // Короткая пауза, чтобы прогресс-бар красиво доехал до 100%.
    await new Promise((resolve) => setTimeout(resolve, 220));
    visible.value = false;
  }

  return {
    visible,
    progress,
    label,
    run,
  };
}
