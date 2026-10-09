import { BUSINESS_TIME_ZONE, getTimeZoneDateParts } from "./business-time.js";

function roundRub(value) {
  return Math.round(Number(value || 0));
}

function roundTwo(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function formatMonthKey(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function formatDateKey(year, month, day) {
  return `${formatMonthKey(year, month)}-${String(day).padStart(2, "0")}`;
}

export function normalizeMonthKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error("invalid_month_key");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("invalid_month_key");
  }

  return formatMonthKey(year, month);
}

export function parseMonthKey(monthKey) {
  const normalized = normalizeMonthKey(monthKey);
  return {
    year: Number(normalized.slice(0, 4)),
    month: Number(normalized.slice(5, 7)),
  };
}

export function normalizeDateKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("invalid_date_key");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    throw new Error("invalid_date_key");
  }

  return formatDateKey(year, month, day);
}

export function ensureDateInMonth(dateKey, monthKey) {
  const normalizedDateKey = normalizeDateKey(dateKey);
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  if (!normalizedDateKey.startsWith(`${normalizedMonthKey}-`)) {
    throw new Error("date_out_of_month");
  }
  return normalizedDateKey;
}

export function getCurrentBusinessMonthKey(
  referenceDate = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
) {
  const parts = getTimeZoneDateParts(referenceDate, timeZone);
  return formatMonthKey(parts.year, parts.month);
}

export function getCurrentBusinessDateKey(
  referenceDate = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
) {
  const parts = getTimeZoneDateParts(referenceDate, timeZone);
  return formatDateKey(parts.year, parts.month, parts.day);
}

export function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

export function getMonthDateKeys(monthKey) {
  const { year, month } = parseMonthKey(monthKey);
  const daysInMonth = getDaysInMonth(year, month);
  const keys = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    keys.push(formatDateKey(year, month, day));
  }

  return keys;
}

function shiftDateKey(dateKey, dayOffset) {
  const normalized = normalizeDateKey(dateKey);
  const shifted = new Date(`${normalized}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);

  return formatDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareDateKeys(left, right) {
  return left.localeCompare(right);
}

function computeRetailUnit(item) {
  return toFiniteNumber(item.cost_with_vat) * (1 + toFiniteNumber(item.markup_percent) / 100);
}

function computeRetailTotal(item) {
  return computeRetailUnit(item) * toFiniteNumber(item.quantity);
}

function sumAmount(values) {
  return values.reduce((total, value) => total + toFiniteNumber(value), 0);
}

export function computeCashPacingMonthProjection({
  month,
  items = [],
  dailyFacts = [],
  referenceDate = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
}) {
  const monthKey = normalizeMonthKey(month.month_key);
  const { year, month: monthNumber } = parseMonthKey(monthKey);
  const dateKeys = getMonthDateKeys(monthKey);
  const monthStartKey = dateKeys[0];
  const monthEndKey = dateKeys[dateKeys.length - 1];
  const currentMonthKey = getCurrentBusinessMonthKey(referenceDate, timeZone);
  const currentDateKey = getCurrentBusinessDateKey(referenceDate, timeZone);

  const normalizedItems = items
    .map((item) => {
      const effectiveFrom = ensureDateInMonth(item.effective_from || monthStartKey, monthKey);
      const quantity = toFiniteNumber(item.quantity);
      const costWithVat = toFiniteNumber(item.cost_with_vat);
      const markupPercent = toFiniteNumber(item.markup_percent);
      const retailUnitRaw = computeRetailUnit({
        cost_with_vat: costWithVat,
        markup_percent: markupPercent,
      });
      const retailTotalRaw = retailUnitRaw * quantity;

      return {
        ...item,
        quantity,
        cost_with_vat: costWithVat,
        markup_percent: markupPercent,
        effective_from: effectiveFrom,
        retail_unit: roundTwo(retailUnitRaw),
        retail_total_precise: roundTwo(retailTotalRaw),
        retail_total: roundRub(retailTotalRaw),
        retail_total_raw: retailTotalRaw,
      };
    })
    .sort((left, right) => {
      const byDate = compareDateKeys(left.effective_from, right.effective_from);
      if (byDate !== 0) return byDate;
      return String(left.created_at || left.id || "").localeCompare(String(right.created_at || right.id || ""));
    });

  const normalizedFacts = dailyFacts
    .map((fact) => ({
      ...fact,
      fact_date: ensureDateInMonth(fact.fact_date, monthKey),
      actual_amount: toFiniteNumber(fact.actual_amount),
    }))
    .sort((left, right) => compareDateKeys(left.fact_date, right.fact_date));

  const factMap = new Map(normalizedFacts.map((fact) => [fact.fact_date, fact]));
  const monthTotalRaw = sumAmount(normalizedItems.map((item) => item.retail_total_raw));
  const actualTotalRaw = sumAmount(normalizedFacts.map((fact) => fact.actual_amount));

  const cumulativeFactsBefore = new Map();
  let runningFactsRaw = 0;
  for (const dateKey of dateKeys) {
    cumulativeFactsBefore.set(dateKey, runningFactsRaw);
    const fact = factMap.get(dateKey);
    if (fact) {
      runningFactsRaw += fact.actual_amount;
    }
  }

  const dayRows = dateKeys.map((dateKey, index) => {
    const activeLimitRaw = sumAmount(
      normalizedItems
        .filter((item) => compareDateKeys(item.effective_from, dateKey) <= 0)
        .map((item) => item.retail_total_raw),
    );
    const actualBeforeRaw = cumulativeFactsBefore.get(dateKey) || 0;
    const actualForDayRaw = factMap.get(dateKey)?.actual_amount ?? null;
    const remainingDays = dateKeys.length - index;
    const recommendedRaw =
      remainingDays > 0 ? (activeLimitRaw - actualBeforeRaw) / remainingDays : 0;
    const actualThroughDayRaw =
      actualBeforeRaw + (actualForDayRaw !== null ? actualForDayRaw : 0);

    return {
      date: dateKey,
      active_limit: roundRub(activeLimitRaw),
      recommended_amount: roundRub(recommendedRaw),
      actual_amount: actualForDayRaw === null ? null : roundRub(actualForDayRaw),
      deviation_amount:
        actualForDayRaw === null ? null : roundRub(actualForDayRaw - recommendedRaw),
      cumulative_actual: roundRub(actualThroughDayRaw),
      remaining_after_day: roundRub(monthTotalRaw - actualThroughDayRaw),
      has_fact: actualForDayRaw !== null,
    };
  });

  let recommendationDate = null;
  if (monthKey > currentMonthKey) {
    recommendationDate = monthStartKey;
  } else if (monthKey === currentMonthKey) {
    recommendationDate = factMap.has(currentDateKey)
      ? shiftDateKey(currentDateKey, 1)
      : currentDateKey;

    if (compareDateKeys(recommendationDate, monthEndKey) > 0) {
      recommendationDate = null;
    }
  }

  let recommendationAmount = null;
  let remainingDays = 0;
  let activeLimitForRecommendation = roundRub(monthTotalRaw);

  if (recommendationDate && compareDateKeys(recommendationDate, monthEndKey) <= 0) {
    const recommendationIndex = dateKeys.findIndex((dateKey) => dateKey === recommendationDate);
    const recommendationDay = dayRows[recommendationIndex];
    recommendationAmount = recommendationDay?.recommended_amount ?? 0;
    remainingDays = recommendationIndex === -1 ? 0 : dateKeys.length - recommendationIndex;
    activeLimitForRecommendation = recommendationDay?.active_limit ?? roundRub(monthTotalRaw);
  }

  return {
    items: normalizedItems,
    dailyFacts: normalizedFacts,
    dailyPlan: dayRows,
    summary: {
      month_key: monthKey,
      total_limit: roundRub(monthTotalRaw),
      actual_total: roundRub(actualTotalRaw),
      remaining_total: roundRub(monthTotalRaw - actualTotalRaw),
      remaining_days: remainingDays,
      recommendation_date: recommendationDate,
      recommendation_amount: recommendationAmount,
      active_limit_on_recommendation_date: activeLimitForRecommendation,
      days_in_month: dateKeys.length,
      days_with_facts: normalizedFacts.length,
      completion_percent:
        monthTotalRaw > 0 ? roundTwo((actualTotalRaw / monthTotalRaw) * 100) : 0,
      overrun_amount: Math.max(0, roundRub(actualTotalRaw - monthTotalRaw)),
      month_status:
        monthKey < currentMonthKey ? "past" : monthKey > currentMonthKey ? "future" : "current",
    },
  };
}
