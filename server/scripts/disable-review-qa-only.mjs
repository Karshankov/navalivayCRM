/**
 * Выключает QA/dev-режим отзывов без удаления отзывов и заказов.
 *
 * Usage:
 *   node server/scripts/disable-review-qa-only.mjs
 */
import { initDb } from '../db.js';
import { disableReviewQaModes, getReviewSettingsResponse } from '../utils/product-reviews.js';

initDb();
console.log('[before]', JSON.stringify(getReviewSettingsResponse()));
disableReviewQaModes();
console.log('[after]', JSON.stringify(getReviewSettingsResponse()));