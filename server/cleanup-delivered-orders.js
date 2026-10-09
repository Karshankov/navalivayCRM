import { db } from './db.js';

/**
 * Helper to calculate the start of the current day in Minsk timezone (UTC+3).
 * Returns a Date object representing 00:00:00 Minsk time in UTC.
 */
function getMinskMidnight() {
  const now = new Date();

  // Get current time components in Minsk
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });

  // Create a UTC date for the current day at 00:00:00 UTC
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type).value;

  const year = parseInt(getPart('year'));
  const month = parseInt(getPart('month')) - 1;
  const day = parseInt(getPart('day'));

  const utcMidnight = new Date(Date.UTC(year, month, day, 0, 0, 0));

  // Calculate the offset between UTC and Minsk for this specific date
  // We format the UTC midnight as Minsk time to see what time it is there
  const partsGuess = formatter.formatToParts(utcMidnight);
  const getPartGuess = (type) => partsGuess.find(p => p.type === type).value;

  const gYear = parseInt(getPartGuess('year'));
  const gMonth = parseInt(getPartGuess('month')) - 1;
  const gDay = parseInt(getPartGuess('day'));
  const gHour = parseInt(getPartGuess('hour'));
  const gMinute = parseInt(getPartGuess('minute'));

  // Construct the "Minsk Time" as if it was UTC to calculate the difference
  const minskTimeAsUtc = new Date(Date.UTC(gYear, gMonth, gDay, gHour, gMinute));
  const diff = minskTimeAsUtc.getTime() - utcMidnight.getTime();

  // Subtract the difference to get the true UTC timestamp for Minsk midnight
  return new Date(utcMidnight.getTime() - diff);
}

/**
 * Архивирует выданные заказы (статус 'delivered'), которые были выданы раньше сегодняшнего дня по Минску.
 * Запускается при старте сервера и каждый день в полночь по Минску.
 * Заказы не удаляются, а помечаются как archived=1 для сохранения исторических данных.
 */
export function archiveOldDeliveredOrders() {
  try {
    const startOfTodayMinsk = getMinskMidnight();

    console.log(`[archive] Archiving delivered orders older than ${startOfTodayMinsk.toISOString()} (Minsk Midnight)`);

    // Получаем заказы для архивации (статусы 'delivered' и 'completed')
    //
    // Две особенности, на которые легко наступить.
    //
    // Первая: пустой completed_at не спасает от архивации, а наоборот — такой
    // заказ подпадает под условие. Заказы в статусах new, in_progress и
    // cancelled функция не трогает вовсе, поэтому доска заказов от неё не
    // пустеет.
    //
    // Вторая: сравнение смешивает два формата. В базе completed_at лежит как
    // "2026-09-04 22:53:54" (через пробел), а порог приходит ISO-строкой
    // "2026-09-04T21:00:00.000Z" (через букву T). Сравнение строковое, в
    // позиции 10 пробел меньше буквы T, поэтому под условие попадает ЛЮБОЙ
    // заказ с той же датой, а не только выданный до минской полуночи. На деле
    // граница проходит по началу суток UTC, и заказы, выданные между 00:00 и
    // 03:00 по Минску, уезжают в архив в тот же день.
    const ordersToArchive = db.prepare(`
      SELECT id, order_number, status, completed_at
      FROM orders
      WHERE (status = 'delivered' OR status = 'completed')
        AND archived = 0
        AND (completed_at IS NULL OR completed_at < ?)
    `).all(startOfTodayMinsk.toISOString());

    if (ordersToArchive.length === 0) {
      console.log('[archive] No old delivered orders to archive');
      return { archived: 0 };
    }

    console.log(`[archive] Found ${ordersToArchive.length} old delivered orders to archive`);

    // Архивируем в транзакции
    const tx = db.transaction(() => {
      for (const order of ordersToArchive) {
        console.log(`[archive] Archiving order #${order.order_number} (completed at: ${order.completed_at})`);
        db.prepare('UPDATE orders SET archived = 1 WHERE id = ?').run(order.id);
      }
    });

    tx();

    console.log(`[archive] Successfully archived ${ordersToArchive.length} old delivered orders`);
    return { archived: ordersToArchive.length };
  } catch (error) {
    console.error('[archive] Error archiving old delivered orders:', error);
    return { archived: 0, error: error.message };
  }
}

/**
 * Планирует выполнение архивации каждый день в полночь по Минску
 */
export function scheduleArchiving() {
  // Вычисляем время до следующей полуночи по Минску
  function getMillisecondsUntilNextMinskMidnight() {
    const midnight = getMinskMidnight();
    // Add 24 hours to get next midnight
    const nextMidnight = new Date(midnight.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();
    return nextMidnight.getTime() - now.getTime();
  }

  // Запускаем первую архивацию через время до полуночи
  const msUntilMidnight = getMillisecondsUntilNextMinskMidnight();
  console.log(`[archive] Scheduled next archiving in ${Math.round(msUntilMidnight / 1000 / 60)} minutes (at Minsk midnight)`);

  setTimeout(() => {
    archiveOldDeliveredOrders();

    // После первого запуска в полночь запускаем каждые 24 часа
    setInterval(() => {
      archiveOldDeliveredOrders();
    }, 24 * 60 * 60 * 1000); // 24 часа
  }, msUntilMidnight);
}
