import { db } from '../db.js';

/**
 * Расположение обложки линейки: вертикальный сдвиг и ручной режим.
 *
 * До этой миграции сотрудник мог только увеличить фото и подвинуть его
 * вбок. Вертикали не было, а масштаб всегда считался автоматом: он
 * подбирал кадр сам и сдвигал фото влево-вниз. Из-за этого в окне
 * предпросмотра лежал не тот кадр, который сотрудник собирался задать,
 * и «опустить фото пониже» сделать было нельзя вообще.
 *
 * cover_offset_y — сдвиг по вертикали в процентах от высоты области:
 * минус вверх, плюс вниз. NULL значит «правок нет», как и у соседних
 * колонок, поэтому старые линейки не меняются.
 *
 * cover_manual — признак, что сотрудник настроил кадр руками и автоподбор
 * для этой линейки не применяется: иначе ручные правки складывались бы с
 * автоматическими и фото уезжало уже после сохранения. NULL и 0 читаются
 * как «работает автоподбор» — то есть прежнее поведение.
 */
export function migrateCategoryGroupCoverOffset() {
  const columns = db.prepare('PRAGMA table_info(category_groups)').all();
  const names = new Set(columns.map((c) => c.name));

  if (!names.has('cover_offset_y')) {
    db.exec('ALTER TABLE category_groups ADD COLUMN cover_offset_y INTEGER');
    console.log('[migration] Added cover_offset_y to category_groups');
  }

  if (!names.has('cover_manual')) {
    db.exec('ALTER TABLE category_groups ADD COLUMN cover_manual INTEGER');
    console.log('[migration] Added cover_manual to category_groups');
  }
}
