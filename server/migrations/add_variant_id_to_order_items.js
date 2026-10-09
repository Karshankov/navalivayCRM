import { db } from '../db.js';

/**
 * Migration: adds variant_id column to order_items table
 * 
 * This column tracks which product variant was ordered.
 * Required for proper stock deduction/return on:
 * - Status change to 'in_progress' (stock deducted from variant)
 * - Order cancellation (stock returned to variant)
 * - Order item modification on packed orders
 * 
 * Without this column, variant stock cannot be properly tracked.
 */
export function migrateVariantIdToOrderItems() {
  try {
    // Check if column exists
    const tableInfo = db.prepare("PRAGMA table_info(order_items)").all();
    const hasVariantId = tableInfo.some(col => col.name === 'variant_id');

    if (!hasVariantId) {
      console.log('[migration] Adding variant_id column to order_items table...');
      db.prepare('ALTER TABLE order_items ADD COLUMN variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL').run();
      console.log('[migration] Successfully added variant_id column to order_items');
    }
  } catch (error) {
    console.error('[migration] Error adding variant_id column to order_items:', error);
  }
}
