import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertStaffSecurityConfig,
} from '../utils/staff-security-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function guardedStartup(env, sideEffect) {
  assertStaffSecurityConfig({ env });
  sideEffect();
}

function productionEnv(staffPinPepper) {
  return {
    NODE_ENV: 'production',
    SESSION_SECRET: 'production-session-secret-with-more-than-thirty-two-characters',
    ...(staffPinPepper === undefined
      ? {}
      : { STAFF_PIN_PEPPER: staffPinPepper }),
  };
}

let startupSideEffects = 0;
const recordStartupSideEffect = () => {
  startupSideEffects += 1;
};

assert.throws(
  () => guardedStartup(productionEnv(), recordStartupSideEffect),
  (error) => (
    error?.code === 'staff_pin_pepper_not_configured'
    && error?.status === 503
    && /STAFF_PIN_PEPPER/.test(error.message)
  ),
  'production startup must reject a missing STAFF_PIN_PEPPER',
);
assert.equal(startupSideEffects, 0, 'missing pepper must fail before startup side effects');

assert.throws(
  () => guardedStartup(productionEnv('too-short'), recordStartupSideEffect),
  (error) => error?.code === 'staff_pin_pepper_not_configured',
  'production startup must reject a short STAFF_PIN_PEPPER',
);
assert.equal(startupSideEffects, 0, 'short pepper must fail before startup side effects');

assert.doesNotThrow(() => guardedStartup(
  productionEnv('production-staff-pin-pepper-with-more-than-thirty-two-characters'),
  recordStartupSideEffect,
));
assert.equal(startupSideEffects, 1, 'valid production config may continue startup');

assert.doesNotThrow(() => guardedStartup(
  { NODE_ENV: 'test', SESSION_SECRET: 'short-local-secret' },
  recordStartupSideEffect,
));
assert.equal(startupSideEffects, 2, 'local and test fallback must remain available');

function assertRealStartupStopsBeforeDatabaseInitialization(staffPinPepper, label) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-staff-startup-'));
  const databaseFile = path.join(tempDir, 'startup.db');
  const adminConfigFile = path.join(tempDir, 'admin.json');
  fs.writeFileSync(adminConfigFile, JSON.stringify({ username: 'admin' }), 'utf8');
  try {
    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SESSION_SECRET:
          'production-session-secret-with-more-than-thirty-two-characters',
        STAFF_PIN_PEPPER: staffPinPepper,
        ADMIN_CONFIG: adminConfigFile,
        DATABASE_FILE: databaseFile,
        PORT: '0',
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.notEqual(result.status, 0, `${label}: production startup must fail`);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /STAFF_PIN_PEPPER/,
      `${label}: startup error must identify the missing configuration`,
    );
    assert.equal(
      fs.existsSync(databaseFile),
      false,
      `${label}: SQLite file must not be opened or created`,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

assertRealStartupStopsBeforeDatabaseInitialization('', 'missing pepper');
assertRealStartupStopsBeforeDatabaseInitialization('too-short', 'short pepper');

async function assertValidProductionStartupReachesListen() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-staff-startup-valid-'));
  const databaseFile = path.join(tempDir, 'startup.db');
  const adminConfigFile = path.join(tempDir, 'admin.json');
  fs.writeFileSync(adminConfigFile, JSON.stringify({ username: 'admin' }), 'utf8');
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET:
        'production-session-secret-with-more-than-thirty-two-characters',
      STAFF_PIN_PEPPER:
        'production-staff-pin-pepper-with-more-than-thirty-two-characters',
      ADMIN_CONFIG: adminConfigFile,
      DATABASE_FILE: databaseFile,
      PORT: '0',
      BOT_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collectOutput = (chunk) => {
    output += String(chunk);
  };
  child.stdout.on('data', collectOutput);
  child.stderr.on('data', collectOutput);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`valid production startup timed out:\n${output}`));
      }, 15_000);
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(
          `valid production startup exited before listen (${code ?? signal}):\n${output}`,
        ));
      });
      const onData = () => {
        if (!output.includes('[navalivay] server listening on :')) return;
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        resolve();
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
    });
    assert.equal(
      fs.existsSync(databaseFile),
      true,
      'valid production config must continue through database startup',
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    if (child.exitCode === null) {
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await assertValidProductionStartupReachesListen();

console.log('staff-startup-config tests: ok');
