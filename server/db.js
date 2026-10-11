import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import slugify from 'slugify';
import { migrateHideEmpty } from './migrations/add_hide_empty_to_categories.js';
import { migrateTitleToBanners } from './migrations/add_title_to_banners.js';
import { migrateOpenInNewTabToBanners } from './migrations/add_open_in_new_tab_to_banners.js';
import { migrateSettingsTable } from './migrations/add_settings_table.js';
import { ensureProfitPasswordSetting } from './migrations/add_profit_password_setting.js';
import { fixCategorySlug } from './migrations/fix_category_slug.js';
import { removeManagerNameSetting } from './migrations/remove_manager_name_setting.js';
import { migrateCategoryGroupsAndCrossSells } from './migrations/add_category_groups_and_cross_sells.js';
import { migrateCategoryCoverImage } from './migrations/add_cover_image_to_categories.js';
import { migrateCategoryDisplayMode } from './migrations/add_display_mode_to_categories.js';
import { migrateCrmTables } from './migrations/add_crm_tables.js';
import { migrateOrderPaymentFields } from './migrations/add_payment_fields_to_orders.js';
import { migrateCategoryGroupHierarchy } from './migrations/add_parent_to_category_groups.js';
import { migrateOrderStatusHistory } from './migrations/add_order_status_history.js';
import { migrateProductBadges } from './migrations/add_product_badges.js';
import { migrateMessageTemplates } from './migrations/add_message_templates.js';
import { addPhoneToOrders } from './migrations/add_phone_to_orders.js';
import { migrateUseCategoryImage } from './migrations/add_use_category_image_to_products.js';
import { migrateProductVariants } from './migrations/add_product_variants.js';
import { migrateProductListIndexes } from './migrations/add_product_list_indexes.js';
import { addTelegramUsernameToOrders } from './migrations/add_telegram_username_to_orders.js';
import { migrateCustomerFeedbacks } from './migrations/add_customer_feedbacks.js';
import { migrateArchivedToOrders } from './migrations/add_archived_to_orders.js';
import { migrateAddBaseProductToOrderItems } from './migrations/add_base_product_to_order_items.js';
import { migrateColorDisplayMode } from './migrations/add_color_display_mode.js';
import { migrateColorImageToVariants } from './migrations/add_color_image_to_variants.js';
import { migrateCategoryGroupMetaFields } from './migrations/add_group_meta_fields.js';
import { migrateStockDeductedToOrders } from './migrations/add_stock_deducted_to_orders.js';
import { migrateVariantIdToOrderItems } from './migrations/add_variant_id_to_order_items.js';
import { migrateEmptySinceToGroups } from './migrations/add_empty_since_to_groups.js';
import { migrateParkedOrderToGroups } from './migrations/add_parked_order_to_groups.js';
import { migrateCustomerBlockLifecycle } from './migrations/add_customer_block_lifecycle.js';
import { migratePosCustomerLink } from './migrations/add_pos_customer_link.js';
import { migrateLowStockGroups } from './migrations/add_low_stock_groups.js';
import { migrateAgreements } from './migrations/add_agreements.js';
import { migrateBusinessBot } from './migrations/add_business_bot.js';
import { migrateUserbotEntities } from './migrations/add_userbot_entities.js';
import { migrateCustomerDeletedAt } from './migrations/add_customer_deleted_at.js';
import { migratePosSales } from './migrations/add_pos_sales.js';
import { migratePosSaleTransactionLink } from './migrations/add_pos_sale_transaction_link.js';
import { migrateManagerActionFields } from './migrations/add_manager_action_fields.js';
import { migrateCustomerPhoto } from './migrations/add_customer_photo.js';
import { migratePromoCodes } from './migrations/add_promo_codes.js';
import { migrateOrderItemDisplayFields } from './migrations/add_order_item_display_fields.js';
import { migrateOrderItemCatalogPrice } from './migrations/add_order_item_catalog_price.js';
import { migrateLoyaltyTables, seedDefaultLoyaltyData } from './migrations/add_loyalty_tables.js';
import { migrateCashPacingTables } from './migrations/add_cash_pacing_tables.js';
import { migrateCardPaymentLimits } from './migrations/add_card_payment_limits.js';
import { migrateCardPaymentTariffLimits } from './migrations/add_card_payment_tariff_limits.js';
import { migrateWholesalePricing } from './migrations/add_wholesale_pricing.js';
import { migrateCrmPerformanceIndexes } from './migrations/add_crm_performance_indexes.js';
import { migrateOrderNumberSearch } from './migrations/add_order_number_search.js';
import { migrateWheelPrizes, seedDefaultWheelData } from './migrations/add_wheel_prizes.js';
import { migrateProductSearchIndex } from './migrations/add_product_search_index.js';
import { migrateImageThumbnailCache } from './migrations/add_image_thumbnail_cache.js';
import { migrateOrderAcceptedTemplate } from './migrations/add_order_accepted_template.js';
import { migratePendingCustomerNotes } from './migrations/add_pending_customer_notes.js';
import { migrateCategoryGroupCompletenessWaivers } from './migrations/add_category_group_completeness_waivers.js';
import { migrateStorefrontFilters } from './migrations/add_storefront_filters.js';
import { migrateProductReviews } from './migrations/add_product_reviews.js';
import { migratePendingNotifications } from './migrations/add_pending_notifications.js';
import { migrateCategoryGroupTotalControl } from './migrations/add_total_control_to_category_groups.js';
import { migrateGroupNewBadge } from './migrations/add_group_new_badge.js';
import { migrateCatalogDiscounts } from './migrations/add_catalog_discounts.js';
import { migrateInventoryLocations } from './migrations/add_inventory_locations.js';
import { migrateReferralAuthorization } from './migrations/add_referral_authorization.js';
import { migrateReferralWelcomeNotifications } from './migrations/add_referral_welcome_notifications.js';
import { migratePickupCells } from './migrations/add_pickup_cells.js';
import { migrateRoundMoneyColumns } from './migrations/round_money_columns.js';
import { migrateOrderAdditionalCost } from './migrations/add_order_additional_cost.js';
import { migrateOrderAudit } from './migrations/add_order_audit.js';
import { migrateStaffManagement } from './migrations/add_staff_management.js';
import { migrateInternalNotifications } from './migrations/add_internal_notifications.js';
import { migrateFinancialDayClosures } from './migrations/add_financial_day_closures.js';
import { assertFinancialCloseDatabaseReady } from './utils/financial-close-activation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = process.env.DATABASE_FILE || path.resolve(__dirname, './data/navalivay.db');

// Ensure data dir exists
const dataDir = path.dirname(DB_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(DB_FILE);

export function initDb() {
  // Opt-in preflight must precede schema changes and writable PRAGMAs.
  const financialCloseEnabled = assertFinancialCloseDatabaseReady(db);
  db.pragma('foreign_keys = ON');

  // Improve read concurrency/latency under write load by using WAL.
  db.pragma('journal_mode = WAL');
  // Reasonable durability/performance tradeoff for a VPS.
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  // Negative value = KB. ~20MB cache.
  db.pragma('cache_size = -20000');
  // Wait a bit on lock contention instead of failing or stalling callers.
  db.pragma('busy_timeout = 5000');
  db.pragma('wal_autocheckpoint = 1000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      name TEXT NOT NULL,
      [order] INTEGER NOT NULL DEFAULT 0,
      cover_image TEXT,
      hide_empty INTEGER NOT NULL DEFAULT 0,
      display_mode TEXT NOT NULL DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      categoryId TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      groupId TEXT REFERENCES category_groups(id) ON DELETE SET NULL,
      title TEXT,
      priceRub INTEGER NOT NULL,
      description TEXT,
      use_category_image INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_images (
      productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (productId, position)
    );

    CREATE TABLE IF NOT EXISTS product_links (
      productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      label TEXT,
      url TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (productId, position)
    );

    CREATE TABLE IF NOT EXISTS category_groups (
      id TEXT PRIMARY KEY,
      categoryId TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      cover_image TEXT,
      [order] INTEGER NOT NULL DEFAULT 0,
      hide_empty INTEGER NOT NULL DEFAULT 0,
      meta_label TEXT,
      meta_value TEXT,
      parent_group_id TEXT REFERENCES category_groups(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL DEFAULT (DATETIME('now')),
      updatedAt TEXT NOT NULL DEFAULT (DATETIME('now')),
      UNIQUE(categoryId, slug)
    );

    CREATE TABLE IF NOT EXISTS category_cross_sells (
      id TEXT PRIMARY KEY,
      categoryId TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      [order] INTEGER NOT NULL DEFAULT 0,
      UNIQUE(categoryId, productId)
    );

    CREATE TABLE IF NOT EXISTS banners (
      id TEXT PRIMARY KEY,
      image TEXT NOT NULL,
      href TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      [order] INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Выполняем миграции
  migrateHideEmpty();
  migrateTitleToBanners();
  migrateOpenInNewTabToBanners();
  migrateSettingsTable();
  ensureProfitPasswordSetting();
  fixCategorySlug();
  removeManagerNameSetting();
  migrateCategoryCoverImage();
  migrateCategoryDisplayMode();
  migrateCategoryGroupsAndCrossSells();
  migrateCategoryGroupHierarchy();
  migrateCategoryGroupMetaFields();
  migrateCrmTables();
  migrateProductBadges();
  migrateOrderPaymentFields();
  migrateOrderStatusHistory();
  migrateMessageTemplates();
  addPhoneToOrders();
  migrateUseCategoryImage();
  migrateProductVariants();
  migrateProductListIndexes();
  addTelegramUsernameToOrders();
  migrateCustomerFeedbacks();
  migrateArchivedToOrders();
  migrateAddBaseProductToOrderItems();
  migrateColorDisplayMode();
  migrateColorImageToVariants();
  migrateStockDeductedToOrders();
  migrateVariantIdToOrderItems();
  migrateOrderItemDisplayFields();
  migrateOrderItemCatalogPrice();
  migrateEmptySinceToGroups();
  migrateParkedOrderToGroups();
  migrateCustomerBlockLifecycle();
  migratePosSales();
  migratePosCustomerLink();
  migrateLowStockGroups();
  migrateAgreements();
  migrateBusinessBot();
  migrateUserbotEntities();
  migrateCustomerDeletedAt();
  migratePosSaleTransactionLink();
  migrateManagerActionFields();
  migrateCustomerPhoto();
  migratePromoCodes();
  migrateLoyaltyTables();
  migrateCashPacingTables();
  migrateCardPaymentLimits();
  migrateCardPaymentTariffLimits();
  migrateWholesalePricing();
  migrateCrmPerformanceIndexes();
  migrateOrderNumberSearch();
  migrateWheelPrizes();
  migrateProductSearchIndex();
  migrateImageThumbnailCache();
  migrateOrderAcceptedTemplate();
  migratePendingCustomerNotes();
  migrateCategoryGroupCompletenessWaivers();
  migrateStorefrontFilters();
  migrateProductReviews();
  migratePendingNotifications();
  migrateCategoryGroupTotalControl();
  migrateGroupNewBadge();
  migrateCatalogDiscounts();
  migrateInventoryLocations();
  migrateStaffManagement(db);
  migrateInternalNotifications(db);
  migrateReferralAuthorization();
  migrateReferralWelcomeNotifications();
  migratePickupCells();
  migrateRoundMoneyColumns();
  migrateOrderAdditionalCost();
  migrateOrderAudit(db);
  if (financialCloseEnabled) migrateFinancialDayClosures(db);

  seedIfEmpty();
  seedDefaultLoyaltyData();
  seedDefaultWheelData();
}

function seedIfEmpty() {
  const countCat = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  const countProd = db.prepare('SELECT COUNT(*) as c FROM products').get().c;

  if (countCat === 0) {
    const categoriesPath = path.resolve(__dirname, './seed/categories.json');
    if (fs.existsSync(categoriesPath)) {
      const categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
      const stmt = db.prepare('INSERT INTO categories (id, slug, name, [order], cover_image, hide_empty, display_mode) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const tx = db.transaction((rows) => {
        for (const r of rows) {
          const slug = r.slug || slugify(r.name, { lower: true, strict: true, locale: 'ru' });
          stmt.run(
            r.id,
            slug,
            r.name,
            r.order ?? 0,
            r.coverImage || null,
            r.hideEmpty ? 1 : 0,
            r.displayMode || 'default'
          );
        }
      });
      tx(categories);
      console.log(`[navalivay:db] Seeded categories: ${categories.length}`);
    }
  }

  const countGroups = db.prepare('SELECT COUNT(*) as c FROM category_groups').get().c;
  if (countGroups === 0) {
    const groupsPath = path.resolve(__dirname, './seed/category_groups.json');
    if (fs.existsSync(groupsPath)) {
      const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
      const stmt = db.prepare(`
        INSERT INTO category_groups (id, categoryId, slug, name, cover_image, [order], hide_empty, parent_group_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction((rows) => {
        for (const r of rows) {
          const slug = r.slug || slugify(r.name, { lower: true, strict: true, locale: 'ru' });
          stmt.run(
            r.id,
            r.categoryId,
            slug,
            r.name,
            r.coverImage || null,
            r.order ?? 0,
            r.hideEmpty ? 1 : 0,
            r.parentGroupId || null
          );
        }
      });
      tx(groups);
      console.log(`[navalivay:db] Seeded category groups: ${groups.length}`);
    }
  }

  if (countProd === 0) {
    const productsPath = path.resolve(__dirname, './seed/products.json');
    if (fs.existsSync(productsPath)) {
      const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
      const stmtProd = db.prepare(`
        INSERT INTO products (id, categoryId, groupId, title, priceRub, description, variant, strength, cost_price, stock, min_stock, use_category_image, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const stmtImg = db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)');
      const stmtLink = db.prepare('INSERT INTO product_links (productId, label, url, position) VALUES (?, ?, ?, ?)');
      const tx = db.transaction((rows) => {
        for (const p of rows) {
          const createdAt = new Date().toISOString();
          const useCategoryImage = p.useCategoryImage !== undefined ? (p.useCategoryImage ? 1 : 0) : 1;
          stmtProd.run(
            p.id,
            p.categoryId,
            p.groupId || null,
            p.title || null,
            p.priceRub,
            p.description || null,
            p.variant || null,
            p.strength || null,
            typeof p.costPrice === 'number' ? p.costPrice : 0,
            typeof p.stock === 'number' ? p.stock : 0,
            typeof p.minStock === 'number' ? p.minStock : 0,
            useCategoryImage,
            createdAt
          );
          if (Array.isArray(p.images)) {
            p.images.forEach((url, idx) => stmtImg.run(p.id, url, idx));
          }
          if (Array.isArray(p.links)) {
            p.links.forEach((link, idx) => {
              if (!link || !link.url) return;
              stmtLink.run(p.id, link.label || null, link.url, idx);
            });
          }
        }
      });
      tx(products);
      console.log(`[navalivay:db] Seeded products: ${products.length}`);
    }
  }

  // Seed banners
  const countBanners = db.prepare('SELECT COUNT(*) as c FROM banners').get().c;
  if (countBanners === 0) {
    const bannersPath = path.resolve(__dirname, './seed/banners.json');
    if (fs.existsSync(bannersPath)) {
      const banners = JSON.parse(fs.readFileSync(bannersPath, 'utf8'));
      const stmt = db.prepare('INSERT INTO banners (id, image, href, active, [order], title, openInNewTab) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const tx = db.transaction((rows) => {
        for (const b of rows) {
          stmt.run(
            b.id,
            b.image,
            b.href || null,
            b.active ? 1 : 0,
            b.order || 0,
            b.title || null,
            b.openInNewTab ? 1 : 0
          );
        }
      });
      tx(banners);
      console.log(`[navalivay:db] Seeded banners: ${banners.length}`);
    }
  }
}
