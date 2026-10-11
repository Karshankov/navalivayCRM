// Read-only lookup. Never resolves usernames through Telegram or changes referrals.
export function findCrmInviter(database, rawUsername) {
  const username = typeof rawUsername === 'string' ? rawUsername.trim().replace(/^@+/, '') : '';
  if (!/^[a-zA-Z0-9_]{1,32}$/.test(username)) {
    const error = new Error('Укажите корректный Telegram username');
    error.status = 400;
    error.code = 'invalid_username';
    throw error;
  }
  const matches = database.prepare(`
    SELECT id, telegram_username, first_name, last_name
    FROM customers
    WHERE LOWER(LTRIM(TRIM(telegram_username), '@')) = LOWER(?) AND deleted_at IS NULL
    LIMIT 2
  `).all(username);
  if (matches.length > 1) {
    const error = new Error('Найдено несколько клиентов с этим username. Уточните данные клиента.');
    error.status = 409;
    error.code = 'ambiguous_username';
    throw error;
  }
  const customer = matches[0] || null;
  if (!customer) return { customer: null, referral: null };
  const referral = database.prepare(`
    SELECT cr.invitee_customer_id, ic.id AS inviter_customer_id,
      COALESCE(NULLIF(TRIM(ic.telegram_username), ''), cr.inviter_username_snapshot) AS inviter_username,
      ic.first_name AS inviter_first_name, ic.last_name AS inviter_last_name,
      cib.id AS inviter_invite_ban_id,
      CASE WHEN cib.id IS NOT NULL THEN 1 ELSE 0 END AS inviter_is_invite_banned
    FROM customer_referrals cr
    LEFT JOIN customers ic ON ic.id = cr.inviter_customer_id
    LEFT JOIN customer_invite_bans cib ON cib.id = (
      SELECT id FROM customer_invite_bans
      WHERE customer_id = ic.id AND active = 1 ORDER BY banned_at DESC, id DESC LIMIT 1
    )
    WHERE cr.invitee_customer_id = ?
  `).get(customer.id) || null;
  return { customer, referral };
}
