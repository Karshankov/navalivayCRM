# CRM Product Search

## Overview

The CRM product search endpoint (`/api/admin/crm/products/search`) is used in:
- Procurements (Закупки) - `CrmProcurements.vue`
- Write-offs (Списания) - `CrmWriteOffs.vue`
- Order editing - `CrmOrderDetail.vue`
- Order creation - `OrderCreateModal.vue`

There is also a separate search in the **Admin Products Table** (`/admin?tab=products`) which uses `/api/admin/products` endpoint.

---

## Admin Products Table Search

### Endpoint

```
GET /api/admin/products?search=...&page=1&limit=20
```

### Search Fields

The admin products search looks in:
- `p.title` - Product title
- `p.description` - Product description
- `g.name` - **Group/line name** (e.g., "ANNIMA LOVE [70MG]")

### Important: Double Filtering

The search happens in TWO places:
1. **Backend** (`server/routes/admin.js`) - SQL query with WHERE clause
2. **Frontend** (`AdminProductsTable.vue`) - `filteredProducts` computed property

Both must search the same fields! If backend finds results but frontend filters them out, UI shows 0 items.

### Backend SQL (admin.js)

```javascript
if (search) {
  const trimmed = search.trim();
  const lowerPat = `%${trimmed.toLowerCase()}%`;
  const upperPat = `%${trimmed.toUpperCase()}%`;
  const titlePat = `%${trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()}%`;
  
  where += '(p.title LIKE ? OR p.title LIKE ? OR p.title LIKE ? ' +
           'OR p.description LIKE ? OR p.description LIKE ? OR p.description LIKE ? ' +
           'OR g.name LIKE ? OR g.name LIKE ? OR g.name LIKE ?)';
  params.push(lowerPat, upperPat, titlePat, lowerPat, upperPat, titlePat, lowerPat, upperPat, titlePat);
}

// COUNT query MUST include JOIN for g.name to work
const total = db.prepare(`
  SELECT COUNT(*) as total FROM products p 
  LEFT JOIN category_groups g ON p.groupId = g.id 
  ${where}
`).get(...params).total;
```

### Frontend Filter (AdminProductsTable.vue)

```javascript
const filteredProducts = computed(() => {
  const s = search.value.toLowerCase()
  return (props.products || []).filter(p => {
    // Search by title AND groupName
    const bySearch = !s || 
      (p.title || '').toLowerCase().includes(s) || 
      (p.groupName || '').toLowerCase().includes(s)
    return bySearch && byCat && byGroup
  })
})
```

### Troubleshooting Admin Search

**Problem:** Search returns 0 results but products exist.

**Debug steps:**
1. Add backend logging to check API response
2. If API returns `total > 0` but UI shows 0 → frontend filtering issue
3. If API returns `total = 0` → backend SQL issue (check JOINs)

```bash
# Check if products exist with that group name
sqlite3 server/data/navalivay.db "
  SELECT p.title, g.name FROM products p 
  LEFT JOIN category_groups g ON p.groupId = g.id 
  WHERE g.name LIKE '%ANNIMA%' LIMIT 5
"
```

---

## API Endpoint

```
GET /api/admin/crm/products/search
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | - | Search query (split into words) |
| `limit` | number | 25 | Max results to return |

### Response

```json
[
  {
    "id": "prod_123",
    "title": "Сочный персик",
    "priceRub": 350,
    "cost_price": 180,
    "stock": 25,
    "min_stock": 5,
    "categoryId": "cat_1",
    "category_name": "Жидкости",
    "groupId": "grp_1",
    "group_name": "ANNIMA LOVE [70MG]",
    "imageUrl": "/uploads/products/image.webp",
    "is_variant": false
  }
]
```

**Note:** `imageUrl` contains only the image URL path, NOT base64 data. This keeps response size small (~50-100 KB instead of 4-12 MB).

The endpoint may also return a final `image` field for UI cards, but it must not expose raw `group_image` / `category_image` blobs in every result row. Those source fields are only used server-side to compose the final fallback image.

## Search Logic

### AND Logic (All Words Must Match)

The search splits the query into words and requires ALL words to be present:

```
Query: "Anima Love сочный персик"
Words: ["Anima", "Love", "сочный", "персик"]

Result: Products where ALL 4 words are found in:
- title OR
- description OR  
- group_name (линейка)
```

### Examples

| Query | Finds |
|-------|-------|
| `сочный персик` | All products with "сочный" AND "персик" |
| `Anima Love` | All products from ANIMA LOVE line |
| `Anima Love сочный персик` | Only "Сочный персик" from ANIMA LOVE |
| `70MG` | All products from lines with [70MG] |

### Cyrillic Case Handling

SQLite's `LOWER()` doesn't work with Cyrillic. The search checks multiple case variants:
- lowercase: `%сочный%`
- UPPERCASE: `%СОЧНЫЙ%`
- Title Case: `%Сочный%`

## Relevance Sorting

When a search query is provided, results are sorted by relevance:

1. **Exact match** - title equals search query
2. **Starts with** - title starts with search query
3. **Contains full query** - title contains entire search string
4. **Word match count** - more matching words = higher rank
5. **Alphabetical** - fallback sorting

## Performance

### Optimizations Applied (January 2026)

| Metric | Before | After |
|--------|--------|-------|
| Response time | 10-28 sec | <500 ms |
| Response size | 4-12 MB | 50-100 KB |

### Key Changes

1. **Removed base64 images from response**
   - `group_cover_image` no longer selected in SQL
   - `variant_color_image` no longer selected
   - Only `imageUrl` (URL path) is returned

2. **Changed OR to AND logic**
   - Before: Any word matches → too many results
   - After: All words must match → precise results

3. **Added relevance sorting**
   - Exact matches appear first
   - Users find products faster

### Regression Fix (March 2026)

**Symptom**
- In order editing / order creation, product search could show `Ищем товары…` for a long time even when SQL itself was fast.
- This was most visible in flows using `limit=100` (`CrmOrderDetail.vue`, `OrderCreateModal.vue`).

**Root cause**
- The endpoint still returned duplicated raw image sources (`group_image`, `category_image`) for every search result.
- At the same time it also built the final `image` field, so the response kept both the final image and the source blobs.
- In logs this could inflate a single response to ~13.7 MB for a wide search like `last`.

**Fix**
- Keep product images in search results.
- Strip duplicated raw image fields from the JSON response.
- Return only the fields needed by the frontend: `imageUrl` and the final fallback `image`.

**Expected result after fix**
- Search still shows images in CRM.
- Order edit/create search no longer stalls because the browser downloads and parses a much smaller payload.

## Frontend Usage

### In Procurements (`CrmProcurements.vue`)

```typescript
import { useCrmStore } from '@/stores/crm'

const crmStore = useCrmStore()

// Search with high limit for large product lines
const results = await crmStore.searchCrmProducts({ 
  search: 'Anima Love сочный', 
  limit: 100 
})
```

### Debounce

The frontend uses 250ms debounce to avoid excessive API calls:

```typescript
watch(productSearch, (query) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    if (query.trim().length >= 2) {
      loadProducts(query.trim())
    }
  }, 250)
})
```

## Troubleshooting

### Search Returns Too Many Results

Check if search logic is using AND:
```javascript
// In crm-finance.js, line ~779
whereClauses.push(`(${wordConditions.join(' AND ')})`);  // Should be AND
```

### Search is Slow

Check response size in server logs:
```bash
cat /tmp/server.log | grep "products/search"
# Look for size > 1MB - usually indicates oversized image fields in response
```

Expected response shape:
- keep `imageUrl`
- keep final `image`
- do not return raw `group_image` / `category_image` blobs to the client

If timing logs are enabled in `crm-finance.js`, also check:
- `regularQueryMs` / `variantsQueryMs` - SQL time
- `totalMs` - total route time

If SQL is fast but payload size is huge, the bottleneck is response serialization / download / browser parsing, not the search query itself.

### Products Not Found

1. Check if product has `groupId` set
2. Check if search words are at least 2 characters
3. Try searching by group name instead of product title

## File Locations

| Component | File |
|-----------|------|
| CRM search API endpoint | `server/routes/crm-finance.js` |
| Admin products API endpoint | `server/routes/admin.js` |
| Frontend CRM store | `frontend/src/stores/crm.ts` |
| Frontend Admin store | `frontend/src/stores/admin.ts` |
| Admin products table | `frontend/src/components/admin/AdminProductsTable.vue` |
| Procurements page | `frontend/src/views/admin/crm/CrmProcurements.vue` |
| Write-offs page | `frontend/src/views/admin/crm/CrmWriteOffs.vue` |
