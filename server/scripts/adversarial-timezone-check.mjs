#!/usr/bin/env node
/**
 * Adversarial timezone validation against prod-like SQLite samples.
 * Simulates customer UI parsing (UTC SQLite → Europe/Minsk display).
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_FILE || path.join(__dirname, "../data/navalivay-prod.db");

const MINSK = "Europe/Minsk";

function parseCustomerUtc(value) {
  if (!value) return new Date(Number.NaN);
  const trimmed = String(value).trim();
  if (!trimmed) return new Date(Number.NaN);
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) return new Date(trimmed);
  const iso = trimmed.includes("T") ? `${trimmed}Z` : `${trimmed.replace(" ", "T")}Z`;
  return new Date(iso);
}

function formatMinsk(value) {
  const date = parseCustomerUtc(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MINSK,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function oldWrongParse(value) {
  const trimmed = String(value).trim();
  if (!trimmed || /[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) return new Date(trimmed);
  if (trimmed.includes("T")) return new Date(trimmed);
  return new Date(`${trimmed.replace(" ", "T")}+03:00`);
}

function formatMinskFromDate(date) {
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MINSK,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const db = new Database(dbPath, { readonly: true });

const recentOrders = db.prepare(`
  SELECT id, order_number, created_at, completed_at, status
  FROM orders
  WHERE created_at >= '2026-06-22'
  ORDER BY created_at DESC
  LIMIT 30
`).all();

let failures = 0;
let checked = 0;

console.log(`\n=== Adversarial timezone check (${dbPath}) ===\n`);

for (const order of recentOrders) {
  const history = db.prepare(`
    SELECT new_status, changed_at
    FROM order_status_history
    WHERE order_id = ?
    ORDER BY changed_at ASC
  `).all(order.id);

  const samples = [
    ["created_at", order.created_at],
    ["completed_at", order.completed_at],
    ...history.map((h) => [`history:${h.new_status}`, h.changed_at]),
  ].filter(([, v]) => v);

  for (const [label, raw] of samples) {
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(String(raw).trim())) continue;
    if (String(raw).includes("T")) continue;

    checked += 1;
    const fixed = formatMinsk(raw);
    const broken = formatMinskFromDate(oldWrongParse(raw));
    const fixedDate = parseCustomerUtc(raw);
    const brokenDate = oldWrongParse(raw);
    const driftHours = (fixedDate.getTime() - brokenDate.getTime()) / 3600000;

    const ok = Math.abs(driftHours - 3) < 0.001;
    if (!ok) {
      failures += 1;
      console.log(`FAIL #${order.order_number} ${label}: drift=${driftHours}h`);
      console.log(`  raw=${raw}`);
      console.log(`  fixed=${fixed}  broken=${broken}`);
    }
  }

  if (order.status === "delivered" && history.length >= 2) {
    const ready = history.find((h) => h.new_status === "in_progress")?.changed_at;
    const issued = history.find((h) => h.new_status === "delivered")?.changed_at;
    if (ready && issued && !String(ready).includes("T") && !String(issued).includes("T")) {
      const readyLabel = formatMinsk(ready);
      const issuedLabel = formatMinsk(issued);
      const readyMin = readyLabel.match(/\d{2}:\d{2}/)?.[0];
      const issuedMin = issuedLabel.match(/\d{2}:\d{2}/)?.[0];
      const diffSec = Math.abs(parseCustomerUtc(issued).getTime() - parseCustomerUtc(ready).getTime()) / 1000;
      // Only flag sub-minute pairs: 79s apart can legitimately cross a minute boundary.
      if (diffSec < 55 && readyMin !== issuedMin) {
        failures += 1;
        console.log(`FAIL #${order.order_number} timeline minute mismatch within ${diffSec}s`);
        console.log(`  ready=${readyLabel} issued=${issuedLabel}`);
      }
    }
  }
}

console.log(`\nChecked ${checked} bare SQLite timestamps on ${recentOrders.length} recent orders.`);
console.log(`Failures: ${failures}`);

if (failures > 0) process.exit(1);
console.log("All adversarial prod samples passed.\n");