const db = require('better-sqlite3')('/Users/pavelkarshankov/Documents/CRM-local/app/server/data/navalivay.db');
const { getBusinessPeriodRange, toSqliteUtcString } = require('./utils/business-time.js');
const { start } = getBusinessPeriodRange('today', 0);
for (let h = 0; h < 24; h++) {
  const hourStart = new Date(start.getTime() + h * 3600 * 1000);
  const hourEnd = new Date(hourStart.getTime() + 3600 * 1000);
  const count = db.prepare("SELECT count(*) as c FROM orders WHERE status IN ('completed', 'delivered') AND paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?").get(toSqliteUtcString(hourStart), toSqliteUtcString(hourEnd));
  if (count.c > 0) {
    console.log("Hour " + h + " (" + hourStart.toISOString() + "): " + count.c + " orders");
  }
}
