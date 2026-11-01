import { withTelegramAuthHeaders } from "@/utils/telegramAuth";

/**
 * Избранное клиента мини-аппа: одна запись — товар или конкретный
 * вкус/вариант (variantId null у товаров без вариантов).
 */

export interface FavoriteItem {
  productId: string;
  variantId: string | null;
  createdAt: string;
  /** Товар удалён админом: карточка остаётся, но заказать нельзя. */
  deleted: boolean;
  title: string | null;
  /** Линейка товара: для группировки на странице избранного. */
  groupId: string | null;
  groupName: string | null;
  /** Ручной порядок линейки (drag-n-drop), null — по времени. */
  groupPosition: number | null;
  variantName: string | null;
  /** Крепость (жидкости): как metaText в каталоге. */
  strength: string | null;
  priceRub: number | null;
  image: string | null;
  stock: number | null;
  inStock: boolean;
}

/** Линейка в избранном: группа + её позиции. */
export interface FavoriteGroup {
  groupId: string;
  groupName: string | null;
  groupSlug: string | null;
  groupCover: string | null;
  groupPosition: number | null;
  groupUnavailable: boolean;
  totalCount: number;
  items: FavoriteItem[];
}

interface RawFavoriteGroup {
  group_id: string;
  group_name: string | null;
  group_slug: string | null;
  group_cover: string | null;
  group_position: number | null;
  group_unavailable: boolean;
  total_count: number;
  items: RawFavoriteItem[];
}

function normalizeFavoriteGroup(raw: RawFavoriteGroup): FavoriteGroup {
  return {
    groupId: String(raw.group_id || ""),
    groupName: raw.group_name ?? null,
    groupSlug: raw.group_slug ?? null,
    groupCover: raw.group_cover ?? null,
    groupPosition: raw.group_position != null ? Number(raw.group_position) : null,
    groupUnavailable: Boolean(raw.group_unavailable),
    totalCount: Number(raw.total_count ?? 0),
    items: Array.isArray(raw.items) ? raw.items.map(normalizeFavoriteItem) : [],
  };
}

interface RawFavoriteItem {
  product_id: string;
  variant_id: string | null;
  created_at: string;
  deleted: boolean;
  title: string | null;
  group_id: string | null;
  group_name: string | null;
  group_position: number | null;
  variant_name: string | null;
  strength: string | null;
  priceRub: number | null;
  image: string | null;
  stock: number | null;
  in_stock: boolean;
}

function normalizeFavoriteItem(raw: RawFavoriteItem): FavoriteItem {
  return {
    productId: String(raw.product_id || ""),
    variantId: raw.variant_id ? String(raw.variant_id) : null,
    createdAt: String(raw.created_at || ""),
    deleted: Boolean(raw.deleted),
    title: raw.title ?? null,
    groupId: raw.group_id ? String(raw.group_id) : null,
    groupName: raw.group_name ?? null,
    groupPosition: raw.group_position != null ? Number(raw.group_position) : null,
    variantName: raw.variant_name ?? null,
    strength: raw.strength ?? null,
    priceRub: raw.priceRub != null ? Number(raw.priceRub) : null,
    image: raw.image ?? null,
    stock: raw.stock != null ? Number(raw.stock) : null,
    inStock: Boolean(raw.in_stock),
  };
}

export class FavoritesAuthError extends Error {
  constructor() {
    super("Требуется авторизация Telegram Mini App");
    this.name = "FavoritesAuthError";
  }
}

export class FavoritesNotFoundError extends Error {
  constructor() {
    super("Товар не найден");
    this.name = "FavoritesNotFoundError";
  }
}

async function parseFavoritesResponse(response: Response) {
  if (response.status === 401) {
    throw new FavoritesAuthError();
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 400 && data?.error === "invalid_request") {
      throw new FavoritesNotFoundError();
    }
    if (
      response.status === 400 &&
      (data?.error === "product_not_found" ||
        data?.error === "variant_not_found" ||
        data?.error === "variant_required")
    ) {
      throw new FavoritesNotFoundError();
    }
    throw new Error("Не удалось обновить избранное");
  }
  return data;
}

/** Полный ответ /api/favorites: плоский список + линейки. */
export interface FavoritesPayload {
  items: FavoriteItem[];
  groups: FavoriteGroup[];
  ungrouped: FavoriteItem[];
}

export async function fetchFavoritesApi(): Promise<FavoritesPayload> {
  const response = await fetch("/api/favorites", {
    headers: withTelegramAuthHeaders(),
  });
  const data = await parseFavoritesResponse(response);
  const items = Array.isArray(data?.items) ? data.items.map(normalizeFavoriteItem) : [];
  const groups = Array.isArray(data?.groups) ? data.groups.map(normalizeFavoriteGroup) : [];
  const ungrouped = Array.isArray(data?.ungrouped)
    ? data.ungrouped.map(normalizeFavoriteItem)
    : [];
  return { items, groups, ungrouped };
}

export async function addFavoriteApi(
  productId: string,
  variantId: string | null,
): Promise<void> {
  const response = await fetch("/api/favorites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...withTelegramAuthHeaders(),
    },
    body: JSON.stringify({ product_id: productId, variant_id: variantId ?? "" }),
  });
  await parseFavoritesResponse(response);
}

/** Добавить в избранное всю линейку: каждый вкус — отдельной записью. */
export async function addFavoriteGroupApi(groupId: string): Promise<number> {
  const response = await fetch("/api/favorites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...withTelegramAuthHeaders(),
    },
    body: JSON.stringify({ group_id: groupId }),
  });
  if (response.status === 404) {
    throw new FavoritesNotFoundError();
  }
  const data = await parseFavoritesResponse(response);
  return Number(data?.inserted ?? 0);
}

/** Убрать из избранного все записи линейки одним запросом. */
export async function removeFavoriteGroupApi(groupId: string): Promise<number> {
  const response = await fetch("/api/favorites", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...withTelegramAuthHeaders(),
    },
    body: JSON.stringify({ group_id: groupId }),
  });
  const data = await parseFavoritesResponse(response);
  return Number(data?.removed ?? 0);
}

/** Сохранить ручной порядок линеек после drag-n-drop. */
export async function reorderFavoritesApi(groupIds: string[]): Promise<void> {
  const response = await fetch("/api/favorites/reorder", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...withTelegramAuthHeaders(),
    },
    body: JSON.stringify({ group_ids: groupIds }),
  });
  await parseFavoritesResponse(response);
}

export async function removeFavoriteApi(
  productId: string,
  variantId: string | null,
): Promise<void> {
  const response = await fetch("/api/favorites", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...withTelegramAuthHeaders(),
    },
    body: JSON.stringify({ product_id: productId, variant_id: variantId ?? "" }),
  });
  await parseFavoritesResponse(response);
}
