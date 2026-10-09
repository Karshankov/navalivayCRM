import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { $fetch } from '@/utils/http'
import { getInMemoryStaffHeaders, useCrmStore } from './crm'

// Types
export interface User {
  username: string
  role: string
}

export interface Banner {
  id: string
  image: string
  href: string | null
  active: number // 0 or 1 from API
  order: number
  openInNewTab?: number // 0 or 1 from API
  title?: string
  description?: string
}

export interface Category {
  id: string
  slug: string
  name: string
  order: number
  productCount?: number
  hide_empty?: number | boolean
  cover_image?: string | null
  hasCoverImage?: boolean
  display_mode?: 'default' | 'liquid' | 'visual'
  displayMode?: 'default' | 'liquid' | 'visual'
  storefront_filters_profile?: 'none' | 'liquids' | 'snus_plates'
  storefrontFiltersProfile?: 'none' | 'liquids' | 'snus_plates'
}

export interface ProductLink {
  label?: string
  url: string
}

export interface ProductVariant {
  id?: string
  product_id?: string
  name: string
  colorCode?: string | null
  colorImage?: string | null
  colorDisplayMode?: 'color' | 'image'
  priceRub?: number | null
  stock?: number
  warehouseStock?: number
  position?: number
  images: string[]
}

export interface Product {
  id: string
  categoryId: string
  categoryName?: string
  groupId?: string | null
  groupName?: string | null
  groupSlug?: string | null
  title: string
  priceRub: number
  description: string
  images: string[]
  links?: ProductLink[]
  createdAt: string
  strength?: string | null
  costPrice?: number
  stock?: number
  warehouseStock?: number
  minStock?: number
  hasVariants?: boolean | number
  variants?: ProductVariant[]
  useCategoryImage?: boolean | number
  categoryImage?: string | null
  groupImage?: string | null
}

export interface WholesaleTier {
  id: string
  code: string
  label: string
  minOrderAmount: number
  sortOrder: number
}

export interface WholesaleLink {
  id: string
  code: string
  label: string
  minOrderAmount: number
  sortOrder: number
  path: string | null
  totalTargetGroups: number
  filledGroupCount: number
  missingGroupCount: number
}

export interface CategoryGroup {
  id: string
  categoryId: string
  slug: string
  name: string
  coverImage?: string | null
  hasCoverImage?: boolean
  order: number
  hideEmpty?: boolean
  parentId?: string | null
  metaLabel?: string | null
  metaValue?: string | null
  minStockThreshold?: number | null
  totalControl?: boolean
  isNew?: boolean
  newDaysTotal?: number | null
  newDaysLeft?: number | null
  newSince?: string | null
  discount?: { price: number; untilDate: string | null; active: boolean } | null
  waiveDescription?: boolean
  waiveMinStock?: boolean
  waiveWholesale?: boolean
  waiveStrengthTier?: boolean
  strengthTier?: string | null
  createdAt?: string
  updatedAt?: string
  productCount?: number
  totalProductCount?: number
  stockSum?: number
  totalStockSum?: number
  emptySince?: string | null
  averageCostAuto?: number | null
  directProductCount?: number
  productsWithCostCount?: number
  wholesalePrices?: Record<string, number | null>
  wholesaleTiers?: WholesaleTier[]
}

export type IncompleteGroupField = 'description' | 'min_stock' | 'wholesale' | 'strength_tier'

export interface IncompleteGroupItem {
  id: string
  name: string
  slug: string
  categoryId: string
  categoryName: string | null
  hasCoverImage: boolean
  productCount: number
  missingFields: IncompleteGroupField[]
  missingWholesaleTiers: string[]
  wholesaleFilledCount: number
  wholesaleTotalCount: number
  waivers: {
    description: boolean
    min_stock: boolean
    wholesale: boolean
    strength_tier: boolean
  }
}

interface ProductsResponse {
  products: Product[]
  availableGroups?: Array<{ id: string; name: string; categoryId: string }>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

interface ApiError {
  error: string
  message: string
}

// Реальный стор админки. Без моков.

function clientRequestKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const pendingAdminMutationKeys = new Map<string, string>()

function pendingAdminMutationKey(scope: string, payload: unknown) {
  const signature = `${scope}:${JSON.stringify(payload)}`
  let key = pendingAdminMutationKeys.get(signature)
  if (!key) {
    key = clientRequestKey()
    pendingAdminMutationKeys.set(signature, key)
    if (pendingAdminMutationKeys.size > 100) {
      const oldest = pendingAdminMutationKeys.keys().next().value
      if (oldest) pendingAdminMutationKeys.delete(oldest)
    }
  }
  return { key, signature }
}

export const useAdminStore = defineStore('admin', () => {
  // Authentication state
  const isAuthenticated = ref(false)
  const user = ref<User | null>(null)
  const token = ref('')

  // Data state
  const banners = ref<Banner[]>([])
  const categories = ref<Category[]>([])
  const products = ref<Product[]>([])
  const currentProduct = ref<Product | null>(null)
  const categoryGroups = ref<CategoryGroup[]>([])
  const availableProductGroups = ref<Array<{ id: string; name: string; categoryId: string }>>([])
  const categoryCrossSells = ref<Record<string, Product[]>>({})
  const wholesaleLinks = ref<WholesaleLink[]>([])
  const settings = ref<Record<string, string>>({})
  const incompleteGroups = ref<IncompleteGroupItem[]>([])
  const incompleteGroupsHasAny = ref(false)
  const incompleteGroupsCount = ref(0)

  // UI state
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Pagination state
  const productsPagination = ref({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1
  })
  const productsLocation = ref<'retail' | 'warehouse'>('retail')
  let latestProductsRequestId = 0

  // Computed
  const isLoggedIn = computed(() => isAuthenticated.value && !!token.value)

  // Utilities
  function setError(message: string) {
    error.value = message
    setTimeout(() => {
      error.value = null
    }, 5000)
  }

  function handleApiError(err: any) {
    console.error('API Error:', err)
    
    // Специальная обработка дублирования категорий
    if (err.data?.error === 'duplicate_category') {
      setError(err.data.message || 'Категория с таким названием уже существует')
      return
    }
    
    // Обычная обработка ошибок
    if (err.data?.message) {
      setError(err.data.message)
    } else if (err.message) {
      setError(err.message)
    } else {
      setError('Произошла ошибка при выполнении запроса')
    }
  }

  function normalizeWholesaleTiers(value: any): WholesaleTier[] {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map((tier: any) => ({
        id: String(tier?.id || ''),
        code: String(tier?.code || ''),
        label: String(tier?.label || ''),
        minOrderAmount: Number(tier?.minOrderAmount ?? tier?.min_order_amount ?? 0),
        sortOrder: Number(tier?.sortOrder ?? tier?.sort_order ?? 0),
      }))
      .filter((tier) => tier.id && tier.code)
  }

  function normalizeWholesalePrices(value: any): Record<string, number | null> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(value).map(([code, rawPrice]) => {
        if (rawPrice === null || rawPrice === undefined || rawPrice === '') {
          return [String(code), null]
        }

        return [String(code), Number(rawPrice)]
      }),
    )
  }

  function normalizeMinStockThreshold(value: any): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null
    }
    return Math.floor(numeric)
  }

  function normalizeProductData(product: any): Product {
    const hasVariants = Boolean(product?.hasVariants ?? 0)
    const result: Product = {
      ...product,
      strength: product?.strength ?? null,
      costPrice: Number(product?.costPrice ?? 0),
      stock: Number(product?.stock ?? 0),
      warehouseStock: Number(product?.warehouseStock ?? product?.warehouse_stock ?? 0),
      minStock: Number(product?.minStock ?? 0),
      hasVariants,
      discount: product?.discount ?? null,
      useCategoryImage: Boolean(product?.useCategoryImage ?? 1)
    }
    
    if (hasVariants && Array.isArray(product?.variants)) {
      result.variants = product.variants.map((v: any) => ({
        id: v.id,
        product_id: v.product_id,
        name: v.name || '',
        colorCode: v.colorCode || v.color_code || null,
        colorImage: v.colorImage || v.color_image || null,
        colorDisplayMode: v.colorDisplayMode || v.color_display_mode || (v.colorImage || v.color_image ? 'image' : 'color'),
        discount: v.discount ?? null,
        priceRub: v.priceRub !== undefined ? Number(v.priceRub) : null,
        stock: v.stock !== undefined ? Number(v.stock) : 0,
        warehouseStock: Number(v.warehouseStock ?? v.warehouse_stock ?? 0),
        position: v.position ?? 0,
        images: Array.isArray(v.images) ? v.images : []
      }))
      // Для товаров с вариантами images может быть пустым
      result.images = result.images || []
    } else {
      result.images = Array.isArray(product?.images) ? product.images : []
    }
    
    return result
  }

  // Authentication methods (реальные запросы)
  async function login(credentials: { username: string; password: string }) {
    // Новый основной вход всегда начинает отдельную сессию пользователя.
    // Нельзя переносить в неё допуск сотрудника/руководителя по личному ПИН.
    useCrmStore().lockStaffAccess()
    try {
      isLoading.value = true
      error.value = null

      // Express API only
      const response = await $fetch<{ success?: boolean; token: string; user?: User }>('/api/admin/login', { 
        method: 'POST', 
        body: credentials 
      })

      // Normalise
      // @ts-ignore
      token.value = response.token
      // @ts-ignore
      user.value = response.user || { username: credentials.username, role: 'admin' }
      isAuthenticated.value = true
      if (typeof window !== 'undefined') localStorage.setItem('admin_token', token.value)
      void fetchIncompleteGroupsSummary()
      return { success: true, token: token.value, user: user.value as User }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function logout() {
    token.value = ''
    user.value = null
    isAuthenticated.value = false
    if (typeof window !== 'undefined') {
      localStorage.removeItem('admin_token')
    }
    useCrmStore().lockStaffAccess()
  }

  // Наблюдение, проверенное в браузере: сессия админки не переживает полную
  // перезагрузку страницы. Открываем /admin в новом окне с уже лежащим в
  // localStorage валидным admin_token — через пару секунд localStorage пуст, и
  // показывается экран входа. Запроса к пробной ручке /api/admin/banners в
  // сетевом логе при этом нет, то есть токен вычищается раньше, чем сюда
  // доходит дело. Причина не выяснена.
  //
  // Практические следствия: переход по прямой ссылке на вложенный адрес вида
  // /admin/crm/orders выкидывает на /admin, а нажатие F5 внутри панели требует
  // ввести пароль заново. Переходы по меню внутри приложения работают штатно.
  async function checkAuth() {
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null
    if (!storedToken) {
      isAuthenticated.value = false
      user.value = null
      token.value = ''
      useCrmStore().lockStaffAccess()
      return false
    }
    
    token.value = storedToken
    
    // Probe protected endpoint to verify token
    try {
      await $fetch('/api/admin/banners', { headers: { Authorization: `Bearer ${storedToken}` } })
      user.value = user.value || { username: 'admin', role: 'admin' }
      isAuthenticated.value = true
      void fetchIncompleteGroupsSummary()
      return true
    } catch (err) {
      console.warn('Protected endpoint check failed:', err)
      // Clear invalid token
      if (typeof window !== 'undefined') localStorage.removeItem('admin_token')
      isAuthenticated.value = false
      user.value = null
      token.value = ''
      useCrmStore().lockStaffAccess()
      return false
    }
  }

  // Helper for authenticated requests
  function getAuthHeaders() {
    if (!token.value) {
      throw new Error('No authentication token')
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.value}`
    }
    return { ...headers, ...getInMemoryStaffHeaders() }
  }

  // Upload files (real API): /api/admin/upload?target=...
  async function uploadFiles(files: FileList | File[], target?: string) {
    try {
      isLoading.value = true
      const fd = new FormData()
      Array.from(files).forEach(f => fd.append('files', f))
      const qs = target ? `?target=${encodeURIComponent(target)}` : ''
      const res = await $fetch<{ ok: boolean; urls: string[] }>(`/api/admin/upload${qs}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd
      })
      return res.urls
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Banner CRUD methods
  async function fetchBanners() {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Banner[]>('/api/admin/banners', {
        headers: getAuthHeaders()
      })

      banners.value = response
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function createBanner(banner: Omit<Banner, 'id' | 'order'>) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Banner>('/api/admin/banners', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: banner
      })

      banners.value.push(response)
      return response
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateBanner(id: string, updates: Partial<Banner>) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Banner>(`/api/admin/banners/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: updates
      })

      // Update local state с данными от сервера
      const index = banners.value.findIndex(b => b.id === id)
      if (index !== -1) {
        banners.value[index] = response
      }

      return banners.value[index]
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function deleteBanner(id: string) {
    try {
      isLoading.value = true
      error.value = null

      await $fetch(`/api/admin/banners/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })

      banners.value = banners.value.filter(b => b.id !== id)
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function toggleBannerStatus(id: string) {
    try {
      const banner = banners.value.find(b => b.id === id)
      if (!banner) return
      
      const newActive = banner.active === 1 ? 0 : 1
      await updateBanner(id, { active: newActive })
    } catch (err: any) {
      handleApiError(err)
      throw err
    }
  }

  async function reorderBanners(reorderedBanners: { id: string; order: number }[]) {
    try {
      isLoading.value = true
      error.value = null

      await $fetch('/api/admin/banners/reorder', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: { banners: reorderedBanners }
      })

      // Update local state
      reorderedBanners.forEach(({ id, order }) => {
        const banner = banners.value.find(b => b.id === id)
        if (banner) {
          banner.order = order
        }
      })

      // Sort by order
      banners.value.sort((a, b) => a.order - b.order)
      
      // Принудительно обновляем данные с сервера для синхронизации
      await fetchBanners()
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Category CRUD methods
  async function fetchCategories() {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Category[]>('/api/admin/categories', {
        headers: getAuthHeaders()
      })

      // Сохраняем существующие cover_image из локального состояния
      // (API не возвращает cover_image в списке для экономии трафика)
      const existingCoverImages = new Map<string, string | null>()
      categories.value.forEach(cat => {
        if (cat.cover_image) {
          existingCoverImages.set(cat.id, cat.cover_image)
        }
      })

      categories.value = response.map((category: any) => ({
        ...category,
        // Сохраняем cover_image если оно уже было загружено ранее
        cover_image: existingCoverImages.get(category.id) ?? null,
        hasCoverImage: Boolean(category.has_cover_image),
        displayMode: (category.displayMode ?? category.display_mode ?? 'default') as 'default' | 'liquid' | 'visual',
        display_mode: (category.displayMode ?? category.display_mode ?? 'default') as 'default' | 'liquid' | 'visual',
        storefrontFiltersProfile: (category.storefrontFiltersProfile ?? category.storefront_filters_profile ?? 'none') as 'none' | 'liquids' | 'snus_plates',
        storefront_filters_profile: (category.storefrontFiltersProfile ?? category.storefront_filters_profile ?? 'none') as 'none' | 'liquids' | 'snus_plates',
      }))

      // Загружаем изображения для категорий с has_cover_image=true, у которых ещё нет cover_image
      const categoriesToLoadImages = categories.value.filter(
        cat => cat.hasCoverImage && !cat.cover_image
      )
      
      if (categoriesToLoadImages.length > 0) {
        // Загружаем изображения параллельно (но не блокируем UI)
        loadCategoryImages(categoriesToLoadImages.map(c => c.id))
      }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Загрузить изображения категорий в фоне и обновить состояние
  async function loadCategoryImages(categoryIds: string[]) {
    for (const categoryId of categoryIds) {
      try {
        const coverImage = await fetchCategoryImage(categoryId)
        if (coverImage) {
          const index = categories.value.findIndex(c => c.id === categoryId)
          if (index !== -1) {
            // Обновляем массив чтобы Vue отследил изменение
            categories.value = [
              ...categories.value.slice(0, index),
              { ...categories.value[index], cover_image: coverImage },
              ...categories.value.slice(index + 1)
            ]
          }
        }
      } catch (err) {
        console.error(`Failed to load image for category ${categoryId}:`, err)
      }
    }
  }

  // Загрузить изображение категории отдельно (для редактирования)
  async function fetchCategoryImage(categoryId: string): Promise<string | null> {
    try {
      const response = await $fetch<{ cover_image: string | null }>(`/api/admin/categories/${categoryId}/image`, {
        headers: getAuthHeaders()
      })
      return response.cover_image ?? null
    } catch (err: any) {
      console.error('Failed to fetch category image:', err)
      return null
    }
  }

  // Загрузить одну категорию со всеми данными
  async function fetchCategory(categoryId: string): Promise<Category | null> {
    try {
      const response = await $fetch<any>(`/api/admin/categories/${categoryId}`, {
        headers: getAuthHeaders()
      })
      return {
        ...response,
        hasCoverImage: Boolean(response.cover_image),
        displayMode: (response.displayMode ?? response.display_mode ?? 'default') as 'default' | 'liquid' | 'visual',
        display_mode: (response.displayMode ?? response.display_mode ?? 'default') as 'default' | 'liquid' | 'visual'
      }
    } catch (err: any) {
      console.error('Failed to fetch category:', err)
      return null
    }
  }

async function createCategory(category: { name: string; hideEmpty?: boolean; coverImage?: string | null; storefrontFiltersProfile?: 'none' | 'liquids' | 'snus_plates' }) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<any>('/api/admin/categories', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: {
          name: category.name,
          hide_empty: category.hideEmpty || false,
          cover_image: category.coverImage ?? null,
          storefront_filters_profile: category.storefrontFiltersProfile ?? 'none',
        }
      })

      // Express server returns { ok: true, id, slug, name, order }
      if (response.ok && response.id) {
        console.log('[admin] Category created on server:', response)
        
        // Return the category data for the caller to use
        // The list will be refreshed by the calling component
        const displayModeValue = (response.display_mode ?? response.displayMode ?? 'default') as 'default' | 'liquid' | 'visual'

        const newCategory: Category = {
          id: response.id,
          slug: response.slug,
          name: response.name,
          order: response.order,
          productCount: 0, // новая категория, товаров пока нет
          hide_empty: response.hide_empty,
          cover_image: response.cover_image ?? null,
          display_mode: displayModeValue,
          displayMode: displayModeValue
        }
        
        return newCategory
      } else {
        throw new Error('Invalid server response format')
      }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateCategory(id: string, updates: Partial<Category>) {
    try {
      isLoading.value = true
      error.value = null

      console.log('[admin] Updating category', id, 'with:', updates)

      const payload: Record<string, unknown> = { ...updates }
      if (updates.hide_empty !== undefined && typeof updates.hide_empty === 'boolean') {
        payload.hide_empty = updates.hide_empty
      }
      if (updates.cover_image !== undefined) {
        payload.cover_image = updates.cover_image
      }

      const response = await $fetch<Record<string, any>>(`/api/admin/categories/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: payload
      })

      console.log('[admin] Update category response:', response)

      // Обновляем локальное состояние полными данными от сервера
      const index = categories.value.findIndex(c => c.id === id)
      if (index !== -1) {
        const displayModeValue = (response.displayMode ?? response.display_mode ?? 'default') as 'default' | 'liquid' | 'visual'
        const updatedCategory = {
          ...categories.value[index],
          ...response,
          display_mode: displayModeValue,
          displayMode: displayModeValue
        }
        // Заменяем весь массив чтобы Vue отследил изменение
        categories.value = [
          ...categories.value.slice(0, index),
          updatedCategory,
          ...categories.value.slice(index + 1)
        ]
        console.log('[admin] Updated local category:', updatedCategory)
      }
      return {
        ...response,
        display_mode: (response.displayMode ?? response.display_mode ?? 'default') as 'default' | 'liquid' | 'visual'
      }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function deleteCategory(id: string) {
    try {
      isLoading.value = true
      error.value = null

      await $fetch(`/api/admin/categories/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })

      categories.value = categories.value.filter(c => c.id !== id)
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function reorderCategories(reorderedCategories: { id: string; order: number }[]) {
    try {
      isLoading.value = true
      error.value = null

      console.log('🔥 [admin] reorderCategories called with:', reorderedCategories)
      const payload = { categories: reorderedCategories }
      console.log('🔥 [admin] Sending payload to server:', JSON.stringify(payload, null, 2))
      console.log('🔥 [admin] Auth headers:', getAuthHeaders())

      const response = await $fetch('/api/admin/categories/reorder', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: payload
      })
      
      console.log('🔥 [admin] Reorder response from server:', response)

      // Update local state
      reorderedCategories.forEach(({ id, order }) => {
        const category = categories.value.find(c => c.id === id)
        if (category) {
          category.order = order
        }
      })

      // Sort by order
      categories.value.sort((a, b) => a.order - b.order)
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function fetchCategoryGroups(categoryId?: string) {
    try {
      isLoading.value = true
      error.value = null

      const query = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : ''
      const response = await $fetch<Array<Record<string, any>>>(`/api/admin/category-groups${query}`, {
        headers: getAuthHeaders()
      })

      // Сохраняем существующие coverImage из локального состояния
      const existingCoverImages = new Map<string, string | null>()
      categoryGroups.value.forEach(g => {
        if (g.coverImage) {
          existingCoverImages.set(g.id, g.coverImage)
        }
      })

      const mapped = response.map(group => ({
        id: group.id,
        categoryId: group.categoryId,
        slug: group.slug,
        name: group.name,
        // Сохраняем coverImage если оно уже было загружено ранее
        coverImage: existingCoverImages.get(group.id) ?? null,
        hasCoverImage: Boolean(group.has_cover_image),
        order: Number(group.order ?? group['order'] ?? 0),
        hideEmpty: Boolean(group.hide_empty),
        parentId: group.parent_group_id ?? null,
        metaLabel: group.metaLabel ?? group.meta_label ?? null,
        metaValue: group.metaValue ?? group.meta_value ?? null,
        minStockThreshold: normalizeMinStockThreshold(group.minStockThreshold ?? group.min_stock_threshold),
        totalControl: Boolean(group.totalControl ?? group.total_control),
        isNew: Boolean(group.is_new ?? group.isNew),
        discount: group.discount ?? null,
        newDaysTotal: group.new_days_total ?? null,
        newDaysLeft: group.new_days_left ?? null,
        newSince: group.new_since ?? null,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        productCount: group.productCount ?? 0,
        totalProductCount: group.totalProductCount ?? group.productCount ?? 0,
        stockSum: group.stockSum ?? 0,
        totalStockSum: group.totalStockSum ?? group.stockSum ?? 0,
        emptySince: group.empty_since ?? null,
        averageCostAuto: group.averageCostAuto ?? group.average_cost_auto ?? null,
        directProductCount: Number(group.directProductCount ?? group.direct_product_count ?? group.productCount ?? 0),
        productsWithCostCount: Number(group.productsWithCostCount ?? group.products_with_cost_count ?? 0),
        wholesalePrices: normalizeWholesalePrices(group.wholesalePrices ?? group.wholesale_prices),
        wholesaleTiers: normalizeWholesaleTiers(group.wholesaleTiers ?? group.wholesale_tiers),
        waiveDescription: Boolean(group.waiveDescription ?? group.waive_description),
        waiveMinStock: Boolean(group.waiveMinStock ?? group.waive_min_stock),
        waiveWholesale: Boolean(group.waiveWholesale ?? group.waive_wholesale),
        waiveStrengthTier: Boolean(group.waiveStrengthTier ?? group.waive_strength_tier),
        strengthTier: group.strengthTier ?? group.strength_tier ?? null,
      })) as CategoryGroup[]

      if (categoryId) {
        categoryGroups.value = categoryGroups.value.filter(g => g.categoryId !== categoryId).concat(mapped)
      } else {
        categoryGroups.value = mapped
      }

      // Загружаем изображения для групп с hasCoverImage=true, у которых ещё нет coverImage
      const groupsToLoadImages = mapped.filter(g => g.hasCoverImage && !g.coverImage)
      if (groupsToLoadImages.length > 0) {
        loadCategoryGroupImages(groupsToLoadImages.map(g => g.id))
      }

      return mapped
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Загрузить изображения групп в фоне и обновить состояние
  async function loadCategoryGroupImages(groupIds: string[]) {
    for (const groupId of groupIds) {
      try {
        const coverImage = await fetchCategoryGroupImage(groupId)
        if (coverImage) {
          const index = categoryGroups.value.findIndex(g => g.id === groupId)
          if (index !== -1) {
            // Обновляем массив чтобы Vue отследил изменение
            categoryGroups.value = [
              ...categoryGroups.value.slice(0, index),
              { ...categoryGroups.value[index], coverImage },
              ...categoryGroups.value.slice(index + 1)
            ]
          }
        }
      } catch (err) {
        console.error(`Failed to load image for group ${groupId}:`, err)
      }
    }
  }

  // Загрузить изображение группы отдельно (для редактирования)
  async function fetchCategoryGroupImage(groupId: string): Promise<string | null> {
    try {
      const response = await $fetch<{ cover_image: string | null }>(`/api/admin/category-groups/${groupId}/image`, {
        headers: getAuthHeaders()
      })
      return response.cover_image ?? null
    } catch (err: any) {
      console.error('Failed to fetch group image:', err)
      return null
    }
  }

  // Загрузить одну группу со всеми данными
  async function fetchCategoryGroup(groupId: string): Promise<CategoryGroup | null> {
    try {
      const response = await $fetch<Record<string, any>>(`/api/admin/category-groups/${groupId}`, {
        headers: getAuthHeaders()
      })
      return {
        id: response.id,
        categoryId: response.categoryId,
        slug: response.slug,
        name: response.name,
        coverImage: response.cover_image ?? null,
        hasCoverImage: Boolean(response.cover_image),
        order: Number(response.order ?? response['order'] ?? 0),
        hideEmpty: Boolean(response.hide_empty),
        parentId: response.parent_group_id ?? null,
        metaLabel: response.metaLabel ?? response.meta_label ?? null,
        metaValue: response.metaValue ?? response.meta_value ?? null,
        minStockThreshold: normalizeMinStockThreshold(response.minStockThreshold ?? response.min_stock_threshold),
        totalControl: Boolean(response.totalControl ?? response.total_control),
        isNew: Boolean(response.is_new ?? response.isNew),
        discount: response.discount ?? null,
        newDaysTotal: response.new_days_total ?? null,
        newDaysLeft: response.new_days_left ?? null,
        newSince: response.new_since ?? null,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
        productCount: response.productCount ?? 0,
        averageCostAuto: response.averageCostAuto ?? response.average_cost_auto ?? null,
        directProductCount: Number(response.directProductCount ?? response.direct_product_count ?? response.productCount ?? 0),
        productsWithCostCount: Number(response.productsWithCostCount ?? response.products_with_cost_count ?? 0),
        wholesalePrices: normalizeWholesalePrices(response.wholesalePrices ?? response.wholesale_prices),
        wholesaleTiers: normalizeWholesaleTiers(response.wholesaleTiers ?? response.wholesale_tiers)
      }
    } catch (err: any) {
      console.error('Failed to fetch group:', err)
      return null
    }
  }

  async function fetchWholesaleLinks() {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<{ tiers?: Array<Record<string, any>> }>('/api/admin/wholesale-links', {
        headers: getAuthHeaders()
      })

      wholesaleLinks.value = (response?.tiers || []).map((tier) => ({
        id: String(tier.id),
        code: String(tier.code),
        label: String(tier.label),
        minOrderAmount: Number(tier.minOrderAmount ?? tier.min_order_amount ?? 0),
        sortOrder: Number(tier.sortOrder ?? tier.sort_order ?? 0),
        path: tier.path ?? null,
        totalTargetGroups: Number(tier.totalTargetGroups ?? tier.total_target_groups ?? 0),
        filledGroupCount: Number(tier.filledGroupCount ?? tier.filled_group_count ?? 0),
        missingGroupCount: Number(tier.missingGroupCount ?? tier.missing_group_count ?? 0),
      }))

      return wholesaleLinks.value
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function createCategoryGroup(payload: { categoryId: string; name: string; slug?: string; coverImage?: string | null; hideEmpty?: boolean; parentId?: string | null; metaLabel?: string | null; metaValue?: string | null; minStockThreshold?: number | null; totalControl?: boolean; isNew?: boolean; newDays?: number; wholesalePrices?: Record<string, number | null>; waiveDescription?: boolean; waiveMinStock?: boolean; waiveWholesale?: boolean; waiveStrengthTier?: boolean; strengthTier?: string | null }) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Record<string, any>>('/api/admin/category-groups', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: {
          categoryId: payload.categoryId,
          name: payload.name,
          slug: payload.slug,
          coverImage: payload.coverImage ?? null,
          hide_empty: payload.hideEmpty ?? false,
          parentId: payload.parentId ?? null,
          metaLabel: payload.metaLabel ?? null,
          metaValue: payload.metaValue ?? null,
          minStockThreshold: payload.minStockThreshold ?? null,
          totalControl: payload.totalControl ?? false,
          isNew: payload.isNew ?? false,
          ...(payload.newDays !== undefined ? { newDays: payload.newDays } : {}),
          wholesalePrices: payload.wholesalePrices ?? undefined,
          waiveDescription: payload.waiveDescription ?? false,
          waiveMinStock: payload.waiveMinStock ?? false,
          waiveWholesale: payload.waiveWholesale ?? false,
          waiveStrengthTier: payload.waiveStrengthTier ?? false,
          strengthTier: payload.strengthTier ?? null,
        }
      })

      const mapped: CategoryGroup = {
        id: String(response.id),
        categoryId: String(response.categoryId),
        slug: response.slug,
        name: response.name,
        coverImage: response.cover_image ?? null,
        order: Number(response.order ?? response['order'] ?? 0),
        hideEmpty: Boolean(response.hide_empty),
        parentId: response.parent_group_id ?? null,
        metaLabel: response.metaLabel ?? response.meta_label ?? null,
        metaValue: response.metaValue ?? response.meta_value ?? null,
        minStockThreshold: normalizeMinStockThreshold(response.minStockThreshold ?? response.min_stock_threshold),
        totalControl: Boolean(response.totalControl ?? response.total_control),
        isNew: Boolean(response.is_new ?? response.isNew),
        discount: response.discount ?? null,
        newDaysTotal: response.new_days_total ?? null,
        newDaysLeft: response.new_days_left ?? null,
        newSince: response.new_since ?? null,
        waiveDescription: Boolean(response.waiveDescription ?? response.waive_description),
        waiveMinStock: Boolean(response.waiveMinStock ?? response.waive_min_stock),
        waiveWholesale: Boolean(response.waiveWholesale ?? response.waive_wholesale),
        waiveStrengthTier: Boolean(response.waiveStrengthTier ?? response.waive_strength_tier),
        strengthTier: response.strengthTier ?? response.strength_tier ?? null,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
        productCount: response.productCount ?? 0,
        totalProductCount: response.totalProductCount ?? response.productCount ?? 0,
        averageCostAuto: response.averageCostAuto ?? response.average_cost_auto ?? null,
        directProductCount: Number(response.directProductCount ?? response.direct_product_count ?? response.productCount ?? 0),
        productsWithCostCount: Number(response.productsWithCostCount ?? response.products_with_cost_count ?? 0),
        wholesalePrices: normalizeWholesalePrices(response.wholesalePrices ?? response.wholesale_prices),
        wholesaleTiers: normalizeWholesaleTiers(response.wholesaleTiers ?? response.wholesale_tiers)
      }

      categoryGroups.value = categoryGroups.value.filter(g => g.id !== mapped.id).concat(mapped)
      categoryGroups.value.sort((a, b) => a.order - b.order)

      return mapped
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateCategoryGroup(
    id: string,
    updates: Omit<Partial<CategoryGroup>, 'discount'> & {
      newDays?: number
      discount?: { price: number | null; untilDate: string | null }
    },
  ) {
    try {
      isLoading.value = true
      error.value = null

      // КРИТИЧНО: шлём только переданные поля (PATCH-семантика). Раньше
      // все поля резолвились как `updates.coverImage ?? null` — и при
      // вызове updateCategoryGroup(id, {minStockThreshold: 2}) фронт
      // отправлял coverImage=null, parentId=null → бэкенд их обнулял.
      // Так Костя 9.05.2026 потерял обложки и parent у PODONKI V1/V2/VINTAGE.
      // Бэкенд проверяет наличие поля через `'coverImage' in req.body`,
      // поэтому ключ передаём только когда это намеренно делаем.
      const body: Record<string, unknown> = {}
      if ('name' in updates) body.name = updates.name
      if ('slug' in updates) body.slug = updates.slug
      if ('coverImage' in updates) body.coverImage = updates.coverImage ?? null
      if ('hideEmpty' in updates) body.hide_empty = updates.hideEmpty
      if ('order' in updates) body.order = updates.order
      if ('parentId' in updates) body.parentId = updates.parentId ?? null
      if ('metaLabel' in updates) body.metaLabel = updates.metaLabel ?? null
      if ('metaValue' in updates) body.metaValue = updates.metaValue ?? null
      if ('minStockThreshold' in updates) body.minStockThreshold = updates.minStockThreshold ?? null
      if ('totalControl' in updates) body.totalControl = updates.totalControl
      if ('isNew' in updates) body.isNew = updates.isNew
      if ('newDays' in updates) body.newDays = updates.newDays
      if ('discount' in updates) body.discount = updates.discount
      if ('wholesalePrices' in updates) body.wholesalePrices = updates.wholesalePrices
      if ('waiveDescription' in updates) body.waiveDescription = updates.waiveDescription
      if ('waiveMinStock' in updates) body.waiveMinStock = updates.waiveMinStock
      if ('waiveWholesale' in updates) body.waiveWholesale = updates.waiveWholesale
      if ('waiveStrengthTier' in updates) body.waiveStrengthTier = updates.waiveStrengthTier
      if ('strengthTier' in updates) body.strengthTier = updates.strengthTier ?? null

      const response = await $fetch<Record<string, any>>(`/api/admin/category-groups/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body
      })

      // ВАЖНО: PUT /api/admin/category-groups/:id возвращает не все поля,
      // которые есть на фронте. В частности отсутствуют stockSum,
      // totalStockSum, emptySince, hasCoverImage. Если просто заменить
      // запись на mapped — эти поля станут undefined, линейка опустится
      // вниз списка через сортировку «пустых», и пользователь решит, что
      // она исчезла (Костя 9.05.2026 v7). Поэтому делаем merge с существующей.
      const idx = categoryGroups.value.findIndex(g => g.id === id)
      const existing = idx !== -1 ? categoryGroups.value[idx] : null
      const mapped: CategoryGroup = {
        ...(existing ?? {} as CategoryGroup),
        id: String(response.id),
        categoryId: String(response.categoryId),
        slug: response.slug,
        name: response.name,
        coverImage: response.cover_image ?? existing?.coverImage ?? null,
        hasCoverImage: Boolean(response.cover_image ?? existing?.coverImage),
        order: Number(response.order ?? response['order'] ?? existing?.order ?? 0),
        hideEmpty: Boolean(response.hide_empty),
        parentId: response.parent_group_id ?? null,
        isNew: Boolean(response.is_new ?? response.isNew),
        discount: response.discount ?? null,
        newDaysTotal: response.new_days_total ?? null,
        newDaysLeft: response.new_days_left ?? null,
        newSince: response.new_since ?? null,
        metaLabel: response.metaLabel ?? response.meta_label ?? null,
        metaValue: response.metaValue ?? response.meta_value ?? null,
        minStockThreshold: normalizeMinStockThreshold(response.minStockThreshold ?? response.min_stock_threshold),
        totalControl: Boolean(response.totalControl ?? response.total_control ?? existing?.totalControl),
        createdAt: response.createdAt ?? existing?.createdAt,
        updatedAt: response.updatedAt ?? existing?.updatedAt,
        productCount: response.productCount ?? existing?.productCount ?? 0,
        totalProductCount: response.totalProductCount ?? response.productCount ?? existing?.totalProductCount ?? 0,
        averageCostAuto: response.averageCostAuto ?? response.average_cost_auto ?? existing?.averageCostAuto ?? null,
        directProductCount: Number(response.directProductCount ?? response.direct_product_count ?? response.productCount ?? existing?.directProductCount ?? 0),
        productsWithCostCount: Number(response.productsWithCostCount ?? response.products_with_cost_count ?? existing?.productsWithCostCount ?? 0),
        wholesalePrices: normalizeWholesalePrices(response.wholesalePrices ?? response.wholesale_prices),
        wholesaleTiers: normalizeWholesaleTiers(response.wholesaleTiers ?? response.wholesale_tiers),
        waiveDescription: Boolean(response.waiveDescription ?? response.waive_description ?? existing?.waiveDescription),
        waiveMinStock: Boolean(response.waiveMinStock ?? response.waive_min_stock ?? existing?.waiveMinStock),
        waiveWholesale: Boolean(response.waiveWholesale ?? response.waive_wholesale ?? existing?.waiveWholesale),
        waiveStrengthTier: Boolean(response.waiveStrengthTier ?? response.waive_strength_tier ?? existing?.waiveStrengthTier),
        strengthTier: response.strengthTier ?? response.strength_tier ?? existing?.strengthTier ?? null,
      }

      if (idx !== -1) {
        categoryGroups.value = [
          ...categoryGroups.value.slice(0, idx),
          mapped,
          ...categoryGroups.value.slice(idx + 1)
        ]
      } else {
        categoryGroups.value = [...categoryGroups.value, mapped]
      }
      categoryGroups.value = [...categoryGroups.value].sort((a, b) => a.order - b.order)

      void fetchIncompleteGroupsSummary()
      return mapped
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function fetchIncompleteGroups() {
    try {
      const data = await $fetch<{ items: IncompleteGroupItem[] }>(
        '/api/admin/category-groups/incomplete',
        { headers: getAuthHeaders() },
      )
      incompleteGroups.value = Array.isArray(data?.items) ? data.items : []
      incompleteGroupsCount.value = incompleteGroups.value.length
      incompleteGroupsHasAny.value = incompleteGroups.value.length > 0
      return incompleteGroups.value
    } catch (err: any) {
      console.warn('[admin] Failed to fetch incomplete groups:', err)
      return incompleteGroups.value
    }
  }

  async function fetchIncompleteGroupsSummary() {
    try {
      const data = await $fetch<{ hasAny: boolean; count: number }>(
        '/api/admin/category-groups/incomplete/summary',
        { headers: getAuthHeaders() },
      )
      incompleteGroupsHasAny.value = Boolean(data?.hasAny)
      incompleteGroupsCount.value = Number(data?.count ?? 0)
      return data
    } catch (err: any) {
      console.warn('[admin] Failed to fetch incomplete groups summary:', err)
      return { hasAny: incompleteGroupsHasAny.value, count: incompleteGroupsCount.value }
    }
  }

  async function updateGroupCompletenessWaivers(
    groupId: string,
    waivers: {
      waiveDescription?: boolean
      waiveMinStock?: boolean
      waiveWholesale?: boolean
      waiveStrengthTier?: boolean
    },
  ) {
    await $fetch(`/api/admin/category-groups/${groupId}/completeness-waivers`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: {
        waiveDescription: waivers.waiveDescription,
        waiveMinStock: waivers.waiveMinStock,
        waiveWholesale: waivers.waiveWholesale,
        waiveStrengthTier: waivers.waiveStrengthTier,
      },
    })

    const idx = categoryGroups.value.findIndex((g) => g.id === groupId)
    if (idx !== -1) {
      const current = categoryGroups.value[idx]
      categoryGroups.value = [
        ...categoryGroups.value.slice(0, idx),
        {
          ...current,
          waiveDescription:
            waivers.waiveDescription !== undefined
              ? waivers.waiveDescription
              : current.waiveDescription,
          waiveMinStock:
            waivers.waiveMinStock !== undefined ? waivers.waiveMinStock : current.waiveMinStock,
          waiveWholesale:
            waivers.waiveWholesale !== undefined
              ? waivers.waiveWholesale
              : current.waiveWholesale,
          waiveStrengthTier:
            waivers.waiveStrengthTier !== undefined
              ? waivers.waiveStrengthTier
              : current.waiveStrengthTier,
        },
        ...categoryGroups.value.slice(idx + 1),
      ]
    }
  }

  async function deleteCategoryGroup(id: string) {
    try {
      isLoading.value = true
      error.value = null

      await $fetch(`/api/admin/category-groups/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })

      categoryGroups.value = categoryGroups.value.filter(g => g.id !== id)
      // Обновляем продукты, у которых мог быть установлен groupId
      products.value = products.value.map(p => p.groupId === id ? { ...p, groupId: null, groupName: undefined, groupSlug: undefined } : p)
      if (currentProduct.value?.groupId === id) {
        currentProduct.value = { ...currentProduct.value, groupId: null, groupName: undefined, groupSlug: undefined }
      }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function reorderCategoryGroups(items: { id: string; order: number }[]) {
    try {
      isLoading.value = true
      error.value = null

      await $fetch('/api/admin/category-groups/reorder', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: { groups: items }
      })

      items.forEach(({ id, order }) => {
        const group = categoryGroups.value.find(g => g.id === id)
        if (group) {
          group.order = order
        }
      })
      categoryGroups.value.sort((a, b) => a.order - b.order)
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function fetchCategoryCrossSells(categoryId: string) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Product[]>(`/api/admin/categories/${categoryId}/cross-sells`, {
        headers: getAuthHeaders()
      })

      categoryCrossSells.value = { ...categoryCrossSells.value, [categoryId]: response }
      return response
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateCategoryCrossSells(categoryId: string, productIds: string[]) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Product[]>(`/api/admin/categories/${categoryId}/cross-sells`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { productIds }
      })

      categoryCrossSells.value = { ...categoryCrossSells.value, [categoryId]: response }
      return response
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Product CRUD methods
  async function fetchProducts(options: {
    page?: number
    limit?: number
    category?: string
    search?: string
    group?: string
    location?: 'retail' | 'warehouse'
  } = {}) {
    const requestId = ++latestProductsRequestId
    const location = options.location ?? 'retail'
    productsLocation.value = location
    try {
      isLoading.value = true
      error.value = null

      const params = new URLSearchParams()
      if (options.page) params.set('page', options.page.toString())
      if (options.limit) params.set('limit', options.limit.toString())
      if (options.category) params.set('category', options.category)
      if (options.search) params.set('search', options.search)
      if (options.group) params.set('group', options.group)
      params.set('location', location)

      const response = await $fetch<ProductsResponse>(`/api/admin/products?${params}`, {
        headers: getAuthHeaders()
      })

      if (requestId !== latestProductsRequestId) {
        return
      }
      products.value = response.products.map(normalizeProductData)
      availableProductGroups.value = Array.isArray(response.availableGroups)
        ? response.availableGroups
        : []
      productsPagination.value = response.pagination
    } catch (err: any) {
      if (requestId !== latestProductsRequestId) {
        return
      }
      handleApiError(err)
      throw err
    } finally {
      if (requestId === latestProductsRequestId) {
        isLoading.value = false
      }
    }
  }

  async function fetchInventoryItems(options: {
    location: 'retail' | 'warehouse'
    search?: string
    groupId?: string
    limit?: number
  }) {
    const params = new URLSearchParams({
      location: options.location,
      limit: String(options.limit ?? 100),
    })
    if (options.search) params.set('search', options.search)
    if (options.groupId) params.set('group_id', options.groupId)
    return await $fetch<any[]>(`/api/admin/inventory/items?${params}`, {
      headers: getAuthHeaders(),
    })
  }

  async function fetchProductOptions(limit = 100) {
    const params = new URLSearchParams({
      page: '1',
      limit: String(limit),
      location: 'retail',
    })
    const response = await $fetch<ProductsResponse>(`/api/admin/products?${params}`, {
      headers: getAuthHeaders(),
    })
    return response.products.map(normalizeProductData)
  }

  /** Линейки, которые лежат на складе: быстрый фильтр в заявке на перемещение. */
  async function fetchInventoryGroups() {
    return await $fetch<Array<{ id: string; name: string; categoryId: string }>>(
      '/api/admin/inventory/groups',
      { headers: getAuthHeaders() },
    )
  }

  async function createInventoryTransfer(data: {
    idempotency_key?: string
    source_location: 'retail' | 'warehouse'
    destination_location: 'retail' | 'warehouse'
    comment?: string
    actor_employee_id?: string
    actor_pin?: string
    items: Array<{ product_id: string; variant_id?: string | null; quantity: number }>
  }) {
    const { idempotency_key, ...body } = data
    const pending = pendingAdminMutationKey('transfer.create', body)
    const result = await $fetch<any>(
      '/api/admin/inventory/transfers',
      {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Idempotency-Key': idempotency_key || pending.key,
        },
        body,
      },
    )
    pendingAdminMutationKeys.delete(pending.signature)
    return result
  }

  /**
   * Правка черновика. Направления в сигнатуре нет намеренно: сервер берёт его
   * из самой заявки, и случайно развернуть перемещение отсюда нельзя.
   *
   * Ключ идемпотентности не шлём: правка передаёт состав целиком, повтор
   * применяет то же состояние, а сервер этот заголовок не читает.
   */
  async function updateInventoryTransfer(
    id: string,
    data: {
      comment?: string
      /** Время последней правки заявки: защищает от затирания чужих изменений. */
      expected_updated_at?: string | null
      actor_employee_id?: string
      actor_pin?: string
      items: Array<{ product_id: string; variant_id?: string | null; quantity: number }>
    },
  ) {
    return await $fetch<any>(`/api/admin/inventory/transfers/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: data,
    })
  }

  async function fetchInventoryTransfers(options: { page?: number; limit?: number } = {}) {
    const params = new URLSearchParams({
      page: String(options.page ?? 1),
      limit: String(options.limit ?? 30),
    })
    return await $fetch<any>(`/api/admin/inventory/transfers?${params}`, {
      headers: getAuthHeaders(),
    })
  }

  async function fetchInventoryTransfer(id: string) {
    return await $fetch<any>(`/api/admin/inventory/transfers/${id}`, {
      headers: getAuthHeaders(),
    })
  }

  async function completeInventoryTransfer(
    id: string,
    actor: {
      actor_employee_id?: string
      actor_pin?: string
      idempotency_key?: string
    } = {},
  ) {
    const { idempotency_key, ...body } = actor
    return await $fetch<any>(`/api/admin/inventory/transfers/${id}/complete`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Idempotency-Key': idempotency_key || clientRequestKey(),
      },
      body,
    })
  }

  async function cancelInventoryTransfer(
    id: string,
    actor: {
      actor_employee_id?: string
      actor_pin?: string
    } = {},
  ) {
    return await $fetch<any>(`/api/admin/inventory/transfers/${id}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: actor,
    })
  }

  async function fetchProduct(id: string) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Product>(`/api/admin/products/${id}`, {
        headers: getAuthHeaders()
      })

      const normalized = normalizeProductData(response)
      currentProduct.value = normalized
      return normalized
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function createProduct(product: Omit<Product, 'id' | 'createdAt' | 'categoryName'>) {
    try {
      isLoading.value = true
      error.value = null

      console.log('[admin] Creating product with data:', product)
      
      const payload: Record<string, any> = {
        categoryId: product.categoryId,
        groupId: product.groupId ?? null,
        title: product.title,
        priceRub: product.priceRub,
        description: product.description,
        images: product.images,
        links: product.links,
        strength: product.strength ?? null,
        cost_price: product.costPrice ?? 0,
        stock: product.stock ?? 0,
        min_stock: product.minStock ?? 0,
        useCategoryImage: product.useCategoryImage ?? false,
        hasVariants: product.hasVariants ?? false
      }
      
      // Добавляем варианты если есть
      if (product.hasVariants && product.variants) {
        payload.variants = product.variants
      }

      const response = await $fetch<{ ok: boolean; id: string; product: Product }>('/api/admin/products', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: payload
      })

      console.log('[admin] Product creation response:', response)
      
      // Use the product data returned from server (includes processed images)
      const createdProduct = normalizeProductData(response.product)
      
      products.value.unshift(createdProduct)
      productsPagination.value.total++
      return createdProduct
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateProduct(id: string, updates: Partial<Product>) {
    try {
      isLoading.value = true
      error.value = null

      const payload: Record<string, any> = { ...updates }

      if (updates.groupId !== undefined) {
        payload.groupId = updates.groupId ?? null
      }

      if (updates.costPrice !== undefined) {
        payload.cost_price = updates.costPrice
        delete payload.costPrice
      }

      if (updates.minStock !== undefined) {
        payload.min_stock = updates.minStock
        delete payload.minStock
      }
      
      // Поддержка вариантов
      if (updates.hasVariants !== undefined) {
        payload.hasVariants = updates.hasVariants
      }
      
      if (updates.variants !== undefined) {
        // Передаем варианты с colorDisplayMode
        payload.variants = updates.variants.map(v => ({
          ...v,
          colorDisplayMode: v.colorDisplayMode || 'color'
        }))
      }
      
      if (updates.useCategoryImage !== undefined) {
        payload.useCategoryImage = updates.useCategoryImage
      }

      await $fetch(`/api/admin/products/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: payload
      })
      
      // Update local state
      const index = products.value.findIndex(p => p.id === id)
      if (index !== -1) {
        products.value[index] = { ...products.value[index], ...updates }
      }

      if (currentProduct.value?.id === id) {
        currentProduct.value = { ...currentProduct.value, ...updates }
      }

    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function deleteProduct(id: string) {
    try {
      isLoading.value = true
      error.value = null

      await $fetch(`/api/admin/products/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })

      products.value = products.value.filter(p => p.id !== id)
      productsPagination.value.total--

      if (currentProduct.value?.id === id) {
        currentProduct.value = null
      }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Batch operations for products
  async function batchDeleteProducts(ids: string[]) {
    try {
      isLoading.value = true
      error.value = null

      // TODO: Здесь можно реализовать более эффективный batch endpoint
      // Пока же используем параллельные запросы
      await Promise.all(ids.map(id => 
        $fetch(`/api/admin/products/${id}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        })
      ))

      // Обновляем локальное состояние
      products.value = products.value.filter(p => !ids.includes(p.id))
      productsPagination.value.total -= ids.length

      if (currentProduct.value && ids.includes(currentProduct.value.id)) {
        currentProduct.value = null
      }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function batchUpdateProducts(updates: Array<{ id: string; data: Partial<Product> }>) {
    try {
      isLoading.value = true
      error.value = null

      // TODO: Здесь можно реализовать более эффективный batch endpoint
      await Promise.all(updates.map(({ id, data }) => 
        $fetch(`/api/admin/products/${id}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: {
            ...data,
            groupId: data.groupId === undefined ? undefined : (data.groupId ?? null)
          }
        })
      ))

      // Обновляем локальное состояние
      updates.forEach(({ id, data }) => {
        const product = products.value.find(p => p.id === id)
        if (product) {
          Object.assign(product, data)
        }
        
        if (currentProduct.value?.id === id) {
          Object.assign(currentProduct.value, data)
        }
      })
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function reorderProductImages(productId: string, images: string[]) {
    try {
      isLoading.value = true
      error.value = null

      await $fetch(`/api/admin/products/${productId}/images/reorder`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: { urls: images }
      })

      // Update local state
      const product = products.value.find(p => p.id === productId)
      if (product) {
        product.images = images
      }

      if (currentProduct.value?.id === productId) {
        currentProduct.value.images = images
      }

    return images
  } catch (err: any) {
    handleApiError(err)
    throw err
  } finally {
    isLoading.value = false
  }
}

  // Password change method
  async function changePassword(currentPassword: string, newPassword: string) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<{ ok: boolean }>('/api/admin/password', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: {
          currentPassword,
          newPassword
        }
      })

      if (response.ok) {
        return { success: true }
      } else {
        throw new Error('Password change failed')
      }
    } catch (err: any) {
      // Handle specific error cases
      if (err.data?.error === 'invalid_current_password') {
        setError('Неверный текущий пароль')
      } else if (err.data?.error === 'missing') {
        setError('Не указаны все необходимые поля')
      } else {
        handleApiError(err)
      }
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Settings methods
  async function fetchSettings() {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<Record<string, string>>('/api/admin/settings', {
        headers: getAuthHeaders()
      })

      settings.value = response
      return response
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateSettings(newSettings: Record<string, string>) {
    try {
      isLoading.value = true
      error.value = null

      const response = await $fetch<{ ok: boolean; settings: Record<string, string> }>('/api/admin/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: { settings: newSettings }
      })

      if (response.ok) {
        settings.value = { ...settings.value, ...newSettings }
        return response.settings
      } else {
        throw new Error('Failed to update settings')
      }
    } catch (err: any) {
      handleApiError(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateProfitPassword(params: { currentPassword?: string; newPassword: string }) {
    try {
      error.value = null

      const payload: Record<string, string> = { newPassword: params.newPassword }
      if (params.currentPassword) {
        payload.currentPassword = params.currentPassword
      }

      const response = await $fetch<{ ok: boolean }>('/api/admin/settings/profit-password', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: payload
      })

      if (!response.ok) {
        throw new Error('Failed to update profit password')
      }

      return { success: true }
    } catch (err: any) {
      if (err?.data?.error === 'invalid_current_password') {
        setError('Неверный текущий пароль')
      } else if (err?.data?.error === 'missing_current_password') {
        setError('Укажите текущий пароль')
      } else if (err?.data?.error === 'password_too_short') {
        setError('Новый пароль должен быть не короче 4 символов')
      } else if (err?.data?.error === 'missing_new_password') {
        setError('Укажите новый пароль')
      } else {
        handleApiError(err)
      }
      throw err
    }
  }

  // Clear methods
  function clearError() {
    error.value = null
  }

  function clearProducts() {
    products.value = []
    currentProduct.value = null
    productsPagination.value = {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0
    }
  }

  // Verify token (if present)
  async function verifyToken() {
    try {
      const tokenInStorage = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null
      if (!tokenInStorage) {
        isAuthenticated.value = false
        user.value = null
        token.value = ''
        useCrmStore().lockStaffAccess()
        return false
      }
      token.value = tokenInStorage
      const res = await $fetch<{ valid: boolean; user: { username: string; role: string } }>('/api/admin/auth/verify', {
        method: 'POST',
        headers: getAuthHeaders()
      })
      if (res.valid) {
        user.value = res.user
        isAuthenticated.value = true
        return true
      }
      isAuthenticated.value = false
      user.value = null
      token.value = ''
      useCrmStore().lockStaffAccess()
      return false
    } catch (err) {
      // invalid token
      if (typeof window !== 'undefined') localStorage.removeItem('admin_token')
      isAuthenticated.value = false
      user.value = null
      token.value = ''
      useCrmStore().lockStaffAccess()
      return false
    }
  }

  // Initialize method
  async function initialize() {
    // Try to verify existing token
    const isValid = await verifyToken()
    if (isValid) {
      // Load initial data
      try {
        await Promise.all([
          fetchBanners(),
          fetchCategories(),
          fetchProducts()
        ])
      } catch (err) {
        // Non-critical errors during initialization
        console.warn('Failed to load some initial data:', err)
      }
    }
  }

  return {
    // State
    isAuthenticated,
    user,
    token,
    banners,
    categories,
    products,
    currentProduct,
    categoryGroups,
    availableProductGroups,
    categoryCrossSells,
    wholesaleLinks,
    settings,
    incompleteGroups,
    incompleteGroupsHasAny,
    incompleteGroupsCount,
    isLoading,
    error,
    productsPagination,
    productsLocation,

    // Computed
    isLoggedIn,

    // Auth methods
    login,
    logout,
    checkAuth,
    verifyToken,

    // Banner methods
    fetchBanners,
    createBanner,
    updateBanner,
    deleteBanner,
    toggleBannerStatus,
    reorderBanners,

    // Category methods
    fetchCategories,
    fetchCategory,
    fetchCategoryImage,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    fetchCategoryGroups,
    fetchCategoryGroup,
    fetchCategoryGroupImage,
    fetchWholesaleLinks,
    createCategoryGroup,
    updateCategoryGroup,
    deleteCategoryGroup,
    reorderCategoryGroups,
    fetchIncompleteGroups,
    fetchIncompleteGroupsSummary,
    updateGroupCompletenessWaivers,
    fetchCategoryCrossSells,
    updateCategoryCrossSells,

    // Product methods
    fetchProducts,
    fetchProductOptions,
    fetchInventoryItems,
    createInventoryTransfer,
    updateInventoryTransfer,
    fetchInventoryGroups,
    fetchInventoryTransfers,
    fetchInventoryTransfer,
    completeInventoryTransfer,
    cancelInventoryTransfer,
    fetchProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    batchDeleteProducts,
    batchUpdateProducts,
    reorderProductImages,

    // Upload
    uploadFiles,

    // Settings methods
    fetchSettings,
    updateSettings,
    updateProfitPassword,

    // Password management
    changePassword,

    // Utility methods
    clearError,
    clearProducts,
    initialize
  }
})
