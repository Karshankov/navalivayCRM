import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-admin-search-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";

const { initDb, db } = await import("../db.js");
const { issueToken } = await import("../auth.js");
const { adminRouter } = await import("../routes/admin.js");
const { syncProductSearchIndex } = await import("../services/product-search-service.js");

initDb();

db.exec(`
  DELETE FROM product_images;
  DELETE FROM product_links;
  DELETE FROM product_variants;
  DELETE FROM products;
  DELETE FROM category_groups;
  DELETE FROM categories;
`);

const app = express();
app.use(express.json());
app.use(adminRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken("test-admin");

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
}

async function requestJson(url) {
  const response = await fetch(`${baseUrl}${url}`, {
    headers: authHeaders(),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  return data;
}

function insertCategory({ id, slug, name }) {
  db.prepare(`
    INSERT INTO categories (id, slug, name, [order], hide_empty, display_mode)
    VALUES (?, ?, ?, 1, 0, 'default')
  `).run(id, slug, name);
}

function insertGroup({ id, categoryId, slug, name }) {
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty)
    VALUES (?, ?, ?, ?, 1, 0)
  `).run(id, categoryId, slug, name);
}

function insertProduct({
  id,
  categoryId,
  groupId = null,
  title,
  description = "",
  stock = 0,
}) {
  db.prepare(`
    INSERT INTO products (
      id, categoryId, groupId, title, priceRub, description, stock, cost_price, min_stock, createdAt
    )
    VALUES (?, ?, ?, ?, 10, ?, ?, 1, 0, DATETIME('now'))
  `).run(id, categoryId, groupId, title, description, stock);
}

async function testCyrillicSearchFindsUngroupedProducts() {
  insertCategory({ id: "cat_hookah", slug: "kalyanka", name: "Кальянка" });
  insertProduct({
    id: "prod_peach",
    categoryId: "cat_hookah",
    title: "Персик нектарин",
    stock: 0,
  });
  insertProduct({
    id: "prod_berry",
    categoryId: "cat_hookah",
    title: "Ягоды кокос",
    stock: 2,
  });

  syncProductSearchIndex();
  const data = await requestJson("/api/admin/products?search=%D0%BF%D0%B5%D1%80%D1%81%D0%B8%D0%BA&category=cat_hookah&limit=20");

  assert.equal(data.pagination.total, 1);
  assert.equal(data.products[0].id, "prod_peach");
  assert.equal(data.products[0].groupId, null);
}

async function testMultiWordSearchIsWhitespaceTolerant() {
  insertCategory({ id: "cat_energy", slug: "energetiki", name: "Энергетики" });
  insertGroup({
    id: "group_lit",
    categoryId: "cat_energy",
    slug: "lit-energy",
    name: "Lit Energy",
  });
  insertProduct({
    id: "prod_lit_peach",
    categoryId: "cat_energy",
    groupId: "group_lit",
    title: "Персик",
    stock: 1,
  });

  syncProductSearchIndex();
  const data = await requestJson("/api/admin/products?search=%20%20Lit%20%20%20Energy%20%20&limit=20");

  assert.equal(data.pagination.total, 1);
  assert.equal(data.products[0].id, "prod_lit_peach");
}

async function testSearchDoesNotLeakAcrossCategoryFilter() {
  insertCategory({ id: "cat_other", slug: "other", name: "Другая категория" });
  insertProduct({
    id: "prod_other_peach",
    categoryId: "cat_other",
    title: "Персик чужой",
    stock: 1,
  });

  syncProductSearchIndex();
  const data = await requestJson("/api/admin/products?search=%D0%BF%D0%B5%D1%80%D1%81%D0%B8%D0%BA&category=cat_hookah&limit=20");

  assert.deepEqual(
    data.products.map((product) => product.id),
    ["prod_peach"],
  );
}

try {
  await testCyrillicSearchFindsUngroupedProducts();
  await testMultiWordSearchIsWhitespaceTolerant();
  await testSearchDoesNotLeakAcrossCategoryFilter();
  console.log("admin-products-search-regression tests passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
