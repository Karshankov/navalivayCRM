export const STOREFRONT_FILTER_PROFILES = Object.freeze({
  NONE: 'none',
  LIQUIDS: 'liquids',
  SNUS_PLATES: 'snus_plates',
});

export const STRENGTH_TIERS = Object.freeze({
  VERY_STRONG: 'very_strong',
  STRONG: 'strong',
  LIGHT: 'light',
});

const ALLOWED_PROFILES = new Set(Object.values(STOREFRONT_FILTER_PROFILES));
const ALLOWED_STRENGTH_TIERS = new Set(Object.values(STRENGTH_TIERS));

export function normalizeStorefrontFiltersProfile(value) {
  if (value === null || value === undefined || value === '') {
    return STOREFRONT_FILTER_PROFILES.NONE;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!ALLOWED_PROFILES.has(normalized)) {
    const err = new Error('invalid_storefront_filters_profile');
    err.code = 'invalid_storefront_filters_profile';
    throw err;
  }
  return normalized;
}

export function normalizeStrengthTier(value, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    const err = new Error('invalid_strength_tier');
    err.code = 'invalid_strength_tier';
    throw err;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!ALLOWED_STRENGTH_TIERS.has(normalized)) {
    const err = new Error('invalid_strength_tier');
    err.code = 'invalid_strength_tier';
    throw err;
  }
  return normalized;
}

export function hasStrengthTier(value) {
  return typeof value === 'string' && ALLOWED_STRENGTH_TIERS.has(value.trim().toLowerCase());
}

export function profileSupportsTopSales(profile) {
  return (
    profile === STOREFRONT_FILTER_PROFILES.LIQUIDS ||
    profile === STOREFRONT_FILTER_PROFILES.SNUS_PLATES
  );
}

export function profileSupportsStrength(profile) {
  return profile === STOREFRONT_FILTER_PROFILES.LIQUIDS;
}

export function profileSupportsSearch(profile) {
  return profileSupportsTopSales(profile);
}