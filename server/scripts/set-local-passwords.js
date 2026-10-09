import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PASSWORD = '998811';
const PROFIT_PASSWORD = '5599';

const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const profitHash = bcrypt.hashSync(PROFIT_PASSWORD, 10);

const adminPath = path.resolve(__dirname, '../data/admin.json');
fs.mkdirSync(path.dirname(adminPath), { recursive: true });
fs.writeFileSync(
  adminPath,
  JSON.stringify(
    {
      username: 'admin',
      passwordHash: adminHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
  'utf8',
);

const dbPath = path.resolve(__dirname, '../data/navalivay.db');
const db = new Database(dbPath);
db.prepare(
  `INSERT INTO settings (key, value)
   VALUES ('profit_password_hash', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
).run(profitHash);
db.close();

console.log('[set-local-passwords] admin login password set');
console.log('[set-local-passwords] CRM profit password set');