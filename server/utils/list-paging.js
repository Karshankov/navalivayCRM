import { db } from '../db.js';

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;

/** Читает limit/offset/q из query-строки. paged=true, если задан хотя бы один параметр. */
export function parseListPaging(query = {}) {
  const hasAny = ['limit', 'offset', 'q'].some((key) => query[key] !== undefined);
  let limit = Number.parseInt(String(query.limit ?? ''), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = LIST_DEFAULT_LIMIT;
  limit = Math.min(limit, LIST_MAX_LIMIT);
  let offset = Number.parseInt(String(query.offset ?? ''), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  const q = String(query.q ?? '').trim().replace(/^@+/, '').slice(0, 64);
  return { paged: hasAny, limit, offset, q };
}

function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * Серверная пагинация поверх внутреннего SELECT.
 * innerSql — запрос с псевдонимами колонок; searchColumns — SQL-выражения над
 * этими псевдонимами, по которым ищем подстроку q (без учёта регистра).
 */
export function runPagedQuery(innerSql, params, { limit, offset, q }, { searchColumns, orderBy }) {
  const where = q && searchColumns.length
    ? `WHERE ${searchColumns.map((col) => `CAST(${col} AS TEXT) LIKE @like ESCAPE '\\'`).join(' OR ')}`
    : '';
  const bind = { ...params };
  if (q) bind.like = likePattern(q);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${innerSql}) ${where}`).get(bind).n;
  const items = db.prepare(
    `SELECT * FROM (${innerSql}) ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`,
  ).all({ ...bind, limit, offset });
  return { items, total: Number(total), limit, offset };
}
