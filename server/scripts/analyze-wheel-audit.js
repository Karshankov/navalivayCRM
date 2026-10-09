import { db, initDb } from "../db.js";

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, "1");
    }
  }
  return args;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function expectedFromAuditRows(rows) {
  const totals = new Map();
  let eligibleRows = 0;
  for (const row of rows) {
    if (row.decision_type !== "rarity_roll") continue;
    const effective = parseJson(row.effective_chances_json, []);
    if (!Array.isArray(effective) || !effective.length) continue;
    eligibleRows += 1;
    for (const entry of effective) {
      const code = entry.rarity_code || "nothing";
      const chance = Number(entry.chance_percent || 0);
      totals.set(code, (totals.get(code) || 0) + chance / 100);
    }
  }
  return { eligibleRows, totals };
}

function zScore(actual, expected, n) {
  if (n <= 0) return null;
  const p = expected / n;
  if (p <= 0 || p >= 1) return null;
  const sd = Math.sqrt(n * p * (1 - p));
  if (sd === 0) return null;
  return (actual - expected) / sd;
}

/**
 * CLI for post-factum wheel audits.
 *
 * Agents should use this instead of hand-written SQL when checking whether
 * configured chances match observed outcomes. It separates ordinary rarity
 * rolls from pity/valuable releases because those modifiers are intentionally
 * not governed by the configured percentage map.
 */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = Math.max(1, Number(args.get("days") || 7));
  const since = args.get("from") || null;
  const where = since
    ? "WHERE a.created_at >= ?"
    : "WHERE a.created_at >= DATETIME('now', ?)";
  const params = since ? [since] : [`-${days} days`];

  initDb();
  const rows = db
    .prepare(
      `SELECT a.*
       FROM wheel_spin_audit a
       ${where}
       ORDER BY a.created_at ASC`,
    )
    .all(...params);

  const actualByRarity = new Map();
  const decisionTypes = new Map();
  for (const row of rows) {
    const code = row.selected_rarity_code || "unknown";
    actualByRarity.set(code, (actualByRarity.get(code) || 0) + 1);
    decisionTypes.set(row.decision_type, (decisionTypes.get(row.decision_type) || 0) + 1);
  }

  const { eligibleRows, totals: expectedTotals } = expectedFromAuditRows(rows);
  const rarityCodes = [...new Set([...actualByRarity.keys(), ...expectedTotals.keys()])].sort();
  const distribution = rarityCodes.map((code) => {
    const actual = actualByRarity.get(code) || 0;
    const expected = expectedTotals.get(code) || 0;
    const z = zScore(actual, expected, eligibleRows);
    return {
      rarity_code: code,
      actual,
      actual_pct: rows.length ? Number(((actual * 100) / rows.length).toFixed(2)) : 0,
      expected_roll_count: Number(expected.toFixed(2)),
      z_score: z === null ? null : Number(z.toFixed(3)),
    };
  });

  console.log(JSON.stringify({
    window: since ? { from: since } : { days },
    total_audit_rows: rows.length,
    ordinary_rarity_rolls: eligibleRows,
    decision_types: Object.fromEntries(decisionTypes),
    distribution,
  }, null, 2));
  db.close();
}

main();
