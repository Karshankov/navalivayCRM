#!/usr/bin/env node
/**
 * Одноразовая утилита для установки желаемой "замороженной" позиции линейки.
 *
 * Зачем нужно: на момент включения новой логики парковки группа cg_j393pu
 * "ANNIMA LOVE" уже находится на [order]=70. Bootstrap миграции сохранит
 * parked_order=70, и при возврате товара линейка всё равно вернётся на 70.
 * Эта утилита позволяет вручную задать желаемую замороженную позицию
 * (например, 2 или 11, рядом с PODONKI).
 *
 * Использование:
 *   node server/scripts/set-group-parked-order.js --group-id cg_j393pu --order 11
 *
 * Поведение:
 *   - если группа пустая → просто записываем parked_order = <order>. Когда
 *     товар вернётся в наличие, syncGroupParking сам вставит её на эту позицию
 *     со сдвигом соседей.
 *   - если группа уже непустая → сначала ставим parked_order, затем сразу
 *     вызываем syncGroupParking — он выполнит restore.
 */

import { db } from '../db.js';
import { syncGroupParking, computeGroupOwnStock } from '../utils/group-parking.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--group-id') args.groupId = argv[++i];
    else if (a === '--order') args.order = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function main() {
  const { groupId, order, dryRun } = parseArgs();
  if (!groupId || !Number.isFinite(order)) {
    console.error('Usage: node set-group-parked-order.js --group-id <id> --order <int> [--dry-run]');
    process.exit(1);
  }

  const group = db.prepare(`
    SELECT id, categoryId, slug, name, [order] AS currentOrder, parked_order AS parkedOrder
    FROM category_groups WHERE id = ?
  `).get(String(groupId));

  if (!group) {
    console.error(`Group ${groupId} not found`);
    process.exit(1);
  }

  const ownStock = computeGroupOwnStock(groupId);
  console.log(`Group: ${group.name} (${group.slug})`);
  console.log(`  categoryId   = ${group.categoryId}`);
  console.log(`  currentOrder = ${group.currentOrder}`);
  console.log(`  parkedOrder  = ${group.parkedOrder}`);
  console.log(`  ownStock     = ${ownStock}`);
  console.log(`  target order = ${order}`);

  if (dryRun) {
    console.log('[dry-run] No changes written.');
    return;
  }

  // Записываем желаемую parked_order
  db.prepare('UPDATE category_groups SET parked_order = ?, updatedAt = DATETIME(\'now\') WHERE id = ?')
    .run(order, String(groupId));
  console.log(`✓ parked_order set to ${order}`);

  // Если уже непустая — сразу выполняем restore
  if (ownStock > 0) {
    const result = syncGroupParking(String(groupId));
    console.log(`✓ syncGroupParking result:`, result);
  } else {
    console.log('Group is still empty — restore will happen automatically when stock > 0.');
  }

  const after = db.prepare(`
    SELECT [order] AS currentOrder, parked_order AS parkedOrder FROM category_groups WHERE id = ?
  `).get(String(groupId));
  console.log(`Final state: order=${after.currentOrder}, parked_order=${after.parkedOrder}`);
}

main();
