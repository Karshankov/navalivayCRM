<template>
  <div class="search-page">
    <!-- Шапка поиска -->
    <header class="search-header">
      <button class="search-back" aria-label="Назад" @click="goBack">
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
          <path
            d="M10 1L2 10L10 19"
            stroke="#191919"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <form class="search-field" role="search" @submit.prevent="submit">
        <input
          ref="inputRef"
          v-model="query"
          class="search-field__input"
          type="search"
          inputmode="search"
          placeholder="Поиск по каталогу"
          aria-label="Поиск"
          enterkeyhint="search"
        />
        <button
          v-if="query"
          type="button"
          class="search-field__clear"
          aria-label="Очистить"
          @click="clear"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="#E7EAEF" />
            <path d="M5.2 5.2L10.8 10.8M10.8 5.2L5.2 10.8" stroke="#7B8794" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </form>
    </header>

    <!-- Результаты -->
    <div class="search-results">
      <template v-if="!query.trim()">
        <p class="search-empty">Начните вводить название товара</p>
      </template>

      <template v-else-if="filtered.length">
        <button
          v-for="product in filtered"
          :key="product.id"
          class="search-item"
          @click="openProduct(product)"
        >
          <span
            class="search-item__media"
            :style="productImage(product) ? { backgroundImage: `url(${productImage(product)})` } : {}"
          >
            <svg
              v-if="!productImage(product)"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C7CDD4"
              stroke-width="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </span>
          <span class="search-item__copy">
            <strong class="search-item__name">{{ product.title }}</strong>
            <span class="search-item__category">{{ categoryName(product) }}</span>
          </span>
          <span class="search-item__price">{{ productPrice(product) }}</span>
        </button>
      </template>

      <p v-else class="search-empty">Ничего не нашлось по «{{ query.trim() }}»</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useCatalogStore, type Product } from "@/stores/catalog";

/**
 * Экран поиска: мгновенная фильтрация по предзагруженному каталогу
 * (сплэш) — результаты появляются на каждый символ без сети.
 */
const route = useRoute();
const router = useRouter();
const catalogStore = useCatalogStore();

const query = ref(typeof route.query.q === "string" ? route.query.q : "");
const inputRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  // Мгновенный каталог, если вдруг зашли напрямую.
  if (!catalogStore.categories.length) {
    void catalogStore.initialize();
  }
  inputRef.value?.focus();
});

watch(query, (value) => {
  const q = value.trim();
  router.replace({ query: q ? { q } : {} });
});

const filtered = computed<Product[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  const source = catalogStore.allProducts.length
    ? catalogStore.allProducts
    : catalogStore.products;
  return source
    .filter((product) => product.title?.toLowerCase().includes(q))
    .slice(0, 50);
});

function productImage(product: Product): string | null {
  return product.images?.[0] ?? null;
}

function categoryName(product: Product): string {
  return (
    catalogStore.categories.find((c) => c.id === product.categoryId)?.name ?? ""
  );
}

function productPrice(product: Product): string {
  const price = product.variants?.[0]?.priceRub ?? product.priceRub ?? 0;
  return `${Number(price).toFixed(2)} BYN`;
}

function openProduct(product: Product) {
  catalogStore.currentProduct = product;
  router.push({ name: "product", params: { id: product.id } });
}

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.replace("/");
  }
}

function submit() {
  inputRef.value?.blur();
}

function clear() {
  query.value = "";
  inputRef.value?.focus();
}
</script>

<style scoped>
.search-page {
  min-height: 100dvh;
  background: #f5f7fa;
  display: flex;
  flex-direction: column;
}

.search-header {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 16px;
  padding-top: env(safe-area-inset-top, 0px);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.06);
}

.search-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.search-field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  background: #f5f7fa;
  border-radius: 12px;
}

.search-field__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-size: 15px;
  color: #191919;
  font-family: inherit;
}

.search-field__input::placeholder {
  color: #98a1ac;
}

.search-field__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}

.search-results {
  flex: 1;
  padding: 10px 16px calc(env(safe-area-inset-bottom, 0px) + 24px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-empty {
  margin: 40px 0;
  text-align: center;
  font-size: 14px;
  color: #7b8794;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  background: #fff;
  border: none;
  border-radius: 14px;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.search-item:active {
  transform: scale(0.98);
}

.search-item__media {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 10px;
  background: #f5f7fa center / cover no-repeat;
  flex: 0 0 auto;
}

.search-item__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.search-item__name {
  font-size: 14px;
  font-weight: 600;
  color: #191919;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-item__category {
  font-size: 12px;
  color: #7b8794;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-item__price {
  font-size: 14px;
  font-weight: 700;
  color: #191919;
  flex: 0 0 auto;
}
</style>
