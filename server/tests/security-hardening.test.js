import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-security-"));
const tempDbPath = path.join(tempDir, "test.db");
const adminConfigPath = path.join(tempDir, "admin.json");

process.env.DATABASE_FILE = tempDbPath;
process.env.ADMIN_CONFIG = adminConfigPath;
process.env.SESSION_SECRET = "test-session-secret-with-enough-length";
process.env.NODE_ENV = "test";

fs.writeFileSync(
  adminConfigPath,
  JSON.stringify({
    username: "admin",
    passwordHash: "PLAIN:admin",
  }),
  "utf8",
);

const { initDb, db } = await import("../db.js");
const { adminRouter } = await import("../routes/admin.js");
const { uploadRouter } = await import("../upload.js");
const { issueToken } = await import("../auth.js");

initDb();

const app = express();
app.use(express.json());
app.use(adminRouter);
app.use(uploadRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

async function request(url, options = {}) {
  return fetch(`${baseUrl}${url}`, options);
}

function runAuthImport(env) {
  return execFileSync(
    process.execPath,
    ["--input-type=module", "-e", "import('./auth.js')"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        ...env,
      },
      stdio: "pipe",
    },
  );
}

async function testAdminLoginDoesNotLogPasswordAndSetsHardenedCookie() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.map((arg) => String(arg)).join(" "));
  try {
    const response = await request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.ok(!logs.join("\n").includes("admin"), "login logs must not include submitted password");
  } finally {
    console.log = originalLog;
  }
}

function testProductionRejectsWeakSessionSecret() {
  assert.throws(
    () => runAuthImport({
      NODE_ENV: "production",
      SESSION_SECRET: "change_me_secret",
      ADMIN_CONFIG: adminConfigPath,
    }),
    /SESSION_SECRET/,
  );
}

function testProductionRejectsMissingAdminConfig() {
  assert.throws(
    () => runAuthImport({
      NODE_ENV: "production",
      SESSION_SECRET: "production-session-secret-with-enough-length",
      ADMIN_CONFIG: path.join(tempDir, "missing-admin.json"),
    }),
    /ADMIN_CONFIG/,
  );
}

function testProductionRejectsPlainAdminPassword() {
  const plainConfigPath = path.join(tempDir, "plain-admin.json");
  fs.writeFileSync(
    plainConfigPath,
    JSON.stringify({ username: "admin", passwordHash: "PLAIN:admin" }),
    "utf8",
  );
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const { verifyPassword } = await import('./auth.js'); const ok = await verifyPassword('admin'); console.log(ok ? 'true' : 'false');",
    ],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        NODE_ENV: "production",
        SESSION_SECRET: "production-session-secret-with-enough-length",
        ADMIN_CONFIG: plainConfigPath,
      },
      stdio: "pipe",
    },
  ).toString().trim();
  assert.equal(output, "false");
}

async function testUploadRejectsNonImageFile() {
  const token = issueToken("admin");
  const form = new FormData();
  form.append("files", new Blob(["not an image"], { type: "text/plain" }), "payload.txt");

  const response = await request("/api/admin/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.equal(data.error, "invalid_file_type");
}

async function main() {
  await testAdminLoginDoesNotLogPasswordAndSetsHardenedCookie();
  testProductionRejectsWeakSessionSecret();
  testProductionRejectsMissingAdminConfig();
  testProductionRejectsPlainAdminPassword();
  await testUploadRejectsNonImageFile();

  console.log("[security-hardening] OK");
}

try {
  await main();
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
