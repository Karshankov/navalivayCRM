<template>
  <div v-if="note" class="space-y-1.5">
    <p
      v-if="showHeading"
      class="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
    >
      Изменения
    </p>

    <div v-if="summary.hasStructuredContent" class="space-y-1">
      <p
        v-for="line in structuredLines"
        :key="line.key"
        :class="[contentTextClass, 'text-slate-700']"
      >
        <span class="font-semibold" :class="line.labelClass">
          {{ line.label }}:
        </span>
        <template v-for="(item, index) in line.items" :key="`${line.key}-${index}-${item.raw}`">
          <span class="ml-1 break-words">
            <span
              v-if="item.groupName"
              class="font-semibold text-blue-600"
            >
              {{ item.groupName }}
            </span>
            <span v-if="item.groupName"> - </span>
            <span>{{ item.title }}</span>
            <span v-if="item.quantityLabel">
              {{ formatItemQuantity(item, line.key) }}
            </span>
          </span>
          <span v-if="index < line.items.length - 1">, </span>
        </template>
      </p>

      <p
        v-if="summary.promo.length"
        :class="[contentTextClass, 'text-slate-700']"
      >
        <span class="font-semibold text-sky-700">Промокод:</span>
        <span class="ml-1 break-words">{{ promoSummary }}</span>
      </p>

      <p
        v-if="summary.info.length"
        :class="[mutedTextClass, 'text-slate-500']"
      >
        {{ summary.info.join(" | ") }}
      </p>
    </div>

    <p
      v-else
      :class="[mutedTextClass, 'text-slate-500']"
    >
      {{ plainText }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { OrderItem } from "@/stores/crm";
import {
  parseManagerActionNote,
  type ManagerActionSummaryItem,
} from "@/utils/managerActionNote";

type SummaryOrderItem = Pick<
  OrderItem,
  "group_name" | "base_product_title" | "product_title" | "variant_name"
>;

type DisplayItem = {
  raw: string;
  groupName: string | null;
  title: string;
  quantityLabel?: string;
};

const props = withDefaults(
  defineProps<{
    note: string | null | undefined;
    showHeading?: boolean;
    size?: "xs" | "sm";
    items?: SummaryOrderItem[] | null;
  }>(),
  {
    showHeading: true,
    size: "xs",
    items: () => [],
  },
);

const summary = computed(() => parseManagerActionNote(props.note));

const contentTextClass = computed(() =>
  props.size === "sm" ? "text-sm leading-6" : "text-xs leading-5",
);

const mutedTextClass = computed(() =>
  props.size === "sm" ? "text-sm leading-6" : "text-xs leading-5",
);

const knownGroupNames = computed(() => {
  const map = new Map<string, string>();

  for (const item of props.items || []) {
    const key = normalizeLabel(buildItemDisplayLabel(item));
    if (!key || !item.group_name) {
      continue;
    }
    map.set(key, item.group_name);
  }

  return map;
});

const knownGroupLabels = computed(
  () => new Set(Array.from(knownGroupNames.value.values()).map((value) => normalizeLabel(value))),
);

const structuredLines = computed(() =>
  [
    {
      key: "added",
      label: "Добавлено",
      labelClass: "text-emerald-700",
      items: summary.value.added,
    },
    {
      key: "removed",
      label: "Убрано",
      labelClass: "text-rose-700",
      items: summary.value.removed,
    },
    {
      key: "changed",
      label: "Количество",
      labelClass: "text-amber-700",
      items: summary.value.changed,
    },
  ]
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      ...section,
      items: section.items.map((item) => toDisplayItem(item)),
    })),
);

const promoSummary = computed(() =>
  summary.value.promo.map((item) => item.label).join(" | "),
);

const plainText = computed(() => summary.value.info.join(" ").trim());

function toDisplayItem(item: ManagerActionSummaryItem): DisplayItem {
  const explicitGroupSplit = splitGroupAndTitle(item.label);
  const normalizedTitle = normalizeLabel(explicitGroupSplit.title);
  const inferredGroupName =
    explicitGroupSplit.groupName ||
    knownGroupNames.value.get(normalizedTitle) ||
    null;

  return {
    raw: item.raw,
    groupName: inferredGroupName,
    title: explicitGroupSplit.title,
    quantityLabel: item.quantityLabel,
  };
}

function splitGroupAndTitle(label: string): {
  groupName: string | null;
  title: string;
} {
  const separatorIndex = label.indexOf(" - ");

  if (separatorIndex === -1) {
    return {
      groupName: null,
      title: label.trim(),
    };
  }

  const candidateGroup = label.slice(0, separatorIndex).trim();
  const candidateTitle = label.slice(separatorIndex + 3).trim();
  const normalizedGroup = normalizeLabel(candidateGroup);

  if (
    !candidateGroup ||
    !candidateTitle ||
    (!knownGroupLabels.value.has(normalizedGroup) && !looksLikeGroupName(candidateGroup))
  ) {
    return {
      groupName: null,
      title: label.trim(),
    };
  }

  return {
    groupName: candidateGroup,
    title: candidateTitle,
  };
}

function buildItemDisplayLabel(item: SummaryOrderItem): string {
  const baseTitle = item.base_product_title || item.product_title;
  return item.variant_name ? `${baseTitle} (${item.variant_name})` : baseTitle;
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeGroupName(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed === trimmed.toUpperCase() && /[A-ZА-Я]/.test(trimmed);
}

function formatItemQuantity(
  item: DisplayItem,
  sectionKey: string,
): string {
  if (!item.quantityLabel) {
    return "";
  }

  if (sectionKey !== "changed") {
    return ` - ${item.quantityLabel}`;
  }

  const match = item.quantityLabel.match(/^(.+?)\s*->\s*(.+)$/);

  if (!match) {
    return `: ${item.quantityLabel}`;
  }

  return `: было ${match[1].trim()}, стало ${match[2].trim()}`;
}
</script>
