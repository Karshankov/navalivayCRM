/**
 * Product reviews — rate limit smoke test.
 * Run: node server/tests/product-reviews-ratelimit.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-product-reviews-ratelimit-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = 'test-bot-token';
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const { publicRouter } = await import('../routes/public.js');

initDb();

const app = express();
app.use(express.json());
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

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

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-test-telegram-auth': JSON.stringify({ id: '111', username: 'buyer1', first_name: 'Buyer' }),
  };
}

db.prepare(
  `INSERT INTO customers (id, telegram_id, telegram_username, first_name, created_at, updated_at)
   VALUES ('cust1', '111', 'buyer1', 'Buyer', DATETIME('now'), DATETIME('now'))`,
).run();

console.log('\n=== product-reviews rate limit ===\n');

console.log('--- RL1: mutation limiter returns 429 ---');
{
  let saw429 = false;
  for (let i = 0; i < 45; i += 1) {
    const response = await fetch(`${baseUrl}/api/profile/review-preferences`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ reviews_opt_out: i % 2 === 0 }),
    });
    if (response.status === 429) {
      saw429 = true;
      break;
    }
  }
  ok(saw429, 'PATCH preferences eventually 429');
}

server.close();
console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);