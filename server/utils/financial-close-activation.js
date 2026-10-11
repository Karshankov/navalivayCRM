/** Financial-day closing is opt-in. Enabling it requires a verified backup. */
export function isFinancialCloseEnabled(env = process.env) {
  return ['1', 'true'].includes(String(env.FINANCIAL_DAY_CLOSE_ENABLED || '').trim().toLowerCase());
}

/** Read-only preflight, called before initDb performs any migrations. */
export function assertFinancialCloseDatabaseReady(database, env = process.env) {
  if (!isFinancialCloseEnabled(env)) return false;

  try {
    const checks = database.pragma('quick_check');
    const integrityOk = checks.length === 1
      && Object.values(checks[0]).length === 1
      && Object.values(checks[0])[0] === 'ok';
    if (!integrityOk || database.pragma('foreign_key_check').length !== 0) {
      throw new Error('invalid_database');
    }
  } catch {
    const error = new Error('Закрытие финансового дня не включено: база не прошла проверку целостности. Необходимо отдельно проверить и восстановить базу; автоматическое исправление не выполняется.');
    error.code = 'financial_close_database_invalid';
    throw error;
  }

  return true;
}
