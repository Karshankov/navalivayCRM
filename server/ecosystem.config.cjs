/**
 * PM2 ecosystem для NAVALIVAY.
 *
 * Production на NavalivayNew:
 *   - API                → systemd (navalivay-server.service)
 *   - navalivay-bot      → PM2
 *   - navalivay-userbot  → PM2
 *
 * API намеренно отсутствует: один компонент нельзя запускать двумя
 * диспетчерами. Все действия на prod выполняются через ops/prod.sh.
 *
 * Лог-ротация (раз настраивается на сервере):
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 20M
 *   pm2 set pm2-logrotate:retain 14
 *   pm2 set pm2-logrotate:compress true
 *   pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
 *
 * См. также docs/userbot-mtproto.md (раздел «Operational runbook»).
 */
module.exports = {
  apps: [
    {
      name: 'navalivay-bot',
      script: 'bot.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        // BOT_TOKEN must be set in environment or PM2 ecosystem
        // BASE_URL can be set to your public site URL
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '150M',
      out_file: 'logs/bot-out.log',
      error_file: 'logs/bot-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Userbot запускается ТОЛЬКО через wrapper-скрипт start.sh, который
      // оборачивает node в `proxychains4 -q` (читает /etc/proxychains4.conf).
      // PM2 не умеет интерполировать переменные в сложные пайплайны, поэтому
      // proxychains настраивается на уровне OS, а не env.
      //
      // Wrapper start.sh:
      //   #!/usr/bin/env bash
      //   set -e
      //   cd /var/www/NAVALIVAY/server
      //   exec proxychains4 -q node /var/www/NAVALIVAY/server/userbot/index.js
      //
      // Restart policy подобран так, чтобы пережить:
      //   - временную недоступность прокси (autorestart + min_uptime)
      //   - FloodWait от Telegram (exponential restart_delay не нужен,
      //     GramJS сам обрабатывает FloodWait внутри connectionRetries)
      //   - повреждённую сессию: max_restarts ограничивает crash loop,
      //     процесс уйдёт в `errored` и watchdog поднимет алерт.
      name: 'navalivay-userbot',
      script: 'userbot/start.sh',
      cwd: __dirname,
      interpreter: 'bash',
      env: {
        NODE_ENV: 'production',
        // USERBOT_HTTP_PORT, TELEGRAM_API_ID, TELEGRAM_API_HASH,
        // USERBOT_SECRET читаются из server/.env через dotenv внутри процесса.
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // Если процесс держится дольше 30с — сбрасываем счётчик рестартов.
      // Это спасает от попадания в `errored`, когда после короткого
      // FloodWait userbot успел подняться и работал.
      min_uptime: '30s',
      // Максимум 10 быстрых рестартов подряд — больше уже похоже на
      // невозможность подняться (auth_key_unregistered, нет прокси,
      // пустая сессия). Дальше watchdog поднимет алерт.
      max_restarts: 10,
      // 5с между рестартами — хватает прокси переподняться, не ддосим
      // Telegram при флапе.
      restart_delay: 5000,
      // Корректный shutdown: даём 10с GramJS отключиться, потом SIGKILL.
      kill_timeout: 10000,
      max_memory_restart: '250M',
      out_file: 'logs/userbot-out.log',
      error_file: 'logs/userbot-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
