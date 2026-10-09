import { initDb, db } from '../db.js';
import {
  findOwnedOrders,
  getCustomerOrderHistoryLaunchIso,
  findCustomerByTelegram,
} from '../utils/product-reviews.js';

const usernames = process.argv.slice(2).map((u) => u.replace(/^@+/, ''));
if (!usernames.length) {
  console.error('Usage: node diag-customer-history.mjs QuaiLLLL pavel_username');
  process.exit(1);
}

initDb();

console.log('launch_iso:', getCustomerOrderHistoryLaunchIso());

for (const raw of usernames) {
  const customer = db
    .prepare(
      `SELECT * FROM customers
       WHERE LOWER(COALESCE(telegram_username, '')) = LOWER(?)
       LIMIT 1`,
    )
    .get(raw);

  console.log(`\n=== ${raw} ===`);
  if (!customer) {
    console.log('NO_CUSTOMER_ROW');
    continue;
  }

  console.log({
    id: customer.id,
    telegram_id: customer.telegram_id,
    telegram_username: customer.telegram_username,
  });

  const dbOrders = db
    .prepare(
      `SELECT order_number, status, archived, completed_at, created_at
       FROM orders
       WHERE customer_id = ?
         AND status IN ('delivered', 'completed', 'cancelled')
       ORDER BY COALESCE(completed_at, created_at) DESC
       LIMIT 15`,
    )
    .all(customer.id);

  console.log('DB_ORDERS', JSON.stringify(dbOrders, null, 2));

  const owned = findOwnedOrders({
    telegramId: String(customer.telegram_id || ''),
    telegramUsername: customer.telegram_username || '',
    statuses: ['delivered', 'completed', 'cancelled'],
    limit: 50,
  });

  console.log(
    'OWNED_VISIBLE',
    owned.map((o) => ({
      order_number: o.order_number,
      archived: o.archived,
      completed_at: o.completed_at,
    })),
  );

  const byTelegramLookup = findCustomerByTelegram({
    telegramId: String(customer.telegram_id || ''),
    telegramUsername: customer.telegram_username || '',
  });
  console.log('findCustomerByTelegram:', byTelegramLookup ? 'OK' : 'MISS');
}