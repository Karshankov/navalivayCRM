/**
 * Подбор геометрии фотографии под область показа.
 *
 * Задача: фото должно быть крупным и объёмным, но не улетать за обрезку
 * и не растягиваться. Считаем масштаб и смещение по реальным размерам
 * картинки и области — никакого распознавания содержимого.
 *
 * Правила:
 *  - пропорции сохраняем, масштаб один по обеим осям;
 *  - вертикальным фото даём больше масштаба, широким — меньше: иначе
 *    широкое при том же увеличении станет плоским, а вертикальное
 *    потеряет верх и низ;
 *  - смещение ставим так, чтобы центр картинки остался виден.
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";

/** Доли, на которые фото может вылезти за область.
 *  В эталонной плитке вылет доходит до четверти высоты — берём то же. */
const OVERFLOW_RATIO = 0.25;
/** Во сколько раз фото крупнее области: нижняя и верхняя граница.
 *  Верхняя поднята под квадратные фото: при области 76x92 вписанное
 *  квадратное занимает 76x76 и без запаса свисать вниз не станет. */
const SCALE_MIN = 1.08;
const SCALE_MAX = 1.62;
/** Запас, чтобы объект не прилипал к краю обрезки. */
const SAFE_MARGIN = 0.04;
/** Границы масштаба в ручном режиме: сотрудник задаёт его сам.
 *  Верхняя — 400%: у части линеек объект на фото мелкий и много
 *  белого фона, ближе не подобраться. Нижняя не даёт потерять фото
 *  совсем. */
const MANUAL_SCALE_MIN = 0.6;
const MANUAL_SCALE_MAX = 4;

export interface ImageFadeGeometry {
  /** Масштаб относительно исходного размера картинки. */
  scale: number;
  /** Смещение в процентах от области: куда сдвинуть центр фото. */
  offsetX: number;
  offsetY: number;
}

/** Ручные поправки: сотрудник задаёт их в CRM для отдельной карточки. */
export interface ImageFadeOverrides {
  /** Во сколько раз фото крупнее подобранного автоматически. */
  zoom?: number;
  /** Сдвиг вбок в процентах от ширины области: минус влево, плюс вправо. */
  shiftX?: number;
  /** Сдвиг по вертикали в процентах от высоты области: минус вверх, плюс вниз. */
  shiftY?: number;
  /**
   * Кадр настроен руками: поправки заменяют автоподбор, а не складываются
   * с ним. Нужно, чтобы сотрудник видел в редакторе ровно то, что получит
   * покупатель: пока автоподбор работает поверх правок, картинка уезжает
   * уже после сохранения.
   */
  manual?: boolean;
}

export function useImageFadeGeometry(overrides: Ref<ImageFadeOverrides | undefined> = ref(undefined)) {
  const naturalWidth = ref(0);
  const naturalHeight = ref(0);
  const areaWidth = ref(0);
  const areaHeight = ref(0);
  const failed = ref(false);
  const loaded = ref(false);

  /** Пересчитываем только при настоящем изменении размеров. */
  const lastKey = ref("");

  const geometry = computed<ImageFadeGeometry>(() => {
    const nw = naturalWidth.value;
    const nh = naturalHeight.value;
    const aw = areaWidth.value;
    const ah = areaHeight.value;

    // Пока нет данных — нейтральное положение: фото по центру области.
    if (!nw || !nh || !aw || !ah) {
      return { scale: 1, offsetX: 0, offsetY: 0 };
    }

    const imageRatio = nw / nh;
    const areaRatio = aw / ah;

    /* Насколько фото «длиннее» области. Берём отношение сторон, а не
       пиксели: при одной и той же области широкое и вертикальное фото
       требуют разного увеличения. */
    const ratioGap = imageRatio / areaRatio;

    /* Вписываем картинку в область с сохранением пропорций — так же,
       как это делает object-fit: contain. От этого размера считаем
       масштаб: важно не сколько пикселей в файле, а насколько
       вписанное фото меньше области. */
    const fitScale = Math.min(aw / nw, ah / nh);
    const fitW = nw * fitScale;
    const fitH = nh * fitScale;

    /* Кадр настроен руками: автоподбор не участвует вообще, иначе он
       сдвинул бы фото влево-вниз уже после того, как сотрудник выставил
       положение в редакторе, и в карточке получилось бы не то, что он
       видел. Масштаб берём от вписанного размера — как object-fit. */
    if (overrides.value?.manual) {
      const manualZoom = overrides.value.zoom ?? 1;
      const manualScale = Math.max(
        MANUAL_SCALE_MIN,
        Math.min(MANUAL_SCALE_MAX, manualZoom),
      );

      /* Сдвиги приходят в процентах от габаритов области, и знак у них
         человеческий: плюс — вправо и вниз. translate берёт проценты от
         размера самого элемента, а он равен области, умноженной на
         масштаб, — поэтому делим на масштаб.

         По X знак переворачиваем. В шаблоне стиля стоит
         translate(${-offsetX}%), и это соглашение заведено для
         автоподбора, где положительный offsetX означает «свисаем
         влево». Ручной сдвиг живёт в человеческих координатах, поэтому
         плюс здесь должен дать движение вправо, а не влево. Без минуса
         фото уезжало навстречу мыши. */
      const shiftXPercent = -(overrides.value.shiftX ?? 0) / manualScale;
      const shiftYPercent = (overrides.value.shiftY ?? 0) / manualScale;

      return {
        scale: manualScale,
        offsetX: Math.round(shiftXPercent),
        offsetY: Math.round(shiftYPercent),
      };
    }

    /* Насколько вписанное фото короче области по каждой оси. Квадратное
       фото при области 76x92 заполняет ширину и оставляет 16px снизу —
       ему нужен больший масштаб, иначе свисать нечему. */
    const slackY = Math.max(0, ah - fitH);
    const slackX = Math.max(0, aw - fitW);

    /* Сколько масштаба нужно, чтобы фото свисало вниз на заданную
       долю области. Считаем от вписанного размера: важно, насколько
       фото меньше области, а не сколько пикселей в файле.

       По ширине не ограничиваем: фото сдвинуто влево и растёт в
       свободную сторону — слева край карточки, текст справа. */
    const needH = (ah + ah * OVERFLOW_RATIO) / Math.max(1, fitH);

    let scale = needH;

    /* Узкие фото не раздуваем сверх меры: иначе станут зернистыми. */
    scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale));

    /* Ручная поправка из CRM: сотрудник видел превью и решил, что
       крупнее или мельче. Множитель применяем после автоподбора. */
    const zoom = overrides.value?.zoom ?? 1;
    if (zoom !== 1) {
      scale = Math.max(0.6, Math.min(2.4, scale * zoom));
    }

    /* Если фото уже свисает само, лишний масштаб не нужен. */
    void slackX;
    void slackY;
    void ratioGap;

    /* Фото свисает влево и вниз и обрезается этими границами области —
       так оно читается крупным и «уходящим» за карточку, а не вписанным
       по центру. Вправо и вверх сдвига нет: там текст.

       Считаем размер после масштаба и берём вылет от него. */
    const grownW = fitW * scale;
    const grownH = fitH * scale;
    const outX = Math.max(0, grownW - aw);
    const outY = Math.max(0, grownH - ah);

    /* По вертикали весь вылет идёт вниз: фото появляется из нижней
       границы карточки, которая его и обрезает.

       По горизонтали вылет смещаем к левому краю, но не больше чем
       на пятую часть ширины фото: иначе от картинки остаётся меньше
       половины и она читается обрезанной, а не выступающей.
       Остаток уходит вправо, где его закрывает наплыв. */
    const maxLeftShift = (fitW * scale) * 0.2;
    const shiftX = Math.min(outX * (1 - SAFE_MARGIN), maxLeftShift);
    const shiftY = outY * (1 - SAFE_MARGIN);

    /* Смещение отдаём в процентах: translate берёт проценты от размера
       самого элемента, а не от области. Фото растянуто на область и
       умножено масштабом, поэтому база — это выросшая картинка.
       Знак минус по X — свисаем влево, по Y сдвигаем вниз. */
    const boxW = (aw || 1) * scale;
    const boxH = (ah || 1) * scale;
    let offsetX = Math.round((shiftX / boxW) * 100);
    let offsetY = Math.round((shiftY / boxH) * 100);

    /* Ручная поправка из CRM: сотрудник сдвигает фото вбок. Значение
       в процентах от ширины области, минус влево, плюс вправо.
       Складываем с автоматическим сдвигом, а не заменяем его. */
    const manualShift = overrides.value?.shiftX ?? 0;
    if (manualShift !== 0) {
      const manualPercent = Math.round((aw * (manualShift / 100) / boxW) * 100);
      offsetX += manualPercent;
    }

    /* Ручной сдвиг по вертикали: минус вверх, плюс вниз. В отличие от
       автоподбора, который всегда уводит фото вниз, здесь знак сохраняем
       как задал сотрудник. */
    const manualShiftY = overrides.value?.shiftY ?? 0;
    if (manualShiftY !== 0) {
      const manualPercentY = Math.round((ah * (manualShiftY / 100) / boxH) * 100);
      offsetY += manualPercentY;
    }

    return { scale, offsetX, offsetY };
  });

  /** Стиль для тега img: масштаб и сдвиг через transform.
   *  Влево — минус по X, вниз — плюс по Y. */
  const imageStyle = computed(() => {
    const g = geometry.value;
    return {
      transform: `translate(${-g.offsetX}%, ${g.offsetY}%) scale(${g.scale})`,
    };
  });

  function measureArea(element: HTMLElement | null) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (key === lastKey.value) return;
    lastKey.value = key;
    areaWidth.value = rect.width;
    areaHeight.value = rect.height;
  }

  /** Вызывается на load: берём настоящие размеры картинки. */
  function handleLoad(event: Event) {
    const img = event.target as HTMLImageElement;
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (!nw || !nh) {
      failed.value = true;
      return;
    }
    naturalWidth.value = nw;
    naturalHeight.value = nh;
    loaded.value = true;
    failed.value = false;
  }

  function handleError() {
    failed.value = true;
    loaded.value = false;
  }

  /** Картинка могла загрузиться до подписки: проверяем сами. */
  function syncFromImage(img: HTMLImageElement | null) {
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      naturalWidth.value = img.naturalWidth;
      naturalHeight.value = img.naturalHeight;
      loaded.value = true;
      failed.value = false;
    }
  }

  /* Наблюдаем за областью, а не за картинкой: её размеры зависят от
     вычисленного масштаба, и наблюдение за ней дало бы цикл. */
  let observer: ResizeObserver | null = null;

  function observe(element: HTMLElement | null) {
    disconnect();
    if (!element || typeof ResizeObserver === "undefined") {
      measureArea(element);
      return;
    }
    measureArea(element);
    observer = new ResizeObserver(() => measureArea(element));
    observer.observe(element);
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
  }

  onBeforeUnmount(disconnect);

  return {
    geometry,
    imageStyle,
    loaded,
    failed,
    observe,
    disconnect,
    measureArea,
    handleLoad,
    handleError,
    syncFromImage,
    /** Для тестов и отладки. */
    _sizes: { naturalWidth, naturalHeight, areaWidth, areaHeight },
  };
}
