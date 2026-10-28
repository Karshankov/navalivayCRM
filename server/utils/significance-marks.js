import { db } from '../db.js';
import { sanitizeDetailHtml } from './sanitize-html.js';

/**
 * Пометки значимости линеек: серверные правила и запросы.
 *
 * Пометка — это настраиваемый ярлык линейки («Социально значимый товар»):
 * внешний вид блока в мини-аппе, текст «Подробнее» и шаблон сообщения,
 * которое уходит клиенту через 10 минут после выдачи заказа с этим товаром.
 *
 * Модуль держит валидацию и выборки, маршруты в admin.js / public.js
 * остаются тонкими обёртками.
 */

/**
 * Иконка пометки — загруженная менеджером картинка (data:image/…;base64, WebP
 * после конвертации). Ограничиваем только размером: блок маленький.
 */
const MAX_ICON_BYTES = 512 * 1024;

function isValidIconImage(icon) {
  if (typeof icon !== 'string') return false;
  if (!icon.startsWith('data:image/')) return false;
  const match = icon.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) return false;
  return Buffer.byteLength(match[1], 'base64') <= MAX_ICON_BYTES;
}

const MAX_TITLE = 80;
const MAX_DESCRIPTION = 300;
const MAX_NOTIFY_TEXT = 2000;
const MAX_DETAIL_TITLE = 120;
const MAX_DETAIL_BODY = 5000;
const MAX_BUTTON_TEXT = 60;
const MAX_URL = 500;

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Код пометки из названия: транслит не нужен, slugify уже есть в проекте,
 *  но здесь достаточно простой нормализации — код технический, наружу
 *  показывается только название. */
function buildCode(title, attempt = 0) {
  const base = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'mark';
  return attempt > 0 ? `${base}-${attempt}` : base;
}

function uniqueCode(title) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = buildCode(title, attempt);
    const taken = db.prepare('SELECT 1 FROM significance_marks WHERE code = ?').get(code);
    if (!taken) return code;
  }
  return `mark-${Date.now()}`;
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}

function cleanText(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return text.slice(0, max);
}

/** Разбор и валидация тела создания/обновления. Бросает { code, status }. */
export async function validateSignificanceMarkPayload(body, { partial = false } = {}) {
  const source = body || {};

  const result = {};

  if (!partial || 'title' in source) {
    const title = typeof source.title === 'string' ? source.title.trim().slice(0, MAX_TITLE) : '';
    if (!title) throw Object.assign(new Error('title_required'), { status: 400 });
    result.title = title;
  }

  if (!partial || 'description' in source) {
    result.description = cleanText(source.description, MAX_DESCRIPTION);
  }

  // Внутренняя заметка: видна только менеджерам (различать одинаковые
  // пометки), клиенту не показывается никогда.
  if (!partial || 'adminNote' in source || 'admin_note' in source) {
    result.adminNote = cleanText(source.adminNote ?? source.admin_note, 120);
  }

  if (!partial || 'icon' in source) {
    const icon = typeof source.icon === 'string' ? source.icon.trim() : '';
    if (!isValidIconImage(icon)) {
      // 512 КБ после конвертации в WebP хватает с запасом для иконки блока.
      throw Object.assign(new Error('invalid_icon'), { status: 400 });
    }
    result.icon = icon;
  }

  if (!partial || 'color' in source) {
    const color = typeof source.color === 'string' ? source.color.trim() : '';
    if (!isHexColor(color)) {
      throw Object.assign(new Error('invalid_color'), { status: 400 });
    }
    result.color = color.toLowerCase();
  }

  if (!partial || 'detailTitle' in source || 'detail_title' in source) {
    result.detailTitle = cleanText(source.detailTitle ?? source.detail_title, MAX_DETAIL_TITLE);
  }

  if (!partial || 'detailBody' in source || 'detail_body' in source) {
    // Текст «Подробнее» — HTML из визуального редактора: чистим до белого
    // списка тегов (жирный, курсив, списки, картинки и т.д.).
    const html = await sanitizeDetailHtml(source.detailBody ?? source.detail_body);
    const textOnly = String(html || '').replace(/<[^>]+>/g, '');
    if (textOnly.length > MAX_DETAIL_BODY) {
      throw Object.assign(new Error('invalid_detail_body'), { status: 400 });
    }
    result.detailBody = html;
  }

  if (!partial || 'detailButtonText' in source || 'detail_button_text' in source) {
    const button = cleanText(
      source.detailButtonText ?? source.detail_button_text,
      MAX_BUTTON_TEXT,
    );
    result.detailButtonText = button;
  }

  if (!partial || 'detailUrl' in source || 'detail_url' in source) {
    const url = typeof (source.detailUrl ?? source.detail_url) === 'string'
      ? String(source.detailUrl ?? source.detail_url).trim()
      : '';
    if (url) {
      if (url.length > MAX_URL || !/^https?:\/\//i.test(url)) {
        throw Object.assign(new Error('invalid_detail_url'), { status: 400 });
      }
      result.detailUrl = url;
    } else {
      result.detailUrl = null;
    }
  }

  if (!partial || 'notifyText' in source || 'notify_text' in source) {
    result.notifyText = cleanText(source.notifyText ?? source.notify_text, MAX_NOTIFY_TEXT);
  }

  if (!partial || 'active' in source) {
    result.active = source.active === undefined ? 1 : (source.active ? 1 : 0);
  }

  if (!partial || 'sortOrder' in source || 'sort_order' in source) {
    const raw = source.sortOrder ?? source.sort_order;
    const parsed = Math.trunc(Number(raw ?? 0));
    result.sortOrder = Number.isFinite(parsed) ? Math.max(0, Math.min(999, parsed)) : 0;
  }

  return result;
}

/** Пометка для наружных ответов: camelCase, как остальное API. */
export function serializeSignificanceMark(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description ?? null,
    adminNote: row.admin_note ?? null,
    icon: row.icon,
    color: row.color,
    detailTitle: row.detail_title ?? null,
    detailBody: row.detail_body ?? null,
    detailButtonText: row.detail_button_text ?? null,
    detailUrl: row.detail_url ?? null,
    notifyText: row.notify_text ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSignificanceMarks({ includeInactive = true } = {}) {
  const rows = includeInactive
    ? db.prepare('SELECT * FROM significance_marks ORDER BY sort_order ASC, created_at ASC').all()
    : db.prepare('SELECT * FROM significance_marks WHERE active = 1 ORDER BY sort_order ASC, created_at ASC').all();
  return rows.map(serializeSignificanceMark);
}

export function getSignificanceMark(id) {
  const row = db.prepare('SELECT * FROM significance_marks WHERE id = ?').get(String(id || ''));
  return row ? serializeSignificanceMark(row) : null;
}

export function createSignificanceMark(payload) {
  const id = generateId('sigm');
  const code = uniqueCode(payload.title);
  db.prepare(`
    INSERT INTO significance_marks (
      id, code, title, description, admin_note, icon, color,
      detail_title, detail_body, detail_button_text, detail_url,
      notify_text, active, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    code,
    payload.title,
    payload.description ?? null,
    payload.adminNote ?? null,
    payload.icon,
    payload.color,
    payload.detailTitle ?? null,
    payload.detailBody ?? null,
    payload.detailButtonText ?? 'Подробнее',
    payload.detailUrl ?? null,
    payload.notifyText ?? null,
    payload.active ?? 1,
    payload.sortOrder ?? 0,
  );
  return getSignificanceMark(id);
}

export function updateSignificanceMark(id, payload) {
  const current = db.prepare('SELECT * FROM significance_marks WHERE id = ?').get(String(id));
  if (!current) return null;

  const fields = [];
  const values = [];
  const map = {
    title: 'title',
    description: 'description',
    icon: 'icon',
    color: 'color',
    detailTitle: 'detail_title',
    adminNote: 'admin_note',
    detailBody: 'detail_body',
    detailButtonText: 'detail_button_text',
    detailUrl: 'detail_url',
    notifyText: 'notify_text',
    active: 'active',
    sortOrder: 'sort_order',
  };
  for (const [key, column] of Object.entries(map)) {
    if (key in payload) {
      fields.push(`${column} = ?`);
      values.push(payload[key] === undefined ? null : payload[key]);
    }
  }
  if (fields.length > 0) {
    fields.push('updated_at = DATETIME(\'now\')');
    db.prepare(`UPDATE significance_marks SET ${fields.join(', ')} WHERE id = ?`).run(
      ...values,
      String(id),
    );
  }
  return getSignificanceMark(id);
}

/**
 * Удаление пометки: со всех линеек она снимается сама (ON DELETE SET NULL),
 * а очередь уведомлений чистим явно — отправлять сообщение несуществующей
 * пометки нельзя, а текст нужно читать в момент отправки.
 */
export function deleteSignificanceMark(id) {
  const current = db.prepare('SELECT id FROM significance_marks WHERE id = ?').get(String(id));
  if (!current) return false;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM significance_notify_queue WHERE mark_id = ? AND status = \'pending\'')
      .run(String(id));
    db.prepare('UPDATE significance_notify_queue SET status = \'skipped\', reason = \'mark_deleted\', updated_at = DATETIME(\'now\') WHERE mark_id = ? AND status != \'pending\'')
      .run(String(id));
    db.prepare('DELETE FROM significance_marks WHERE id = ?').run(String(id));
  });
  tx();
  return true;
}

/**
 * Краткая форма пометки для витрины: без текстов сообщений и служебных полей.
 * admin_note — только для менеджеров, наружу не уходит.
 */
function serializePublicMark(row) {
  return {
    code: row.code,
    title: row.title,
    description: row.description ?? null,
    icon: row.icon,
    color: row.color,
    detailTitle: row.detail_title ?? null,
    detailBody: row.detail_body ? true : false,
    detailButtonText: row.detail_button_text ?? 'Подробнее',
    detailUrl: row.detail_url ?? null,
  };
}

/**
 * Публичный каталог пометок по списку id линеек: одна выборка на страницу,
 * чтобы витрина не делала запрос на каждую группу.
 */
export function getPublicMarksByGroupIds(groupIds) {
  const ids = (groupIds || []).map(String).filter(Boolean);
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT g.id AS group_id, m.*
    FROM category_groups g
    JOIN significance_marks m ON m.id = g.significance_mark_id AND m.active = 1
    WHERE g.id IN (${placeholders})
  `).all(...ids);
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.group_id), serializePublicMark(row));
  }
  return map;
}

/** Публичные данные пометки по коду (для модалки «Подробнее»). */
export function getPublicMarkByCode(code) {
  const row = db.prepare(
    'SELECT * FROM significance_marks WHERE code = ? AND active = 1',
  ).get(String(code || ''));
  if (!row) return null;
  return {
    code: row.code,
    title: row.title,
    description: row.description ?? null,
    icon: row.icon,
    color: row.color,
    detailTitle: row.detail_title ?? null,
    detailBody: row.detail_body ?? null,
    detailButtonText: row.detail_button_text ?? 'Подробнее',
    detailUrl: row.detail_url ?? null,
  };
}
