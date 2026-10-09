import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-inventory-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');
const { crmOperationsRouter } = await import('../routes/crm-operations.js');
const { syncProductSearchIndex } = await import('../services/product-search-service.js');
const { migrateInventoryLocations } = await import('../migrations/add_inventory_locations.js');

initDb();

db.prepare(`
  INSERT INTO stock_transfers (
    id, transfer_number, source_location, destination_location, status, created_at
  ) VALUES ('legacy_interrupted', 999, 'retail', 'warehouse', 'draft', DATETIME('now'))
`).run();
migrateInventoryLocations();
const transferItemColumns = new Set(
  db.prepare("PRAGMA table_info('stock_transfer_items')").all().map((column) => column.name),
);
assert.ok(transferItemColumns.has('category_name'));
assert.ok(transferItemColumns.has('group_name'));
assert.ok(transferItemColumns.has('image_url'));
assert.equal(
  db.prepare('SELECT status FROM stock_transfers WHERE id = ?').get('legacy_interrupted').status,
  'completed',
);
db.prepare('DELETE FROM stock_transfers WHERE id = ?').run('legacy_interrupted');

db.exec(`
  DELETE FROM product_images;
  DELETE FROM product_variants;
  DELETE FROM products;
  DELETE FROM category_groups;
  DELETE FROM categories;

  INSERT INTO categories (id, slug, name, [order])
  VALUES ('cat_inventory', 'inventory', 'Inventory', 1);

  INSERT INTO category_groups (id, categoryId, slug, name, [order])
  VALUES ('group_inventory', 'cat_inventory', 'podgon', 'PODONKI PODGON', 1);

  INSERT INTO products (
    id, categoryId, groupId, title, priceRub, cost_price, stock, warehouse_stock,
    has_variants, createdAt
  ) VALUES
    ('product_regular', 'cat_inventory', 'group_inventory', 'Манго', 20, 5, 10, 0, 0, DATETIME('now')),
    ('product_variant', 'cat_inventory', 'group_inventory', 'XROS', 100, 30, 0, 0, 1, DATETIME('now'));

  INSERT INTO product_variants (
    id, product_id, name, price_rub, stock, warehouse_stock, position
  ) VALUES
    ('variant_black', 'product_variant', 'Чёрный', 100, 10, 0, 0),
    ('variant_white', 'product_variant', 'Белый', 100, 10, 0, 1);
`);

syncProductSearchIndex();

const app = express();
app.use(express.json());
app.use(adminRouter);
app.use(crmOperationsRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const token = issueToken('inventory-test');

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return { response, data: await response.json() };
}

function regularStock() {
  return db.prepare('SELECT stock, warehouse_stock FROM products WHERE id = ?').get('product_regular');
}

function variantStock() {
  return db.prepare('SELECT stock, warehouse_stock FROM product_variants WHERE id = ?').get('variant_black');
}

try {
  const regularDisplay = db.prepare(`
    SELECT p.categoryId AS category_id,
           p.groupId AS group_id,
           c.name AS category_name,
           cg.name AS group_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.categoryId
    LEFT JOIN category_groups cg ON cg.id = p.groupId
    WHERE p.id = ?
  `).get('product_regular');
  assert.ok(regularDisplay.category_name);
  assert.ok(regularDisplay.group_name);
  db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)')
    .run('product_regular', '/uploads/regular-transfer.jpg', 0);
  db.prepare('INSERT INTO product_images (productId, variant_id, url, position) VALUES (?, ?, ?, ?)')
    .run('product_variant', null, '/uploads/variant-base.jpg', 0);
  db.prepare('INSERT INTO product_images (productId, variant_id, url, position) VALUES (?, ?, ?, ?)')
    .run('product_variant', 'variant_black', '/uploads/variant-black.jpg', 1);

  const moveToWarehouse = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'retail',
      destination_location: 'warehouse',
      comment: 'Первичное наполнение',
      items: [
        { product_id: 'product_regular', quantity: 4 },
        { product_id: 'product_variant', variant_id: 'variant_black', quantity: 3 },
      ],
    }),
  });
  assert.equal(moveToWarehouse.response.status, 200);
  assert.equal(moveToWarehouse.data.status, 'draft');
  assert.equal(moveToWarehouse.data.created_by, 'inventory-test');
  const regularTransferItem = moveToWarehouse.data.items.find((item) => item.product_id === 'product_regular');
  assert.equal(regularTransferItem.category_name, regularDisplay.category_name);
  assert.equal(regularTransferItem.group_name, regularDisplay.group_name);
  assert.equal(regularTransferItem.product_image, '/uploads/regular-transfer.jpg');
  const variantTransferItem = moveToWarehouse.data.items.find((item) => item.variant_id === 'variant_black');
  assert.equal(variantTransferItem.product_image, '/uploads/variant-black.jpg');

  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run('Переименованная категория', regularDisplay.category_id);
  db.prepare('UPDATE category_groups SET name = ? WHERE id = ?').run('Переименованная линейка', regularDisplay.group_id);
  db.prepare('UPDATE product_images SET url = ? WHERE productId = ?')
    .run('/uploads/changed-after-transfer.jpg', 'product_regular');
  const savedTransfer = await requestJson(`/api/admin/inventory/transfers/${moveToWarehouse.data.id}`);
  const savedRegularItem = savedTransfer.data.items.find((item) => item.product_id === 'product_regular');
  assert.equal(savedRegularItem.category_name, regularDisplay.category_name);
  assert.equal(savedRegularItem.group_name, regularDisplay.group_name);
  assert.equal(savedRegularItem.product_image, '/uploads/regular-transfer.jpg');
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(regularDisplay.category_name, regularDisplay.category_id);
  db.prepare('UPDATE category_groups SET name = ? WHERE id = ?').run(regularDisplay.group_name, regularDisplay.group_id);
  db.prepare('UPDATE product_images SET url = ? WHERE productId = ?')
    .run('/uploads/regular-transfer.jpg', 'product_regular');
  db.prepare(`
    UPDATE stock_transfer_items
    SET category_name = NULL, group_name = NULL, image_url = NULL
    WHERE transfer_id = ? AND product_id = ?
  `).run(moveToWarehouse.data.id, 'product_regular');
  const legacyStyleTransfer = await requestJson(`/api/admin/inventory/transfers/${moveToWarehouse.data.id}`);
  const legacyStyleItem = legacyStyleTransfer.data.items.find((item) => item.product_id === 'product_regular');
  assert.equal(legacyStyleItem.category_name, regularDisplay.category_name);
  assert.equal(legacyStyleItem.group_name, regularDisplay.group_name);
  assert.equal(legacyStyleItem.product_image, '/uploads/regular-transfer.jpg');
  db.prepare('DELETE FROM product_images WHERE productId = ?').run('product_regular');
  db.prepare('UPDATE category_groups SET cover_image = ? WHERE id = ?')
    .run('/uploads/group-transfer.jpg', regularDisplay.group_id);
  const fallbackTransfer = await requestJson(`/api/admin/inventory/transfers/${moveToWarehouse.data.id}`);
  const fallbackTransferItem = fallbackTransfer.data.items.find((item) => item.product_id === 'product_regular');
  assert.equal(fallbackTransferItem.product_image, '/uploads/group-transfer.jpg');
  db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)')
    .run('product_regular', '/uploads/regular-transfer.jpg', 0);
  db.prepare('UPDATE category_groups SET cover_image = NULL WHERE id = ?').run(regularDisplay.group_id);

  db.prepare('DELETE FROM product_images WHERE productId = ? AND variant_id IS NULL').run('product_variant');
  db.prepare('UPDATE category_groups SET cover_image = ? WHERE id = ?')
    .run('/uploads/group-transfer.jpg', regularDisplay.group_id);
  const variantFallbackMove = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'retail',
      destination_location: 'warehouse',
      items: [{ product_id: 'product_variant', variant_id: 'variant_white', quantity: 1 }],
    }),
  });
  assert.equal(variantFallbackMove.response.status, 200);
  assert.equal(variantFallbackMove.data.items[0].product_image, '/uploads/group-transfer.jpg');
  assert.equal(
    db.prepare('SELECT image_url FROM stock_transfer_items WHERE transfer_id = ?').get(variantFallbackMove.data.id).image_url,
    '/uploads/group-transfer.jpg',
  );
  db.prepare('DELETE FROM stock_transfer_items WHERE transfer_id = ?').run(variantFallbackMove.data.id);
  db.prepare('DELETE FROM stock_transfers WHERE id = ?').run(variantFallbackMove.data.id);
  db.prepare('INSERT INTO product_images (productId, variant_id, url, position) VALUES (?, ?, ?, ?)')
    .run('product_variant', null, '/uploads/variant-base.jpg', 0);
  db.prepare('UPDATE category_groups SET cover_image = NULL WHERE id = ?').run(regularDisplay.group_id);
  assert.deepEqual(regularStock(), { stock: 10, warehouse_stock: 0 });
  assert.deepEqual(variantStock(), { stock: 10, warehouse_stock: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stock_transfer_items').get().count, 2);

  const completeMove = await requestJson(`/api/admin/inventory/transfers/${moveToWarehouse.data.id}/complete`, {
    method: 'POST',
  });
  assert.equal(completeMove.response.status, 200);
  assert.equal(completeMove.data.status, 'completed');
  assert.equal(completeMove.data.completed_by, 'inventory-test');
  assert.deepEqual(regularStock(), { stock: 6, warehouse_stock: 4 });
  assert.deepEqual(variantStock(), { stock: 7, warehouse_stock: 3 });

  const completeMoveAgain = await requestJson(`/api/admin/inventory/transfers/${moveToWarehouse.data.id}/complete`, {
    method: 'POST',
  });
  assert.equal(completeMoveAgain.response.status, 409);
  const cancelCompletedMove = await requestJson(`/api/admin/inventory/transfers/${moveToWarehouse.data.id}/cancel`, {
    method: 'POST',
  });
  assert.equal(cancelCompletedMove.response.status, 409);

  db.prepare('DELETE FROM product_images WHERE productId = ?').run('product_regular');
  db.prepare('UPDATE category_groups SET cover_image = ? WHERE id = ?')
    .run('/uploads/group-transfer.jpg', regularDisplay.group_id);
  const cancelledMove = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'retail',
      destination_location: 'warehouse',
      items: [{ product_id: 'product_regular', quantity: 1 }],
    }),
  });
  assert.equal(cancelledMove.response.status, 200);
  assert.equal(cancelledMove.data.items[0].product_image, '/uploads/group-transfer.jpg');
  assert.equal(
    db.prepare('SELECT image_url FROM stock_transfer_items WHERE transfer_id = ?').get(cancelledMove.data.id).image_url,
    '/uploads/group-transfer.jpg',
  );
  db.prepare('INSERT INTO product_images (productId, url, position) VALUES (?, ?, ?)')
    .run('product_regular', '/uploads/regular-transfer.jpg', 0);
  db.prepare('UPDATE category_groups SET cover_image = NULL WHERE id = ?').run(regularDisplay.group_id);
  const cancelMove = await requestJson(`/api/admin/inventory/transfers/${cancelledMove.data.id}/cancel`, {
    method: 'POST',
  });
  assert.equal(cancelMove.response.status, 200);
  assert.equal(cancelMove.data.status, 'cancelled');
  assert.equal(cancelMove.data.cancelled_by, 'inventory-test');
  assert.deepEqual(regularStock(), { stock: 6, warehouse_stock: 4 });

  const transferList = await requestJson('/api/admin/inventory/transfers?page=1&limit=1');
  assert.equal(transferList.response.status, 200);
  assert.equal(transferList.data.pagination.total, 2);
  assert.equal(transferList.data.pagination.totalPages, 2);
  assert.equal(transferList.data.transfers[0].id, cancelledMove.data.id);
  const secondTransferPage = await requestJson('/api/admin/inventory/transfers?page=2&limit=1');
  assert.equal(secondTransferPage.response.status, 200);
  assert.equal(secondTransferPage.data.transfers[0].id, moveToWarehouse.data.id);

  const editVariantProduct = await requestJson('/api/admin/products/product_variant', {
    method: 'PATCH',
    body: JSON.stringify({
      hasVariants: true,
      variants: [
        { id: 'variant_black', name: 'Чёрный обновлённый', priceRub: 110, stock: 7, images: [] },
        { id: 'variant_white', name: 'Белый', priceRub: 100, stock: 10, images: [] },
      ],
    }),
  });
  assert.equal(editVariantProduct.response.status, 200);
  assert.deepEqual(variantStock(), { stock: 7, warehouse_stock: 3 });

  const warehouseProducts = await requestJson('/api/admin/products?location=warehouse&limit=20');
  assert.equal(warehouseProducts.response.status, 200);
  assert.deepEqual(
    new Set(warehouseProducts.data.products.map((product) => product.id)),
    new Set(['product_regular', 'product_variant']),
  );
  assert.deepEqual(
    warehouseProducts.data.availableGroups.map((group) => group.name),
    ['PODONKI PODGON'],
  );
  assert.deepEqual(
    warehouseProducts.data.products.find((product) => product.id === 'product_variant').variants.map((variant) => variant.id),
    ['variant_black'],
  );

  const tooMuch = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'warehouse',
      destination_location: 'retail',
      items: [{ product_id: 'product_regular', quantity: 5 }],
    }),
  });
  assert.equal(tooMuch.response.status, 400);
  assert.deepEqual(regularStock(), { stock: 6, warehouse_stock: 4 });

  const stockChangedDraft = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'warehouse',
      destination_location: 'retail',
      items: [{ product_id: 'product_regular', quantity: 4 }],
    }),
  });
  assert.equal(stockChangedDraft.response.status, 200);
  db.prepare('UPDATE products SET warehouse_stock = 3 WHERE id = ?').run('product_regular');
  const stockChangedComplete = await requestJson(`/api/admin/inventory/transfers/${stockChangedDraft.data.id}/complete`, {
    method: 'POST',
  });
  assert.equal(stockChangedComplete.response.status, 400);
  assert.equal(
    db.prepare('SELECT status FROM stock_transfers WHERE id = ?').get(stockChangedDraft.data.id).status,
    'draft',
  );
  assert.deepEqual(regularStock(), { stock: 6, warehouse_stock: 3 });
  db.prepare('UPDATE products SET warehouse_stock = 4 WHERE id = ?').run('product_regular');
  await requestJson(`/api/admin/inventory/transfers/${stockChangedDraft.data.id}/cancel`, { method: 'POST' });

  const invalidVariantProcurement = await requestJson('/api/admin/crm/procurements', {
    method: 'POST',
    body: JSON.stringify({
      supplier_name: 'Test invalid',
      items: [{ product_id: 'product_variant', quantity: 2, warehouse_quantity: 1, cost_per_unit: 30 }],
    }),
  });
  assert.equal(invalidVariantProcurement.response.status, 400);

  const createProcurement = await requestJson('/api/admin/crm/procurements', {
    method: 'POST',
    body: JSON.stringify({
      supplier_name: 'Test',
      items: [
        { product_id: 'product_regular', quantity: 10, warehouse_quantity: 5, cost_per_unit: 6 },
        { product_id: 'product_variant', variant_id: 'variant_black', quantity: 4, warehouse_quantity: 3, cost_per_unit: 32 },
        { product_id: 'product_variant', variant_id: 'variant_white', quantity: 2, warehouse_quantity: 1, cost_per_unit: 40 },
      ],
    }),
  });
  assert.equal(createProcurement.response.status, 200);

  const procurementId = createProcurement.data.id;
  const editAfterProcurement = await requestJson('/api/admin/products/product_variant', {
    method: 'PATCH',
    body: JSON.stringify({
      hasVariants: true,
      variants: [
        { id: 'variant_black', name: 'Чёрный', priceRub: 100, stock: 7, images: [] },
        { id: 'variant_white', name: 'Белый', priceRub: 100, stock: 10, images: [] },
      ],
    }),
  });
  assert.equal(editAfterProcurement.response.status, 200);
  assert.equal(
    db.prepare("SELECT variant_id FROM procurement_items WHERE procurement_id = ? AND product_id = ? AND variant_id = 'variant_black'").get(
      procurementId,
      'product_variant',
    ).variant_id,
    'variant_black',
  );
  assert.deepEqual(variantStock(), { stock: 7, warehouse_stock: 3 });
  const complete = await requestJson(`/api/admin/crm/procurements/${procurementId}/complete`, {
    method: 'POST',
  });
  assert.equal(complete.response.status, 200);
  assert.deepEqual(regularStock(), { stock: 11, warehouse_stock: 9 });
  assert.deepEqual(variantStock(), { stock: 8, warehouse_stock: 6 });
  assert.deepEqual(
    db.prepare('SELECT stock, warehouse_stock FROM product_variants WHERE id = ?').get('variant_white'),
    { stock: 11, warehouse_stock: 1 },
  );

  const remove = await requestJson(`/api/admin/crm/procurements/${procurementId}`, {
    method: 'DELETE',
  });
  assert.equal(remove.response.status, 200);
  assert.deepEqual(regularStock(), { stock: 6, warehouse_stock: 4 });
  assert.deepEqual(variantStock(), { stock: 7, warehouse_stock: 3 });
  assert.deepEqual(
    db.prepare('SELECT stock, warehouse_stock FROM product_variants WHERE id = ?').get('variant_white'),
    { stock: 10, warehouse_stock: 0 },
  );
  assert.ok(Math.abs(db.prepare('SELECT cost_price FROM products WHERE id = ?').get('product_variant').cost_price - 30) < 0.000001);

  // Правка черновика: заявку заводят заранее, а собирают товар потом, поэтому
  // забытую позицию дописывают в ту же заявку.
  console.log('inventory: черновик перемещения редактируется до оприходования');
  const editableDraft = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'retail',
      destination_location: 'warehouse',
      comment: 'Первый вариант',
      items: [{ product_id: 'product_regular', quantity: 1 }],
    }),
  });
  assert.equal(editableDraft.response.status, 200);
  const editableDraftId = editableDraft.data.id;
  const draftCreatedAt = editableDraft.data.created_at;

  const editedDraft = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`, {
    method: 'PUT',
    body: JSON.stringify({
      comment: 'Дописали вкус',
      items: [
        { product_id: 'product_regular', quantity: 2 },
        { product_id: 'product_variant', variant_id: 'variant_black', quantity: 1 },
      ],
    }),
  });
  assert.equal(editedDraft.response.status, 200);
  assert.equal(editedDraft.data.status, 'draft');
  assert.equal(editedDraft.data.comment, 'Дописали вкус');
  assert.equal(editedDraft.data.items.length, 2);
  assert.equal(Number(editedDraft.data.total_quantity), 3);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM stock_transfer_items WHERE transfer_id = ?').get(editableDraftId).count,
    2,
    'старые позиции не остаются рядом с новыми',
  );
  // Снапшоты названий пишутся заново, как при создании.
  const editedRegular = editedDraft.data.items.find((item) => item.product_id === 'product_regular');
  assert.ok(editedRegular.group_name);
  assert.ok(editedRegular.category_name);

  // Автор заявки и её номер остаются прежними: плюс сотрудника считается по
  // документу, и правка не должна переносить его на другого человека.
  const editedRow = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(editableDraftId);
  assert.equal(editedRow.created_by, 'inventory-test');
  assert.equal(editedRow.created_at, draftCreatedAt);
  assert.equal(editedRow.transfer_number, editableDraft.data.transfer_number);
  assert.equal(editedRow.updated_by, 'inventory-test');
  assert.ok(editedRow.updated_at, 'время правки записано');

  // Остатки не двигаются до оприходования.
  assert.deepEqual(regularStock(), { stock: 6, warehouse_stock: 4 });

  // Направление берётся из заявки, а не из тела запроса.
  const spoofedDirection = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`, {
    method: 'PUT',
    body: JSON.stringify({
      source_location: 'warehouse',
      destination_location: 'retail',
      items: [{ product_id: 'product_regular', quantity: 1 }],
    }),
  });
  assert.equal(spoofedDirection.response.status, 200);
  assert.equal(spoofedDirection.data.source_location, 'retail');
  assert.equal(spoofedDirection.data.destination_location, 'warehouse');

  // Пустой состав и нехватка остатка отклоняются, черновик остаётся прежним.
  const emptyEdit = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`, {
    method: 'PUT',
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(emptyEdit.response.status, 400);
  assert.equal(emptyEdit.data.error, 'items_required');

  const tooMuchEdit = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`, {
    method: 'PUT',
    body: JSON.stringify({ items: [{ product_id: 'product_regular', quantity: 999 }] }),
  });
  assert.equal(tooMuchEdit.response.status, 400);
  assert.ok(String(tooMuchEdit.data.error).startsWith('insufficient_stock:'));
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM stock_transfer_items WHERE transfer_id = ?').get(editableDraftId).count,
    1,
    'после отказа состав остаётся тем, что был',
  );

  const missingEdit = await requestJson('/api/admin/inventory/transfers/move_missing', {
    method: 'PUT',
    body: JSON.stringify({ items: [{ product_id: 'product_regular', quantity: 1 }] }),
  });
  assert.equal(missingEdit.response.status, 404);

  // Свежий черновик ещё не правили, поэтому клиент присылает null против NULL
  // в базе. Это самый частый путь, и он должен проходить.
  const untouchedDraft = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'retail',
      destination_location: 'warehouse',
      items: [{ product_id: 'product_regular', quantity: 1 }],
    }),
  });
  assert.equal(
    db.prepare('SELECT updated_at FROM stock_transfers WHERE id = ?').get(untouchedDraft.data.id).updated_at,
    null,
  );
  const firstEdit = await requestJson(`/api/admin/inventory/transfers/${untouchedDraft.data.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      expected_updated_at: null,
      items: [{ product_id: 'product_regular', quantity: 2 }],
    }),
  });
  assert.equal(firstEdit.response.status, 200);
  await requestJson(`/api/admin/inventory/transfers/${untouchedDraft.data.id}/cancel`, { method: 'POST' });

  // Правка поверх чужой правки не проходит: состав заменяется целиком, и
  // молча затирать чужие изменения нельзя.
  const staleEdit = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`, {
    method: 'PUT',
    body: JSON.stringify({
      expected_updated_at: '2020-01-01 00:00:00',
      items: [{ product_id: 'product_regular', quantity: 1 }],
    }),
  });
  assert.equal(staleEdit.response.status, 409);
  assert.equal(staleEdit.data.error, 'stale_transfer');

  const freshUpdatedAt = db
    .prepare('SELECT updated_at FROM stock_transfers WHERE id = ?')
    .get(editableDraftId).updated_at;
  const freshEdit = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`, {
    method: 'PUT',
    body: JSON.stringify({
      expected_updated_at: freshUpdatedAt,
      items: [{ product_id: 'product_regular', quantity: 1 }],
    }),
  });
  assert.equal(freshEdit.response.status, 200);

  // Отменённую заявку править тоже нельзя.
  const cancelledDraft = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'retail',
      destination_location: 'warehouse',
      items: [{ product_id: 'product_regular', quantity: 1 }],
    }),
  });
  await requestJson(`/api/admin/inventory/transfers/${cancelledDraft.data.id}/cancel`, { method: 'POST' });
  const editCancelled = await requestJson(`/api/admin/inventory/transfers/${cancelledDraft.data.id}`, {
    method: 'PUT',
    body: JSON.stringify({ items: [{ product_id: 'product_regular', quantity: 1 }] }),
  });
  assert.equal(editCancelled.response.status, 409);
  assert.equal(editCancelled.data.error, 'invalid_status');

  // Карточка отдаёт текущий остаток: форме правки он нужен, чтобы ограничить ввод.
  const draftWithStock = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`);
  const stockItem = draftWithStock.data.items.find((item) => item.product_id === 'product_regular');
  assert.equal(Number(stockItem.retail_stock), 6);
  assert.equal(Number(stockItem.warehouse_stock), 4);

  // У позиции с вариантом остаток берётся у варианта, а не у товара-родителя:
  // иначе форма правки предложила бы количество, которого нет.
  const variantDraft = await requestJson('/api/admin/inventory/transfers', {
    method: 'POST',
    body: JSON.stringify({
      source_location: 'retail',
      destination_location: 'warehouse',
      items: [{ product_id: 'product_variant', variant_id: 'variant_black', quantity: 1 }],
    }),
  });
  const variantStockRow = db
    .prepare('SELECT stock, warehouse_stock FROM product_variants WHERE id = ?')
    .get('variant_black');
  const parentStockRow = db
    .prepare('SELECT stock, warehouse_stock FROM products WHERE id = ?')
    .get('product_variant');
  const variantItem = variantDraft.data.items.find((item) => item.variant_id === 'variant_black');
  assert.equal(Number(variantItem.retail_stock), Number(variantStockRow.stock));
  assert.equal(Number(variantItem.warehouse_stock), Number(variantStockRow.warehouse_stock));
  assert.notEqual(Number(parentStockRow.warehouse_stock), Number(variantStockRow.warehouse_stock));
  await requestJson(`/api/admin/inventory/transfers/${variantDraft.data.id}/cancel`, { method: 'POST' });

  // Проведённую заявку править нельзя.
  const completeEdited = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}/complete`, {
    method: 'POST',
  });
  assert.equal(completeEdited.response.status, 200);
  const editCompleted = await requestJson(`/api/admin/inventory/transfers/${editableDraftId}`, {
    method: 'PUT',
    body: JSON.stringify({ items: [{ product_id: 'product_regular', quantity: 1 }] }),
  });
  assert.equal(editCompleted.response.status, 409);
  assert.equal(editCompleted.data.error, 'invalid_status');

  // Фильтр по линейке в поиске товаров заявки.
  console.log('inventory: линейки для быстрого фильтра и поиск по линейке');
  const inventoryGroups = await requestJson('/api/admin/inventory/groups?location=retail');
  assert.equal(inventoryGroups.response.status, 200);
  assert.ok(Array.isArray(inventoryGroups.data));
  assert.ok(
    inventoryGroups.data.every((group) => group.id && group.name),
    'линейки приходят с идентификатором и названием',
  );
  // Список зависит от точки: линейка без остатка в рознице туда не попадает.
  const retailOnlyGroups = inventoryGroups.data.map((group) => group.id);
  db.prepare('UPDATE products SET stock = 0 WHERE id = ?').run('product_regular');
  const groupsAfterZero = await requestJson('/api/admin/inventory/groups?location=retail');
  assert.ok(
    groupsAfterZero.data.length <= retailOnlyGroups.length,
    'без остатка линеек становится не больше',
  );
  db.prepare('UPDATE products SET stock = 6 WHERE id = ?').run('product_regular');

  const itemsByGroup = await requestJson(`/api/admin/inventory/items?location=warehouse&group_id=${regularDisplay.group_id}`);
  assert.equal(itemsByGroup.response.status, 200);
  assert.ok(itemsByGroup.data.length > 0, 'по линейке что-то находится');
  assert.ok(
    itemsByGroup.data.every((item) => item.groupId === regularDisplay.group_id),
    'в выдаче только выбранная линейка',
  );
  const itemsWithoutGroup = await requestJson('/api/admin/inventory/items?location=warehouse');
  assert.ok(
    itemsWithoutGroup.data.length >= itemsByGroup.data.length,
    'без фильтра выдача не сужается',
  );

  console.log('inventory-locations tests passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
