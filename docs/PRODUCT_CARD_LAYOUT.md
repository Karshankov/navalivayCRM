# Product Card Layout - Image Areas

## Overview

This doc describes layout of **product image containers** in list/card views: padding around photos and how images fill the box. It does not cover variant color circles, full-page product view, or backend image processing (see `IMAGE_PROCESSING.md`).

User-facing goal: less "air" around product photos, images feel larger inside the same box.

## Components and CSS Classes

| Component | Image container class | Where used |
|-----------|-----------------------|------------|
| `LiquidLineCard.vue` | `.liquid-line-image`, `.liquid-subline-image` | Category "Жидкости", liquid lines |
| `GroupLineItem.vue` | `.group-line-image` | Category groups (линейки) in default/visual mode |
| `SingleProductCard.vue` | `.single-product-image` | Single-product cards (no variants) |

## Convention (January 2026)

- **Padding:** 6px baseline; 4px (or 2px) on small breakpoints. Avoid 0 or 12px for consistency.
- **Image fill:** `img { max-width: 100%; max-height: 100%; object-fit: contain; }` so the photo fills the container without cropping.
- **Responsive:** In media queries that change the image block size, keep small padding (4px or 2px) and `img` at 100% so layout stays consistent.

## File Locations

| File | Contains |
|------|---------|
| `frontend/src/components/product/liquid/LiquidLineCard.vue` | `.liquid-line-image`, `.liquid-subline-image` |
| `frontend/src/components/product/GroupLineItem.vue` | `.group-line-image` |
| `frontend/src/components/product/SingleProductCard.vue` | `.single-product-image` |

## For AI Agents

### What was changed (January 2026)

- **LiquidLineCard:** `.liquid-line-image` / `.liquid-subline-image` padding 12px -> 6px; `img` from fixed `max-width: 65px; max-height: 66px` to `max-width: 100%; max-height: 100%`. Media queries (1024, 768, 480, 360) use 6px or 4px padding and img 100% where overridden.
- **GroupLineItem:** `.group-line-image` padding 12px -> 6px; `img` to 100%. Some breakpoints had `padding: 0`; those were set to 6px/4px so liquid vs device cards look consistent.
- **SingleProductCard:** `.single-product-image` got `padding: 6px`; `img` from 90% to 100%. In media queries that resize the image block, added 4px or 2px padding and `img { max-width: 100%; max-height: 100% }`.

### Pitfalls and non-obvious details

1. **GroupLineItem had mixed padding**  
   Several media queries used `padding: 0` while others used 12px. Changing all to 6px/4px avoided inconsistent "air" between liquid lines and device lines. If you reintroduce `padding: 0` in one breakpoint, check others so behaviour is intentional.

2. **SingleProductCard had no padding and 90% img**  
   It looked different from LiquidLineCard/GroupLineItem. Adding 6px/4px/2px and img 100% aligned it with the rest. When adding new card types, reuse this convention.

3. **Scope of "photo area"**  
   The "photo area" in this doc is the **product image container** in list/card views (liquid lines, group lines, single product cards). It is not: variant color circles, full-page product gallery, or category/group cover images in headers.

4. **Build and unrelated warnings**  
   After layout edits, run `cd frontend && npm run build-only`. A pre-existing CSS warning ("Expected identifier but found '&'" in scrollbar-hide / `::-webkit-scrollbar`) is unrelated to image layout; no need to change it when updating product image areas.

5. **object-fit**  
   Keep `object-fit: contain` so images are not cropped when aspect ratio differs from the box.

## Related Docs

- `docs/CATEGORY_GROUPS_DISPLAY.md` - where GroupLineItem and liquid trees are used
- `docs/CSS_ANIMATIONS.md` - expand/collapse in the same components
- `docs/IMAGE_PROCESSING.md` - backend image format, WebP, uploads
