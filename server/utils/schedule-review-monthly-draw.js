import { getTimeZoneDateParts } from './business-time.js';
import { getReviewPeriodKey, runMonthlyReviewDraw } from './review-monthly-draw.js';

function isLastDayOfMonthInMinsk(date = new Date()) {
  const parts = getTimeZoneDateParts(date);
  const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const nextParts = getTimeZoneDateParts(nextDay);
  return nextParts.month !== parts.month;
}

let lastAutoDrawPeriodKey = null;

export function tryRunScheduledMonthlyDraw(now = new Date()) {
  if (!isLastDayOfMonthInMinsk(now)) return false;

  const { hour, minute } = getTimeZoneDateParts(now);
  if (hour !== 21 || minute > 1) return false;

  const periodKey = getReviewPeriodKey(0);
  if (lastAutoDrawPeriodKey === periodKey) return false;
  lastAutoDrawPeriodKey = periodKey;

  try {
    const draw = runMonthlyReviewDraw({ periodKey });
    console.log(
      `[review-draw-scheduler] Auto draw completed for ${periodKey}`,
      draw?.winners?.length || 0,
      'winners',
    );
    return true;
  } catch (error) {
    if (error?.code === 'draw_already_exists') {
      console.log(`[review-draw-scheduler] Draw already exists for ${periodKey}`);
      return false;
    }
    console.error('[review-draw-scheduler] Failed:', error);
    return false;
  }
}

export function scheduleReviewMonthlyDraw() {
  setInterval(() => {
    tryRunScheduledMonthlyDraw();
  }, 60_000);
  console.log('[review-draw-scheduler] Watching for last-day 21:00 Europe/Minsk draw');
}