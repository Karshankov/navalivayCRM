import { getCrmRequestHeaders, type Order } from '@/stores/crm';

export type InviterReferral = NonNullable<Order['referral']>;
export interface InviterLookupResult {
  customer: { id: string; telegram_username: string | null; first_name: string | null; last_name: string | null } | null;
  referral: InviterReferral | null;
}
export function normalizeInviterLookupUsername(value: string): string {
  return value.trim().replace(/^@+/, '');
}
export async function lookupCrmInviter(username: string, signal?: AbortSignal): Promise<InviterLookupResult> {
  const response = await fetch(`/api/admin/crm/customers/inviter?username=${encodeURIComponent(normalizeInviterLookupUsername(username))}`, {
    credentials: 'include', signal, headers: getCrmRequestHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? 'Нет доступа к поиску. Войдите в CRM и повторите попытку.'
      : data?.message || 'Не удалось найти пригласившего. Повторите попытку.');
  }
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'customer') || !Object.prototype.hasOwnProperty.call(data, 'referral')) {
    throw new Error('Не удалось получить результат поиска. Повторите попытку.');
  }
  return data as InviterLookupResult;
}
