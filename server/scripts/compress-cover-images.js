import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { convertImageToWebP } from '../utils/imageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = process.env.DATABASE_FILE || path.resolve(__dirname, '../data/navalivay.db');

const db = new Database(DB_FILE);

function rowsFor(table) {
  return db
    .prepare(`SELECT id, cover_image AS coverImage FROM ${table} WHERE cover_image IS NOT NULL AND LENGTH(cover_image) > 0`)
    .all();
}

async function main() {
  const tables = ['categories', 'category_groups'];

  let totalBefore = 0;
  let totalAfter = 0;
  let updated = 0;
  let skipped = 0;

  for (const table of tables) {
    const rows = rowsFor(table);
    console.log(`[compress-cover-images] ${table}: ${rows.length} rows with cover_image`);

    const updateStmt = db.prepare(`UPDATE ${table} SET cover_image = ? WHERE id = ?`);

    for (const row of rows) {
      const before = row.coverImage;
      if (typeof before !== 'string') {
        skipped += 1;
        continue;
      }

      const beforeLen = before.length;
      totalBefore += beforeLen;

      const next = await convertImageToWebP(before);
      if (typeof next !== 'string') {
        skipped += 1;
        continue;
      }

      const afterLen = next.length;
      totalAfter += afterLen;

      // Only update when it gets smaller (safe default).
      if (afterLen < beforeLen) {
        updateStmt.run(next, row.id);
        updated += 1;
      } else {
        skipped += 1;
      }
    }
  }

  console.log(`[compress-cover-images] done. updated=${updated} skipped=${skipped}`);
  console.log(`[compress-cover-images] totalBeforeChars=${totalBefore} totalAfterChars=${totalAfter}`);
  const ratio = totalBefore ? ((totalAfter / totalBefore) * 100).toFixed(2) : '0.00';
  console.log(`[compress-cover-images] after/before = ${ratio}%`);
}

main().catch((err) => {
  console.error('[compress-cover-images] failed:', err);
  process.exit(1);
});
