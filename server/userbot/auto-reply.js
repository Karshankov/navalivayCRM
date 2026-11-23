/**
 * Автоответы на входящие сообщения клиентов через userbot.
 *
 * Почему это отдельно от bot.js
 * -----------------------------
 * В bot.js автоответы привязаны к апдейту `business_message`, который Telegram
 * присылает только при активном подключении Telegram Business. У аккаунта
 * менеджера (@Rez0nsky) переписка идёт через userbot, и у таких сообщений
 * business_connection_id пустой — обработчик в bot.js выходит на первой же
 * проверке и до логики ответа не доходит.
 *
 * Поэтому решение об ответе принимается здесь: входящие сообщения, которые
 * видит userbot, уже содержат всё нужное.
 *
 * Само решение НЕ дублируется: тумблер, опознание клиента, поиск правила и
 * пауза целиком отданы handleIncomingBusinessMessage — той же функции, что
 * использует Business-путь. Здесь только транспорт: входящее сообщение и
 * отправка ответа.
 *
 * Модуль вынесен из index.js намеренно: index.js при импорте сразу поднимает
 * HTTP-сервер, поэтому протестировать логику оттуда нельзя.
 */
import {
  handleIncomingBusinessMessage,
  tryStartAutoReply,
  finishAutoReply,
  logBotMessage,
  AUTO_REPLY_MESSAGE_TYPE,
} from '../utils/business-bot.js';
import { sendViaUserbot } from '../utils/userbot-client.js';

/**
 * Принять решение об автоответе и отправить его.
 *
 * @param {object} params
 * @param {string} params.chatId — id переписки в Telegram (совпадает с telegram_id клиента)
 * @param {string} params.fromUserId — автор сообщения
 * @param {string|null} params.ownerUserId — владелец аккаунта (myUserId в userbot):
 *   на его собственные сообщения бот не отвечает
 * @param {string} params.text — текст входящего
 * @param {object} [deps] — подмена зависимостей для тестов
 * @returns {Promise<{outcome: string, text?: string, title?: string}|null>}
 *   null — отвечать не нужно (выключено, не наш случай, нет правила, пауза)
 */
export async function processIncomingAutoReply(
  { chatId, fromUserId, ownerUserId, text },
  deps = {},
) {
  const {
    decide = handleIncomingBusinessMessage,
    send = sendViaUserbot,
    log = logBotMessage,
    start = tryStartAutoReply,
    finish = finishAutoReply,
  } = deps;

  const reply = decide({
    businessConnectionId: null,
    fromUserId,
    ownerUserId,
    text,
  });
  if (!reply) return null;

  // Блокировка на время отправки: пауза читается из журнала, а запись туда
  // идёт только после отправки. Без неё два сообщения подряд дали бы два
  // одинаковых ответа.
  if (!start(fromUserId)) return null;

  try {
    // Отправка идёт через HTTP-эндпоинт userbot: там уже собраны три попытки
    // доставки (кэш entity → сохранённый access_hash → prefetch), общий
    // лимитер и защита от FloodWait. Вызывать client.sendMessage отсюда
    // напрямую значило бы продублировать всё это и разойтись с ним.
    const result = await send({
      chatId,
      text: reply.text,
      username: reply.customerUsername || null,
      auto: true,
    });

    // 'ambiguous' — ответ мог уйти, а подтверждение потерялось. Повторять
    // нельзя: клиент получит два одинаковых сообщения. Пауза его не считает.
    const outcome = result.ok ? 'sent' : result.outcome === 'ambiguous' ? 'ambiguous' : 'failed';

    log({
      businessConnectionId: null,
      chatId,
      customerId: reply.customerId ?? null,
      customerTelegramId: fromUserId,
      direction: 'out',
      messageType: AUTO_REPLY_MESSAGE_TYPE,
      templateKind: reply.templateKind,
      templateId: reply.templateId,
      text: reply.text,
      meta: {
        quick_reply_title: reply.quickReplyTitle,
        via: 'userbot-listener',
        // Именно outcome='sent' считает пауза. Провал не должен глушить
        // следующие ответы на полчаса — клиент ответа не получил.
        outcome,
        error: result.ok ? null : String(result.error || ''),
      },
    });

    return {
      outcome,
      text: reply.text,
      title: reply.quickReplyTitle,
      error: result.ok ? null : String(result.error || ''),
    };
  } finally {
    // Всегда освобождаем: иначе после первой же ошибки клиент останется
    // «занятым» до перезапуска и автоответов больше не получит.
    finish(fromUserId);
  }
}
