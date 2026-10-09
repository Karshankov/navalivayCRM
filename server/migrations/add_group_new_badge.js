import { db } from '../db.js';

/**
 * Метка «новинка» у линейки.
 *
 * Пока `new_until` в будущем, витрина ставит линейку первой в разделе и рисует
 * плашку. Дальше линейка сортируется по своему обычному `[order]` и сама
 * возвращается на прежнее место.
 *
 * Позицию намеренно храним НЕ здесь: если писать закреплённой линейке
 * `[order] = 0`, её сдвинет `insertWithShift` из group-parking.js вместе с
 * соседями, а перетаскивание линеек в админке (PATCH /reorder) затрёт исходную
 * позицию, и возвращать будет некуда.
 *
 * `new_since` нужна отдельно от `new_until`: по ней несколько новинок в одном
 * разделе выстраиваются свежей выше, а правка срока не сдвигает начало отсчёта.
 *
 * Миграция идемпотентна, чтобы безопасно запускаться при каждом старте API.
 */
export function migrateGroupNewBadge() {
  const columns = db.prepare('PRAGMA table_info(category_groups)').all();
  const hasColumn = (name) => columns.some((column) => column.name === name);

  if (!hasColumn('new_since')) {
    db.exec('ALTER TABLE category_groups ADD COLUMN new_since TEXT');
    console.log('[migration] Added category_groups.new_since');
  }

  if (!hasColumn('new_until')) {
    db.exec('ALTER TABLE category_groups ADD COLUMN new_until TEXT');
    console.log('[migration] Added category_groups.new_until');
  }
}
