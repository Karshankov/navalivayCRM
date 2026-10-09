/**
 * Удаляет все отзывы и связанные записи розыгрыша.
 * Не трогает review_quick_tags и review_settings.
 *
 * Usage:
 *   node server/scripts/cleanup-all-product-reviews.js --dry-run
 *   node server/scripts/cleanup-all-product-reviews.js
 */
import { initDb, db } from '../db.js';

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function count(table) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return Number(row?.n || 0);
}

initDb();

const dryRun = hasFlag('dry-run');
const before = {
  product_reviews: count('product_reviews'),
  review_monthly_draw_winners: count('review_monthly_draw_winners'),
  review_monthly_draws: count('review_monthly_draws'),
};

console.log('[cleanup-all-product-reviews] Текущее состояние:');
console.log(JSON.stringify(before, null, 2));

if (before.product_reviews === 0 && before.review_monthly_draw_winners === 0 && before.review_monthly_draws === 0) {
  console.log('Нечего удалять.');
  process.exit(0);
}

if (dryRun) {
  console.log('\n[dry-run] Изменения не применены.');
  process.exit(0);
}

const result = db.transaction(() => {
  const winners = db.prepare('DELETE FROM review_monthly_draw_winners').run().changes;
  const draws = db.prepare('DELETE FROM review_monthly_draws').run().changes;
  const reviews = db.prepare('DELETE FROM product_reviews').run().changes;
  return { winners, draws, reviews };
})();

console.log('');
console.log('[cleanup-all-product-reviews] Удалено:');
console.log(`  product_reviews: ${result.reviews}`);
console.log(`  review_monthly_draw_winners: ${result.winners}`);
console.log(`  review_monthly_draws: ${result.draws}`);
console.log(`  осталось product_reviews: ${count('product_reviews')}`);