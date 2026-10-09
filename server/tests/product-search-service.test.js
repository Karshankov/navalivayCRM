import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-product-search-service-"));
const tempDbPath = path.join(tempDir, "test.db");
const tempUploadsDir = path.join(tempDir, "uploads");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";
process.env.UPLOADS_DIR = tempUploadsDir;

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const { initDb, db } = await import("../db.js");
const {
  searchProductsForAdmin,
  searchProductsForCrm,
  syncProductSearchIndex,
} = await import("../services/product-search-service.js");

initDb();

db.exec(`
  DELETE FROM product_images;
  DELETE FROM product_links;
  DELETE FROM product_variants;
  DELETE FROM products;
  DELETE FROM category_groups;
  DELETE FROM categories;
`);

function seedBaseCatalog() {
  const productUploadDir = path.join(tempUploadsDir, "products", "prod_file");
  fs.mkdirSync(productUploadDir, { recursive: true });
  fs.writeFileSync(
    path.join(productUploadDir, "tiny.png"),
    Buffer.from(tinyPng.split(",")[1], "base64"),
  );

  db.prepare(`
    INSERT INTO categories (id, slug, name, [order], hide_empty, display_mode)
    VALUES
      ('cat_hookah', 'kalyanka', 'Кальянка', 1, 0, 'default'),
      ('cat_other', 'other', 'Другая', 2, 0, 'default')
  `).run();

  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, cover_image)
    VALUES
      ('group_catswill', 'cat_hookah', 'catswill', 'CATSWILL', 1, 0, ?),
      ('group_lit', 'cat_hookah', 'lit-energy', 'Lit Energy', 2, 0, NULL)
  `).run(tinyPng);

  db.prepare(`
    INSERT INTO products (
      id, categoryId, groupId, title, priceRub, description, stock, cost_price, min_stock, has_variants, createdAt
    )
    VALUES
      ('prod_green', 'cat_hookah', 'group_catswill', 'Зеленое яблоко', 10, '', 4, 1, 0, 0, DATETIME('now')),
      ('prod_peach', 'cat_hookah', NULL, 'Персик нектарин', 10, '', 0, 1, 0, 0, DATETIME('now')),
      ('prod_lit', 'cat_hookah', 'group_lit', 'Манго лед', 10, '', 1, 1, 0, 0, DATETIME('now')),
      ('prod_file', 'cat_hookah', NULL, 'Файловая картинка', 10, '', 1, 1, 0, 0, DATETIME('now')),
      ('prod_variant', 'cat_hookah', 'group_catswill', 'Сменный картридж', 10, '', 1, 1, 0, 1, DATETIME('now')),
      ('prod_other_peach', 'cat_other', NULL, 'Персик чужой', 10, '', 1, 1, 0, 0, DATETIME('now'))
  `).run();

  db.prepare(`
    INSERT INTO product_images (productId, url, position)
    VALUES ('prod_file', '/uploads/products/prod_file/tiny.png', 0)
  `).run();

  db.prepare(`
    INSERT INTO product_variants (id, product_id, name, color_code, color_display_mode, price_rub, stock, position)
    VALUES ('var_mint', 'prod_variant', 'Мята', '#00aa00', 'color', 12, 3, 0)
  `).run();
}

try {
  seedBaseCatalog();
  syncProductSearchIndex();

  const firstPage = await searchProductsForCrm({ limit: 2, offset: 0 });
  const secondPage = await searchProductsForCrm({ limit: 2, offset: 2 });
  assert.equal(firstPage.length, 2);
  assert.equal(secondPage.length, 2);
  assert.equal(
    firstPage.some((product) => secondPage.some((nextProduct) => nextProduct.id === product.id)),
    false,
  );

  const firstPeach = await searchProductsForCrm({ search: "персик", limit: 1, offset: 0 });
  const secondPeach = await searchProductsForCrm({ search: "персик", limit: 1, offset: 1 });
  assert.equal(firstPeach.length, 1);
  assert.equal(secondPeach.length, 1);
  assert.notEqual(firstPeach[0].id, secondPeach[0].id);

  const broad = await searchProductsForCrm({ search: "catswil zene", limit: 10 });
  assert.ok(broad.some((product) => product.id === "prod_green"));
  assert.ok(broad.some((product) => String(product.image || "").startsWith("/uploads/thumbnails/search/")));
  assert.ok(!JSON.stringify(broad).includes("data:image"));

  const cachedBefore = db.prepare("SELECT COUNT(*) AS count FROM image_thumbnail_cache").get().count;
  await searchProductsForCrm({ search: "catswil zene", limit: 10 });
  const cachedAfter = db.prepare("SELECT COUNT(*) AS count FROM image_thumbnail_cache").get().count;
  assert.equal(cachedAfter, cachedBefore);

  const cyrillic = searchProductsForAdmin({
    search: "персик",
    categoryId: "cat_hookah",
    limit: 10,
  });
  assert.deepEqual(cyrillic.products.map((product) => product.id), ["prod_peach"]);

  const group = searchProductsForAdmin({ search: "  Lit   Energy ", limit: 10 });
  assert.deepEqual(group.products.map((product) => product.id), ["prod_lit"]);

  const variants = await searchProductsForCrm({ search: "мята", limit: 10 });
  assert.equal(variants[0].id, "var_mint");
  assert.equal(variants[0].is_variant, true);

  const fileImage = await searchProductsForCrm({ search: "файловая", limit: 10 });
  assert.equal(fileImage[0].id, "prod_file");
  assert.ok(fileImage[0].image.startsWith("/uploads/thumbnails/search/"));
  assert.ok(fs.existsSync(path.join(tempUploadsDir, fileImage[0].image.replace("/uploads/", ""))));

  db.prepare("UPDATE category_groups SET cover_image = ? WHERE id = 'group_catswill'")
    .run("data:image/png;base64,not-a-valid-image");
  db.prepare("DELETE FROM image_thumbnail_cache").run();
  const brokenImageResults = await searchProductsForCrm({ search: "catswil zene", limit: 10 });
  assert.ok(brokenImageResults.some((product) => product.id === "prod_green"));
  assert.ok(!JSON.stringify(brokenImageResults).includes("not-a-valid-image"));

  db.prepare("UPDATE products SET groupId = NULL WHERE groupId = 'group_lit'").run();
  db.prepare("DELETE FROM category_groups WHERE id = 'group_lit'").run();
  syncProductSearchIndex();

  const staleGroup = searchProductsForAdmin({ search: "Lit Energy", limit: 10 });
  assert.equal(staleGroup.pagination.total, 0);

  const stillByTitle = searchProductsForAdmin({ search: "манго", limit: 10 });
  assert.deepEqual(stillByTitle.products.map((product) => product.id), ["prod_lit"]);

  console.log("product-search-service tests passed");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
