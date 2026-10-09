<template>
  <div class="liquid-tree-item">
    <!-- Линейка с товарами -->
    <LiquidLineCard
      :group-id="group.id"
      :title="group.name"
      :products="group.products"
      :cover-image="group.coverImage"
      :fallback-image="fallbackImage"
      :badge="group.badge ?? undefined"
      :badge-color="group.badgeColor ?? undefined"
      :is-new="group.isNew ?? false"
      :meta-label="group.metaLabel ?? null"
      :meta-value="group.metaValue ?? null"
      :subgroups="group.children"
      :expanded="isExpanded"
      :top-rank="topRank"
      @toggle="toggleExpand"
      @show-toast="
        (msg: string, type: 'error' | 'success' | 'info') =>
          $emit('showToast', msg, type)
      "
    />

    <!-- Подлинейки (рекурсивно) -->
    <Transition
      :css="false"
      @before-enter="onBeforeEnter"
      @enter="onEnter"
      @after-enter="onAfterEnter"
      @before-leave="onBeforeLeave"
      @leave="onLeave"
      @after-leave="onAfterLeave"
      @enter-cancelled="onCancelled"
      @leave-cancelled="onCancelled"
    >
      <div
        v-if="group.children.length && isExpanded"
        ref="childrenWrapper"
        class="liquid-tree-children-wrapper"
      >
        <div class="liquid-tree-children">
          <LiquidLineTree
            v-for="child in group.children"
            :key="child.id"
            :group="child"
            :top-rank="resolveChildTopRank(child.id)"
            :fallback-image="fallbackImage"
            :expanded-groups="expandedGroups"
            @toggle="$emit('toggle', $event)"
            @showToast="
              (msg: string, type: 'error' | 'success' | 'info') =>
                $emit('showToast', msg, type)
            "
            @heightChanged="handleChildHeightChange"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import LiquidLineCard from "./LiquidLineCard.vue";
import type { Product } from "@/stores/catalog";

interface LiquidGroup {
  id: string;
  name: string;
  slug: string;
  order: number;
  coverImage: string | null;
  products: Product[];
  productCount: number;
  badge?: string | null;
  badgeColor?: string | null;
  metaLabel?: string | null;
  metaValue?: string | null;
  strengthTier?: string | null;
  isNew?: boolean;
  newSince?: string | null;
  children: LiquidGroup[];
}

const props = defineProps<{
  group: LiquidGroup;
  topRank?: number | null;
  topRankByGroupId?: Record<string, number>;
  fallbackImage?: string;
  expandedGroups: Record<string, boolean>;
}>();

function resolveChildTopRank(groupId: string): number | null {
  const fromMap = props.topRankByGroupId?.[groupId];
  return fromMap ?? null;
}

const emit = defineEmits<{
  (e: "toggle", groupId: string): void;
  (e: "showToast", message: string, type: "error" | "success" | "info"): void;
  (e: "heightChanged"): void;
}>();

const childrenWrapper = ref<HTMLElement | null>(null);

const isExpanded = computed(
  () => props.expandedGroups[props.group.id] ?? false,
);
let transitionTimer: ReturnType<typeof setTimeout> | null = null;

function clearTransitionTimer() {
  if (transitionTimer === null) return;
  clearTimeout(transitionTimer);
  transitionTimer = null;
}

function queueNextFrame(callback: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
}

function getWrapperHeight(element: HTMLElement) {
  return Math.max(Math.ceil(element.scrollHeight), 1);
}

function applyTransitionStyles(element: HTMLElement) {
  element.style.overflow = "hidden";
  element.style.willChange = "height, opacity";
  element.style.transition =
    "height 360ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms ease";
}

function resetTransitionStyles(element: HTMLElement) {
  element.style.transition = "";
  element.style.willChange = "";
}

function waitForHeightTransition(element: HTMLElement, done: () => void) {
  clearTransitionTimer();

  const finish = () => {
    element.removeEventListener("transitionend", handleTransitionEnd);
    clearTransitionTimer();
    done();
  };

  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== element || event.propertyName !== "height") return;
    finish();
  };

  element.addEventListener("transitionend", handleTransitionEnd);
  transitionTimer = setTimeout(finish, 520);
}

function onBeforeEnter(element: Element) {
  const wrapper = element as HTMLElement;
  clearTransitionTimer();
  wrapper.style.height = "0px";
  wrapper.style.opacity = "0";
  wrapper.style.overflow = "hidden";
}

function onEnter(element: Element, done: () => void) {
  const wrapper = element as HTMLElement;
  applyTransitionStyles(wrapper);

  queueNextFrame(() => {
    wrapper.style.height = `${getWrapperHeight(wrapper)}px`;
    wrapper.style.opacity = "1";
  });

  waitForHeightTransition(wrapper, done);
}

function onAfterEnter(element: Element) {
  const wrapper = element as HTMLElement;
  clearTransitionTimer();
  resetTransitionStyles(wrapper);
  wrapper.style.height = "auto";
  wrapper.style.opacity = "1";
  wrapper.style.overflow = "visible";
  emit("heightChanged");
}

function onBeforeLeave(element: Element) {
  const wrapper = element as HTMLElement;
  clearTransitionTimer();
  wrapper.style.height = `${getWrapperHeight(wrapper)}px`;
  wrapper.style.opacity = "1";
  wrapper.style.overflow = "hidden";
}

function onLeave(element: Element, done: () => void) {
  const wrapper = element as HTMLElement;
  applyTransitionStyles(wrapper);

  queueNextFrame(() => {
    wrapper.style.height = "0px";
    wrapper.style.opacity = "0";
  });

  waitForHeightTransition(wrapper, done);
}

function onAfterLeave(element: Element) {
  const wrapper = element as HTMLElement;
  clearTransitionTimer();
  resetTransitionStyles(wrapper);
  wrapper.style.height = "0px";
  wrapper.style.opacity = "0";
  wrapper.style.overflow = "hidden";
  emit("heightChanged");
}

function onCancelled(element: Element) {
  const wrapper = element as HTMLElement;
  clearTransitionTimer();
  resetTransitionStyles(wrapper);

  if (isExpanded.value) {
    wrapper.style.height = "auto";
    wrapper.style.opacity = "1";
    wrapper.style.overflow = "visible";
  } else {
    wrapper.style.height = "0px";
    wrapper.style.opacity = "0";
    wrapper.style.overflow = "hidden";
  }
}

// Обработчик изменения высоты дочерних элементов
async function handleChildHeightChange() {
  await nextTick();
  if (childrenWrapper.value && childrenWrapper.value.style.height !== "auto") {
    childrenWrapper.value.style.height = `${getWrapperHeight(childrenWrapper.value)}px`;
  }
  emit("heightChanged");
}

function toggleExpand(groupId: string) {
  emit("toggle", groupId);
}

onBeforeUnmount(() => {
  clearTransitionTimer();
});
</script>

<style scoped>
.liquid-tree-item {
  @apply mb-2;
}

.liquid-tree-children-wrapper {
  @apply overflow-hidden;
}

.liquid-tree-children {
  @apply mt-2 space-y-2;
}
</style>
