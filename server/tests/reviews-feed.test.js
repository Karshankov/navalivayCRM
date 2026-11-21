/**
 * Тесты общего потока отзывов (getPublicReviewsFeed).
 * Run: node server/tests/reviews-feed.test.js
 *
 * Проверяем то, ради чего функция написана: агрегат считается только
 * по одобренным, средняя оценка округляется до одной цифры, отзывы
 * идут свежими сверху и анонимные не раскрывают личность.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-reviews-feed-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { getPublicReviewsFeed } = await import('../utils/product-reviews.js');

initDb();

const results = { passed: 0, failed: 0 };

function ok(cond, msg) {
  if (cond) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function seed() {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');

  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, reviews_opt_out, created_at, updated_at)
     VALUES ('cust1', '111', 'buyer1', 'Александр', 'Петров', 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, reviews_opt_out, created_at, updated_at)
     VALUES ('cust2', '222', 'buyer2', 'Мария', 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat_liq', 'salt-liquids', 'Жидкости', 1, 0, 'liquids')`,
  ).run();

  // Два товара: 45 и 25 отзывов — как PODONKI PODGON / PODONKI BLOOD.
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_podgon', 'cat_liq', 'podgon', 'PODONKI PODGON', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_blood', 'cat_liq', 'blood', 'PODONKI BLOOD', 2, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  // Товар нужен раньше заказа: order_items ссылается на products.
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat_liq', 'grp_podgon', 'Вишня', 10, '', 5, DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord1', 1001, 'cust1', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi1', 'ord1', 'prod1', 'Вишня', 'PODONKI PODGON', 'Вишня', 1, 10, 10, 4)`,
  ).run();

  const ins = db.prepare(`
    INSERT INTO product_reviews
      (id, customer_id, order_id, order_item_id, group_id, category_id, rating, body_text,
       status, is_anonymous, created_at, approved_at)
    VALUES (?, ?, 'ord1', 'oi1', ?, 'cat_liq', ?, ?, ?, ?, ?, ?)
  `);

  // 3 одобренных: 5, 5, 4 → средняя 4.666… → отбрасывание даёт 4.6
  ins.run('r1', 'cust1', 'grp_podgon', 5, 'Отлично', 'approved', 0, '2026-11-20T10:00:00.000Z', '2026-11-20T10:00:00.000Z');
  ins.run('r2', 'cust2', 'grp_blood', 5, 'Хорошо', 'approved', 1, '2026-11-19T10:00:00.000Z', '2026-11-19T10:00:00.000Z');
  ins.run('r3', 'cust1', 'grp_podgon', 4, 'Нормально', 'approved', 0, '2026-11-18T10:00:00.000Z', '2026-11-18T10:00:00.000Z');
  // Не должны попасть в публичный поток:
  ins.run('r4', 'cust1', 'grp_podgon', 1, 'На модерации', 'pending', 0, '2026-11-21T10:00:00.000Z', null);
  ins.run('r5', 'cust1', 'grp_podgon', 1, 'Отклонён', 'rejected', 0, '2026-11-21T11:00:00.000Z', null);
}

seed();

// --- агрегат ---
const feed = getPublicReviewsFeed({ limit: 20, offset: 0 });
ok(feed.review_count === 3, `считает только одобренные: ожидали 3, получили ${feed.review_count}`);
ok(feed.items.length === 3, `отдаёт все одобренные: ожидали 3, получили ${feed.items.length}`);
ok(feed.average_rating === 4.6, `средняя отброшена до одной цифры: ожидали 4.6, получили ${feed.average_rating}`);

// --- порядок: свежие сверху ---
ok(feed.items[0].id === 'r1', `сверху самый свежий: ожидали r1, получили ${feed.items[0].id}`);
ok(
  feed.items.map((i) => i.id).join(',') === 'r1,r2,r3',
  `порядок по убыванию даты: получили ${feed.items.map((i) => i.id).join(',')}`,
);

// --- товар в отзыве (ради чего список и нужен) ---
ok(feed.items[0].group_name === 'PODONKI PODGON', `товар первого отзыва: ${feed.items[0].group_name}`);
ok(feed.items[1].group_name === 'PODONKI BLOOD', `товар второго отзыва: ${feed.items[1].group_name}`);

// --- анонимность ---
const anon = feed.items.find((i) => i.id === 'r2');
ok(anon.reviewer.is_anonymous === true, 'анонимный отзыв помечен анонимным');
ok(anon.reviewer.display_name === 'Покупатель', `анонимный не раскрывает имя: ${anon.reviewer.display_name}`);
const named = feed.items.find((i) => i.id === 'r1');
ok(named.reviewer.display_name === 'Александр П.', `имя с инициалом фамилии: ${named.reviewer.display_name}`);

// --- пагинация ---
const page1 = getPublicReviewsFeed({ limit: 2, offset: 0 });
const page2 = getPublicReviewsFeed({ limit: 2, offset: 2 });
ok(page1.items.length === 2 && page2.items.length === 1, 'пагинация делит список');
ok(page1.review_count === 3 && page2.review_count === 3, 'счётчик одинаков на обеих страницах');
ok(
  page1.items[0].id !== page2.items[0].id,
  'страницы не пересекаются',
);

// --- пустой поток ---
db.exec("DELETE FROM product_reviews;");
const empty = getPublicReviewsFeed({ limit: 20, offset: 0 });
ok(empty.review_count === 0, 'пустой список: счётчик 0');
ok(empty.average_rating === null, 'пустой список: средней оценки нет, а не 0');
ok(empty.items.length === 0, 'пустой список: элементов нет');

console.log(`\nИтого: ${results.passed} прошло, ${results.failed} упало`);
process.exit(results.failed > 0 ? 1 : 0);
