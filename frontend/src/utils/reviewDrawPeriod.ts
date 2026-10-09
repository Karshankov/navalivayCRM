import {
  BUSINESS_TIME_ZONE,
  formatBusinessDate,
  getBusinessDateParts,
  shiftBusinessDate,
  shiftBusinessMonth,
} from "@/utils/businessTime";

export function getCurrentReviewDrawPeriodKey(referenceDate = new Date()) {
  const { year, month } = getBusinessDateParts(referenceDate, BUSINESS_TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatReviewDrawPeriodKey(periodKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey || "");
  if (!match) return periodKey;
  const monthIndex = Number(match[2]) - 1;
  const monthNames = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];
  const month = monthNames[monthIndex];
  return month ? `${month} ${match[1]}` : periodKey;
}

export function getReviewDrawAutoScheduleLabel(referenceDate = new Date()) {
  const { year, month } = getBusinessDateParts(referenceDate, BUSINESS_TIME_ZONE);
  const nextMonth = shiftBusinessMonth(year, month, 1);
  const lastDay = shiftBusinessDate({ ...nextMonth, day: 1 }, -1);
  const dateLabel = formatBusinessDate(
    lastDay,
    { day: "numeric", month: "long" },
    BUSINESS_TIME_ZONE,
  );
  return `${dateLabel} в 21:00 по Минску`;
}

export function getReviewDrawPeriodStartLabel(referenceDate = new Date()) {
  const { year, month } = getBusinessDateParts(referenceDate, BUSINESS_TIME_ZONE);
  return formatBusinessDate(
    { year, month, day: 1 },
    { day: "numeric", month: "long" },
    BUSINESS_TIME_ZONE,
  );
}