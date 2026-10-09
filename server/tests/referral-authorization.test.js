import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.resolve(__dirname, `.tmp-referral-${Date.now()}.db`);
process.env.DATABASE_FILE = tmpDb;
process.env.BOT_TOKEN = '';

const { db, initDb } = await import('../db.js');
initDb();
const referral = await import('../utils/referral-authorization.js');
const blocks = await import('../utils/customer-blocks.js');
const { enrichOrdersWithRelations } = await import('../utils/crm-order-enrichment.js');
const { createOrderFromBot } = await import('../bot.js');

function customer(id, telegramId, username, {
  authorized = false,
  deleted = false,
  source = authorized ? 'legacy' : null,
  botVerified = false,
} = {}) {
  db.prepare(`
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_visit_at, total_orders, total_spent,
      access_authorized_at, access_authorization_source, bot_verified_at, deleted_at
    ) VALUES (?, ?, ?, DATETIME('now'), 0, 0, ?, ?, ?, ?)
  `).run(
    id, telegramId, username,
    authorized ? '2026-01-01 00:00:00' : null,
    source,
    botVerified ? '2025-12-31 00:00:00' : null,
    deleted ? '2026-01-02 00:00:00' : null,
  );
}

function order(id, number, customerId, status) {
  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type,
      total_amount, final_amount, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pickup', 10, 10, DATETIME('now'), DATETIME('now'))
  `).run(id, number, customerId, status);
}

function identity(id = '900', username = 'new_person') {
  return { telegramId: id, telegramUsername: username, firstName: 'Новый', lastName: null };
}

try {
  referral.setReferralAuthorizationEnabled(true);
  customer('eligible', '100', 'Good_User', { authorized: true });
  order('issued', 1, 'eligible', 'delivered');
  customer('not_issued', '101', 'NotIssued', { authorized: true });
  order('new_order', 2, 'not_issued', 'new');
  customer('deleted', '102', 'DeletedOne', { authorized: true, deleted: true });
  order('deleted_order', 3, 'deleted', 'completed');

  assert.equal(referral.getReferralAuthorizationStatus('900').required, true);
  assert.equal(referral.getReferralOrderCreationGate('900').allowed, false);
  assert.equal(referral.inspectInviter({ telegramId: '900', rawUsername: '@GOOD_user' }).ok, true);
  assert.equal(referral.inspectInviter({ telegramId: '900', rawUsername: ' good_user ' }).ok, true);
  for (const raw of ['', 'a', '@@good_user', 'юзер', "x' OR 1=1 --", 'a'.repeat(33)]) {
    assert.equal(referral.inspectInviter({ telegramId: '900', rawUsername: raw }).ok, false);
  }
  assert.equal(referral.inspectInviter({ telegramId: '900', rawUsername: 'NotIssued' }).code, 'referral_inviter_not_eligible');

  // Старый клиент, которого менеджер явно верифицировал до обновления,
  // может приглашать без выданного заказа. Новый referral-клиент — нет:
  // он получает это право только после собственной выдачи.
  customer('verified_legacy', '104', 'VerifiedLegacy', {
    authorized: true,
    botVerified: true,
  });
  assert.equal(referral.isCustomerAccessAuthorized('verified_legacy'), true);
  assert.equal(referral.inspectInviter({ telegramId: '900', rawUsername: 'VerifiedLegacy' }).ok, true);
  const verifiedLegacyBlock = blocks.createBlock({
    customer_id: 'verified_legacy',
    reason: 'legacy blocked',
    blocked_by: 'admin',
  });
  assert.equal(
    referral.inspectInviter({ telegramId: '900', rawUsername: 'VerifiedLegacy' }).code,
    'referral_inviter_blocked',
  );
  blocks.unblockCustomerBlock(verifiedLegacyBlock.block.id);
  const verifiedLegacyInviteBan = referral.createInviteBan({
    customerId: 'verified_legacy',
    reason: 'legacy invite ban',
    bannedBy: 'admin',
  });
  assert.equal(
    referral.inspectInviter({ telegramId: '900', rawUsername: 'VerifiedLegacy' }).code,
    'referral_inviter_forbidden',
  );
  referral.removeInviteBan(verifiedLegacyInviteBan.id, { unbannedBy: 'admin' });
  customer('verified_legacy_duplicate', '106', 'verifiedlegacy');
  const verifiedLegacyAmbiguous = referral.inspectInviter({
    telegramId: '900',
    rawUsername: 'VERIFIEDLEGACY',
  });
  assert.equal(verifiedLegacyAmbiguous.code, 'referral_username_ambiguous');
  assert.equal(verifiedLegacyAmbiguous.consumesAttempt, false);
  db.prepare("UPDATE customers SET telegram_username = 'legacy_duplicate_old' WHERE id = 'verified_legacy_duplicate'").run();
  customer('new_referral_no_issue', '105', 'NewReferral', {
    authorized: true,
    source: 'referral',
    botVerified: true,
  });
  assert.equal(referral.isCustomerAccessAuthorized('new_referral_no_issue'), true);
  assert.equal(
    referral.inspectInviter({ telegramId: '900', rawUsername: 'NewReferral' }).code,
    'referral_inviter_not_eligible',
  );

  const disallowed = referral.addDisallowedInviterUsernames(['@Admin_User', 'admin_user'], 'admin');
  assert.deepEqual(disallowed.map((item) => item.username), ['admin_user']);
  const reserved = referral.inspectInviter({ telegramId: '900', rawUsername: '@ADMIN_USER' });
  assert.equal(reserved.code, 'referral_inviter_reserved');
  assert.equal(reserved.consumesAttempt, false);
  referral.recordReferralOutcome({ identity: identity(), rawUsername: '@ADMIN_USER', result: reserved });
  assert.equal(referral.getReferralAuthorizationStatus('900').attempts_used, 0);
  assert.throws(
    () => referral.addDisallowedInviterUsernames(['корень'], 'admin'),
    (error) => error.code === 'username_invalid',
  );
  assert.equal(referral.removeDisallowedInviterUsername('ADMIN_USER'), true);
  assert.equal(referral.isDisallowedInviterUsername('admin_user'), false);

  assert.equal(referral.inspectInviter({ telegramId: '100', rawUsername: 'Good_User' }).code, 'referral_self_invite');
  customer('legacy_self', null, 'legacy_self', { authorized: true });
  order('legacy_self_order', 6, 'legacy_self', 'delivered');
  assert.equal(referral.inspectInviter({
    telegramId: '999',
    telegramUsername: 'LEGACY_SELF',
    rawUsername: '@legacy_self',
  }).code, 'referral_self_invite');
  assert.equal(referral.inspectInviter({ telegramId: '900', rawUsername: 'DeletedOne' }).code, 'referral_inviter_not_eligible');

  customer('duplicate', '103', 'good_user', { authorized: true });
  order('duplicate_order', 4, 'duplicate', 'delivered');
  const ambiguous = referral.inspectInviter({ telegramId: '900', rawUsername: 'GOOD_USER' });
  assert.equal(ambiguous.code, 'referral_username_ambiguous');
  referral.recordReferralOutcome({ identity: identity(), rawUsername: 'GOOD_USER', result: ambiguous });
  assert.equal(referral.getReferralAuthorizationStatus('900').attempts_used, 0);
  db.prepare("UPDATE customers SET telegram_username = 'former_good' WHERE id = 'duplicate'").run();

  const ordinaryBlock = blocks.createBlock({ customer_id: 'eligible', reason: 'test', blocked_by: 'admin' });
  const blockedInviter = referral.inspectInviter({ telegramId: '900', rawUsername: 'Good_User' });
  assert.equal(blockedInviter.code, 'referral_inviter_blocked');
  referral.recordReferralOutcome({ identity: identity(), rawUsername: 'Good_User', result: blockedInviter });
  assert.equal(referral.getReferralAuthorizationStatus('900').attempts_used, 0);
  blocks.unblockCustomerBlock(ordinaryBlock.block.id);

  // Если обычный бан появился между проверкой и записью ошибки, попытка не
  // расходуется и скрытый вечный authorization_failed не создаётся.
  customer('attempt_race_customer', '905', 'attempt_race');
  const raceWrong = referral.inspectInviter({ telegramId: '905', rawUsername: 'Unknown_User' });
  referral.recordReferralOutcome({ identity: identity('905', 'attempt_race'), rawUsername: 'Unknown_User', result: raceWrong });
  referral.recordReferralOutcome({ identity: identity('905', 'attempt_race'), rawUsername: 'Unknown_User', result: raceWrong });
  const raceOrdinaryBlock = blocks.createBlock({
    customer_id: 'attempt_race_customer',
    reason: 'обычный бан в гонке',
    blocked_by: 'admin',
  });
  const racedStatus = referral.recordReferralOutcome({
    identity: identity('905', 'attempt_race'),
    rawUsername: 'Unknown_User',
    result: raceWrong,
  });
  assert.equal(racedStatus.customer_blocked, true);
  assert.equal(racedStatus.attempts_used, 2);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM customer_blocks WHERE customer_id = ? AND block_type = 'authorization_failed'")
      .get('attempt_race_customer').count,
    0,
  );
  blocks.unblockCustomerBlock(raceOrdinaryBlock.block.id);
  assert.equal(referral.getReferralAuthorizationStatus('905').blocked, false);
  assert.equal(referral.getReferralAuthorizationStatus('905').attempts_remaining, 1);

  const inviteBan = referral.createInviteBan({ customerId: 'eligible', reason: 'кого попало', bannedBy: 'admin' });
  db.prepare("UPDATE customers SET telegram_username = 'RenamedGood' WHERE id = 'eligible'").run();
  customer('eligible_duplicate', '107', 'RenamedGood', { authorized: true });
  order('eligible_duplicate_order', 14, 'eligible_duplicate', 'delivered');
  const forbidden = referral.inspectInviter({ telegramId: '900', rawUsername: 'RenamedGood' });
  assert.equal(forbidden.code, 'referral_inviter_forbidden');
  assert.equal(forbidden.consumesAttempt, true);
  referral.recordReferralOutcome({ identity: identity(), rawUsername: 'RenamedGood', result: forbidden });
  assert.equal(referral.getReferralAuthorizationStatus('900').attempts_used, 1);
  const combinedBlock = blocks.createBlock({ customer_id: 'eligible', reason: 'оба запрета', blocked_by: 'admin' });
  assert.equal(
    referral.inspectInviter({ telegramId: '900', rawUsername: 'RenamedGood' }).code,
    'referral_inviter_forbidden',
  );
  blocks.unblockCustomerBlock(combinedBlock.block.id);
  assert.equal(referral.removeInviteBan(inviteBan.id, { unbannedBy: 'admin' }), true);
  db.prepare("UPDATE customers SET telegram_username = 'FormerDuplicate' WHERE id = 'eligible_duplicate'").run();
  db.prepare("UPDATE customers SET telegram_username = 'Good_User' WHERE id = 'eligible'").run();

  const pendingInviteBan = referral.createInviteBanByUsername({
    telegramUsername: 'future_inviter', reason: 'заранее', bannedBy: 'admin',
  });
  assert.equal(pendingInviteBan.kind, 'pending');
  const futureForbidden = referral.inspectInviter({ telegramId: '910', rawUsername: 'future_inviter' });
  assert.equal(futureForbidden.code, 'referral_inviter_forbidden');
  assert.equal(futureForbidden.consumesAttempt, true);
  assert.equal(referral.removePendingInviteBan(pendingInviteBan.ban.id), true);

  customer('staff_granted', '911', 'staff_granted');
  const staffGrant = referral.grantStaffAccess({ customerId: 'staff_granted', grantedBy: 'manager' });
  assert.equal(staffGrant.kind, 'active');
  assert.equal(referral.getReferralAuthorizationStatus('911').authorized, true);
  assert.equal(
    db.prepare("SELECT access_authorized_by FROM customers WHERE id = 'staff_granted'").get().access_authorized_by,
    'manager',
  );
  assert.equal(referral.listReferralAuthorizations().find((row) => row.telegram_id === '911').access_authorization_source, 'staff');
  assert.equal(referral.revokeStaffAccess('staff_granted', 'manager'), true);
  assert.equal(referral.getReferralAuthorizationStatus('911').required, true);

  customer('staff_order_customer', '913', 'staff_order_customer');
  referral.grantStaffAccess({ customerId: 'staff_order_customer', grantedBy: 'manager' });
  order('staff_order', 16, 'staff_order_customer', 'new');
  referral.attachFirstOrderToReferral('staff_order_customer', 'staff_order');
  assert.equal(referral.revokeStaffAccess('staff_order_customer', 'manager'), true);
  const enrichedStaffOrder = enrichOrdersWithRelations(
    db,
    [db.prepare("SELECT * FROM orders WHERE id = 'staff_order'").get()],
  )[0];
  assert.equal(enrichedStaffOrder.access_authorization.access_authorization_source, 'staff');

  const pendingGrant = referral.grantStaffAccess({ telegramUsername: 'future_friend', grantedBy: 'manager' });
  assert.equal(pendingGrant.kind, 'pending');
  referral.activatePendingStaffAccess(identity('912', 'future_friend'));
  assert.equal(referral.getReferralAuthorizationStatus('912').authorized, true);
  assert.equal(referral.listStaffAccessGrants().pending.length, 0);

  // Дальнейший сценарий проверяет три неизвестных username с чистого счётчика.
  db.prepare("UPDATE referral_auth_states SET attempts_used = 0, status = 'pending' WHERE telegram_id = '900'").run();

  const wrong = referral.inspectInviter({ telegramId: '900', rawUsername: 'Unknown_User' });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const status = referral.recordReferralOutcome({ identity: identity(), rawUsername: 'Unknown_User', result: wrong });
    assert.equal(status.attempts_used, attempt);
  }
  const failedCustomer = db.prepare("SELECT * FROM customers WHERE telegram_id = '900'").get();
  assert.equal(failedCustomer.access_authorized_at, null);
  const failedBlock = blocks.getActiveBlockForCustomerId(failedCustomer.id);
  assert.equal(failedBlock.block_type, 'authorization_failed');
  assert.equal(failedBlock.reason, 'Авторизация не пройдена');
  blocks.unblockCustomerBlock(failedBlock.id, { unblocked_by: 'admin' });
  assert.equal(referral.getReferralAuthorizationStatus('900').attempts_used, 0);
  assert.equal(referral.getReferralAuthorizationStatus('900').required, true);

  const valid = referral.inspectInviter({ telegramId: '900', rawUsername: '@Good_User' });
  const validWithoutAt = referral.inspectInviter({ telegramId: '900', rawUsername: '  Good_User  ' });
  assert.equal(valid.ok, true);
  assert.equal(validWithoutAt.ok, true);
  assert.equal(validWithoutAt.username, valid.username);
  assert.equal(validWithoutAt.inviter.id, valid.inviter.id);
  order('first_new_order', 5, failedCustomer.id, 'new');
  referral.markReferralAuthorized({
    customerId: failedCustomer.id,
    telegramId: '900',
    inviter: valid.inviter,
    submittedUsername: '@Good_User',
    orderId: 'first_new_order',
  });
  assert.equal(referral.getReferralAuthorizationStatus('900').authorized, true);
  assert.equal(referral.getReferralOrderCreationGate('900').allowed, true);
  const relation = db.prepare('SELECT * FROM customer_referrals WHERE invitee_customer_id = ?').get(failedCustomer.id);
  assert.equal(relation.inviter_customer_id, 'eligible');
  assert.equal(
    db.prepare('SELECT COUNT(*) count FROM referral_welcome_notifications WHERE customer_id = ?')
      .get(failedCustomer.id).count,
    1,
  );
  referral.markReferralAuthorized({
    customerId: failedCustomer.id,
    telegramId: '900',
    inviter: valid.inviter,
    submittedUsername: '@Good_User',
    orderId: 'first_new_order',
  });
  assert.equal(
    db.prepare('SELECT COUNT(*) count FROM referral_welcome_notifications WHERE customer_id = ?')
      .get(failedCustomer.id).count,
    1,
  );

  db.prepare("UPDATE customers SET telegram_username = 'CurrentGood' WHERE id = 'eligible'").run();
  const listRow = referral.listReferralAuthorizations().find((row) => row.telegram_id === '900');
  assert.equal(listRow.access_authorized_at, db.prepare('SELECT access_authorized_at FROM customers WHERE id = ?').pluck().get(failedCustomer.id));
  assert.equal(listRow.inviter_username, 'CurrentGood');
  db.prepare("UPDATE customers SET telegram_username = NULL WHERE id = 'eligible'").run();
  const fallbackRow = referral.listReferralAuthorizations().find((row) => row.telegram_id === '900');
  assert.equal(fallbackRow.inviter_username, 'good_user');

  // Первый заказ должен привязаться независимо от того, создал его клиент,
  // Telegram-бот или менеджер. Повторный заказ не перезаписывает первый.
  customer('channel_invitee', '904', 'channel_invitee');
  referral.markReferralAuthorized({
    customerId: 'channel_invitee',
    telegramId: '904',
    inviter: valid.inviter,
    submittedUsername: 'Good_User',
    orderId: null,
  });
  order('channel_first_order', 7, 'channel_invitee', 'new');
  assert.equal(referral.attachFirstOrderToReferral('channel_invitee', 'channel_first_order'), true);
  order('channel_second_order', 8, 'channel_invitee', 'new');
  assert.equal(referral.attachFirstOrderToReferral('channel_invitee', 'channel_second_order'), false);
  assert.equal(
    db.prepare('SELECT first_order_id FROM customer_referrals WHERE invitee_customer_id = ?')
      .get('channel_invitee').first_order_id,
    'channel_first_order',
  );

  // Даже если ранняя версия ошибочно оставила legacy-флаг, доступ даёт только
  // выданный заказ. Новый, собранный и отменённый заказ не подходят.
  customer('stale_legacy_zero', '907', 'stale_legacy_zero', { authorized: true });
  assert.equal(referral.isCustomerAccessAuthorized('stale_legacy_zero'), false);
  assert.equal(referral.getReferralAuthorizationStatus('907').required, true);
  const staleWrong = referral.inspectInviter({ telegramId: '907', rawUsername: 'Unknown_User' });
  assert.equal(
    referral.recordReferralOutcome({
      identity: identity('907', 'stale_legacy_zero'),
      rawUsername: 'Unknown_User',
      result: staleWrong,
    }).attempts_used,
    1,
  );
  order('stale_legacy_first_order', 9, 'stale_legacy_zero', 'cancelled');
  assert.equal(referral.isCustomerAccessAuthorized('stale_legacy_zero'), false);
  assert.equal(referral.getReferralAuthorizationStatus('907').required, true);
  db.prepare("UPDATE orders SET status = 'in_progress' WHERE id = 'stale_legacy_first_order'").run();
  assert.equal(referral.isCustomerAccessAuthorized('stale_legacy_zero'), false);
  db.prepare("UPDATE orders SET status = 'completed' WHERE id = 'stale_legacy_first_order'").run();
  assert.equal(referral.isCustomerAccessAuthorized('stale_legacy_zero'), true);
  assert.equal(referral.getReferralAuthorizationStatus('907').required, false);

  // Адверсариальный случай: менеджер выдал заказ между внешней проверкой и
  // записью третьей ошибки. Вечный authorization_failed создаваться не должен.
  customer('issued_race_customer', '908', 'issued_race');
  const issuedRaceWrong = referral.inspectInviter({ telegramId: '908', rawUsername: 'Unknown_User' });
  referral.recordReferralOutcome({ identity: identity('908', 'issued_race'), rawUsername: 'Unknown_User', result: issuedRaceWrong });
  referral.recordReferralOutcome({ identity: identity('908', 'issued_race'), rawUsername: 'Unknown_User', result: issuedRaceWrong });
  order('issued_race_order', 11, 'issued_race_customer', 'new');
  db.prepare("UPDATE orders SET status = 'delivered' WHERE id = 'issued_race_order'").run();
  const issuedRaceStatus = referral.recordReferralOutcome({
    identity: identity('908', 'issued_race'),
    rawUsername: 'Unknown_User',
    result: issuedRaceWrong,
  });
  assert.equal(issuedRaceStatus.authorized, true);
  assert.equal(issuedRaceStatus.attempts_used, 2);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM customer_blocks WHERE customer_id = ? AND block_type = 'authorization_failed'")
      .get('issued_race_customer').count,
    0,
  );

  customer('staff_over_legacy', '909', 'staff_over_legacy', { authorized: true });
  referral.authorizeCustomerWithoutReferral('staff_over_legacy', 'staff');
  assert.equal(
    db.prepare("SELECT access_authorization_source FROM customers WHERE id = 'staff_over_legacy'").get()
      .access_authorization_source,
    'staff',
  );
  assert.equal(referral.isCustomerAccessAuthorized('staff_over_legacy'), true);

  referral.setReferralAuthorizationEnabled(false);
  assert.equal(referral.getReferralAuthorizationStatus('901').required, false);
  assert.equal(referral.getReferralOrderCreationGate('901').allowed, true);
  customer('feature_off_customer', '902', 'feature_off', { authorized: false });
  order('feature_off_order', 10, 'feature_off_customer', 'new');
  referral.authorizeCustomerWithoutReferral('feature_off_customer', 'feature_disabled');
  assert.equal(referral.getReferralAuthorizationStatus('902').authorized, false);
  assert.equal(referral.isCustomerAccessAuthorized('feature_off_customer'), false);

  // Новый невыданный заказ при выключенной функции не даёт обход после
  // включения. После фактической выдачи доступ появляется автоматически.
  customer('bot_feature_off_customer', '906', 'bot_feature_off');
  db.prepare("INSERT INTO categories (id, slug, name) VALUES ('bot_test_category', 'bot-test', 'Bot test')").run();
  db.prepare(`
    INSERT INTO products (id, categoryId, title, priceRub, createdAt, stock, cost_price)
    VALUES ('bot_test_product', 'bot_test_category', 'Bot product', 15, DATETIME('now'), 5, 4)
  `).run();
  const botCreatedOrder = createOrderFromBot({
    customerId: 'bot_feature_off_customer',
    product: db.prepare("SELECT * FROM products WHERE id = 'bot_test_product'").get(),
    quantity: 1,
    telegramMessageId: 1,
    originalMessage: 'заказать Bot product',
  });
  assert.equal(botCreatedOrder.pickupCellNumber, 1);
  assert.equal(
    db.prepare(
      `SELECT cell_number FROM order_pickup_cell_assignments
        WHERE order_id = ? AND released_at IS NULL`,
    ).get(botCreatedOrder.orderId).cell_number,
    1,
  );
  assert.equal(
    db.prepare('SELECT access_authorization_source FROM customers WHERE id = ?')
      .get('bot_feature_off_customer').access_authorization_source,
    'feature_disabled',
  );
  // Витрина показывает покупателю цену со скидкой, и он её же пишет в чат:
  // заказ из бота обязан списать столько же, а не полный прайс.
  const { saveDiscount } = await import('../utils/catalog-discounts.js');
  saveDiscount('product', 'bot_test_product', { price: 11, untilDate: null });
  const botDiscountOrder = createOrderFromBot({
    customerId: 'bot_feature_off_customer',
    product: db.prepare("SELECT * FROM products WHERE id = 'bot_test_product'").get(),
    quantity: 2,
    telegramMessageId: 2,
    originalMessage: 'заказать Bot product',
  });
  const botDiscountItem = db.prepare(
    'SELECT price_per_unit, total_price FROM order_items WHERE order_id = ?',
  ).get(botDiscountOrder.orderId);
  assert.equal(botDiscountItem.price_per_unit, 11);
  assert.equal(botDiscountItem.total_price, 22);
  saveDiscount('product', 'bot_test_product', { price: null });

  referral.setReferralAuthorizationEnabled(true);
  assert.equal(referral.getReferralAuthorizationStatus('902').required, true);
  assert.equal(referral.getReferralAuthorizationStatus('902').authorized, false);
  assert.equal(referral.getReferralAuthorizationStatus('906').required, true);
  db.prepare("UPDATE orders SET status = 'delivered' WHERE id = 'feature_off_order'").run();
  const botFeatureOrder = db.prepare("SELECT id FROM orders WHERE customer_id = 'bot_feature_off_customer'").get();
  db.prepare("UPDATE orders SET status = 'completed' WHERE id = ?").run(botFeatureOrder.id);
  assert.equal(referral.getReferralAuthorizationStatus('902').authorized, true);
  assert.equal(referral.getReferralAuthorizationStatus('906').authorized, true);
  console.log('referral-authorization.test.js: ok');
} finally {
  db.close();
  fs.rmSync(tmpDb, { force: true });
  fs.rmSync(`${tmpDb}-wal`, { force: true });
  fs.rmSync(`${tmpDb}-shm`, { force: true });
}
