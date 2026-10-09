# CSS Animations in NAVALIVAY

## Overview

This document describes the CSS animation patterns used in the project, particularly for expand/collapse functionality in product lines and product cards.

## Key Components

| Component | Animation Type | Description |
|-----------|---------------|-------------|
| `GroupLineItem.vue` | CSS Grid + opacity/transform | Expand/collapse product lines (линейки) |
| `ProductVariantCard.vue` | Vue Transition | Switch between compact and full card |
| `ProductCompactCard.vue` | Vue Transition | Switch between compact and full card |

## CSS Grid Expand/Collapse Pattern

Used in `GroupLineItem.vue` for smooth expand/collapse of product lines.

### HTML Structure
```html
<div class="group-line-content-wrapper" :class="{ 'is-expanded': isExpanded }">
  <div class="group-line-content">
    <!-- Content here -->
  </div>
</div>
```

### CSS Implementation
```css
/* Container - uses CSS Grid for height animation */
.group-line-content-wrapper {
  display: grid;
  grid-template-rows: 0fr;           /* Collapsed state */
  overflow: hidden;                   /* Hide content when collapsed */
  transition: grid-template-rows 400ms cubic-bezier(0.4, 0, 0.2, 1);
}

.group-line-content-wrapper.is-expanded {
  grid-template-rows: 1fr;           /* Expanded state */
}

/* Inner content - CRITICAL: must have min-height: 0 */
.group-line-content-wrapper > .group-line-content {
  min-height: 0;                     /* Required for grid animation to work */
  overflow: hidden;
  opacity: 0;
  transform: translateY(-16px) scale(0.98);
  transform-origin: top center;
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

/* Expanded state with delay to sync with grid */
.group-line-content-wrapper.is-expanded > .group-line-content {
  opacity: 1;
  transform: translateY(0) scale(1);
  transition: opacity 350ms cubic-bezier(0.4, 0, 0.2, 1) 50ms, 
              transform 350ms cubic-bezier(0.4, 0, 0.2, 1) 50ms;
}
```

### Key Points
1. **`min-height: 0`** on inner content is CRITICAL - without it, CSS Grid won't collapse
2. **`overflow: hidden`** on wrapper prevents content from showing during collapse
3. **50ms delay** on inner content transition syncs opacity with grid expansion
4. **`cubic-bezier(0.4, 0, 0.2, 1)`** is Material Design's standard easing

## Vue Transition for Card Switching

Used for switching between `ProductCompactCard` and `ProductVariantCard`.

### HTML Structure
```html
<Transition name="product-card-fade" mode="out-in">
  <ProductCompactCard v-if="!isExpanded" :key="'compact'" />
  <ProductVariantCard v-else :key="'expanded'" />
</Transition>
```

### CSS Implementation
```css
/* Enter animation (new card appearing) */
.product-card-fade-enter-active {
  transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1), 
              transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

/* Leave animation (old card disappearing) */
.product-card-fade-leave-active {
  transition: opacity 0.2s ease-out, 
              transform 0.2s ease-out,
              max-height 0.25s ease-out;
  overflow: hidden;
}

/* Enter start state */
.product-card-fade-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
  max-height: 0;
}

/* Enter end state */
.product-card-fade-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 800px;
}

/* Leave start state */
.product-card-fade-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 200px;
}

/* Leave end state */
.product-card-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
  max-height: 0;
  margin-bottom: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
```

### Key Points
1. **`mode="out-in"`** - waits for leave animation to complete before starting enter
2. **Both enter and leave need transitions** - common mistake is `transition: none` on enter
3. **Use `max-height` not `height`** - `height: auto` cannot be animated
4. **Reset margins/padding on leave** - prevents layout jump at end of animation

## Debugging CSS Animations

### Logging CSS State at Intervals
```javascript
function logAnimationState(elementSelector, label) {
  [0, 100, 200, 400].forEach(delay => {
    setTimeout(() => {
      const el = document.querySelector(elementSelector);
      if (!el) return;
      const styles = window.getComputedStyle(el);
      console.log(`${label} @ ${delay}ms:`, {
        opacity: styles.opacity,
        transform: styles.transform,
        maxHeight: styles.maxHeight,
        gridTemplateRows: styles.gridTemplateRows
      });
    }, delay);
  });
}

// Usage
logAnimationState('.group-line-content-wrapper', 'Wrapper');
```

### With Debug Server (Cursor Debug Mode)
```javascript
[0, 100, 200, 400].forEach(delay => {
  setTimeout(() => {
    const el = document.querySelector('.animated-element');
    const styles = window.getComputedStyle(el);
    fetch('http://localhost:7255/ingest/SESSION_ID', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: `animation:${delay}ms`,
        data: {
          opacity: styles.opacity,
          transform: styles.transform,
          gridTemplateRows: styles.gridTemplateRows
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
  }, delay);
});
```

### What to Look For in Logs
1. **Values changing over time** - animation is working
2. **Instant jump from start to end** - transition not applied
3. **Values stuck at start** - element not getting expanded class
4. **Values stuck at end** - element already in final state

### Common Issues and Fixes

| Issue | Symptom | Fix |
|-------|---------|-----|
| No animation | Instant change | Check `transition` property is set |
| Content visible when collapsed | Overflow showing | Add `overflow: hidden` |
| Grid won't collapse | Stuck at content height | Add `min-height: 0` to inner element |
| Jerky animation | Stuttering | Use `cubic-bezier` instead of `linear` |
| Enter animation missing | Only leave animates | Add `-enter-active` transition |
| Layout jump at end | Content shifts | Reset margins/padding in leave-to |

## Timing Functions Reference

| Name | Value | Use Case |
|------|-------|----------|
| Material Standard | `cubic-bezier(0.4, 0, 0.2, 1)` | Most UI animations |
| Material Decelerate | `cubic-bezier(0, 0, 0.2, 1)` | Enter animations |
| Material Accelerate | `cubic-bezier(0.4, 0, 1, 1)` | Exit animations |
| Ease Out | `ease-out` | Quick start, slow end |
| Ease In Out | `ease-in-out` | Symmetric animations |

## Animation Duration Guidelines

| Animation Type | Duration | Notes |
|----------------|----------|-------|
| Micro (hover, focus) | 100-150ms | Should feel instant |
| Small (buttons, toggles) | 200-250ms | Quick but noticeable |
| Medium (cards, panels) | 300-400ms | Main UI transitions |
| Large (modals, pages) | 400-500ms | Major view changes |

## Related: Image Container Padding

Padding and image sizing inside product image boxes (e.g. `.group-line-image`, `.liquid-line-image`, `.single-product-image`) are layout, not animation. Convention: padding 6px (4px on small breakpoints), `img { max-width: 100%; max-height: 100%; object-fit: contain }`. See **`docs/PRODUCT_CARD_LAYOUT.md`** for components, classes, and pitfalls for AI agents.

## Files Reference

| File | Contains |
|------|----------|
| `frontend/src/components/product/GroupLineItem.vue` | Line expand/collapse, card switching |
| `frontend/src/components/product/ProductVariantCard.vue` | Full product card with variants |
| `frontend/src/components/product/ProductCompactCard.vue` | Compact product card |
| `frontend/src/components/product/SingleProductCard.vue` | Single product without variants |
| `docs/PRODUCT_CARD_LAYOUT.md` | Image area padding/sizing in cards |
