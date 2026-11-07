/**
 * Полёт миниатюры товара к иконке корзины — по образцу демо-сценария.
 *
 * Один переиспользуемый механизм для всех карточек и категорий:
 * координаты старта и цели снимаются с фактических DOM-позиций кнопки
 * и иконки корзины в момент нажатия, движение — только через
 * transform/opacity. Дуга получается двумя вложенными элементами:
 * внешний двигается по X, внутренний — по Y со сжатием (как в демо
 * .fly / .fly:after), поэтому оси не перезаписывают друг друга.
 * Белые поля обложек (JPG-подобные webp без прозрачности) обрезаются
 * на canvas перед стартом — летит сам товар, без «белой рамки».
 * Элементы удаляются после завершения, prefers-reduced-motion
 * отключает полёт целиком.
 */

/** Максимум одновременно летящих миниатюр: визуальный шум не растёт,
 *  а товары не теряются — добавление в корзину уже произошло. */
const MAX_CONCURRENT_FLIGHTS = 6;

const flights = new Set<Animation>();

/** Точка с центром прямоугольника. */
type Point = { x: number; y: number };

function centerOf(rect: DOMRect): Point {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** CSS-размер летящей миниатюры. Крупная — читается весь полёт,
 *  у корзины сжимается. */
const FLY_WIDTH = 88;
const FLY_HEIGHT = 128;

/** Полёт читается как «товар полетел в корзину», а не мелькание:
 *  0.9 с против 0.6 с в демо. */
const FLIGHT_DURATION_MS = 900;

export interface FlyToCartOptions {
  /** Элемент нажатой кнопки «+» (источник координат). */
  from: HTMLElement;
  /** Элемент-цель: иконка корзины (обычно сама кнопка-плашка). */
  to: HTMLElement;
  /** URL уже загруженной миниатюры товара; null — нейтральная иконка. */
  image: string | null | undefined;
}

/**
 * Запускает полёт миниатюры от кнопки к корзине.
 * Возвращает true, если полёт реально запущен (для отклика плашки).
 */
export function flyToCart(options: FlyToCartOptions): boolean {
  if (typeof document === "undefined") return false;
  if (prefersReducedMotion()) return false;

  const { from, to } = options;
  if (!from || !to) return false;

  const fromRect = from.getBoundingClientRect();
  const toRect = to.getBoundingClientRect();

  // Переполнение лимита: тихо пропускаем лишние полёты — корзина уже
  // пополнена, визуальную очередь не копим.
  if (flights.size >= MAX_CONCURRENT_FLIGHTS) return false;

  const start = centerOf(fromRect);
  const target = centerOf(toRect);

  // Внешний контейнер — движение по X и прозрачность.
  const flight = document.createElement("div");
  flight.setAttribute("aria-hidden", "true");
  flight.className = "navalivay-cart-flight";

  // Внутренний — движение по Y и масштаб: оси живут на разных
  // элементах и не перезаписывают transform друг друга (иначе
  // вторая анимация затирает первую, и миниатюра летит только
  // вертикально мимо корзины).
  const inner = document.createElement("div");
  inner.className = "navalivay-cart-flight__inner";
  if (options.image) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    // Миниатюра уже в кэше браузера: оригинал не качаем, текущую
    // картинку кэша считаем достаточной. Обложки без прозрачности
    // (белый фон в самом файле) обрезаем до границ товара.
    const trimmed = trimWhiteBorders(options.image);
    img.src = trimmed ?? options.image;
    inner.appendChild(img);
  } else {
    inner.classList.add("navalivay-cart-flight__inner--placeholder");
    inner.appendChild(buildPlaceholderIcon());
  }
  flight.appendChild(inner);

  positionFlight(flight, start);
  document.body.appendChild(flight);

  const dx = target.x - start.x;
  const dy = target.y - start.y;

  // Дуга: X и Y идут с разными easing — вертикальная ось мягче
  // (cubic-bezier(.15,.4,.4,1)), горизонталь линейнее на разгоне
  // (.55,0,.75,1), как в демо pack-x / pack-y.
  const animX = flight.animate(
    [
      { transform: "translateX(0)", opacity: "0" },
      { opacity: "1", offset: 0.08 },
      { opacity: "1", offset: 0.88 },
      { transform: `translateX(${dx}px)`, opacity: "0" },
    ],
    {
      duration: FLIGHT_DURATION_MS,
      easing: "cubic-bezier(.55,0,.75,1)",
      fill: "both",
    },
  );
  const animY = inner.animate(
    [
      { transform: "translateY(0) scale(1)" },
      { transform: `translateY(${dy}px) scale(0.16)` },
    ],
    {
      duration: FLIGHT_DURATION_MS,
      easing: "cubic-bezier(.15,.4,.4,1)",
      fill: "both",
    },
  );

  flights.add(animX);

  const cleanup = () => {
    flights.delete(animX);
    flight.remove();
  };
  animX.finished.then(cleanup).catch(cleanup);
  // Страховка: даже если finished не зарезолвился (фоновая вкладка,
  // отмена), элемент не остаётся в DOM навсегда.
  setTimeout(cleanup, FLIGHT_DURATION_MS + 400);

  return true;
}

function positionFlight(flight: HTMLElement, at: Point) {
  flight.style.left = `${at.x - FLY_WIDTH / 2}px`;
  flight.style.top = `${at.y - FLY_HEIGHT / 2}px`;
}

/**
 * Обрезает белые (или почти белые) поля картинки: обложки линеек
 * часто лежат в базе как webp/JPG без прозрачности — товар на белом
 * фоне. Синхронно декодирует уже закэшированное изображение, находит
 * границы содержимого и возвращает data:URL с прозрачными краями.
 * null — обрезать нечего или картинку не удалось прочитать (тогда
 * летит как есть). Работает только для same-origin/data: URL —
 * внешние ссылки оставляем без обработки.
 */
function trimWhiteBorders(src: string): string | null {
  try {
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return null;
    }
    const url = new URL(src, document.baseURI);
    // Внешние домены: canvas «испачкается» и toDataURL бросит
    // исключение — не трогаем.
    if (url.origin !== window.location.origin && url.protocol !== "data:") {
      return null;
    }

    const img = new Image();
    img.src = src;
    // Декодирование из кэша same-origin/data синхронно в практике
    // WebView уже завершено к моменту клика (картинка отрисована
    // в карточке). complete+naturalWidth — быстрая проверка.
    if (!img.complete || !img.naturalWidth) return null;

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    // Порог «почти белого»: R,G,B ≥ 242 и непрозрачный.
    const isPaper = (i: number) => {
      const a = data[i + 3];
      if (a < 8) return true; // прозрачный — тоже «пустой»
      return data[i] >= 242 && data[i + 1] >= 242 && data[i + 2] >= 242;
    };

    let top = 0;
    let bottom = h - 1;
    let left = 0;
    let right = w - 1;
    const rowBlank = (y: number) => {
      for (let x = 0; x < w; x++) if (!isPaper((y * w + x) * 4)) return false;
      return true;
    };
    const colBlank = (x: number) => {
      for (let y = top; y <= bottom; y++)
        if (!isPaper((y * w + x) * 4)) return false;
      return true;
    };
    while (top < bottom && rowBlank(top)) top++;
    while (bottom > top && rowBlank(bottom)) bottom--;
    while (left < right && colBlank(left)) left++;
    while (right > left && colBlank(right)) right--;

    // Обрезка ничего не дала (поля < 2%) или картинка пустая.
    if (top >= bottom || left >= right) return null;
    const margin = Math.round(Math.min(w, h) * 0.02);
    top = Math.max(0, top - margin);
    bottom = Math.min(h - 1, bottom + margin);
    left = Math.max(0, left - margin);
    right = Math.min(w - 1, right + margin);
    const cw = right - left + 1;
    const chh = bottom - top + 1;
    if (cw >= w * 0.98 && chh >= h * 0.98) return null;

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = chh;
    const outCtx = out.getContext("2d");
    if (!outCtx) return null;
    outCtx.drawImage(canvas, left, top, cw, chh, 0, 0, cw, chh);
    return out.toDataURL("image/png");
  } catch {
    // tainted canvas / недекодированное изображение — летит как есть.
    return null;
  }
}

function buildPlaceholderIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  const box = document.createElementNS(ns, "rect");
  box.setAttribute("x", "4");
  box.setAttribute("y", "3");
  box.setAttribute("width", "16");
  box.setAttribute("height", "18");
  box.setAttribute("rx", "3");
  svg.appendChild(box);
  const mid = document.createElementNS(ns, "path");
  mid.setAttribute("d", "M4 12h16");
  svg.appendChild(mid);
  return svg;
}
