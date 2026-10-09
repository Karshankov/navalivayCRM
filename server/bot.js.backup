import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { db } from './db.js';

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

function createOrderFromBot({ customerId, product, quantity, telegramMessageId, originalMessage }) {
  const orderId = generateId('order');
  const orderNumber = getNextNumber('orders', 'order_number');
  const pricePerUnit = Number(product.priceRub) || 0;
  const costPerUnit = Number(product.cost_price) || 0;
  const totalAmount = pricePerUnit * quantity;
  const totalCost = costPerUnit * quantity;
  const finalAmount = totalAmount;
  const profit = finalAmount - totalCost;

  const tx = db.transaction(() => {
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

    db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_title, quantity,
        price_per_unit, cost_per_unit, discount_amount, total_price, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      generateId('oi'),
      orderId,
      product.id,
      product.title || 'Без названия',
      quantity,
      pricePerUnit,
      costPerUnit,
      totalAmount,
      totalCost
    );

    db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(Math.max(latestStock - quantity, 0), product.id);

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
  });

  tx();

  return {
    orderId,
    orderNumber,
    finalAmount
  };
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.warn('[navalivay:bot] BOT_TOKEN is not set. Bot will not start.');
} else {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    try {
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('О нас', 'about')],
        [Markup.button.callback('Все о доставке', 'delivery')],
        [Markup.button.callback('Обратная связь', 'contact')],
      ]);

      await ctx.reply('Добро пожаловать в НАВАЛИВАЙ! Выберите раздел или сразу перейдите в Каталог по желтой кнопочке ниже 😊!');

      await ctx.reply('Навигация:', kb);
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
      'По вопросам и заказам — пишите @innocentyy. Ответим оперативно.',
      Markup.inlineKeyboard([[Markup.button.callback('Назад', 'back')]])
    );
  });

  bot.action('back', async (ctx) => {
    await ctx.answerCbQuery();
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('О нас', 'about')],
      [Markup.button.callback('Все о доставке', 'delivery')],
      [Markup.button.callback('Обратная связь', 'contact')],
    ]);
    await ctx.editMessageText('Навигация:', kb);
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const match = text.match(/Хочу купить:\s*(.+)\nЦена:\s*([\d\s\u00A0]+)\s*₽?\nСсылка:\s*(\S+)/i);
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
      await ctx.reply(
        `Заказ принят!\nТовар: ${title.trim()}\nСтоимость: ${formattedPrice} ₽\nМенеджер свяжется с вами для подтверждения.`,
        Markup.inlineKeyboard([
          [Markup.button.url('Открыть каталог', process.env.BASE_URL || 'https://t.me/navalivay_app')] 
        ])
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'insufficient_stock') {
        await ctx.reply('Похоже, товар только что закончился. Мы уведомим менеджера и уточним наличие.');
        return;
      }
      console.error('[navalivay:bot] failed to create order from message:', error);
      await ctx.reply('Произошла ошибка при создании заказа. Менеджер свяжется с вами вручную.');
    }
  });

  (async () => {
    try {
      // На всякий случай удаляем webhook, чтобы getUpdates заработал
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
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
