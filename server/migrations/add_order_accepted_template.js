import { db } from '../db.js';

/**
 * Шаблон «заказ принят» для постоянных клиентов при оформлении через mini-app.
 * INSERT OR IGNORE — безопасно на prod, не перезаписывает кастомные правки.
 */
export function migrateOrderAcceptedTemplate() {
  const tableExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bot_status_templates' LIMIT 1",
    )
    .get();
  if (!tableExists) {
    return;
  }

  db.prepare(
    `INSERT OR IGNORE INTO bot_status_templates (event, title, body, is_active)
     VALUES (?, ?, ?, 1)`,
  ).run(
    'order_accepted',
    'Заказ принят',
    'Добрый день, заказ принят и его уже собирают. Как всё будет готово — вышлю код для получения сюда.\n'
      + 'Сумма: {final_amount} BYN.',
  );
}
