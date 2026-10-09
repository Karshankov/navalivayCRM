/**
 * Storefront filters — adversarial + regression unit tests.
 * Запуск: node server/tests/storefront-filters.test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  STOREFRONT_FILTER_PROFILES,
  STRENGTH_TIERS,
  normalizeStorefrontFiltersProfile,
  normalizeStrengthTier,
  hasStrengthTier,
  profileSupportsTopSales,
  profileSupportsStrength,
  profileSupportsSearch,
} = await import('../utils/storefront-filters.js');

const results = { passed: 0, failed: 0 };

function ok(cond, msg) {
  if (cond) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function expectThrow(fn, code, msg) {
  let threw = false;
  let actualCode = null;
  try {
    fn();
  } catch (error) {
    threw = true;
    actualCode = error.code;
  }
  ok(threw && actualCode === code, msg);
}

console.log('\n=== storefront-filters ===\n');

console.log('--- Adversarial: profile normalization ---');
ok(
  normalizeStorefrontFiltersProfile(null) === STOREFRONT_FILTER_PROFILES.NONE,
  'null profile → none',
);
ok(
  normalizeStorefrontFiltersProfile(undefined) === STOREFRONT_FILTER_PROFILES.NONE,
  'undefined profile → none',
);
ok(
  normalizeStorefrontFiltersProfile('') === STOREFRONT_FILTER_PROFILES.NONE,
  'empty profile → none',
);
ok(
  normalizeStorefrontFiltersProfile('  LIQUIDS  ') === STOREFRONT_FILTER_PROFILES.LIQUIDS,
  'trim + lowercase profile',
);
expectThrow(
  () => normalizeStorefrontFiltersProfile('hacked'),
  'invalid_storefront_filters_profile',
  'unknown profile throws',
);
expectThrow(
  () => normalizeStorefrontFiltersProfile("'; DROP TABLE categories; --"),
  'invalid_storefront_filters_profile',
  'SQL injection profile throws',
);
expectThrow(
  () => normalizeStorefrontFiltersProfile({ toString: () => 'evil' }),
  'invalid_storefront_filters_profile',
  'object toString value still validated',
);

console.log('\n--- Adversarial: strength tier normalization ---');
ok(normalizeStrengthTier(null) === null, 'null tier allowed by default');
ok(normalizeStrengthTier('') === null, 'empty tier allowed by default');
ok(
  normalizeStrengthTier(' STRONG ') === STRENGTH_TIERS.STRONG,
  'trim + lowercase tier',
);
expectThrow(
  () => normalizeStrengthTier(null, { allowNull: false }),
  'invalid_strength_tier',
  'null tier rejected when allowNull=false',
);
expectThrow(
  () => normalizeStrengthTier('medium'),
  'invalid_strength_tier',
  'unknown tier throws',
);
expectThrow(
  () => normalizeStrengthTier('very_strong; DELETE'),
  'invalid_strength_tier',
  'injection-like tier throws',
);

console.log('\n--- Adversarial: hasStrengthTier ---');
ok(hasStrengthTier('light'), 'valid tier recognized');
ok(hasStrengthTier(' LIGHT '), 'trimmed tier recognized');
ok(!hasStrengthTier(''), 'empty string is not a tier');
ok(!hasStrengthTier(null), 'null is not a tier');
ok(!hasStrengthTier('strongest'), 'near-miss tier rejected');

console.log('\n--- Regression: profile capability flags ---');
ok(profileSupportsTopSales(STOREFRONT_FILTER_PROFILES.LIQUIDS), 'liquids supports top');
ok(profileSupportsTopSales(STOREFRONT_FILTER_PROFILES.SNUS_PLATES), 'snus_plates supports top');
ok(!profileSupportsTopSales(STOREFRONT_FILTER_PROFILES.NONE), 'none does not support top');
ok(profileSupportsStrength(STOREFRONT_FILTER_PROFILES.LIQUIDS), 'liquids supports strength');
ok(!profileSupportsStrength(STOREFRONT_FILTER_PROFILES.SNUS_PLATES), 'snus does not support strength');
ok(profileSupportsSearch(STOREFRONT_FILTER_PROFILES.SNUS_PLATES), 'snus supports search');
ok(!profileSupportsSearch(STOREFRONT_FILTER_PROFILES.NONE), 'none does not support search');

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);