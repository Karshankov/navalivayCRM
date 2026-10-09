import assert from "node:assert/strict";
import {
  isInsecureTelegramFallbackEnabled,
  resolveTelegramMiniAppIdentity,
  verifyTelegramMiniAppInitData,
} from "../telegram-miniapp-auth.js";
import { buildTelegramInitData } from "./helpers/telegram-auth.js";

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  ALLOW_INSECURE_TELEGRAM_AUTH: process.env.ALLOW_INSECURE_TELEGRAM_AUTH,
  ALLOW_TEST_TELEGRAM_AUTH: process.env.ALLOW_TEST_TELEGRAM_AUTH,
  BOT_TOKEN: process.env.BOT_TOKEN,
};

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function fakeRequest({ headers = {}, body = {}, query = {} } = {}) {
  return { headers, body, query };
}

function resetAuthEnv() {
  delete process.env.NODE_ENV;
  delete process.env.ALLOW_INSECURE_TELEGRAM_AUTH;
  delete process.env.ALLOW_TEST_TELEGRAM_AUTH;
  process.env.BOT_TOKEN = "test-bot-token";
}

function testMissingNodeEnvIsSecureByDefault() {
  resetAuthEnv();
  const req = fakeRequest({
    body: { telegram_id: "1618716805", telegram_username: "milfard" },
  });

  assert.equal(isInsecureTelegramFallbackEnabled(), false);
  assert.equal(resolveTelegramMiniAppIdentity(req), null);
}

function testUsernameOnlyCannotBecomeTrustedByAccident() {
  resetAuthEnv();
  const req = fakeRequest({ body: { telegram_username: "milfard" } });

  assert.equal(resolveTelegramMiniAppIdentity(req), null);
}

function testFlagAloneDoesNotEnableFallback() {
  resetAuthEnv();
  process.env.ALLOW_INSECURE_TELEGRAM_AUTH = "1";

  assert.equal(isInsecureTelegramFallbackEnabled(), false);
}

function testLocalFallbackRequiresExplicitFlag() {
  resetAuthEnv();
  process.env.NODE_ENV = "development";
  process.env.ALLOW_INSECURE_TELEGRAM_AUTH = "1";

  const identity = resolveTelegramMiniAppIdentity(
    fakeRequest({ body: { telegram_id: "42", telegram_username: "local_user" } }),
  );

  assert.equal(identity?.source, "insecure");
  assert.equal(identity?.telegramId, "42");
}

function testProductionCannotEnableFallback() {
  resetAuthEnv();
  process.env.NODE_ENV = "production";
  process.env.ALLOW_INSECURE_TELEGRAM_AUTH = "1";

  assert.equal(isInsecureTelegramFallbackEnabled(), false);
  assert.equal(
    resolveTelegramMiniAppIdentity(
      fakeRequest({ body: { telegram_id: "42", telegram_username: "spoofed" } }),
    ),
    null,
  );
}

function testSignedTelegramIdentityStillWorks() {
  resetAuthEnv();
  const identity = {
    telegram_id: "1618716805",
    telegram_username: "milfard",
    first_name: "Test",
  };
  const initData = buildTelegramInitData(identity, process.env.BOT_TOKEN);
  const resolved = resolveTelegramMiniAppIdentity(
    fakeRequest({ headers: { "x-telegram-init-data": initData } }),
  );

  assert.equal(resolved?.source, "telegram");
  assert.equal(resolved?.telegramId, identity.telegram_id);
  assert.equal(resolved?.telegramUsername, identity.telegram_username);
}

function testInvalidSignatureNeverFallsBackToBody() {
  resetAuthEnv();
  process.env.NODE_ENV = "development";
  process.env.ALLOW_INSECURE_TELEGRAM_AUTH = "1";
  const badInitData = buildTelegramInitData(
    { telegram_id: "100", telegram_username: "signed_user" },
    "wrong-token",
  );

  assert.throws(
    () =>
      resolveTelegramMiniAppIdentity(
        fakeRequest({
          headers: { "x-telegram-init-data": badInitData },
          body: { telegram_id: "999", telegram_username: "fallback_attacker" },
        }),
      ),
    (error) => error?.code === "telegram_auth_invalid",
  );
}

function testExpiredSignedDataIsRejected() {
  resetAuthEnv();
  const initData = buildTelegramInitData(
    {
      telegram_id: "101",
      telegram_username: "expired_user",
      auth_date: Math.floor(Date.now() / 1000) - 25 * 60 * 60,
    },
    process.env.BOT_TOKEN,
  );

  assert.throws(
    () => verifyTelegramMiniAppInitData(initData),
    (error) => error?.code === "telegram_auth_expired",
  );
}

try {
  testMissingNodeEnvIsSecureByDefault();
  testUsernameOnlyCannotBecomeTrustedByAccident();
  testFlagAloneDoesNotEnableFallback();
  testLocalFallbackRequiresExplicitFlag();
  testProductionCannotEnableFallback();
  testSignedTelegramIdentityStillWorks();
  testInvalidSignatureNeverFallsBackToBody();
  testExpiredSignedDataIsRejected();
  console.log("[telegram-miniapp-auth-adversarial] OK");
} finally {
  restoreEnv("NODE_ENV", originalEnv.NODE_ENV);
  restoreEnv(
    "ALLOW_INSECURE_TELEGRAM_AUTH",
    originalEnv.ALLOW_INSECURE_TELEGRAM_AUTH,
  );
  restoreEnv("ALLOW_TEST_TELEGRAM_AUTH", originalEnv.ALLOW_TEST_TELEGRAM_AUTH);
  restoreEnv("BOT_TOKEN", originalEnv.BOT_TOKEN);
}
