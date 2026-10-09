/**
 * POS-customers lifecycle tests.
 *
 * Покрытие:
 *   1. phoneDigitsOnly — нормализация разных форматов
 *   2. isPhoneValid — границы 9/10/15/16, нечисловые
 *   3. findCustomerByPhoneDigits — разные форматы хранения phone
 *   4. createOrMergePosCustomer — новый клиент
 *   5. createOrMergePosCustomer — merge с существующим (НЕ затирает имя)
 *   6. createOrMergePosCustomer — name_required / phone_invalid
 *   7. searchCustomers — по имени/фамилии/username, COLLATE NOCASE
 *   8. searchCustomers — escape LIKE-метасимволов (`_`, `%`)
 *   9. searchCustomers — пустой query → []
 *   10. getCustomerPurchaseHistory — мерджит orders + pos_sales, сортирует
 *
 * Запуск: node server/tests/pos-customers.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DB = path.resolve(__dirname, `./.tmp-pos-cust-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();
const {
  phoneDigitsOnly,
  isPhoneValid,
  findCustomerByPhoneDigits,
  searchCustomers,
  getCustomerPurchaseHistory,
  createOrMergePosCustomer,
  softDeleteCustomer,
  restoreCustomer,
} = await import('../utils/pos-customers.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    results.passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    results.failed++;
    console.log(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond, msg) {
  assertEq(Boolean(cond), true, msg);
}

function setupSchema() {
  db.exec(`
    DELETE FROM pos_sales;
    DELETE FROM orders;
    DELETE FROM customers;
  `);

  // Добавим разнообразных клиентов для тестов поиска
  db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_alice', '111', 'alice_99', 'Алиса', 'Иванова', '+375 33 111-22-33', DATETIME('now'), 0, 0)`).run();
  db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_bob', '222', 'bob_pro', 'Боб', 'Петров', '375332223344', DATETIME('now'), 0, 0)`).run();
  db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_carol', NULL, NULL, 'Кэрол', NULL, NULL, DATETIME('now'), 0, 0)`).run();
  db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_special', NULL, 'tom_official', 'Том', 'Спецсимволы', '+375 (29) 555.66.77', DATETIME('now'), 0, 0)`).run();
}

function runTests() {
  console.log('\n=== Setup ===');
  setupSchema();

  console.log('\n=== Test 1: phoneDigitsOnly ===');
  assertEq(phoneDigitsOnly('+375 33 123-45-67'), '375331234567', 'плюс/пробелы/дефисы');
  assertEq(phoneDigitsOnly('375.33.111.22.33'), '375331112233', 'точки');
  assertEq(phoneDigitsOnly('(29) 555-66-77'), '295556677', 'скобки');
  assertEq(phoneDigitsOnly('abc123def'), '123', 'буквы выкинуты');
  assertEq(phoneDigitsOnly(''), '', 'пустая строка');
  assertEq(phoneDigitsOnly(null), '', 'null safe');
  assertEq(phoneDigitsOnly(12345), '', 'не-строка → пустая (защита)');

  console.log('\n=== Test 2: isPhoneValid ===');
  assertEq(isPhoneValid('+375 33 123-45-67'), true, '12 цифр (BY)');
  assertEq(isPhoneValid('1234567890'), true, '10 цифр граница');
  assertEq(isPhoneValid('123456789'), false, '9 цифр - меньше границы');
  assertEq(isPhoneValid('123456789012345'), true, '15 цифр граница');
  assertEq(isPhoneValid('1234567890123456'), false, '16 цифр - больше');
  assertEq(isPhoneValid('abc'), false, 'нет цифр');
  assertEq(isPhoneValid(''), false, 'пустая');
  assertEq(isPhoneValid(undefined), false, 'undefined safe');

  console.log('\n=== Test 3: findCustomerByPhoneDigits — разные форматы хранения ===');
  // phone в БД сохранён в разных форматах (с +/без, с пробелами/без)
  const f1 = findCustomerByPhoneDigits('375331112233');
  assertEq(f1?.id, 'c_alice', 'находит c_alice (+375 33 111-22-33)');
  const f2 = findCustomerByPhoneDigits('375332223344');
  assertEq(f2?.id, 'c_bob', 'находит c_bob (375332223344 без форматирования)');
  const f3 = findCustomerByPhoneDigits('375295556677');
  assertEq(f3?.id, 'c_special', 'находит c_special с скобками и точками');
  const f4 = findCustomerByPhoneDigits('999999999999');
  assertEq(f4, null, 'не нашёл — null');

  console.log('\n=== Test 3b: findCustomerByPhoneDigits — детерминированно возвращает старшего при дублях ===');
  // Legacy-сценарий: в БД есть 2 клиента с одним и тем же телефоном (до фикса).
  // Должны вернуть того, кто создан раньше (ORDER BY created_at ASC).
  db.prepare(`INSERT INTO customers (id, first_name, phone, first_visit_at, created_at, total_orders, total_spent)
              VALUES ('c_dup_old', 'Старший', '+375 33 555-44-33', DATETIME('now'), '2024-01-01 10:00:00', 0, 0)`).run();
  db.prepare(`INSERT INTO customers (id, first_name, phone, first_visit_at, created_at, total_orders, total_spent)
              VALUES ('c_dup_new', 'Младший', '+375 33 555-44-33', DATETIME('now'), '2025-01-01 10:00:00', 0, 0)`).run();
  const dupResult = findCustomerByPhoneDigits('375335554433');
  assertEq(dupResult?.id, 'c_dup_old', 'возвращает старшего (created_at ASC)');

  console.log('\n=== Test 4: createOrMergePosCustomer — новый клиент ===');
  const r1 = createOrMergePosCustomer({
    name: 'Дмитрий Сидоров',
    phone: '+375 33 444-55-66',
    createdBy: 'cashier-1',
  });
  assertEq(r1.merged, false, 'merged = false');
  assertTrue(r1.customer.id.startsWith('cust_'), 'id префикс cust_');
  assertEq(r1.customer.first_name, 'Дмитрий', 'first_name из первого слова');
  assertEq(r1.customer.last_name, 'Сидоров', 'last_name из остальных слов');
  assertEq(r1.customer.phone, '+375 33 444-55-66', 'phone сохранён как ввели');
  assertEq(r1.customer.telegram_id, null, 'telegram_id = null (POS-only)');
  assertEq(r1.customer.access_authorization_source, 'staff', 'нового клиента явно разрешил сотрудник');

  console.log('\n=== Test 5: merge — НЕ затирает имя существующего клиента (regression C2) ===');
  db.prepare(`
    UPDATE customers
    SET access_authorized_at = DATETIME('now'), access_authorization_source = 'legacy'
    WHERE id = 'c_alice'
  `).run();
  const r2 = createOrMergePosCustomer({
    name: 'Аня', // другое имя на тот же phone
    phone: '+375 (33) 111-22-33', // тот же что у c_alice (Алиса Иванова)
  });
  assertEq(r2.merged, true, 'merged = true');
  assertEq(r2.customer.id, 'c_alice', 'возвращает существующего c_alice');
  assertEq(r2.customer.first_name, 'Алиса', 'first_name НЕ затёрт (был "Алиса", остался "Алиса")');
  assertEq(r2.customer.last_name, 'Иванова', 'last_name НЕ затёрт');
  assertEq(r2.customer.access_authorization_source, 'staff', 'явное разрешение сотрудника заменило legacy');

  console.log('\n=== Test 5b: merge — заполняет ПУСТЫЕ поля (Кэрол без фамилии) ===');
  const r2b = createOrMergePosCustomer({
    name: 'Кэрол Карольская',
    phone: '+375 33 999-88-77',
  });
  assertEq(r2b.merged, false, 'новый клиент (Кэрол не имела phone)');
  // А теперь второй раз с тем же phone — фамилия должна догрузиться, имя нет
  // Carol уже была без phone — её мы не найдём по телефону.
  // Сделаем другой кейс: создадим клиента с пустым last_name и помержим с фамилией.
  db.prepare(`INSERT INTO customers (id, first_name, last_name, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_partial', 'Олег', NULL, '+375 33 000-11-22', DATETIME('now'), 0, 0)`).run();
  const r2c = createOrMergePosCustomer({
    name: 'Олег Олегов',
    phone: '+375 33 000-11-22',
  });
  assertEq(r2c.merged, true, 'найден c_partial');
  assertEq(r2c.customer.first_name, 'Олег', 'first_name остался');
  assertEq(r2c.customer.last_name, 'Олегов', 'пустой last_name заполнился');

  console.log('\n=== Test 6: валидация ===');
  let nameErr = null;
  try { createOrMergePosCustomer({ name: '', phone: '375331234567' }); } catch (e) { nameErr = e; }
  assertEq(nameErr?.code, 'name_required', 'name_required');

  let phoneErr = null;
  try { createOrMergePosCustomer({ name: 'X', phone: '123' }); } catch (e) { phoneErr = e; }
  assertEq(phoneErr?.code, 'phone_invalid', 'phone_invalid (3 цифры)');

  let phoneUndefErr = null;
  try { createOrMergePosCustomer({ name: 'X', phone: undefined }); } catch (e) { phoneUndefErr = e; }
  assertEq(phoneUndefErr?.code, 'phone_invalid', 'phone_invalid (undefined safe)');

  console.log('\n=== Test 7: searchCustomers — имя/фамилия/username ===');
  // Известное ограничение SQLite: COLLATE NOCASE работает только с ASCII —
  // для кириллицы регистронезависимости нет (требует ICU collation).
  // Поэтому ищем «Алиса» с заглавной буквы (как храним).
  const s1 = searchCustomers({ q: 'Алиса' });
  assertTrue(s1.some((c) => c.id === 'c_alice'), 'нашёл по first_name (тот же регистр)');
  const s3 = searchCustomers({ q: 'Петров' });
  assertTrue(s3.some((c) => c.id === 'c_bob'), 'нашёл по фамилии');
  const s4 = searchCustomers({ q: 'tom_official' });
  assertTrue(s4.some((c) => c.id === 'c_special'), 'нашёл по telegram_username');
  const s4b = searchCustomers({ q: 'TOM_OFFICIAL' });
  assertTrue(s4b.some((c) => c.id === 'c_special'), 'username: NOCASE работает для ASCII');
  const s5 = searchCustomers({ q: '375331112233' });
  assertTrue(s5.some((c) => c.id === 'c_alice'), 'нашёл по phone digits (форматированный в БД)');

  // Regression N1: blocked_count должен присутствовать в результатах поиска,
  // чтобы UI кассы мог показать ⚠ предупреждение для заблокированных.
  // Создаём активный блок для bob и проверяем.
  db.prepare(`INSERT INTO customer_blocks (id, customer_id, active)
              VALUES ('blk_bob_test', 'c_bob', 1)`).run();
  const sBlocked = searchCustomers({ q: 'Петров' });
  const bobInResults = sBlocked.find((c) => c.id === 'c_bob');
  assertTrue(bobInResults, 'bob в результатах');
  assertEq(bobInResults?.blocked_count, 1, 'blocked_count = 1 в search-результатах (regression N1)');
  // Создаём клиента и проверяем что merge тоже возвращает blocked_count
  const merged = createOrMergePosCustomer({ name: 'Боб', phone: '375332223344' });
  assertEq(merged.customer.blocked_count, 1, 'blocked_count = 1 в результате merge (regression N1)');
  // Cleanup
  db.prepare(`DELETE FROM customer_blocks WHERE id = 'blk_bob_test'`).run();

  console.log('\n=== Test 8: searchCustomers — escape LIKE wildcards (regression C1) ===');
  // У наших test-fixtures username'ы содержат литеральный _ (alice_99, bob_pro,
  // tom_official) — `_` находит их по букве. Проверяем что % НЕ работает как
  // wildcard: % нет ни в одном поле фикстур, escape должен это гарантировать.
  const s8b = searchCustomers({ q: '%' });
  assertEq(s8b.length, 0, 'литеральный % не матчит (escape работает)');
  // Литеральный `_` тоже не должен матчить тех, у кого нет _ в данных:
  // Кэрол не имеет _ ни в одном поле, Карол не должна найтись.
  // Также добавим клиента БЕЗ _ и проверим что он не попадает.
  db.prepare(`INSERT INTO customers (id, first_name, last_name, telegram_username, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_clean', 'Чистый', 'Безподчерков', 'pure', '+375 33 999-99-99', DATETIME('now'), 0, 0)`).run();
  const s8c = searchCustomers({ q: '_' });
  assertTrue(
    !s8c.some((c) => c.id === 'c_clean'),
    '_ не матчит c_clean (нет _ в данных) — escape работает',
  );

  console.log('\n=== Test 9: searchCustomers — пустой query → [] ===');
  assertEq(searchCustomers({ q: '' }), [], 'пустой query');
  assertEq(searchCustomers({ q: '   ' }), [], 'whitespace only');
  assertEq(searchCustomers({}), [], 'без q');

  console.log('\n=== Test 9b: searchCustomers includeRecent — последние клиенты при пустом q ===');
  // Без includeRecent — пустой массив (старое поведение autocomplete).
  assertEq(searchCustomers({ q: '', includeRecent: false }), [], 'recent off → []');
  // С includeRecent — все 5 наших клиентов из setupSchema (Alice/Bob/Olga/...).
  const recent = searchCustomers({ q: '', includeRecent: true, limit: 50 });
  assertTrue(recent.length >= 5, 'includeRecent=true → есть последние клиенты');
  assertTrue(
    recent.every((r) => r.id && (r.first_name || r.telegram_username || r.phone)),
    'каждый row — реальный клиент с identifier',
  );
  // Проверим что limit работает.
  const recentLimited = searchCustomers({ q: '', includeRecent: true, limit: 2 });
  assertEq(recentLimited.length, 2, 'limit=2 → 2 записи');
  // Проверим что blocked_count считается (даже если 0).
  assertTrue(
    recent.every((r) => typeof r.blocked_count === 'number'),
    'blocked_count всегда есть в payload',
  );
  // q непустой → includeRecent игнорируется (поиск работает как раньше).
  const stillSearch = searchCustomers({ q: 'Alice', includeRecent: true });
  assertTrue(
    stillSearch.length > 0 && stillSearch.every((r) => /alice/i.test(JSON.stringify(r))),
    'q="Alice" + includeRecent — всё равно поиск, не recent-fallback',
  );

  // Контракт recent — активные сверху (по last_visit_at DESC), затем по
  // last_order_at DESC, затем created_at DESC; клиенты без last_visit_at —
  // в самом конце (NULL-LAST через `IS NULL` индикатор в ORDER BY).
  console.log('\n=== Test 9c: searchCustomers includeRecent — корректный ORDER BY ===');
  // Подготовим 3 клиента с разной last_visit_at для детерминированного теста.
  db.prepare(`DELETE FROM customers WHERE id LIKE 'c_order_%'`).run();
  db.prepare(`INSERT INTO customers (id, first_name, last_visit_at, created_at, updated_at)
              VALUES ('c_order_old', 'Старый', '2026-04-01 10:00:00', DATETIME('now'), DATETIME('now'))`).run();
  db.prepare(`INSERT INTO customers (id, first_name, last_visit_at, created_at, updated_at)
              VALUES ('c_order_new', 'Свежий', '2026-04-15 10:00:00', DATETIME('now'), DATETIME('now'))`).run();
  db.prepare(`INSERT INTO customers (id, first_name, last_visit_at, created_at, updated_at)
              VALUES ('c_order_null', 'БезВизита', NULL, DATETIME('now'), DATETIME('now'))`).run();
  const ordered = searchCustomers({ q: '', includeRecent: true, limit: 100 });
  const idxNew = ordered.findIndex((r) => r.id === 'c_order_new');
  const idxOld = ordered.findIndex((r) => r.id === 'c_order_old');
  const idxNull = ordered.findIndex((r) => r.id === 'c_order_null');
  assertTrue(idxNew >= 0 && idxOld >= 0 && idxNull >= 0, 'все 3 контрольных есть в выдаче');
  assertTrue(idxNew < idxOld, 'свежий visit раньше старого в списке');
  assertTrue(idxOld < idxNull, 'клиент без last_visit_at в самом конце (NULLS LAST через IS NULL)');

  console.log('\n=== Test 9d: searchCustomers posOnly — фильтр для блокнота кассы ===');
  // setupSchema: c_alice (telegram), c_bob (telegram), c_carol (без telegram),
  // c_special (без telegram). c_order_* — все без telegram_id (POS-клиенты по факту).
  // Без posOnly видим всех; c posOnly Telegram-клиенты без pos_sales исчезают.
  const allRecent = searchCustomers({ q: '', includeRecent: true, limit: 100, posOnly: false });
  const allHasAlice = allRecent.some((r) => r.id === 'c_alice');
  assertTrue(allHasAlice, 'без posOnly: c_alice (Telegram) видна');

  const posRecent = searchCustomers({ q: '', includeRecent: true, limit: 100, posOnly: true });
  const posHasAlice = posRecent.some((r) => r.id === 'c_alice');
  const posHasCarol = posRecent.some((r) => r.id === 'c_carol');
  assertEq(posHasAlice, false, 'с posOnly: c_alice (Telegram, без pos_sales) скрыта');
  assertEq(posHasCarol, true, 'с posOnly: c_carol (telegram_id=NULL) видна');

  // Добавим c_alice один pos_sale → должна снова появиться (merged-кейс)
  db.prepare(`INSERT INTO pos_sales (id, sale_number, customer_id, product_name, price, status, created_at)
              VALUES ('p_alice_pos', 9001, 'c_alice', 'TEST', 10, 'completed', DATETIME('now'))`).run();
  const posRecentAfterMerge = searchCustomers({ q: '', includeRecent: true, limit: 100, posOnly: true });
  const aliceBack = posRecentAfterMerge.some((r) => r.id === 'c_alice');
  assertEq(aliceBack, true, 'после pos_sale на c_alice — она появляется в posOnly блокноте (merged-кейс)');

  console.log('\n=== Test 9e: posOnly работает и для непустого q (поиск по имени) ===');
  // Поиск по имени Алиса с posOnly=false → находит
  const sAliceAll = searchCustomers({ q: 'Алиса', posOnly: false });
  assertTrue(sAliceAll.some((r) => r.id === 'c_alice'), 'без posOnly: q="Алиса" находит c_alice');
  // С posOnly=true — c_alice сейчас имеет pos_sale, поэтому остаётся
  const sAlicePosWith = searchCustomers({ q: 'Алиса', posOnly: true });
  assertTrue(sAlicePosWith.some((r) => r.id === 'c_alice'), 'с posOnly+pos_sale: c_alice находится');
  // А c_bob (Telegram, без pos_sale) при поиске «Боб» с posOnly не должен находиться
  const sBobPos = searchCustomers({ q: 'Боб', posOnly: true });
  assertEq(sBobPos.some((r) => r.id === 'c_bob'), false, 'с posOnly: c_bob (Telegram, без pos_sale) скрыт даже при точном поиске');
  const sBobAll = searchCustomers({ q: 'Боб', posOnly: false });
  assertTrue(sBobAll.some((r) => r.id === 'c_bob'), 'без posOnly: c_bob находится при поиске «Боб»');

  console.log('\n=== Test 9f: posOnly скрывает legacy-клиентов с username но без telegram_id ===');
  // Реальный prod-кейс: в БД есть онлайн-клиенты у которых telegram_id=NULL,
  // но telegram_username заполнен (legacy mini-app flow). Это НЕ проходняк,
  // блокнот кассы их показывать не должен.
  db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, last_name, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_legacy_online', NULL, 'someuser_online', NULL, NULL, NULL, DATETIME('now'), 1, 50)`).run();
  const legacyAll = searchCustomers({ q: '', includeRecent: true, limit: 200, posOnly: false });
  assertTrue(
    legacyAll.some((r) => r.id === 'c_legacy_online'),
    'без posOnly: legacy-клиент с username (без telegram_id) виден',
  );
  const legacyPos = searchCustomers({ q: '', includeRecent: true, limit: 200, posOnly: true });
  assertEq(
    legacyPos.some((r) => r.id === 'c_legacy_online'),
    false,
    'с posOnly: legacy-клиент с username скрыт (он не проходняк)',
  );
  // Поиск по username тоже должен скрывать
  const legacySearch = searchCustomers({ q: 'someuser_online', posOnly: true });
  assertEq(
    legacySearch.some((r) => r.id === 'c_legacy_online'),
    false,
    'с posOnly + поиск по username: legacy-клиент скрыт',
  );
  // Cleanup
  db.prepare(`DELETE FROM customers WHERE id = 'c_legacy_online'`).run();

  // Cleanup: удаляем тестовый pos_sale на c_alice, чтобы не засорить
  // следующие тесты (Test 10 опирается на ровно 0 pos_sales у c_alice
  // в момент его старта — иначе getCustomerPurchaseHistory вернёт лишнюю
  // запись и собьёт сортировку).
  db.prepare(`DELETE FROM pos_sales WHERE id = 'p_alice_pos'`).run();

  console.log('\n=== Test 9g: softDeleteCustomer + фильтр deleted_at в выдаче ===');
  // Создадим тестового клиента, удалим, проверим что исчез из блокнота.
  db.prepare(`INSERT INTO customers (id, telegram_id, telegram_username, first_name, phone, first_visit_at, total_orders, total_spent)
              VALUES ('c_to_delete', NULL, NULL, 'Удалёнчик', '+375111111111', DATETIME('now'), 0, 0)`).run();
  const beforeDelete = searchCustomers({ q: 'Удалёнчик', posOnly: true });
  assertTrue(beforeDelete.some((r) => r.id === 'c_to_delete'), 'до softDelete клиент виден');

  const removed = softDeleteCustomer('c_to_delete');
  assertEq(removed, 1, 'softDeleteCustomer вернул 1 (одну строку обновили)');

  const afterDelete = searchCustomers({ q: 'Удалёнчик', posOnly: true });
  assertEq(afterDelete.some((r) => r.id === 'c_to_delete'), false, 'после softDelete клиент скрыт');
  // Также проверим что recent-блокнот тоже не показывает удалённого
  const afterDeleteRecent = searchCustomers({ q: '', includeRecent: true, limit: 200, posOnly: true });
  assertEq(afterDeleteRecent.some((r) => r.id === 'c_to_delete'), false, 'recent: клиент скрыт после softDelete');

  // Запись в БД осталась — найти можно прямо
  const stillInDb = db.prepare('SELECT deleted_at FROM customers WHERE id = ?').get('c_to_delete');
  assertTrue(!!stillInDb, 'запись осталась в БД (soft delete)');
  assertTrue(!!stillInDb.deleted_at, 'deleted_at заполнен');

  // Повторный softDelete не делает ничего
  const removedAgain = softDeleteCustomer('c_to_delete');
  assertEq(removedAgain, 0, 'повторный softDelete на удалённом → 0 (idempotent)');

  // Несуществующий id → 0
  assertEq(softDeleteCustomer('c_nope'), 0, 'softDelete несуществующего → 0');
  assertEq(softDeleteCustomer(''), 0, 'softDelete пустого id → 0');
  assertEq(softDeleteCustomer(null), 0, 'softDelete null → 0');

  // restoreCustomer возвращает клиента в выдачу
  const restored = restoreCustomer('c_to_delete');
  assertEq(restored, 1, 'restoreCustomer вернул 1');
  const afterRestore = searchCustomers({ q: 'Удалёнчик', posOnly: true });
  assertTrue(afterRestore.some((r) => r.id === 'c_to_delete'), 'после restore клиент снова виден');

  // Cleanup
  db.prepare(`DELETE FROM customers WHERE id = 'c_to_delete'`).run();

  console.log('\n=== Test 10: getCustomerPurchaseHistory — merge orders + pos_sales ===');
  // Готовим заказ и POS-чек для c_alice (с разными форматами datetime — regression C3)
  db.prepare(`INSERT INTO orders (id, order_number, customer_id, total_amount, final_amount, status, delivery_type, created_at)
              VALUES ('o_a1', 1001, 'c_alice', 50, 50, 'completed', 'pickup', '2026-04-01 10:00:00')`).run();
  db.prepare(`INSERT INTO pos_sales (id, sale_number, customer_id, product_name, price, status, created_at)
              VALUES ('p_a1', 2001, 'c_alice', 'PODONKI', 30, 'completed', '2026-04-02T10:00:00.000Z')`).run();
  db.prepare(`INSERT INTO orders (id, order_number, customer_id, total_amount, final_amount, status, delivery_type, created_at)
              VALUES ('o_a2', 1002, 'c_alice', 75, 75, 'completed', 'pickup', '2026-04-03 10:00:00')`).run();

  const hist = getCustomerPurchaseHistory('c_alice', { limit: 10 });
  assertEq(hist.length, 3, '3 записи в истории');
  assertEq(hist[0].id, 'o_a2', 'самая новая (3 апреля) сверху');
  assertEq(hist[1].id, 'p_a1', 'POS (2 апреля) посередине (mixed datetime sort works)');
  assertEq(hist[2].id, 'o_a1', '1 апреля внизу');
  assertEq(hist[0].source, 'order', 'source label корректен');
  assertEq(hist[1].source, 'pos', 'source pos');
}

function cleanup() {
  db.close();
  try { fs.unlinkSync(TMP_DB); } catch {}
  try { fs.unlinkSync(TMP_DB + '-shm'); } catch {}
  try { fs.unlinkSync(TMP_DB + '-wal'); } catch {}
}

try {
  runTests();
  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);
  cleanup();
  process.exit(results.failed > 0 ? 1 : 0);
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}
