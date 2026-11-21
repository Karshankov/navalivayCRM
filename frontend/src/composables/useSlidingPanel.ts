/**
 * Механика выезжающей панели: перетаскивание за полоску и шапку,
 * два устойчивых положения, закрытие с уездом вниз, фокус-ловушка.
 *
 * Вынесено из ReviewsFeedPanel: панель со списком отзывов и панель
 * формы оценки ведут себя одинаково, и держать две копии этой логики
 * смысла нет.
 */
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

/** Два устойчивых положения панели: малое и полное. */
const SMALL_RATIO = 0.64;
const LARGE_RATIO = 0.94;
/** Ниже этой доли экрана панель закрывается сама. */
const CLOSE_RATIO = 0.43;

interface DragState {
  startY: number;
  startHeight: number;
  lastY: number;
  lastTime: number;
  velocity: number;
}

export function useSlidingPanel(options: {
  onClose: () => void;
  smallRatio?: number;
  /** Содержимое, под которое подгоняется малая высота. Так форма
   *  открывается целиком — кнопку не нужно искать прокруткой. */
  autoFitSelector?: string;
}) {
  const shellRef = ref<HTMLElement | null>(null);
  const panelRef = ref<HTMLElement | null>(null);
  const scrollRef = ref<HTMLElement | null>(null);

  const expanded = ref(false);
  const dragging = ref(false);
  const closing = ref(false);
  const dragHeight = ref<number | null>(null);
  const viewportHeight = ref(typeof window === "undefined" ? 800 : window.innerHeight);
  /** Высота, подобранная под содержимое: держим её, пока панель в
   *  малом положении, чтобы содержимое не пересчитывалось зря. */
  const fittedHeight = ref<number | null>(null);

  const smallRatio = options.smallRatio ?? SMALL_RATIO;
  const largeHeight = () => Math.round(viewportHeight.value * LARGE_RATIO);

  /**
   * Малая высота. Если задан autoFitSelector, считаем её по высоте
   * содержимого (форма, шапка, полоска и отступы скролла) — так
   * кнопка отправки видна сразу, без прокрутки. Иначе — доля экрана.
   */
  const smallHeight = () => {
    const base = Math.round(viewportHeight.value * smallRatio);
    const selector = options.autoFitSelector;
    const panel = panelRef.value;
    if (!selector || !panel) return base;

    const content = panel.querySelector<HTMLElement>(selector);
    const head = panel.querySelector<HTMLElement>(".rs-head");
    const grip = panel.querySelector<HTMLElement>(".rs-grip");
    const scroller = panel.querySelector<HTMLElement>(".rs-scroll");
    if (!content) return base;

    const scrollerStyle = scroller ? getComputedStyle(scroller) : null;
    const paddingTop = parseFloat(scrollerStyle?.paddingTop || "0");
    const paddingBottom = parseFloat(scrollerStyle?.paddingBottom || "0");
    const needed = Math.ceil(
      content.getBoundingClientRect().height
      + (head?.getBoundingClientRect().height || 0)
      + (grip?.getBoundingClientRect().height || 0)
      + paddingTop
      + paddingBottom
      // Небольшой запас, чтобы скруглённый край не срезал кнопку.
      + 8,
    );

    return Math.min(largeHeight(), Math.max(base, needed));
  };

  const panelStyle = computed(() => {
    if (dragHeight.value !== null) return { height: `${dragHeight.value}px` };
    if (!expanded.value && fittedHeight.value !== null) {
      return { height: `${fittedHeight.value}px` };
    }
    return undefined;
  });

  let drag: DragState | null = null;
  let listTouch: { y: number; atTop: boolean } | null = null;

  function beginDrag(clientY: number) {
    // Высоту берём из состояния панели, а не из DOM: getBoundingClientRect
    // может вернуть 0 (скрытая панель, первый кадр, тестовая среда).
    const height = panelRef.value?.getBoundingClientRect().height;
    const startHeight =
      height && height > 0 ? height : expanded.value ? largeHeight() : smallHeight();
    drag = {
      startY: clientY,
      startHeight,
      lastY: clientY,
      lastTime: performance.now(),
      velocity: 0,
    };
    dragging.value = true;
  }

  function moveDrag(clientY: number) {
    if (!drag) return;
    const now = performance.now();
    const dt = now - drag.lastTime;
    if (dt > 0) {
      drag.velocity = (clientY - drag.lastY) / dt;
      drag.lastTime = now;
      drag.lastY = clientY;
    }
    const next = drag.startHeight - (clientY - drag.startY);
    dragHeight.value = Math.max(120, Math.min(largeHeight(), next));
  }

  function endDrag(clientY: number, cancel = false) {
    if (!drag) return;
    const state = drag;
    // Высоту запоминаем ДО сброса: после него dragHeight уже null.
    const height = dragHeight.value ?? state.startHeight;
    drag = null;
    dragging.value = false;
    dragHeight.value = null;

    // Отмена жеста: панель возвращается к прежнему положению.
    if (cancel) return;

    const dy = clientY - state.startY;
    const velocity = performance.now() - state.lastTime < 100 ? state.velocity : 0;

    if (height < viewportHeight.value * CLOSE_RATIO) {
      requestClose();
      return;
    }
    if (dy < -30 && velocity < -0.4) {
      expanded.value = true;
      return;
    }
    if (dy > 30 && velocity > 0.4) {
      expanded.value = false;
      return;
    }
    expanded.value = height > (smallHeight() + largeHeight()) / 2;
  }

  function onDragStart(event: PointerEvent) {
    if ((event.target as HTMLElement).closest("button, a, select")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    beginDrag(event.clientY);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onDragMove(event: PointerEvent) {
    if (drag) moveDrag(event.clientY);
  }

  function onDragEnd(event: PointerEvent) {
    if (drag) endDrag(event.clientY);
  }

  function onDragCancel(event: PointerEvent) {
    if (drag) endDrag(event.clientY, true);
  }

  /* Жест по списку: вверх разворачивает панель, вниз на самом верху —
     закрывает. Иначе список прокручивается как обычно. */
  function onListTouchStart(event: TouchEvent) {
    const scroller = scrollRef.value;
    if (!scroller || event.touches.length !== 1) {
      listTouch = null;
      return;
    }
    if ((event.target as HTMLElement).closest("button, a, select, input, textarea, label")) {
      listTouch = null;
      return;
    }
    listTouch = { y: event.touches[0].clientY, atTop: scroller.scrollTop <= 0 };
  }

  function onListTouchMove(event: TouchEvent) {
    if (!listTouch || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const dy = y - listTouch.y;
    if (!drag && Math.abs(dy) > 5 && ((!expanded.value && dy < 0) || (listTouch.atTop && dy > 0))) {
      beginDrag(listTouch.y);
    }
    if (drag) {
      event.preventDefault();
      moveDrag(y);
    }
  }

  function onListTouchEnd(event: TouchEvent) {
    if (drag) endDrag(event.changedTouches[0].clientY);
    listTouch = null;
  }

  /* Закрытие: панель уезжает вниз, и только потом сообщаем наружу —
     иначе она исчезала бы мгновенно, без анимации. */
  let closeTimer: ReturnType<typeof setTimeout> | 0 = 0;

  function requestClose() {
    if (closing.value) return;
    closing.value = true;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closing.value = false;
      expanded.value = false;
      fittedHeight.value = null;
      options.onClose();
    }, 380);
  }

  /** Фокус-ловушка: панель модальная, фокус не должен уходить за неё. */
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.value;
    if (!panel) return;
    const focusable = [
      ...panel.querySelectorAll<HTMLElement>("a[href], button, select, input, textarea"),
    ].filter((node) => !node.hidden && node.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function syncViewport() {
    viewportHeight.value = window.innerHeight;
  }

  /** Подготовка к показу: сброс положения, высота по содержимому, фокус. */
  async function resetForOpen() {
    expanded.value = false;
    closing.value = false;
    dragHeight.value = null;
    await nextTick();
    // Замер содержимого возможен только после отрисовки панели.
    if (options.autoFitSelector && panelRef.value) {
      dragHeight.value = smallHeight();
      await nextTick();
      dragHeight.value = null;
      fittedHeight.value = smallHeight();
    }
    panelRef.value?.focus({ preventScroll: true });
  }

  if (typeof window !== "undefined") {
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
  }

  onBeforeUnmount(() => {
    if (closeTimer) clearTimeout(closeTimer);
    window.removeEventListener("resize", syncViewport);
    window.removeEventListener("orientationchange", syncViewport);
  });

  return {
    shellRef,
    panelRef,
    scrollRef,
    expanded,
    dragging,
    closing,
    panelStyle,
    requestClose,
    handleKeydown,
    resetForOpen,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    onListTouchStart,
    onListTouchMove,
    onListTouchEnd,
  };
}
