import crypto from 'node:crypto';
import express from 'express';
import slugify from 'slugify';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import {
  getDiscountRecord,
  loadDiscountRecords,
  normalizeDiscountInput,
  saveDiscount,
} from '../utils/catalog-discounts.js';
import { authMiddleware, issueToken, verifyPassword, changePassword, getAdminUsername } from '../auth.js';
import { DEFAULT_PROFIT_PASSWORD } from '../migrations/add_profit_password_setting.js';
import rateLimit from 'express-rate-limit';
import {
  DASHBOARD_LOCK_FROM_HOUR,
  DASHBOARD_LOCK_TO_HOUR,
  isDashboardLockActive,
  isOverviewPasswordEnabled,
  issueDashboardToken,
  verifyDashboardOwnerPassword,
} from '../utils/dashboard-access.js';
import { convertImageToWebP } from '../utils/imageUtils.js';
import {
  buildWholesaleLinkPath,
  getActiveWholesaleTiers,
  getBulkGroupAverageCostStats,
  getBulkGroupWholesalePrices,
  getGroupAverageCostStats,
  getGroupWholesalePrices,
  getWholesaleCoverageSummary,
  saveGroupWholesalePrices,
} from '../wholesale-service.js';
import { syncGroupParking, syncParkingFromFlattened } from '../utils/group-parking.js';
import { searchProductsForAdmin, searchProductsForCrm, syncProductSearchIndex } from '../services/product-search-service.js';
import { resolveFirstImageThumbnail } from '../services/image-thumbnail-service.js';
import {
  COMPLETENESS_FIELD_LABELS,
  computeIncompleteGroups,
  getIncompleteGroupsSummary,
  normalizeWaiverInput,
  updateGroupCompletenessWaivers,
} from '../utils/category-group-completeness.js';
import {
  normalizeStorefrontFiltersProfile,
  normalizeStrengthTier,
} from '../utils/storefront-filters.js';
import {
  StaffServiceError,
  createStaffActorMiddleware,
  isStaffTrackingEnabled,
  recheckStaffActorProof,
  recordSystemStaffEvent,
  runStaffIdempotentOperation,
  sendStaffServiceError,
} from '../utils/staff-service.js';
import {
  enqueueInternalNotificationForGroup,
} from '../utils/internal-notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseUploads = path.resolve(__dirname, '../../uploads');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

const MAX_SQL_VARS = 900;
const requireInventoryActor = createStaffActorMiddleware();

function stableStaffOperationValue(value) {
  if (Array.isArray(value)) return value.map(stableStaffOperationValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (!['actor_pin', 'pin'].includes(key)) {
          result[key] = stableStaffOperationValue(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function staffOperationName(base, body) {
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(stableStaffOperationValue(body || {})))
    .digest('hex');
  return `${base}:${fingerprint}`;
}

function requestIdempotencyKey(req) {
  return String(req.get('Idempotency-Key') || '').trim() || null;
}

function unwrapStaffOperation(result) {
  if (
    result
    && typeof result === 'object'
    && Object.hasOwn(result, 'replayed')
    && Object.hasOwn(result, 'result')
  ) {
    return result;
  }
  return { replayed: false, result };
}

function recheckInventoryActor(req) {
  if (!isStaffTrackingEnabled()) return null;
  return recheckStaffActorProof(req.staffActorProof);
}

function isStaffServiceError(error) {
  return error instanceof StaffServiceError
    || String(error?.code || '').startsWith('staff_')
    || error?.code === 'idempotency_key_conflict';
}

function inventoryLocationLabel(location) {
  return location === 'warehouse' ? 'Склад' : 'Розница';
}

function chunkArray(arr, size = MAX_SQL_VARS) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function pushToMap(map, key, value) {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pushVariantImage(map, productId, variantId, url) {
  let byProduct = map.get(productId);
  if (!byProduct) {
    byProduct = new Map();
    map.set(productId, byProduct);
  }
  const list = byProduct.get(variantId);
  if (list) {
    list.push(url);
  } else {
    byProduct.set(variantId, [url]);
  }
}

function refreshProductSearchIndex(context) {
  try {
    syncProductSearchIndex();
  } catch (error) {
    console.error(`[admin] product search index refresh failed after ${context}:`, error);
  }
}

function getProfitPasswordHash() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('profit_password_hash');
  if (row?.value) {
    return row.value;
  }

  const fallbackHash = bcrypt.hashSync(DEFAULT_PROFIT_PASSWORD, 10);
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('profit_password_hash', fallbackHash);
  return fallbackHash;
}

async function updateProfitPasswordHash(newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('profit_password_hash', hash);
  return hash;
}

function generateGroupSlug(categoryId, name, customSlug, excludeId) {
  let baseSlug = customSlug;
  if (!baseSlug) {
    try {
      baseSlug = slugify(name, { lower: true, strict: true });
    } catch (error) {
      baseSlug = name.toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
  }
  let slugCandidate = baseSlug;
  let counter = 1;
  while (true) {
    const existing = db.prepare('SELECT id FROM category_groups WHERE categoryId = ? AND slug = ?').get(categoryId, slugCandidate);
    if (!existing || (excludeId && existing.id === excludeId)) {
      break;
    }
    slugCandidate = `${baseSlug}-${counter}`;
    counter += 1;
  }
  return slugCandidate;
}

function buildWholesaleTiersPayload() {
  return getActiveWholesaleTiers().map((tier) => ({
    id: tier.id,
    code: tier.code,
    label: tier.label,
    min_order_amount: Number(tier.minOrderAmount ?? 0),
    sort_order: Number(tier.sortOrder ?? 0),
  }));
}

function enrichAdminCategoryGroups(groups) {
  const normalizedGroups = Array.isArray(groups) ? groups : [];
  const groupIds = normalizedGroups.map((group) => String(group.id || '')).filter(Boolean);
  const priceMapByGroup = getBulkGroupWholesalePrices(groupIds);
  const costStatsByGroup = getBulkGroupAverageCostStats(groupIds);
  const wholesaleTiers = buildWholesaleTiersPayload();

  return normalizedGroups.map((group) => {
    const groupId = String(group.id || '');
    const costStats = costStatsByGroup.get(groupId) || null;
    return {
      ...group,
      discount: getDiscountRecord('group', groupId),
      wholesale_prices: priceMapByGroup.get(groupId) || {},
      average_cost_auto: costStats?.averageCostAuto ?? null,
      direct_product_count: costStats?.directProductCount ?? Number(group.productCount ?? 0),
      products_with_cost_count: costStats?.productsWithCostCount ?? 0,
      wholesale_tiers: wholesaleTiers,
    };
  });
}

function enrichAdminCategoryGroup(group) {
  if (!group?.id) {
    return group;
  }

  const costStats = getGroupAverageCostStats(group.id);
  const wholesaleTiers = buildWholesaleTiersPayload();
  return {
    ...group,
    discount: getDiscountRecord('group', group.id),
    wholesale_prices: getGroupWholesalePrices(group.id),
    average_cost_auto: costStats.averageCostAuto,
    direct_product_count: costStats.directProductCount,
    products_with_cost_count: costStats.productsWithCostCount,
    wholesale_tiers: wholesaleTiers,
    waive_description: Number(group.waive_description ?? 0),
    waive_min_stock: Number(group.waive_min_stock ?? 0),
    waive_wholesale: Number(group.waive_wholesale ?? 0),
    strength_tier: group.strength_tier ?? null,
    waive_strength_tier: Number(group.waive_strength_tier ?? 0),
  };
}

function resolveStrengthTierUpdate(body, currentValue) {
  const provided =
    'strengthTier' in (body || {}) ||
    'strength_tier' in (body || {});
  if (!provided) {
    return currentValue ?? null;
  }
  try {
    return normalizeStrengthTier(body.strengthTier ?? body.strength_tier, {
      allowNull: true,
    });
  } catch (error) {
    error.code = 'invalid_strength_tier';
    throw error;
  }
}

function resolveWaiverUpdate(body, snakeKey, camelKey, currentValue) {
  const provided = snakeKey in (body || {}) || camelKey in (body || {});
  if (!provided) {
    return Number(currentValue ?? 0);
  }
  return normalizeWaiverInput(body[camelKey] ?? body[snakeKey]);
}

function resolveBooleanFlagUpdate(body, snakeKey, camelKey, currentValue = 0) {
  const provided = snakeKey in (body || {}) || camelKey in (body || {});
  if (!provided) return Number(currentValue ?? 0) ? 1 : 0;

  const value = body[camelKey] ?? body[snakeKey];
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;

  const error = new Error('invalid_boolean_value');
  error.code = 'invalid_boolean_value';
  throw error;
}

export const adminRouter = express.Router();

function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

// Login
adminRouter.post('/api/admin/login', async (req, res) => {
  try {
    console.log('[login] Login attempt');
    const { username, password } = req.body || {};
    if (!username || !password) {
      console.log('[login] Missing username or password');
      return res.status(400).json({ error: 'missing' });
    }
    const expectedUser = getAdminUsername();
    if (username !== expectedUser) {
      console.log('[login] Username mismatch');
      return res.status(401).json({ error: 'unauthorized' });
    }
    const ok = await verifyPassword(password);
    if (!ok) {
      console.log('[login] Password verification failed');
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = issueToken(username);
    console.log('[login] Token issued');
    res.cookie('navalivay', token, adminCookieOptions());
    res.json({ ok: true, token });
  } catch (error) {
    console.error('[login] Login error:', error);
    res.status(500).json({ error: 'internal_error', message: error.message });
  }
});

// Verify token (для совместимости с фронтендом)
adminRouter.post('/api/admin/auth/verify', authMiddleware, (req, res) => {
  const user = req.user; // получаем из authMiddleware
  res.json({ 
    valid: true, 
    user: {
      username: user.username || user,
      role: 'admin'
    }
  });
});

// Change password
//
// Новый пароль пишется в ФАЙЛ (см. writeAdminConfig в server/auth.js), а не в
// базу. Это важно для любых сценариев с восстановлением: откат базы к резервной
// копии смену пароля не отменяет, файл admin.json надо восстанавливать отдельно.
adminRouter.post('/api/admin/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing' });
  const ok = await changePassword(currentPassword, newPassword);
  if (!ok) return res.status(400).json({ error: 'invalid_current_password' });
res.json({ ok: true });
});

adminRouter.post('/api/admin/verify-password', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'missing_password' });
    }

    const ok = await verifyPassword(password);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_password' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[admin] Password verify error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Четыре цифры перебираются мгновенно, поэтому попытки ограничены.
const dashboardAccessLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'too_many_attempts' }),
});

/**
 * Вход в раздел «Обзор».
 *
 * С 10:00 до 16:00 по Минску обычный ключ CRM сюда не пускает, нужен пароль
 * владельца. В остальное время работает и обычный ключ, как раньше.
 */
adminRouter.post(
  '/api/admin/dashboard-access/verify',
  authMiddleware,
  dashboardAccessLimiter,
  async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      if (!password) {
        return res.status(400).json({ error: 'missing_password' });
      }

      const locked = isDashboardLockActive();
      const ownerOk = verifyDashboardOwnerPassword(password);
      let allowed = ownerOk;

      if (!allowed && !locked) {
        allowed = await bcrypt.compare(password, getProfitPasswordHash());
      }

      // Ответ одинаковый в любое время: подсказывать про второй пароль тому,
      // кто его не знает, незачем.
      if (!allowed) {
        return res.status(401).json({ error: 'invalid_password' });
      }

      const { token, expiresInMs } = issueDashboardToken();
      res.json({ ok: true, token, expires_in_ms: expiresInMs });
    } catch (error) {
      console.error('[admin] Dashboard access verify error:', error);
      res.status(500).json({ error: 'failed', message: error.message });
    }
  },
);

/**
 * Состояние замка, чтобы интерфейс знал, какой пароль спрашивать.
 *
 * profit_required — выключатель паролей поверх обычного входа
 * (OVERVIEW_PASSWORD_ENABLED, см. utils/dashboard-access.js). Когда он false,
 * интерфейс не спрашивает пароль нигде: ни в «Обзоре», ни на себестоимости в
 * «Товарах», ни в «Финансах», «Заказах», «Архиве», «Закупках» и «Кассе».
 */
adminRouter.get('/api/admin/dashboard-access/state', authMiddleware, (_req, res) => {
  res.json({
    locked: isDashboardLockActive(),
    profit_required: isOverviewPasswordEnabled(),
    window: { from: DASHBOARD_LOCK_FROM_HOUR, to: DASHBOARD_LOCK_TO_HOUR },
  });
});

adminRouter.post('/api/admin/settings/profit-password/verify', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'missing_password' });
    }

    // Используем ОТДЕЛЬНЫЙ пароль для финансовых данных
    const profitPasswordHash = getProfitPasswordHash();
    const ok = await bcrypt.compare(password, profitPasswordHash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_password' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[admin] Profit password verify error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

adminRouter.post('/api/admin/settings/profit-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'missing_new_password' });
    }

    const trimmedNewPassword = newPassword.trim();
    if (trimmedNewPassword.length < 4) {
      return res.status(400).json({ error: 'password_too_short' });
    }

    const existingHash = getProfitPasswordHash();
    if (existingHash) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'missing_current_password' });
      }
      const ok = await bcrypt.compare(currentPassword, existingHash);
      if (!ok) {
        return res.status(401).json({ error: 'invalid_current_password' });
      }
    }

    await updateProfitPasswordHash(trimmedNewPassword);
    res.json({ ok: true });
  } catch (error) {
    console.error('[admin] Profit password update error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Products CRUD
adminRouter.post('/api/admin/products', authMiddleware, (req, res) => {
  const {
    categoryId,
    groupId,
    title,
    priceRub,
    description,
    images,
    links,
    strength,
    cost_price,
    costPrice,
    stock,
    min_stock,
    minStock,
    useCategoryImage,
    hasVariants,
    variants
  } = req.body || {};
  if (!categoryId) return res.status(400).json({ error: 'missing_fields' });
  
  // Валидация: товар с вариантами или обычный товар
  if (hasVariants) {
    if (!Array.isArray(variants) || variants.length === 0) {
      return res.status(400).json({ error: 'variants_required' });
    }
    // Проверяем каждый вариант
    for (const variant of variants) {
      if (!variant.name || variant.name.trim().length === 0) {
        return res.status(400).json({ error: 'variant_name_required' });
      }
      if (variant.priceRub !== undefined && !Number.isFinite(Number(variant.priceRub))) {
        return res.status(400).json({ error: 'invalid_variant_price' });
      }
    }
  } else {
    if (!Number.isFinite(Number(priceRub))) {
      return res.status(400).json({ error: 'missing_fields' });
    }
  }

  const normalizedCostPrice = cost_price ?? costPrice ?? 0;
  const normalizedStock = stock ?? 0;
  const normalizedMinStock = min_stock ?? minStock ?? 0;
  const normalizedUseCategoryImage = useCategoryImage === true ? 1 : 0;

  const categoryExists = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!categoryExists) {
    return res.status(400).json({ error: 'invalid_category' });
  }

  let normalizedGroupId = null;
  if (groupId) {
    const groupRow = db.prepare('SELECT id, categoryId FROM category_groups WHERE id = ?').get(groupId);
    if (!groupRow) {
      return res.status(400).json({ error: 'invalid_group' });
    }
    if (groupRow.categoryId !== categoryId) {
      return res.status(400).json({ error: 'group_category_mismatch' });
    }
    normalizedGroupId = groupRow.id;
  }
  
  const id = 'p_' + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date().toISOString();
  
  try {
    console.log(`[admin] Creating product ${id} with data:`, { categoryId, title, priceRub, description, images, hasVariants, variants });
    
    // First create the product without transaction to ensure it works
    try {
      db.prepare('INSERT INTO products (id, categoryId, groupId, title, priceRub, description, strength, cost_price, stock, min_stock, use_category_image, has_variants, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          id,
          categoryId,
          normalizedGroupId,
          title || null,
          hasVariants ? 0 : Number(priceRub),
          description || null,
          strength || null,
          Number(normalizedCostPrice) || 0,
          Number(normalizedStock) || 0,
          Number(normalizedMinStock) || 0,
          normalizedUseCategoryImage,
          hasVariants ? 1 : 0,
          createdAt
        );
      console.log(`[admin] Product ${id} created in database`);
    } catch (dbError) {
      console.error(`[admin] Failed to create product in database:`, dbError);
      throw dbError;
    }
    
    // Handle variants if product has them
    if (hasVariants && Array.isArray(variants) && variants.length > 0) {
      console.log(`[admin] Creating ${variants.length} variants for product ${id}`);
      const variantStmt = db.prepare('INSERT INTO product_variants (id, product_id, name, color_code, color_image, color_display_mode, price_rub, stock, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      
      for (let idx = 0; idx < variants.length; idx++) {
        const variant = variants[idx];
        const variantId = `v_${Math.random().toString(36).slice(2, 8)}`;
        const displayMode = variant.colorDisplayMode || 'color';
        
        variantStmt.run(
          variantId,
          id,
          variant.name,
          displayMode === 'image' ? null : (variant.colorCode || null),
          displayMode === 'image' ? (variant.colorImage || null) : null,
          displayMode,
          variant.priceRub ? Number(variant.priceRub) : null,
          variant.stock !== undefined ? Number(variant.stock) : 0,
          idx
        );
        
        console.log(`[admin] Created variant ${variantId}: ${variant.name}, displayMode: ${displayMode}`);
        
        // Store variant ID back to variant object for image processing
        variant._id = variantId;
      }
    }
    
    // Handle images if provided (separate from product creation)
    const processedUrls = [];
    
    if (hasVariants) {
      // Для товаров с вариантами обрабатываем изображения каждого варианта
      if (Array.isArray(variants)) {
        const tempDir = path.resolve(baseUploads, 'temp');
        const productDir = path.resolve(baseUploads, 'products', id);
        ensureDir(productDir);
        
        for (const variant of variants) {
          if (Array.isArray(variant.images) && variant.images.length > 0) {
            console.log(`[admin] Processing ${variant.images.length} images for variant ${variant._id}`);
            
            for (let imgIdx = 0; imgIdx < variant.images.length; imgIdx++) {
              const tempUrl = variant.images[imgIdx];
              
              if (tempUrl.startsWith('/uploads/temp/')) {
                const filename = path.basename(tempUrl);
                const tempPath = path.resolve(tempDir, filename);
                const newPath = path.resolve(productDir, filename);
                const newUrl = `/uploads/products/${id}/${filename}`;
                
                try {
                  if (fs.existsSync(tempPath)) {
                    fs.renameSync(tempPath, newPath);
                    // Сохраняем изображение с привязкой к варианту
                    db.prepare('INSERT INTO product_images (productId, url, position, variant_id) VALUES (?, ?, ?, ?)')
                      .run(id, newUrl, imgIdx, variant._id);
                    console.log(`[admin] Added image ${newUrl} to variant ${variant._id}`);
                  } else {
                    console.warn(`[admin] Temp file not found: ${tempPath}`);
                  }
                } catch (moveError) {
                  console.error(`[admin] Failed to move file ${tempPath}:`, moveError);
                }
              } else {
                // Не temp URL, сохраняем как есть
                db.prepare('INSERT INTO product_images (productId, url, position, variant_id) VALUES (?, ?, ?, ?)')
                  .run(id, tempUrl, imgIdx, variant._id);
              }
            }
          }
        }
      }
    } else if (Array.isArray(images) && images.length > 0) {
      // Обычный товар без вариантов
      console.log(`[admin] Processing ${images.length} images for product ${id}`);
      
      try {
        // Move files from temp to products folder and update URLs
        const tempDir = path.resolve(baseUploads, 'temp');
        const productDir = path.resolve(baseUploads, 'products', id);
        
        console.log(`[admin] Temp dir: ${tempDir}`);
        console.log(`[admin] Product dir: ${productDir}`);
        
        // Ensure product directory exists
        ensureDir(productDir);
        console.log(`[admin] Product directory created/verified`);
        
        for (const tempUrl of images) {
          console.log(`[admin] Processing image: ${tempUrl}`);
          
          if (tempUrl.startsWith('/uploads/temp/')) {
            const filename = path.basename(tempUrl);
            const tempPath = path.resolve(tempDir, filename);
            const newPath = path.resolve(productDir, filename);
            const newUrl = `/uploads/products/${id}/${filename}`;
            
            console.log(`[admin] Moving file: ${tempPath} -> ${newPath}`);
            
            try {
              // Move file from temp to products folder
              if (fs.existsSync(tempPath)) {
                fs.renameSync(tempPath, newPath);
                processedUrls.push(newUrl);
                console.log(`[admin] Moved ${tempUrl} -> ${newUrl}`);
              } else {
                console.warn(`[admin] Temp file not found: ${tempPath}`);
                // Keep original URL if file doesn't exist
                processedUrls.push(tempUrl);
              }
            } catch (moveError) {
              console.error(`[admin] Failed to move file ${tempPath}:`, moveError);
              // Keep original URL if move fails
              processedUrls.push(tempUrl);
            }
          } else {
            // Not a temp URL, keep as is
            processedUrls.push(tempUrl);
            console.log(`[admin] Keeping non-temp URL: ${tempUrl}`);
          }
        }
        
        // Insert images into database
        if (processedUrls.length > 0) {
          try {
            const imgStmt = db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)');
            processedUrls.forEach((url, index) => {
              console.log(`[admin] Adding image ${index}: ${url}`);
              imgStmt.run(id, url, index);
            });
            console.log(`[admin] Added ${processedUrls.length} images to product ${id}`);
          } catch (imgDbError) {
            console.error(`[admin] Failed to insert images into database:`, imgDbError);
            // Continue without images rather than failing completely
          }
        }
      } catch (imageError) {
        console.error(`[admin] Image processing failed:`, imageError);
        // Continue without images rather than failing completely
      }
    }
    
    // Return created product with images
    const product = db.prepare(`
      SELECT 
        p.id,
        p.categoryId,
        p.groupId,
        p.title,
        p.priceRub,
        p.description,
        p.strength,
        p.cost_price AS costPrice,
        p.stock,
        p.min_stock AS minStock,
        p.use_category_image AS useCategoryImage,
        p.has_variants AS hasVariants,
        p.createdAt,
        g.slug AS groupSlug,
        g.name AS groupName
      FROM products p
      LEFT JOIN category_groups g ON p.groupId = g.id
      WHERE p.id = ?
    `).get(id);
    
    let productImages = [];
    let productVariants = [];
    
    if (product.hasVariants) {
      // Для товаров с вариантами получаем варианты и их изображения
      productVariants = db.prepare(`
        SELECT id, product_id, name, color_code AS colorCode, color_image AS colorImage, color_display_mode AS colorDisplayMode, price_rub AS priceRub, stock, position
        FROM product_variants
        WHERE product_id = ?
        ORDER BY position ASC
      `).all(id);
      
      // Добавляем изображения к каждому варианту
      for (const variant of productVariants) {
        variant.images = db.prepare(
          'SELECT url FROM product_images WHERE productId = ? AND variant_id = ? ORDER BY position ASC'
        ).all(id, variant.id).map(r => r.url);
      }
    } else {
      // Обычный товар - получаем изображения без variant_id
      productImages = db.prepare('SELECT url FROM product_images WHERE productId = ? AND variant_id IS NULL ORDER BY position ASC').all(id).map(r => r.url);
    }

    const normalizedLinks = Array.isArray(links)
      ? links
          .map((link, index) => ({
            label: typeof link?.label === 'string' && link.label.trim().length > 0 ? link.label.trim() : null,
            url: typeof link?.url === 'string' ? link.url.trim() : '',
            position: index
          }))
          .filter(link => link.url.length > 0)
      : [];

    if (normalizedLinks.length > 0) {
      const linkStmt = db.prepare('INSERT INTO product_links (productId, label, url, position) VALUES (?, ?, ?, ?)');
      const txLinks = db.transaction((items) => {
        items.forEach(link => {
          linkStmt.run(id, link.label, link.url, link.position);
        });
      });
      txLinks(normalizedLinks);
    }

    const productLinks = db.prepare('SELECT label, url FROM product_links WHERE productId = ? ORDER BY position ASC').all(id).map(row => ({
      label: row.label ?? '',
      url: row.url
    }));
    
    console.log(`[admin] Product creation completed:`, { product, images: productImages, variants: productVariants });

    // Если товар создан с ненулевым stock в линейке на парковке — снять парковку
    if (product.groupId) {
      try { syncGroupParking(product.groupId); } catch (e) { console.error('[admin] syncGroupParking on create failed:', e); }
    }
    refreshProductSearchIndex('product create');

    const responseProduct = { ...product, links: productLinks };
    if (product.hasVariants) {
      responseProduct.variants = productVariants;
    } else {
      responseProduct.images = productImages;
    }

    res.json({
      ok: true,
      id,
      product: responseProduct
    });
  } catch (error) {
    console.error('[admin] Product creation failed:', error);
    res.status(500).json({ error: 'creation_failed', message: error.message });
  }
});

adminRouter.patch('/api/admin/products/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  
  console.log('[admin] PATCH /products/:id - Request body:', JSON.stringify(req.body, null, 2));
  
  const {
    categoryId,
    groupId,
    title,
    priceRub,
    description,
    links,
    strength,
    cost_price,
    costPrice,
    stock,
    min_stock,
    minStock,
    useCategoryImage,
    hasVariants,
    variants,
    discount
  } = req.body || {};

  // Скидки товара и вкусов проверяем до записи: отказ по кривой цене не должен
  // случиться на середине сохранения товара.
  const productDiscountProvided = 'discount' in (req.body || {});
  let productDiscountPayload = null;
  const variantDiscountPayloads = new Map();
  try {
    if (productDiscountProvided) {
      productDiscountPayload = normalizeDiscountInput(
        discount && typeof discount === 'object'
          ? { price: discount.price ?? null, untilDate: discount.untilDate ?? discount.until_date ?? null }
          : { price: null, untilDate: null },
      );
    }
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        if (!variant || !('discount' in variant)) continue;
        const raw = variant.discount;
        variantDiscountPayloads.set(
          String(variant.id || variant.name || ''),
          normalizeDiscountInput(
            raw && typeof raw === 'object'
              ? { price: raw.price ?? null, untilDate: raw.untilDate ?? raw.until_date ?? null }
              : { price: null, untilDate: null },
          ),
        );
      }
    }
  } catch (error) {
    return res.status(400).json({ error: error.code || 'invalid_discount' });
  }

  const normalizedCostPrice = cost_price ?? costPrice;
  const normalizedMinStock = min_stock ?? minStock;
  const normalizedUseCategoryImage = useCategoryImage !== undefined 
    ? (useCategoryImage === true ? 1 : 0)
    : cur.use_category_image;

  let nextCategoryId = categoryId || cur.categoryId;
  const categoryExists = db.prepare('SELECT id FROM categories WHERE id = ?').get(nextCategoryId);
  if (!categoryExists) {
    return res.status(400).json({ error: 'invalid_category' });
  }

  let nextGroupId = cur.groupId;
  if (groupId !== undefined) {
    if (groupId === null || groupId === '') {
      nextGroupId = null;
    } else {
      const groupRow = db.prepare('SELECT id, categoryId FROM category_groups WHERE id = ?').get(groupId);
      if (!groupRow) {
        return res.status(400).json({ error: 'invalid_group' });
      }
      if (groupRow.categoryId !== nextCategoryId) {
        return res.status(400).json({ error: 'group_category_mismatch' });
      }
      nextGroupId = groupRow.id;
    }
  }

  // Если сменили категорию, но текущий groupId к ней не относится — сбрасываем
  if (groupId === undefined && nextGroupId) {
    const belongs = db.prepare('SELECT id FROM category_groups WHERE id = ? AND categoryId = ?').get(nextGroupId, nextCategoryId);
    if (!belongs) {
      nextGroupId = null;
    }
  }

  const normalizedHasVariants = hasVariants !== undefined ? (hasVariants === true ? 1 : 0) : cur.has_variants;

  let normalizedVariants = null;
  if (normalizedHasVariants && Array.isArray(variants)) {
    const existingVariants = db.prepare(`
      SELECT id, stock, warehouse_stock
      FROM product_variants
      WHERE product_id = ?
    `).all(id);
    const existingById = new Map(existingVariants.map((variant) => [String(variant.id), variant]));
    const desiredIds = new Set();
    normalizedVariants = variants.map((variant, index) => {
      const variantId = variant.id ? String(variant.id) : `${id}-${index}-${Date.now()}`;
      if (desiredIds.has(variantId)) {
        return null;
      }
      if (variant.id && !existingById.has(variantId)) {
        return null;
      }
      desiredIds.add(variantId);
      return { ...variant, id: variantId };
    });
    if (normalizedVariants.some((variant) => !variant)) {
      return res.status(400).json({ error: 'invalid_variant_id' });
    }

    const removedVariants = existingVariants.filter((variant) => !desiredIds.has(String(variant.id)));
    for (const variant of removedVariants) {
      const hasStock = Number(variant.stock || 0) > 0 || Number(variant.warehouse_stock || 0) > 0;
      const usedInProcurement = db.prepare(
        'SELECT 1 FROM procurement_items WHERE variant_id = ? LIMIT 1',
      ).get(variant.id);
      const usedInOrder = db.prepare(
        'SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1',
      ).get(variant.id);
      const usedInTransfer = db.prepare(
        'SELECT 1 FROM stock_transfer_items WHERE variant_id = ? LIMIT 1',
      ).get(variant.id);
      if (hasStock || usedInProcurement || usedInOrder || usedInTransfer) {
        return res.status(400).json({ error: hasStock ? 'variant_has_stock' : 'variant_in_use' });
      }
    }
  } else if (!normalizedHasVariants && Number(cur.has_variants || 0) === 1) {
    const protectedVariant = db.prepare(`
      SELECT v.id,
             CASE WHEN COALESCE(v.stock, 0) > 0 OR COALESCE(v.warehouse_stock, 0) > 0 THEN 1 ELSE 0 END AS has_stock,
             (
               EXISTS (SELECT 1 FROM procurement_items pi WHERE pi.variant_id = v.id)
               OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = v.id)
               OR EXISTS (
                 SELECT 1 FROM stock_transfer_items sti
                 WHERE sti.variant_id = v.id
               )
             ) AS in_use
      FROM product_variants v
      WHERE v.product_id = ?
        AND (
          COALESCE(v.stock, 0) > 0
          OR COALESCE(v.warehouse_stock, 0) > 0
          OR EXISTS (SELECT 1 FROM procurement_items pi WHERE pi.variant_id = v.id)
          OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = v.id)
          OR EXISTS (
            SELECT 1 FROM stock_transfer_items sti
            WHERE sti.variant_id = v.id
          )
        )
      LIMIT 1
    `).get(id);
    if (protectedVariant) {
      return res.status(400).json({ error: protectedVariant.has_stock ? 'variant_has_stock' : 'variant_in_use' });
    }
  }

  db.prepare('UPDATE products SET categoryId = ?, groupId = ?, title = ?, priceRub = ?, description = ?, strength = ?, cost_price = ?, stock = ?, min_stock = ?, use_category_image = ?, has_variants = ? WHERE id = ?')
    .run(
      nextCategoryId,
      nextGroupId,
      (title !== undefined ? title : cur.title),
      (Number.isFinite(Number(priceRub)) ? Number(priceRub) : cur.priceRub),
      (description !== undefined ? description : cur.description),
      (strength !== undefined ? strength : cur.strength),
      (normalizedCostPrice !== undefined ? Number(normalizedCostPrice) : (cur.cost_price ?? 0)),
      (stock !== undefined ? Number(stock) : (cur.stock ?? 0)),
      (normalizedMinStock !== undefined ? Number(normalizedMinStock) : (cur.min_stock ?? 0)),
      normalizedUseCategoryImage,
      normalizedHasVariants,
      id
    );

  if (Array.isArray(links)) {
    const normalizedLinks = links
      .map((link, index) => ({
        label: typeof link?.label === 'string' && link.label.trim().length > 0 ? link.label.trim() : null,
        url: typeof link?.url === 'string' ? link.url.trim() : '',
        position: index
      }))
      .filter(link => link.url.length > 0);

    const deleteStmt = db.prepare('DELETE FROM product_links WHERE productId = ?');
    const insertStmt = db.prepare('INSERT INTO product_links (productId, label, url, position) VALUES (?, ?, ?, ?)');
    const txLinks = db.transaction((items) => {
      deleteStmt.run(id);
      items.forEach(link => {
        insertStmt.run(id, link.label, link.url, link.position);
      });
    });

    txLinks(normalizedLinks);
  }

  // Обработка вариантов
  try {
    if (normalizedHasVariants && normalizedVariants) {
      console.log('[admin] Processing variants:', normalizedVariants.length);

      const updateVariantStmt = db.prepare(`
        UPDATE product_variants
        SET name = ?, color_code = ?, color_image = ?, color_display_mode = ?, price_rub = ?, stock = ?, position = ?
        WHERE id = ? AND product_id = ?
      `);
      const insertVariantStmt = db.prepare(`
        INSERT INTO product_variants (
          id, product_id, name, color_code, color_image, color_display_mode,
          price_rub, stock, warehouse_stock, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `);
      const imageStmt = db.prepare('INSERT INTO product_images (productId, variant_id, url, position) VALUES (?, ?, ?, ?)');
      
      const txVariants = db.transaction((items) => {
        const desiredIds = new Set(items.map((variant) => String(variant.id)));
        const currentIds = db.prepare('SELECT id FROM product_variants WHERE product_id = ?').all(id);
        db.prepare('DELETE FROM product_images WHERE productId = ? AND variant_id IS NOT NULL').run(id);
        for (const current of currentIds) {
          if (!desiredIds.has(String(current.id))) {
            db.prepare('DELETE FROM product_variants WHERE id = ? AND product_id = ?').run(current.id, id);
          }
        }
        
        let globalImagePosition = 0;
        
        items.forEach((variant, index) => {
          const variantId = String(variant.id);
          const displayMode = variant.colorDisplayMode || 'color';
          
          console.log(`[admin] Inserting variant ${index}:`, {
            variantId,
            name: variant.name,
            colorCode: variant.colorCode,
            colorImage: variant.colorImage,
            colorDisplayMode: displayMode,
            priceRub: variant.priceRub,
            stock: variant.stock,
            imagesCount: variant.images?.length || 0
          });
          
          const values = [
            variant.name || '',
            displayMode === 'image' ? null : (variant.colorCode || variant.color || null),
            displayMode === 'image' ? (variant.colorImage || null) : null,
            displayMode,
            variant.priceRub !== null && variant.priceRub !== undefined ? Number(variant.priceRub) : null,
            variant.stock !== undefined ? Number(variant.stock) : 0,
            index,
          ];
          const existing = db.prepare(
            'SELECT id FROM product_variants WHERE id = ? AND product_id = ?',
          ).get(variantId, id);
          if (existing) {
            updateVariantStmt.run(...values, variantId, id);
          } else {
            insertVariantStmt.run(variantId, id, ...values);
          }

          // Скидка вкуса: ключ ищем и по идентификатору, и по названию, потому
          // что у нового варианта идентификатор появляется только здесь.
          const variantDiscount =
            variantDiscountPayloads.get(String(variant.id || '')) ??
            variantDiscountPayloads.get(String(variant.name || ''));
          if (variantDiscount) {
            saveDiscount('variant', variantId, variantDiscount);
          }

          // Обработка изображений вариантов
          if (Array.isArray(variant.images) && variant.images.length > 0) {
            variant.images.forEach((img) => {
              const imageUrl = typeof img === 'string' ? img : img.url;
              console.log(`[admin] Inserting variant image at position ${globalImagePosition}:`, imageUrl);
              imageStmt.run(id, variantId, imageUrl, globalImagePosition);
              globalImagePosition++;
            });
          }
        });
      });
      txVariants(normalizedVariants);
      console.log('[admin] Variants processed successfully');
    } else if (!normalizedHasVariants) {
      console.log('[admin] Removing variants (hasVariants = false)');
      // Если больше нет вариантов, удаляем все связанные данные
      db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM product_images WHERE variant_id IS NOT NULL AND productId = ?').run(id);
    }

    if (productDiscountProvided) {
      saveDiscount('product', id, productDiscountPayload);
    }

    // Синк парковки групп: изменился stock и/или сменился groupId — затронута старая и новая линейка.
    try {
      const affected = new Set();
      if (cur.groupId) affected.add(cur.groupId);
      if (nextGroupId) affected.add(nextGroupId);
      affected.forEach((gid) => { try { syncGroupParking(gid); } catch (e) { console.error('[admin] syncGroupParking failed:', e); } });
    } catch (e) {
      console.error('[admin] parking sync wrapper failed:', e);
    }

    refreshProductSearchIndex('product update');
    res.json({ ok: true });
  } catch (error) {
    console.error('[admin] Error processing variants:', error);
    res.status(500).json({ error: 'variants_processing_failed', message: error.message });
  }
});

adminRouter.delete('/api/admin/products/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const prod = db.prepare('SELECT groupId FROM products WHERE id = ?').get(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (prod?.groupId) {
    try { syncGroupParking(prod.groupId); } catch (e) { console.error('[admin] syncGroupParking on delete failed:', e); }
  }
  refreshProductSearchIndex('product delete');
  res.json({ ok: true });
});

adminRouter.post('/api/admin/products/:id/images/attach', authMiddleware, (req, res) => {
  const id = req.params.id;
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls_required' });
  const cur = db.prepare('SELECT COUNT(*) as c FROM product_images WHERE productId = ?').get(id).c;
  const stmt = db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)');
  const tx = db.transaction((rows, start) => {
    let pos = start;
    for (const u of rows) { stmt.run(id, u, pos++); }
  });
  tx(urls, cur);
  res.json({ ok: true });
});

adminRouter.get('/api/admin/products', authMiddleware, (req, res) => {
  const page = Math.max(parseInt(req.query.page ?? '1', 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1), 100)
  const category = req.query.category
  const search = req.query.search
  const group = req.query.group
  const location = req.query.location === 'warehouse' ? 'warehouse' : 'retail'

  const trimmedSearch = typeof search === 'string' ? search.trim() : ''
  let where = ''
  const params = []
  if (category) { where += (where ? ' AND ' : 'WHERE ') + 'p.categoryId = ?'; params.push(String(category)) }
  if (group) { where += (where ? ' AND ' : 'WHERE ') + 'p.groupId = ?'; params.push(String(group)) }
  if (location === 'warehouse') {
    where += (where ? ' AND ' : 'WHERE ') + `(
      (COALESCE(p.has_variants, 0) = 0 AND COALESCE(p.warehouse_stock, 0) > 0)
      OR (COALESCE(p.has_variants, 0) = 1 AND EXISTS (
        SELECT 1 FROM product_variants location_variant
        WHERE location_variant.product_id = p.id
          AND COALESCE(location_variant.warehouse_stock, 0) > 0
      ))
    )`;
  }

  let total
  let rows
  if (trimmedSearch) {
    const result = searchProductsForAdmin({
      search: trimmedSearch,
      page,
      limit,
      categoryId: category ? String(category) : undefined,
      groupId: group ? String(group) : undefined,
      location,
    })
    total = result.pagination.total
    rows = result.products
  } else {
    total = (params.length
      ? db.prepare(`
          SELECT COUNT(*) as total
          FROM products p
          LEFT JOIN categories c ON p.categoryId = c.id
          LEFT JOIN category_groups g ON p.groupId = g.id
          ${where}
        `).get(...params)
      : db.prepare(`
          SELECT COUNT(*) as total
          FROM products p
          LEFT JOIN categories c ON p.categoryId = c.id
          LEFT JOIN category_groups g ON p.groupId = g.id
          ${where}
        `).get()
    ).total

    const offset = (page - 1) * limit
    rows = (params.length
      ? db.prepare(`
        SELECT 
          p.id, 
          p.categoryId, 
          p.groupId,
          c.name as categoryName, 
          c.cover_image as categoryImage,
          p.title, 
          p.priceRub, 
          p.description, 
          p.strength,
          p.cost_price AS costPrice,
          p.stock,
          p.warehouse_stock AS warehouseStock,
          p.min_stock AS minStock,
          p.use_category_image AS useCategoryImage,
          p.has_variants AS hasVariants,
          p.createdAt,
          g.name as groupName,
          g.slug as groupSlug,
          g.cover_image as groupImage
        FROM products p 
        LEFT JOIN categories c ON p.categoryId = c.id
        LEFT JOIN category_groups g ON p.groupId = g.id
        ${where}
        ORDER BY p.createdAt DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset)
      : db.prepare(`
        SELECT 
          p.id, 
          p.categoryId, 
          p.groupId,
          c.name as categoryName, 
          c.cover_image as categoryImage,
          p.title, 
          p.priceRub, 
          p.description, 
          p.strength,
          p.cost_price AS costPrice,
          p.stock,
          p.warehouse_stock AS warehouseStock,
          p.min_stock AS minStock,
          p.use_category_image AS useCategoryImage,
          p.has_variants AS hasVariants,
          p.createdAt,
          g.name as groupName,
          g.slug as groupSlug,
          g.cover_image as groupImage
        FROM products p 
        LEFT JOIN categories c ON p.categoryId = c.id
        LEFT JOIN category_groups g ON p.groupId = g.id
        ${where}
        ORDER BY p.createdAt DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset)
    )
  }

  const productIds = rows.map(r => r.id);
  const linksByProduct = new Map();
  const baseImagesByProduct = new Map();
  const variantsByProduct = new Map();
  const variantImagesByProduct = new Map();

  if (productIds.length > 0) {
    for (const chunk of chunkArray(productIds)) {
      const placeholders = chunk.map(() => '?').join(',');

      const linkRows = db.prepare(`
        SELECT productId, label, url, position
        FROM product_links
        WHERE productId IN (${placeholders})
        ORDER BY productId ASC, position ASC
      `).all(...chunk);
      linkRows.forEach(row => {
        pushToMap(linksByProduct, row.productId, { label: row.label ?? '', url: row.url });
      });

      const imageRows = db.prepare(`
        SELECT productId, variant_id AS variantId, url, position
        FROM product_images
        WHERE productId IN (${placeholders})
        ORDER BY productId ASC, variant_id ASC, position ASC
      `).all(...chunk);
      imageRows.forEach(row => {
        if (row.variantId) {
          pushVariantImage(variantImagesByProduct, row.productId, row.variantId, row.url);
        } else {
          pushToMap(baseImagesByProduct, row.productId, row.url);
        }
      });

      const variantRows = db.prepare(`
        SELECT id, product_id, name, color_code AS colorCode, color_image AS colorImage, color_display_mode AS colorDisplayMode, price_rub AS priceRub, stock, warehouse_stock AS warehouseStock, position
        FROM product_variants
        WHERE product_id IN (${placeholders})
        ORDER BY product_id ASC, position ASC
      `).all(...chunk);
      variantRows.forEach(row => {
        pushToMap(variantsByProduct, row.product_id, row);
      });
    }
  }

  const discountsForList = loadDiscountRecords();

  const products = rows.map(r => {
    const product = {
      ...r,
      locationStock: location === 'warehouse' ? Number(r.warehouseStock || 0) : Number(r.stock || 0),
      discount: discountsForList.product.get(String(r.id)) ?? null,
      groupDiscount: r.groupId ? discountsForList.group.get(String(r.groupId)) ?? null : null,
      links: linksByProduct.get(r.id) ?? []
    };

    if (r.hasVariants) {
      const variants = (variantsByProduct.get(r.id) ?? []).filter((variant) => (
        location !== 'warehouse' || Number(variant.warehouseStock || 0) > 0
      ));
      product.variants = variants.map(v => ({
        ...v,
        locationStock: location === 'warehouse' ? Number(v.warehouseStock || 0) : Number(v.stock || 0),
        discount: discountsForList.variant.get(String(v.id)) ?? null,
        images: (variantImagesByProduct.get(r.id)?.get(v.id)) ?? []
      }));

      // Рассчитываем минимальный и максимальный остаток из вариантов
      if (variants.length > 0) {
        const stocks = variants.map(v => Number(v.stock || 0));
        product.minVariantStock = Math.min(...stocks);
        product.maxVariantStock = Math.max(...stocks);
        const warehouseStocks = variants.map(v => Number(v.warehouseStock || 0));
        product.minVariantWarehouseStock = Math.min(...warehouseStocks);
        product.maxVariantWarehouseStock = Math.max(...warehouseStocks);
        const locationStocks = location === 'warehouse' ? warehouseStocks : stocks;
        product.minVariantLocationStock = Math.min(...locationStocks);
        product.maxVariantLocationStock = Math.max(...locationStocks);
      } else {
        product.minVariantStock = 0;
        product.maxVariantStock = 0;
        product.minVariantWarehouseStock = 0;
        product.maxVariantWarehouseStock = 0;
        product.minVariantLocationStock = 0;
        product.maxVariantLocationStock = 0;
      }
    } else {
      product.images = baseImagesByProduct.get(r.id) ?? [];
    }

    return product;
  })

  const availableGroups = listGroupsWithStock(location);

  res.json({
    products,
    availableGroups,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  })
})

/**
 * Линейки, которые реально есть в точке. Для склада это ответ на вопрос «что
 * сейчас можно отгрузить», для розницы отдаём весь справочник: там остаток
 * меняется каждый час, и пустой список сбивал бы с толку.
 */
function listGroupsWithStock(location) {
  if (location !== 'warehouse') {
    return db.prepare('SELECT id, name, categoryId FROM category_groups ORDER BY name COLLATE NOCASE').all();
  }
  return db.prepare(`
    SELECT DISTINCT g.id, g.name, g.categoryId
    FROM category_groups g
    JOIN products p ON p.groupId = g.id
    WHERE (
      (COALESCE(p.has_variants, 0) = 0 AND COALESCE(p.warehouse_stock, 0) > 0)
      OR (COALESCE(p.has_variants, 0) = 1 AND EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.product_id = p.id AND COALESCE(v.warehouse_stock, 0) > 0
      ))
    )
    ORDER BY g.name COLLATE NOCASE
  `).all();
}

/**
 * Линейки для быстрого фильтра в заявке на перемещение: только те, что лежат на
 * складе. В рознице линеек больше двух сотен, лентой их не пролистать, поэтому
 * там фильтра нет и список не запрашивается.
 */
adminRouter.get('/api/admin/inventory/groups', authMiddleware, (_req, res) => {
  try {
    res.json(listGroupsWithStock('warehouse'));
  } catch (error) {
    console.error('[admin] Inventory groups error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

adminRouter.get('/api/admin/inventory/items', authMiddleware, async (req, res) => {
  try {
    const location = req.query.location === 'warehouse' ? 'warehouse' : 'retail';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const groupId = typeof req.query.group_id === 'string' ? req.query.group_id.trim() : '';
    // Ищем без привязки к точке: позиция без остатка в источнике, но с запасом
    // в другой точке, тоже нужна в списке — сразу видно, что перемещение
    // требуется в обратную сторону.
    const items = await searchProductsForCrm({
      search,
      groupId: groupId || undefined,
      limit: Math.min(Math.max(Number(req.query.limit || 100), 1), 200),
    });

    res.json(items
      .map((item) => {
        const retailStock = Number(item.stock || 0);
        const warehouseStock = Number(item.warehouse_stock || 0);
        return {
          ...item,
          category_name: item.category_name || null,
          retail_stock: retailStock,
          warehouse_stock: warehouseStock,
          available_stock: location === 'warehouse' ? warehouseStock : retailStock,
        };
      })
      .filter((item) => item.retail_stock > 0 || item.warehouse_stock > 0));
  } catch (error) {
    console.error('[admin] Inventory items error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

async function getInventoryTransfer(id) {
  const transfer = db.prepare(`
    SELECT st.*,
           COUNT(sti.id) AS item_count,
           COALESCE(SUM(sti.quantity), 0) AS total_quantity
    FROM stock_transfers st
    LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id
    WHERE st.id = ?
    GROUP BY st.id
  `).get(id);
  if (!transfer) return null;
  const items = db.prepare(`
    SELECT sti.id,
           sti.product_id,
           sti.variant_id,
           sti.product_title,
           sti.variant_name,
           sti.quantity,
           p.categoryId AS category_id,
           p.groupId AS group_id,
           COALESCE(sti.category_name, c.name) AS category_name,
           COALESCE(sti.group_name, cg.name) AS group_name,
           sti.image_url AS snapshot_image,
           -- Текущие остатки нужны форме правки черновика: в самой позиции
           -- лежит только количество, а поле ввода ограничивается доступным.
           CASE WHEN sti.variant_id IS NULL THEN COALESCE(p.stock, 0) ELSE COALESCE(pv.stock, 0) END AS retail_stock,
           CASE WHEN sti.variant_id IS NULL THEN COALESCE(p.warehouse_stock, 0) ELSE COALESCE(pv.warehouse_stock, 0) END AS warehouse_stock,
           COALESCE(
             (SELECT url FROM product_images WHERE productId = sti.product_id AND variant_id = sti.variant_id ORDER BY position LIMIT 1),
             (SELECT url FROM product_images WHERE productId = sti.product_id AND variant_id IS NULL ORDER BY position LIMIT 1)
           ) AS product_image,
           cg.cover_image AS group_image,
           c.cover_image AS category_image
    FROM stock_transfer_items sti
    LEFT JOIN products p ON p.id = sti.product_id
    LEFT JOIN product_variants pv ON pv.id = sti.variant_id
    LEFT JOIN categories c ON c.id = p.categoryId
    LEFT JOIN category_groups cg ON cg.id = p.groupId
    WHERE sti.transfer_id = ?
    ORDER BY sti.rowid ASC
  `).all(id);
  transfer.items = await Promise.all(items.map(async (item) => {
    const {
      snapshot_image: snapshotImage,
      group_image: groupImage,
      category_image: categoryImage,
      category_id: categoryId,
      group_id: groupId,
      ...details
    } = item;
    const productImage = await resolveFirstImageThumbnail([
      { source: snapshotImage, meta: { sourceType: 'transfer', sourceId: item.id, sourceField: 'stock_transfer_items.image_url' } },
      { source: item.product_image, meta: { sourceType: 'product', sourceId: item.product_id, sourceField: 'product_images.url' } },
      { source: groupImage, meta: { sourceType: 'group', sourceId: groupId, sourceField: 'category_groups.cover_image' } },
      { source: categoryImage, meta: { sourceType: 'category', sourceId: categoryId, sourceField: 'categories.cover_image' } },
    ]);
    return { ...details, product_image: productImage };
  }));
  return transfer;
}

/**
 * Позиции заявки на перемещение. Одна и та же проверка нужна и при создании
 * заявки, и при правке черновика, поэтому живёт отдельно: разъехавшиеся
 * проверки означали бы, что через правку можно записать то, что не пропускает
 * создание.
 */
function insertTransferItems({ transferId, sourceLocation, items }) {
  const sourceColumn = sourceLocation === 'warehouse' ? 'warehouse_stock' : 'stock';
  const insertItem = db.prepare(`
    INSERT INTO stock_transfer_items (
      id, transfer_id, product_id, variant_id, product_title, variant_name,
      category_name, group_name, image_url, quantity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seenItems = new Set();
  for (const rawItem of items) {
    const productId = String(rawItem?.product_id || '').trim();
    const variantId = rawItem?.variant_id ? String(rawItem.variant_id) : null;
    const quantity = Number(rawItem?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('invalid_item');
    }

    const product = db.prepare(`
      SELECT p.id,
             p.title,
             p.has_variants,
             p.groupId,
             c.name AS category_name,
             c.cover_image AS category_image,
             cg.name AS group_name,
             cg.cover_image AS group_image
      FROM products p
      LEFT JOIN categories c ON c.id = p.categoryId
      LEFT JOIN category_groups cg ON cg.id = p.groupId
      WHERE p.id = ?
    `).get(productId);
    if (!product) throw new Error('product_not_found');

    const table = variantId ? 'product_variants' : 'products';
    const rowId = variantId || productId;
    if (seenItems.has(rowId)) throw new Error('duplicate_item');
    seenItems.add(rowId);
    let variantName = null;
    if (variantId) {
      const variant = db.prepare('SELECT id, product_id, name FROM product_variants WHERE id = ?').get(variantId);
      if (!variant || variant.product_id !== productId) throw new Error('variant_not_found');
      if (Number(product.has_variants || 0) !== 1) {
        throw new Error('variant_not_allowed');
      }
      variantName = variant.name || null;
    } else if (Number(product.has_variants || 0) === 1) {
      throw new Error('variant_required');
    }

    const productImage = db.prepare(`
      SELECT url
      FROM product_images
      WHERE productId = ?
        AND (variant_id = ? OR variant_id IS NULL)
      ORDER BY CASE
                 WHEN variant_id = ? THEN 0
                 WHEN variant_id IS NULL THEN 1
               END,
               position ASC
      LIMIT 1
    `).get(productId, variantId, variantId)?.url || null;

    const stockRow = db.prepare(`SELECT ${sourceColumn} AS available FROM ${table} WHERE id = ?`).get(rowId);
    if (Number(stockRow?.available || 0) < quantity) {
      throw new Error(`insufficient_stock:${rowId}`);
    }

    insertItem.run(
      `move_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      transferId,
      productId,
      variantId,
      product.title || productId,
      variantName,
      product.category_name || null,
      product.group_name || null,
      productImage || product.group_image || product.category_image || null,
      quantity,
    );
  }
}

function inventoryActor(req) {
  return String(req.user?.u || req.user?.username || 'admin');
}

adminRouter.get('/api/admin/inventory/transfers', authMiddleware, (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM stock_transfers').get()?.count || 0);
  const transfers = db.prepare(`
    SELECT st.*,
           COUNT(sti.id) AS item_count,
           COALESCE(SUM(sti.quantity), 0) AS total_quantity
    FROM stock_transfers st
    LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id
    GROUP BY st.id
    ORDER BY CASE WHEN st.status = 'draft' THEN 0 ELSE 1 END,
             st.created_at DESC,
             st.transfer_number DESC
    LIMIT ? OFFSET ?
  `).all(limit, (page - 1) * limit);
  res.json({
    transfers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

adminRouter.get('/api/admin/inventory/transfers/:id', authMiddleware, async (req, res) => {
  try {
    const transfer = await getInventoryTransfer(req.params.id);
    if (!transfer) return res.status(404).json({ error: 'not_found' });
    res.json(transfer);
  } catch (error) {
    console.error('[admin] Get inventory transfer error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

adminRouter.post(
  '/api/admin/inventory/transfers',
  authMiddleware,
  requireInventoryActor,
  async (req, res) => {
  try {
    const { source_location: source, destination_location: destination, comment, items } = req.body || {};
    const locations = new Set(['retail', 'warehouse']);
    if (!locations.has(source) || !locations.has(destination) || source === destination) {
      return res.status(400).json({ error: 'invalid_direction' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items_required' });
    }

    let transferId = `move_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let nextNumber = 0;
    const trackingEnabled = isStaffTrackingEnabled();
    const idempotencyKey = trackingEnabled
      ? requestIdempotencyKey(req)
      : null;
    if (trackingEnabled && !idempotencyKey) {
      throw new StaffServiceError('idempotency_key_required', 400);
    }

    const executeCreate = () => {
      const tx = db.transaction(() => {
      const staffActor = recheckInventoryActor(req);
      const actorName = staffActor?.employeeName || inventoryActor(req);
      nextNumber = Number(db.prepare('SELECT MAX(transfer_number) AS value FROM stock_transfers').get()?.value || 0) + 1;
      db.prepare(`
        INSERT INTO stock_transfers (
          id, transfer_number, source_location, destination_location, comment,
          status, created_by, created_by_employee_id
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
      `).run(
        transferId,
        nextNumber,
        source,
        destination,
        String(comment || '').trim() || null,
        actorName,
        staffActor?.employeeId || null,
      );

      insertTransferItems({ transferId, sourceLocation: source, items });

      if (staffActor) {
        const eventKey = `transfer:${transferId}:created`;
        recordSystemStaffEvent({
          employeeId: staffActor.employeeId,
          eventType: 'transfer_created',
          entityType: 'stock_transfer',
          entityId: transferId,
          idempotencyKey: eventKey,
          sourceNumber: nextNumber,
          sourceType: 'transfer',
          sourceName: `${inventoryLocationLabel(source)} → ${inventoryLocationLabel(destination)}`,
          payload: {
            source_location: source,
            destination_location: destination,
            item_count: items.length,
          },
        });
        enqueueInternalNotificationForGroup(db, {
          eventGroup: 'documents',
          uniqueKey: eventKey,
          eventType: 'transfer.created',
          payload: {
            document_number: nextNumber,
            from_location: inventoryLocationLabel(source),
            to_location: inventoryLocationLabel(destination),
            employee_name: staffActor.employeeName,
          },
        });
      }
      });

      if (trackingEnabled) {
        tx();
      } else {
        tx.immediate();
      }
      return { id: transferId };
    };

    if (trackingEnabled) {
      const operationResult = unwrapStaffOperation(
        runStaffIdempotentOperation({
          key: idempotencyKey,
          operation: staffOperationName('transfer.create', req.body),
          entityType: 'stock_transfer',
          execute: executeCreate,
        }),
      );
      transferId = operationResult.result.id;
    } else {
      executeCreate();
    }
    res.json(await getInventoryTransfer(transferId));
  } catch (error) {
    console.error('[admin] Create inventory transfer error:', error);
    if (isStaffServiceError(error)) {
      return sendStaffServiceError(res, error);
    }
    const clientError = String(error.message || '');
    if (
      [
        'invalid_item',
        'duplicate_item',
        'product_not_found',
        'variant_not_found',
        'variant_required',
        'variant_not_allowed',
      ].includes(clientError)
      || clientError.startsWith('insufficient_stock:')
    ) {
      return res.status(400).json({ error: clientError });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
  },
);

/**
 * Правка черновика.
 *
 * Заявку заводят заранее, а собирают товар потом, поэтому забытую позицию
 * должно быть можно дописать, не заводя вторую заявку на то же перемещение.
 * Меняются только состав и комментарий: направление остаётся тем, что выбрали
 * при создании, иначе проверка остатков считала бы не ту точку.
 */
adminRouter.put(
  '/api/admin/inventory/transfers/:id',
  authMiddleware,
  requireInventoryActor,
  async (req, res) => {
    try {
      const { comment, items, expected_updated_at: expectedUpdatedAt } = req.body || {};
      const transferId = String(req.params.id);

      // Без ключа идемпотентности, в отличие от создания: правка передаёт
      // состав целиком и защищена условием `status = 'draft'`, поэтому повтор
      // безопасен сам по себе. С ключом было бы хуже: второе сохранение с
      // исправленной цифрой попало бы в конфликт ключа и не прошло.
      const tx = db.transaction(() => {
      const staffActor = recheckInventoryActor(req);
      const transfer = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(transferId);
      if (!transfer) throw new StaffServiceError('not_found', 404);
      if (transfer.status !== 'draft') throw new StaffServiceError('invalid_status', 409);
      if (!Array.isArray(items) || items.length === 0) {
        throw new StaffServiceError('items_required', 400);
      }
      // Заявку мог править кто-то ещё, пока эта форма была открыта. Молча
      // затирать чужую правку нельзя: состав заменяется целиком.
      if (
        expectedUpdatedAt !== undefined
        && String(expectedUpdatedAt ?? '') !== String(transfer.updated_at ?? '')
      ) {
        throw new StaffServiceError('stale_transfer', 409);
      }

      db.prepare('DELETE FROM stock_transfer_items WHERE transfer_id = ?').run(transferId);
      insertTransferItems({
        transferId,
        sourceLocation: transfer.source_location,
        items,
      });

      const updated = db.prepare(`
        UPDATE stock_transfers
        SET comment = ?,
            updated_by = ?,
            updated_by_employee_id = ?,
            updated_at = DATETIME('now')
        WHERE id = ? AND status = 'draft'
      `).run(
        String(comment || '').trim() || null,
        staffActor?.employeeName || inventoryActor(req),
        staffActor?.employeeId || null,
        transferId,
      );
      // Заявку могли оприходовать, пока её правили. Тогда откатываемся:
      // менять состав проведённого документа нельзя.
      if (updated.changes !== 1) {
        throw new StaffServiceError('invalid_status', 409);
      }
      });

      tx.immediate();
      res.json(await getInventoryTransfer(transferId));
    } catch (error) {
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      const clientError = String(error.message || '');
      if (
        [
          'invalid_item',
          'duplicate_item',
          'product_not_found',
          'variant_not_found',
          'variant_required',
          'variant_not_allowed',
        ].includes(clientError)
        || clientError.startsWith('insufficient_stock:')
      ) {
        return res.status(400).json({ error: clientError });
      }
      console.error('[admin] Update inventory transfer error:', error);
      res.status(500).json({ error: 'failed', message: error.message });
    }
  },
);

adminRouter.post(
  '/api/admin/inventory/transfers/:id/complete',
  authMiddleware,
  requireInventoryActor,
  async (req, res) => {
  const affectedGroupIds = new Set();
  try {
    const tx = db.transaction(() => {
      const staffActor = recheckInventoryActor(req);
      const transfer = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(req.params.id);
      if (!transfer) throw new Error('not_found');
      if (transfer.status !== 'draft') throw new Error('invalid_status');

      const sourceColumn = transfer.source_location === 'warehouse' ? 'warehouse_stock' : 'stock';
      const destinationColumn = transfer.destination_location === 'warehouse' ? 'warehouse_stock' : 'stock';
      const items = db.prepare(`
        SELECT product_id, variant_id, quantity
        FROM stock_transfer_items
        WHERE transfer_id = ?
        ORDER BY rowid ASC
      `).all(transfer.id);
      if (!items.length) throw new Error('items_required');

      for (const item of items) {
        const product = db.prepare(
          'SELECT id, groupId, has_variants FROM products WHERE id = ?',
        ).get(item.product_id);
        if (!product) throw new Error('product_not_found');
        if (product.groupId) affectedGroupIds.add(product.groupId);

        const table = item.variant_id ? 'product_variants' : 'products';
        const rowId = item.variant_id || item.product_id;
        if (item.variant_id) {
          const variant = db.prepare('SELECT product_id FROM product_variants WHERE id = ?').get(item.variant_id);
          if (!variant || variant.product_id !== item.product_id) throw new Error('variant_not_found');
          if (Number(product.has_variants || 0) !== 1) {
            throw new Error('variant_not_allowed');
          }
        } else if (Number(product.has_variants || 0) === 1) {
          throw new Error('variant_required');
        }
        const quantity = Number(item.quantity || 0);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error('invalid_item');
        }
        const stockRow = db.prepare(`SELECT ${sourceColumn} AS available FROM ${table} WHERE id = ?`).get(rowId);
        if (Number(stockRow?.available || 0) < quantity) {
          throw new Error(`insufficient_stock:${rowId}`);
        }
        const moved = db.prepare(`
          UPDATE ${table}
          SET ${sourceColumn} = ${sourceColumn} - ?,
              ${destinationColumn} = ${destinationColumn} + ?
          WHERE id = ? AND ${sourceColumn} >= ?
        `).run(quantity, quantity, rowId, quantity);
        if (moved.changes !== 1) {
          throw new Error(`inventory_conflict:${rowId}`);
        }
      }

      const updated = db.prepare(`
        UPDATE stock_transfers
        SET status = 'completed',
            completed_by = ?,
            completed_by_employee_id = ?,
            completed_at = DATETIME('now')
        WHERE id = ? AND status = 'draft'
      `).run(
        staffActor?.employeeName || inventoryActor(req),
        staffActor?.employeeId || null,
        transfer.id,
      );
      if (updated.changes !== 1) throw new Error('invalid_status');

      if (staffActor) {
        const eventKey = `transfer:${transfer.id}:accepted`;
        recordSystemStaffEvent({
          employeeId: staffActor.employeeId,
          eventType: 'transfer_accepted',
          entityType: 'stock_transfer',
          entityId: transfer.id,
          idempotencyKey: eventKey,
          sourceNumber: transfer.transfer_number,
          sourceType: 'transfer',
          sourceName: `${inventoryLocationLabel(transfer.source_location)} → ${inventoryLocationLabel(transfer.destination_location)}`,
          payload: {
            source_location: transfer.source_location,
            destination_location: transfer.destination_location,
            item_count: items.length,
          },
        });
        enqueueInternalNotificationForGroup(db, {
          eventGroup: 'documents',
          uniqueKey: eventKey,
          eventType: 'transfer.accepted',
          payload: {
            document_number: transfer.transfer_number,
            to_location: inventoryLocationLabel(transfer.destination_location),
            employee_name: staffActor.employeeName,
          },
        });
      }
    });

    tx.immediate();
    affectedGroupIds.forEach((groupId) => {
      try {
        syncGroupParking(groupId);
      } catch (error) {
        console.error('[admin] Inventory transfer group parking sync failed:', error);
      }
    });
    res.json(await getInventoryTransfer(req.params.id));
  } catch (error) {
    console.error('[admin] Complete inventory transfer error:', error);
    if (isStaffServiceError(error)) {
      return sendStaffServiceError(res, error);
    }
    const clientError = String(error.message || '');
    if (clientError === 'not_found') return res.status(404).json({ error: clientError });
    if (clientError === 'invalid_status') return res.status(409).json({ error: clientError });
    if (
      [
        'items_required',
        'invalid_item',
        'product_not_found',
        'variant_not_found',
        'variant_required',
        'variant_not_allowed',
      ].includes(clientError)
      || clientError.startsWith('insufficient_stock:')
      || clientError.startsWith('inventory_conflict:')
    ) {
      return res.status(400).json({ error: clientError });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
  },
);

adminRouter.post(
  '/api/admin/inventory/transfers/:id/cancel',
  authMiddleware,
  requireInventoryActor,
  async (req, res) => {
    try {
      const tx = db.transaction(() => {
        const staffActor = recheckInventoryActor(req);
        const updated = db.prepare(`
          UPDATE stock_transfers
          SET status = 'cancelled',
              cancelled_by = ?,
              cancelled_by_employee_id = ?,
              cancelled_at = DATETIME('now')
          WHERE id = ? AND status = 'draft'
        `).run(
          staffActor?.employeeName || inventoryActor(req),
          staffActor?.employeeId || null,
          req.params.id,
        );
        if (updated.changes !== 1) {
          const exists = db
            .prepare('SELECT 1 FROM stock_transfers WHERE id = ?')
            .get(req.params.id);
          throw new Error(exists ? 'invalid_status' : 'not_found');
        }
        // Событие создания удалить нельзя, журнал неизменяемый. Пишем отмену
        // рядом, чтобы в карточке сотрудника было видно, чем всё закончилось.
        if (staffActor) {
          const transfer = db.prepare(`
            SELECT transfer_number, source_location, destination_location
            FROM stock_transfers WHERE id = ?
          `).get(req.params.id);
          recordSystemStaffEvent({
            employeeId: staffActor.employeeId,
            eventType: 'transfer_cancelled',
            entityType: 'stock_transfer',
            entityId: req.params.id,
            idempotencyKey: `transfer:${req.params.id}:cancelled`,
            sourceNumber: transfer?.transfer_number ?? null,
            sourceType: 'transfer',
            sourceName: transfer
              ? `${inventoryLocationLabel(transfer.source_location)} → ${inventoryLocationLabel(transfer.destination_location)}`
              : null,
            payload: {},
          });
        }
      });
      tx.immediate();
      res.json(await getInventoryTransfer(req.params.id));
    } catch (error) {
      console.error('[admin] Cancel inventory transfer error:', error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      const clientError = String(error.message || '');
      if (clientError === 'not_found') {
        return res.status(404).json({ error: clientError });
      }
      if (clientError === 'invalid_status') {
        return res.status(409).json({ error: clientError });
      }
      res.status(500).json({ error: 'failed', message: error.message });
    }
  },
);

adminRouter.get('/api/admin/products/:id', authMiddleware, (req, res) => {
  const id = req.params.id
  const p = db.prepare(`
    SELECT 
      p.id,
      p.categoryId,
      p.groupId,
      p.title,
      p.priceRub,
      p.description,
      p.strength,
      p.cost_price AS costPrice,
      p.stock,
      p.warehouse_stock AS warehouseStock,
      p.min_stock AS minStock,
      p.use_category_image AS useCategoryImage,
      p.has_variants AS hasVariants,
      p.createdAt,
      g.name as groupName,
      g.slug as groupSlug
    FROM products p
    LEFT JOIN category_groups g ON p.groupId = g.id
    WHERE p.id = ?
  `).get(id)
  if (!p) return res.status(404).json({ error: 'not_found' })
  
  const links = db.prepare('SELECT label, url FROM product_links WHERE productId = ? ORDER BY position ASC').all(id).map(row => ({
    label: row.label ?? '',
    url: row.url
  }))
  
  const result = { ...p, links, discount: getDiscountRecord('product', id) };
  
  if (p.hasVariants) {
    // Для товаров с вариантами получаем варианты и их изображения
    const variants = db.prepare(`
      SELECT id, product_id, name, color_code AS colorCode, color_image AS colorImage, color_display_mode AS colorDisplayMode, price_rub AS priceRub, stock, warehouse_stock AS warehouseStock, position
      FROM product_variants
      WHERE product_id = ?
      ORDER BY position ASC
    `).all(id);
    
    result.variants = variants.map(v => ({
      ...v,
      discount: getDiscountRecord('variant', v.id),
      images: db.prepare('SELECT url FROM product_images WHERE productId = ? AND variant_id = ? ORDER BY position ASC')
        .all(id, v.id).map(r => r.url)
    }));
    
    // Рассчитываем минимальный и максимальный остаток из вариантов
    if (variants.length > 0) {
      const stocks = variants.map(v => Number(v.stock || 0));
      result.minVariantStock = Math.min(...stocks);
      result.maxVariantStock = Math.max(...stocks);
    } else {
      result.minVariantStock = 0;
      result.maxVariantStock = 0;
    }
  } else {
    // Обычный товар - получаем изображения без variant_id
    result.images = db.prepare('SELECT url FROM product_images WHERE productId = ? AND variant_id IS NULL ORDER BY position ASC')
      .all(id).map(r => r.url);
  }
  
  res.json(result)
})

adminRouter.patch('/api/admin/products/:id/images/reorder', authMiddleware, (req, res) => {
  const id = req.params.id;
  const { urls } = req.body || {};
  if (!Array.isArray(urls)) return res.status(400).json({ error: 'urls_required' });
  const tx = db.transaction((arr) => {
    db.prepare('DELETE FROM product_images WHERE productId = ?').run(id);
    const stmt = db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)');
    arr.forEach((u, i) => stmt.run(id, u, i));
  });
  tx(urls);
  res.json({ ok: true });
});

adminRouter.delete('/api/admin/products/:id/images', authMiddleware, (req, res) => {
  const id = req.params.id;
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url_required' });
  const rows = db.prepare('SELECT url FROM product_images WHERE productId = ? ORDER BY position ASC').all(id).map(r => r.url);
  const next = rows.filter(u => u !== url);
  const tx = db.transaction((arr) => {
    db.prepare('DELETE FROM product_images WHERE productId = ?').run(id);
    const stmt = db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)');
    arr.forEach((u, i) => stmt.run(id, u, i));
  });
  tx(next);
  res.json({ ok: true });
});

// Categories CRUD
adminRouter.get('/api/admin/categories', authMiddleware, (req, res) => {
  try {
    // НЕ выбираем cover_image в списке - экономим трафик
    const rows = db.prepare(`
      SELECT c.id, c.slug, c.name, c.[order], c.hide_empty, 
        CASE WHEN c.cover_image IS NOT NULL AND c.cover_image != '' THEN 1 ELSE 0 END as has_cover_image,
        c.display_mode, c.storefront_filters_profile, COUNT(p.id) as productCount
      FROM categories c
      LEFT JOIN products p ON c.id = p.categoryId
      GROUP BY c.id, c.slug, c.name, c.[order], c.hide_empty, c.display_mode, c.storefront_filters_profile
      ORDER BY c.[order] ASC, c.name ASC
    `).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'failed', details: String(e) });
  }
});

// Получить изображение категории отдельно
adminRouter.get('/api/admin/categories/:id/image', authMiddleware, (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT cover_image FROM categories WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json({ cover_image: row.cover_image || null });
});

// Получить одну категорию со всеми данными
adminRouter.get('/api/admin/categories/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const row = db.prepare(`
    SELECT c.id, c.slug, c.name, c.[order], c.hide_empty, c.cover_image, c.display_mode,
           c.storefront_filters_profile
    FROM categories c
    WHERE c.id = ?
  `).get(id);
  
  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }
  
  const productCount = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE categoryId = ?').get(id)?.cnt || 0;
  
  res.json({
    ...row,
    productCount: Number(productCount)
  });
});

// Banners CRUD
adminRouter.get('/api/admin/banners', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id, title, image, href, active, [order], openInNewTab FROM banners ORDER BY [order] ASC').all();
  res.json(rows);
});

adminRouter.post('/api/admin/banners', authMiddleware, (req, res) => {
  const { title, image, href, active = true, order, openInNewTab = false } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image_required' });
  
  
  const id = 'b_' + Math.random().toString(36).slice(2, 8);
  
  // Определяем порядок автоматически, если не указан
  let finalOrder = order;
  if (!Number.isFinite(finalOrder)) {
    const maxOrder = db.prepare('SELECT MAX([order]) as maxOrder FROM banners').get();
    finalOrder = (maxOrder?.maxOrder || 0) + 1;
  }
  
  console.log('[admin] Creating banner with data:', { id, title, image, href, active, order: finalOrder, openInNewTab });
  
  // Создаём баннер
  db.prepare('INSERT INTO banners (id, title, image, href, active, [order], openInNewTab) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, title || null, image, href || null, active ? 1 : 0, finalOrder, openInNewTab ? 1 : 0);
  
  // Возвращаем полные данные созданного баннера
  res.json({
    id,
    title: title || null,
    image,
    href: href || null,
    active: active ? 1 : 0,
    order: finalOrder,
    openInNewTab: openInNewTab ? 1 : 0
  });
});

adminRouter.patch('/api/admin/banners/reorder', authMiddleware, (req, res) => {
  console.log('🔥 [server] Banners reorder endpoint called')
  console.log('🔥 [server] request.body:', JSON.stringify(req.body, null, 2))
  
  const { banners } = req.body || {};
  console.log('🔥 [server] Extracted banners:', banners)
  
  if (!Array.isArray(banners)) {
    console.log('🔥 [server] ERROR: banners is not array:', banners)
    return res.status(400).json({ error: 'banners_required' })
  }
  
  // Проверим каждый баннер
  for (const banner of banners) {
    if (!banner.id || !Number.isFinite(banner.order)) {
      console.log('🔥 [server] ERROR: invalid banner:', banner)
      return res.status(400).json({ error: 'invalid_banner_data' })
    }
  }
  
  try {
    const stmt = db.prepare('UPDATE banners SET [order] = ? WHERE id = ?')
    const tx = db.transaction((bannersToReorder) => {
      for (const banner of bannersToReorder) {
        const result = stmt.run(banner.order, banner.id)
        if (result.changes === 0) {
          throw new Error(`Banner not found: ${banner.id}`)
        }
      }
    })
    
    tx(banners)
    console.log('🔥 [server] Banners reordered successfully!')
    res.json({ success: true, message: 'Banners reordered' })
  } catch (error) {
    console.error('🔥 [server] Reorder error:', error)
    res.status(500).json({ error: 'reorder_failed', message: error.message })
  }
});

adminRouter.patch('/api/admin/banners/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const { title, image, href, active, order, openInNewTab } = req.body || {};
  const cur = db.prepare('SELECT * FROM banners WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  
  
  // Обновляем баннер
  db.prepare('UPDATE banners SET title = ?, image = ?, href = ?, active = ?, [order] = ?, openInNewTab = ? WHERE id = ?')
    .run(
      (title !== undefined ? title : cur.title),
      (image !== undefined ? image : cur.image), 
      (href !== undefined ? href : cur.href), 
      (active !== undefined ? (active ? 1 : 0) : cur.active), 
      (Number.isFinite(order) ? order : cur.order),
      (openInNewTab !== undefined ? (openInNewTab ? 1 : 0) : (cur.openInNewTab || 0)), 
      id
    );
  
  // Возвращаем обновлённые данные
  const updated = db.prepare('SELECT * FROM banners WHERE id = ?').get(id);
  res.json({
    id: updated.id,
    title: updated.title,
    image: updated.image,
    href: updated.href,
    active: updated.active, // оставляем как integer для совместимости
    order: updated.order,
    openInNewTab: updated.openInNewTab || 0
  });
});

adminRouter.delete('/api/admin/banners/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM banners WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Categories CRUD
adminRouter.post('/api/admin/categories', authMiddleware, async (req, res) => {
  const {
    name,
    order,
    hide_empty,
    coverImage,
    cover_image,
    displayMode,
    display_mode,
    storefrontFiltersProfile,
    storefront_filters_profile,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  // Проверяем дубликаты по имени сразу
  const existingByName = db.prepare('SELECT id, name FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))').get(name);
  if (existingByName) {
    console.log('[admin] Name conflict detected during creation with category:', existingByName);
    return res.status(400).json({ 
      error: 'duplicate_category_name', 
      message: `Категория с таким названием уже существует: "${existingByName.name}"`,
      conflictingCategory: existingByName.name
    });
  }
  
  let baseSlug;
  try {
    baseSlug = slugify(name, { lower: true, strict: true });
  } catch (slugError) {
    console.error('[admin] Slugify error in create:', slugError);
    // Fallback to simple slug generation
    baseSlug = name.toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    console.log('[admin] Fallback slug generated in create:', baseSlug);
  }
  let slug = baseSlug;
  let counter = 1;
  
  // Проверяем уникальность slug и добавляем суффикс при необходимости
  while (true) {
    const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); // более уникальный ID

  const allowedDisplayModes = new Set(['default', 'liquid', 'visual']);
  let displayModeValue = String(displayMode ?? display_mode ?? 'default').trim().toLowerCase();
  if (!allowedDisplayModes.has(displayModeValue)) {
    displayModeValue = 'default';
  }

  let storefrontFiltersProfileValue = 'none';
  try {
    storefrontFiltersProfileValue = normalizeStorefrontFiltersProfile(
      storefrontFiltersProfile ?? storefront_filters_profile ?? 'none',
    );
  } catch (error) {
    return res.status(400).json({ error: 'invalid_storefront_filters_profile' });
  }
  
  // Получаем следующий order если не указан
  let finalOrder = order;
  if (!Number.isFinite(finalOrder)) {
    const maxOrder = db.prepare('SELECT MAX([order]) as maxOrder FROM categories').get();
    finalOrder = (maxOrder?.maxOrder || 0) + 1;
  }
  try {
    const hideEmptyValue = hide_empty ? 1 : 0;
    // Конвертируем изображение в WebP для экономии места и сохранения прозрачности
    const rawCoverImage = coverImage ?? cover_image ?? null;
    const coverImageValue = rawCoverImage ? await convertImageToWebP(rawCoverImage) : null;
    db.prepare('INSERT INTO categories (id, slug, name, [order], hide_empty, cover_image, display_mode, storefront_filters_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, slug, name, finalOrder, hideEmptyValue, coverImageValue, displayModeValue, storefrontFiltersProfileValue);
    res.json({
      ok: true,
      id,
      slug,
      name,
      order: finalOrder,
      hide_empty: hideEmptyValue,
      cover_image: coverImageValue,
      display_mode: displayModeValue,
      storefront_filters_profile: storefrontFiltersProfileValue,
    });
  } catch (e) {
    console.error('[admin] Category creation failed:', e.message);
    res.status(400).json({ error: 'insert_failed', message: e.message, details: String(e) });
  }
});
adminRouter.put('/api/admin/categories/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const {
    name,
    slug,
    order,
    hide_empty,
    coverImage,
    cover_image,
    displayMode,
    display_mode,
    storefrontFiltersProfile,
    storefront_filters_profile,
  } = req.body || {};
  try {
    const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    console.log('[admin] Current category in DB:', cur);
    
    if (!cur) return res.status(404).json({ error: 'not_found' });
    
    // Если меняется имя, сначала проверяем дубликаты по имени
    if (name && name !== cur.name) {
      const existingByName = db.prepare('SELECT id, name FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ?').get(name, id);
      if (existingByName) {
        console.log('[admin] Name conflict detected with category:', existingByName);
        return res.status(400).json({ 
          error: 'duplicate_category_name', 
          message: `Категория с таким названием уже существует: "${existingByName.name}"`,
          conflictingCategory: existingByName.name
        });
      }
    }
    
    let newSlug = slug;
    if (name && !slug) {
      try {
        newSlug = slugify(name, { lower: true, strict: true });
        console.log('[admin] Generated new slug:', newSlug);
        
        // Проверяем уникальность slug (исключая текущую категорию)
        const existingCategory = db.prepare('SELECT id, name FROM categories WHERE slug = ? AND id != ?').get(newSlug, id);
        if (existingCategory) {
          console.log('[admin] Slug conflict detected with category:', existingCategory);
          return res.status(400).json({ 
            error: 'duplicate_category_slug', 
            message: `Категория с похожим названием уже существует: "${existingCategory.name}"`,
            conflictingCategory: existingCategory.name
          });
        }
      } catch (slugError) {
        console.error('[admin] Slugify error:', slugError);
        // Fallback to simple slug generation
        newSlug = name.toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        console.log('[admin] Fallback slug generated:', newSlug);
        
        // Проверяем уникальность fallback slug тоже
        const existingCategory = db.prepare('SELECT id, name FROM categories WHERE slug = ? AND id != ?').get(newSlug, id);
        if (existingCategory) {
          console.log('[admin] Fallback slug conflict detected with category:', existingCategory);
          return res.status(400).json({ 
            error: 'duplicate_category', 
            message: `Категория с таким названием уже существует: "${existingCategory.name}"`,
            conflictingCategory: existingCategory.name
          });
        }
      }
    }
    
    const allowedDisplayModes = new Set(['default', 'liquid', 'visual']);
    let displayModeValue = cur.display_mode || 'default';
    if (displayMode !== undefined || display_mode !== undefined) {
      const incoming = String(displayMode ?? display_mode ?? '').trim().toLowerCase();
      displayModeValue = allowedDisplayModes.has(incoming) ? incoming : 'default';
    }

    // Обрабатываем cover_image с конвертацией в WebP
    let coverImageValue = cur.cover_image ?? null;
    const incomingCoverImage = coverImage !== undefined ? coverImage : cover_image;
    if (incomingCoverImage !== undefined) {
      if (incomingCoverImage === null) {
        coverImageValue = null;
      } else {
        const trimmed = String(incomingCoverImage).trim();
        if (trimmed.length) {
          // Конвертируем в WebP для экономии места и сохранения прозрачности
          coverImageValue = await convertImageToWebP(trimmed);
        } else {
          coverImageValue = null;
        }
      }
    }

    let storefrontFiltersProfileValue = cur.storefront_filters_profile || 'none';
    if (storefrontFiltersProfile !== undefined || storefront_filters_profile !== undefined) {
      try {
        storefrontFiltersProfileValue = normalizeStorefrontFiltersProfile(
          storefrontFiltersProfile ?? storefront_filters_profile,
        );
      } catch (error) {
        return res.status(400).json({ error: 'invalid_storefront_filters_profile' });
      }
    }

    const next = {
      name: name !== undefined ? name : cur.name,
      slug: newSlug !== undefined ? newSlug : cur.slug,
      order: Number.isFinite(order) ? Number(order) : cur.order,
      hide_empty: hide_empty !== undefined ? (hide_empty ? 1 : 0) : cur.hide_empty,
      cover_image: coverImageValue,
      display_mode: displayModeValue,
      storefront_filters_profile: storefrontFiltersProfileValue,
    };
    
    const updateResult = db.prepare('UPDATE categories SET name = ?, slug = ?, [order] = ?, hide_empty = ?, cover_image = ?, display_mode = ?, storefront_filters_profile = ? WHERE id = ?')
      .run(next.name, next.slug, next.order, next.hide_empty, next.cover_image, next.display_mode, next.storefront_filters_profile, id);
    console.log('[admin] Update result:', updateResult);
    console.log('[admin] Update completed successfully');
    refreshProductSearchIndex('category update');
    res.json({ id, ...next });
  } catch (e) {
    console.error('[admin] Category update error:', e);
    console.error('[admin] Error stack:', e.stack);
    res.status(500).json({ error: 'failed', details: String(e), stack: e.stack });
  }
});

adminRouter.patch('/api/admin/categories/reorder', authMiddleware, (req, res) => {
  console.log('🔥 [server] Categories reorder endpoint called')
  console.log('🔥 [server] request.body:', JSON.stringify(req.body, null, 2))
  
  const { categories } = req.body || {}
  console.log('🔥 [server] Extracted categories:', categories)
  
  if (!Array.isArray(categories)) {
    console.log('🔥 [server] ERROR: categories is not array:', categories)
    return res.status(400).json({ error: 'categories_required' })
  }
  
  // Проверим каждую категорию
  for (const cat of categories) {
    if (!cat.id || !Number.isFinite(cat.order)) {
      console.log('🔥 [server] ERROR: invalid category:', cat)
      return res.status(400).json({ error: 'invalid_category_data' })
    }
  }
  
  try {
    const stmt = db.prepare('UPDATE categories SET [order] = ? WHERE id = ?')
    const tx = db.transaction((cats) => {
      for (const cat of cats) {
        const result = stmt.run(cat.order, cat.id)
        if (result.changes === 0) {
          throw new Error(`Category not found: ${cat.id}`)
        }
      }
    })
    
    tx(categories)
    console.log('🔥 [server] Categories reordered successfully!')
    res.json({ success: true, message: 'Categories reordered' })
  } catch (error) {
    console.error('🔥 [server] Reorder error:', error)
    res.status(500).json({ error: 'reorder_failed', message: error.message })
  }
})

adminRouter.delete('/api/admin/categories/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  refreshProductSearchIndex('category delete');
  res.json({ ok: true });
});

// Category groups CRUD
adminRouter.get('/api/admin/wholesale-links', authMiddleware, (req, res) => {
  try {
    const tiers = getWholesaleCoverageSummary().map((tier) => ({
      id: tier.id,
      code: tier.code,
      label: tier.label,
      min_order_amount: Number(tier.minOrderAmount ?? 0),
      sort_order: Number(tier.sortOrder ?? 0),
      path: buildWholesaleLinkPath(tier),
      total_target_groups: Number(tier.totalTargetGroups ?? 0),
      filled_group_count: Number(tier.filledGroupCount ?? 0),
      missing_group_count: Number(tier.missingGroupCount ?? 0),
    }));

    return res.json({ tiers });
  } catch (error) {
    console.error('[admin] Failed to build wholesale links:', error);
    return res.status(500).json({ error: 'wholesale_links_failed', message: error.message });
  }
});

adminRouter.get('/api/admin/category-groups', authMiddleware, (req, res) => {
  const { categoryId } = req.query;
  const params = [];
  let whereClause = '';

  if (categoryId) {
    whereClause = 'WHERE g.categoryId = ?';
    params.push(String(categoryId));
  }

  // НЕ выбираем cover_image в списке - это экономит ~70MB трафика!
  // Изображения загружаются отдельно через /api/admin/category-groups/:id/image
  const rows = db.prepare(`
    SELECT 
      g.id,
      g.categoryId,
      g.slug,
      g.name,
      CASE WHEN g.cover_image IS NOT NULL AND g.cover_image != '' THEN 1 ELSE 0 END as has_cover_image,
      g.[order],
      g.hide_empty,
      g.parent_group_id,
      g.meta_label,
      g.meta_value,
      g.empty_since,
      g.parked_order,
      g.min_stock_threshold,
      g.total_control,
      g.new_since,
      g.new_until,
      CASE WHEN g.new_until > DATETIME('now') THEN 1 ELSE 0 END AS is_new,
      CAST(julianday(g.new_until) - julianday(g.new_since) AS INTEGER) AS new_days_total,
      CAST(CEIL(julianday(g.new_until) - julianday('now')) AS INTEGER) AS new_days_left,
      g.waive_description,
      g.waive_min_stock,
      g.waive_wholesale,
      g.strength_tier,
      g.waive_strength_tier,
      g.createdAt,
      g.updatedAt,
      COUNT(p.id) AS productCount,
      COALESCE(SUM(
        CASE
          WHEN p.has_variants = 1 THEN (SELECT COALESCE(SUM(pv.stock), 0) FROM product_variants pv WHERE pv.product_id = p.id)
          ELSE COALESCE(p.stock, 0)
        END
      ), 0) AS stockSum
    FROM category_groups g
    LEFT JOIN products p ON p.groupId = g.id
    ${whereClause}
    GROUP BY g.id, g.categoryId, g.slug, g.name, g.[order], g.hide_empty, g.parent_group_id, g.meta_label, g.meta_value, g.empty_since, g.parked_order, g.min_stock_threshold, g.total_control, g.new_since, g.new_until, g.waive_description, g.waive_min_stock, g.waive_wholesale, g.strength_tier, g.waive_strength_tier, g.createdAt, g.updatedAt
    ORDER BY g.categoryId ASC, g.[order] ASC, g.name ASC
  `).all(...params);


  const nodes = rows.map(row => ({
    ...row,
    productCount: Number(row.productCount ?? 0),
    stockSum: Number(row.stockSum ?? 0),
    parent_group_id: row.parent_group_id ?? null,
    empty_since: row.empty_since ?? null,
    parked_order: row.parked_order ?? null,
    children: []
  }));

  const nodesById = new Map();
  const rootsByCategory = new Map();

  nodes.forEach(node => {
    nodesById.set(node.id, node);
  });

  nodes.forEach(node => {
    if (node.parent_group_id && nodesById.has(node.parent_group_id)) {
      nodesById.get(node.parent_group_id).children.push(node);
    } else {
      const list = rootsByCategory.get(node.categoryId) || [];
      list.push(node);
      rootsByCategory.set(node.categoryId, list);
    }
  });

  const computeTotals = (node) => {
    node.children.sort((a, b) => (a['order'] ?? 0) - (b['order'] ?? 0));
    let total = Number(node.productCount ?? 0);
    let totalStock = Number(node.stockSum ?? 0);
    node.children.forEach(child => {
      const childResult = computeTotals(child);
      total += childResult.count;
      totalStock += childResult.stock;
    });
    node.totalProductCount = total;
    node.totalStockSum = totalStock;
    return { count: total, stock: totalStock };
  };

  rootsByCategory.forEach(list => {
    list.forEach(node => computeTotals(node));
  });

  const flattened = [];
  const visit = (node) => {
    const { children, ...rest } = node;
    flattened.push({
      ...rest,
      productCount: Number(node.productCount ?? 0),
      totalProductCount: Number(node.totalProductCount ?? node.productCount ?? 0),
      stockSum: Number(node.stockSum ?? 0),
      totalStockSum: Number(node.totalStockSum ?? node.stockSum ?? 0)
    });
    node.children.forEach(child => visit(child));
  };

  rootsByCategory.forEach(list => {
    list
      .sort((a, b) => (a['order'] ?? 0) - (b['order'] ?? 0))
      .forEach(node => visit(node));
  });

  // Автоматически обновляем empty_since для групп (по суммарному остатку, включая дочерние)
  flattened.forEach(group => {
    const totalStock = Number(group.totalStockSum ?? group.stockSum ?? 0);
    if (totalStock === 0 && !group.empty_since) {
      // Группа стала пустой (остаток 0) - записываем дату
      db.prepare('UPDATE category_groups SET empty_since = ? WHERE id = ?').run(new Date().toISOString(), group.id);
      group.empty_since = new Date().toISOString();
    } else if (totalStock > 0 && group.empty_since) {
      // Группа снова имеет остаток - сбрасываем дату
      db.prepare('UPDATE category_groups SET empty_since = NULL WHERE id = ?').run(group.id);
      group.empty_since = null;
    }
  });

  // Парковка позиции линейки: по СОБСТВЕННОМУ остатку (stockSum), а не суммарному,
  // потому что витрина скрывает линейку именно по её собственным товарам.
  // При restore пересчитываются [order] соседей, поэтому после синка перечитываем
  // из БД актуальные значения — иначе фронт увидит stale [order] сразу после восстановления.
  syncParkingFromFlattened(flattened.map(g => ({
    id: g.id,
    categoryId: g.categoryId,
    order: Number(g.order ?? 0),
    totalStockSum: Number(g.stockSum ?? 0),
    parked_order: g.parked_order ?? null,
  })));

  const refreshedIds = flattened.map(g => g.id);
  if (refreshedIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < refreshedIds.length; i += MAX_SQL_VARS) {
      chunks.push(refreshedIds.slice(i, i + MAX_SQL_VARS));
    }
    const freshById = new Map();
    chunks.forEach((chunk) => {
      const placeholders = chunk.map(() => '?').join(',');
      const freshRows = db.prepare(
        `SELECT id, [order] AS fresh_order, parked_order FROM category_groups WHERE id IN (${placeholders})`
      ).all(...chunk);
      freshRows.forEach(r => freshById.set(r.id, r));
    });
    flattened.forEach((g) => {
      const fresh = freshById.get(g.id);
      if (fresh) {
        g.order = Number(fresh.fresh_order ?? g.order ?? 0);
        g.parked_order = fresh.parked_order ?? null;
      }
    });
    // Пересортировка на случай, если restore сдвинул порядок
    flattened.sort((a, b) => {
      if (a.categoryId !== b.categoryId) {
        return String(a.categoryId).localeCompare(String(b.categoryId));
      }
      return Number(a.order ?? 0) - Number(b.order ?? 0);
    });
  }

  res.json(enrichAdminCategoryGroups(flattened));
});

// Статические сегменты ДО :id — иначе Express примет "incomplete" как id группы.
adminRouter.get('/api/admin/category-groups/incomplete', authMiddleware, (req, res) => {
  try {
    const items = computeIncompleteGroups();
    res.json({ items, fieldLabels: COMPLETENESS_FIELD_LABELS });
  } catch (error) {
    console.error('[admin] List incomplete category groups error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

adminRouter.get('/api/admin/category-groups/incomplete/summary', authMiddleware, (req, res) => {
  try {
    res.json(getIncompleteGroupsSummary());
  } catch (error) {
    console.error('[admin] Incomplete category groups summary error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Отдельный эндпоинт для получения изображения группы (чтобы не грузить все изображения в списке)
adminRouter.get('/api/admin/category-groups/:id/image', authMiddleware, (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT cover_image FROM category_groups WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json({ cover_image: row.cover_image || null });
});

// Получить одну группу со всеми данными включая изображение
adminRouter.get('/api/admin/category-groups/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const row = db.prepare(`
    SELECT 
      g.id,
      g.categoryId,
      g.slug,
      g.name,
      g.cover_image,
      g.[order],
      g.hide_empty,
      g.parent_group_id,
      g.meta_label,
      g.meta_value,
      g.total_control,
      g.new_since,
      g.new_until,
      CASE WHEN g.new_until > DATETIME('now') THEN 1 ELSE 0 END AS is_new,
      CAST(julianday(g.new_until) - julianday(g.new_since) AS INTEGER) AS new_days_total,
      CAST(CEIL(julianday(g.new_until) - julianday('now')) AS INTEGER) AS new_days_left,
      g.createdAt,
      g.updatedAt
    FROM category_groups g
    WHERE g.id = ?
  `).get(id);
  
  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }
  
  const productCount = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE groupId = ?').get(id)?.cnt || 0;
  
  return res.json(enrichAdminCategoryGroup({
    ...row,
    productCount: Number(productCount),
    parent_group_id: row.parent_group_id ?? null
  }));
});

adminRouter.patch('/api/admin/category-groups/:id/completeness-waivers', authMiddleware, (req, res) => {
  try {
    const result = updateGroupCompletenessWaivers(req.params.id, {
      waiveDescription: req.body?.waive_description ?? req.body?.waiveDescription,
      waiveMinStock: req.body?.waive_min_stock ?? req.body?.waiveMinStock,
      waiveWholesale: req.body?.waive_wholesale ?? req.body?.waiveWholesale,
      waiveStrengthTier: req.body?.waive_strength_tier ?? req.body?.waiveStrengthTier,
    });
    res.json({ ok: true, waivers: result });
  } catch (error) {
    if (error.code === 'group_not_found') {
      return res.status(404).json({ error: 'group_not_found' });
    }
    if (error.code === 'invalid_waiver_value') {
      return res.status(400).json({ error: 'invalid_waiver_value' });
    }
    if (error.code === 'group_id_required') {
      return res.status(400).json({ error: 'group_id_required' });
    }
    console.error('[admin] Update completeness waivers error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

adminRouter.post('/api/admin/category-groups', authMiddleware, async (req, res) => {
  const {
    categoryId,
    name,
    slug,
    coverImage,
    hide_empty,
    parentId,
    metaLabel,
    metaValue,
    meta_label,
    meta_value,
    wholesalePrices,
    wholesale_prices,
    minStockThreshold,
    min_stock_threshold,
    totalControl,
    total_control,
    waiveDescription,
    waive_description,
    waiveMinStock,
    waive_min_stock,
    waiveWholesale,
    waive_wholesale,
    waiveStrengthTier,
    waive_strength_tier,
    strengthTier,
    strength_tier,
  } = req.body || {};

  if (!categoryId || !name) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  let resolvedWaiveDescription = 0;
  let resolvedWaiveMinStock = 0;
  let resolvedWaiveWholesale = 0;
  let resolvedWaiveStrengthTier = 0;
  let resolvedStrengthTier = null;
  let resolvedTotalControl = 0;
  // Линейку можно пометить новинкой прямо при создании: форма общая с правкой.
  let newBadgeDays = null;
  try {
    const newBadge = resolveNewBadgeUpdate(req.body, null);
    newBadgeDays = newBadge.changed ? newBadge.days : null;
  } catch (error) {
    if (error.code === 'invalid_is_new' || error.code === 'invalid_new_days') {
      return res.status(400).json({ error: error.code });
    }
    throw error;
  }
  try {
    resolvedWaiveDescription = resolveWaiverUpdate(
      req.body,
      'waive_description',
      'waiveDescription',
      0,
    );
    resolvedWaiveMinStock = resolveWaiverUpdate(req.body, 'waive_min_stock', 'waiveMinStock', 0);
    resolvedWaiveWholesale = resolveWaiverUpdate(req.body, 'waive_wholesale', 'waiveWholesale', 0);
    resolvedWaiveStrengthTier = resolveWaiverUpdate(
      req.body,
      'waive_strength_tier',
      'waiveStrengthTier',
      0,
    );
    resolvedStrengthTier = resolveStrengthTierUpdate(req.body, null);
    resolvedTotalControl = resolveBooleanFlagUpdate(
      req.body,
      'total_control',
      'totalControl',
      0,
    );
  } catch (error) {
    if (error.code === 'invalid_waiver_value') {
      return res.status(400).json({ error: 'invalid_waiver_value' });
    }
    if (error.code === 'invalid_strength_tier') {
      return res.status(400).json({ error: 'invalid_strength_tier' });
    }
    if (error.code === 'invalid_boolean_value') {
      return res.status(400).json({ error: 'invalid_total_control' });
    }
    throw error;
  }

  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(String(categoryId));
  if (!category) {
    return res.status(400).json({ error: 'invalid_category' });
  }

  const finalSlug = generateGroupSlug(String(categoryId), name, slug, null);
  const newId = 'cg_' + Math.random().toString(36).slice(2, 8);
  const maxOrderRow = db.prepare('SELECT MAX([order]) as maxOrder FROM category_groups WHERE categoryId = ?').get(String(categoryId));
  const nextOrder = (maxOrderRow?.maxOrder || 0) + 1;

  let resolvedParentId = null;
  if (parentId) {
    const parent = db.prepare('SELECT id, categoryId FROM category_groups WHERE id = ?').get(String(parentId));
    if (!parent) {
      return res.status(400).json({ error: 'invalid_parent_group' });
    }
    if (parent.categoryId !== String(categoryId)) {
      return res.status(400).json({ error: 'parent_category_mismatch' });
    }
    resolvedParentId = parent.id;
  }

  const rawMetaLabel = metaLabel ?? meta_label ?? null;
  const rawMetaValue = metaValue ?? meta_value ?? null;
  const resolvedMetaLabel =
    typeof rawMetaLabel === 'string' && rawMetaLabel.trim().length > 0
      ? rawMetaLabel.trim()
      : null;
  const resolvedMetaValue =
    typeof rawMetaValue === 'string' && rawMetaValue.trim().length > 0
      ? rawMetaValue.trim()
      : null;

  // Конвертируем изображение в WebP
  const coverImageValue = coverImage ? await convertImageToWebP(coverImage) : null;

  // Минимальный порог стока: число > 0, иначе NULL.
  const rawThreshold = minStockThreshold ?? min_stock_threshold ?? null;
  const resolvedThreshold = (() => {
    if (rawThreshold == null || rawThreshold === '') return null;
    const n = Number(rawThreshold);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  })();

  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO category_groups (
          id, categoryId, slug, name, cover_image, [order], hide_empty,
          meta_label, meta_value, parent_group_id, min_stock_threshold,
          total_control,
          waive_description, waive_min_stock, waive_wholesale,
          strength_tier, waive_strength_tier,
          new_since, new_until,
          createdAt, updatedAt
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          CASE WHEN ? IS NULL THEN NULL ELSE DATETIME('now') END,
          CASE WHEN ? IS NULL THEN NULL ELSE DATETIME('now', ?) END,
          DATETIME('now'), DATETIME('now')
        )
      `).run(
        newId,
        String(categoryId),
        finalSlug,
        name,
        coverImageValue,
        nextOrder,
        hide_empty ? 1 : 0,
        resolvedMetaLabel,
        resolvedMetaValue,
        resolvedParentId,
        resolvedThreshold,
        resolvedTotalControl,
        resolvedWaiveDescription,
        resolvedWaiveMinStock,
        resolvedWaiveWholesale,
        resolvedStrengthTier,
        resolvedWaiveStrengthTier,
        newBadgeDays,
        newBadgeDays,
        newBadgeDays === null ? null : `+${newBadgeDays} days`,
      );

      saveGroupWholesalePrices(newId, wholesalePrices ?? wholesale_prices ?? {});
    });

    tx();
  } catch (error) {
    if (error?.code === 'invalid_wholesale_price') {
      return res.status(400).json({ error: 'invalid_wholesale_price', message: error.message });
    }
    console.error('[admin] Failed to create category group:', error);
    return res.status(500).json({ error: 'create_failed', message: error.message });
  }

  const result = db.prepare(`
    SELECT 
      g.id,
      g.categoryId,
      g.slug,
      g.name,
      g.cover_image,
      g.[order],
      g.hide_empty,
      g.parent_group_id,
      g.meta_label,
      g.meta_value,
      g.min_stock_threshold,
      g.total_control,
      g.new_since,
      g.new_until,
      CASE WHEN g.new_until > DATETIME('now') THEN 1 ELSE 0 END AS is_new,
      CAST(julianday(g.new_until) - julianday(g.new_since) AS INTEGER) AS new_days_total,
      CAST(CEIL(julianday(g.new_until) - julianday('now')) AS INTEGER) AS new_days_left,
      g.waive_description,
      g.waive_min_stock,
      g.waive_wholesale,
      g.strength_tier,
      g.waive_strength_tier,
      g.createdAt,
      g.updatedAt,
      COUNT(p.id) AS productCount
    FROM category_groups g
    LEFT JOIN products p ON p.groupId = g.id
    WHERE g.id = ?
    GROUP BY g.id, g.categoryId, g.slug, g.name, g.cover_image, g.[order], g.hide_empty, g.parent_group_id, g.meta_label, g.meta_value, g.min_stock_threshold, g.total_control, g.new_since, g.new_until, g.waive_description, g.waive_min_stock, g.waive_wholesale, g.strength_tier, g.waive_strength_tier, g.createdAt, g.updatedAt
  `).get(newId);

  if (!result) {
    return res.status(500).json({ error: 'create_failed' });
  }

  const totalRow = db.prepare(`
    WITH RECURSIVE group_tree(id) AS (
      SELECT id FROM category_groups WHERE id = ?
      UNION ALL
      SELECT cg.id FROM category_groups cg
      JOIN group_tree gt ON cg.parent_group_id = gt.id
    )
    SELECT COUNT(p.id) AS total
    FROM group_tree gt
    LEFT JOIN products p ON p.groupId = gt.id
  `).get(newId);

  return res.json(enrichAdminCategoryGroup({
    ...result,
    productCount: Number(result.productCount ?? 0),
    totalProductCount: Number(totalRow?.total ?? result.productCount ?? 0)
  }));
});

/** Сколько дней держится плашка «новинка», если срок не задали явно. */
const DEFAULT_NEW_BADGE_DAYS = 30;
const MAX_NEW_BADGE_DAYS = 180;

/**
 * Метка «новинка» у линейки.
 *
 * Возвращает выражения для UPDATE, а не готовые строки: даты пишет SQLite через
 * DATETIME, как и всё остальное время в проекте. Отсчёт начинается заново, если
 * прошлый срок уже истёк, иначе менеджер снимет и поставит галку, а плашка не
 * загорится, потому что срок посчитается от старой даты.
 */
function resolveNewBadgeUpdate(body, current) {
  const raw = body?.is_new !== undefined ? body.is_new : body?.isNew;
  if (raw === undefined) {
    return { changed: false };
  }
  if (typeof raw !== 'boolean') {
    const error = new Error('invalid_is_new');
    error.code = 'invalid_is_new';
    throw error;
  }
  if (!raw) {
    return { changed: true, since: null, days: null };
  }

  const rawDays = body?.new_days !== undefined ? body.new_days : body?.newDays;
  const days = Number(rawDays ?? DEFAULT_NEW_BADGE_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > MAX_NEW_BADGE_DAYS) {
    const error = new Error('invalid_new_days');
    error.code = 'invalid_new_days';
    throw error;
  }

  const stillActive = Boolean(
    db
      .prepare("SELECT 1 AS active WHERE ? > DATETIME('now')")
      .get(current?.new_until || '')?.active,
  );
  return {
    changed: true,
    // Продлеваем срок, но начало отсчёта у активной новинки не сдвигаем: иначе
    // правка соседнего поля молча поднимала бы её выше свежих.
    since: stillActive ? current.new_since : null,
    days,
  };
}

adminRouter.put('/api/admin/category-groups/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const {
    name,
    slug,
    coverImage,
    hide_empty,
    order,
    parentId,
    metaLabel,
    metaValue,
    meta_label,
    meta_value,
    wholesalePrices,
    wholesale_prices,
    minStockThreshold,
    min_stock_threshold,
    totalControl,
    total_control,
    waiveDescription,
    waive_description,
    waiveMinStock,
    waive_min_stock,
    waiveWholesale,
    waive_wholesale,
    waiveStrengthTier,
    waive_strength_tier,
    strengthTier,
    strength_tier,
  } = req.body || {};

  const current = db.prepare('SELECT * FROM category_groups WHERE id = ?').get(id);
  if (!current) {
    return res.status(404).json({ error: 'not_found' });
  }

  // Скидку разбираем заранее: сохранение идёт внутри транзакции, а отказ по
  // кривым данным должен случиться до неё.
  const discountProvided = 'discount' in (req.body || {});
  let discountPayload = null;
  if (discountProvided) {
    const raw = req.body.discount;
    discountPayload = raw && typeof raw === 'object'
      ? { price: raw.price ?? null, untilDate: raw.untilDate ?? raw.until_date ?? null }
      : { price: null, untilDate: null };
    try {
      normalizeDiscountInput(discountPayload);
    } catch (error) {
      return res.status(400).json({ error: error.code || 'invalid_discount' });
    }
  }

  // Своя обёртка: общий catch ниже переводит любую ошибку булева в
  // invalid_total_control, и кривой is_new вернул бы ошибку про чужое поле.
  let nextNewBadge;
  try {
    nextNewBadge = resolveNewBadgeUpdate(req.body, current);
  } catch (error) {
    if (error.code === 'invalid_is_new' || error.code === 'invalid_new_days') {
      return res.status(400).json({ error: error.code });
    }
    throw error;
  }

  let nextWaiveDescription;
  let nextWaiveMinStock;
  let nextWaiveWholesale;
  let nextWaiveStrengthTier;
  let nextStrengthTier;
  let nextTotalControl;
  try {
    nextWaiveDescription = resolveWaiverUpdate(
      req.body,
      'waive_description',
      'waiveDescription',
      current.waive_description,
    );
    nextWaiveMinStock = resolveWaiverUpdate(
      req.body,
      'waive_min_stock',
      'waiveMinStock',
      current.waive_min_stock,
    );
    nextWaiveWholesale = resolveWaiverUpdate(
      req.body,
      'waive_wholesale',
      'waiveWholesale',
      current.waive_wholesale,
    );
    nextWaiveStrengthTier = resolveWaiverUpdate(
      req.body,
      'waive_strength_tier',
      'waiveStrengthTier',
      current.waive_strength_tier,
    );
    nextStrengthTier = resolveStrengthTierUpdate(req.body, current.strength_tier);
    nextTotalControl = resolveBooleanFlagUpdate(
      req.body,
      'total_control',
      'totalControl',
      current.total_control,
    );
  } catch (error) {
    if (error.code === 'invalid_waiver_value') {
      return res.status(400).json({ error: 'invalid_waiver_value' });
    }
    if (error.code === 'invalid_strength_tier') {
      return res.status(400).json({ error: 'invalid_strength_tier' });
    }
    if (error.code === 'invalid_boolean_value') {
      return res.status(400).json({ error: 'invalid_total_control' });
    }
    throw error;
  }

  const nextName = name ? String(name) : current.name;
  const nextSlug = generateGroupSlug(current.categoryId, nextName, slug, id);
  // Конвертируем изображение в WebP если оно новое.
  // Защита: используем `'coverImage' in body`, а не `coverImage !== undefined` —
  // потому что 9.05.2026 Костя потерял обложки трёх линеек, когда фронт
  // на PUT слал coverImage=null для НЕ намеренного апдейта обложки. Если
  // ключа нет в body — не трогаем. Если null — намеренное снятие обложки.
  const coverImageProvided = 'coverImage' in (req.body || {}) || 'cover_image' in (req.body || {});
  let nextCover = current.cover_image;
  if (coverImageProvided) {
    if (coverImage) {
      nextCover = await convertImageToWebP(String(coverImage));
    } else {
      nextCover = null;
    }
  }
  const nextHideEmpty = hide_empty !== undefined ? (hide_empty ? 1 : 0) : current.hide_empty;
  const nextOrder = Number.isFinite(Number(order)) ? Number(order) : current.order;
  // Проверяем, было ли поле явно передано в запросе (включая null для очистки)
  const metaLabelProvided = 'metaLabel' in req.body || 'meta_label' in req.body;
  const metaValueProvided = 'metaValue' in req.body || 'meta_value' in req.body;
  const wholesalePricesProvided = 'wholesalePrices' in req.body || 'wholesale_prices' in req.body;
  const rawMetaLabel = metaLabel ?? meta_label;
  const rawMetaValue = metaValue ?? meta_value;
  const nextMetaLabel =
    metaLabelProvided
      ? (typeof rawMetaLabel === 'string' && rawMetaLabel.trim().length > 0
        ? rawMetaLabel.trim()
        : null)
      : current.meta_label ?? null;
  const nextMetaValue =
    metaValueProvided
      ? (typeof rawMetaValue === 'string' && rawMetaValue.trim().length > 0
        ? rawMetaValue.trim()
        : null)
      : current.meta_value ?? null;

  // Защита от потери parent: если ключа нет в body — не трогаем (раньше
  // фронт слал parentId=null при апдейте только min-stock и обнулял
  // привязку к родительской линейке).
  const parentIdProvided = 'parentId' in (req.body || {}) || 'parent_group_id' in (req.body || {});
  let nextParentId = current.parent_group_id ?? null;
  if (parentIdProvided) {
    if (!parentId) {
      nextParentId = null;
    } else if (parentId === id) {
      return res.status(400).json({ error: 'invalid_parent_self' });
    } else {
      const parent = db.prepare('SELECT id, categoryId FROM category_groups WHERE id = ?').get(String(parentId));
      if (!parent) {
        return res.status(400).json({ error: 'invalid_parent_group' });
      }
      if (parent.categoryId !== current.categoryId) {
        return res.status(400).json({ error: 'parent_category_mismatch' });
      }

      // Prevent circular reference by ensuring selected parent is not a descendant of current
      const ancestors = new Set();
      let cursor = parent.parent_group_id;
      while (cursor) {
        if (cursor === id) {
          return res.status(400).json({ error: 'invalid_parent_cycle' });
        }
        const ancestor = db.prepare('SELECT parent_group_id FROM category_groups WHERE id = ?').get(cursor);
        if (!ancestor) break;
        if (ancestors.has(cursor)) break;
        ancestors.add(cursor);
        cursor = ancestor.parent_group_id;
      }

      nextParentId = parent.id;
    }
  }

  // Минимальный порог стока: если поле передано (даже null/0/'') — обновляем,
  // иначе оставляем текущее значение.
  const thresholdProvided = 'minStockThreshold' in (req.body || {}) || 'min_stock_threshold' in (req.body || {});
  const rawThreshold = minStockThreshold ?? min_stock_threshold;
  const nextThreshold = (() => {
    if (!thresholdProvided) return current.min_stock_threshold ?? null;
    if (rawThreshold == null || rawThreshold === '') return null;
    const n = Number(rawThreshold);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  })();

  try {
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE category_groups
        SET name = ?, slug = ?, cover_image = ?, hide_empty = ?, [order] = ?,
            meta_label = ?, meta_value = ?, parent_group_id = ?, min_stock_threshold = ?,
            total_control = ?,
            waive_description = ?, waive_min_stock = ?, waive_wholesale = ?,
            strength_tier = ?, waive_strength_tier = ?,
            updatedAt = DATETIME('now')
        WHERE id = ?
      `).run(
        nextName,
        nextSlug,
        nextCover,
        nextHideEmpty,
        nextOrder,
        nextMetaLabel,
        nextMetaValue,
        nextParentId,
        nextThreshold,
        nextTotalControl,
        nextWaiveDescription,
        nextWaiveMinStock,
        nextWaiveWholesale,
        nextStrengthTier,
        nextWaiveStrengthTier,
        id,
      );

      if (discountProvided) {
        saveDiscount('group', id, discountPayload);
      }

      // Даты новинки пишем отдельным запросом: срок считает SQLite, чтобы в
      // колонке не оказалось двух форматов времени.
      if (nextNewBadge.changed) {
        if (nextNewBadge.days === null) {
          db.prepare(
            'UPDATE category_groups SET new_since = NULL, new_until = NULL WHERE id = ?',
          ).run(id);
        } else {
          db.prepare(`
            UPDATE category_groups
            SET new_since = COALESCE(?, DATETIME('now')),
                new_until = DATETIME(COALESCE(?, DATETIME('now')), ?)
            WHERE id = ?
          `).run(
            nextNewBadge.since,
            nextNewBadge.since,
            `+${nextNewBadge.days} days`,
            id,
          );
        }
      }

      if (wholesalePricesProvided) {
        saveGroupWholesalePrices(id, wholesalePrices ?? wholesale_prices ?? {});
      }
    });

    tx();
  } catch (error) {
    if (error?.code === 'invalid_wholesale_price') {
      return res.status(400).json({ error: 'invalid_wholesale_price', message: error.message });
    }
    console.error('[admin] Failed to update category group:', error);
    return res.status(500).json({ error: 'update_failed', message: error.message });
  }

  const updated = db.prepare(`
    SELECT 
      g.id,
      g.categoryId,
      g.slug,
      g.name,
      g.cover_image,
      g.[order],
      g.hide_empty,
      g.parent_group_id,
      g.meta_label,
      g.meta_value,
      g.min_stock_threshold,
      g.total_control,
      g.new_since,
      g.new_until,
      CASE WHEN g.new_until > DATETIME('now') THEN 1 ELSE 0 END AS is_new,
      CAST(julianday(g.new_until) - julianday(g.new_since) AS INTEGER) AS new_days_total,
      CAST(CEIL(julianday(g.new_until) - julianday('now')) AS INTEGER) AS new_days_left,
      g.waive_description,
      g.waive_min_stock,
      g.waive_wholesale,
      g.strength_tier,
      g.waive_strength_tier,
      g.createdAt,
      g.updatedAt,
      COUNT(p.id) AS productCount
    FROM category_groups g
    LEFT JOIN products p ON p.groupId = g.id
    WHERE g.id = ?
    GROUP BY g.id, g.categoryId, g.slug, g.name, g.cover_image, g.[order], g.hide_empty, g.parent_group_id, g.meta_label, g.meta_value, g.min_stock_threshold, g.total_control, g.new_since, g.new_until, g.waive_description, g.waive_min_stock, g.waive_wholesale, g.strength_tier, g.waive_strength_tier, g.createdAt, g.updatedAt
  `).get(id);

  if (!updated) {
    return res.status(404).json({ error: 'not_found' });
  }

  const totalRow = db.prepare(`
    WITH RECURSIVE group_tree(id) AS (
      SELECT id FROM category_groups WHERE id = ?
      UNION ALL
      SELECT cg.id FROM category_groups cg
      JOIN group_tree gt ON cg.parent_group_id = gt.id
    )
    SELECT COUNT(p.id) AS total
    FROM group_tree gt
    LEFT JOIN products p ON p.groupId = gt.id
  `).get(id);

  refreshProductSearchIndex('category group update');
  return res.json(enrichAdminCategoryGroup({
    ...updated,
    productCount: Number(updated.productCount ?? 0),
    totalProductCount: Number(totalRow?.total ?? updated.productCount ?? 0)
  }));
});

adminRouter.patch('/api/admin/category-groups/reorder', authMiddleware, (req, res) => {
  const { groups } = req.body || {};
  if (!Array.isArray(groups)) {
    return res.status(400).json({ error: 'groups_required' });
  }

  try {
    // Для "запаркованных" (пустых) линеек админский drag-n-drop трактуется как
    // ПЕРЕОПРЕДЕЛЕНИЕ замороженной позиции: обновляем и [order], и parked_order
    // на новое значение. Так пустую линейку можно осознанно двигать в админке,
    // и она запомнит новое место "ожидания товара".
    const ids = groups.map(g => g.id).filter(Boolean);
    const parkedSet = new Set();
    if (ids.length > 0) {
      const chunks = [];
      for (let i = 0; i < ids.length; i += MAX_SQL_VARS) {
        chunks.push(ids.slice(i, i + MAX_SQL_VARS));
      }
      chunks.forEach((chunk) => {
        const placeholders = chunk.map(() => '?').join(',');
        const parkedRows = db.prepare(
          `SELECT id FROM category_groups WHERE id IN (${placeholders}) AND parked_order IS NOT NULL`
        ).all(...chunk);
        parkedRows.forEach(r => parkedSet.add(r.id));
      });
    }

    const stmtRegular = db.prepare("UPDATE category_groups SET [order] = ?, updatedAt = DATETIME('now') WHERE id = ?");
    const stmtParked = db.prepare("UPDATE category_groups SET [order] = ?, parked_order = ?, updatedAt = DATETIME('now') WHERE id = ?");
    const repositionedParked = [];
    const tx = db.transaction((items) => {
      for (const item of items) {
        if (!item.id || !Number.isFinite(item.order)) {
          throw new Error('invalid_group_data');
        }
        let result;
        if (parkedSet.has(item.id)) {
          result = stmtParked.run(item.order, item.order, item.id);
          repositionedParked.push(item.id);
        } else {
          result = stmtRegular.run(item.order, item.id);
        }
        if (result.changes === 0) {
          throw new Error(`group_not_found:${item.id}`);
        }
      }
    });
    tx(groups);
    res.json({ ok: true, repositionedParked });
  } catch (error) {
    console.error('[admin] reorder groups failed:', error);
    res.status(500).json({ error: 'reorder_failed', message: error.message });
  }
});

adminRouter.delete('/api/admin/category-groups/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const group = db.prepare('SELECT id, categoryId FROM category_groups WHERE id = ?').get(id);
  if (!group) {
    return res.status(404).json({ error: 'not_found' });
  }

  const tx = db.transaction((groupId) => {
    db.prepare('UPDATE products SET groupId = NULL WHERE groupId = ?').run(groupId);
    db.prepare('DELETE FROM category_groups WHERE id = ?').run(groupId);
  });
  tx(id);

  refreshProductSearchIndex('category group delete');
  res.json({ ok: true });
});

// Category cross-sells management
adminRouter.get('/api/admin/categories/:id/cross-sells', authMiddleware, (req, res) => {
  const { id } = req.params;
  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
  if (!category) {
    return res.status(404).json({ error: 'not_found' });
  }

  const rows = db.prepare(`
    SELECT 
      cs.productId,
      cs.[order],
      p.title,
      p.priceRub,
      p.description,
      p.createdAt,
      p.categoryId,
      p.groupId,
      g.name as groupName,
      g.slug as groupSlug
    FROM category_cross_sells cs
    JOIN products p ON p.id = cs.productId
    LEFT JOIN category_groups g ON p.groupId = g.id
    WHERE cs.categoryId = ?
    ORDER BY cs.[order] ASC
  `).all(id);

  const imageStmt = db.prepare('SELECT url FROM product_images WHERE productId = ? ORDER BY position ASC');
  const payload = rows.map(row => ({
    id: row.productId,
    title: row.title,
    priceRub: row.priceRub,
    description: row.description,
    createdAt: row.createdAt,
    categoryId: row.categoryId,
    groupId: row.groupId,
    groupName: row.groupName,
    groupSlug: row.groupSlug,
    images: imageStmt.all(row.productId).map(r => r.url)
  }));

  res.json(payload);
});

adminRouter.put('/api/admin/categories/:id/cross-sells', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { productIds } = req.body || {};

  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
  if (!category) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (!Array.isArray(productIds)) {
    return res.status(400).json({ error: 'product_ids_required' });
  }

  const uniqueProductIds = Array.from(new Set(productIds.map(String)));
  if (uniqueProductIds.length === 0) {
    db.prepare('DELETE FROM category_cross_sells WHERE categoryId = ?').run(id);
    return res.json([]);
  }

  const placeholders = uniqueProductIds.map(() => '?').join(',');
  const existingProducts = db.prepare(`SELECT id FROM products WHERE id IN (${placeholders})`).all(...uniqueProductIds);
  const existingIds = new Set(existingProducts.map(row => row.id));

  const missing = uniqueProductIds.filter(pid => !existingIds.has(pid));
  if (missing.length) {
    return res.status(400).json({ error: 'invalid_products', missing });
  }

  const tx = db.transaction((categoryId, ids) => {
    db.prepare('DELETE FROM category_cross_sells WHERE categoryId = ?').run(categoryId);
    const insertStmt = db.prepare('INSERT INTO category_cross_sells (id, categoryId, productId, [order]) VALUES (?, ?, ?, ?)');
    ids.forEach((pid, idx) => {
      const rowId = 'cs_' + Math.random().toString(36).slice(2, 8);
      insertStmt.run(rowId, categoryId, pid, idx + 1);
    });
  });

  tx(id, uniqueProductIds);

  const rows = db.prepare(`
    SELECT 
      cs.productId,
      cs.[order],
      p.title,
      p.priceRub,
      p.description,
      p.createdAt,
      p.categoryId,
      p.groupId,
      g.name as groupName,
      g.slug as groupSlug
    FROM category_cross_sells cs
    JOIN products p ON p.id = cs.productId
    LEFT JOIN category_groups g ON p.groupId = g.id
    WHERE cs.categoryId = ?
    ORDER BY cs.[order] ASC
  `).all(id);

  const imageStmt = db.prepare('SELECT url FROM product_images WHERE productId = ? ORDER BY position ASC');
  const payload = rows.map(row => ({
    id: row.productId,
    title: row.title,
    priceRub: row.priceRub,
    description: row.description,
    createdAt: row.createdAt,
    categoryId: row.categoryId,
    groupId: row.groupId,
    groupName: row.groupName,
    groupSlug: row.groupSlug,
    images: imageStmt.all(row.productId).map(r => r.url)
  }));

  res.json(payload);
});

// Settings CRUD
adminRouter.get('/api/admin/settings', authMiddleware, (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (error) {
    console.error('[admin] Failed to get settings:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

adminRouter.post('/api/admin/settings', authMiddleware, (req, res) => {
  try {
    const { settings } = req.body || {};
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings_object_required' });
    }
    
    // Обновляем настройки в транзакции
    const upsertStmt = db.prepare(`
      INSERT INTO settings (key, value) 
      VALUES (?, ?) 
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    
    const tx = db.transaction((settingsObj) => {
      Object.entries(settingsObj).forEach(([key, value]) => {
        upsertStmt.run(key, String(value));
      });
    });
    
    tx(settings);
    
    console.log('[admin] Settings updated:', settings);
    res.json({ ok: true, settings });
  } catch (error) {
    console.error('[admin] Failed to update settings:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});
