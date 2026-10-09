import crypto from "node:crypto";

const TELEGRAM_INIT_DATA_HEADER = "x-telegram-init-data";
const TEST_TELEGRAM_AUTH_HEADER = "x-test-telegram-auth";
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

function normalizeTelegramUsername(value) {
  return typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
}

function createAuthError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getHeaderValue(req, headerName) {
  const rawValue = req.headers?.[headerName];
  if (typeof rawValue === "string") {
    return rawValue.trim();
  }
  if (Array.isArray(rawValue) && rawValue.length > 0) {
    return String(rawValue[0] || "").trim();
  }
  return "";
}

function readStringField(req, fieldName) {
  const bodyValue = req.body?.[fieldName];
  if (typeof bodyValue === "string" && bodyValue.trim() !== "") {
    return bodyValue.trim();
  }

  const queryValue = req.query?.[fieldName];
  if (typeof queryValue === "string" && queryValue.trim() !== "") {
    return queryValue.trim();
  }

  return "";
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getSecretKey(botToken) {
  return crypto
    .createHmac("sha256", "WebAppData")
    .update(String(botToken || ""))
    .digest();
}

function buildDataCheckString(params) {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseTestIdentity(rawValue) {
  if (!rawValue) {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(rawValue);
  } catch {
    const [id = "", username = ""] = String(rawValue).split(":");
    payload = { id, username };
  }

  const telegramId = payload?.id ? String(payload.id).trim() : "";
  const telegramUsername = normalizeTelegramUsername(payload?.username);

  if (!telegramId && !telegramUsername) {
    throw createAuthError(
      "telegram_test_auth_invalid",
      401,
      "Некорректный test bypass для Telegram auth",
    );
  }

  return {
    telegramId,
    telegramUsername,
    firstName: typeof payload?.first_name === "string" ? payload.first_name.trim() : "",
    lastName: typeof payload?.last_name === "string" ? payload.last_name.trim() : "",
    source: "test",
    verified: true,
    rawInitData: null,
  };
}

// Байпас «представься кем угодно»: заголовок x-test-telegram-auth принимается
// без всякой подписи. В отличие от соседнего isInsecureTelegramFallbackEnabled,
// которому нужен ещё и NODE_ENV=development, здесь условия соединены через ИЛИ,
// поэтому ALLOW_TEST_TELEGRAM_AUTH=1 включает байпас при ЛЮБОМ NODE_ENV, включая
// production. Проверено прогоном: сервер с NODE_ENV=production и этой переменной
// отдал 200 на /api/customer/me по одному только заголовку.
function getTestBypassIdentity(req) {
  const enabled =
    String(process.env.NODE_ENV || "").toLowerCase() === "test" ||
    process.env.ALLOW_TEST_TELEGRAM_AUTH === "1";
  if (!enabled) {
    return null;
  }

  return parseTestIdentity(getHeaderValue(req, TEST_TELEGRAM_AUTH_HEADER));
}

function getInsecureFallbackIdentity(req) {
  const telegramId = readStringField(req, "telegram_id");
  const telegramUsername = normalizeTelegramUsername(
    readStringField(req, "telegram_username"),
  );
  const firstName = readStringField(req, "first_name");
  const lastName = readStringField(req, "last_name");

  if (!telegramId && !telegramUsername) {
    return null;
  }

  return {
    telegramId,
    telegramUsername,
    firstName,
    lastName,
    source: "insecure",
    verified: false,
    rawInitData: null,
  };
}

/**
 * Неподписанные telegram_id/@username разрешены только при явном включении
 * локального режима. Если NODE_ENV случайно не задан на проде, запрос не
 * должен автоматически становиться доверенным.
 */
export function isInsecureTelegramFallbackEnabled() {
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  return (
    nodeEnv === "development" &&
    process.env.ALLOW_INSECURE_TELEGRAM_AUTH === "1"
  );
}

export function getTelegramInitDataFromRequest(req) {
  return getHeaderValue(req, TELEGRAM_INIT_DATA_HEADER);
}

export function verifyTelegramMiniAppInitData(
  initData,
  {
    botToken = process.env.BOT_TOKEN || "",
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  } = {},
) {
  if (!initData) {
    throw createAuthError(
      "telegram_auth_required",
      401,
      "Требуется авторизация Telegram Mini App",
    );
  }

  if (!botToken) {
    throw createAuthError(
      "telegram_auth_unavailable",
      503,
      "Telegram auth недоступен: не настроен BOT_TOKEN",
    );
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw createAuthError(
      "telegram_auth_invalid",
      401,
      "В Telegram initData отсутствует hash",
    );
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw createAuthError(
      "telegram_auth_invalid",
      401,
      "В Telegram initData отсутствует auth_date",
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (maxAgeSeconds > 0 && nowSeconds - authDate > Number(maxAgeSeconds)) {
    throw createAuthError(
      "telegram_auth_expired",
      401,
      "Сессия Telegram устарела, откройте Mini App заново",
    );
  }

  const dataCheckString = buildDataCheckString(params);
  const computedHash = crypto
    .createHmac("sha256", getSecretKey(botToken))
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeEqualHex(computedHash, hash)) {
    throw createAuthError(
      "telegram_auth_invalid",
      401,
      "Некорректная подпись Telegram initData",
    );
  }

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch {
    throw createAuthError(
      "telegram_auth_invalid",
      401,
      "Некорректный user payload в Telegram initData",
    );
  }

  const telegramId = user?.id ? String(user.id).trim() : "";
  const telegramUsername = normalizeTelegramUsername(user?.username);

  if (!telegramId && !telegramUsername) {
    throw createAuthError(
      "telegram_auth_invalid",
      401,
      "В Telegram initData нет идентификатора пользователя",
    );
  }

  return {
    telegramId,
    telegramUsername,
    firstName: typeof user?.first_name === "string" ? user.first_name.trim() : "",
    lastName: typeof user?.last_name === "string" ? user.last_name.trim() : "",
    photoUrl: typeof user?.photo_url === "string" ? user.photo_url.trim() : "",
    authDate,
    source: "telegram",
    verified: true,
    rawInitData: initData,
  };
}

export function resolveTelegramMiniAppIdentity(
  req,
  {
    allowInsecureFallback = isInsecureTelegramFallbackEnabled(),
  } = {},
) {
  const initData = getTelegramInitDataFromRequest(req);
  if (initData) {
    return verifyTelegramMiniAppInitData(initData);
  }

  const testIdentity = getTestBypassIdentity(req);
  if (testIdentity) {
    return testIdentity;
  }

  if (allowInsecureFallback) {
    return getInsecureFallbackIdentity(req);
  }

  return null;
}

export function requireTelegramMiniAppAuth(options = {}) {
  return (req, res, next) => {
    try {
      const identity = resolveTelegramMiniAppIdentity(req, options);
      if (!identity) {
        return res.status(401).json({
          error: "telegram_auth_required",
          message: "Требуется авторизация Telegram Mini App",
        });
      }

      req.telegramAuth = identity;
      return next();
    } catch (error) {
      return res.status(Number(error.status || 401)).json({
        error: error.code || "telegram_auth_invalid",
        message: error.message || "Не удалось проверить Telegram auth",
      });
    }
  };
}

export function optionalTelegramMiniAppAuth(options = {}) {
  return (req, res, next) => {
    try {
      const identity = resolveTelegramMiniAppIdentity(req, options);
      if (identity) {
        req.telegramAuth = identity;
      }
      return next();
    } catch {
      return next();
    }
  };
}
