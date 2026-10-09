import { db } from '../db.js';

/**
 * Парковка category_groups по наличию.
 *
 * Идея: когда все товары линейки уходят в out-of-stock, её позиция [order]
 * "замораживается" — фиксируется в parked_order. Пока линейка пустая,
 * её [order] нельзя сдвинуть. Как только в линейке снова появляется товар,
 * она восстанавливает своё [order] из parked_order (со сдвигом соседей).
 *
 * Тем самым серые линейки не могут "уехать в конец списка" из-за случайного
 * drag-n-drop в админке и возвращаются на прежнее место, когда товар завозят.
 *
 * Считаем "пустой" только по СОБСТВЕННЫМ товарам линейки (без дочерних).
 * Дочерние группы парковаться будут сами через свою собственную логику.
 * Это согласовано с тем, что витрина скрывает линейки именно по признаку
 * "в самой линейке 0 товаров в наличии".
 *
 * NB: `empty_since` хранит ДАТУ ухода в простой (для UI-плашки "X дней пусто").
 * `parked_order` хранит ПОЗИЦИЮ. Поля независимы, живут параллельно.
 */

/**
 * Посчитать суммарный остаток по собственным товарам группы.
 * Учитываем товары с вариантами (суммируем stock вариантов).
 */
export function computeGroupOwnStock(groupId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN p.has_variants = 1 THEN (SELECT COALESCE(SUM(pv.stock), 0) FROM product_variants pv WHERE pv.product_id = p.id)
        ELSE COALESCE(p.stock, 0)
      END
    ), 0) AS totalStock
    FROM products p
    WHERE p.groupId = ?
  `).get(String(groupId));
  return Number(row?.totalStock ?? 0);
}

/**
 * Вставить линейку `groupId` на позицию `targetOrder`, сдвинув соседей на +1.
 * Сдвигает также parked_order у соседей, у которых он установлен, чтобы
 * инвариант "parked_order соответствует актуальной нумерации активного списка"
 * сохранялся для всех замороженных линеек категории.
 *
 * Вызывается под транзакцией.
 */
function insertWithShift(groupId, categoryId, targetOrder) {
  // Сдвигаем всех в категории, у кого [order] >= targetOrder, кроме нас
  db.prepare(`
    UPDATE category_groups
    SET
      [order] = [order] + 1,
      parked_order = CASE WHEN parked_order IS NOT NULL THEN parked_order + 1 ELSE NULL END,
      updatedAt = DATETIME('now')
    WHERE categoryId = ?
      AND [order] >= ?
      AND id != ?
  `).run(String(categoryId), Number(targetOrder), String(groupId));

  db.prepare(`
    UPDATE category_groups
    SET [order] = ?, parked_order = NULL, updatedAt = DATETIME('now')
    WHERE id = ?
  `).run(Number(targetOrder), String(groupId));
}

/**
 * Синхронизировать состояние парковки одной линейки.
 * Вызывается из lazy-sync в админском GET /api/admin/category-groups
 * и напрямую после операций, явно меняющих stock (create/update/delete product etc).
 *
 * @param {string} groupId
 * @returns {{changed: boolean, action: 'parked'|'restored'|'noop'}}
 */
export function syncGroupParking(groupId) {
  const group = db.prepare(`
    SELECT id, categoryId, [order] AS currentOrder, parked_order AS parkedOrder
    FROM category_groups WHERE id = ?
  `).get(String(groupId));

  if (!group) return { changed: false, action: 'noop' };

  const totalStock = computeGroupOwnStock(groupId);

  if (totalStock === 0) {
    // Если ещё не в парковке — запомним текущий order
    if (group.parkedOrder == null) {
      db.prepare(`
        UPDATE category_groups
        SET parked_order = ?, updatedAt = DATETIME('now')
        WHERE id = ?
      `).run(Number(group.currentOrder ?? 0), String(groupId));
      return { changed: true, action: 'parked' };
    }
    return { changed: false, action: 'noop' };
  }

  // totalStock > 0
  if (group.parkedOrder != null) {
    // Восстанавливаем линейку на её замороженную позицию
    const targetOrder = Number(group.parkedOrder);
    // Если текущий [order] совпадает с parked_order — ничего двигать не надо,
    // просто снимаем парковку
    if (Number(group.currentOrder ?? 0) === targetOrder) {
      db.prepare(`
        UPDATE category_groups
        SET parked_order = NULL, updatedAt = DATETIME('now')
        WHERE id = ?
      `).run(String(groupId));
      return { changed: true, action: 'restored' };
    }
    const tx = db.transaction(() => {
      insertWithShift(String(groupId), String(group.categoryId), targetOrder);
    });
    tx();
    return { changed: true, action: 'restored' };
  }

  return { changed: false, action: 'noop' };
}

/**
 * Массовый синк по всем группам (используется в lazy-sync GET админки).
 * Принимает уже посчитанный массив [{ id, totalStockSum, parked_order, order, categoryId }, ...]
 * из enriched listing, чтобы не делать двойной запрос.
 *
 * @param {Array<{id:string, categoryId:string, order:number, totalStockSum:number, parked_order:number|null}>} flattened
 */
export function syncParkingFromFlattened(flattened) {
  // Работаем по актуальному состоянию БД, а не только по переданному массиву —
  // после каждого restore соседи сдвигаются, и их данные в массиве устаревают.
  // Но "ушёл в парковку" — безопасно обрабатывать батчем, т.к. не меняет [order].

  // Шаг 1: парковка (стал пустым, parked_order ещё не выставлен) — бесконфликтно.
  flattened.forEach((group) => {
    if (Number(group.totalStockSum ?? 0) === 0 && group.parked_order == null) {
      db.prepare(`
        UPDATE category_groups
        SET parked_order = ?, updatedAt = DATETIME('now')
        WHERE id = ?
      `).run(Number(group.order ?? 0), String(group.id));
      group.parked_order = Number(group.order ?? 0);
    }
  });

  // Шаг 2: восстановление (стал непустым, parked_order был выставлен) — может менять
  // [order] у соседей, поэтому после каждого restore переменные в массиве могут
  // рассинхронизироваться. Делаем точечные вызовы syncGroupParking — он читает
  // актуальный стейт из БД.
  flattened.forEach((group) => {
    if (Number(group.totalStockSum ?? 0) > 0 && group.parked_order != null) {
      syncGroupParking(group.id);
    }
  });
}
