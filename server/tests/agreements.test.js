/**
 * Agreements util — smoke tests.
 *
 * Покрывает:
 *   1. CRUD (create/list/update/delete)
 *   2. Валидация: empty title → throw, body too long → throw
 *   3. is_active=0 — не попадает в listActiveAgreements
 *   4. validateAcceptedAgreementIds: ok когда все приняты, missing когда нет
 *   5. validateAcceptedAgreementIds: ok когда вообще нет активных соглашений
 *   6. buildAcceptedSnapshot: возвращает JSON с принятыми, null если нет
 *   7. updateAgreement: patch-семантика (только переданные поля)
 *
 * Запуск: node server/tests/agreements.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, `./.tmp-agreements-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();
const {
  listActiveAgreements,
  listAllAgreements,
  getAgreementById,
  createAgreement,
  updateAgreement,
  deleteAgreement,
  validateAcceptedAgreementIds,
  buildAcceptedSnapshot,
} = await import('../utils/agreements.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  if (actual === expected) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function setup() {
  db.exec(`DELETE FROM agreements;`);
}

function runTests() {
  console.log('=== Setup ===');
  setup();

  console.log('\n=== Test 1: createAgreement создаёт запись ===');
  const a1 = createAgreement({
    title: 'Согласен с правилами заказа',
    body: 'Текст правил...',
    is_active: 1,
    sort_order: 10,
  });
  assertEq(typeof a1.id === 'number', true, 'createAgreement вернул объект с id');
  assertEq(a1.title, 'Согласен с правилами заказа', 'title сохранён');
  assertEq(a1.is_active, 1, 'is_active=1');
  assertEq(a1.sort_order, 10, 'sort_order=10');

  console.log('\n=== Test 2: listAllAgreements / listActiveAgreements ===');
  createAgreement({ title: 'Активное №2', body: 'b', is_active: 1, sort_order: 20 });
  const inactive = createAgreement({ title: 'Скрытое', body: 'b', is_active: 0, sort_order: 5 });
  const all = listAllAgreements();
  assertEq(all.length, 3, 'listAllAgreements возвращает все 3');
  const active = listActiveAgreements();
  assertEq(active.length, 2, 'listActiveAgreements возвращает только активные');
  assertEq(active.find((a) => a.id === inactive.id), undefined, 'скрытое не попало в active');

  console.log('\n=== Test 3: createAgreement с пустым title → throw ===');
  let threw = false;
  try {
    createAgreement({ title: '   ', body: '' });
  } catch (err) {
    threw = err.code === 'title_required';
  }
  assertEq(threw, true, 'createAgreement({title:""}) бросает title_required');

  console.log('\n=== Test 4: title слишком длинный → throw ===');
  threw = false;
  try {
    createAgreement({ title: 'x'.repeat(201), body: '' });
  } catch (err) {
    threw = err.code === 'title_too_long';
  }
  assertEq(threw, true, 'title>200 → title_too_long');

  console.log('\n=== Test 5: body слишком длинный → throw ===');
  threw = false;
  try {
    createAgreement({ title: 'OK', body: 'x'.repeat(20001) });
  } catch (err) {
    threw = err.code === 'body_too_long';
  }
  assertEq(threw, true, 'body>20000 → body_too_long');

  console.log('\n=== Test 6: updateAgreement — patch-семантика ===');
  const updated = updateAgreement(a1.id, { title: 'Новый заголовок' });
  assertEq(updated.title, 'Новый заголовок', 'title обновлён');
  assertEq(updated.body, 'Текст правил...', 'body не тронут');
  assertEq(updated.is_active, 1, 'is_active не тронут');

  console.log('\n=== Test 7: updateAgreement несуществующего id → throw ===');
  threw = false;
  try {
    updateAgreement(99999, { title: 'X' });
  } catch (err) {
    threw = err.code === 'agreement_not_found';
  }
  assertEq(threw, true, 'updateAgreement(99999) бросает agreement_not_found');

  console.log('\n=== Test 8: deleteAgreement ===');
  const removed = deleteAgreement(inactive.id);
  assertEq(removed, 1, 'deleteAgreement удалил 1 запись');
  assertEq(getAgreementById(inactive.id), null, 'getAgreementById возвращает null после delete');
  assertEq(listAllAgreements().length, 2, 'осталось 2 записи');

  console.log('\n=== Test 9: validateAcceptedAgreementIds — все приняты ===');
  const activeNow = listActiveAgreements();
  const allIds = activeNow.map((a) => a.id);
  const okResult = validateAcceptedAgreementIds(allIds);
  assertEq(okResult.ok, true, 'все id переданы → ok=true');
  assertEq(okResult.missing.length, 0, 'missing пуст');

  console.log('\n=== Test 10: validateAcceptedAgreementIds — часть не принята ===');
  const partialResult = validateAcceptedAgreementIds([allIds[0]]);
  assertEq(partialResult.ok, false, 'часть принята → ok=false');
  assertEq(partialResult.missing.length, 1, 'один в missing');
  assertEq(partialResult.missing[0].id, allIds[1], 'правильный id в missing');

  console.log('\n=== Test 11: validateAcceptedAgreementIds — пустой массив ===');
  const emptyResult = validateAcceptedAgreementIds([]);
  assertEq(emptyResult.ok, false, 'пустой acceptedIds → ok=false (есть активные)');
  assertEq(emptyResult.missing.length, 2, 'оба активных в missing');

  console.log('\n=== Test 12: validateAcceptedAgreementIds — нет активных вообще ===');
  // Делаем все неактивными
  for (const id of allIds) {
    updateAgreement(id, { is_active: 0 });
  }
  const noActiveResult = validateAcceptedAgreementIds([]);
  assertEq(noActiveResult.ok, true, 'нет активных → ok=true (клиенту нечего принимать)');
  assertEq(noActiveResult.missing.length, 0, 'missing пуст');

  console.log('\n=== Test 13: buildAcceptedSnapshot ===');
  // Возвращаем активность
  for (const id of allIds) {
    updateAgreement(id, { is_active: 1 });
  }
  const snapshot = buildAcceptedSnapshot([allIds[0]]);
  assertEq(typeof snapshot, 'string', 'snapshot — строка JSON');
  const parsed = JSON.parse(snapshot);
  assertEq(typeof parsed.accepted_at, 'string', 'accepted_at — ISO-строка');
  assertEq(parsed.items.length, 1, 'items содержит 1 запись');
  assertEq(parsed.items[0].id, allIds[0], 'правильный id');
  assertEq(typeof parsed.items[0].body, 'string', 'body вошёл в snapshot (для аудита)');

  console.log('\n=== Test 14: buildAcceptedSnapshot — пусто когда ничего не принято ===');
  const nullSnap = buildAcceptedSnapshot([]);
  assertEq(nullSnap, null, 'пустой acceptedIds → null');

  console.log('\n=== Test 15: buildAcceptedSnapshot — null когда нет активных ===');
  for (const id of allIds) {
    updateAgreement(id, { is_active: 0 });
  }
  const nullSnap2 = buildAcceptedSnapshot([allIds[0]]);
  assertEq(nullSnap2, null, 'нет активных → snapshot=null даже если что-то "принято"');

  console.log('\n=== Test 16: validateAcceptedAgreementIds игнорирует мусор в массиве ===');
  for (const id of allIds) {
    updateAgreement(id, { is_active: 1 });
  }
  // Передаём массив с null, undefined, строками, отрицательными числами
  const garbage = [null, undefined, 'abc', -1, 0, allIds[0], allIds[1]];
  const garbageResult = validateAcceptedAgreementIds(garbage);
  assertEq(garbageResult.ok, true, 'мусор + валидные id → ok=true (валидные распарсились)');

  console.log('\n=== Test 17: sort_order стабильный ===');
  setup();
  const x10 = createAgreement({ title: 'X10', body: '', is_active: 1, sort_order: 10 });
  const x5 = createAgreement({ title: 'X5', body: '', is_active: 1, sort_order: 5 });
  const x20 = createAgreement({ title: 'X20', body: '', is_active: 1, sort_order: 20 });
  const sorted = listActiveAgreements();
  assertEq(sorted[0].id, x5.id, 'sort_order=5 идёт первым');
  assertEq(sorted[1].id, x10.id, 'sort_order=10 идёт вторым');
  assertEq(sorted[2].id, x20.id, 'sort_order=20 идёт третьим');

  console.log('\n=== Test 18: is_active strict — "0" интерпретируется как 0 ===');
  setup();
  const strictItem = createAgreement({ title: 'Strict', body: '', is_active: '0', sort_order: 1 });
  assertEq(strictItem.is_active, 0, 'is_active="0" → 0 (не truthy)');
  const strictItem2 = createAgreement({ title: 'Strict2', body: '', is_active: '1', sort_order: 2 });
  assertEq(strictItem2.is_active, 1, 'is_active="1" → 1');
  const strictItem3 = createAgreement({ title: 'Strict3', body: '', is_active: false, sort_order: 3 });
  assertEq(strictItem3.is_active, 0, 'is_active=false → 0');
  const strictItem4 = createAgreement({ title: 'Strict4', body: '', is_active: true, sort_order: 4 });
  assertEq(strictItem4.is_active, 1, 'is_active=true → 1');

  console.log('\n=== Test 19: sort_order clamped к >= 0 ===');
  const clampedItem = createAgreement({ title: 'Negative', body: '', is_active: 1, sort_order: -100 });
  assertEq(clampedItem.sort_order, 0, 'sort_order=-100 → 0 (clamped)');

  console.log('\n=== Test 20: deleteAgreement несуществующего id возвращает 0 ===');
  const removedNothing = deleteAgreement(999999);
  assertEq(removedNothing, 0, 'deleteAgreement(999999) → 0 (нет такого id)');

  console.log('\n=== Test 21: modal_title — отдельный заголовок модалки ===');
  setup();
  // Костин кейс: title = «правилами заказа» (грамматика для ссылки),
  // modal_title = «Правила заказа» (нормальный заголовок модалки).
  const wm = createAgreement({
    title: 'правилами заказа',
    body: 'Подробные правила...',
    modal_title: 'Правила заказа',
    is_active: 1,
  });
  assertEq(wm.title, 'правилами заказа', 'title сохранился');
  assertEq(wm.modal_title, 'Правила заказа', 'modal_title сохранился отдельно');

  // Без modal_title — null, фронт fallback'ит на title
  const noModal = createAgreement({ title: 'условиями оплаты', body: 'X' });
  assertEq(noModal.modal_title, '', 'без modal_title → пустая строка (fallback на title во фронте)');

  // Update modal_title точечно
  const wmUpdated = updateAgreement(wm.id, { modal_title: 'Новые правила' });
  assertEq(wmUpdated.modal_title, 'Новые правила', 'modal_title обновляется патчем');
  assertEq(wmUpdated.title, 'правилами заказа', 'title не тронут');

  // Очистить modal_title через пустую строку
  const cleared = updateAgreement(wm.id, { modal_title: '' });
  assertEq(cleared.modal_title, '', 'пустая строка очищает modal_title');

  // Слишком длинный — throw
  let threwModal = false;
  try {
    createAgreement({ title: 'X', body: 'X', modal_title: 'Y'.repeat(201) });
  } catch (err) {
    threwModal = err.code === 'modal_title_too_long';
  }
  assertEq(threwModal, true, 'modal_title > 200 символов → modal_title_too_long');

  console.log('\n=== Test 22: snapshot включает modal_title ===');
  setup();
  const snapA = createAgreement({
    title: 'правилами',
    body: 'B1',
    modal_title: 'Правила заказа',
    is_active: 1,
  });
  const snapB = createAgreement({ title: 'офертой', body: 'B2', is_active: 1 });
  const snapJson = JSON.parse(buildAcceptedSnapshot([snapA.id, snapB.id]));
  assertEq(snapJson.items.length, 2, 'snapshot содержит обе записи');
  assertEq(snapJson.items[0].modal_title, 'Правила заказа', 'modal_title в snapshot');
  assertEq(snapJson.items[1].modal_title, null, 'без modal_title → null в snapshot');
}

try {
  runTests();
  console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);
  if (results.failed === 0) {
    console.log('agreements.test.js passed');
  }
} finally {
  // Cleanup tmp DB + sidecar файлы (WAL mode оставляет .db-shm и .db-wal).
  // Cleanup идёт ПЕРЕД process.exit — иначе при падении теста файлы остаются
  // в server/tests/ (process.exit не выполняет finally).
  try {
    db.close();
  } catch {}
  for (const p of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
  if (results.failed > 0) {
    process.exit(1);
  }
}
