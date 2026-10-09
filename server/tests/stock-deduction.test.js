/**
 * Stock Deduction Logic Tests
 * 
 * Tests the new stock deduction behavior:
 * 1. Order creation (status 'new') - stock is NOT deducted
 * 2. Status change to 'in_progress' (packed) - stock IS deducted, stock_deducted = 1
 * 3. Order cancellation with stock_deducted=1 - stock is returned, flag = 0
 * 4. Order item modification on packed order - old stock returned, new stock deducted
 * 
 * Run with: node server/tests/stock-deduction.test.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the actual database
const DB_PATH = path.resolve(__dirname, '../data/navalivay.db');
const db = new Database(DB_PATH);

// Test state
const testIds = {
  products: [],
  variants: [],
  orders: [],
  orderItems: [],
  categories: [],
  categoryGroups: []
};

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// ============================================================================
// HELPERS
// ============================================================================

function generateId(prefix) {
  return `${prefix}_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function assert(condition, message) {
  if (condition) {
    results.passed++;
    results.tests.push({ status: 'PASS', message });
    console.log(`  ✅ ${message}`);
    return true;
  } else {
    results.failed++;
    results.tests.push({ status: 'FAIL', message });
    console.log(`  ❌ ${message}`);
    return false;
  }
}

function assertEqual(actual, expected, message) {
  const condition = actual === expected;
  if (!condition) {
    console.log(`     Expected: ${expected}, Got: ${actual}`);
  }
  return assert(condition, message);
}

function log(message) {
  console.log(`\n📋 ${message}`);
}

function logSection(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 ${title}`);
  console.log('='.repeat(60));
}

// ============================================================================
// SETUP & TEARDOWN
// ============================================================================

function setupTestData() {
  log('Setting up test data...');
  
  // Create test category
  const categoryId = generateId('cat');
  testIds.categories.push(categoryId);
  
  db.prepare(`
    INSERT INTO categories (id, slug, name, [order])
    VALUES (?, ?, ?, ?)
  `).run(categoryId, 'test-category', 'Test Category', 999);
  
  // Create test category group
  const groupId = generateId('grp');
  testIds.categoryGroups.push(groupId);
  
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order])
    VALUES (?, ?, ?, ?, ?)
  `).run(groupId, categoryId, 'test-group', 'Test Group', 999);
  
  // Create regular test product with known stock
  const productId1 = generateId('prod');
  testIds.products.push(productId1);
  
  db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, cost_price, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, DATETIME('now'))
  `).run(productId1, categoryId, groupId, 'Test Product Regular', 100, 50, 30);
  
  // Create product with variants
  const productId2 = generateId('prod');
  testIds.products.push(productId2);
  
  db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, cost_price, has_variants, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, DATETIME('now'))
  `).run(productId2, categoryId, groupId, 'Test Product With Variants', 150, 0, 50);
  
  // Create variants for the second product
  const variantId1 = generateId('var');
  const variantId2 = generateId('var');
  testIds.variants.push(variantId1, variantId2);
  
  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, color_code, stock, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(variantId1, productId2, 'Red', '#FF0000', 30, 0);
  
  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, color_code, stock, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(variantId2, productId2, 'Blue', '#0000FF', 20, 1);
  
  // Create another regular product for item modification tests
  const productId3 = generateId('prod');
  testIds.products.push(productId3);
  
  db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, stock, cost_price, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, DATETIME('now'))
  `).run(productId3, categoryId, groupId, 'Test Product Alternative', 200, 40, 60);
  
  log(`Created test products: ${testIds.products.join(', ')}`);
  log(`Created test variants: ${testIds.variants.join(', ')}`);
}

function cleanupTestData() {
  log('Cleaning up test data...');
  
  const tx = db.transaction(() => {
    // Delete order items
    for (const orderId of testIds.orders) {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    }
    
    // Delete orders
    for (const orderId of testIds.orders) {
      db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    }
    
    // Delete variants
    for (const variantId of testIds.variants) {
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
    }
    
    // Delete products
    for (const productId of testIds.products) {
      db.prepare('DELETE FROM product_images WHERE productId = ?').run(productId);
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    }
    
    // Delete category groups
    for (const groupId of testIds.categoryGroups) {
      db.prepare('DELETE FROM category_groups WHERE id = ?').run(groupId);
    }
    
    // Delete categories
    for (const categoryId of testIds.categories) {
      db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
    }
  });
  
  tx();
  log('Test data cleaned up successfully');
}

function getProductStock(productId) {
  const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId);
  return product?.stock ?? null;
}

function getVariantStock(variantId) {
  const variant = db.prepare('SELECT stock FROM product_variants WHERE id = ?').get(variantId);
  return variant?.stock ?? null;
}

function getOrder(orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function getOrderNumber() {
  const row = db.prepare('SELECT MAX(order_number) as maxNum FROM orders').get();
  return (row?.maxNum || 0) + 1;
}

// ============================================================================
// ORDER CREATION HELPERS (simulating the API behavior)
// ============================================================================

function createOrder(items, options = {}) {
  const orderId = generateId('order');
  const orderNumber = getOrderNumber();
  
  let totalAmount = 0;
  let totalCost = 0;
  const orderItems = [];
  
  // Calculate totals
  for (const item of items) {
    let product;
    
    if (item.variant_id) {
      // For variants, get variant info and parent product for price
      const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(item.variant_id);
      product = db.prepare('SELECT * FROM products WHERE id = ?').get(variant.product_id);
    } else {
      product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    }
    
    if (!product) {
      throw new Error(`Product not found: ${item.product_id}`);
    }
    
    const pricePerUnit = item.price_per_unit || product.priceRub;
    const costPerUnit = product.cost_price || 0;
    const quantity = item.quantity || 1;
    const totalPrice = pricePerUnit * quantity;
    const totalItemCost = costPerUnit * quantity;
    
    totalAmount += totalPrice;
    totalCost += totalItemCost;
    
    orderItems.push({
      id: generateId('oi'),
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      product_title: product.title,
      quantity,
      price_per_unit: pricePerUnit,
      cost_per_unit: costPerUnit,
      total_price: totalPrice,
      total_cost: totalItemCost
    });
  }
  
  const discountAmount = options.discount_amount || 0;
  const discountPercent = options.discount_percent || 0;
  let finalAmount = totalAmount - discountAmount;
  if (discountPercent > 0) {
    finalAmount = finalAmount * (1 - discountPercent / 100);
  }
  const profit = finalAmount - totalCost;
  
  const tx = db.transaction(() => {
    // Insert order - stock NOT deducted on creation
    db.prepare(`
      INSERT INTO orders (
        id, order_number, status, delivery_type, total_amount, 
        discount_amount, discount_percent, final_amount, profit, stock_deducted
      ) VALUES (?, ?, 'new', 'pickup', ?, ?, ?, ?, ?, 0)
    `).run(orderId, orderNumber, totalAmount, discountAmount, discountPercent, finalAmount, profit);
    
    // Insert order items with variant_id support
    for (const item of orderItems) {
      db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, variant_id, product_title, quantity,
          price_per_unit, cost_per_unit, total_price, total_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id, orderId, item.product_id, item.variant_id, item.product_title, item.quantity,
        item.price_per_unit, item.cost_per_unit, item.total_price, item.total_cost
      );
      testIds.orderItems.push(item.id);
    }
  });
  
  tx();
  testIds.orders.push(orderId);
  
  return { orderId, orderItems };
}

function changeOrderStatus(orderId, newStatus) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  
  const tx = db.transaction(() => {
    const updateFields = ['status = ?'];
    const updateValues = [newStatus];
    
    // Stock deduction: when moving to any "working" status and stock not yet deducted
    const workingStatuses = ['in_progress', 'completed', 'delivered'];
    if (workingStatuses.includes(newStatus) && !order.stock_deducted) {
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      
      for (const item of orderItems) {
        if (item.variant_id) {
          // For variants, deduct from variant stock
          db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?')
            .run(item.quantity, item.variant_id);
        } else if (item.product_id) {
          // For regular products, deduct from product stock
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
            .run(item.quantity, item.product_id);
        }
      }
      updateFields.push('stock_deducted = 1');
    }
    
    // Stock return: cancellation when stock_deducted = 1
    if (newStatus === 'cancelled' && order.status !== 'cancelled' && order.stock_deducted) {
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      
      for (const item of orderItems) {
        if (item.variant_id) {
          // For variants, return to variant stock
          db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?')
            .run(item.quantity, item.variant_id);
        } else if (item.product_id) {
          // For regular products, return to product stock
          db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
            .run(item.quantity, item.product_id);
        }
      }
      updateFields.push('stock_deducted = 0');
      updateFields.push('previous_status = ?');
      updateValues.push(order.status);
    }
    
    updateFields.push("updated_at = DATETIME('now')");
    updateValues.push(orderId);
    
    db.prepare(`UPDATE orders SET ${updateFields.join(', ')} WHERE id = ?`)
      .run(...updateValues);
  });
  
  tx();
}

function updateOrderItems(orderId, newItems) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  
  const tx = db.transaction(() => {
    // Return old stock if it was previously deducted
    if (order.stock_deducted) {
      const oldItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      for (const item of oldItems) {
        if (item.variant_id) {
          db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?')
            .run(item.quantity, item.variant_id);
        } else if (item.product_id) {
          db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
            .run(item.quantity, item.product_id);
        }
      }
    }
    
    // Delete old items
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    
    let totalAmount = 0;
    let totalCost = 0;
    
    // Insert new items and deduct stock if order was already packed
    for (const item of newItems) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
      if (!product) {
        throw new Error(`Product not found: ${item.product_id}`);
      }
      
      const quantity = item.quantity || 1;
      const pricePerUnit = item.price_per_unit || product.priceRub;
      const costPerUnit = product.cost_price || 0;
      const totalPrice = pricePerUnit * quantity;
      const totalItemCost = costPerUnit * quantity;
      
      totalAmount += totalPrice;
      totalCost += totalItemCost;
      
      const itemId = generateId('oi');
      db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, variant_id, product_title, quantity,
          price_per_unit, cost_per_unit, total_price, total_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(itemId, orderId, item.product_id, item.variant_id || null, product.title, quantity, pricePerUnit, costPerUnit, totalPrice, totalItemCost);
      testIds.orderItems.push(itemId);
      
      // Deduct new stock only if order was already packed
      if (order.stock_deducted) {
        if (item.variant_id) {
          db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?')
            .run(quantity, item.variant_id);
        } else {
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
            .run(quantity, item.product_id);
        }
      }
    }
    
    // Update order totals
    const finalAmount = totalAmount - (order.discount_amount || 0);
    const profit = finalAmount - totalCost;
    
    db.prepare(`
      UPDATE orders SET total_amount = ?, final_amount = ?, profit = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(totalAmount, finalAmount, profit, orderId);
  });
  
  tx();
}

// ============================================================================
// TESTS
// ============================================================================

function testOrderCreationNoStockDeduction() {
  logSection('TEST 1: Order Creation - Stock NOT Deducted');
  
  const productId = testIds.products[0]; // Regular product with 50 stock
  const initialStock = getProductStock(productId);
  
  log(`Initial stock: ${initialStock}`);
  
  // Create order with 5 items
  const { orderId } = createOrder([
    { product_id: productId, quantity: 5 }
  ]);
  
  const stockAfterOrder = getProductStock(productId);
  const order = getOrder(orderId);
  
  log(`Stock after order creation: ${stockAfterOrder}`);
  log(`Order status: ${order.status}, stock_deducted: ${order.stock_deducted}`);
  
  assertEqual(order.status, 'new', 'Order should have status "new"');
  assertEqual(order.stock_deducted, 0, 'stock_deducted flag should be 0');
  assertEqual(stockAfterOrder, initialStock, 'Stock should NOT change on order creation');
  assertEqual(stockAfterOrder, 50, 'Stock should remain at 50');
  
  return orderId;
}

function testStatusChangeToInProgress(orderId) {
  logSection('TEST 2: Status Change to in_progress - Stock IS Deducted');
  
  const productId = testIds.products[0];
  const stockBeforeStatusChange = getProductStock(productId);
  
  log(`Stock before status change: ${stockBeforeStatusChange}`);
  
  // Change status to in_progress (packed)
  changeOrderStatus(orderId, 'in_progress');
  
  const stockAfterStatusChange = getProductStock(productId);
  const order = getOrder(orderId);
  
  log(`Stock after status change: ${stockAfterStatusChange}`);
  log(`Order status: ${order.status}, stock_deducted: ${order.stock_deducted}`);
  
  assertEqual(order.status, 'in_progress', 'Order should have status "in_progress"');
  assertEqual(order.stock_deducted, 1, 'stock_deducted flag should be 1');
  assertEqual(stockAfterStatusChange, 45, 'Stock should be reduced by 5 (50 - 5 = 45)');
  
  return orderId;
}

function testOrderCancellationStockReturned(orderId) {
  logSection('TEST 3: Order Cancellation - Stock IS Returned');
  
  const productId = testIds.products[0];
  const stockBeforeCancellation = getProductStock(productId);
  const orderBefore = getOrder(orderId);
  
  log(`Stock before cancellation: ${stockBeforeCancellation}`);
  log(`stock_deducted before cancellation: ${orderBefore.stock_deducted}`);
  
  // Cancel the order
  changeOrderStatus(orderId, 'cancelled');
  
  const stockAfterCancellation = getProductStock(productId);
  const order = getOrder(orderId);
  
  log(`Stock after cancellation: ${stockAfterCancellation}`);
  log(`Order status: ${order.status}, stock_deducted: ${order.stock_deducted}`);
  
  assertEqual(order.status, 'cancelled', 'Order should have status "cancelled"');
  assertEqual(order.stock_deducted, 0, 'stock_deducted flag should be 0 after cancellation');
  assertEqual(stockAfterCancellation, 50, 'Stock should be returned (45 + 5 = 50)');
}

function testOrderCancellationBeforePacking() {
  logSection('TEST 4: Order Cancellation Before Packing - Stock NOT Changed');
  
  const productId = testIds.products[0];
  const initialStock = getProductStock(productId);
  
  log(`Initial stock: ${initialStock}`);
  
  // Create order
  const { orderId } = createOrder([
    { product_id: productId, quantity: 3 }
  ]);
  
  const stockAfterOrder = getProductStock(productId);
  log(`Stock after order creation: ${stockAfterOrder}`);
  
  // Cancel without packing (status still 'new')
  changeOrderStatus(orderId, 'cancelled');
  
  const stockAfterCancellation = getProductStock(productId);
  const order = getOrder(orderId);
  
  log(`Stock after cancellation: ${stockAfterCancellation}`);
  log(`Order status: ${order.status}, stock_deducted: ${order.stock_deducted}`);
  
  assertEqual(order.status, 'cancelled', 'Order should have status "cancelled"');
  assertEqual(order.stock_deducted, 0, 'stock_deducted flag should be 0');
  assertEqual(stockAfterCancellation, initialStock, 'Stock should remain unchanged');
}

function testOrderItemModificationOnPackedOrder() {
  logSection('TEST 5: Order Item Modification on Packed Order');
  
  const productId1 = testIds.products[0]; // Regular product, stock = 50
  const productId3 = testIds.products[2]; // Alternative product, stock = 40
  
  const initialStock1 = getProductStock(productId1);
  const initialStock3 = getProductStock(productId3);
  
  log(`Initial stock product 1: ${initialStock1}`);
  log(`Initial stock product 3: ${initialStock3}`);
  
  // Create order with product 1 (5 items)
  const { orderId } = createOrder([
    { product_id: productId1, quantity: 5 }
  ]);
  
  // Pack the order
  changeOrderStatus(orderId, 'in_progress');
  
  const stockAfterPacking1 = getProductStock(productId1);
  const stockAfterPacking3 = getProductStock(productId3);
  
  log(`Stock after packing - product 1: ${stockAfterPacking1}`);
  log(`Stock after packing - product 3: ${stockAfterPacking3}`);
  
  assertEqual(stockAfterPacking1, 45, 'Product 1 stock should be 45 after packing');
  assertEqual(stockAfterPacking3, 40, 'Product 3 stock should remain 40');
  
  // Now modify the order: replace product 1 (qty 5) with product 3 (qty 3)
  log('Modifying order: replacing product 1 (qty 5) with product 3 (qty 3)');
  
  updateOrderItems(orderId, [
    { product_id: productId3, quantity: 3 }
  ]);
  
  const stockAfterModification1 = getProductStock(productId1);
  const stockAfterModification3 = getProductStock(productId3);
  const order = getOrder(orderId);
  
  log(`Stock after modification - product 1: ${stockAfterModification1}`);
  log(`Stock after modification - product 3: ${stockAfterModification3}`);
  
  assertEqual(order.stock_deducted, 1, 'stock_deducted should remain 1');
  assertEqual(stockAfterModification1, 50, 'Product 1 stock should be restored to 50');
  assertEqual(stockAfterModification3, 37, 'Product 3 stock should be reduced to 37 (40 - 3)');
}

function testOrderItemModificationOnUnpackedOrder() {
  logSection('TEST 6: Order Item Modification on Unpacked Order - Stock NOT Changed');
  
  const productId1 = testIds.products[0];
  const productId3 = testIds.products[2];
  
  const initialStock1 = getProductStock(productId1);
  const initialStock3 = getProductStock(productId3);
  
  log(`Initial stock product 1: ${initialStock1}`);
  log(`Initial stock product 3: ${initialStock3}`);
  
  // Create order with product 1 (2 items) - NOT packed
  const { orderId } = createOrder([
    { product_id: productId1, quantity: 2 }
  ]);
  
  const stockAfterOrder1 = getProductStock(productId1);
  assertEqual(stockAfterOrder1, initialStock1, 'Stock should not change on order creation');
  
  // Modify order while still in 'new' status
  log('Modifying order: replacing product 1 (qty 2) with product 3 (qty 4)');
  
  updateOrderItems(orderId, [
    { product_id: productId3, quantity: 4 }
  ]);
  
  const stockAfterModification1 = getProductStock(productId1);
  const stockAfterModification3 = getProductStock(productId3);
  const order = getOrder(orderId);
  
  log(`Stock after modification - product 1: ${stockAfterModification1}`);
  log(`Stock after modification - product 3: ${stockAfterModification3}`);
  
  assertEqual(order.stock_deducted, 0, 'stock_deducted should be 0');
  assertEqual(stockAfterModification1, initialStock1, 'Product 1 stock should remain unchanged');
  assertEqual(stockAfterModification3, initialStock3, 'Product 3 stock should remain unchanged');
}

function testMultipleItemsOrder() {
  logSection('TEST 7: Order with Multiple Items');
  
  const productId1 = testIds.products[0];
  const productId3 = testIds.products[2];
  
  const initialStock1 = getProductStock(productId1);
  const initialStock3 = getProductStock(productId3);
  
  log(`Initial stock product 1: ${initialStock1}`);
  log(`Initial stock product 3: ${initialStock3}`);
  
  // Create order with multiple items
  const { orderId } = createOrder([
    { product_id: productId1, quantity: 2 },
    { product_id: productId3, quantity: 3 }
  ]);
  
  const stockAfterOrder1 = getProductStock(productId1);
  const stockAfterOrder3 = getProductStock(productId3);
  
  assertEqual(stockAfterOrder1, initialStock1, 'Product 1 stock should not change on creation');
  assertEqual(stockAfterOrder3, initialStock3, 'Product 3 stock should not change on creation');
  
  // Pack the order
  changeOrderStatus(orderId, 'in_progress');
  
  const stockAfterPacking1 = getProductStock(productId1);
  const stockAfterPacking3 = getProductStock(productId3);
  
  log(`Stock after packing - product 1: ${stockAfterPacking1}`);
  log(`Stock after packing - product 3: ${stockAfterPacking3}`);
  
  assertEqual(stockAfterPacking1, initialStock1 - 2, 'Product 1 stock should decrease by 2');
  assertEqual(stockAfterPacking3, initialStock3 - 3, 'Product 3 stock should decrease by 3');
  
  // Cancel the order
  changeOrderStatus(orderId, 'cancelled');
  
  const stockAfterCancel1 = getProductStock(productId1);
  const stockAfterCancel3 = getProductStock(productId3);
  
  log(`Stock after cancellation - product 1: ${stockAfterCancel1}`);
  log(`Stock after cancellation - product 3: ${stockAfterCancel3}`);
  
  assertEqual(stockAfterCancel1, initialStock1, 'Product 1 stock should be restored');
  assertEqual(stockAfterCancel3, initialStock3, 'Product 3 stock should be restored');
}

function testVariantStockDeduction() {
  logSection('TEST 8: Variant Stock Deduction');
  
  const variantId1 = testIds.variants[0]; // Red variant, stock = 30
  const productId = testIds.products[1]; // Parent product with variants
  
  const initialVariantStock = getVariantStock(variantId1);
  const initialProductStock = getProductStock(productId);
  
  log(`Initial variant stock (Red): ${initialVariantStock}`);
  log(`Initial parent product stock: ${initialProductStock}`);
  
  // Create order with variant
  const { orderId } = createOrder([
    { product_id: productId, variant_id: variantId1, quantity: 5 }
  ]);
  
  // Verify stock not deducted on creation
  const variantStockAfterCreation = getVariantStock(variantId1);
  assertEqual(variantStockAfterCreation, initialVariantStock, 'Variant stock should NOT change on order creation');
  
  // Pack the order
  changeOrderStatus(orderId, 'in_progress');
  
  const variantStockAfterPacking = getVariantStock(variantId1);
  const productStockAfterPacking = getProductStock(productId);
  const order = getOrder(orderId);
  
  log(`Variant stock after packing: ${variantStockAfterPacking}`);
  log(`Product stock after packing: ${productStockAfterPacking}`);
  
  assertEqual(order.stock_deducted, 1, 'stock_deducted should be 1 after packing');
  assertEqual(variantStockAfterPacking, initialVariantStock - 5, 'Variant stock should decrease by 5');
  assertEqual(productStockAfterPacking, initialProductStock, 'Product stock should NOT change (variant was ordered)');
  
  // Cancel the order
  changeOrderStatus(orderId, 'cancelled');
  
  const variantStockAfterCancel = getVariantStock(variantId1);
  const orderAfterCancel = getOrder(orderId);
  
  log(`Variant stock after cancellation: ${variantStockAfterCancel}`);
  
  assertEqual(orderAfterCancel.stock_deducted, 0, 'stock_deducted should be 0 after cancellation');
  assertEqual(variantStockAfterCancel, initialVariantStock, 'Variant stock should be restored');
}

function testVariantItemModificationOnPackedOrder() {
  logSection('TEST 10: Variant Item Modification on Packed Order');
  
  const variantId1 = testIds.variants[0]; // Red variant, stock = 30
  const variantId2 = testIds.variants[1]; // Blue variant, stock = 20
  const productId = testIds.products[1]; // Parent product with variants
  
  const initialRedStock = getVariantStock(variantId1);
  const initialBlueStock = getVariantStock(variantId2);
  
  log(`Initial Red variant stock: ${initialRedStock}`);
  log(`Initial Blue variant stock: ${initialBlueStock}`);
  
  // Create order with Red variant (3 items)
  const { orderId } = createOrder([
    { product_id: productId, variant_id: variantId1, quantity: 3 }
  ]);
  
  // Pack the order
  changeOrderStatus(orderId, 'in_progress');
  
  const redStockAfterPacking = getVariantStock(variantId1);
  const blueStockAfterPacking = getVariantStock(variantId2);
  
  log(`Red variant stock after packing: ${redStockAfterPacking}`);
  
  assertEqual(redStockAfterPacking, initialRedStock - 3, 'Red variant stock should decrease by 3');
  assertEqual(blueStockAfterPacking, initialBlueStock, 'Blue variant stock should remain unchanged');
  
  // Now modify order: replace Red (qty 3) with Blue (qty 2)
  log('Modifying order: replacing Red variant (qty 3) with Blue variant (qty 2)');
  
  updateOrderItems(orderId, [
    { product_id: productId, variant_id: variantId2, quantity: 2 }
  ]);
  
  const redStockAfterModification = getVariantStock(variantId1);
  const blueStockAfterModification = getVariantStock(variantId2);
  
  log(`Red variant stock after modification: ${redStockAfterModification}`);
  log(`Blue variant stock after modification: ${blueStockAfterModification}`);
  
  assertEqual(redStockAfterModification, initialRedStock, 'Red variant stock should be restored');
  assertEqual(blueStockAfterModification, initialBlueStock - 2, 'Blue variant stock should decrease by 2');
}

function testStatusTransitionMatrix() {
  logSection('TEST 9: Status Transition Matrix');
  
  const productId = testIds.products[0];
  
  // Test: new → completed (should deduct stock since completed is a "working" status)
  log('Testing: new → completed (skipping in_progress)');
  
  const stock1 = getProductStock(productId);
  const { orderId: orderId1 } = createOrder([
    { product_id: productId, quantity: 1 }
  ]);
  
  // Going directly to 'completed' from 'new' SHOULD deduct stock
  // because completed is a "working" status (in_progress, completed, delivered)
  changeOrderStatus(orderId1, 'completed');
  
  const order1 = getOrder(orderId1);
  const stock1After = getProductStock(productId);
  
  assertEqual(order1.status, 'completed', 'Status should be completed');
  assertEqual(order1.stock_deducted, 1, 'stock_deducted should be 1 (deducted on completed)');
  assertEqual(stock1After, stock1 - 1, 'Stock SHOULD decrease by 1');
  
  // Clean up - cancel to restore stock
  changeOrderStatus(orderId1, 'cancelled');
  
  log('');
  log('✅ Stock is deducted when transitioning to any working status.');
  log('   Working statuses: in_progress, completed, delivered');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     NAVALIVAY - Stock Deduction Logic Test Suite             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  try {
    // Setup
    setupTestData();
    
    // Run tests
    const orderId1 = testOrderCreationNoStockDeduction();
    testStatusChangeToInProgress(orderId1);
    testOrderCancellationStockReturned(orderId1);
    
    testOrderCancellationBeforePacking();
    testOrderItemModificationOnPackedOrder();
    testOrderItemModificationOnUnpackedOrder();
    testMultipleItemsOrder();
    testVariantStockDeduction();
    testStatusTransitionMatrix();
    testVariantItemModificationOnPackedOrder();
    
  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    console.error(error.stack);
    results.failed++;
  } finally {
    // Cleanup
    cleanupTestData();
    
    // Print summary
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('═'.repeat(60));
    console.log(`   ✅ Passed: ${results.passed}`);
    console.log(`   ❌ Failed: ${results.failed}`);
    console.log(`   📈 Total:  ${results.passed + results.failed}`);
    console.log('═'.repeat(60));
    
    if (results.failed > 0) {
      console.log('\n⚠️  Some tests failed. Check the output above for details.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  }
}

main().catch(console.error);
