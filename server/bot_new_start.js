  bot.start(async (ctx) => {
    try {
      const webAppUrl = process.env.BASE_URL || 'https://navalivay.store';
      const kb = Markup.inlineKeyboard([
        [Markup.button.webApp('🛍 Открыть каталог', webAppUrl)],
        [Markup.button.callback('О нас', 'about')],
        [Markup.button.callback('Все о доставке', 'delivery')],
        [Markup.button.callback('Обратная связь', 'contact')],
      ]);

      await ctx.reply('Добро пожаловать в НАВАЛИВАЙ! Нажмите кнопку ниже, чтобы открыть каталог 😊', kb);
    } catch (e) {
      console.error(e);
    }
  });
