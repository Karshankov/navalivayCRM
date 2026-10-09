/**
 * Полный набор демо-сценариев для ручного теста отзывов + розыгрыша + CRM.
 *
 * Usage:
 *   node server/scripts/seed-dev-reviews-scenarios.js
 *   node server/scripts/seed-dev-reviews-scenarios.js --reset
 *
 * Требует поднятый dev-стек: npm run dev
 */
import { initDb } from '../db.js';
import { migrateProductReviews } from '../migrations/add_product_reviews.js';
import {
  REVIEW_QA_PERSONAS,
  REVIEW_QA_WINNER_PERSONAS,
  runReviewQaSeed,
} from '../utils/review-qa-seed.js';

const FRONTEND_PORT = process.env.VITE_DEV_PORT || '5173';

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function mockUrl(persona) {
  const url = new URL(`http://localhost:${FRONTEND_PORT}/`);
  url.searchParams.set('telegram_id', persona.telegramId);
  if (persona.username) url.searchParams.set('username', persona.username);
  if (persona.firstName) url.searchParams.set('first_name', persona.firstName);
  return url.toString();
}

initDb();
migrateProductReviews();

const reset = hasFlag('reset') || !hasFlag('no-reset');
const result = runReviewQaSeed({ reset });

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  DEV: все ключевые сценарии отзывов засеяны');
console.log('══════════════════════════════════════════════════════════════');
console.log('');
console.log(`Период розыгрыша: ${result.periodKey}`);
console.log(`Линейка с публичными отзывами: ${result.ratingGroup.group_name}`);
console.log('');
console.log('── Клиент (telegram mock) ──────────────────────────────────');
console.log('');
console.log('A. Новый отзыв + dock');
console.log(`   ${mockUrl(REVIEW_QA_PERSONAS.fresh)}`);
console.log(`   → Dock на главной, заказ #${result.freshOrder.orderNumber}, 4 линейки`);
console.log('');
console.log('B. Отзыв на модерации (вторая линейка ещё доступна)');
console.log(`   ${mockUrl(REVIEW_QA_PERSONAS.pending)}`);
console.log(`   → Заказ #${result.pendingOrder.orderNumber}: «Отзыв на модерации» + форма`);
console.log('');
console.log('C. Кулдаун на 1-й линейке, 2-я открыта');
console.log(`   ${mockUrl(REVIEW_QA_PERSONAS.cooldown)}`);
console.log(`   → Заказ #${result.cooldownNewOrder.orderNumber}`);
console.log('');
console.log('D. Opt-out (dock скрыт)');
console.log(`   ${mockUrl(REVIEW_QA_PERSONAS.optout)}`);
console.log('   → Профиль → отключить отзывы уже включено');
console.log('');
console.log('E. Публичные ★ в каталоге + модалка отзывов');
console.log(`   http://localhost:${FRONTEND_PORT}/`);
console.log(`   → Найди «${result.ratingGroup.group_name}», клик ★ 4.x (12)`);
console.log('   → В модалке виден ответ менеджера на первом отзыве');
console.log('');
console.log('── CRM (admin / 998811) ────────────────────────────────────');
console.log('');
console.log(`   http://localhost:${FRONTEND_PORT}/admin/crm/orders`);
console.log('   → Плашка «Определены победители розыгрыша» (если не скрывали)');
console.log('   → Ещё → Отзывы: badge на модерацию (4 pending)');
console.log('');
console.log(`   http://localhost:${FRONTEND_PORT}/admin/crm/reviews`);
console.log('   → Модерация pending, быстрые теги, розыгрыш 5 мест:');
REVIEW_QA_WINNER_PERSONAS.forEach((winner, index) => {
  console.log(`      ${index + 1}. @${winner.username}`);
});
console.log('');
console.log('── Whitelist для CRM (Настройки → тестировщики) ───────────');
console.log('');
console.log(`   ${result.suggestedWhitelistUsernames.join(', ')}`);
console.log('');
console.log('── Если плашка розыгрыша не появилась ─────────────────────');
console.log('');
console.log('   В консоли браузера на странице CRM:');
console.log('   localStorage.removeItem("crm_ack_draw_id"); location.reload()');
console.log('');
console.log('── Сброс и повторный прогон ────────────────────────────────');
console.log('');
console.log('   node server/scripts/seed-dev-reviews-scenarios.js --reset');
console.log('');