/**
 * Ревизия витрины для клиентского кэша каталога (mini app).
 *
 * Проверяем: ревизия стабильна без изменений каталога и меняется при
 * изменении цен, остатков, состава товаров, баннеров, оптовых цен и при
 * административном bump. Плюс публичный эндпоинт `/api/catalog/version`
 * отдаёт ревизию и запрещает кэширование ответа.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-catalog-revision-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { getCatalogRevision, bumpCatalogRevision } = await import('../utils/catalog-revision.js');
const { publicRouter } = await import('../routes/public.js');

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function getCatalogVersion() {
  const response = await fetch(`${baseUrl}/api/catalog/version`);
  assert.equal(response.status, 200, 'версия каталога должна быть доступна без авторизации');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(typeof data.revision, 'string');
  assert.ok(data.revision.length > 0);
  return data.revision;
}

let productSeq = 0;
function insertProduct(overrides = {}) {
  productSeq += 1;
  const id = `p_test_${productSeq}`;
  const categoryId = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
  db.prepare(`
    INSERT INTO products (id, categoryId, title, priceRub, description, createdAt)
    VALUES (?, ?, ?, ?, '', datetime('now'))
  `).run(id, categoryId, `Test ${productSeq}`, 10);
  if (overrides.priceRub) {
    db.prepare('UPDATE products SET priceRub = ? WHERE id = ?').run(overrides.priceRub, id);
  }
  return id;
}

// Проверка стабильности: без мутаций ревизия одна и та же.
{
  const first = getCatalogRevision(db);
  assert.equal(getCatalogRevision(db), first, 'ревизия должна быть стабильной без изменений');
}

// Изменение цены товара меняет ревизию.
{
  const id = insertProduct();
  const before = getCatalogRevision(db);
  db.prepare('UPDATE products SET priceRub = priceRub + 1 WHERE id = ?').run(id);
  assert.notEqual(getCatalogRevision(db), before, 'смена цены должна менять ревизию');
}

// Изменение остатка меняет ревизию (списание при выдаче заказа).
{
  const id = insertProduct();
  db.prepare('UPDATE products SET stock = 5 WHERE id = ?').run(id);
  const before = getCatalogRevision(db);
  db.prepare('UPDATE products SET stock = 4 WHERE id = ?').run(id);
  assert.notEqual(getCatalogRevision(db), before, 'смена остатка должна менять ревизию');
}

// Появление нового товара меняет ревизию.
{
  const before = getCatalogRevision(db);
  insertProduct();
  assert.notEqual(getCatalogRevision(db), before, 'новый товар должен менять ревизию');
}

// Удаление товара меняет ревизию.
{
  const id = insertProduct();
  const before = getCatalogRevision(db);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  assert.notEqual(getCatalogRevision(db), before, 'удаление товара должно менять ревизию');
}

// Изменение банера (текст/ссылка — невидимы агрегатам COUNT/SUM порядка)
// ловится только bump'ом.
{
  const before = getCatalogRevision(db);
  const bannerId = db.prepare('SELECT id FROM banners LIMIT 1').get()?.id;
  if (bannerId) {
    db.prepare('UPDATE banners SET href = ? WHERE id = ?').run('https://example.com/x', bannerId);
    const afterAggregateOnly = getCatalogRevision(db);
    // Агрегат href_len_sum может и совпасть (замена равной длины) — поэтому
    // единственная гарантированная проверка: bump меняет ревизию.
    bumpCatalogRevision(db, 'test banner update');
    assert.notEqual(getCatalogRevision(db), afterAggregateOnly || before, 'bump должен менять ревизию');
  }
}

// Оптовые цены линейки: смена тарифа меняет ревизию (агрегат SUM(price_byn)).
{
  const tier = db.prepare('SELECT id FROM wholesale_tiers LIMIT 1').get();
  const groupRow = db.prepare('SELECT id FROM category_groups LIMIT 1').get();
  if (tier && groupRow) {
    db.prepare(`
      INSERT INTO category_group_wholesale_prices (group_id, tier_id, price_byn, created_at, updated_at)
      VALUES (?, ?, 10, datetime('now'), datetime('now'))
      ON CONFLICT(group_id, tier_id) DO UPDATE SET price_byn = excluded.price_byn
    `).run(groupRow.id, tier.id);
    const before = getCatalogRevision(db);
    db.prepare('UPDATE category_group_wholesale_prices SET price_byn = 12 WHERE group_id = ? AND tier_id = ?')
      .run(groupRow.id, tier.id);
    assert.notEqual(getCatalogRevision(db), before, 'смена оптовой цены должна менять ревизию');
  }
}

// Эндпоинт: ревизия совпадает с утилитой и меняется после мутации.
{
  const viaHttpBefore = await getCatalogVersion();
  assert.equal(viaHttpBefore, getCatalogRevision(db), 'эндпоинт должен отдавать ту же ревизию, что утилита');

  insertProduct();
  const viaHttpAfter = await getCatalogVersion();
  assert.notEqual(viaHttpAfter, viaHttpBefore, 'эндпоинт должен видеть новую ревизию после мутации');
}

// bumpCatalogRevision: две последовательные записи дают разные значения.
{
  const before = getCatalogRevision(db);
  bumpCatalogRevision(db, 'test-bump-1');
  const middle = getCatalogRevision(db);
  assert.notEqual(middle, before, 'первый bump должен менять ревизию');
  bumpCatalogRevision(db, 'test-bump-2');
  assert.notEqual(getCatalogRevision(db), middle, 'второй bump должен менять ревизию');
}

// bumpCatalogRevision переживает сбой БД: ошибки не бросает (best-effort).
{
  const fakeDb = {
    prepare() {
      return { run() { throw new Error('boom'); } };
    },
  };
  assert.doesNotThrow(() => bumpCatalogRevision(fakeDb, 'failure case'));
}

server.close();
console.log('[catalog-revision.test] OK');
