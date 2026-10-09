<template>
  <svg 
    :width="size" 
    :height="size" 
    viewBox="0 0 100 100" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    :class="['explosion-icon', animated ? 'animated' : '']"
  >
    <!-- Main explosion cloud -->
    <path 
      d="M50 10 C60 10, 65 15, 68 20 C72 25, 75 30, 75 40 C75 45, 73 50, 70 55 C75 58, 80 62, 82 68 C85 75, 83 82, 78 87 C75 90, 70 92, 65 92 C60 92, 55 90, 50 88 C45 90, 40 92, 35 92 C30 92, 25 90, 22 87 C17 82, 15 75, 18 68 C20 62, 25 58, 30 55 C27 50, 25 45, 25 40 C25 30, 28 25, 32 20 C35 15, 40 10, 50 10 Z" 
      :fill="color"
      opacity="0.9"
    />
    
    <!-- Inner highlight -->
    <ellipse 
      cx="50" 
      cy="45" 
      rx="15" 
      ry="18" 
      :fill="highlightColor"
      opacity="0.6"
    />
    
    <!-- Smoke particles -->
    <circle cx="45" cy="25" r="5" :fill="color" opacity="0.7" class="smoke-1" />
    <circle cx="58" cy="22" r="4" :fill="color" opacity="0.6" class="smoke-2" />
    <circle cx="52" cy="15" r="3" :fill="color" opacity="0.5" class="smoke-3" />
    
    <!-- Bottom wisps -->
    <path 
      d="M40 75 Q35 80, 30 85 Q25 88, 20 87" 
      :stroke="color" 
      stroke-width="3" 
      fill="none" 
      opacity="0.4"
      stroke-linecap="round"
    />
    <path 
      d="M60 75 Q65 80, 70 85 Q75 88, 80 87" 
      :stroke="color" 
      stroke-width="3" 
      fill="none" 
      opacity="0.4"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup lang="ts">
interface Props {
  size?: number | string
  color?: string
  highlightColor?: string
  animated?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  color: '#d32f2f',
  highlightColor: '#ef5350',
  animated: false
})
</script>

<style scoped>
.explosion-icon {
  display: inline-block;
  vertical-align: middle;
}

.explosion-icon.animated {
  animation: pulse 2s ease-in-out infinite;
}

.animated .smoke-1 {
  animation: smoke-float-1 3s ease-in-out infinite;
}

.animated .smoke-2 {
  animation: smoke-float-2 3.5s ease-in-out infinite 0.5s;
}

.animated .smoke-3 {
  animation: smoke-float-3 4s ease-in-out infinite 1s;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.9;
  }
}

@keyframes smoke-float-1 {
  0%, 100% {
    transform: translateY(0) translateX(0);
    opacity: 0.7;
  }
  50% {
    transform: translateY(-5px) translateX(-2px);
    opacity: 0.4;
  }
}

@keyframes smoke-float-2 {
  0%, 100% {
    transform: translateY(0) translateX(0);
    opacity: 0.6;
  }
  50% {
    transform: translateY(-6px) translateX(2px);
    opacity: 0.3;
  }
}

@keyframes smoke-float-3 {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  50% {
    transform: translateY(-8px);
    opacity: 0.2;
  }
}
</style>