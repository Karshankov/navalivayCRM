import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Product } from './catalog'
import { useCatalogStore } from './catalog'
import { useWholesaleStore } from './wholesale'
import type { CustomerOrderItem } from '@/utils/customerOrders'
import { hasTelegramMiniAppUserContext } from '@/utils/telegramMiniAppContext'

export interface CartItem {
  productId: string
  title: string
  productTitle?: string | null
  groupName?: string | null
  priceRub: number
  quantity: number
  image?: string | null
  variantId?: string | null
  variantName?: string | null
  groupId?: string | null
  categoryId?: string | null
  loyaltyUnitsApplied?: number
}

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([])
  const editingOrderId = ref<string | null>(null)
  const editingPromoCode = ref('')

  const totalItems = computed(() => {
    return items.value.reduce((sum, item) => sum + item.quantity, 0)
  })

  const totalAmount = computed(() => {
    return items.value.reduce((sum, item) => sum + item.priceRub * item.quantity, 0)
  })

  function resolveCartItemImage(
    product: Product,
    variantId?: string | null,
    fallbackImage: string | null = null,
  ): string | null {
    const catalogStore = useCatalogStore()
    const variantImage = variantId
      ? product.variants?.find((variant) => variant.id === variantId)?.images?.[0]
      : null

    // Собственное фото товара или варианта всегда точнее обложки линейки.
    if (variantImage) return variantImage
    if (!product.needsCategoryImage && product.images?.[0]) {
      return product.images[0]
    }

    if (product.needsCategoryImage) {
      const groupImage = product.groupId
        ? catalogStore.getGroupImage(product.groupId)
        : null
      if (groupImage) return groupImage

      const categoryImage = product.categoryId
        ? catalogStore.getCategoryImage(product.categoryId)
        : null
      if (categoryImage) return categoryImage
    }

    return product.images?.[0] || fallbackImage
  }

  /** Подтянуть цены строк корзины из актуального каталога (опт: после повторного fetch allProducts). */
  function syncItemPricesFromCatalog() {
    if (!items.value.length) return

    const catalogStore = useCatalogStore()
    if (!catalogStore.allProducts.length) return

    let changed = false
    items.value = items.value.map((item) => {
      const catalogProduct = catalogStore.allProducts.find((p) => p.id === item.productId)
      if (!catalogProduct) return item

      let synced: number | null = null
      if (item.variantId && catalogProduct.variants?.length) {
        const vv = catalogProduct.variants.find((v) => v.id === item.variantId)
        if (vv && vv.priceRub != null) {
          const vp = Number(vv.priceRub)
          if (Number.isFinite(vp) && vp > 0) synced = vp
        }
      }
      if (synced == null) {
        const pp = Number(catalogProduct.priceRub)
        if (Number.isFinite(pp) && pp > 0) synced = pp
      }
      if (synced != null && synced !== item.priceRub) {
        changed = true
        return { ...item, priceRub: synced }
      }
      return item
    })
    if (changed) saveToStorage()
  }

  async function loadFromStorage() {
    try {
      const stored = localStorage.getItem('navalivay_cart')
      if (stored) {
        const loadedItems = JSON.parse(stored)
        const catalogStore = useCatalogStore()
        const wholesaleStore = useWholesaleStore()

        // На /opt/... корзина инициализируется до onMounted WholesaleEntry; не дергаем
        // каталог без опта, пока activateFromLink не выставил контекст (иначе розничный снимок).
        if (!catalogStore.allProducts.length || !catalogStore.categories.length) {
          const path =
            typeof window !== 'undefined' ? (window.location.pathname.split('?')[0] || '') : ''
          const onWholesaleEntryPath = /^\/opt\/[^/]+\/[^/]+\/?$/.test(path)
          if (
            onWholesaleEntryPath
            && hasTelegramMiniAppUserContext()
            && !wholesaleStore.isWholesale
          ) {
            const deadline = Date.now() + 12000
            while (!wholesaleStore.isWholesale && Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 40))
            }
          }
          await Promise.all([
            !catalogStore.allProducts.length
              ? catalogStore.fetchAllProducts()
              : Promise.resolve(),
            !catalogStore.categories.length
              ? catalogStore.fetchCategories()
              : Promise.resolve(),
          ])
        }
        
        // Migrate old items
        items.value = loadedItems.map((item: CartItem) => {
          const migrated = { ...item }
          migrated.loyaltyUnitsApplied = Math.max(
            0,
            Math.min(
              Math.floor(Number(migrated.loyaltyUnitsApplied || 0)),
              Math.max(1, Math.floor(Number(migrated.quantity || 1))),
            ),
          )
          
          if (!item.productTitle) {
            const titleParts = item.title.split(' - ')
            migrated.productTitle = titleParts.length > 1 ? titleParts[0] : item.title
            migrated.variantName = titleParts.length > 1 ? titleParts.slice(1).join(' - ') : null
          }
          
          // Fix duplicate variantName (if variantName equals title or productTitle, clear it)
          if (migrated.variantName && !migrated.variantId) {
            // No variantId means this is not a real variant - clear variantName
            migrated.variantName = null
          }
          
          const product = catalogStore.allProducts.find(p => p.id === item.productId)
          if (product) {
            migrated.groupId = product.groupId || migrated.groupId || null
            migrated.categoryId = product.categoryId || migrated.categoryId || null
            migrated.image = resolveCartItemImage(
              product,
              migrated.variantId,
              migrated.image || null,
            )
          } else if (!migrated.image) {
            // Удалённый из каталога товар не теряем: для старой строки используем
            // доступную обложку, но существующее сохранённое фото не затираем.
            migrated.image = (migrated.groupId
              ? catalogStore.getGroupImage(migrated.groupId)
              : null) || (migrated.categoryId
              ? catalogStore.getCategoryImage(migrated.categoryId)
              : null)
          }

          return migrated
        })
        syncItemPricesFromCatalog()
        saveToStorage()
      }
    } catch (error) {
      console.error('[Cart] Failed to load from storage', error)
    }
  }

  function loadEditState() {
    try {
      const storedOrderId = localStorage.getItem('navalivay_edit_order_id')
      const storedPromoCode = localStorage.getItem('navalivay_edit_promo_code')
      editingOrderId.value = storedOrderId || null
      editingPromoCode.value = storedPromoCode || ''
    } catch (error) {
      console.error('[Cart] Failed to load edit state', error)
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem('navalivay_cart', JSON.stringify(items.value))
    } catch (error) {
      console.error('[Cart] Failed to save to storage', error)
    }
  }

  function saveEditState() {
    try {
      if (editingOrderId.value) {
        localStorage.setItem('navalivay_edit_order_id', editingOrderId.value)
      } else {
        localStorage.removeItem('navalivay_edit_order_id')
      }

      if (editingPromoCode.value) {
        localStorage.setItem('navalivay_edit_promo_code', editingPromoCode.value)
      } else {
        localStorage.removeItem('navalivay_edit_promo_code')
      }
    } catch (error) {
      console.error('[Cart] Failed to save edit state', error)
    }
  }

  function addItem(product: Product, quantity = 1, variantId?: string | null) {
    // Для товаров с вариантами учитываем variantId при поиске
    const existing = items.value.find(item => 
      item.productId === product.id && 
      (!variantId || item.variantId === variantId)
    )
    
    if (existing) {
      existing.quantity += quantity
      existing.loyaltyUnitsApplied = Math.min(
        Math.max(0, Number(existing.loyaltyUnitsApplied || 0)),
        existing.quantity,
      )
    } else {
      let title = product.title
      const productTitle = product.title
      let priceRub = product.priceRub
      let image: string | null = null
      let variantName: string | null = null
      
      // Если указан variantId, найдем его данные
      if (variantId && product.variants) {
        const variant = product.variants.find(v => v.id === variantId)
        if (variant) {
          variantName = variant.name
          title = `${product.title} - ${variant.name}`
          if (variant.priceRub) {
            priceRub = variant.priceRub
          }
        }
      }

      image = resolveCartItemImage(product, variantId)
      
      items.value.push({
        productId: product.id,
        productTitle,
        title,
        groupName: product.groupName || null,
        priceRub,
        quantity,
        image,
        variantId: variantId || null,
          variantName: variantName || null,
          groupId: product.groupId || null,
          categoryId: product.categoryId || null,
          loyaltyUnitsApplied: 0,
        })
      }
    
    saveToStorage()
  }

  function updateQuantity(productId: string, quantity: number, variantId?: string | null) {
    const item = items.value.find(item => 
      item.productId === productId && 
      (!variantId || item.variantId === variantId)
    )
    if (item) {
      item.quantity = Math.max(1, quantity)
      item.loyaltyUnitsApplied = Math.min(
        Math.max(0, Number(item.loyaltyUnitsApplied || 0)),
        item.quantity,
      )
      saveToStorage()
    }
  }

  function removeItem(productId: string, variantId?: string | null) {
    items.value = items.value.filter(item => 
      !(item.productId === productId && (!variantId || item.variantId === variantId))
    )
    saveToStorage()
  }

  function clearCart() {
    items.value = []
    saveToStorage()
  }

  function replaceItemsFromOrder(orderItems: Array<CustomerOrderItem | CartItem>) {
    items.value = orderItems.map((item) => {
      if ('cart_item' in item) {
        return {
          ...item.cart_item,
          loyaltyUnitsApplied: Math.max(
            0,
            Math.min(
              Math.floor(Number(item.loyalty_units_applied || item.cart_item.loyaltyUnitsApplied || 0)),
              Math.max(1, Math.floor(Number(item.cart_item.quantity || 1))),
            ),
          ),
        }
      }

      return {
        ...item,
        loyaltyUnitsApplied: Math.max(
          0,
          Math.min(
            Math.floor(
              Number(
                ("loyalty_units_applied" in item
                  ? item.loyalty_units_applied
                  : item.loyaltyUnitsApplied) || 0,
              ),
            ),
            Math.max(1, Math.floor(Number(item.quantity || 1))),
          ),
        ),
      }
    })
    saveToStorage()
  }

  function setLoyaltyUnits(productId: string, units: number, variantId?: string | null) {
    const item = items.value.find(item =>
      item.productId === productId &&
      (!variantId || item.variantId === variantId)
    )
    if (!item) return
    item.loyaltyUnitsApplied = Math.max(
      0,
      Math.min(Math.floor(Number(units || 0)), Math.max(1, item.quantity)),
    )
    saveToStorage()
  }

  function clearLoyaltySelections() {
    items.value = items.value.map((item) => ({
      ...item,
      loyaltyUnitsApplied: 0,
    }))
    saveToStorage()
  }

  function startOrderEdit(orderId: string, options: { promoCode?: string | null } = {}) {
    editingOrderId.value = orderId
    editingPromoCode.value = options.promoCode?.trim() || ''
    saveEditState()
  }

  function setEditingPromoCode(code: string) {
    editingPromoCode.value = code.trim()
    saveEditState()
  }

  function finishOrderEdit() {
    editingOrderId.value = null
    editingPromoCode.value = ''
    saveEditState()
  }

  function clearOrderEdit() {
    finishOrderEdit()
  }

  // Initialize on store creation
  loadFromStorage()
  loadEditState()

  return {
    items,
    editingOrderId,
    editingPromoCode,
    totalItems,
    totalAmount,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    replaceItemsFromOrder,
    setLoyaltyUnits,
    clearLoyaltySelections,
    startOrderEdit,
    setEditingPromoCode,
    finishOrderEdit,
    clearOrderEdit,
    syncItemPricesFromCatalog,
  }
})
