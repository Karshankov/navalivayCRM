import crypto from "node:crypto";

function normalizeTelegramUsername(value) {
  return typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
}

export function buildTelegramInitData(
  {
    id,
    telegram_id,
    username = "",
    telegram_username = "",
    first_name = "Test",
    firstName,
    last_name = "User",
    lastName,
    auth_date = Math.floor(Date.now() / 1000),
  },
  botToken = process.env.BOT_TOKEN || "test-bot-token",
) {
  const resolvedId = id ?? telegram_id;
  const user = {
    id: Number(resolvedId),
    first_name: firstName ?? first_name,
    last_name: lastName ?? last_name,
  };

  const normalizedUsername = normalizeTelegramUsername(username || telegram_username);
  if (normalizedUsername) {
    user.username = normalizedUsername;
  }

  const pairs = [
    ["auth_date", String(auth_date)],
    ["user", JSON.stringify(user)],
  ];

  const dataCheckString = pairs
    .slice()
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(String(botToken))
    .digest();

  const hash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const params = new URLSearchParams();
  pairs.forEach(([key, value]) => params.set(key, value));
  params.set("hash", hash);

  return params.toString();
}

export function telegramHeaders(identity, extraHeaders = {}) {
  return {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": buildTelegramInitData(identity),
    ...extraHeaders,
  };
}
