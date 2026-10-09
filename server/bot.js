import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { db } from './db.js';
import {
  registerBusinessConnection,
  removeBusinessConnection,
  handleIncomingBusinessMessage,
  logBotMessage,
} from './utils/business-bot.js';
import { resolveUsernameViaUserbot } from './utils/userbot-client.js';
import {
  attachFirstOrderToReferral,
  authorizeCustomerWithoutReferral,
  getReferralOrderCreationGate,
} from './utils/referral-authorization.js';
import { assignLowestAvailablePickupCell } from './utils/pickup-cells.js';
import { applyDiscountToPrice, resolveDiscountPrice } from './utils/catalog-discounts.js';
import { roundMoney } from './utils/money.js';

// Singleton прокси-агент для long-polling. См. комментарий ниже у Telegraf
// init: на RU-хостинге без прокси bot не получает business updates.
const botProxyAgent = (() => {
  const url = (process.env.TELEGRAM_HTTP_PROXY || '').trim();
  if (!url) return null;
  try {
    return new HttpsProxyAgent(url);
  } catch (err) {
    console.error('[navalivay:bot] не удалось создать proxy agent:', err?.message);
    return null;
  }
})();

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNextNumber(table, field) {
  const row = db.prepare(`SELECT MAX(${field}) as maxNum FROM ${table}`).get();
  return (row?.maxNum || 0) + 1;
}

function extractProductId(link) {
  try {
    const url = new URL(link);
    const match = url.pathname.match(/\/p\/(\d+)/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

/** HTTPS URL витрины для web_app кнопок и меню (как в BotFather). Оптовые t.me ссылки с mode=compact — во фронте.
 *
 * Дефолт здесь боевой, и на старте бот вызывает setChatMenuButton с этим
 * адресом. Значит любой запуск bot.js с чужим или скопированным BOT_TOKEN и
 * пустым BASE_URL перепишет кнопку меню тому боту, чей токен взяли, и уведёт его
 * пользователей на боевую витрину. На тестовых стендах bot.js лучше не
 * запускать вовсе: кнопка Mini App настраивается один раз в BotFather и живёт
 * без процесса.
 */
function getStoreWebAppUrl() {
  return (process.env.BASE_URL || "https://navalivay.store").replace(/\/$/, "");
}

function ensureCustomer(telegramUser) {
  const telegramId = String(telegramUser.id);
  let customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId);

  if (!customer) {
    const id = generateId('cust');
    db.prepare(`
      INSERT INTO customers (
        id, telegram_id, telegram_username, first_name, last_name,
        total_orders, total_spent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, DATETIME('now'), DATETIME('now'))
    `).run(
      id,
      telegramId,
      telegramUser.username ?? null,
      telegramUser.first_name ?? null,
      telegramUser.last_name ?? null
    );
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);

    // Проактивный резолв: новый клиент ещё не в кэше userbot'а.
    // Зарезолвим сейчас — к моменту заказа entity уже готова.
    if (telegramUser.username) {
      resolveUsernameViaUserbot({
        username: telegramUser.username,
        expectedTelegramId: telegramId,
      }).catch(() => {});
    }
  } else {
    db.prepare(`
      UPDATE customers
      SET telegram_username = ?,
          first_name = ?,
          last_name = ?,
          updated_at = DATETIME('now')
      WHERE id = ?
    `).run(
      telegramUser.username ?? customer.telegram_username ?? null,
      telegramUser.first_name ?? customer.first_name ?? null,
      telegramUser.last_name ?? customer.last_name ?? null,
      customer.id
    );
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
  }

  return customer;
}

function isDuplicateOrder(customerId, productId) {
  if (!customerId) return false;
  const recent = db.prepare(`
    SELECT id FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.customer_id = ?
      AND oi.product_id = ?
      AND o.created_at >= DATETIME('now', '-2 minute')
    ORDER BY o.created_at DESC
    LIMIT 1
  `).get(customerId, productId);
  return Boolean(recent);
}

export function createOrderFromBot({ customerId, product, quantity, telegramMessageId, originalMessage }) {
  const orderId = generateId('order');
  const orderNumber = getNextNumber('orders', 'order_number');
  // Витрина уже назвала покупателю цену со скидкой, и именно её он написал в
  // сообщении: без этого ему показали бы 15, а списали 20.
  const basePricePerUnit = Number(product.priceRub) || 0;
  const pricePerUnit = applyDiscountToPrice(
    basePricePerUnit,
    resolveDiscountPrice({ productId: product.id, groupId: product.groupId }),
  );
  const costPerUnit = Number(product.cost_price) || 0;
  const totalAmount = pricePerUnit * quantity;
  const totalCost = costPerUnit * quantity;
  const finalAmount = totalAmount;
  const profit = finalAmount - totalCost;

  const tx = db.transaction(() => {
    const currentCustomer = customerId
      ? db.prepare('SELECT telegram_id FROM customers WHERE id = ?').get(customerId)
      : null;
    const currentGate = getReferralOrderCreationGate(String(currentCustomer?.telegram_id || ''));
    if (!currentGate.allowed) {
      const error = new Error(currentGate.reason || 'authorization_required');
      error.code = currentGate.reason || 'authorization_required';
      throw error;
    }
    if (customerId && !currentGate.status.enabled) {
      authorizeCustomerWithoutReferral(customerId, 'feature_disabled');
    }

    const latest = db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id);
    const latestStock = typeof latest?.stock === 'number' ? latest.stock : 0;
    if (latestStock < quantity) {
      throw new Error('insufficient_stock');
    }

    db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, status, delivery_type, delivery_address,
        total_amount, discount_amount, discount_percent, final_amount, profit, notes
      ) VALUES (?, ?, ?, 'new', 'pickup', NULL, ?, 0, 0, ?, ?, ?)
    `).run(
      orderId,
      orderNumber,
      customerId || null,
      totalAmount,
      finalAmount,
      profit,
      [`Создан через Telegram-бот`, `ID сообщения: ${telegramMessageId}`, originalMessage || null]
        .filter(Boolean)
        .join(' | ')
    );

    attachFirstOrderToReferral(customerId, orderId);

    db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_title, quantity,
        price_per_unit, base_price_per_unit, catalog_discount_per_unit,
        cost_per_unit, discount_amount, total_price, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      generateId('oi'),
      orderId,
      product.id,
      product.title || 'Без названия',
      quantity,
      pricePerUnit,
      basePricePerUnit,
      roundMoney(basePricePerUnit - pricePerUnit),
      costPerUnit,
      totalAmount,
      totalCost
    );

    // ВАЖНО: НЕ списываем сток при создании заказа!
    // Сток списывается только при переходе в статус "Собран" (in_progress)
    // Это защита от абуза - конкуренты могут создавать фейковые заказы

    if (customerId) {
      db.prepare(`
        UPDATE customers
        SET total_orders = total_orders + 1,
            total_spent = total_spent + ?,
            last_order_at = DATETIME('now'),
            updated_at = DATETIME('now')
        WHERE id = ?
      `).run(finalAmount, customerId);
    }

    return assignLowestAvailablePickupCell(orderId);
  });

  const pickupCell = tx.immediate();

  return {
    orderId,
    orderNumber,
    finalAmount,
    pickupCellNumber: pickupCell.cell_number,
  };
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.warn('[navalivay:bot] BOT_TOKEN is not set. Bot will not start.');
} else {
  // Прокси нужен и здесь: bot.js ходит long-polling getUpdates к
  // api.telegram.org, и без прокси (на RU-хостинге) он не получает
  // business_connection / business_message events. Из-за этого в нашем
  // bot_message_log не было ни одной записи direction='in', и мы не
  // могли увидеть, какие клиенты активны в последние 24 часа.
  const telegramOptions = {};
  const proxyUrl = (process.env.TELEGRAM_HTTP_PROXY || '').trim();
  if (proxyUrl && botProxyAgent) {
    telegramOptions.agent = botProxyAgent;
    const masked = proxyUrl.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
    console.log('[navalivay:bot] long-polling через прокси:', masked);
  } else {
    console.log('[navalivay:bot] TELEGRAM_HTTP_PROXY не задан, long-polling напрямую');
  }
  const bot = new Telegraf(BOT_TOKEN, { telegram: telegramOptions });

  bot.start(async (ctx) => {
    try {
      const webAppUrl = getStoreWebAppUrl();
      await ctx.reply('Добро пожаловать в НАВАЛИВАЙ!', Markup.removeKeyboard());

      const kb = Markup.inlineKeyboard([
        [Markup.button.webApp('🛍 Открыть каталог', webAppUrl)],
        [Markup.button.callback('О нас', 'about')],
        [Markup.button.callback('Все о доставке', 'delivery')],
        [Markup.button.callback('Обратная связь', 'contact')],
      ]);

      await ctx.reply('Нажмите кнопку ниже, чтобы открыть каталог 😊', kb);
    } catch (e) {
      console.error(e);
    }
  });

  bot.action('about', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      'Толстовка — селективный штучный мерч. Следите за дропами в каталоге Mini App.',
      Markup.inlineKeyboard([[Markup.button.callback('Назад', 'back')]])
    );
  });

  bot.action('delivery', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      'Доставка по РФ. Условия уточняйте у менеджера в личных сообщениях перед покупкой.',
      Markup.inlineKeyboard([[Markup.button.callback('Назад', 'back')]])
    );
  });

  bot.action('contact', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      'По вопросам и заказам — пишите @Rez0nsky. Ответим оперативно.',
      Markup.inlineKeyboard([[Markup.button.callback('Назад', 'back')]])
    );
  });

  bot.action('back', async (ctx) => {
    await ctx.answerCbQuery();
    const webAppUrl = getStoreWebAppUrl();
    const kb = Markup.inlineKeyboard([
      [Markup.button.webApp('🛍 Открыть каталог', webAppUrl)],
      [Markup.button.callback('О нас', 'about')],
      [Markup.button.callback('Все о доставке', 'delivery')],
      [Markup.button.callback('Обратная связь', 'contact')],
    ]);
    await ctx.editMessageText('Навигация:', kb);
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message?.text ?? '';
    // Валюта опциональна и допускает оба написания: сайт шлёт BYN, но в чатах
    // могут висеть старые сообщения с рублём, их тоже принимаем.
    const match = text.match(
      /Хочу купить:\s*(.+)\nЦена:\s*([\d\s ]+)\s*(?:BYN|₽|руб\.?)?\nСсылка:\s*(\S+)/i,
    );
    if (!match) {
      return;
    }

    const [, title, priceText, link] = match;
    const productId = extractProductId(link.trim());

    if (!productId) {
      await ctx.reply('Не удалось определить товар из сообщения. Пожалуйста, отправьте ссылку из каталога ещё раз.');
      return;
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      await ctx.reply('Этот товар больше не доступен в каталоге. Проверьте обновления и попробуйте снова.');
      return;
    }

    const availableStock = typeof product.stock === 'number' ? product.stock : 0;
    if (availableStock <= 0) {
      await ctx.reply('Товар закончился на складе. Напишите менеджеру, чтобы уточнить сроки поступления.');
      return;
    }

    const customer = ensureCustomer(ctx.from);

    const referralGate = getReferralOrderCreationGate(String(ctx.from?.id || ''));
    if (!referralGate.allowed && referralGate.reason === 'authorization_failed') {
      await ctx.reply('Авторизация не пройдена. Напишите менеджеру, чтобы восстановить доступ.');
      return;
    }
    if (!referralGate.allowed) {
      await ctx.reply(
        'Первый заказ оформите в каталоге и укажите, кто вас пригласил.',
        Markup.inlineKeyboard([
          [Markup.button.webApp('🛍 Открыть каталог', getStoreWebAppUrl())],
        ]),
      );
      return;
    }

    if (isDuplicateOrder(customer?.id ?? null, product.id)) {
      await ctx.reply('Мы уже получили заявку на этот товар. Менеджер скоро свяжется с вами.');
      return;
    }

    try {
      const result = createOrderFromBot({
        customerId: customer?.id ?? null,
        product,
        quantity: 1,
        telegramMessageId: ctx.message.message_id,
        originalMessage: text
      });

      const finalPrice = Number(result.finalAmount) || 0;
      const formattedPrice = new Intl.NumberFormat('ru-RU').format(finalPrice);
      const webAppUrl = getStoreWebAppUrl();
      await ctx.reply(
        `Заказ №${result.pickupCellNumber} принят!\nТовар: ${title.trim()}\nСтоимость: ${formattedPrice} BYN\nМенеджер свяжется с вами для подтверждения.`,
        Markup.inlineKeyboard([
          [Markup.button.webApp('🛍 Открыть каталог', webAppUrl)] 
        ])
      );

      // Проактивный резолв username через userbot: к моменту первой смены
      // статуса entity уже в кэше GramJS → auto-notify уйдёт мгновенно.
      if (customer?.telegram_username) {
        resolveUsernameViaUserbot({
          username: customer.telegram_username,
          expectedTelegramId: customer.telegram_id,
        }).catch(() => {});
      }
    } catch (error) {
      if (
        error instanceof Error &&
        ['authorization_required', 'authorization_failed'].includes(error.code || error.message)
      ) {
        await ctx.reply('Первый заказ оформите в каталоге и укажите, кто вас пригласил.');
        return;
      }
      if (error instanceof Error && error.message === 'insufficient_stock') {
        await ctx.reply('Похоже, товар только что закончился. Мы уведомим менеджера и уточним наличие.');
        return;
      }
      if (error instanceof Error && error.code === 'pickup_cells_full') {
        await ctx.reply('Сейчас нет свободного места для заказа. Попробуйте немного позже.');
        return;
      }
      console.error('[navalivay:bot] failed to create order from message:', error);
      await ctx.reply('Произошла ошибка при создании заказа. Менеджер свяжется с вами вручную.');
    }
  });

  // ===========================================================================
  // Telegram Business mode
  //
  // Когда владелец Telegram-Premium аккаунта подключает нашего бота как
  // ассистента (Settings → Business → Chatbots), Telegram присылает апдейт
  // `business_connection`. Затем все DM этого владельца с другими юзерами
  // дублируются нам как `business_message`/`edited_business_message`/
  // `deleted_business_messages`. Мы сами отвечаем через `sendMessage` с
  // `business_connection_id`, и сообщение приходит клиенту от имени владельца.
  //
  // Мы НЕ отвечаем на сообщения, которые написал сам владелец (они тоже
  // приходят как business_message, но from.id === ownerUserId).
  // ===========================================================================

  function findCustomerByTelegramId(telegramId) {
    if (!telegramId) return null;
    return db
      .prepare(`SELECT id, telegram_id FROM customers WHERE telegram_id = ?`)
      .get(String(telegramId));
  }

  bot.on('business_connection', async (ctx) => {
    try {
      const conn = ctx.update?.business_connection;
      if (!conn?.id) return;
      const isEnabled = conn.is_enabled !== false;
      // Telegram переименовал поле в Bot API 9.0: `can_reply` → `rights.can_reply`.
      // Поддерживаем оба варианта.
      const canReply = Boolean(conn.can_reply ?? conn.rights?.can_reply);
      if (!isEnabled || !conn.user?.id) {
        // Подключение отключено владельцем — помечаем в БД, но историю не теряем.
        if (conn.id) removeBusinessConnection(conn.id);
        return;
      }
      registerBusinessConnection({
        id: conn.id,
        userId: conn.user.id,
        userChatId: conn.user_chat_id,
        username: conn.user?.username ?? null,
        firstName: conn.user?.first_name ?? null,
        lastName: conn.user?.last_name ?? null,
        isEnabled: true,
        canReply,
      });
      console.log(
        '[navalivay:bot] business_connection registered:',
        conn.id,
        'owner=', conn.user.id,
        'can_reply=', canReply,
      );
    } catch (err) {
      console.error('[navalivay:bot] business_connection handler error:', err);
    }
  });

  bot.on('business_message', async (ctx) => {
    try {
      const msg = ctx.update?.business_message;
      if (!msg) return;
      const businessConnectionId = msg.business_connection_id || null;
      const fromUserId = msg.from?.id ? String(msg.from.id) : null;
      const chatId = msg.chat?.id ? String(msg.chat.id) : null;
      const text = msg.text ?? msg.caption ?? '';
      if (!businessConnectionId || !fromUserId || !chatId) return;

      // Находим owner по записи о подключении.
      const connection = db
        .prepare(`SELECT user_id FROM business_connections WHERE id = ?`)
        .get(businessConnectionId);
      const ownerUserId = connection?.user_id ? String(connection.user_id) : null;
      if (!ownerUserId) {
        // Получили сообщение по неизвестному коннекту — лог-запись для дебага,
        // но без действий.
        logBotMessage({
          businessConnectionId,
          chatId,
          customerTelegramId: fromUserId,
          direction: 'in',
          messageType: 'incoming',
          text,
          meta: { warning: 'no_connection_record' },
        });
        return;
      }

      const isOwnerMessage = fromUserId === ownerUserId;
      const customer = isOwnerMessage ? null : findCustomerByTelegramId(fromUserId);

      // Логируем входящее сообщение (от клиента или от менеджера — последнее
      // оставляем как 'in' с меткой meta.from_owner=true для отчётов).
      logBotMessage({
        businessConnectionId,
        chatId,
        customerId: customer?.id ?? null,
        customerTelegramId: isOwnerMessage ? null : fromUserId,
        direction: 'in',
        messageType: 'incoming',
        text,
        meta: isOwnerMessage ? { from_owner: true } : null,
      });

      if (isOwnerMessage) return; // на свои сообщения не отвечаем

      const reply = handleIncomingBusinessMessage({
        businessConnectionId,
        fromUserId,
        ownerUserId,
        text,
      });
      if (!reply) return;

      try {
        await bot.telegram.sendMessage(chatId, reply.text, {
          business_connection_id: businessConnectionId,
        });
        logBotMessage({
          businessConnectionId,
          chatId,
          customerId: customer?.id ?? null,
          customerTelegramId: fromUserId,
          direction: 'out',
          messageType: 'quick_reply',
          templateKind: reply.templateKind,
          templateId: reply.templateId,
          text: reply.text,
          meta: { quick_reply_title: reply.quickReplyTitle },
        });
      } catch (sendErr) {
        console.error('[navalivay:bot] business send error:', sendErr?.message || sendErr);
        logBotMessage({
          businessConnectionId,
          chatId,
          customerId: customer?.id ?? null,
          customerTelegramId: fromUserId,
          direction: 'out',
          messageType: 'quick_reply',
          templateKind: reply.templateKind,
          templateId: reply.templateId,
          text: reply.text,
          meta: { error: String(sendErr?.message || sendErr) },
        });
      }
    } catch (err) {
      console.error('[navalivay:bot] business_message handler error:', err);
    }
  });

  // Telegraf не имеет дефолтного хелпера для удалённых сообщений — слушаем
  // апдейт явно. Лог пишем для аудита, никаких действий не делаем.
  bot.on('deleted_business_messages', async (ctx) => {
    try {
      const upd = ctx.update?.deleted_business_messages;
      if (!upd?.chat?.id) {
        // Без chat_id запись засоряет таблицу (NOT NULL заставлял бы '0'),
        // и фильтрация по chat_id в админке поломалась бы. Просто пропускаем.
        return;
      }
      logBotMessage({
        businessConnectionId: upd.business_connection_id || null,
        chatId: String(upd.chat.id),
        direction: 'in',
        messageType: 'incoming',
        text: null,
        meta: { event: 'deleted', message_ids: upd.message_ids },
      });
    } catch (err) {
      console.error('[navalivay:bot] deleted_business_messages error:', err);
    }
  });

  // Исходящие notify-status / send-price отправляются напрямую из
  // routes/crm.js через server/utils/telegram-business-api.js — это нужно,
  // потому что в проде api и bot живут в разных PM2-процессах и не делят
  // память (раньше был globalThis-хелпер, но он работал только локально).
  // bot-процесс остаётся ответственным только за входящие апдейты:
  // business_connection / business_message / edited_business_message.

  (async () => {
    try {
      // На всякий случай удаляем webhook, чтобы getUpdates заработал
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      const shopUrl = getStoreWebAppUrl();
      try {
        await bot.telegram.setChatMenuButton({
          menuButton: {
            type: 'web_app',
            text: 'Магазин',
            web_app: { url: shopUrl },
          },
        });
        let menuAfter = null;
        try {
          menuAfter = await bot.telegram.getChatMenuButton({});
        } catch (e) {
          menuAfter = { error: e?.message || String(e) };
        }
        console.log('[navalivay:bot] setChatMenuButton web_app url=', shopUrl, 'getChatMenuButton=', JSON.stringify(menuAfter));
      } catch (menuErr) {
        console.warn('[navalivay:bot] setChatMenuButton:', menuErr?.message || menuErr);
      }
      await bot.launch();
      console.log('[navalivay:bot] started (long polling). BASE_URL=', process.env.BASE_URL);
    } catch (err) {
      console.error('[navalivay:bot] launch error:', err);
    }
  })();

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
