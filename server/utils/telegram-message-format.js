/**
 * Общие правила форматирования сообщений между API и userbot.
 *
 * Режим не включается глобально: ручные сообщения отправляются как обычный
 * текст, а HTML явно запрашивают только шаблонные уведомления.
 */
export const TELEGRAM_HTML_PARSE_MODE = 'html';

export function normalizeTelegramParseMode(value) {
  if (value === undefined || value === null) return null;
  if (value === TELEGRAM_HTML_PARSE_MODE) return value;

  const error = new Error('invalid_parse_mode');
  error.code = 'invalid_parse_mode';
  throw error;
}

/** Сохраняет жирный текст в старых шаблонах после перехода с Markdown на HTML. */
export function convertLegacyTelegramMarkup(value) {
  return String(value ?? '').replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
}

/** Экранирует только подставляемые данные, не затрагивая теги шаблона. */
export function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
