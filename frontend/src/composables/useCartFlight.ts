import { computed, ref, shallowRef, watch, type WatchStopHandle } from "vue";
import type { Product } from "@/stores/catalog";
import { useCatalogStore } from "@/stores/catalog";
import { useCartStore, type CartItem } from "@/stores/cart";
import { flyToCart, prefersReducedMotion } from "@/utils/flyToCart";

/**
 * Связка корзины с полётом миниатюры (демо-сценарий «Наваливай»):
 *
 * - addItem летит от нажатой кнопки «+» к иконке корзины;
 * - первая покупка раскрывает красную плашку суммы у корзины;
 * - повторные прилёты дают мягкий отклик масштабом 1 → 1.03 → 1;
 * - сумма всегда берётся из настоящего состояния корзины;
 * - полёт не блокирует и не откладывает само добавление;
 * - prefers-reduced-motion — без полёта.
 *
 * Один модуль-синглтон на приложение: top-bar и карточки видят
 * общие expanded / arrivalTick. Стор хранится в shallowRef и
 * пересоздаётся при смене активного pinia (юнит-тесты), computeds
 * строятся от storeRef.value — смена стора перевычисляет их сама.
 */

/** Плашка раскрыта (данные): корзина непуста. */
const expanded = ref(false);
/** Плашка раскрыта (визуально): CSS-анимация раскрытия уже идёт.
 *  Отстаёт от expanded на время полёта, чтобы красный овал
 *  «встречал» прилетающую миниатюру, а не появлялся заранее. */
const expandedVisual = ref(false);
/** Номер «прилёта»: монотонный счётчик для отклика плашки. */
const arrivalTick = ref(0);
/** Иконка корзины, к которой летят миниатюры. */
let cartIconEl: HTMLElement | null = null;
/** Отложенный запуск раскрытия: сбрасывается, если корзина опустела. */
let expandTimer: ReturnType<typeof setTimeout> | null = null;
/** Идёт добавление с полётом: watch не должен раскрывать визуал
 *  раньше прилёта — тайминг ведёт addItemWithFlight. */
let addingWithFlight = false;

/** Длительность полёта (мс) — синхронизирована с utils/flyToCart. */
const FLIGHT_DURATION_MS = 900;
/** Раскрытие стартует на этом моменте полёта: миниатюра почти
 *  долетела, красный овал «принимает» её. */
const EXPAND_AT_RATIO = 0.58;

/** Текущий стор корзины; меняется при пересоздании pinia. */
const storeRef = shallowRef<ReturnType<typeof useCartStore> | null>(null);
let storeWatchStop: WatchStopHandle | null = null;

/** Ленивая инициализация: стор + следилка за опустением корзины.
 *  Смена активного pinia подменяет стор; подписка перевешивается,
 *  старый watch останавливается (без утечки). */
function ensureStore(): ReturnType<typeof useCartStore> | null {
  try {
    const current = useCartStore();
    if (current !== storeRef.value) {
      storeWatchStop?.();
      storeWatchStop = null;
      storeRef.value = current;
    }
  } catch {
    // Нет активного pinia — остаёмся с последним известным стором.
    return storeRef.value;
  }

  if (storeRef.value && !storeWatchStop) {
    storeWatchStop = watch(
      () => storeRef.value!.totalItems,
      (count) => {
        // Пустая корзина возвращает обычную иконку: схлопываем и
        // данные, и визуал, отменяя отложенное раскрытие.
        if (count === 0) {
          expanded.value = false;
          expandedVisual.value = false;
          if (expandTimer) {
            clearTimeout(expandTimer);
            expandTimer = null;
          }
          return;
        }
        // Непустая корзина держит данные раскрытыми. Визуал:
        // во время добавления с полётом таймингом владеет
        // addItemWithFlight (раскрытие под прилёт); иначе — корзина
        // пришла не из клика (загрузка страницы из localStorage,
        // дозагрузка каталога) и раскрываем сразу.
        expanded.value = true;
        if (!addingWithFlight && !expandedVisual.value && !expandTimer) {
          expandedVisual.value = true;
        }
      },
      { flush: "sync", immediate: true },
    );
  }
  return storeRef.value;
}

/**
 * Восстановление после возврата на экран: корзина непуста (например,
 * из localStorage или после смены экрана), а визуально плашка ещё
 * не раскрыта и полёта нет — раскрываем без ожидания.
 * Вызывается TopCartBar при монтировании.
 */
function syncExpandedVisualOnMount(): void {
  // Первая инициализация при загрузке страницы: стор + watch
  // (immediate) сами выставят expanded/expandedVisual по непустой
  // корзине, дозагруженной из localStorage.
  ensureStore();
  if (!expanded.value || expandedVisual.value || expandTimer) return;
  if (document.querySelector(".navalivay-cart-flight")) return;
  expandedVisual.value = true;
}

const totalItems = computed(() => {
  ensureStore();
  return storeRef.value?.totalItems ?? 0;
});
const totalAmount = computed(() => {
  ensureStore();
  return storeRef.value?.totalAmount ?? 0;
});

/** Кнопка-корзина регистрируется TopCartBar при монтировании. */
function registerCartFlyTarget(el: HTMLElement | null) {
  cartIconEl = el;
}

/** Находит летящую цель в DOM, даже если референс устарел. */
function resolveCartTarget(): HTMLElement | null {
  if (cartIconEl && cartIconEl.isConnected) return cartIconEl;
  return document.querySelector<HTMLElement>("[data-navalivay-cart-bar]");
}

/**
 * Добавляет товар в корзину и запускает полёт от нажатой кнопки.
 * Добавление выполняется всегда и немедленно — полёт чисто
 * визуальный и не влияет на данные и запросы.
 */
function addItemWithFlight(
  product: Product,
  quantity = 1,
  variantId?: string | null,
  sourceButton?: HTMLElement | null,
  flyImage?: string | null,
): void {
  // Фиксируем пустоту ДО добавления: ensureStore создаёт watch с
  // immediate:true, который выставит expanded при непустой корзине —
  // после добавления было бы уже поздно узнавать, была ли она пуста.
  const wasEmpty = totalItems.value === 0;

  const cart = ensureStore();
  if (!cart) return;
  // Флаг на время синхронного addItem: watch по totalItems увидит
  // его и не раскроет визуал раньше прилёта миниатюры.
  addingWithFlight = true;
  try {
    cart.addItem(product, quantity, variantId);
  } finally {
    addingWithFlight = false;
  }

  // Данные: корзина непуста, сумма уже реактивная.
  expanded.value = true;

  const target = resolveCartTarget();
  const image =
    sourceButton && target
      ? flyImage ?? resolveProductThumb(product, variantId)
      : null;
  const started = sourceButton && target
    ? flyToCart({ from: sourceButton, to: target, image })
    : false;

  if (prefersReducedMotion() || !started) {
    // Полёта нет — раскрываем сразу (данные уже готовы).
    expandedVisual.value = true;
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
    if (started || prefersReducedMotion()) {
      arrivalTick.value++;
    }
    return;
  }

  if (wasEmpty) {
    // Хореография «товар прилетает → корзина встречает»: раскрытие
    // стартует на ~58% полёта, миниатюра в этот момент почти у цели.
    if (expandTimer) clearTimeout(expandTimer);
    expandTimer = setTimeout(() => {
      expandTimer = null;
      expandedVisual.value = true;
    }, Math.round(FLIGHT_DURATION_MS * EXPAND_AT_RATIO));
  } else {
    // Плашка уже раскрыта — мгновенно подтверждаем состояние.
    expandedVisual.value = true;
  }

  // Отсчёт прилёта: под конец полёта плашка получает мягкий отклик
  // масштабом.
  const delay = Math.round(FLIGHT_DURATION_MS * 0.94);
  window.setTimeout(() => {
    arrivalTick.value++;
  }, delay);
}

/** Миниатюра именно добавленного товара: вариант → товар → обложка
 *  его линейки. Обложку категории не берём: у вкусовых строк своих
 *  фото нет, и полёт «картинкой категории» выглядит чужим. */
function resolveProductThumb(
  product: Product,
  variantId?: string | null,
): string | null {
  if (variantId) {
    const variant = product.variants?.find((v) => v.id === variantId);
    const variantImage = variant?.images?.find(
      (src) => typeof src === "string" && src.trim().length > 0,
    );
    if (variantImage) return variantImage;
  }
  const own = product.images?.find(
    (src) => typeof src === "string" && src.trim().length > 0,
  );
  if (own) return own;
  if (product.links?.length) {
    const linkImage = product.links.find((link) =>
      /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(link.url || ""),
    );
    if (linkImage?.url) return linkImage.url;
    const first = product.links[0]?.url;
    if (first) return first;
  }
  // Товар без фото: обложка его линейки (не категории).
  if (product.groupId) {
    const groupImage = useCatalogStore().getGroupImage(product.groupId);
    if (groupImage) return groupImage;
  }
  // Итоговая строка корзины: берём только если это не обложка
  // категории (стартовый каталог может подставить её в fallback).
  const cartLine = ensureStore()?.items.find(
    (item: CartItem) =>
      item.productId === product.id &&
      (!variantId || item.variantId === variantId),
  );
  const lineImage = cartLine?.image ?? null;
  if (!lineImage) return null;
  if (product.categoryId) {
    const categoryImage = useCatalogStore().getCategoryImage(product.categoryId);
    if (categoryImage && categoryImage === lineImage) return null;
  }
  return lineImage;
}

/** Отклик плашки на прилёт при инкременте уже лежащего товара. */
function notifyArrivalFrom(
  sourceButton: HTMLElement | null,
  product: Product,
  variantId?: string | null,
  flyImage?: string | null,
): void {
  // Корзина уже пополнена через updateQuantity и непуста — плашка
  // раскрыта (данные и визуал), раскрытия ждать не надо.
  const cart = ensureStore();
  if (cart && cart.totalItems > 0) {
    expanded.value = true;
    expandedVisual.value = true;
  }

  const target = resolveCartTarget();
  if (!sourceButton || !target) return;
  const started = flyToCart({
    from: sourceButton,
    to: target,
    image: flyImage ?? resolveProductThumb(product, variantId),
  });
  if (started || prefersReducedMotion()) {
    const delay = Math.round(FLIGHT_DURATION_MS * 0.94);
    window.setTimeout(() => {
      arrivalTick.value++;
    }, delay);
  }
}

/**
 * Из события клика достаём кнопку-источник для старта полёта.
 * null-safe: полёт просто не запустится без конкретной кнопки.
 */
export function eventSource(event?: MouseEvent | Event): HTMLElement | null {
  const target = event?.currentTarget;
  return target instanceof HTMLElement ? target : null;
}

export function useCartFlight() {
  return {
    expanded,
    /** Визуальное раскрытие (с задержкой до прилёта миниатюры) —
     *  его использует TopCartBar для CSS-анимации. */
    expandedVisual,
    arrivalTick,
    totalItems,
    totalAmount,
    registerCartFlyTarget,
    syncExpandedVisualOnMount,
    addItemWithFlight,
    notifyArrivalFrom,
    eventSource,
  };
}
