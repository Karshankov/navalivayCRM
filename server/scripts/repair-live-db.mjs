/**
 * Live-DB repair after interrupted VACUUM + pre-existing FK orphans.
 * Mirrors the Oct-12 recovery procedure (orphan-link-repair.json, reindex-report.json)
 * but applies it to the live database, with a full snapshot first.
 *
 * Steps:
 *  1. Snapshot db/-wal/-shm into financial-close-backups/live-repair-<ts>/
 *  2. Verify snapshot opens and matches live row counts
 *  3. Checkpoint WAL into main file
 *  4. Full integrity_check + foreign_key_check (report)
 *  5. Set orphaned visit_logs.customer_id to NULL (same fix as Oct-12 recovery)
 *  6. REINDEX every index reported broken by integrity_check
 *  7. VACUUM (rebuilds file, removes "Page N: never used" from an interrupted VACUUM)
 *  8. Re-verify: quick_check ok, foreign_key_check empty, integrity_check ok
 *  9. Write repair-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const serverDataDir = '/Users/pavelkarshankov/Documents/CRM-local/app/server/data';
const liveDbPath = path.join(serverDataDir, 'navalivay.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const repairDir = path.join(serverDataDir, 'financial-close-backups', `live-repair-${ts}`);

fs.mkdirSync(repairDir, { recursive: true });

// ---------- 1. Snapshot ----------
for (const suffix of ['', '-wal']) {
  const src = liveDbPath + suffix;
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(repairDir, `snapshot.db${suffix}`));
  }
}
console.log('[1] snapshot done ->', repairDir);

// ---------- 2. Verify snapshot ----------
const keyTables = ['orders', 'order_items', 'customers', 'cash_transactions', 'visit_logs', 'pos_sales', 'userbot_entities'];
// NOT INDEXED: считаем по таблице, а не по индексу. Битый индекс занижает
// COUNT(*) (userbot_entities: 4142 через индекс против 4183 в таблице).
function rowCounts(db) {
  const out = {};
  for (const t of keyTables) out[t] = db.prepare(`SELECT COUNT(*) c FROM ${t} NOT INDEXED`).get().c;
  return out;
}
// Открываем снапшот в read-write: SQLite восстановит WAL в копию и создаст -shm.
// Это безопасно — снапшот уже отдельная копия. fileMustExist страхует от опечатки в пути.
const snap = new Database(path.join(repairDir, 'snapshot.db'), { fileMustExist: true });
snap.pragma('wal_checkpoint(TRUNCATE)');
const livePre = new Database(liveDbPath, { readonly: true });
const snapCounts = rowCounts(snap);
const liveCounts = rowCounts(livePre);
snap.close();
livePre.close();
const countsMatch = JSON.stringify(snapCounts) === JSON.stringify(liveCounts);
console.log('[2] snapshot counts match live:', countsMatch, JSON.stringify(liveCounts));
if (!countsMatch) {
  console.error('Snapshot mismatch — aborting before any write.');
  process.exit(1);
}

// ---------- 3. Checkpoint + diagnose ----------
const db = new Database(liveDbPath);
db.pragma('busy_timeout = 10000');
const cp = db.pragma('wal_checkpoint(TRUNCATE)');
console.log('[3] wal_checkpoint:', JSON.stringify(cp));

const integrityBefore = db.pragma('integrity_check');
const fkBefore = db.pragma('foreign_key_check');
console.log('[3] integrity_check issues before:', integrityBefore.length - 1 > 0 ? integrityBefore.length : 'ok');
const idxBroken = [...new Set(integrityBefore.map(r => String(Object.values(r)[0]).match(/index (\S+)/)?.[1]).filter(Boolean))];
console.log('[3] broken indexes:', JSON.stringify(idxBroken));
console.log('[3] fk violations before:', fkBefore.length, JSON.stringify(fkBefore));

// ---------- 5. Orphan fix ----------
const orphanRows = db.prepare(`
  SELECT v.rowid, v.id, v.customer_id, v.telegram_id, v.telegram_username, v.page_path, v.action, v.visited_at
  FROM visit_logs v
  WHERE v.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = v.customer_id)
`).all();
console.log('[5] orphan visit_logs rows:', orphanRows.length);
if (orphanRows.length > 0) {
  const fix = db.transaction(() => {
    for (const row of orphanRows) {
      db.prepare('UPDATE visit_logs SET customer_id = NULL WHERE rowid = ?').run(row.rowid);
    }
  });
  fix();
  fs.writeFileSync(path.join(repairDir, 'orphan-link-repair.json'), JSON.stringify({
    database: liveDbPath,
    operation: 'set_orphan_customer_id_to_null',
    rows: orphanRows
  }, null, 2));
}
const fkAfterOrphans = db.pragma('foreign_key_check');
console.log('[5] fk violations after orphan fix:', fkAfterOrphans.length);

// ---------- 6. REINDEX broken indexes ----------
for (const idx of idxBroken) {
  console.log('[6] REINDEX', idx);
  db.exec(`REINDEX "${idx}"`);
}

// ---------- 7. VACUUM ----------
console.log('[7] VACUUM started...');
const vacuumStart = Date.now();
db.exec('VACUUM');
console.log('[7] VACUUM done in', ((Date.now() - vacuumStart) / 1000).toFixed(1), 's; new size:', fs.statSync(liveDbPath).size);

// ---------- 8. Verify ----------
const quickAfter = db.pragma('quick_check');
const integrityAfter = db.pragma('integrity_check');
const fkAfter = db.pragma('foreign_key_check');
const liveCountsAfter = rowCounts(db);
const countsUnchanged = JSON.stringify(liveCounts) === JSON.stringify(liveCountsAfter);
console.log('[8] quick_check:', JSON.stringify(quickAfter));
console.log('[8] integrity_check:', JSON.stringify(integrityAfter));
console.log('[8] foreign_key_check rows:', fkAfter.length);
console.log('[8] row counts unchanged:', countsUnchanged, JSON.stringify(liveCountsAfter));

const ok = quickAfter.length === 1 && Object.values(quickAfter[0])[0] === 'ok'
  && integrityAfter.length === 1 && Object.values(integrityAfter[0])[0] === 'ok'
  && fkAfter.length === 0
  && countsUnchanged;

fs.writeFileSync(path.join(repairDir, 'repair-report.json'), JSON.stringify({
  live: liveDbPath,
  snapshot: path.join(repairDir, 'snapshot.db'),
  timestamp: new Date().toISOString(),
  integrityBefore: integrityBefore.slice(0, 200),
  fkViolationsBefore: fkBefore,
  orphanRowsFixed: orphanRows.length,
  reindexed: idxBroken,
  vacuumMs: null,
  integrityAfter,
  quickAfter,
  fkViolationsAfter: fkAfter,
  rowCountsBefore: liveCounts,
  rowCountsAfter: liveCountsAfter,
  success: ok
}, null, 2));

db.close();
console.log(ok ? 'REPAIR SUCCESS' : 'REPAIR FAILED');
process.exit(ok ? 0 : 1);
