import { db } from '../db.js';

/**
 * Ядро логики POS-клиентов и поиска по базе клиентов.
 *
 * Ключевые принципы:
 *   - Phone хранится в `customers.phone` в человекочитаемом виде (как ввёл
 *     продавец), но для **сравнения и поиска** используется только цифровая
 *     часть (`phoneDigitsOnly`). Это позволяет матчить «+375 33 123-45-67»
 *     с «375331234567» и любыми пробелами/скобками.
 *   - При создании POS-клиента происходит **merge** с существующим: если уже
 *     есть customer (например, Telegram-клиент) с таким же phone digits —
 *     возвращаем его без перезаписи `first_name`/`last_name` (продавец сам
 *     решает что делать в UI). Дубля по телефону не создаём.
 *
 * TODO (отдельная задача):
 *   - Материализованный столбец `customers.phone_digits` + `UNIQUE INDEX` —
 *     закроет race condition в multi-process деплое и сделает поиск по
 *     телефону O(log n) вместо full-scan + REPLACE chain. На текущих объёмах
 *     (десятки тысяч клиентов) производительность приемлема.
 */

/**
 * Возвращает только цифры из строки телефона. Используется ВСЕГДА перед
 * любым сравнением phone — независимо от того, как пользователь ввёл номер.
 */
export function phoneDigitsOnly(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\D+/g, '');
}

/**
 * Проверка минимальной длины: для +375 (Беларусь) — 12 цифр (375 + 9).
 * Принимаем любые номера ≥10 цифр (страховка от опечаток коротких).
 */
export function isPhoneValid(value) {
  const digits = phoneDigitsOnly(value);
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Поиск клиента по телефону (через цифровую часть). Использует SQL-функцию
 * REPLACE для нормализации на лету — поскольку у нас не очень много клиентов
 * (десятки тысяч максимум), full-scan приемлем; для масштаба нужно ввести
 * материализованный столбец `phone_digits` с индексом (см. TODO в шапке).
 *
 * Если в БД случайно оказались два клиента с одинаковым phone (legacy-данные),
 * возвращаем самого старого (`ORDER BY created_at ASC`) — детерминированно.
 */
export function findCustomerByPhoneDigits(digits) {
  if (!digits) return null;
  return (
    db
      .prepare(
        `SELECT * FROM customers
         WHERE phone IS NOT NULL
           AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') = ?
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(digits) ?? null
  );
}

/**
 * Условие «клиент относится к блокноту проходняка» — по TZ Кости:
 * «база клиентов на проходняк». В блокноте кассы должны быть только те,
 * кто физически приходил в магазин, а не онлайн-покупатели Mini App.
 *
 * Признаки POS-клиента:
 *   1. Создан через кассу — НЕТ ни telegram_id, ни telegram_username
 *      (createOrMergePosCustomer заполняет только phone + first/last_name).
 *      В legacy-данных встречаются клиенты с telegram_username но без
 *      telegram_id (старый Mini-App flow), такие — НЕ проходняк, поэтому
 *      проверяем оба поля.
 *   2. Либо у него хотя бы один POS-чек в pos_sales — это покрывает
 *      merge-кейс, когда кассир пробил чек на Telegram-клиента (по
 *      совпадению телефона), и тот должен снова быть в блокноте.
 */
const POS_ONLY_CONDITION = `(
  (c.telegram_id IS NULL AND (c.telegram_username IS NULL OR c.telegram_username = ''))
  OR EXISTS (SELECT 1 FROM pos_sales ps WHERE ps.customer_id = c.id)
)`;

/**
 * Универсальный поиск клиентов для админских autocomplete + «блокнота» кассы.
 *   - q — строка запроса (имя/фамилия/username/phone-цифры)
 *   - limit — максимум результатов
 *   - includeRecent — если q пустой, возвращать последних клиентов (для
 *     постоянно видимого блокнота на кассирском экране — TZ Кости:
 *     «у тебя по сути внутри некий блокнот... тут же поиск по клиенту»).
 *     При false (по умолчанию) сохраняется старое поведение: пустой q → [].
 *   - posOnly — фильтрует выдачу до POS-клиентов (см. POS_ONLY_CONDITION).
 *     Используется блокнотом кассы. По умолчанию false — обычный
 *     autocomplete CRM показывает всех.
 *
 * Логика:
 *   - Если в q есть цифры → ищем по phone digits (substring match).
 *   - Параллельно — LIKE по first_name, last_name, telegram_username
 *     с COLLATE NOCASE для русских имён.
 *   - При includeRecent=true и пустом q → последние N клиентов по
 *     last_visit_at / created_at.
 */
export function searchCustomers({ q, limit = 20, includeRecent = false, posOnly = false } = {}) {
  const query = typeof q === 'string' ? q.trim() : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const posFilter = posOnly ? `AND ${POS_ONLY_CONDITION}` : '';
  // Soft-delete: записи с deleted_at не должны появляться в выдаче (ни в
  // блокноте кассы, ни в общем CRM-autocomplete). История чеков сохраняется
  // в pos_sales/orders, но клиент скрыт.
  const deletedFilter = `AND c.deleted_at IS NULL`;

  if (query.length === 0) {
    if (!includeRecent) return [];
    // Дефолтный список «блокнота»: последние клиенты, отсортированы по
    // активности. blocked_count подгружаем тем же подзапросом, что и в
    // поиске, чтобы UI кассы мог рисовать ⚠ для забаненных.
    // posFilter превращает безусловный SELECT в WHERE с условием POS-only.
    return db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM customer_blocks
                  WHERE customer_id = c.id
                    AND active = 1
                    AND (block_until IS NULL OR block_until > DATETIME('now'))) AS blocked_count
           FROM customers c
          WHERE 1 ${deletedFilter} ${posFilter}
          ORDER BY (c.last_visit_at IS NULL), c.last_visit_at DESC,
                   (c.last_order_at IS NULL), c.last_order_at DESC,
                   c.created_at DESC
          LIMIT ?`,
      )
      .all(safeLimit);
  }

  // Эскейпим LIKE-метасимволы (`%`, `_`, `\`) чтобы пользовательский ввод
  // вроде `_` или `%` не превращался в wildcard и не вытаскивал всех.
  const escapedQuery = query.replace(/[\\%_]/g, (ch) => '\\' + ch);
  const like = `%${escapedQuery}%`;
  const digits = phoneDigitsOnly(query);
  const digitsLike = `%${digits}%`; // digits — только цифры, эскейп не нужен

  // blocked_count подзапросом — чтобы UI кассы мог рисовать ⚠ предупреждение
  // о заблокированном клиенте без отдельного fetch'а карточки.
  const rows = db
    .prepare(
      `SELECT DISTINCT c.*,
              (SELECT COUNT(*) FROM customer_blocks
                WHERE customer_id = c.id
                  AND active = 1
                  AND (block_until IS NULL OR block_until > DATETIME('now'))) AS blocked_count
         FROM customers c
        WHERE (
          COALESCE(c.first_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR COALESCE(c.last_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR COALESCE(c.telegram_username, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR COALESCE(c.telegram_id, '') LIKE ? ESCAPE '\\'
          OR (
            ? != ''
            AND c.phone IS NOT NULL
            AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone, '+', ''), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') LIKE ?
          )
        ) ${deletedFilter} ${posFilter}
        ORDER BY (c.last_visit_at IS NULL), c.last_visit_at DESC, c.created_at DESC
        LIMIT ?`,
    )
    .all(like, like, like, like, digits, digitsLike, safeLimit);

  return rows;
}

/**
 * Хелпер: догружает blocked_count к одиночному customer-row, потому что
 * в `SELECT * FROM customers WHERE id = ?` его нет (поле виртуальное,
 * считается подзапросом).
 */
function attachBlockedCount(customer) {
  if (!customer || !customer.id) return customer;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM customer_blocks
        WHERE customer_id = ?
          AND active = 1
          AND (block_until IS NULL OR block_until > DATETIME('now'))`,
    )
    .get(customer.id);
  return { ...customer, blocked_count: row?.n ?? 0 };
}

/**
 * Объединённая история покупок клиента: онлайн-заказы (orders) + POS-чеки.
 * Возвращает массив, отсортированный по дате (новые сверху).
 */
export function getCustomerPurchaseHistory(customerId, { limit = 50 } = {}) {
  if (!customerId) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);

  const orders = db
    .prepare(
      `SELECT
         id,
         'order' AS source,
         order_number AS number,
         COALESCE(final_amount, total_amount) AS amount,
         status,
         created_at,
         paid_at AS completed_at
       FROM orders
       WHERE customer_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(String(customerId), safeLimit);

  const posSales = db
    .prepare(
      `SELECT
         id,
         'pos' AS source,
         sale_number AS number,
         price AS amount,
         status,
         created_at,
         completed_at
       FROM pos_sales
       WHERE customer_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(String(customerId), safeLimit);

  // Мержим и сортируем по created_at DESC. Используем Date.parse чтобы
  // корректно сравнивать смешанные форматы datetime в БД:
  //   - 'YYYY-MM-DD HH:MM:SS' (от DATETIME('now') в SQLite — UTC, без Z)
  //   - 'YYYY-MM-DDTHH:MM:SS.sssZ' (от new Date().toISOString() в pos.js)
  // Лексикографическое сравнение их перепутает на стыке секунд.
  const merged = [...orders, ...posSales].sort((a, b) => {
    return parseDbTimestamp(b.created_at) - parseDbTimestamp(a.created_at);
  });
  return merged.slice(0, safeLimit);
}

/**
 * Парсит datetime из БД в epoch ms, нормализуя оба формата под UTC:
 *   - 'YYYY-MM-DD HH:MM:SS' → добавляем 'T' и 'Z'
 *   - 'YYYY-MM-DDTHH:MM:SS.sssZ' → используем как есть (уже UTC)
 * Если формат неожиданный — возвращает 0 (запись уйдёт в конец сортировки).
 */
function parseDbTimestamp(value) {
  if (!value) return 0;
  const s = String(value);
  if (s.endsWith('Z')) return Date.parse(s) || 0;
  return Date.parse(s.replace(' ', 'T') + 'Z') || 0;
}

function generateCustomerId() {
  return `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Создаёт POS-клиента или переиспользует существующего (merge по phone).
 *
 * Алгоритм:
 *   1. Нормализуем имя и phone, валидируем.
 *   2. Ищем существующего customer по phone digits.
 *   3. Если нашли — обновляем `first_name`/`last_name` (если новые непустые)
 *      и `last_visit_at`, не меняем `telegram_id`/`telegram_username`.
 *      Возвращаем существующего — это и есть «merge».
 *   4. Если нет — создаём нового без telegram_id, со source='pos'.
 *
 * Возвращает: { customer, merged: boolean }.
 */
export function createOrMergePosCustomer({ name, phone, createdBy } = {}) {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    const err = new Error('name_required');
    err.code = 'name_required';
    throw err;
  }
  // Защитный преcast строки до валидации — чтобы phone.trim() позже не упал
  // на undefined даже если isPhoneValid поведение изменится.
  const phoneTrimmed = String(phone || '').trim();
  if (!isPhoneValid(phoneTrimmed)) {
    const err = new Error('phone_invalid');
    err.code = 'phone_invalid';
    throw err;
  }

  const digits = phoneDigitsOnly(phoneTrimmed);

  // Разделение «Имя Фамилия» по первому пробелу — простой и предсказуемый
  // паттерн для русских ФИО. Если введено только одно слово — кладём в first_name.
  const [firstNamePart, ...rest] = trimmedName.split(/\s+/);
  const firstName = firstNamePart || null;
  const lastName = rest.length > 0 ? rest.join(' ') : null;

  const tx = db.transaction(() => {
    const existing = findCustomerByPhoneDigits(digits);
    if (existing) {
      // Merge: НЕ перезаписываем first_name/last_name существующего клиента —
      // продавец видит реальное имя в UI и сам решает, тот ли это человек.
      // Перезапись могла бы испортить данные Telegram-клиента (например,
      // в случае семьи с одним телефоном или при опечатке кассира).
      // Заполняем только пустые поля. NULLIF на самом поле — чтобы legacy-данные
      // с empty string ('') тоже считались пустыми и заполнялись.
      db.prepare(
        `UPDATE customers
            SET first_name = COALESCE(NULLIF(first_name, ''), NULLIF(?, '')),
                last_name  = COALESCE(NULLIF(last_name, ''), NULLIF(?, '')),
                access_authorized_at = COALESCE(access_authorized_at, DATETIME('now')),
                access_authorization_source = CASE
                  WHEN access_authorization_source = 'referral' THEN 'referral'
                  ELSE 'staff'
                END,
                last_visit_at = DATETIME('now'),
                updated_at = DATETIME('now')
          WHERE id = ?`,
      ).run(firstName ?? '', lastName ?? '', existing.id);
      const refreshed = db
        .prepare('SELECT * FROM customers WHERE id = ?')
        .get(existing.id);
      return { customer: attachBlockedCount(refreshed), merged: true };
    }

    const customerId = generateCustomerId();
    db.prepare(
      `INSERT INTO customers (
         id, telegram_id, telegram_username,
         first_name, last_name, phone,
         first_visit_at, last_visit_at,
         total_orders, total_spent,
         notes, access_authorized_at, access_authorization_source
       ) VALUES (
         ?, NULL, NULL,
         ?, ?, ?,
         DATETIME('now'), DATETIME('now'),
         0, 0,
         ?, DATETIME('now'), 'staff'
       )`,
    ).run(
      customerId,
      firstName,
      lastName,
      phoneTrimmed,
      createdBy ? `Создан в кассе пользователем ${createdBy}` : null,
    );
    const customer = db
      .prepare('SELECT * FROM customers WHERE id = ?')
      .get(customerId);
    // У свежесозданного blocked_count всегда 0 — но возвращаем через хелпер
    // для консистентности типа возвращаемого значения.
    return { customer: attachBlockedCount(customer), merged: false };
  });

  return tx();
}

/**
 * Soft-delete клиента: ставим deleted_at = NOW. Запись остаётся в БД,
 * история чеков (pos_sales) и заказов (orders) тоже — мы не трогаем
 * связанные таблицы. Из блокнота кассы и других списков клиент пропадает
 * (см. searchCustomers — там фильтр на deleted_at IS NULL).
 *
 * Возвращает количество затронутых строк (0 если id не найден или уже
 * удалён ранее).
 */
export function softDeleteCustomer(customerId) {
  const id = String(customerId ?? '').trim();
  if (!id) return 0;
  const result = db
    .prepare(
      `UPDATE customers
          SET deleted_at = DATETIME('now'),
              updated_at = DATETIME('now')
        WHERE id = ?
          AND deleted_at IS NULL`,
    )
    .run(id);
  return result.changes;
}

/**
 * Восстанавливает мягко удалённого клиента (deleted_at → NULL).
 * Не используется в UI v1, но полезно админу через прямой API/SQL,
 * если клиент был удалён по ошибке.
 */
export function restoreCustomer(customerId) {
  const id = String(customerId ?? '').trim();
  if (!id) return 0;
  const result = db
    .prepare(
      `UPDATE customers
          SET deleted_at = NULL,
              updated_at = DATETIME('now')
        WHERE id = ?
          AND deleted_at IS NOT NULL`,
    )
    .run(id);
  return result.changes;
}
