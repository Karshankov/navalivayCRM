import { db } from '../db.js';

/**
 * Соглашения перед оформлением заказа.
 *
 * Контракт:
 *   - listActiveAgreements() — для публичного API: только is_active=1, в порядке
 *     sort_order, потом id (стабильно).
 *   - listAllAgreements() — для админки: всё, отсортировано так же.
 *   - createAgreement / updateAgreement / deleteAgreement — CRUD.
 *   - validateAcceptedAgreementIds(ids) — проверка при создании заказа:
 *     все активные agreements должны быть в `ids`. Возвращает список
 *     недостающих (по id и title) — фронт подсветит соответствующие чекбоксы.
 *   - buildAcceptedSnapshot(ids) — формирует JSON-snapshot для orders.accepted_agreements.
 *     Сохраняет именно текст, который клиент ВИДЕЛ — на случай если в админке
 *     кто-то отредактирует body после оформления.
 */

function rowToAgreement(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    // modal_title — отдельный заголовок для модалки с полным текстом.
    // Если пустой/NULL, фронт показывает в модалке title (старое поведение).
    modal_title: row.modal_title ? String(row.modal_title) : '',
    is_active: Number(row.is_active) ? 1 : 0,
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function listActiveAgreements() {
  const rows = db
    .prepare(
      `SELECT id, title, body, modal_title, is_active, sort_order, created_at, updated_at
         FROM agreements
        WHERE is_active = 1
        ORDER BY sort_order ASC, id ASC`,
    )
    .all();
  return rows.map(rowToAgreement);
}

export function listAllAgreements() {
  const rows = db
    .prepare(
      `SELECT id, title, body, modal_title, is_active, sort_order, created_at, updated_at
         FROM agreements
        ORDER BY sort_order ASC, id ASC`,
    )
    .all();
  return rows.map(rowToAgreement);
}

export function getAgreementById(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const row = db
    .prepare(
      `SELECT id, title, body, modal_title, is_active, sort_order, created_at, updated_at
         FROM agreements
        WHERE id = ?`,
    )
    .get(numericId);
  return rowToAgreement(row);
}

function normalizeTitleOrThrow(title) {
  const trimmed = String(title ?? '').trim();
  if (!trimmed) {
    const err = new Error('title_required');
    err.code = 'title_required';
    throw err;
  }
  if (trimmed.length > 200) {
    const err = new Error('title_too_long');
    err.code = 'title_too_long';
    throw err;
  }
  return trimmed;
}

function normalizeBody(body) {
  const value = String(body ?? '').trim();
  // 20 KB body хватит на любой реалистичный текст соглашения.
  // Защита от мусора в БД (например, кто-то вставил весь устав компании).
  if (value.length > 20000) {
    const err = new Error('body_too_long');
    err.code = 'body_too_long';
    throw err;
  }
  return value;
}

function normalizeModalTitle(value) {
  // modal_title — опциональный заголовок модалки. Пустой → null (fallback на title).
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) {
    const err = new Error('modal_title_too_long');
    err.code = 'modal_title_too_long';
    throw err;
  }
  return trimmed;
}

function normalizeIsActive(value) {
  // Строгая интерпретация: только true / 1 / '1' → активно, всё остальное → 0.
  // Защита от ситуаций когда фронт-форма случайно прислала строку "0" — она
  // не должна интерпретироваться как truthy.
  if (value === true) return 1;
  if (value === 1 || value === '1') return 1;
  return 0;
}

function normalizeSortOrder(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // Отрицательные значения не имеют смысла — порядок отображения всегда
  // от 0 вверх. Защита от опечатки админа («-1» вместо «1»), которая
  // навсегда поднимает строку над всеми остальными.
  return Math.max(0, Math.trunc(n));
}

export function createAgreement({ title, body, modal_title, is_active, sort_order } = {}) {
  const normalizedTitle = normalizeTitleOrThrow(title);
  const normalizedBody = normalizeBody(body);
  const normalizedModalTitle = normalizeModalTitle(modal_title);
  // Дефолт при создании — активно (если поле не передано).
  const normalizedActive = is_active === undefined ? 1 : normalizeIsActive(is_active);
  const normalizedOrder = normalizeSortOrder(sort_order);
  const result = db
    .prepare(
      `INSERT INTO agreements (title, body, modal_title, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(normalizedTitle, normalizedBody, normalizedModalTitle, normalizedActive, normalizedOrder);
  return getAgreementById(result.lastInsertRowid);
}

export function updateAgreement(id, payload = {}) {
  const numericId = Number(id);
  const existing = getAgreementById(numericId);
  if (!existing) {
    const err = new Error('agreement_not_found');
    err.code = 'agreement_not_found';
    throw err;
  }
  // Patch-семантика: трогаем только переданные поля, остальные оставляем как
  // есть. Это совпадает с поведением остальных admin endpoints проекта.
  const nextTitle = payload.title !== undefined ? normalizeTitleOrThrow(payload.title) : existing.title;
  const nextBody = payload.body !== undefined ? normalizeBody(payload.body) : existing.body;
  const nextModalTitle =
    payload.modal_title !== undefined
      ? normalizeModalTitle(payload.modal_title)
      : existing.modal_title || null;
  const nextActive =
    payload.is_active !== undefined ? normalizeIsActive(payload.is_active) : existing.is_active;
  const nextOrder =
    payload.sort_order !== undefined ? normalizeSortOrder(payload.sort_order) : existing.sort_order;
  db.prepare(
    `UPDATE agreements
        SET title = ?, body = ?, modal_title = ?, is_active = ?, sort_order = ?, updated_at = DATETIME('now')
      WHERE id = ?`,
  ).run(nextTitle, nextBody, nextModalTitle, nextActive, nextOrder, numericId);
  return getAgreementById(numericId);
}

export function deleteAgreement(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return 0;
  const result = db.prepare(`DELETE FROM agreements WHERE id = ?`).run(numericId);
  return result.changes;
}

/**
 * Валидирует, что клиент принял ВСЕ активные соглашения.
 *
 * @param {Array<number|string>|undefined} acceptedIds — id, переданные в payload
 * @returns {{ ok: boolean, missing: Array<{id:number,title:string}> }}
 */
export function validateAcceptedAgreementIds(acceptedIds) {
  const active = listActiveAgreements();
  if (active.length === 0) {
    // Соглашений нет — клиент ничего не должен принимать.
    return { ok: true, missing: [] };
  }
  const acceptedSet = new Set(
    Array.isArray(acceptedIds)
      ? acceptedIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [],
  );
  const missing = active.filter((a) => !acceptedSet.has(a.id));
  return {
    ok: missing.length === 0,
    missing: missing.map((a) => ({ id: a.id, title: a.title })),
  };
}

/**
 * Строит snapshot для orders.accepted_agreements (JSON-text). Сохраняем
 * именно тот текст, который клиент видел — если в админке потом отредактируют
 * body, история не потеряется.
 */
export function buildAcceptedSnapshot(acceptedIds) {
  const active = listActiveAgreements();
  if (active.length === 0) return null;
  const acceptedSet = new Set(
    Array.isArray(acceptedIds)
      ? acceptedIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [],
  );
  const items = active
    .filter((a) => acceptedSet.has(a.id))
    .map((a) => ({
      id: a.id,
      title: a.title,
      modal_title: a.modal_title || null,
      body: a.body,
    }));
  if (items.length === 0) return null;
  return JSON.stringify({
    accepted_at: new Date().toISOString(),
    items,
  });
}
