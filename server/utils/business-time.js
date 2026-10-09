export const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIMEZONE || "Europe/Minsk";

const formatterCache = new Map();

function getFormatter(timeZone = BUSINESS_TIME_ZONE) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        hourCycle: "h23",
      }),
    );
  }

  return formatterCache.get(timeZone);
}

export function getTimeZoneDateParts(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const hour = Number(values.hour);

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function normalizeCalendarDate(year, month, day) {
  const normalized = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
  };
}

function shiftCalendarDate(dateParts, dayOffset) {
  return normalizeCalendarDate(
    dateParts.year,
    dateParts.month,
    dateParts.day + dayOffset,
  );
}

export function shiftBusinessCalendarDate(dateParts, dayOffset) {
  return shiftCalendarDate(dateParts, dayOffset);
}

function shiftCalendarMonth(year, month, monthOffset) {
  const normalized = new Date(Date.UTC(year, month - 1 + monthOffset, 1, 12, 0, 0));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
  };
}

function getIsoWeekday(dateParts) {
  const weekday = new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 12, 0, 0),
  ).getUTCDay();

  return weekday === 0 ? 7 : weekday;
}

function getTimeZoneOffsetMs(date, timeZone = BUSINESS_TIME_ZONE) {
  const parts = getTimeZoneDateParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

export function getUtcDateForTimeZoneLocalTime(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = new Date(targetUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffsetMs(candidate, timeZone);
    const adjusted = new Date(targetUtc - offset);

    if (adjusted.getTime() === candidate.getTime()) {
      break;
    }

    candidate = adjusted;
  }

  return candidate;
}

function buildRange(startParts, endParts, granularity) {
  return {
    start: getUtcDateForTimeZoneLocalTime(
      startParts.year,
      startParts.month,
      startParts.day,
    ),
    end: getUtcDateForTimeZoneLocalTime(
      endParts.year,
      endParts.month,
      endParts.day,
    ),
    granularity,
    calendarStart: startParts,
  };
}

export function getBusinessPeriodRange(
  period = "today",
  offset = 0,
  year,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const nowParts = getTimeZoneDateParts(new Date(), timeZone);
  const today = { year: nowParts.year, month: nowParts.month, day: nowParts.day };

  if (period === "today") {
    const startParts = shiftCalendarDate(today, offset);
    const endParts = shiftCalendarDate(startParts, 1);
    return buildRange(startParts, endParts, "day");
  }

  if (period === "week") {
    const shiftedToday = shiftCalendarDate(today, offset * 7);
    const isoWeekday = getIsoWeekday(shiftedToday);
    const startParts = shiftCalendarDate(shiftedToday, -(isoWeekday - 1));
    const endParts = shiftCalendarDate(startParts, 7);
    return buildRange(startParts, endParts, "day");
  }

  if (period === "month") {
    const startMonth = shiftCalendarMonth(today.year, today.month, offset);
    const endMonth = shiftCalendarMonth(startMonth.year, startMonth.month, 1);
    return buildRange(
      { ...startMonth, day: 1 },
      { ...endMonth, day: 1 },
      "day",
    );
  }

  if (period === "year") {
    const targetYear = Number.isFinite(Number(year))
      ? Number(year)
      : today.year + offset;

    return buildRange(
      { year: targetYear, month: 1, day: 1 },
      { year: targetYear + 1, month: 1, day: 1 },
      "month",
    );
  }

  const startParts = today;
  const endParts = shiftCalendarDate(startParts, 1);
  return buildRange(startParts, endParts, "day");
}

export function getBusinessCalendarMonthRange(
  year,
  month,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const endMonth = shiftCalendarMonth(year, month, 1);
  return buildRange(
    { year, month, day: 1 },
    { year: endMonth.year, month: endMonth.month, day: 1 },
    "day",
  );
}

export function getBusinessCalendarDayRange(
  year,
  month,
  day,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const startParts = normalizeCalendarDate(year, month, day);
  const endParts = shiftCalendarDate(startParts, 1);
  return buildRange(startParts, endParts, "day");
}

export function toSqliteUtcString(date) {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export function getBusinessDayLabel(date, timeZone = BUSINESS_TIME_ZONE) {
  return String(getTimeZoneDateParts(date, timeZone).day);
}
