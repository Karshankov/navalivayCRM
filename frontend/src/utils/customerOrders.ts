import { withTelegramAuthHeaders } from "@/utils/telegramAuth";

export interface CustomerOrderCartItem {
  productId: string;
  title: string;
  productTitle?: string | null;
  groupName?: string | null;
  priceRub: number;
  quantity: number;
  image?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  groupId?: string | null;
  categoryId?: string | null;
  loyaltyUnitsApplied?: number;
}

export interface CustomerOrderItem {
  id: string;
  product_id: string | null;
  product_title: string;
  product_description?: string | null;
  group_name?: string | null;
  base_product_id?: string | null;
  base_product_title?: string | null;
  variant_id?: string | null;
  variant_name?: string | null;
  quantity: number;
  price_per_unit: number;
  manual_discount_amount?: number;
  loyalty_discount_amount?: number;
  loyalty_units_applied?: number;
  discount_amount: number;
  total_price: number;
  total_cost: number;
  image?: string | null;
  cart_item: CustomerOrderCartItem;
}

export interface CustomerActiveOrder {
  found: boolean;
  id: string;
  order_number: number;
  status: "new" | "in_progress" | "completed" | "delivered" | "cancelled";
  pickup_cell_number: number | null;
  delivery_type: "pickup" | "delivery";
  delivery_address: string | null;
  phone: string | null;
  notes: string | null;
  total_amount: number;
  discount_amount: number;
  final_amount: number;
  promo_code_text: string | null;
  is_wholesale: number;
  wholesale_tier_id: string | null;
  wholesale_code: string | null;
  wholesale_secret: string | null;
  wholesale_tier_label: string | null;
  wholesale_min_amount: number | null;
  telegram_username: string | null;
  created_at: string;
  updated_at: string;
  needs_manager_action: number;
  manager_action_type: "modified" | "cancelled_by_customer" | null;
  manager_action_note: string | null;
  can_edit: boolean;
  can_cancel: boolean;
  items: CustomerOrderItem[];
}

export interface CustomerIdentity {
  telegramId: string;
  telegramUsername: string;
  firstName: string;
  lastName: string;
}

export function normalizeTelegramUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
}

export function getTelegramIdentity(): CustomerIdentity {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;

  return {
    telegramId: user?.id ? String(user.id) : "",
    telegramUsername: normalizeTelegramUsername(user?.username),
    firstName: user?.first_name || "",
    lastName: user?.last_name || "",
  };
}

export function buildCustomerIdentityQuery(identity: CustomerIdentity) {
  const params = new URLSearchParams();

  if (identity.telegramId) {
    params.set("telegram_id", identity.telegramId);
  }

  if (identity.telegramUsername) {
    params.set("telegram_username", identity.telegramUsername);
  }

  return params;
}

export async function fetchMyActiveOrder(
  identity: CustomerIdentity = getTelegramIdentity(),
): Promise<CustomerActiveOrder | null> {
  const query = buildCustomerIdentityQuery(identity);
  const hasTelegramAuth = Boolean(window.Telegram?.WebApp?.initData);
  if (!query.toString() && !hasTelegramAuth) {
    return null;
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`/api/orders/my-active${suffix}`, {
    headers: withTelegramAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error("Не удалось загрузить активный заказ");
  }

  const data = await response.json();
  if (!data?.found) {
    return null;
  }

  return data as CustomerActiveOrder;
}
