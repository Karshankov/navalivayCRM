import { BUSINESS_TIME_ZONE } from "./businessTime";

/**
 * Час суточного пересчёта значка «заканчивается в рознице».
 *
 * Значок не опрашивается каждые 15 секунд: список нужен для контроля
 * пополнения, а не для реакции в реальном времени. Раз в сутки в 9:00
 * бизнес-времени цифра пересчитывается; после действий с перемещениями
 * менеджер всё равно увидит свежие данные, потому что те сбрасывают кэш на бэке.
 */
export const RESTOCK_REFRESH_HOUR = 9;

/**
 * Сколько миллисекунд осталось до ближайших 9:00 по бизнес-часовому поясу.
 *
 * Смещение пояса считаем на конкретный момент через `Intl`: сам браузер не
 * хранит часовой пояс в Date, а хардкодить +03:00 нельзя — Minsk исторически
 * переходил на летнее время, и правило должно остаться в одном месте.
 */
export function msUntilNextRestockRefresh(
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
  hour: number = RESTOCK_REFRESH_HOUR,
): number {
  const current = getTimeZoneOffsetMs(now, timeZone);
  const parts = getZonedParts(now, timeZone);

  // Локальное «сегодня в 9:00» переводим в UTC тем же смещением, что действует
  // сейчас: разница в один час на границе перехода не критична для опроса.
  const todayTargetUtc =
    Date.UTC(parts.year, parts.month - 1, parts.day, hour, 0, 0) - current;

  let targetUtc = todayTargetUtc;
  if (targetUtc <= now.getTime()) {
    targetUtc += 24 * 60 * 60 * 1000;
  }
  return Math.max(1000, targetUtc - now.getTime());
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
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

/** Смещение пояса в миллисекундах для конкретного момента. */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Секунды Date могут содержать миллисекунды — их не теряем при сравнении.
  const base = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - base;
}