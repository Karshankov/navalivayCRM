<template>
  <div class="product-info bg-white">
    <!-- Main Product Info -->
    <div class="px-4 pb-3 border-b border-gray-100">
      <!-- Title & Category -->
      <div class="mb-3 mt-0">
        <h1 class="text-2xl font-display font-medium text-brand-dark mb-2 mt-0">
          {{ product?.title || 'Загрузка...' }}
        </h1>
        
        <div class="flex flex-wrap items-center gap-2">
          <router-link
            v-if="category"
            :to="`/category/${category.slug}`"
            class="category-link inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-brand-primary active:text-brand-primary focus:text-brand-primary visited:text-gray-600 transition-colors focus:outline-none"
          >
            <TagIcon class="w-4 h-4" />
            <span>{{ category.name }}</span>
          </router-link>
          <router-link
            v-if="groupRoute"
            :to="groupRoute"
            class="group-chip inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-brand-primary/10 text-brand-dark border border-brand-primary/30"
          >
            <span>{{ product?.groupName }}</span>
          </router-link>
        </div>
      </div>

      <!-- Description -->
      <div v-if="product?.description" class="mt-2">
        <p class="product-description text-gray-700 leading-relaxed">
          {{ product.description }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TagIcon } from '@heroicons/vue/24/outline'

interface Props {
  product: any
  category: any
}

const props = defineProps<Props>()

const groupRoute = computed(() => {
  if (!props.product?.groupSlug || !props.category?.slug) {
    return null
  }
  return {
    name: 'category',
    params: { slug: props.category.slug },
    query: { group: props.product.groupSlug }
  }
})


</script>

<style scoped>
.scrollbar-hide {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Жёсткая фиксация всех свойств шрифта для ссылки */
.category-link {
  font-weight: 400 !important;
  font-size: 0.875rem !important; /* text-sm */
  font-family: inherit !important;
  text-decoration: none !important;
  line-height: 1.25rem !important;
  letter-spacing: normal !important;
}

.category-link:hover,
.category-link:active,
.category-link:focus,
.category-link:visited {
  font-weight: 400 !important;
  font-size: 0.875rem !important;
  font-family: inherit !important;
  text-decoration: none !important;
  line-height: 1.25rem !important;
  letter-spacing: normal !important;
}

/* Уменьшенные марджины для описания товара */
.product-description {
  margin-block-start: 0.67em !important; /* 1em ÷ 1.5 = 0.67em */
  margin-block-end: 0.67em !important;
  margin-inline-start: 0 !important;
  margin-inline-end: 0 !important;
}

.group-chip {
  text-decoration: none !important;
}
</style>
