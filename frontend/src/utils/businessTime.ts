export const BUSINESS_TIME_ZONE = "Europe/Minsk";

export type BusinessDateParts = {
  year: number;
  month: number;
  day: number;
};

export type BusinessPeriod = "today" | "week" | "month" | "year" | "custom";

const datePartsFormatterCache = new Map<string, Intl.DateTimeFormat>();
const displayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDatePartsFormatter(timeZone = BUSINESS_TIME_ZONE) {
  if (!datePartsFormatterCache.has(timeZone)) {
    datePartsFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    );
  }

  return datePartsFormatterCache.get(timeZone)!;
}

function getDisplayFormatter(
  options: Intl.DateTimeFormatOptions,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const key = `${timeZone}:${JSON.stringify(options)}`;
  if (!displayFormatterCache.has(key)) {
    displayFormatterCache.set(
      key,
      new Intl.DateTimeFormat("ru-RU", {
        ...options,
        timeZone,
      }),
    );
  }

  return displayFormatterCache.get(key)!;
}

export function getBusinessDateParts(
  referenceDate = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
): BusinessDateParts {
  const parts = getDatePartsFormatter(timeZone).formatToParts(referenceDate);
  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

export function getBusinessMonthValue(
  referenceDate = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
) {
  const { year, month } = getBusinessDateParts(referenceDate, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatBusinessDateTimeInput(
  value: string | Date,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function businessDateTimeInputToIso(
  value: string,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const desiredUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let instant = desiredUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const renderedUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
    instant += desiredUtc - renderedUtc;
  }
  return new Date(instant).toISOString();
}

function normalizeCalendarDate(
  year: number,
  month: number,
  day: number,
): BusinessDateParts {
  const normalized = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
  };
}

export function shiftBusinessDate(
  dateParts: BusinessDateParts,
  dayOffset: number,
): BusinessDateParts {
  return normalizeCalendarDate(
    dateParts.year,
    dateParts.month,
    dateParts.day + dayOffset,
  );
}

export function shiftBusinessMonth(
  year: number,
  month: number,
  monthOffset: number,
) {
  const normalized = new Date(
    Date.UTC(year, month - 1 + monthOffset, 1, 12, 0, 0),
  );

  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
  };
}

function getBusinessWeekStart(dateParts: BusinessDateParts) {
  const weekday =
    new Date(
      Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 12, 0, 0),
    ).getUTCDay() || 7;

  return shiftBusinessDate(dateParts, -(weekday - 1));
}

function toSafeUtcDate(dateParts: BusinessDateParts) {
  return new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 12, 0, 0),
  );
}

export function formatBusinessDate(
  dateParts: BusinessDateParts,
  options: Intl.DateTimeFormatOptions,
  timeZone = BUSINESS_TIME_ZONE,
) {
  return getDisplayFormatter(options, timeZone).format(toSafeUtcDate(dateParts));
}

export function getBusinessYear(
  referenceDate = new Date(),
  offset = 0,
  timeZone = BUSINESS_TIME_ZONE,
) {
  return getBusinessDateParts(referenceDate, timeZone).year + offset;
}

export function formatBusinessPeriodLabel(
  period: BusinessPeriod,
  offset = 0,
  referenceDate = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
) {
  const today = getBusinessDateParts(referenceDate, timeZone);

  if (period === "today") {
    return formatBusinessDate(
      shiftBusinessDate(today, offset),
      { day: "2-digit", month: "long", year: "numeric" },
      timeZone,
    );
  }

  if (period === "week") {
    const start = getBusinessWeekStart(shiftBusinessDate(today, offset * 7));
    const end = shiftBusinessDate(start, 6);
    return `${formatBusinessDate(start, { day: "2-digit", month: "2-digit", year: "numeric" }, timeZone)} — ${formatBusinessDate(end, { day: "2-digit", month: "2-digit", year: "numeric" }, timeZone)}`;
  }

  if (period === "month") {
    const targetMonth = shiftBusinessMonth(today.year, today.month, offset);
    return formatBusinessDate(
      { ...targetMonth, day: 1 },
      { month: "long", year: "numeric" },
      timeZone,
    );
  }

  if (period === "year") {
    return String(today.year + offset);
  }

  // 'custom' выводит сам компонент, потому что знает диапазон. Возвращаем плейсхолдер.
  return "произвольный";
}

export function formatBusinessPeriodTitle(
  period: BusinessPeriod,
  offset = 0,
  referenceDate = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
) {
  const today = getBusinessDateParts(referenceDate, timeZone);

  if (period === "today") {
    return formatBusinessDate(
      shiftBusinessDate(today, offset),
      { day: "2-digit", month: "long" },
      timeZone,
    );
  }

  if (period === "month") {
    const targetMonth = shiftBusinessMonth(today.year, today.month, offset);
    return formatBusinessDate(
      { ...targetMonth, day: 1 },
      { month: "long" },
      timeZone,
    );
  }

  if (period === "year") {
    return `${today.year + offset} год`;
  }

  return formatBusinessPeriodLabel(period, offset, referenceDate, timeZone);
}
