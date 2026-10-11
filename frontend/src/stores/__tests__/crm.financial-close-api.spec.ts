import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestFinancialDayClose, StaffApiError } from '../crm';

let previousToken: string | null;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  previousToken = window.localStorage.getItem('admin_token');
  window.localStorage.setItem('admin_token', 'financial-test-admin');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ business_date: '2026-10-12' })));
});
afterEach(() => {
  if (previousToken === null) window.localStorage.removeItem('admin_token');
  else window.localStorage.setItem('admin_token', previousToken);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
describe('financial-close request boundary', () => {
  it('preserves CRM credentials, dashboard unlock and idempotency headers', async () => {
    await requestFinancialDayClose('/complete', { method: 'POST', headers: { 'Idempotency-Key': 'fclose_test_123456789' }, body: '{}' }, 'dashboard-access');
    expect(fetch).toHaveBeenCalledWith('/api/admin/crm/financial-close/complete', expect.objectContaining({ credentials: 'include', headers: expect.objectContaining({ Authorization: 'Bearer financial-test-admin', 'Content-Type': 'application/json', 'X-Dashboard-Token': 'dashboard-access', 'Idempotency-Key': 'fclose_test_123456789' }) }));
  });
  it.each([{}, [], null])('rejects unusable success payload %s as uncertain', async value => {
    vi.mocked(fetch).mockResolvedValue(response(value));
    await expect(requestFinancialDayClose('/complete')).rejects.toMatchObject({ outcomeUnknown: true, code: 'financial_close_invalid_response' });
  });
  it('treats unreadable success JSON as uncertain', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));
    await expect(requestFinancialDayClose('/complete')).rejects.toMatchObject({ outcomeUnknown: true });
  });
  it('preserves unknown outcome after a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Network error'));
    await expect(requestFinancialDayClose('/complete')).rejects.toMatchObject({ outcomeUnknown: true });
  });
  it('does not treat server failures as proof that no write happened', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ error: 'financial_close_failed' }, 500));
    await expect(requestFinancialDayClose('/complete')).rejects.toMatchObject({ status: 500, outcomeUnknown: true });
  });
  it('keeps a definite business rejection distinguishable from lost responses', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ error: 'closing_preview_stale' }, 409));
    try { await requestFinancialDayClose('/complete'); throw new Error('Expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(StaffApiError);
      expect(error).toMatchObject({ code: 'closing_preview_stale', status: 409 });
      expect((error as StaffApiError).outcomeUnknown).not.toBe(true);
    }
  });
  it('rejects non-financial endpoints without contacting the server', async () => {
    await expect(requestFinancialDayClose('/../../cash-transactions')).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
