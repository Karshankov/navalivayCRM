export function isNumericCrmOrderSearch(searchTerm) {
  return /^\d+$/.test(String(searchTerm || '').trim());
}

export function escapeSqlLike(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function buildCrmOrdersSearch({ searchTerm, pickupCellCapacity = 0 }) {
  const term = String(searchTerm || '').trim();

  if (!term) {
    return {
      whereClause: '',
      params: [],
      orderBy: 'o.created_at DESC',
      orderByParams: [],
      mode: 'none',
    };
  }

  const orderNumberWithHash = term.match(/^#\s*(\d+)$/);
  const numericSearchTerm = orderNumberWithHash?.[1] || term;

  if (isNumericCrmOrderSearch(numericSearchTerm)) {
    const numericTerm = Number(numericSearchTerm);
    if (
      !orderNumberWithHash &&
      Number.isInteger(numericTerm) &&
      numericTerm >= 1 &&
      numericTerm <= Number(pickupCellCapacity || 0)
    ) {
      return {
        whereClause: `EXISTS (
          SELECT 1
          FROM order_pickup_cell_assignments pca
          WHERE pca.order_id = o.id
            AND pca.released_at IS NULL
            AND pca.cell_number = ?
        )`,
        params: [numericTerm],
        orderBy: 'o.created_at DESC',
        orderByParams: [],
        mode: 'pickup_cell_exact',
      };
    }
    return {
      whereClause: `o.order_number_search LIKE ? ESCAPE '\\'`,
      params: [`${escapeSqlLike(numericSearchTerm)}%`],
      orderBy: `CASE WHEN o.order_number_search = ? THEN 0 ELSE 1 END, o.created_at DESC`,
      orderByParams: [numericSearchTerm],
      mode: 'order_number_prefix',
    };
  }

  const likePattern = `%${term}%`;
  return {
    whereClause: `(CAST(o.order_number AS TEXT) LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.telegram_username LIKE ? OR o.telegram_username LIKE ?)`,
    params: [likePattern, likePattern, likePattern, likePattern, likePattern],
    orderBy: 'o.created_at DESC',
    orderByParams: [],
    mode: 'legacy',
  };
}
