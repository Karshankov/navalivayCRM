<template>
  <form class="review-form" @submit.prevent="handleSubmit">
    <div class="review-form__stars" role="radiogroup" aria-label="Оценка">
      <button
        v-for="star in 5"
        :key="star"
        type="button"
        class="review-form__star"
        :class="{ 'review-form__star--active': star <= rating }"
        :aria-checked="rating === star"
        role="radio"
        :disabled="disabled"
        @click="setRating(star)"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.5L14.9 9.3L21.2 10.2L16.6 14.6L17.8 21L12 18.1L6.2 21L7.4 14.6L2.8 10.2L9.1 9.3L12 3.5Z"
            :fill="star <= rating ? '#F50302' : 'transparent'"
            :stroke="star <= rating ? '#F50302' : '#AAB2BD'"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <div class="review-form__body">
      <label class="review-form__field">
        <span class="review-form__label">Ваш отзыв</span>
        <div class="review-form__textarea-wrap">
          <textarea
            v-model="bodyText"
            class="review-form__textarea"
            rows="3"
            :disabled="disabled"
            placeholder="Расскажите, что понравилось или не понравилось"
            @input="emit('update:bodyText', bodyText)"
          />
          <span
            class="review-form__counter"
            :class="{ 'review-form__counter--ok': bodyText.trim().length >= 20 }"
          >
            {{ bodyText.trim().length }} / 20
          </span>
        </div>
      </label>

      <div
        v-if="rating > 0 && quickTags.length"
        class="review-form__extras"
      >
        <span class="review-form__extras-label">Дополнительно</span>
        <div class="review-form__tags-list" :class="tagsLayoutClass">
          <button
            v-for="tag in quickTags"
            :key="tag.id"
            type="button"
            class="review-form__tag"
            :class="{ 'review-form__tag--selected': isTagSelected(tag.id) }"
            :aria-pressed="isTagSelected(tag.id)"
            :disabled="disabled"
            @click.stop="toggleTag(tag)"
          >
            {{ tag.label }}
          </button>
        </div>
      </div>
    </div>

    <footer class="review-form__footer">
      <label class="review-form__anonymous">
        <input
          v-model="anonymous"
          type="checkbox"
          class="review-form__anonymous-input"
          :disabled="disabled"
          @change="emit('update:anonymous', anonymous)"
        />
        <span>Опубликовать анонимно</span>
      </label>

      <p v-if="errorMessage" class="review-form__error">{{ errorMessage }}</p>

      <button
        type="submit"
        class="review-form__submit"
        :disabled="disabled || !canSubmit"
      >
        {{ submitting ? "Отправляем…" : "Отправить отзыв" }}
      </button>
    </footer>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { QuickTag } from "@/composables/useCustomerOrders";
import { resolveQuickTagsLayout } from "@/utils/reviewQuickTagsLayout";

const props = withDefaults(
  defineProps<{
    initialRating?: number;
    initialBodyText?: string;
    initialAnonymous?: boolean;
    quickTags?: QuickTag[];
    disabled?: boolean;
    submitting?: boolean;
    errorMessage?: string | null;
  }>(),
  {
    initialRating: 0,
    initialBodyText: "",
    initialAnonymous: false,
    quickTags: () => [],
    disabled: false,
    submitting: false,
    errorMessage: null,
  },
);

const emit = defineEmits<{
  submit: [
    payload: {
      rating: number;
      body_text: string;
      quick_tag_ids: string[];
      is_anonymous: boolean;
    },
  ];
  "update:rating": [value: number];
  "update:bodyText": [value: string];
  "update:anonymous": [value: boolean];
}>();

const rating = ref(props.initialRating);
const bodyText = ref(props.initialBodyText);
const anonymous = ref(props.initialAnonymous);
const selectedTagIds = ref<string[]>([]);

const canSubmit = computed(
  () => rating.value >= 1 && rating.value <= 5 && bodyText.value.trim().length >= 20,
);

const tagsLayoutClass = computed(() => resolveQuickTagsLayout(props.quickTags.length));

watch(
  () => props.initialRating,
  (value) => {
    if (value > 0) rating.value = value;
  },
);

watch(
  () => props.initialAnonymous,
  (value) => {
    anonymous.value = value;
  },
);

function setRating(value: number) {
  rating.value = value;
  selectedTagIds.value = [];
  emit("update:rating", value);
}

function isTagSelected(tagId: string) {
  return selectedTagIds.value.includes(tagId);
}

function toggleTag(tag: QuickTag) {
  if (isTagSelected(tag.id)) {
    selectedTagIds.value = selectedTagIds.value.filter((id) => id !== tag.id);
    return;
  }
  selectedTagIds.value = [...selectedTagIds.value, tag.id];
}

function handleSubmit() {
  if (!canSubmit.value || props.disabled || props.submitting) return;
  emit("submit", {
    rating: rating.value,
    body_text: bodyText.value.trim(),
    quick_tag_ids: [...selectedTagIds.value],
    is_anonymous: anonymous.value,
  });
}

</script>

<style scoped>
.review-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.review-form__stars {
  display: flex;
  align-items: center;
  gap: 4px;
}

.review-form__star {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  line-height: 0;
}

.review-form__star:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.review-form__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.review-form__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.review-form__label {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  color: #5c6470;
}

.review-form__textarea-wrap {
  position: relative;
}

.review-form__textarea {
  width: 100%;
  min-height: 76px;
  max-height: 120px;
  border: none;
  border-radius: 14px;
  padding: 10px 12px 28px;
  resize: none;
  box-sizing: border-box;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 15px;
  line-height: 20px;
  color: #191919;
  background: #f3f5f8;
}

.review-form__textarea:focus {
  outline: none;
  background: #ffffff;
  box-shadow: 0 0 0 2px rgba(245, 3, 2, 0.14);
}

.review-form__counter {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 11px;
  line-height: 13px;
  color: #aab2bd;
  pointer-events: none;
}

.review-form__counter--ok {
  color: #16a34a;
}

.review-form__extras {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-form__extras-label {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  color: #8a93a0;
}

.review-form__tags-list {
  display: grid;
  gap: 6px;
}

.review-form__tags-list--grid-1 {
  grid-template-columns: minmax(0, 1fr);
}

.review-form__tags-list--grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.review-form__tags-list--grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.review-form__tags-list--grid-4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.review-form__tags-list--scroll {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.review-form__tags-list--scroll::-webkit-scrollbar {
  display: none;
}

.review-form__tag {
  border: none;
  border-radius: 12px;
  min-height: 32px;
  padding: 6px 8px;
  background: #eef1f5;
  color: #3d4652;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, color 0.15s ease;
  text-align: center;
  white-space: normal;
}

.review-form__tags-list--grid-1 .review-form__tag,
.review-form__tags-list--grid-2 .review-form__tag,
.review-form__tags-list--grid-3 .review-form__tag,
.review-form__tags-list--grid-4 .review-form__tag {
  width: 100%;
}

.review-form__tags-list--scroll .review-form__tag {
  flex: 0 0 auto;
  border-radius: 999px;
  min-height: 34px;
  padding: 7px 14px;
  font-size: 13px;
  line-height: 16px;
  white-space: nowrap;
}

.review-form__tag--selected {
  background: rgba(245, 3, 2, 0.12);
  color: #a90f0e;
  font-weight: 600;
}

.review-form__tag:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.review-form__footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

.review-form__anonymous {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 16px;
  color: #5c6470;
}

.review-form__anonymous-input {
  width: 18px;
  height: 18px;
  accent-color: #f50302;
}

.review-form__error {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 17px;
  color: #be123c;
}

.review-form__submit {
  width: 100%;
  min-height: 48px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-weight: 600;
  font-size: 15px;
  line-height: 19px;
  cursor: pointer;
}

.review-form__submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>