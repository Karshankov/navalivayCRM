import { randomUUID, randomInt } from 'node:crypto';
import { db } from '../db.js';
import { getBusinessPeriodRange, toSqliteUtcString } from './business-time.js';
import { REVIEW_STATUSES } from './product-reviews.js';

export function getReviewPeriodKey(monthOffset = 0) {
  const { calendarStart } = getBusinessPeriodRange('month', monthOffset);
  const year = calendarStart.year;
  const month = String(calendarStart.month).padStart(2, '0');
  return `${year}-${month}`;
}

export function resolveDrawPeriodBounds(periodKey) {
  const currentKey = getReviewPeriodKey(0);
  if (!periodKey || periodKey === currentKey) {
    const { start, end } = getBusinessPeriodRange('month', 0);
    return { startIso: toSqliteUtcString(start), endIso: toSqliteUtcString(end) };
  }

  const [year, month] = periodKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const { start, end } = getBusinessPeriodRange('month', 0);
    return { startIso: toSqliteUtcString(start), endIso: toSqliteUtcString(end) };
  }

  const nowCalendar = getBusinessPeriodRange('month', 0).calendarStart;
  const nowYear = nowCalendar.year;
  const nowMonth = nowCalendar.month;
  const monthOffset = (year - nowYear) * 12 + (month - nowMonth);
  const { start, end } = getBusinessPeriodRange('month', monthOffset);
  return { startIso: toSqliteUtcString(start), endIso: toSqliteUtcString(end) };
}

export function listEligibleDrawEntries(periodKey) {
  const { startIso, endIso } = resolveDrawPeriodBounds(periodKey);

  const rows = db.prepare(`
    SELECT
      pr.id AS review_id,
      pr.customer_id,
      COUNT(*) AS ticket_count
    FROM product_reviews pr
    INNER JOIN customers c ON c.id = pr.customer_id
    WHERE pr.status = ?
      AND COALESCE(pr.approved_at, pr.created_at) >= ?
      AND COALESCE(pr.approved_at, pr.created_at) < ?
      AND COALESCE(c.reviews_opt_out, 0) = 0
    GROUP BY pr.customer_id
  `).all(REVIEW_STATUSES.APPROVED, startIso, endIso);

  const tickets = [];
  for (const row of rows) {
    const weight = Math.max(1, Number(row.ticket_count || 1));
    for (let i = 0; i < weight; i += 1) {
      tickets.push({
        review_id: row.review_id,
        customer_id: row.customer_id,
      });
    }
  }
  return tickets;
}

export function pickWeightedWinners(tickets, seatCount = 5, rng = randomInt) {
  const winners = [];
  const usedCustomers = new Set();
  const pool = [...tickets];

  while (winners.length < seatCount && pool.length > 0) {
    const index = rng(0, pool.length);
    const ticket = pool[index];
    pool.splice(index, 1);

    if (usedCustomers.has(ticket.customer_id)) {
      continue;
    }

    usedCustomers.add(ticket.customer_id);
    winners.push(ticket);
  }

  return winners;
}

export function runMonthlyReviewDraw({ periodKey = null, seatCount = 5, rng = randomInt } = {}) {
  const resolvedPeriodKey = periodKey || getReviewPeriodKey(0);
  const existing = db.prepare(
    'SELECT id FROM review_monthly_draws WHERE period_key = ?',
  ).get(resolvedPeriodKey);

  if (existing) {
    const err = new Error('draw_already_exists');
    err.code = 'draw_already_exists';
    err.drawId = existing.id;
    throw err;
  }

  const tickets = listEligibleDrawEntries(resolvedPeriodKey);
  const winners = pickWeightedWinners(tickets, seatCount, rng);
  const drawId = randomUUID();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO review_monthly_draws (id, period_key, drawn_at, status)
      VALUES (?, ?, ?, 'completed')
    `).run(drawId, resolvedPeriodKey, now);

    winners.forEach((winner, index) => {
      db.prepare(`
        INSERT INTO review_monthly_draw_winners (
          id, draw_id, seat_number, customer_id, review_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        drawId,
        index + 1,
        winner.customer_id,
        winner.review_id,
        now,
      );
    });
  });

  tx();
  return getDrawById(drawId);
}

export function getDrawById(drawId) {
  const draw = db.prepare('SELECT * FROM review_monthly_draws WHERE id = ?').get(drawId);
  if (!draw) return null;

  const winners = db.prepare(`
    SELECT
      w.*,
      c.telegram_id,
      c.telegram_username,
      c.first_name,
      c.last_name
    FROM review_monthly_draw_winners w
    LEFT JOIN customers c ON c.id = w.customer_id
    WHERE w.draw_id = ? AND COALESCE(w.is_invalidated, 0) = 0
    ORDER BY w.seat_number ASC
  `).all(drawId);

  return { ...draw, winners };
}

export function rerollDrawSeat(drawId, seatNumber, { rng = randomInt } = {}) {
  const draw = db.prepare('SELECT * FROM review_monthly_draws WHERE id = ?').get(drawId);
  if (!draw) {
    const err = new Error('draw_not_found');
    err.code = 'draw_not_found';
    throw err;
  }

  const currentWinner = db.prepare(`
    SELECT * FROM review_monthly_draw_winners
    WHERE draw_id = ? AND seat_number = ? AND COALESCE(is_invalidated, 0) = 0
  `).get(drawId, seatNumber);

  if (!currentWinner) {
    const err = new Error('seat_not_found');
    err.code = 'seat_not_found';
    throw err;
  }

  const usedCustomers = new Set(
    db.prepare(`
      SELECT customer_id FROM review_monthly_draw_winners
      WHERE draw_id = ? AND COALESCE(is_invalidated, 0) = 0
    `).all(drawId).map((row) => row.customer_id),
  );

  const tickets = listEligibleDrawEntries(draw.period_key).filter(
    (ticket) => !usedCustomers.has(ticket.customer_id),
  );

  if (tickets.length === 0) {
    const err = new Error('no_eligible_tickets');
    err.code = 'no_eligible_tickets';
    throw err;
  }

  const replacement = pickWeightedWinners(tickets, 1, rng)[0];
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE review_monthly_draw_winners
      SET customer_id = ?,
          review_id = ?,
          rerolled_from_winner_id = ?,
          created_at = ?
      WHERE id = ?
    `).run(
      replacement.customer_id,
      replacement.review_id,
      currentWinner.id,
      now,
      currentWinner.id,
    );
  });

  tx();
  return getDrawById(drawId);
}