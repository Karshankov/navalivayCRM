/**
 * Авторизация userbot. Non-interactive flow:
 *   PHONE из env.PHONE, SMS-код через файл `data/userbot.code`,
 *   2FA-пароль через файл `data/userbot.password`.
 *
 * Запуск (на сервере):
 *   PHONE=+375XXXXXXXXX node server/userbot/login.js
 *
 * Скрипт:
 *   1. Подключается к Telegram → отправляет SMS на указанный номер.
 *   2. Ждёт появления файла data/userbot.code (60 сек polling, до 10 минут).
 *   3. Если включена 2FA — ждёт data/userbot.password.
 *   4. Сохраняет сессию в data/userbot.session (chmod 600).
 *
 * После успеха файлы userbot.code и userbot.password удаляются,
 * чтобы пароль не лежал в plain text.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, saveSession, SESSION_FILE, redactSecrets } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const CODE_FILE = path.join(DATA_DIR, 'userbot.code');
const PASSWORD_FILE = path.join(DATA_DIR, 'userbot.password');

const PHONE = (process.env.PHONE || '').trim();
if (!PHONE) {
  console.error('[login] env PHONE не задан. Запусти: PHONE=+375... node userbot/login.js');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// Маскируем номер в логах: на ssh-сессии и в journald он не должен светиться
// в plain. Показываем код страны и последние 2 цифры — менеджер увидит, что
// номер угадан, но в логе не останется полного.
function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 6) return '***';
  return `${s.slice(0, 4)}***${s.slice(-2)}`;
}

console.log('=== Userbot login ===');
console.log('Телефон:', maskPhone(PHONE));
console.log('Сессия будет сохранена в:', SESSION_FILE);
console.log('');
console.log('Когда придёт код в Telegram (или SMS), создай файл с mode 600:');
console.log(`  (umask 077 && echo "12345" > ${CODE_FILE})`);
console.log('Если включена 2FA, пароль положи в (тоже mode 600):');
console.log(`  (umask 077 && echo "your-password" > ${PASSWORD_FILE})`);
console.log('');
console.log('Файлы с другими правами (group/world readable) будут отклонены.');
console.log('');

/**
 * Ждёт появления файла, читает содержимое, удаляет файл, возвращает строку.
 * timeoutMs — общий таймаут ожидания. Polling каждые 2 секунды.
 *
 * Безопасность:
 *   - Если файл создан с открытыми правами (group/world readable), вылетаем
 *     до чтения. На многоюзерной системе `echo "code" > userbot.code`
 *     по умолчанию даёт mode 644 — другие локальные пользователи прочитают
 *     2FA-пароль до того, как login.js успеет удалить файл. Лучше fail-fast.
 *   - readFileSync + unlinkSync делаем максимально близко друг к другу.
 *     Полная атомарность невозможна (нет POSIX move-and-read), но окно
 *     уменьшаем до микросекунд.
 */
async function waitForFile(filePath, label, timeoutMs = 10 * 60_000) {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch {
      stat = null;
    }
    if (stat && stat.isFile()) {
      // Проверка прав: должно быть mode 0o600 (только owner). Если не так —
      // не читаем, просим менеджера зашить корректно. Иначе на shared-host
      // 2FA-пароль успеет утечь другим локальным юзерам.
      // На Windows fs.statSync возвращает фиктивные mode bits, поэтому
      // проверяем только в *nix.
      if (process.platform !== 'win32') {
        const mode = stat.mode & 0o777;
        if (mode & 0o077) {
          console.error(
            `[login] ОТКЛОНЕНО: ${filePath} имеет права ${mode.toString(8)} ` +
              '(group/world readable). Создай файл с chmod 600:\n' +
              `  install -m 600 /dev/stdin ${filePath} <<< "your-secret"\n` +
              '  (или: touch + chmod 600 + echo)',
          );
          // Удаляем небезопасный файл — он бесполезен (мы его не используем),
          // и оставлять секрет с открытыми правами нельзя.
          try { fs.unlinkSync(filePath); } catch { /* ignore */ }
          throw new Error(`${label}: insecure file mode ${mode.toString(8)}`);
        }
      }
      const value = fs.readFileSync(filePath, 'utf8').trim();
      // Удаляем файл сразу после чтения — окно для гонки минимально.
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      if (value) {
        // Не печатаем длину value — для 2FA-пароля это подсказка для
        // bruteforce, для SMS-кода (5 цифр) — тривиальный fingerprint.
        console.log(`[login] получил ${label}: <скрыто>`);
        return value;
      }
    }
    if (Date.now() - lastLog > 30_000) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`[login] жду ${label}... (${elapsed}с прошло, лимит ${Math.round(timeoutMs / 1000)}с)`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${label}: timeout waiting for ${filePath}`);
}

const client = createClient('');

await client.start({
  phoneNumber: async () => PHONE,
  password: async () => waitForFile(PASSWORD_FILE, '2FA-пароль'),
  phoneCode: async () => waitForFile(CODE_FILE, 'SMS-код'),
  onError: (err) => {
    console.error('[login] ошибка от Telegram:', redactSecrets(err?.message || err));
  },
});

console.log('');
console.log('Авторизация прошла. Сохраняю сессию.');
const sessionString = client.session.save();
saveSession(sessionString);

const me = await client.getMe();
console.log('Залогинены как:', me?.firstName, me?.lastName || '', '(@' + (me?.username || '—') + ')');
console.log('User ID:', String(me?.id));
console.log('Сессия сохранена. На production: ./ops/prod.sh restart userbot');

await client.disconnect();
process.exit(0);
