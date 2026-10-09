import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-crm-products-search-"));
const tempDbPath = path.join(tempDir, "test.db");
const tempUploadsDir = path.join(tempDir, "uploads");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";
process.env.UPLOADS_DIR = tempUploadsDir;

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const { initDb, db } = await import("../db.js");
const { issueToken } = await import("../auth.js");
const { crmFinanceRouter } = await import("../routes/crm-finance.js");
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
app.use(crmFinanceRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const baseUrl = `http://127.0.0.1:${server.address().port}`;
const authToken = issueToken("test-admin");

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
}

async function requestJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: authHeaders() });
  const data = await response.json();
  assert.equal(response.status, 200);
  return data;
}

db.prepare(`
  INSERT INTO categories (id, slug, name, [order], hide_empty, display_mode)
  VALUES ('cat_liquid', 'zhidkosti', 'Жидкости', 1, 0, 'liquid')
`).run();

db.prepare(`
  INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, cover_image)
  VALUES ('group_catswill', 'cat_liquid', 'catswill', 'CATSWILL', 1, 0, ?)
`).run(tinyPng);

db.prepare(`
  INSERT INTO products (
    id, categoryId, groupId, title, priceRub, description, stock, cost_price, min_stock, has_variants, createdAt
  )
  VALUES
    ('prod_green', 'cat_liquid', 'group_catswill', 'Зеленое яблоко', 10, '', 4, 1, 0, 0, DATETIME('now')),
    ('prod_other', 'cat_liquid', 'group_catswill', 'Клубника лед', 10, '', 2, 1, 0, 0, DATETIME('now'))
`).run();

try {
  syncProductSearchIndex();
  const broad = await requestJson("/api/admin/crm/products/search?search=catswil%20zene&limit=10");
  assert.ok(broad.length > 0);
  assert.ok(broad.some((product) => product.id === "prod_green"));
  assert.ok(broad.some((product) => String(product.image || "").startsWith("/uploads/thumbnails/search/")));
  assert.ok(!JSON.stringify(broad).includes("data:image"));
  assert.ok(Buffer.byteLength(JSON.stringify(broad)) < 150_000);

  const cyrillic = await requestJson("/api/admin/crm/products/search?search=%D0%B7%D0%B5%D0%BB%D0%B5%D0%BD&limit=10");
  assert.equal(cyrillic[0].id, "prod_green");

  console.log("crm-products-search-regression tests passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
