export interface ManagerActionSummaryItem {
  label: string;
  quantityLabel?: string;
  raw: string;
}

export interface ManagerActionSummary {
  added: ManagerActionSummaryItem[];
  removed: ManagerActionSummaryItem[];
  changed: ManagerActionSummaryItem[];
  promo: ManagerActionSummaryItem[];
  info: string[];
  hasStructuredContent: boolean;
}

const SEGMENT_SPLIT_RE = /\s*;\s*|\r?\n+/;
const TRAILING_QUANTITY_RE = /^(.*?)(?:\s*x\s*(\d+(?:[.,]\d+)?))$/i;
const QUANTITY_CHANGE_RE =
  /^(.*?)(?:\s+(\d+(?:[.,]\d+)?)\s*(?:→|->)\s*(\d+(?:[.,]\d+)?))$/;

function parseNumericValue(value: string): number | null {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUnitsLabel(value: number | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const formatted = Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });

  return `${formatted} шт.`;
}

function parseQuantityEntry(raw: string): ManagerActionSummaryItem {
  const trimmed = raw.trim();
  const match = trimmed.match(TRAILING_QUANTITY_RE);

  if (!match) {
    return {
      label: trimmed,
      raw,
    };
  }

  return {
    label: match[1].trim(),
    quantityLabel: formatUnitsLabel(parseNumericValue(match[2])),
    raw,
  };
}

function parseQuantityChangeEntry(raw: string): ManagerActionSummaryItem {
  const trimmed = raw.trim();
  const match = trimmed.match(QUANTITY_CHANGE_RE);

  if (!match) {
    return {
      label: trimmed,
      raw,
    };
  }

  const fromLabel = formatUnitsLabel(parseNumericValue(match[2]));
  const toLabel = formatUnitsLabel(parseNumericValue(match[3]));

  return {
    label: match[1].trim(),
    quantityLabel:
      fromLabel && toLabel ? `${fromLabel} -> ${toLabel}` : undefined,
    raw,
  };
}

export function parseManagerActionNote(note: string | null | undefined): ManagerActionSummary {
  const summary: ManagerActionSummary = {
    added: [],
    removed: [],
    changed: [],
    promo: [],
    info: [],
    hasStructuredContent: false,
  };

  if (!note) {
    return summary;
  }

  const segments = note
    .split(SEGMENT_SPLIT_RE)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    if (/^добавлено:\s*/i.test(segment)) {
      summary.added.push(
        parseQuantityEntry(segment.replace(/^добавлено:\s*/i, "")),
      );
      continue;
    }

    if (/^убрано:\s*/i.test(segment)) {
      summary.removed.push(
        parseQuantityEntry(segment.replace(/^убрано:\s*/i, "")),
      );
      continue;
    }

    if (/^количество:\s*/i.test(segment)) {
      summary.changed.push(
        parseQuantityChangeEntry(segment.replace(/^количество:\s*/i, "")),
      );
      continue;
    }

    if (/^промокод:\s*/i.test(segment)) {
      const promoCode = segment.replace(/^промокод:\s*/i, "").trim();
      summary.promo.push({
        label: promoCode ? `Применен: ${promoCode}` : "Промокод изменен",
        raw: segment,
      });
      continue;
    }

    if (/^промокод удал(?:е|ё)н$/i.test(segment)) {
      summary.promo.push({
        label: "Удален",
        raw: segment,
      });
      continue;
    }

    summary.info.push(segment);
  }

  summary.hasStructuredContent =
    summary.added.length > 0 ||
    summary.removed.length > 0 ||
    summary.changed.length > 0 ||
    summary.promo.length > 0;

  return summary;
}
