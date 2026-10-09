import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWholesaleStore } from './wholesale'

export interface CategoryGroup {
  id: string
  slug: string
  name: string
  order: number
  coverImage?: string | null
  hasCoverImage?: boolean
  productCount: number
  totalProductCount?: number
  parentId?: string | null
  badge?: string | null
  badgeColor?: string | null
  metaLabel?: string | null
  metaValue?: string | null
  strengthTier?: string | null
  isNew?: boolean
  newSince?: string | null
}

export interface Category {
  id: string
  slug: string
  name: string
  order: number
  productCount: number
  coverImage?: string | null
  hasCoverImage?: boolean
  groups: CategoryGroup[]
  displayMode?: 'default' | 'liquid' | 'visual'
  storefrontFiltersProfile?: 'none' | 'liquids' | 'snus_plates'
}

export interface ProductLink {
  label?: string
  url: string
}

export interface ProductBadge {
  type: string | null
  label: string | null
  color: string | null
}

export interface ProductVariant {
  id?: string
  product_id?: string
  name: string
  colorCode?: string | null
  colorImage?: string | null
  colorDisplayMode?: 'color' | 'image'  // Режим отображения: цвет или картинка
  priceRub?: number | null
  /** Цена до скидки. Пусто означает, что скидки нет. */
  oldPriceRub?: number | null
  hasDiscount?: boolean
  stock?: number
  position?: number
  images: string[]
  isAvailable?: boolean
}

export interface Product {
  id: string
  categoryId: string
  groupId?: string | null
  groupSlug?: string | null
  groupName?: string | null
  title: string
  priceRub: number
  /** Цена до скидки. Пусто означает, что скидки нет. */
  oldPriceRub?: number | null
  hasDiscount?: boolean
  description: string
  images: string[]
  links?: ProductLink[]
  createdAt: string
  color?: string
  variant?: string
  strength?: string | null
  costPrice?: number
  stock?: number | null
  minStock?: number | null
  isAvailable?: boolean
  badges?: ProductBadge[]
  hasVariants?: boolean
  variants?: ProductVariant[]
  needsCategoryImage?: boolean // Флаг: нужно загрузить обложку категории
  isWholesale?: boolean
  wholesaleCode?: string | null
  wholesaleMinAmount?: number | null
}

export interface Banner {
  id: string
  image: string
  href: string | null
  active: number
  order: number
  openInNewTab?: number // 0 or 1 from API
  title?: string
  description?: string
  ctaText?: string | null
}


export type SortOption = 'price_asc' | 'price_desc' // | 'newest' | 'oldest'

export const useCatalogStore = defineStore('catalog', () => {
  // State
  const categories = ref<Category[]>([])
  const products = ref<Product[]>([])
  const allProducts = ref<Product[]>([]) // Store all products for category counts
  const banners = ref<Banner[]>([])
  const currentProduct = ref<Product | null>(null)
  
  const activeCategory = ref<string | null>(null)
  const activeGroup = ref<string | null>(null)
  const sortBy = ref<SortOption>('price_asc')
  const searchQuery = ref('')
  const crossSellProducts = ref<Record<string, Product[]>>({})
  
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  
  // Pagination
  const currentPage = ref(0)
  const itemsPerPage = ref(20)
  const hasMore = ref(true)
  const totalProducts = ref(0)

  /**
   * Полный список товаров: дедуп по ключу опта (розница vs code:secret).
   * Связка гонки с оптом: cart.loadFromStorage в setup WholesaleEntry до activateFromLink
   * может запустить fetch без заголовков опта; поколение fetchAllProductsLatestGen отбрасывает
   * ответ такого запроса, если уже стартовала более новая загрузка (например с оптом).
   */
  let fetchAllProductsLatestGen = 0
  const fetchAllProductsInFlight = new Map<string, Promise<void>>()

  // Кэш изображений категорий (categoryId -> base64 image)
  const categoryImageCache = ref<Map<string, string>>(new Map())
  // Кэш изображений групп (groupId -> base64 image)
  const groupImageCache = ref<Map<string, string>>(new Map())
  // Отслеживание загрузок в процессе
  const loadingCategoryImages = ref<Set<string>>(new Set())
  const loadingGroupImages = ref<Set<string>>(new Set())

  function getWholesaleHeaders(): Record<string, string> {
    const wholesaleStore = useWholesaleStore()
    return wholesaleStore.buildHeaders()
  }

  function getAllProductsFetchKey(): string {
    const h = getWholesaleHeaders()
    const code = h['x-wholesale-code'] || ''
    const secret = h['x-wholesale-secret'] || ''
    return code && secret ? `${code}:${secret}` : '__retail__'
  }

  // Computed
  const filteredProducts = computed(() => {
    let filtered = products.value
    
    if (activeCategory.value) {
      const category = categories.value.find(c => c.slug === activeCategory.value)
      if (category) {
        filtered = filtered.filter(p => p.categoryId === category.id)
      }
    }

    if (activeGroup.value) {
      filtered = filtered.filter(p => p.groupSlug === activeGroup.value)
    }
    
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      filtered = filtered.filter(p => 
        p.title.toLowerCase().includes(query) || 
        p.description.toLowerCase().includes(query)
      )
    }
    
    return filtered
  })

  const categoriesWithProductCounts = computed(() => {
    return categories.value.map(category => ({
      ...category,
      productCount: allProducts.value.filter(p => p.categoryId === category.id).length
    }))
  })

  const activeCategoryName = computed(() => {
    if (!activeCategory.value) return 'Все товары'
    const category = categories.value.find(c => c.slug === activeCategory.value)
    return category?.name || 'Все товары'
  })

  const activeGroupName = computed(() => {
    if (!activeGroup.value) return null
    const category = categories.value.find(c => c.slug === activeCategory.value)
    const group = category?.groups.find(g => g.slug === activeGroup.value)
    return group?.name || null
  })

  // Helpers
  function delay(ms: number) { return new Promise(res => setTimeout(res, ms)) }
  async function waitForIdle(timeoutMs = 3000) {
    const start = Date.now()
    while (isLoading.value) {
      if (Date.now() - start > timeoutMs) break
      await delay(50)
    }
  }

  // Функция загрузки изображения категории с кэшированием
  async function fetchCategoryImage(categoryId: string): Promise<string | null> {
    // Новый API уже присылает короткий адрес обложки в списке категорий.
    // Старый JSON с base64 оставляем только запасным путём.
    const existingImage = getCategoryImage(categoryId)
    if (existingImage) {
      return existingImage
    }
    // Проверяем, не загружается ли уже
    if (loadingCategoryImages.value.has(categoryId)) {
      // Ждём завершения загрузки
      while (loadingCategoryImages.value.has(categoryId)) {
        await delay(50)
      }
      return categoryImageCache.value.get(categoryId) || null
    }
    
    try {
      loadingCategoryImages.value.add(categoryId)
      const response = await fetch(`/api/categories/${categoryId}/image`)
      if (!response.ok) return null
      const data = await response.json()
      if (data.image) {
        categoryImageCache.value.set(categoryId, data.image)
        return data.image
      }
      return null
    } catch {
      return null
    } finally {
      loadingCategoryImages.value.delete(categoryId)
    }
  }

  // Функция загрузки изображения группы с кэшированием
  async function fetchGroupImage(groupId: string): Promise<string | null> {
    const existingImage = getGroupImage(groupId)
    if (existingImage) {
      return existingImage
    }
    if (loadingGroupImages.value.has(groupId)) {
      while (loadingGroupImages.value.has(groupId)) {
        await delay(50)
      }
      return groupImageCache.value.get(groupId) || null
    }
    
    try {
      loadingGroupImages.value.add(groupId)
      const response = await fetch(`/api/category-groups/${groupId}/image`)
      if (!response.ok) return null
      const data = await response.json()
      if (data.image) {
        updateGroupCoverImage(groupId, data.image)
        return data.image
      }
      return null
    } catch {
      return null
    } finally {
      loadingGroupImages.value.delete(groupId)
    }
  }

  // Получить актуальное изображение категории (синхронно).
  // coverImage — основной путь, кэш нужен для старого API с base64.
  function getCategoryImage(categoryId: string): string | null {
    const normalizedId = String(categoryId)
    const categoryImage = categories.value.find(
      (category) => category.id === normalizedId,
    )?.coverImage
    return categoryImage || categoryImageCache.value.get(normalizedId) || null
  }

  // Получить актуальное изображение линейки (синхронно).
  function getGroupImage(groupId: string): string | null {
    const normalizedId = String(groupId)
    for (const category of categories.value) {
      const groupImage = category.groups.find(
        (group) => group.id === normalizedId,
      )?.coverImage
      if (groupImage) return groupImage
    }
    return groupImageCache.value.get(normalizedId) || null
  }

  function updateCategoryCoverImage(categoryId: string, image: string) {
    const categoryIndex = categories.value.findIndex(category => category.id === categoryId)
    if (categoryIndex === -1) return

    categories.value[categoryIndex] = {
      ...categories.value[categoryIndex],
      coverImage: image
    }
  }

  function updateGroupCoverImage(groupId: string, image: string) {
    groupImageCache.value.set(groupId, image)

    categories.value = categories.value.map((category) => {
      const groupIndex = category.groups.findIndex((group) => group.id === groupId)
      if (groupIndex === -1) {
        return category
      }

      const groups = [...category.groups]
      groups[groupIndex] = {
        ...groups[groupIndex],
        coverImage: image,
      }

      return {
        ...category,
        groups,
      }
    })
  }

  // Actions
  async function fetchCategories() {
    try {
      const response = await fetch('/api/categories', {
        headers: getWholesaleHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch categories')
      const data = await response.json()
      const mapped: Category[] = (data as any[]).map((cat) => ({
        id: String(cat.id),
        slug: cat.slug,
        name: cat.name,
        order: cat.order ?? 0,
        productCount: cat.productCount ?? 0,
        // Сервер присылает готовый адрес картинки, тянет её сам браузер.
        // Кэш остаётся запасным путём для старых ответов без адреса.
        coverImage: cat.coverImage ?? categoryImageCache.value.get(String(cat.id)) ?? null,
        hasCoverImage: cat.hasCoverImage ?? false,
        displayMode: (cat.displayMode ?? cat.display_mode ?? 'default') as 'default' | 'liquid' | 'visual',
        storefrontFiltersProfile: (cat.storefrontFiltersProfile ?? cat.storefront_filters_profile ?? 'none') as 'none' | 'liquids' | 'snus_plates',
        groups: Array.isArray(cat.groups)
          ? (cat.groups as any[]).map((group) => ({
              id: String(group.id),
              slug: group.slug,
              name: group.name,
              order: group.order ?? 0,
              coverImage: group.coverImage ?? groupImageCache.value.get(String(group.id)) ?? null,
              hasCoverImage: group.hasCoverImage ?? false,
              productCount: group.productCount ?? 0,
              totalProductCount: group.totalProductCount ?? group.productCount ?? 0,
              parentId: group.parentId ?? null,
              badge: group.badge ?? null,
              badgeColor: group.badgeColor ?? null,
              metaLabel: group.metaLabel ?? group.meta_label ?? null,
              metaValue: group.metaValue ?? group.meta_value ?? null,
              strengthTier: group.strengthTier ?? group.strength_tier ?? null,
              isNew: Boolean(group.isNew),
              newSince: group.newSince ?? null
            }))
          : []
      }))
      categories.value = mapped.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      
      // Асинхронно загружаем изображения для категорий с hasCoverImage
      loadCategoryImages()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Error fetching categories:', err)
    }
  }

  // Загружаем только обложки категорий.
  // Обложки групп подгружаем точечно по текущей категории и раскрытым веткам,
  // чтобы не тормозить интерфейс десятками base64-картинок сразу.
  async function loadCategoryImages(categoryIds?: string[]) {
    const requestedIds = categoryIds?.length
      ? new Set(categoryIds.map(id => String(id)))
      : null
    const categoriesToLoad = categories.value.filter((category) => {
      if (!category.hasCoverImage || category.coverImage) return false
      return requestedIds ? requestedIds.has(category.id) : true
    })

    const batchSize = 2
    for (let i = 0; i < categoriesToLoad.length; i += batchSize) {
      const batch = categoriesToLoad.slice(i, i + batchSize)
      await Promise.all(batch.map(async (category) => {
        const image = await fetchCategoryImage(category.id)
        if (image) {
          updateCategoryCoverImage(category.id, image)
        }
      }))

      if (i + batchSize < categoriesToLoad.length) {
        await delay(16)
      }
    }
  }

  async function loadGroupImages(groupIds: string[]) {
    const requestedIds = Array.from(new Set(groupIds.map(id => String(id)).filter(id => id.length > 0)))
    if (!requestedIds.length) {
      return
    }

    const groupsToLoad = requestedIds.filter((groupId) => {
      if (groupImageCache.value.has(groupId) || loadingGroupImages.value.has(groupId)) {
        return false
      }

      return categories.value.some((category) =>
        category.groups.some((group) =>
          group.id === groupId && group.hasCoverImage && !group.coverImage
        )
      )
    })

    const batchSize = 2
    for (let i = 0; i < groupsToLoad.length; i += batchSize) {
      const batch = groupsToLoad.slice(i, i + batchSize)
      await Promise.all(batch.map(async (groupId) => {
        await fetchGroupImage(groupId)
      }))

      if (i + batchSize < groupsToLoad.length) {
        await delay(16)
      }
    }
  }

  async function loadGroupImagesForCategory(
    categoryId: string,
    parentGroupId: string | null = null,
  ) {
    const category = categories.value.find((item) => item.id === categoryId)
    if (!category) {
      return
    }

    const targetGroupIds = category.groups
      .filter((group) => {
        const normalizedParentId = group.parentId ? String(group.parentId) : null
        return parentGroupId === null
          ? normalizedParentId === null
          : normalizedParentId === parentGroupId
      })
      .map((group) => group.id)

    return loadGroupImages(targetGroupIds)
  }

  async function fetchProducts(loadMore = false) {
    if (isLoading.value) return
    
    try {
      isLoading.value = true
      error.value = null
      
      const offset = loadMore ? currentPage.value * itemsPerPage.value : 0
      const params = new URLSearchParams({
        limit: itemsPerPage.value.toString(),
        offset: offset.toString(),
        sort: sortBy.value
      })
      
      if (activeCategory.value) {
        params.set('category', activeCategory.value)
      }

      if (activeGroup.value) {
        params.set('group', activeGroup.value)
      }
      
      const response = await fetch(`/api/products?${params}`, {
        headers: getWholesaleHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch products')
      
      const data = await response.json()
      
      // Обрабатываем товары, которым нужна обложка категории
      const processedProducts = await processProductImages(data.products)
      
      if (loadMore) {
        products.value.push(...processedProducts)
        currentPage.value++
      } else {
        products.value = processedProducts
        currentPage.value = 0
      }
      
      totalProducts.value = data.total
      hasMore.value = data.hasMore
      
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Error fetching products:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Обработка изображений товаров - подставляем обложки категорий где нужно
  async function processProductImages(productsList: Product[]): Promise<Product[]> {
    // Собираем уникальные categoryId для товаров с needsCategoryImage
    const categoryIdsToLoad = new Set<string>()
    productsList.forEach(p => {
      if (p.needsCategoryImage && p.categoryId) {
        categoryIdsToLoad.add(p.categoryId)
      }
    })
    
    // Загружаем недостающие изображения категорий
    await Promise.all(
      Array.from(categoryIdsToLoad).map(catId => fetchCategoryImage(catId))
    )
    
    // Подставляем прямой адрес из списка категорий или старое значение из кэша.
    return productsList.map(p => {
      if (p.needsCategoryImage && p.categoryId) {
        const categoryImage = getCategoryImage(p.categoryId)
        if (categoryImage) {
          return { ...p, images: [categoryImage] }
        }
      }
      return p
    })
  }

  async function fetchAllProducts(options?: { force?: boolean }) {
    const key = getAllProductsFetchKey()
    if (!options?.force) {
      const existing = fetchAllProductsInFlight.get(key)
      if (existing) {
        await existing
        return
      }
    } else {
      fetchAllProductsInFlight.delete(key)
    }

    const myGen = ++fetchAllProductsLatestGen

    const inFlightRef: { current?: Promise<void> } = {}
    const promise: Promise<void> = (async () => {
      try {
        const response = await fetch('/api/products?limit=1000&offset=0', {
          headers: getWholesaleHeaders(),
        })
        if (!response.ok) throw new Error('Failed to fetch all products')
        const data = await response.json()
        const processed = await processProductImages(data.products)
        if (myGen !== fetchAllProductsLatestGen) return
        allProducts.value = processed
        if (allProducts.value.length) {
          const { useCartStore } = await import('./cart')
          useCartStore().syncItemPricesFromCatalog()
        }
      } catch (err) {
        console.error('Error fetching all products for counts:', err)
      } finally {
        if (fetchAllProductsInFlight.get(key) === inFlightRef.current) {
          fetchAllProductsInFlight.delete(key)
        }
      }
    })()

    inFlightRef.current = promise
    fetchAllProductsInFlight.set(key, promise)
    await promise
  }

  async function fetchProduct(id: string) {
    try {
      isLoading.value = true
      error.value = null
      
      const response = await fetch(`/api/product/${id}`, {
        headers: getWholesaleHeaders(),
      })
      if (!response.ok) throw new Error('Product not found')
      
      let product = await response.json()
      
      // Если нужна обложка категории
      if (product.needsCategoryImage && product.categoryId) {
        const categoryImage = await fetchCategoryImage(product.categoryId)
        if (categoryImage) {
          product = { ...product, images: [categoryImage] }
        }
      }
      
      currentProduct.value = product
      
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Error fetching product:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function fetchBanners() {
    try {
      const wholesaleStore = useWholesaleStore()
      if (wholesaleStore.isWholesale) {
        banners.value = []
        return []
      }

      const response = await fetch('/api/banners', {
        headers: getWholesaleHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch banners')
      const raw = await response.json()
      // Normalize shape to { id, image, href, active:number, order, openInNewTab }
      const data: Banner[] = (raw as any[]).map((b: any) => ({
        id: String(b.id),
        image: b.image || b.imageUrl || '',
        href: b.href ?? b.linkUrl ?? null,
        active: typeof b.active === 'boolean' ? (b.active ? 1 : 0) : (b.active ?? (b.isActive ? 1 : 0)),
        order: b.order ?? 0,
        openInNewTab: b.openInNewTab ?? 0, // API returns 0/1, default to 0
        title: b.title ?? b.name ?? undefined,
        description: b.description ?? undefined,
        ctaText: b.ctaText ?? b.buttonText ?? null,
      }))
      // show only active banners sorted by order asc
      banners.value = data
        .filter(b => b.active === 1)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Error fetching banners:', err)
    }
  }

  async function searchProducts(query: string) {
    if (!query.trim()) {
      searchQuery.value = ''
      await fetchProducts()
      return
    }
    
    try {
      isLoading.value = true
      error.value = null
      searchQuery.value = query
      
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=50`, {
        headers: getWholesaleHeaders(),
      })
      if (!response.ok) throw new Error('Search failed')
      
      const data = await response.json()
      products.value = data.results
      hasMore.value = false
      
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      console.error('Error searching products:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function setActiveCategory(categorySlug: string | null) {
    activeCategory.value = categorySlug
    activeGroup.value = null
    currentPage.value = 0
    await waitForIdle()
    return fetchProducts()
  }

  async function setActiveGroup(groupSlug: string | null) {
    activeGroup.value = groupSlug
    currentPage.value = 0
    await waitForIdle()
    return fetchProducts()
  }

  async function setSortBy(sort: SortOption) {
    sortBy.value = sort
    currentPage.value = 0
    await waitForIdle()
    return fetchProducts()
  }

  function loadMoreProducts() {
    if (hasMore.value && !isLoading.value) {
      fetchProducts(true)
    }
  }

  function clearSearch() {
    searchQuery.value = ''
    fetchProducts()
  }

  async function fetchCrossSell(categorySlug: string) {
    try {
      const response = await fetch(`/api/cross-sells?category=${encodeURIComponent(categorySlug)}`, {
        headers: getWholesaleHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch cross sell items')
      const data = await response.json()
      // Обрабатываем изображения
      const processed = await processProductImages(data)
      crossSellProducts.value = { ...crossSellProducts.value, [categorySlug]: processed }
      return processed as Product[]
    } catch (err) {
      console.error('Error fetching cross-sell:', err)
      return []
    }
  }

  function clearError() {
    error.value = null
  }
  
  function clearCurrentProduct() {
    currentProduct.value = null
  }


  // Initialize
  async function initialize() {
    const wholesaleStore = useWholesaleStore()
    const loaders: Array<Promise<unknown>> = [
      fetchCategories(),
      fetchProducts(),
      fetchAllProducts(),
    ]

    if (!wholesaleStore.isWholesale) {
      loaders.push(fetchBanners())
    } else {
      banners.value = []
    }

    await Promise.all(loaders)
  }

  return {
    // State
    categories,
    products,
    allProducts,
    banners,
    currentProduct,
    activeCategory,
    activeGroup,
    sortBy,
    searchQuery,
    crossSellProducts,
    isLoading,
    error,
    currentPage,
    hasMore,
    totalProducts,
    categoryImageCache,
    groupImageCache,
    
    // Computed
    filteredProducts,
    activeCategoryName,
    activeGroupName,
    categoriesWithProductCounts,
    
    // Actions
    fetchCategories,
    fetchProducts,
    fetchAllProducts,
    fetchProduct,
    fetchBanners,
    searchProducts,
    setActiveCategory,
    setActiveGroup,
    setSortBy,
    loadMoreProducts,
    clearSearch,
    clearError,
    clearCurrentProduct,
    fetchCrossSell,
    initialize,
    // Новые функции для работы с изображениями
    fetchCategoryImage,
    fetchGroupImage,
    getCategoryImage,
    getGroupImage,
    loadCategoryImages,
    loadGroupImages,
    loadGroupImagesForCategory
  }
})
