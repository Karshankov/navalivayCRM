<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl">Отзывы</h1>
          <p class="mt-2 text-sm text-gray-600">Модерация, ответы, быстрые теги и розыгрыш</p>
        </div>
      </div>

      <div
        class="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Разделы отзывов"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :id="`reviews-tab-${tab.id}`"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`reviews-panel-${tab.id}`"
          class="inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          :class="
            activeTab === tab.id
              ? 'border-blue-200 bg-white text-blue-700 shadow-md ring-1 ring-blue-100'
              : 'border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900'
          "
          @click="requestTabChange(tab.id)"
        >
          {{ tab.label }}
          <span
            v-if="tab.id === 'moderation' && pendingCount"
            class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
          >
            {{ pendingCount }}
          </span>
          <span
            v-if="tab.id === 'replies' && unansweredCount"
            class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
          >
            {{ unansweredCount }}
          </span>
        </button>
      </div>

      <!-- Модерация -->
      <section
        v-if="activeTab === 'moderation'"
        id="reviews-panel-moderation"
        role="tabpanel"
        aria-labelledby="reviews-tab-moderation"
        class="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm"
      >
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-900">На модерации</h2>
          <CrmButton
            variant="secondary"
            size="sm"
            refresh-icon
            :loading="loading"
            loading-label="Обновляем..."
            @click="loadReviews"
          >
            Обновить
          </CrmButton>
        </div>

        <p class="mt-2 text-xs text-slate-400">В очереди до 200 штук.</p>

        <div v-if="loading && pendingReviews.length === 0" class="py-8 text-center text-slate-500">
          Загрузка...
        </div>
        <div v-else-if="pendingReviews.length === 0" class="py-8 text-center text-slate-500">
          <p>Очередь пуста.</p>
          <p class="mt-1 text-sm">Появятся после выдачи заказа.</p>
        </div>
        <div
          v-else
          class="relative mt-4 space-y-4"
          :class="{ 'pointer-events-none opacity-60': loading }"
        >
          <article
            v-for="review in pendingReviews"
            :key="review.id"
            class="rounded-xl border border-slate-200/70 p-4"
          >
            <div class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <RouterLink
                v-if="review.order_id"
                :to="`/admin/crm/orders/${review.order_id}`"
                class="font-semibold text-blue-700 hover:underline"
              >
                Заказ №{{ review.order_number }}
              </RouterLink>
              <strong v-else class="text-slate-900">Заказ №{{ review.order_number }}</strong>
              <span>{{ review.group_name }}</span>
              <span aria-label="Оценка">{{ "★".repeat(review.rating) }}</span>
              <span v-if="review.created_at" class="text-xs text-slate-400">
                {{ formatReviewDate(review.created_at) }}
              </span>
            </div>
            <p class="mt-2 whitespace-pre-wrap text-sm text-slate-800">{{ review.body_text }}</p>
            <p class="mt-1 text-xs text-slate-500">
              {{ review.first_name }}
              <span v-if="review.telegram_username">@{{ review.telegram_username }}</span>
              <span v-else>нет Telegram</span>
              <span v-if="review.purchased_variant_name">· {{ review.purchased_variant_name }}</span>
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <CrmButton
                variant="success"
                :loading="moderatingId === review.id"
                loading-label="Сохраняем..."
                @click="requestModerate(review, 'approve')"
              >
                Одобрить
              </CrmButton>
              <CrmButton
                variant="muted"
                :disabled="moderatingId === review.id"
                @click="requestModerate(review, 'reject')"
              >
                Отклонить
              </CrmButton>
            </div>
          </article>
        </div>
      </section>

      <!-- Ответы -->
      <section
        v-if="activeTab === 'replies'"
        id="reviews-panel-replies"
        role="tabpanel"
        aria-labelledby="reviews-tab-replies"
        class="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-900">Ответы менеджера</h2>
          <CrmButton
            variant="secondary"
            size="sm"
            refresh-icon
            :loading="approvedLoading"
            loading-label="Обновляем..."
            @click="requestLoadApprovedReviews"
          >
            Обновить
          </CrmButton>
        </div>
        <p class="mt-1 text-sm text-slate-500">
          Клиент увидит после одобрения отзыва.
        </p>

        <div class="mt-4 flex gap-2" role="group" aria-label="Фильтр ответов">
          <CrmButton
            variant="filter"
            size="sm"
            :pressed="replyFilter === 'all'"
            @click="replyFilter = 'all'"
          >
            Все
          </CrmButton>
          <CrmButton
            variant="filter"
            size="sm"
            :pressed="replyFilter === 'unanswered'"
            @click="replyFilter = 'unanswered'"
          >
            Без ответа
            <span
              v-if="unansweredCount"
              class="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800"
            >
              {{ unansweredCount }}
            </span>
          </CrmButton>
        </div>

        <p class="mt-2 text-xs text-slate-400">До 200 одобренных.</p>

        <div v-if="approvedLoading && approvedReviews.length === 0" class="py-6 text-center text-slate-500">
          Загрузка...
        </div>
        <div v-else-if="approvedReviews.length === 0" class="py-6 text-center text-slate-500">
          <p>Одобренных отзывов пока нет.</p>
          <p class="mt-1 text-sm">Сначала одобри в модерации.</p>
        </div>
        <div v-else-if="filteredApprovedReviews.length === 0" class="py-6 text-center text-slate-500">
          <p>Все одобренные отзывы уже с ответом.</p>
        </div>
        <div
          v-else
          class="relative mt-4 space-y-4"
          :class="{ 'pointer-events-none opacity-60': approvedLoading }"
        >
          <article
            v-for="review in filteredApprovedReviews"
            :key="review.id"
            class="rounded-xl border border-slate-100 bg-slate-50 p-4"
          >
            <div class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <RouterLink
                v-if="review.order_id"
                :to="`/admin/crm/orders/${review.order_id}`"
                class="font-semibold text-blue-700 hover:underline"
              >
                Заказ №{{ review.order_number }}
              </RouterLink>
              <strong v-else-if="review.order_number" class="text-slate-900">
                Заказ №{{ review.order_number }}
              </strong>
              <strong class="text-slate-900">{{ review.group_name }}</strong>
              <span aria-label="Оценка">{{ "★".repeat(review.rating) }}</span>
              <span v-if="review.created_at" class="text-xs text-slate-400">
                {{ formatReviewDate(review.created_at) }}
              </span>
            </div>
            <p class="mt-1 text-xs text-slate-500">
              {{ review.first_name }}
              <span v-if="review.telegram_username">@{{ review.telegram_username }}</span>
              <span v-else>нет Telegram</span>
              <span v-if="review.purchased_variant_name">· {{ review.purchased_variant_name }}</span>
            </p>
            <p class="mt-2 whitespace-pre-wrap text-sm text-slate-700">{{ review.body_text }}</p>
            <p v-if="review.manager_reply" class="mt-2 text-sm text-slate-600">
              <span class="font-medium">Текущий ответ:</span> {{ review.manager_reply }}
            </p>
            <div class="mt-3 flex flex-col gap-2 sm:flex-row">
              <textarea
                v-model="replyDrafts[review.id]"
                rows="3"
                class="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Ответ от лица магазина"
              />
              <div class="flex flex-col gap-1 sm:w-44">
                <CrmButton
                  variant="primary"
                  :disabled="!replyDrafts[review.id]?.trim()"
                  :loading="savingReplyId === review.id"
                  loading-label="Сохраняем..."
                  :title="replyDrafts[review.id]?.trim() ? '' : 'Нужен текст ответа'"
                  @click="saveReply(review.id)"
                >
                  Сохранить ответ
                </CrmButton>
                <p v-if="!replyDrafts[review.id]?.trim()" class="text-xs text-slate-500">
                  Нужен текст ответа
                </p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <!-- Быстрые теги -->
      <section
        v-if="activeTab === 'tags'"
        id="reviews-panel-tags"
        role="tabpanel"
        aria-labelledby="reviews-tab-tags"
        class="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm"
      >
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-900">Быстрые теги</h2>
          <CrmButton
            variant="secondary"
            size="sm"
            refresh-icon
            :loading="quickTagsLoading"
            loading-label="Обновляем..."
            @click="loadQuickTags"
          >
            Обновить
          </CrmButton>
        </div>

        <p class="mt-3 text-sm text-slate-500">
          Клиент выбирает звёзды, пишет отзыв вручную и при желании нажимает кнопки в блоке «Дополнительно».
          Текст в поле отзыва не подставляется — теги сохраняются отдельно и показываются рядом с отзывом.
        </p>

        <form
          class="mt-4 grid gap-3 rounded-xl border border-dashed border-slate-200 p-4 sm:grid-cols-2"
          @submit.prevent="createQuickTag"
        >
          <label class="block text-sm">
            <span class="font-medium text-slate-700">Категория</span>
            <select
              v-model="newTag.category_key"
              class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            >
              <option v-for="key in categoryKeys" :key="key" :value="key">
                {{ categoryLabel(key) }}
              </option>
            </select>
          </label>
          <label class="block text-sm">
            <span class="font-medium text-slate-700">Звёзды</span>
            <select
              v-model.number="newTag.star_rating"
              class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            >
              <option v-for="star in 5" :key="star" :value="star">{{ star }}</option>
            </select>
          </label>
          <label class="block text-sm sm:col-span-2">
            <span class="font-medium text-slate-700">Текст кнопки</span>
            <input
              v-model="newTag.label"
              type="text"
              placeholder="Например: Очень вкусно"
              class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
            />
            <span class="mt-1 block text-xs text-slate-500">
              Так кнопка будет выглядеть у клиента в Telegram.
            </span>
          </label>
          <p v-if="!canCreateTag" class="text-xs text-slate-500 sm:col-span-2">
            Укажите текст кнопки.
          </p>
          <div class="sm:col-span-2">
            <CrmButton
              type="submit"
              variant="primary"
              :disabled="!canCreateTag"
              :loading="creatingTag"
              loading-label="Добавляем..."
              block
            >
              Добавить тег
            </CrmButton>
          </div>
        </form>

        <div v-if="quickTagsLoading && quickTags.length === 0" class="py-6 text-center text-slate-500">
          Загрузка...
        </div>
        <div v-else-if="quickTags.length === 0" class="py-6 text-center text-slate-500">
          <p>Тегов пока нет.</p>
          <p class="mt-1 text-sm">Создай первый выше.</p>
        </div>
        <div
          v-else
          class="relative mt-4 space-y-3 sm:hidden"
          :class="{ 'pointer-events-none opacity-60': quickTagsLoading }"
        >
          <article
            v-for="tag in quickTags"
            :key="`card-${tag.id}`"
            class="rounded-xl border border-slate-200/70 p-4 text-sm"
          >
            <p class="font-medium text-slate-900">{{ tag.label }}</p>
            <p class="mt-1 text-slate-600">{{ categoryLabel(tag.category_key) }} · {{ tag.star_rating }} ★</p>
            <div class="mt-3 flex items-center justify-between">
              <label class="inline-flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  :checked="Boolean(tag.is_active)"
                  :disabled="togglingTagId === tag.id"
                  :aria-label="`Тег ${tag.label} активен`"
                  @change="toggleTagActive(tag)"
                />
                Активен
              </label>
              <CrmButton
                variant="danger"
                size="sm"
                :loading="deletingTagId === tag.id"
                loading-label="Удаляем..."
                @click="requestDeleteTag(tag)"
              >
                Удалить
              </CrmButton>
            </div>
          </article>
        </div>
        <div
          v-if="quickTags.length"
          class="relative mt-4 hidden overflow-x-auto sm:block"
          :class="{ 'pointer-events-none opacity-60': quickTagsLoading }"
        >
          <table class="min-w-full text-left text-sm">
            <thead>
              <tr class="border-b border-slate-200 text-slate-500">
                <th class="px-2 py-2">Категория</th>
                <th class="px-2 py-2">★</th>
                <th class="px-2 py-2">Текст кнопки</th>
                <th class="px-2 py-2">Активен</th>
                <th class="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="tag in quickTags" :key="tag.id" class="border-b border-slate-100">
                <td class="px-2 py-2">{{ categoryLabel(tag.category_key) }}</td>
                <td class="px-2 py-2">{{ tag.star_rating }}</td>
                <td class="px-2 py-2">{{ tag.label }}</td>
                <td class="px-2 py-2">
                  <label class="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      :checked="Boolean(tag.is_active)"
                      :disabled="togglingTagId === tag.id"
                      :aria-label="`Тег ${tag.label} активен`"
                      @change="toggleTagActive(tag)"
                    />
                    <span class="sr-only">Активен</span>
                  </label>
                </td>
                <td class="px-2 py-2 text-right">
                  <CrmButton
                    variant="danger"
                    size="sm"
                    :loading="deletingTagId === tag.id"
                    loading-label="Удаляем..."
                    @click="requestDeleteTag(tag)"
                  >
                    Удалить
                  </CrmButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Розыгрыш -->
      <section
        v-if="activeTab === 'draw'"
        id="reviews-panel-draw"
        role="tabpanel"
        aria-labelledby="reviews-tab-draw"
        class="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-900">Розыгрыш месяца</h2>
          <CrmButton
            variant="secondary"
            size="sm"
            refresh-icon
            :loading="drawsLoading"
            loading-label="Обновляем..."
            @click="loadDraws"
          >
            Обновить
          </CrmButton>
        </div>

        <div
          class="mt-4 rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50/80 to-fuchsia-50/50 p-4 text-sm"
          role="status"
        >
          <p class="font-semibold text-violet-950">
            Текущий период: {{ currentPeriodLabel }}
          </p>
          <p class="mt-1 text-violet-900/90">
            Учитываются одобренные отзывы с {{ periodStartLabel }}.
          </p>
          <p class="mt-1 text-violet-900/90">
            Автоматический розыгрыш: {{ autoScheduleLabel }}
          </p>
          <p v-if="currentPeriodDrawn" class="mt-2 font-medium text-emerald-800">
            Розыгрыш за {{ currentPeriodLabel }} завершён.
          </p>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <CrmButton
              variant="primary"
              size="sm"
              :loading="runningDraw"
              :disabled="currentPeriodDrawn"
              loading-label="Запускаем..."
              @click="requestRunDraw"
            >
              Запустить досрочно
            </CrmButton>
            <p class="text-xs text-violet-800/80">
              По расписанию розыгрыш запускается автоматически. Досрочный запуск используйте при необходимости.
            </p>
          </div>
          <button
            v-if="crmStore.isDrawBannerDismissed && crmStore.latestMonthlyDraw"
            type="button"
            class="mt-3 text-xs font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-950"
            @click="crmStore.clearDrawAcknowledgement()"
          >
            Вернуть уведомление на доске заказов
          </button>
        </div>

        <div
          v-if="draws.length"
          class="relative mt-4 space-y-3"
          :class="{ 'pointer-events-none opacity-60': drawsLoading }"
        >
          <article
            v-for="draw in draws"
            :key="draw.id"
            class="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="font-medium text-slate-900">{{ formatPeriodKey(draw.period_key) }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ formatDrawStatus(draw) }}</p>
              </div>
              <p v-if="draw.drawn_at" class="text-xs text-slate-400">
                {{ formatDrawDate(draw.drawn_at) }}
              </p>
            </div>
            <ul v-if="draw.winners.length" class="mt-3 space-y-2 text-slate-700">
              <li
                v-for="winner in draw.winners"
                :key="winner.id"
                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-white px-3 py-2"
              >
                <span>
                  <span class="font-medium text-slate-900">Место {{ winner.seat_number }}:</span>
                  {{ formatWinnerLabel(winner) }}
                </span>
                <CrmButton
                  variant="soft"
                  size="sm"
                  :loading="rerollingKey === `${draw.id}-${winner.seat_number}`"
                  loading-label="Переразыгрываем..."
                  @click="requestReroll(draw, winner.seat_number)"
                >
                  Переразыграть
                </CrmButton>
              </li>
            </ul>
            <p v-else class="mt-3 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-slate-500">
              Одобренных отзывов за период нет. Победители не определены.
            </p>
          </article>
        </div>
        <div v-else-if="drawsLoading" class="mt-4 py-6 text-center text-slate-500">
          Загрузка...
        </div>
        <div
          v-else
          class="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500"
        >
          <p class="font-medium text-slate-700">История розыгрышей пуста</p>
          <p class="mt-1">
            Первый розыгрыш запланирован на {{ autoScheduleLabel }}. Досрочный запуск доступен кнопкой выше.
          </p>
        </div>
      </section>

      <!-- Настройки -->
      <section
        v-if="activeTab === 'settings'"
        id="reviews-panel-settings"
        role="tabpanel"
        aria-labelledby="reviews-tab-settings"
        class="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm"
        :class="{ 'pb-24': settingsDirty }"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">Параметры отзывов</h2>
            <p class="mt-1 text-sm text-slate-500">
              Пауза, текст розыгрыша, имя и аватар в ответах.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <CrmButton
              variant="secondary"
              size="sm"
              refresh-icon
              :loading="settingsLoading"
              loading-label="Обновляем..."
              @click="requestLoadSettings"
            >
              Обновить
            </CrmButton>
          </div>
        </div>

        <div v-if="settingsLoading && !settingsLoaded" class="mt-6 space-y-4">
          <div v-for="n in 3" :key="n" class="h-24 animate-pulse rounded-xl bg-slate-100" />
        </div>

        <div v-else class="mt-6 lg:grid lg:grid-cols-[1fr_280px] lg:gap-6">
          <div class="space-y-4">
            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-900">Для покупателей</h3>
              <p class="mt-1 text-xs text-slate-500">
                Показывается при оставлении отзыва в Telegram.
              </p>

              <label class="mt-4 block text-sm">
                <span class="font-medium text-slate-700">Пауза между отзывами</span>
                <div class="mt-1 flex items-center gap-2">
                  <input
                    v-model.number="settings.cooldown_days"
                    type="number"
                    min="1"
                    max="365"
                    class="w-24 rounded-xl border px-3 py-2.5"
                    :class="settingsValidationErrors.cooldown_days ? 'border-red-300' : 'border-slate-300'"
                  />
                  <span class="text-slate-500">дней</span>
                </div>
                <span class="mt-1 block text-xs text-slate-500">
                  Один отзыв на линейку товара.
                </span>
                <span v-if="settingsValidationErrors.cooldown_days" class="mt-1 block text-xs text-red-600">
                  {{ settingsValidationErrors.cooldown_days }}
                </span>
              </label>

              <label class="mt-4 block text-sm">
                <span class="font-medium text-slate-700">Текст про розыгрыш</span>
                <input
                  v-model="settings.lottery_hint_text"
                  type="text"
                  maxlength="120"
                  class="mt-1 w-full rounded-xl border px-3 py-2.5"
                  :class="settingsValidationErrors.lottery_hint_text ? 'border-red-300' : 'border-slate-300'"
                  placeholder="Каждый месяц разыгрываем 5 подарков среди авторов отзывов"
                />
                <span class="mt-1 flex justify-between text-xs text-slate-500">
                  <span>В карточке заказа и в подсказке к отзыву.</span>
                  <span>{{ settings.lottery_hint_text.length }}/120</span>
                </span>
                <span v-if="settingsValidationErrors.lottery_hint_text" class="mt-1 block text-xs text-red-600">
                  {{ settingsValidationErrors.lottery_hint_text }}
                </span>
              </label>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4">
              <h3 class="text-sm font-semibold text-slate-900">Профиль ответов менеджера</h3>
              <p class="mt-1 text-xs text-slate-500">
                Как подписываем ответы клиентам.
              </p>

              <div class="mt-4 grid gap-4 sm:grid-cols-2">
                <label class="block text-sm">
                  <span class="font-medium text-slate-700">Имя в ответах</span>
                  <input
                    v-model="settings.manager_display_name"
                    type="text"
                    class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    placeholder="Костя"
                  />
                </label>

                <label class="block text-sm">
                  <span class="font-medium text-slate-700">Ссылка на аватар</span>
                  <input
                    v-model="settings.manager_avatar_url"
                    type="text"
                    class="mt-1 w-full rounded-xl border px-3 py-2.5"
                    :class="settingsValidationErrors.manager_avatar_url ? 'border-red-300' : 'border-slate-300'"
                    placeholder="/favicon.png"
                    @input="avatarPreviewError = false"
                  />
                  <span class="mt-1 block text-xs text-slate-500">
                    Можно указать путь вида /favicon.png или полную ссылку на картинку. Лучше квадрат 64 на 64 пикселя.
                  </span>
                  <span v-if="settingsValidationErrors.manager_avatar_url" class="mt-1 block text-xs text-red-600">
                    {{ settingsValidationErrors.manager_avatar_url }}
                  </span>
                  <div class="mt-2 flex items-center gap-2">
                    <img
                      :src="managerAvatarPreviewUrl"
                      alt=""
                      class="h-12 w-12 rounded-full border border-slate-200 bg-slate-50 object-cover"
                      @error="avatarPreviewError = true"
                    />
                    <span class="text-xs text-slate-500">так увидит клиент</span>
                  </div>
                </label>
              </div>
            </section>
          </div>

          <aside class="mt-6 hidden lg:block">
            <div class="sticky top-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 class="text-sm font-semibold text-slate-900">Что видит клиент</h3>

              <div class="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Подсказка к отзыву</p>
                <p class="mt-2 text-sm font-semibold text-slate-900">{{ previewDockTitle }}</p>
                <p class="mt-1 text-xs text-slate-600">{{ previewDockMetaLine }}</p>
              </div>

              <div class="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Карточка заказа</p>
                <p class="mt-2 text-sm font-medium text-slate-900">Отзывы по заказу</p>
                <p class="mt-1 text-sm text-slate-600">
                  {{ settings.lottery_hint_text.trim() || "текст не задан" }}
                </p>
              </div>

              <div class="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Ответ менеджера</p>
                <div class="mt-2 flex items-start gap-2">
                  <img
                    :src="managerAvatarPreviewUrl"
                    alt=""
                    class="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover"
                    @error="avatarPreviewError = true"
                  />
                  <div>
                    <p class="text-sm font-medium text-slate-900">{{ previewManagerName }}</p>
                    <p class="mt-1 text-sm italic text-slate-500">
                      «Спасибо за отзыв! Рады, что понравилось.»
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>

    <Transition name="toast-slide">
      <div
        v-if="settingsDirty && activeTab === 'settings'"
        class="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
      >
        <div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
          <p class="flex items-center gap-2 text-sm text-slate-700">
            <span class="h-2 w-2 rounded-full bg-amber-500" />
            Есть несохранённые изменения
          </p>
          <div class="flex items-center gap-2">
            <CrmButton variant="ghost" size="sm" @click="resetSettingsToBaseline">
              Сбросить
            </CrmButton>
            <CrmButton
              variant="primary"
              size="sm"
              :disabled="hasValidationErrors"
              :loading="savingSettings"
              loading-label="Сохраняем..."
              @click="saveSettings"
            >
              Сохранить
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Confirm: модерация -->
    <Transition name="modal-fade">
      <div
        v-if="confirmModerate"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmModerate = null)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-moderate-title"
          @keydown.esc="confirmModerate = null"
        >
          <h3 id="reviews-confirm-moderate-title" class="mb-2 text-base font-semibold text-slate-900">
            {{ confirmModerate.action === "approve" ? "Одобрить отзыв?" : "Отклонить отзыв?" }}
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Заказ №{{ confirmModerate.review.order_number }}, {{ confirmModerate.review.group_name }}.
            {{ confirmModerate.action === "reject" ? "Отклонённый отзыв не появится у покупателей." : "Отзыв станет виден в каталоге." }}
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmModerate = null">
              Отмена
            </CrmButton>
            <CrmButton
              :variant="confirmModerate.action === 'approve' ? 'success' : 'muted'"
              size="sm"
              @click="moderateConfirmed"
            >
              {{ confirmModerate.action === "approve" ? "Одобрить" : "Отклонить" }}
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Confirm: розыгрыш -->
    <Transition name="modal-fade">
      <div
        v-if="confirmRunDraw"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmRunDraw = false)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-draw-title"
          @keydown.esc="confirmRunDraw = false"
        >
          <h3 id="reviews-confirm-draw-title" class="mb-2 text-base font-semibold text-slate-900">
            Запустить розыгрыш досрочно?
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Будут выбраны 5 победителей за {{ currentPeriodLabel }} из одобренных отзывов текущего месяца.
            Повторный запуск за этот период недоступен.
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmRunDraw = false">
              Отмена
            </CrmButton>
            <CrmButton variant="primary" size="sm" @click="runDrawConfirmed">
              Запустить досрочно
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Confirm: переразыгрыш -->
    <Transition name="modal-fade">
      <div
        v-if="confirmReroll"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmReroll = null)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-reroll-title"
          @keydown.esc="confirmReroll = null"
        >
          <h3 id="reviews-confirm-reroll-title" class="mb-2 text-base font-semibold text-slate-900">
            Переразыграть место?
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Место {{ confirmReroll.seatNumber }} за {{ confirmReroll.periodLabel }} получит нового победителя.
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmReroll = null">
              Отмена
            </CrmButton>
            <CrmButton variant="soft" size="sm" @click="rerollConfirmed">
              Переразыграть
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Confirm: обновление ответов с черновиками -->
    <Transition name="modal-fade">
      <div
        v-if="confirmRefreshReplies"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmRefreshReplies = false)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-refresh-replies-title"
          @keydown.esc="confirmRefreshReplies = false"
        >
          <h3 id="reviews-confirm-refresh-replies-title" class="mb-2 text-base font-semibold text-slate-900">
            Обновить список ответов?
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Есть несохранённые ответы. После обновления черновики пропадут.
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmRefreshReplies = false">
              Оставить черновики
            </CrmButton>
            <CrmButton variant="primary" size="sm" @click="refreshRepliesConfirmed">
              Обновить список
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Confirm: уйти с несохранёнными настройками -->
    <Transition name="modal-fade">
      <div
        v-if="confirmLeaveSettings"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="cancelLeaveSettings"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-leave-settings-title"
          @keydown.esc="cancelLeaveSettings"
        >
          <h3 id="reviews-confirm-leave-settings-title" class="mb-2 text-base font-semibold text-slate-900">
            Есть несохранённые настройки
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Изменения не сохранены. Уйти без сохранения?
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="cancelLeaveSettings">
              Остаться
            </CrmButton>
            <CrmButton variant="primary" size="sm" @click="leaveSettingsConfirmed">
              Уйти без сохранения
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Confirm: обновить настройки с несохранёнными изменениями -->
    <Transition name="modal-fade">
      <div
        v-if="confirmRefreshSettings"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmRefreshSettings = false)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-refresh-settings-title"
          @keydown.esc="confirmRefreshSettings = false"
        >
          <h3 id="reviews-confirm-refresh-settings-title" class="mb-2 text-base font-semibold text-slate-900">
            Обновить настройки?
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Несохранённые изменения будут потеряны.
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmRefreshSettings = false">
              Оставить как есть
            </CrmButton>
            <CrmButton variant="primary" size="sm" @click="refreshSettingsConfirmed">
              Обновить
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Confirm: удаление тега -->
    <Transition name="modal-fade">
      <div
        v-if="confirmDeleteTag"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmDeleteTag = null)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-delete-tag-title"
          @keydown.esc="confirmDeleteTag = null"
        >
          <h3 id="reviews-confirm-delete-tag-title" class="mb-2 text-base font-semibold text-slate-900">
            Удалить быстрый тег?
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Тег «{{ confirmDeleteTag.label }}» для {{ categoryLabel(confirmDeleteTag.category_key) }} будет удалён без восстановления.
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmDeleteTag = null">
              Оставить
            </CrmButton>
            <CrmButton variant="danger-solid" size="sm" @click="deleteTagConfirmed">
              Удалить тег
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="toast-slide">
      <div
        v-if="toast"
        class="fixed bottom-6 right-6 z-[70] flex max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-lg"
        :class="
          toast.kind === 'success'
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
            : toast.kind === 'info'
              ? 'border border-blue-200 bg-blue-50 text-blue-800'
              : 'border border-red-200 bg-red-50 text-red-800'
        "
        :role="toast.kind === 'error' ? 'alert' : 'status'"
        :aria-live="toast.kind === 'error' ? 'assertive' : 'polite'"
        aria-atomic="true"
      >
        <span class="flex-1 text-sm font-medium">{{ toast.text }}</span>
        <CrmButton
          variant="ghost"
          size="sm"
          icon-only
          aria-label="Закрыть"
          @click="dismissToast"
        >
          ✕
        </CrmButton>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";
import { buildReviewDockMetaLine, buildReviewDockTitle } from "@/utils/reviewDockCopy";
import { vSafeBackdropClose } from "@/directives/safeBackdropClose";
import {
  formatReviewDrawPeriodKey,
  getCurrentReviewDrawPeriodKey,
  getReviewDrawAutoScheduleLabel,
  getReviewDrawPeriodStartLabel,
} from "@/utils/reviewDrawPeriod";

type ReviewTabId = "moderation" | "replies" | "tags" | "draw" | "settings";
type ToastKind = "success" | "error" | "info";

interface ToastMessage {
  kind: ToastKind;
  text: string;
}

interface ReviewItem {
  id: string;
  order_id?: string;
  order_number?: string | number;
  group_name?: string;
  rating: number;
  body_text: string;
  first_name?: string;
  telegram_username?: string;
  purchased_variant_name?: string;
  manager_reply?: string | null;
  created_at?: string;
}

interface QuickTag {
  id: string;
  category_key: string;
  star_rating: number;
  label: string;

  is_active?: number | boolean;
}

interface DrawWinner {
  id: string;
  seat_number: number;
  telegram_username?: string;
  first_name?: string;
  customer_id?: string | number;
}

interface MonthlyDraw {
  id: string;
  period_key: string;
  drawn_at?: string;
  status?: string;
  winners: DrawWinner[];
}

const tabs: Array<{ id: ReviewTabId; label: string }> = [
  { id: "moderation", label: "Модерация" },
  { id: "replies", label: "Ответы" },
  { id: "tags", label: "Быстрые теги" },
  { id: "draw", label: "Розыгрыш" },
  { id: "settings", label: "Настройки" },
];

const CATEGORY_LABELS: Record<string, string> = {
  liquids: "Жидкости",
  snus: "Снюс",
  consumables: "Расходники",
  disposables: "Одноразки",
  devices: "Устройства",
  other: "Прочее",
};

const adminStore = useAdminStore();
const crmStore = useCrmStore();

const activeTab = ref<ReviewTabId>("moderation");
const replyFilter = ref<"all" | "unanswered">("unanswered");

const loading = ref(false);
const approvedLoading = ref(false);
const quickTagsLoading = ref(false);
const savingSettings = ref(false);
const settingsLoading = ref(false);
const settingsLoaded = ref(false);
const avatarPreviewError = ref(false);
const creatingTag = ref(false);
const runningDraw = ref(false);
const drawsLoading = ref(false);

const moderatingId = ref<string | null>(null);
const savingReplyId = ref<string | null>(null);
const togglingTagId = ref<string | null>(null);
const deletingTagId = ref<string | null>(null);
const rerollingKey = ref<string | null>(null);

const pendingCount = ref(0);
const pendingReviews = ref<ReviewItem[]>([]);
const approvedReviews = ref<ReviewItem[]>([]);
const quickTags = ref<QuickTag[]>([]);
const draws = ref<MonthlyDraw[]>([]);
const replyDrafts = reactive<Record<string, string>>({});

const categoryKeys = Object.keys(CATEGORY_LABELS);
interface ReviewSettingsState {
  cooldown_days: number;
  lottery_hint_text: string;
  manager_display_name: string;
  manager_avatar_url: string;
}

const settings = ref<ReviewSettingsState>({
  cooldown_days: 90,
  lottery_hint_text: "",
  manager_display_name: "",
  manager_avatar_url: "/favicon.png",
});
const settingsBaseline = ref<ReviewSettingsState>({ ...settings.value });
const newTag = ref({
  category_key: "liquids",
  star_rating: 5,
  label: "",
});

const toast = ref<ToastMessage | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const confirmModerate = ref<{ review: ReviewItem; action: "approve" | "reject" } | null>(null);
const confirmRunDraw = ref(false);
const confirmReroll = ref<{ drawId: string; seatNumber: number; periodLabel: string } | null>(null);
const confirmDeleteTag = ref<QuickTag | null>(null);
const confirmRefreshReplies = ref(false);
const confirmLeaveSettings = ref(false);
const confirmRefreshSettings = ref(false);
const pendingTabChange = ref<ReviewTabId | null>(null);

const unansweredCount = computed(
  () => approvedReviews.value.filter((review) => !review.manager_reply?.trim()).length,
);

const filteredApprovedReviews = computed(() => {
  if (replyFilter.value === "unanswered") {
    return approvedReviews.value.filter((review) => !review.manager_reply?.trim());
  }
  return approvedReviews.value;
});

const currentPeriodKey = computed(() => getCurrentReviewDrawPeriodKey());
const currentPeriodLabel = computed(() => formatReviewDrawPeriodKey(currentPeriodKey.value));
const periodStartLabel = computed(() => getReviewDrawPeriodStartLabel());
const autoScheduleLabel = computed(() => getReviewDrawAutoScheduleLabel());
const currentPeriodDrawn = computed(() =>
  draws.value.some((draw) => draw.period_key === currentPeriodKey.value),
);

const canCreateTag = computed(
  () => Boolean(newTag.value.label.trim()),
);

const previewDockTitle = computed(() => buildReviewDockTitle("Ваш заказ"));

const previewDockMetaLine = computed(() =>
  buildReviewDockMetaLine({
    order_number: 12345,
    lottery_hint_text: settings.value.lottery_hint_text,
    pending_review_count: 1,
  }),
);

const previewManagerName = computed(
  () => settings.value.manager_display_name.trim() || "Менеджер магазина",
);

const managerAvatarPreviewUrl = computed(() => {
  if (avatarPreviewError.value) return "/favicon.png";
  const url = settings.value.manager_avatar_url.trim();
  return url || "/favicon.png";
});

function isValidAvatarUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/")) return true;
  return /^https?:\/\/.+/i.test(trimmed);
}

function serializeSettingsSnapshot(source: ReviewSettingsState) {
  return JSON.stringify({
    cooldown_days: Number(source.cooldown_days) || 90,
    lottery_hint_text: source.lottery_hint_text.trim(),
    manager_display_name: source.manager_display_name.trim(),
    manager_avatar_url: source.manager_avatar_url.trim(),
  });
}

const settingsDirty = computed(
  () => serializeSettingsSnapshot(settings.value) !== serializeSettingsSnapshot(settingsBaseline.value),
);

const settingsValidationErrors = computed(() => ({
  cooldown_days:
    !Number.isFinite(settings.value.cooldown_days) || settings.value.cooldown_days < 1
      ? "Укажите не меньше 1 дня"
      : settings.value.cooldown_days > 365
        ? "Укажите не больше 365 дней"
        : "",
  lottery_hint_text:
    settings.value.lottery_hint_text.length > 120 ? "Сократите текст до 120 символов" : "",
  manager_avatar_url: isValidAvatarUrl(settings.value.manager_avatar_url)
    ? ""
    : "Укажите путь вида /favicon.png или ссылку, начинающуюся с https://",
}));

const hasValidationErrors = computed(() =>
  Object.values(settingsValidationErrors.value).some(Boolean),
);

function requestTabChange(tabId: ReviewTabId) {
  if (activeTab.value === "settings" && settingsDirty.value && tabId !== "settings") {
    pendingTabChange.value = tabId;
    confirmLeaveSettings.value = true;
    return;
  }
  activeTab.value = tabId;
}

function cancelLeaveSettings() {
  confirmLeaveSettings.value = false;
  pendingTabChange.value = null;
}

function leaveSettingsConfirmed() {
  resetSettingsToBaseline();
  confirmLeaveSettings.value = false;
  if (pendingTabChange.value) {
    activeTab.value = pendingTabChange.value;
    pendingTabChange.value = null;
  }
}

function resetSettingsToBaseline() {
  applySettingsPayload(settingsBaseline.value);
}

function applySettingsPayload(payload: Partial<ReviewSettingsState> & Record<string, unknown>) {
  settings.value = {
    cooldown_days: Number(payload.cooldown_days) || 90,
    lottery_hint_text: payload.lottery_hint_text || "",
    manager_display_name: payload.manager_display_name || "",
    manager_avatar_url: payload.manager_avatar_url || "/favicon.png",
  };
  settingsBaseline.value = { ...settings.value };
  avatarPreviewError.value = false;
}

function categoryLabel(key: string) {
  return CATEGORY_LABELS[key] || key;
}

function formatPeriodKey(periodKey: string) {
  return formatReviewDrawPeriodKey(periodKey);
}

function formatDrawDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDrawStatus(draw: MonthlyDraw) {
  const winnerCount = draw.winners?.length || 0;
  if (winnerCount > 0) {
    return `Завершён. ${formatDrawWinnerCount(winnerCount)}`;
  }
  return "Завершён. Одобренных отзывов за период не было";
}

function formatDrawWinnerCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} победитель`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} победителя`;
  }
  return `${count} победителей`;
}

function formatReviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWinnerLabel(winner: DrawWinner) {
  if (winner.telegram_username) return `@${winner.telegram_username}`;
  if (winner.first_name) return winner.first_name;
  return "победитель без Telegram";
}

const API_ERROR_MESSAGES: Record<string, string> = {
  not_found: "Запись не найдена. Обновите список.",
  reply_required: "Нужен текст ответа.",
  missing_fields: "Не все поля заполнены.",
  invalid_star_rating: "Оценка должна быть от 1 до 5.",
  invalid_cooldown_days: "Пауза между отзывами должна быть не меньше 1 дня.",
  draw_already_exists: "Розыгрыш за этот месяц уже проведён.",
  draw_not_found: "Розыгрыш не найден. Обновите список.",
  seat_not_found: "Место в розыгрыше не найдено.",
  no_eligible_tickets: "Нет подходящих участников для переразыгрыша.",
  invalid_seat_number: "Некорректный номер места.",
  failed: "Не удалось выполнить операцию. Попробуйте ещё раз.",
};

function hasDirtyReplyDrafts() {
  return approvedReviews.value.some((review) => {
    const draft = replyDrafts[review.id]?.trim() || "";
    const saved = review.manager_reply?.trim() || "";
    return draft !== saved;
  });
}

function syncReplyDrafts(reviews: ReviewItem[]) {
  for (const review of reviews) {
    const saved = review.manager_reply || "";
    const current = replyDrafts[review.id];
    const currentTrimmed = current?.trim() || "";
    const savedTrimmed = saved.trim();
    if (current === undefined || currentTrimmed === savedTrimmed) {
      replyDrafts[review.id] = saved;
    }
  }
}

function showToast(kind: ToastKind, text: string) {
  toast.value = { kind, text };
  if (toastTimer) clearTimeout(toastTimer);
  if (kind !== "error") {
    toastTimer = setTimeout(() => {
      toast.value = null;
    }, 3500);
  }
}

function dismissToast() {
  toast.value = null;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

async function parseApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (data?.message && typeof data.message === "string" && !/^failed$/i.test(data.message)) {
    return data.message;
  }
  if (typeof data?.error === "string" && API_ERROR_MESSAGES[data.error]) {
    return API_ERROR_MESSAGES[data.error];
  }
  return fallback;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminStore.token}`,
  };
}

async function loadSettings() {
  settingsLoading.value = true;
  try {
    const response = await fetch("/api/admin/crm/review-settings", { headers: authHeaders() });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось загрузить настройки."));
      return;
    }
    applySettingsPayload(await response.json());
    settingsLoaded.value = true;
  } finally {
    settingsLoading.value = false;
  }
}

function requestLoadSettings() {
  if (settingsDirty.value) {
    confirmRefreshSettings.value = true;
    return;
  }
  void loadSettings();
}

async function refreshSettingsConfirmed() {
  confirmRefreshSettings.value = false;
  await loadSettings();
}

function buildSettingsPatchBody() {
  return { ...settings.value };
}

async function performSaveSettings() {
  if (hasValidationErrors.value) {
    showToast("error", "Сначала поправь ошибки в форме.");
    return false;
  }
  savingSettings.value = true;
  try {
    const response = await fetch("/api/admin/crm/review-settings", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(buildSettingsPatchBody()),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось сохранить настройки."));
      return false;
    }
    applySettingsPayload(await response.json());
    showToast("success", "Настройки сохранены.");
    return true;
  } finally {
    savingSettings.value = false;
  }
}

async function saveSettings() {
  await performSaveSettings();
}

async function loadReviews() {
  loading.value = true;
  try {
    const [listRes, countRes] = await Promise.all([
      fetch("/api/admin/crm/product-reviews?status=pending", { headers: authHeaders() }),
      fetch("/api/admin/crm/product-reviews/pending-count", { headers: authHeaders() }),
    ]);

    if (!listRes.ok) {
      showToast("error", await parseApiError(listRes, "Не удалось загрузить очередь модерации."));
    } else {
      const data = await listRes.json();
      pendingReviews.value = data.items || [];
    }

    if (countRes.ok) {
      const data = await countRes.json();
      pendingCount.value = Number(data.count || 0);
      crmStore.markReviewsAsSeen();
    }
  } finally {
    loading.value = false;
  }
}

async function loadDraws() {
  drawsLoading.value = true;
  try {
    const response = await fetch("/api/admin/crm/review-monthly-draws", { headers: authHeaders() });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось загрузить розыгрыши."));
      return;
    }
    const data = await response.json();
    draws.value = data.items || [];
    const latestDraw = draws.value[0];
    if (latestDraw?.id) {
      crmStore.markDrawAsSeen(latestDraw.id);
    }
  } finally {
    drawsLoading.value = false;
  }
}

async function loadApprovedReviews(options?: { force?: boolean }) {
  if (!options?.force && hasDirtyReplyDrafts()) {
    confirmRefreshReplies.value = true;
    return;
  }

  approvedLoading.value = true;
  try {
    const response = await fetch("/api/admin/crm/product-reviews?status=approved", {
      headers: authHeaders(),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось загрузить одобренные отзывы."));
      return;
    }
    const data = await response.json();
    approvedReviews.value = data.items || [];
    syncReplyDrafts(approvedReviews.value);
  } finally {
    approvedLoading.value = false;
  }
}

function requestLoadApprovedReviews() {
  void loadApprovedReviews();
}

async function refreshRepliesConfirmed() {
  confirmRefreshReplies.value = false;
  await loadApprovedReviews({ force: true });
}

async function loadQuickTags() {
  quickTagsLoading.value = true;
  try {
    const response = await fetch("/api/admin/crm/review-quick-tags", { headers: authHeaders() });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось загрузить быстрые теги."));
      return;
    }
    const data = await response.json();
    quickTags.value = data.items || [];
  } finally {
    quickTagsLoading.value = false;
  }
}

function requestModerate(review: ReviewItem, action: "approve" | "reject") {
  confirmModerate.value = { review, action };
}

async function moderateConfirmed() {
  const payload = confirmModerate.value;
  if (!payload) return;
  confirmModerate.value = null;

  const { review, action } = payload;
  moderatingId.value = review.id;
  try {
    const response = await fetch(`/api/admin/crm/product-reviews/${review.id}/${action}`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось обновить статус отзыва."));
      return;
    }
    showToast(
      "success",
      action === "approve"
        ? `Отзыв к заказу №${review.order_number} одобрен.`
        : `Отзыв к заказу №${review.order_number} отклонён.`,
    );
    await Promise.all([loadReviews(), loadApprovedReviews({ force: true })]);
  } finally {
    moderatingId.value = null;
  }
}

async function saveReply(id: string) {
  const reply = replyDrafts[id]?.trim();
  if (!reply) return;

  savingReplyId.value = id;
  try {
    const response = await fetch(`/api/admin/crm/product-reviews/${id}/reply`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ reply }),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось сохранить ответ."));
      return;
    }
    showToast("success", "Ответ сохранён.");
    await loadApprovedReviews({ force: true });
  } finally {
    savingReplyId.value = null;
  }
}

async function createQuickTag() {
  creatingTag.value = true;
  try {
    const response = await fetch("/api/admin/crm/review-quick-tags", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(newTag.value),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось создать тег."));
      return;
    }
    newTag.value.label = "";
    showToast("success", "Быстрый тег добавлен.");
    await loadQuickTags();
  } finally {
    creatingTag.value = false;
  }
}

async function toggleTagActive(tag: QuickTag) {
  togglingTagId.value = tag.id;
  try {
    const response = await fetch(`/api/admin/crm/review-quick-tags/${tag.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_active: !tag.is_active }),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось изменить статус тега."));
      return;
    }
    showToast("success", `Тег «${tag.label}» ${tag.is_active ? "выключен" : "включён"}.`);
    await loadQuickTags();
  } finally {
    togglingTagId.value = null;
  }
}

function requestDeleteTag(tag: QuickTag) {
  confirmDeleteTag.value = tag;
}

async function deleteTagConfirmed() {
  const tag = confirmDeleteTag.value;
  if (!tag) return;
  confirmDeleteTag.value = null;

  deletingTagId.value = tag.id;
  try {
    const response = await fetch(`/api/admin/crm/review-quick-tags/${tag.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось удалить тег."));
      return;
    }
    showToast("success", `Тег «${tag.label}» удалён.`);
    await loadQuickTags();
  } finally {
    deletingTagId.value = null;
  }
}

function requestRunDraw() {
  confirmRunDraw.value = true;
}

async function runDrawConfirmed() {
  confirmRunDraw.value = false;
  runningDraw.value = true;
  try {
    const response = await fetch("/api/admin/crm/review-monthly-draws/run", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось запустить розыгрыш."));
      return;
    }
    showToast("success", `Розыгрыш за ${currentPeriodLabel.value} завершён.`);
    await loadDraws();
  } finally {
    runningDraw.value = false;
  }
}

function requestReroll(draw: MonthlyDraw, seatNumber: number) {
  confirmReroll.value = {
    drawId: draw.id,
    seatNumber,
    periodLabel: formatPeriodKey(draw.period_key),
  };
}

async function rerollConfirmed() {
  const payload = confirmReroll.value;
  if (!payload) return;
  confirmReroll.value = null;

  const key = `${payload.drawId}-${payload.seatNumber}`;
  rerollingKey.value = key;
  try {
    const response = await fetch(`/api/admin/crm/review-monthly-draws/${payload.drawId}/reroll`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ seat_number: payload.seatNumber }),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось переразыграть место."));
      return;
    }
    showToast("success", `Место ${payload.seatNumber} переразыграно.`);
    await loadDraws();
  } finally {
    rerollingKey.value = null;
  }
}

onMounted(async () => {
  await Promise.all([
    loadSettings(),
    loadReviews(),
    loadApprovedReviews({ force: true }),
    loadQuickTags(),
    loadDraws(),
  ]);
});

onUnmounted(() => {
  dismissToast();
});
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.2s ease;
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  opacity: 0;
  transform: translateY(12px);
}


</style>
