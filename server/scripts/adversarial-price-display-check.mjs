#!/usr/bin/env node
/**
 * Adversarial check: groups with meta_value must still have positive prices in DB.
 * UI fix restores meta+price together; this script proves data exists for broken categories.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_FILE || path.join(__dirname, "../data/navalivay-prod.db");
const db = new Database(dbPath, { readonly: true });

const samples = [
  { name: "PODONKI PODGON", like: "%PODGON%" },
  { name: "ЗЛОЙ LONG", like: "%LONG%" },
  { name: "BEYOND 25000", like: "%BEYOND%25000%" },
  { name: "CHABA", like: "%CHABA%" },
  { name: "ICEBERG HOTACE", like: "%HOTACE%" },
];

let failures = 0;

console.log(`\n=== Adversarial price display check (${dbPath}) ===\n`);

for (const sample of samples) {
  const group = db.prepare(`
    SELECT cg.id, cg.name, cg.meta_value, c.name AS category_name
    FROM category_groups cg
    JOIN categories c ON c.id = cg.categoryId
    WHERE cg.name LIKE ?
    LIMIT 1
  `).get(sample.like);

  if (!group) {
    failures += 1;
    console.log(`FAIL sample not found: ${sample.name}`);
    continue;
  }

  const priceRow = db.prepare(`
    SELECT MIN(COALESCE(NULLIF(pv.price_rub, 0), NULLIF(p.priceRub, 0))) AS min_price,
           COUNT(p.id) AS product_count
    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.groupId = ?
  `).get(group.id);

  const minPrice = priceRow?.min_price ?? 0;
  const ok = minPrice > 0;
  if (!ok) failures += 1;

  console.log(
    `${ok ? "OK" : "FAIL"} ${group.name} [${group.category_name}] meta="${group.meta_value || ""}" minPrice=${minPrice} products=${priceRow?.product_count ?? 0}`,
  );
}

const metaNoPriceUi = db.prepare(`
  SELECT COUNT(*) AS cnt
  FROM category_groups cg
  WHERE TRIM(COALESCE(cg.meta_value, '')) != ''
    AND EXISTS (
      SELECT 1 FROM products p
      WHERE p.groupId = cg.id AND p.priceRub > 0
    )
`).get();

console.log(`\nGroups with meta_value AND priced products: ${metaNoPriceUi.cnt}`);
console.log(`Failures: ${failures}\n`);

if (failures > 0) process.exit(1);