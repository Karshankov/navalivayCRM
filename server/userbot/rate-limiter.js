/**
 * Rate-limiter с гарантированной последовательностью при N параллельных
 * вызовах. Извлечён из userbot/index.js для unit-тестирования (импорт
 * index.js запускает реальное MTProto-соединение и HTTP API).
 *
 * Зачем: до этого был race — все одновременные `await rateLimitedDelay()`
 * читали один и тот же `lastSendAt`, ждали одинаковое время, потом все
 * одновременно проставляли свежий timestamp. Фактически N сообщений уходили
 * в одну секунду, обходя лимит и привлекая anti-spam Telegram. Бан аккаунта
 * менеджера = потеря сессии + риск 2FA recovery email.
 *
 * Решение: chained Promise. Каждый caller добавляет звено в общую цепочку,
 * которая отрабатывает строго последовательно. Следующий звено стартует
 * только когда предыдущее освободило слот через minIntervalMs.
 *
 * @param {object} options
 * @param {number} [options.maxPerSecond=1] — верхний предел на исходящие
 * @returns {() => Promise<number>} функция-планировщик, которая ждёт нужный
 *          интервал и возвращает timestamp фактического finished-at.
 */
export function createRateLimiter({ maxPerSecond = 1 } = {}) {
  const minIntervalMs = 1000 / maxPerSecond;
  let sendChain = Promise.resolve(0); // last finished-at timestamp

  async function rateLimitedDelay() {
    const my = sendChain.then(async (lastFinishedAt) => {
      const now = Date.now();
      const wait = lastFinishedAt + minIntervalMs - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return Date.now();
    });
    // Важно: чейним именно `my`, чтобы следующее звено ждало нашего
    // finished-at. Catch на всякий случай — иначе одна неуспешная отправка
    // сломает цепочку (дальнейшие .then() пойдут в rejected ветку и заблокируют
    // очередь навсегда).
    sendChain = my.catch(() => Date.now());
    return my;
  }

  return rateLimitedDelay;
}
