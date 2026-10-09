import { onMounted, onUnmounted } from 'vue'

interface Spark {
  id: number
  x: number
  y: number
  angle: number
  velocity: number
  color: string
}

export function useSparkles() {
  const sparks: Spark[] = []
  let sparkId = 0

  function createSparks(x: number, y: number, count: number = 12) {
    const colors = ['#d32f2f', '#ef5350', '#ff6b6b', '#ffd700']
    
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
      const velocity = 2 + Math.random() * 3
      
      const spark: Spark = {
        id: sparkId++,
        x,
        y,
        angle,
        velocity,
        color: colors[Math.floor(Math.random() * colors.length)]
      }
      
      sparks.push(spark)
      renderSpark(spark)
    }
  }

  function renderSpark(spark: Spark) {
    const el = document.createElement('div')
    el.className = 'spark-particle'
    el.style.cssText = `
      position: fixed;
      left: ${spark.x}px;
      top: ${spark.y}px;
      width: 4px;
      height: 4px;
      background: ${spark.color};
      border-radius: 50%;
      pointer-events: none;
      z-index: 9999;
      box-shadow: 0 0 6px ${spark.color};
    `
    
    document.body.appendChild(el)
    
    let frame = 0
    const maxFrames = 30
    
    const animate = () => {
      frame++
      if (frame > maxFrames) {
        el.remove()
        return
      }
      
      const progress = frame / maxFrames
      const distance = spark.velocity * frame
      
      const newX = spark.x + Math.cos(spark.angle) * distance
      const newY = spark.y + Math.sin(spark.angle) * distance + (frame * frame * 0.1) // gravity
      
      el.style.left = `${newX}px`
      el.style.top = `${newY}px`
      el.style.opacity = String(1 - progress)
      el.style.transform = `scale(${1 - progress * 0.5})`
      
      requestAnimationFrame(animate)
    }
    
    requestAnimationFrame(animate)
  }

  function handleClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    
    // Only trigger on buttons and clickable elements
    if (
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.classList.contains('clickable') ||
      target.closest('.clickable')
    ) {
      createSparks(e.clientX, e.clientY, 8)
    }
  }

  onMounted(() => {
    document.addEventListener('click', handleClick)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleClick)
  })

  return {
    createSparks
  }
}