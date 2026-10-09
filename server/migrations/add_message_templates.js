import { db } from '../db.js';

export function migrateMessageTemplates() {
  try {
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='message_templates'
    `).get();

    if (tableExists) {
      console.log('[migration] message_templates table already exists, skipping');
      return;
    }

    console.log('[migration] Creating message_templates table');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'order_contact',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
        updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_message_templates_type ON message_templates(type);
      CREATE INDEX IF NOT EXISTS idx_message_templates_active ON message_templates(active);
    `);

    // Создаём шаблон по умолчанию для связи с клиентом по заказу
    const defaultTemplateId = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO message_templates (id, name, content, type, active)
      VALUES (?, ?, ?, 'order_contact', 1)
    `).run(
      defaultTemplateId,
      'Связь с клиентом по заказу',
      `Привет! Пишу по поводу твоего заказа #[order_number].

Состав заказа:
[items]

К оплате: [total] BYN

Адрес доставки: [address]
Телефон: [phone]

Свяжись со мной для уточнения деталей!`
    );

    console.log('[migration] message_templates table created successfully with default template');
  } catch (error) {
    console.error('[migration] message_templates migration failed:', error);
    if (!String(error.message).includes('already exists')) {
      throw error;
    }
  }
}
