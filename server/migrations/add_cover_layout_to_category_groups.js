import { db } from '../db.js';

/**
 * Расположение обложки линейки в карточке.
 *
 * Фотографии приходят от поставщиков в разных пропорциях: квадратные,
 * вытянутые, широкие. Автоподбор масштаба годится для большинства, но
 * у части линеек сотрудник видит в превью, что крупнее или мельче
 * получится лучше. Раньше поправить это было нечем — фото показывалось
 * как есть.
 *
 * cover_zoom — множитель к подобранному масштабу, в процентах: 100
 * значит «как подобрал алгоритм». cover_rotate — наклон в градусах,
 * 0 значит «без наклона». Обе колонки необязательные: NULL читается
 * как значения по умолчанию, поэтому старые линейки не меняются.
 */
export function migrateCategoryGroupCoverLayout() {
  const columns = db.prepare('PRAGMA table_info(category_groups)').all();
  const names = new Set(columns.map((c) => c.name));

  if (!names.has('cover_zoom')) {
    db.exec('ALTER TABLE category_groups ADD COLUMN cover_zoom INTEGER');
    console.log('[migration] Added cover_zoom to category_groups');
  }

  /* Изначально колонка называлась cover_rotate: планировался доворот
     фото. По факту сотруднику нужен сдвиг вбок — то же поле, другой
     смысл. Переименовываем, чтобы имя не врало. Если колонки ещё нет,
     создаём сразу с новым именем. */
  if (!names.has('cover_shift')) {
    if (names.has('cover_rotate')) {
      db.exec('ALTER TABLE category_groups RENAME COLUMN cover_rotate TO cover_shift');
      console.log('[migration] Renamed cover_rotate to cover_shift in category_groups');
    } else {
      db.exec('ALTER TABLE category_groups ADD COLUMN cover_shift INTEGER');
      console.log('[migration] Added cover_shift to category_groups');
    }
  }
}
