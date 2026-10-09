/**
 * GramJS клиент для userbot — работает от лица аккаунта менеджера через
 * MTProto (как обычный Telegram-клиент типа iMe / Telegram X).
 *
 * Зачем: Telegram Business для ботов имеет жёсткое 24-часовое окно — бот
 * не может писать клиентам, которые молчат больше суток. Userbot этого
 * ограничения не имеет, потому что технически он = аккаунт менеджера.
 *
 * Сессия (StringSession) — самое чувствительное: кто получит её, получит
 * доступ к Telegram-аккаунту менеджера. Храним в файле data/userbot.session
 * (gitignore + chmod 600 на сервере), читаем при старте процесса.
 *
 * Создание клиента — создаёт объект, но НЕ подключается. connect() надо
 * звать отдельно (login.js делает это с интерактивным SMS-flow, основной
 * процесс — просто .connect() со store сессией).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

/**
 * Чистит строку от секретов перед логированием. Прячем:
 * - StringSession (длинная base64-строка >100 символов)
 * - TELEGRAM_API_HASH (32 hex символа)
 * - SMS-коды и 2FA пароли мы вообще не передаём в строки логирования
 *
 * Используется при печати err.message — GramJS иногда вкладывает в текст
 * ошибки данные клиента, и хочется страховаться.
 */
export function redactSecrets(input) {
  if (input == null) return input;
  let s = String(input);
  const apiHash = (process.env.TELEGRAM_API_HASH || '').trim();
  if (apiHash && apiHash.length >= 16) {
    s = s.split(apiHash).join('***api_hash***');
  }
  // Длинные base64-подобные строки — кандидаты на StringSession.
  // GramJS StringSession обычно >300 символов и начинается с '1'.
  s = s.replace(/[A-Za-z0-9+/=_-]{100,}/g, (m) => `***redacted_${m.length}c***`);
  // 32-hex (на случай чужого api_hash в сообщении ошибки).
  s = s.replace(/\b[a-f0-9]{32}\b/g, '***hex32***');
  return s;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Сессия живёт в server/data/userbot.session — рядом с БД.
export const SESSION_FILE = path.resolve(__dirname, '../data/userbot.session');

export function loadSavedSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return '';

    // Defense-in-depth: если кто-то случайно расшарил сессию (chmod 644
    // например), отказываемся работать. Лучше упасть, чем тихо принять
    // потенциально утёкшую сессию. На Windows mode bits ненадёжны —
    // проверку пропускаем.
    if (process.platform !== 'win32') {
      const stat = fs.statSync(SESSION_FILE);
      const mode = stat.mode & 0o777;
      if (mode & 0o077) {
        console.error(
          `[userbot] ОПАСНО: ${SESSION_FILE} имеет права ${mode.toString(8)} ` +
            '(group/world readable). Сессия могла утечь — отзови её в ' +
            'Telegram → Настройки → Активные сеансы и пройди login заново. ' +
            `Затем chmod 600 ${SESSION_FILE}`,
        );
        // Не возвращаем сессию — пусть процесс упадёт с явной ошибкой.
        return '';
      }
    }
    return fs.readFileSync(SESSION_FILE, 'utf8').trim();
  } catch (err) {
    console.error('[userbot] не удалось прочитать сессию:', err.message);
  }
  return '';
}

export function saveSession(sessionString) {
  if (!sessionString) return;
  // Создаём data/ если ещё нет (на чистом сервере).
  const dir = path.dirname(SESSION_FILE);
  fs.mkdirSync(dir, { recursive: true });

  // Атомарная запись: tmp-файл с правильными правами → rename. Это:
  //   1) Не оставляет полу-записанной сессии при crash.
  //   2) Гарантирует mode 0o600 даже если SESSION_FILE уже существовал
  //      с более открытыми правами (writeFileSync mode применяет только
  //      при создании, не меняет существующий файл).
  const tmpFile = `${SESSION_FILE}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpFile, sessionString, { mode: 0o600 });
  // На *nix umask может ослабить mode; форсируем явно.
  try {
    fs.chmodSync(tmpFile, 0o600);
  } catch {
    /* Windows / fs без chmod — игнорируем */
  }
  fs.renameSync(tmpFile, SESSION_FILE);
  // На случай, если файл существовал и rename не пересоздал inode на FS,
  // ещё раз chmod на финальное место.
  try {
    fs.chmodSync(SESSION_FILE, 0o600);
  } catch {
    /* ignore */
  }
}

/**
 * Создаёт GramJS-клиент. Не подключается — это делает caller.
 *
 * @param {string} [sessionString] — если пустой, сессия будет создана пустой
 *   (для login flow); если непустой, клиент сразу авторизован.
 */
export function createClient(sessionString = '') {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = (process.env.TELEGRAM_API_HASH || '').trim();
  if (!apiId || !apiHash) {
    throw new Error(
      'TELEGRAM_API_ID / TELEGRAM_API_HASH не заданы в .env — userbot не может работать',
    );
  }
  const session = new StringSession(sessionString);
  // connectionRetries=5 — небольшой автоматический ретрай при разрыве.
  // baseLogger — выключен, чтобы наш stdout не засорялся внутренними
  // логами GramJS (они шумные).
  return new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
    useWSS: true,
  });
}
