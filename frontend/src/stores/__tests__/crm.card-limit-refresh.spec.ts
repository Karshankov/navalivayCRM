import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCrmStore, type CardPaymentAdminSnapshot } from '../crm';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const fixture = (remaining: number) => ({
  limits: { remaining_today_minor: remaining },
  accounts: [], pending_accounts: [], tariffs: [], requests: [], operations: [],
} as CardPaymentAdminSnapshot);

describe('card limit background refresh', () => {
  it('preserves the normal modal fetch behavior', async () => {
    const store = useCrmStore();
    const snapshot = fixture(5500);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot))));
    await store.fetchCardPaymentAdmin();
    expect(store.cardPaymentAdminSnapshot).toEqual(snapshot);
    expect(store.loadingCardPaymentAdmin).toBe(false);
  });

  it('does not replace newer modal data when a background response arrives late', async () => {
    const store = useCrmStore();
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    const previous = store.cardPaymentAdminSnapshot;
    const pending = store.fetchCardPaymentAdmin({
      background: true,
      shouldApply: () => store.cardPaymentAdminSnapshot === previous,
    });
    expect(store.loadingCardPaymentAdmin).toBe(false);
    const newer = fixture(1200);
    store.cardPaymentAdminSnapshot = newer;
    resolve(new Response(JSON.stringify(fixture(5500))));
    await pending;
    expect(store.cardPaymentAdminSnapshot).toEqual(newer);
  });

  it('does not clear the modal loading state during a background refresh', async () => {
    const store = useCrmStore();
    store.loadingCardPaymentAdmin = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture(5500)))));
    await store.fetchCardPaymentAdmin({ background: true, shouldApply: () => false });
    expect(store.loadingCardPaymentAdmin).toBe(true);
    expect(store.cardPaymentAdminSnapshot).toBeNull();
  });

  it('keeps the last snapshot and propagates a failed request', async () => {
    const store = useCrmStore();
    const snapshot = fixture(5500);
    store.cardPaymentAdminSnapshot = snapshot;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(store.fetchCardPaymentAdmin({ background: true })).rejects.toThrow();
    expect(store.cardPaymentAdminSnapshot).toEqual(snapshot);
    expect(store.loadingCardPaymentAdmin).toBe(false);
  });
});
