import { ref, nextTick, onMounted, onUnmounted, type Ref } from 'vue'

/**
 * Композабл для адаптивной подстройки размера шрифта в карточках товаров
 * Используется для кросс-селл товаров, товаров без линейки и товаров в группах
 */
export function useProductCardLayout(containerRef: Ref<HTMLElement | null>) {
  const isAdjusting = ref(false)

  /**
   * Подстраивает размер шрифта для одной карточки товара
   */
  function adjustCardFontSize(card: Element) {
    const cardEl = card as HTMLElement
    const singleMain = cardEl.querySelector('.liquid-line-single-main') as HTMLElement
    const singleSide = cardEl.querySelector('.liquid-line-single-side') as HTMLElement
    const infoBlock = cardEl.querySelector('.liquid-line-info') as HTMLElement
    
    if (!infoBlock || !singleMain || !singleSide) return
    
    const title = infoBlock.querySelector('.liquid-line-title') as HTMLElement
    const description = infoBlock.querySelector('.liquid-line-description') as HTMLElement
    
    if (!title) return
    
    // Базовые размеры шрифта
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
    let baseTitleSize = rootFontSize * 0.85
    let baseDescSize = rootFontSize * 0.65
    
    // Для мобильных устройств берем адаптивные базовые размеры
    const width = window.innerWidth
    if (width <= 480) {
      baseTitleSize = rootFontSize * 0.75
      baseDescSize = rootFontSize * 0.55
    } else if (width <= 768) {
      baseTitleSize = rootFontSize * 0.8
      baseDescSize = rootFontSize * 0.6
    }
    
    // Минимальные размеры шрифта
    const minTitleSize = Math.max(baseTitleSize * 0.6, 10)
    const minDescSize = Math.max(baseDescSize * 0.65, 8)
    
    // Сбрасываем стили
    title.style.fontSize = ''
    if (description) description.style.fontSize = ''
    
    // Ждем рендеринга
    requestAnimationFrame(() => {
    // Получаем высоту изображения (адаптивную)
    const imageEl = cardEl.querySelector('.liquid-line-image') as HTMLElement
    const maxHeight = imageEl ? imageEl.offsetHeight : 107
      
      // Вычисляем доступную ширину для текста
      const cardWidth = cardEl.offsetWidth
      const imageWidth = imageEl ? imageEl.offsetWidth : 70
      const sideWidth = singleSide.offsetWidth
      const mainStyle = window.getComputedStyle(singleMain)
      const headerEl = cardEl.querySelector('.liquid-line-single-header') as HTMLElement
      const headerStyle = headerEl ? window.getComputedStyle(headerEl) : null
      const mainGap = parseFloat(mainStyle.gap || '12')
      const headerGap = headerStyle ? parseFloat(headerStyle.gap || '12') : 12
      const availableWidth = cardWidth - imageWidth - sideWidth - mainGap - headerGap - 20
      
      // Если места совсем мало, не уменьшаем шрифт
      if (availableWidth < 80) return
      
      // Проверяем, влезает ли текст
      let titleSize = baseTitleSize
      let descSize = baseDescSize
      let iterations = 0
      const maxIterations = 20
      
      while (iterations < maxIterations) {
        title.style.fontSize = `${titleSize}px`
        if (description) description.style.fontSize = `${descSize}px`
        
        // Проверяем высоту и ширину блока
        const infoHeight = infoBlock.scrollHeight
        const infoScrollWidth = infoBlock.scrollWidth
        const infoClientWidth = infoBlock.clientWidth
        
        // Проверяем переполнение по высоте или ширине
        const isOverflowing = (infoHeight > maxHeight) || (infoScrollWidth > infoClientWidth)
        
        // Если влезает, выходим
        if (!isOverflowing) {
          break
        }
        
        // Уменьшаем размер шрифта
        const newTitleSize = titleSize - 0.5
        const newDescSize = descSize - 0.25
        
        if (newTitleSize < minTitleSize && (!description || newDescSize < minDescSize)) {
          break // Достигли минимума
        }
        
        if (newTitleSize >= minTitleSize) {
          titleSize = newTitleSize
        }
        if (description && newDescSize >= minDescSize) {
          descSize = newDescSize
        }
        
        iterations++
      }
    })
  }

  /**
   * Подстраивает размеры шрифтов для всех карточек в контейнере
   */
  async function adjustFontSizes() {
    if (isAdjusting.value) return
    
    isAdjusting.value = true
    await nextTick()
    
    if (!containerRef.value) {
      isAdjusting.value = false
      return
    }
    
    const cards = containerRef.value.querySelectorAll('.liquid-line-card-single')
    cards.forEach(adjustCardFontSize)
    
    isAdjusting.value = false
  }

  /**
   * Debounced версия для resize
   */
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null
  function handleResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(() => {
      adjustFontSizes()
    }, 100)
  }

  // Автоматическая инициализация и очистка
  onMounted(() => {
    setTimeout(() => adjustFontSizes(), 100)
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    if (resizeTimeout) clearTimeout(resizeTimeout)
  })

  return {
    adjustFontSizes,
    handleResize
  }
}
