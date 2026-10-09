import 'dotenv/config';
import { runMonthlyReviewDraw, getReviewPeriodKey } from '../utils/review-monthly-draw.js';

try {
  const periodKey = getReviewPeriodKey(0);
  const draw = runMonthlyReviewDraw({ periodKey });
  console.log(`[review-draw] Completed draw for ${periodKey}`, draw?.winners?.length || 0, 'winners');
} catch (error) {
  if (error?.code === 'draw_already_exists') {
    console.log(`[review-draw] Draw already exists for period (${error.drawId})`);
    process.exit(0);
  }
  console.error('[review-draw] Failed:', error);
  process.exit(1);
}