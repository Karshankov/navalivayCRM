import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

interface User {
  username: string
  role: string
}

interface Banner {
  id: string
  title: string
  description?: string
  imageUrl: string
  linkUrl?: string
  isActive: boolean
  order: number
}

interface Category {
  id: string
  slug: string
  name: string
  description?: string
  order: number
  productCount?: number
}

interface ProductLink {
  label?: string
  url: string
}

interface Product {
  id: string
  categoryId: string
  categoryName?: string
  title: string
  priceRub: number
  description: string
  images: string[]
  links?: ProductLink[]
  createdAt: string
  strength?: string | null
  costPrice?: number
  stock?: number
  minStock?: number
}
// Mock data
const mockBanners: Banner[] = [
  { id: '1', title: 'Летняя распродажа', description: 'Скидки до 50%', imageUrl: 'https://via.placeholder.com/800x300/4f46e5/ffffff?text=Летняя+распродажа', linkUrl: '/sale', isActive: true, order: 1 },
  { id: '2', title: 'Новая коллекция', description: 'Модные толстовки 2024', imageUrl: 'https://via.placeholder.com/800x300/059669/ffffff?text=Новая+коллекция', linkUrl: '/new', isActive: false, order: 2 },
  { id: '3', title: 'Бесплатная доставка', description: 'При заказе от 3000₽', imageUrl: 'https://via.placeholder.com/800x300/dc2626/ffffff?text=Бесплатная+доставка', linkUrl: '/delivery', isActive: true, order: 3 }
]

const mockCategories: Category[] = [
  { id: '1', slug: 'hoodies', name: 'Толстовки', description: 'Комфортные толстовки для любого сезона', order: 1, productCount: 12 },
  { id: '2', slug: 'sweatshirts', name: 'Свитшоты', description: 'Стильные свитшоты без капюшона', order: 2, productCount: 8 },
  { id: '3', slug: 'accessories', name: 'Аксессуары', description: 'Дополни образ стильными аксессуарами', order: 3, productCount: 5 },
  { id: '4', slug: 't-shirts', name: 'Футболки', description: 'Базовые и дизайнерские футболки', order: 4, productCount: 15 }
]

const mockProducts: Product[] = [
  { id: '1', categoryId: '1', categoryName: 'Толстовки', title: 'Классическая толстовка', priceRub: 2500, description: 'Удобная толстовка из 100% хлопка', images: ['https://via.placeholder.com/400x400/4f46e5/ffffff?text=Толстовка'], createdAt: new Date().toISOString() },
  { id: '2', categoryId: '1', categoryName: 'Толстовки', title: 'Толстовка с капюшоном', priceRub: 2800, description: 'Стильная толстовка с большим капюшоном', images: ['https://via.placeholder.com/400x400/059669/ffffff?text=Худи'], createdAt: new Date().toISOString() },
  { id: '3', categoryId: '2', categoryName: 'Свитшоты', title: 'Базовый свитшот', priceRub: 2200, description: 'Минималистичный свитшот на каждый день', images: ['https://via.placeholder.com/400x400/dc2626/ffffff?text=Свитшот'], createdAt: new Date().toISOString() },
  { id: '4', categoryId: '3', categoryName: 'Аксессуары', title: 'Бейсболка', priceRub: 800, description: 'Стильная кепка с вышивкой', images: ['https://via.placeholder.com/400x400/7c3aed/ffffff?text=Кепка'], createdAt: new Date().toISOString() }
]

export const useAdminStore = defineStore('admin', () => {
  // Authentication state
  const isAuthenticated = ref(false)
  const user = ref<User | null>(null)
  const token = ref('')

  // Data state  
  const banners = ref<Banner[]>([...mockBanners])
  const categories = ref<Category[]>([...mockCategories])
  const products = ref<Product[]>([...mockProducts])

  // UI state
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Pagination state
  const productsPagination = ref({
    page: 1,
    limit: 20,
    total: mockProducts.length,
    totalPages: Math.ceil(mockProducts.length / 20)
  })

  // Utilities
  function setError(message: string) {
    error.value = message
    setTimeout(() => {
      error.value = null
    }, 5000)
  }

  async function simulateDelay(ms = 500) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  // Authentication methods
  async function login(credentials: { username: string; password: string }) {
    try {
      isLoading.value = true
      error.value = null

      await simulateDelay(1000) // Simulate network delay

      if (credentials.username === 'admin' && credentials.password === 'admin') {
        const mockToken = 'mock-admin-token-' + Date.now()
        const mockUser: User = { username: 'admin', role: 'admin' }
        
        token.value = mockToken
        user.value = mockUser
        isAuthenticated.value = true

        // Store token in localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('admin_token', mockToken)
        }

        return { success: true, token: mockToken, user: mockUser }
      } else {
        throw new Error('Неверный логин или пароль')
      }
    } catch (err: any) {
      setError(err.message)
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
  }

  async function checkAuth() {
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null
    if (!storedToken) {
      isAuthenticated.value = false
      return false
    }

    // Mock token verification
    if (storedToken.startsWith('mock-admin-token-')) {
      token.value = storedToken
      user.value = { username: 'admin', role: 'admin' }
      isAuthenticated.value = true
      return true
    }

    // Invalid token
    if (typeof window !== 'undefined') {
      localStorage.removeItem('admin_token')
    }
    isAuthenticated.value = false
    return false
  }

  // Banner CRUD methods
  async function fetchBanners() {
    try {
      isLoading.value = true
      await simulateDelay()
      // Data already loaded in mock
    } catch (err: any) {
      setError('Ошибка загрузки баннеров')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function createBanner(bannerData: Omit<Banner, 'id' | 'order'>) {
    try {
      isLoading.value = true
      await simulateDelay()

      const newBanner: Banner = {
        id: 'banner_' + Date.now(),
        ...bannerData,
        order: Math.max(...banners.value.map(b => b.order), 0) + 1
      }

      banners.value.push(newBanner)
      return newBanner
    } catch (err: any) {
      setError('Ошибка создания баннера')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateBanner(id: string, updates: Partial<Banner>) {
    try {
      isLoading.value = true
      await simulateDelay()

      const index = banners.value.findIndex(b => b.id === id)
      if (index !== -1) {
        banners.value[index] = { ...banners.value[index], ...updates }
        return banners.value[index]
      }
      throw new Error('Баннер не найден')
    } catch (err: any) {
      setError('Ошибка обновления баннера')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function deleteBanner(id: string) {
    try {
      isLoading.value = true
      await simulateDelay()

      banners.value = banners.value.filter(b => b.id !== id)
    } catch (err: any) {
      setError('Ошибка удаления баннера')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function toggleBannerStatus(id: string) {
    try {
      const banner = banners.value.find(b => b.id === id)
      if (banner) {
        banner.isActive = !banner.isActive
      }
    } catch (err: any) {
      setError('Ошибка изменения статуса баннера')
      throw err
    }
  }

  async function reorderBanners(reorderedBanners: { id: string; order: number }[]) {
    try {
      isLoading.value = true
      await simulateDelay()

      reorderedBanners.forEach(({ id, order }) => {
        const banner = banners.value.find(b => b.id === id)
        if (banner) {
          banner.order = order
        }
      })

      banners.value.sort((a, b) => a.order - b.order)
    } catch (err: any) {
      setError('Ошибка изменения порядка баннеров')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Category CRUD methods
  async function fetchCategories() {
    try {
      isLoading.value = true
      await simulateDelay()
      // Data already loaded in mock
    } catch (err: any) {
      setError('Ошибка загрузки категорий')
      throw err
    } finally {
      isLoading.value = false
    }
  }

async function createCategory(categoryData: { name: string; description?: string }) {
    try {
      isLoading.value = true
      await simulateDelay()

      const newCategory: Category = {
        id: 'cat_' + Date.now(),
        slug: (categoryData.name || '')
          .toLowerCase()
          .replace(/[а-яё]/g, (m) => ({'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'} as any)[m] || m)
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
        name: categoryData.name,
        description: categoryData.description,
        order: Math.max(...categories.value.map(c => c.order), 0) + 1,
        productCount: 0
      }

      categories.value.push(newCategory)
      return newCategory
    } catch (err: any) {
      setError('Ошибка создания категории')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateCategory(id: string, updates: Partial<Category>) {
    try {
      isLoading.value = true
      await simulateDelay()

      const index = categories.value.findIndex(c => c.id === id)
      if (index !== -1) {
        categories.value[index] = { ...categories.value[index], ...updates }
        return categories.value[index]
      }
      throw new Error('Категория не найдена')
    } catch (err: any) {
      setError('Ошибка обновления категории')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function deleteCategory(id: string) {
    try {
      isLoading.value = true
      await simulateDelay()

      categories.value = categories.value.filter(c => c.id !== id)
    } catch (err: any) {
      setError('Ошибка удаления категории')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function reorderCategories(reorderedCategories: { id: string; order: number }[]) {
    try {
      isLoading.value = true
      await simulateDelay()

      reorderedCategories.forEach(({ id, order }) => {
        const category = categories.value.find(c => c.id === id)
        if (category) {
          category.order = order
        }
      })

      categories.value.sort((a, b) => a.order - b.order)
    } catch (err: any) {
      setError('Ошибка изменения порядка категорий')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Upload (mock): вернёт blob-URL'ы для предпросмотра
  async function uploadFiles(files: FileList | File[], _target?: string) {
    const list = Array.from(files)
    return list.map(f => URL.createObjectURL(f))
  }

  // Product methods (basic)
  async function fetchProducts(params: { page?: number; limit?: number } = {}) {
    try {
      isLoading.value = true
      await simulateDelay()

      const page = params.page || 1
      const limit = params.limit || 20
      
      productsPagination.value = {
        page,
        limit,
        total: mockProducts.length,
        totalPages: Math.ceil(mockProducts.length / limit)
      }
    } catch (err: any) {
      setError('Ошибка загрузки товаров')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function reorderProductImages(productId: string, imagesNew: string[]) {
    try {
      isLoading.value = true
      await simulateDelay()
      const p = products.value.find(p => p.id === productId)
      if (!p) throw new Error('Товар не найден')
      p.images = [...imagesNew]
      return { success: true, images: p.images }
    } catch (err: any) {
      setError('Ошибка изменения порядка изображений')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function updateProduct(id: string, updates: Partial<Product>) {
    try {
      isLoading.value = true
      await simulateDelay()
      const idx = products.value.findIndex(p => p.id === id)
      if (idx === -1) throw new Error('Товар не найден')
      products.value[idx] = { ...products.value[idx], ...updates }
      return products.value[idx]
    } catch (err: any) {
      setError('Ошибка обновления товара')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function deleteProduct(id: string) {
    try {
      isLoading.value = true
      await simulateDelay()
      products.value = products.value.filter(p => p.id !== id)
      productsPagination.value.total = Math.max(0, productsPagination.value.total - 1)
    } catch (err: any) {
      setError('Ошибка удаления товара')
      throw err
    } finally {
      isLoading.value = false
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
    isLoading,
    error,
    productsPagination,

    // Methods
    login,
    logout,
    checkAuth,
    
    // Banners
    fetchBanners,
    createBanner,
    updateBanner,
    deleteBanner,
    toggleBannerStatus,
    reorderBanners,
    
    // Categories
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    
    // Upload
    uploadFiles,

    // Products
    fetchProducts,
    updateProduct,
    deleteProduct,
    reorderProductImages
  }
})