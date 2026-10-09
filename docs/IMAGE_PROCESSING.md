# Image Processing in NAVALIVAY

## Overview

All category and category group cover images are stored as base64 in SQLite database and automatically converted to WebP format for optimal size with transparency support.

## Architecture

### Storage
- **Categories**: `categories.cover_image` (base64 WebP)
- **Category Groups**: `category_groups.cover_image` (base64 WebP)
- **Products**: Files in `/uploads/products/` (not base64)

### Auto-conversion on Upload
When uploading images through admin panel, they are automatically converted to WebP:
- `server/utils/imageUtils.js` - utility function `convertImageToWebP()`
- Applied in `server/routes/admin.js` for:
  - `POST /api/admin/categories`
  - `PUT /api/admin/categories/:id`
  - `POST /api/admin/category-groups`
  - `PUT /api/admin/category-groups/:id`

### Conversion Settings
```javascript
const IMAGE_OPTIONS = {
  maxWidth: 800,
  maxHeight: 800,
  webpQuality: 80,
  webpAlphaQuality: 90,  // Preserves transparency
};
```

## Scripts

### convert-to-webp.js
Mass conversion of existing images to WebP format.

```bash
# Dry run (preview without changes)
cd /var/www/NAVALIVAY/server
node scripts/convert-to-webp.js --dry-run

# Apply conversion
node scripts/convert-to-webp.js
```

**What it does:**
1. Converts all PNG/JPEG images in `categories` and `category_groups` tables to WebP
2. Preserves transparency (alpha channel)
3. Resizes to max 800x800px
4. Runs VACUUM to reclaim disk space
5. Typically achieves 90%+ compression

## Performance Metrics

| Format | Typical Size | Transparency |
|--------|--------------|--------------|
| PNG | 500KB - 1.5MB | ✅ Yes |
| JPEG | 50KB - 150KB | ❌ No |
| WebP | 30KB - 100KB | ✅ Yes |

**Real example from this project:**
- Before (PNG): 120 MB total
- After (WebP): 9.3 MB total
- Compression: **92%**

## Common Issues & Solutions

### Issue: Black background on images
**Cause:** PNG with transparency was converted to JPEG without specifying background color.
**Solution:** Use WebP format which supports transparency, or use `.flatten({ background: white })` before JPEG conversion.

### Issue: Slow category loading
**Cause:** Large PNG images (1MB+ each) stored as base64.
**Solution:** Convert to WebP using `convert-to-webp.js` script.

### Issue: Images not converting on upload
**Check:**
1. Is `convertImageToWebP` imported in `admin.js`?
2. Is the route handler `async`?
3. Is `await` used before `convertImageToWebP()`?

## API Optimization

Images are NOT included in list responses to save bandwidth:
- `GET /api/categories` returns `hasCoverImage: true/false` flag
- `GET /api/categories/:id/image` returns actual image
- Frontend caches images in Pinia store (`catalog.ts`)

## File Locations

| File | Purpose |
|------|---------|
| `server/utils/imageUtils.js` | WebP conversion utility |
| `server/scripts/convert-to-webp.js` | Mass conversion script |
| `server/routes/admin.js` | Admin API with auto-conversion |

## History

- **January 2026**: Migrated from PNG/JPEG to WebP
- Previous `compress-images.js` script converted to JPEG and lost transparency
- WebP provides best of both worlds: small size + transparency
