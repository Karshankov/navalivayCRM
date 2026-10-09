<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center gap-4">
        <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl shrink-0">
          Рулетка
        </h1>
      </div>

      <div
        class="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Разделы рулетки"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :id="`wheel-tab-${tab.id}`"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`wheel-panel-${tab.id}`"
          class="inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          :class="
            activeTab === tab.id
              ? 'border-blue-200 bg-white text-blue-700 shadow-md ring-1 ring-blue-100'
              : 'border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900'
          "
          @click="activeTab = tab.id"
        >
          {{ tabLabel(tab) }}
        </button>
      </div>

      <section
        v-if="activeTab === 'dashboard'"
        id="wheel-panel-dashboard"
        role="tabpanel"
        aria-labelledby="wheel-tab-dashboard"
        class="space-y-4"
      >
        <h2 class="sr-only">Обзор рулетки</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
            <p class="text-xs uppercase tracking-wider text-slate-500">Всего прокруток</p>
            <p class="mt-1 text-2xl font-bold text-slate-900">
              {{ dashboard.totals?.total_spins ?? 0 }}
            </p>
          </div>
          <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
            <p class="text-xs uppercase tracking-wider text-slate-500">Пустые прокрутки</p>
            <p class="mt-1 text-2xl font-bold text-slate-900">
              {{ dashboard.totals?.nothing_spins ?? 0 }}
            </p>
          </div>
          <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
            <p class="text-xs uppercase tracking-wider text-slate-500">Выдано ценных призов</p>
            <p class="mt-1 text-2xl font-bold text-slate-900">
              {{ dashboard.totals?.epic_releases ?? 0 }}
            </p>
          </div>
          <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
            <p class="text-xs uppercase tracking-wider text-slate-500">Выдано по гарантии</p>
            <p class="mt-1 text-2xl font-bold text-slate-900">
              {{ dashboard.totals?.pity_releases ?? 0 }}
            </p>
            <p class="mt-1 text-xs text-slate-500">После серии пустых прокруток</p>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <h3 class="text-sm font-semibold text-slate-800">Распределение по редкостям</h3>
          <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <p
              v-if="!(dashboard.rarity_breakdown || []).length"
              class="col-span-full rounded-lg border border-slate-100 px-3 py-6 text-center text-sm text-slate-500"
            >
              Данных пока нет. Распределение появится после первых прокруток.
            </p>
            <div
              v-for="row in dashboard.rarity_breakdown || []"
              :key="row.rarity_code"
              class="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
            >
              <span class="text-slate-600">{{ rarityLabel(row.rarity_code) }}</span>
              <span class="font-semibold text-slate-900">{{ row.count }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <h3 class="text-sm font-semibold text-slate-800">Очередь на ценные призы</h3>
          <p
            v-if="!(dashboard.active_epic_pools || []).length"
            class="mt-2 text-sm text-slate-500"
          >
            Очереди на ценные призы пока нет.
          </p>
          <ul v-else class="mt-3 space-y-2">
            <li
              v-for="pool in dashboard.active_epic_pools"
              :key="pool.id"
              class="rounded-lg border border-slate-100 px-3 py-2 text-sm"
            >
              <p class="font-semibold text-slate-800">{{ rarityLabel(pool.rarity_code || 'valuable') }}</p>
              <p class="text-xs text-slate-500">
                В очереди: {{ pool.qualified_customers.length }} из {{ pool.pool_size }}.
                Минимум покупок: {{ pool.threshold_byn }} BYN.
              </p>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  class="h-full rounded-full bg-amber-400 transition-[width] duration-300"
                  :style="{ width: `${poolProgress(pool)}%` }"
                ></div>
              </div>
            </li>
          </ul>
        </div>

        <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 class="text-sm font-semibold text-slate-800">Выданные призы</h3>
              <p class="mt-1 text-xs text-slate-500">
                Быстро видно, что выпадает, кому доступно и где нужен контроль.
              </p>
            </div>
          </div>
          <div class="mt-3 overflow-x-auto">
            <table class="w-full min-w-[760px] text-sm">
              <caption class="sr-only">Выданные призы рулетки</caption>
              <thead class="text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" class="px-3 py-2 text-left">Приз</th>
                  <th scope="col" class="px-3 py-2 text-left">Редкость</th>
                  <th scope="col" class="px-3 py-2 text-left">Выдано / осталось</th>
                  <th scope="col" class="px-3 py-2 text-left">Кому</th>
                  <th scope="col" class="px-3 py-2 text-left">Статус</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-if="!(dashboard.prizes_issued || []).length">
                  <td colspan="5" class="px-3 py-8 text-center text-sm text-slate-500">
                    Выданных призов пока нет. После первой выдачи здесь появится приз, редкость и остаток по лимиту.
                  </td>
                </tr>
                <tr
                  v-for="prize in dashboard.prizes_issued || []"
                  :key="prize.id"
                  class="align-top transition-colors duration-150 hover:bg-slate-50/70"
                >
                  <td class="px-3 py-3">
                    <p class="max-w-[280px] font-semibold leading-5 text-slate-900">
                      {{ prize.title }}
                    </p>
                  </td>
                  <td class="px-3 py-3">
                    <span
                      class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                      :class="issuedPrizeRarityClass(prize.rarity_code)"
                    >
                      {{ rarityLabel(prize.rarity_code) }}
                    </span>
                  </td>
                  <td class="px-3 py-3 tabular-nums">
                    <p class="font-medium text-slate-800">
                      {{ issuedPrizeIssueText(prize) }}
                    </p>
                    <p
                      class="mt-1 text-xs"
                      :class="issuedPrizeRemainingClass(prize)"
                    >
                      {{ issuedPrizeRemainingText(prize) }}
                    </p>
                  </td>
                  <td class="px-3 py-3">
                    <span
                      class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium"
                      :class="issuedPrizeAudienceClass(prize)"
                    >
                      {{ issuedPrizeAudienceText(prize) }}
                    </span>
                  </td>
                  <td class="px-3 py-3">
                    <span
                      class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                      :class="issuedPrizeStatusClass(prize)"
                    >
                      {{ issuedPrizeStatusText(prize) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'prizes'"
        id="wheel-panel-prizes"
        role="tabpanel"
        aria-labelledby="wheel-tab-prizes"
        class="space-y-4"
      >
        <h2 class="sr-only">Призы рулетки</h2>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="rarity in rarities.filter((item) => item.code !== 'nothing')"
            :key="rarity.code"
            type="button"
            class="rounded-2xl border px-4 py-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            :class="
              selectedRarityCode === rarity.code
                ? 'border-blue-200 bg-white shadow-md ring-1 ring-blue-100'
                : 'border-slate-200/60 bg-white/80 shadow-sm hover:border-slate-300 hover:bg-white'
            "
            @click="selectedRarityCode = rarity.code"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">{{ rarityLabel(rarity.code) }}</p>
              </div>
              <span
                class="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold"
                :class="rarityBadgeClass(rarity)"
              >
                {{ rarityBadgeText(rarity) }}
              </span>
            </div>
            <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>Всего призов: {{ rarity.prizeCount ?? rarity.prize_count ?? 0 }}</span>
              <span>Выдано: {{ rarity.issuedCount ?? rarity.issued_count ?? 0 }}</span>
            </div>
            <p
              v-if="rarity.code === 'valuable'"
              class="mt-3 text-xs text-slate-600"
            >
                В очереди: {{ rarity.valuablePool?.qualifiedCount ?? rarity.valuable_pool?.qualifiedCount ?? 0 }} из
              {{ rarity.valuablePool?.poolSize ?? rarity.valuable_pool?.poolSize ?? rarity.valuablePoolSize ?? rarity.valuable_pool_size ?? 5 }},
              минимум покупок {{ rarity.valuablePool?.thresholdByn ?? rarity.valuable_pool?.thresholdByn ?? rarity.valuableThresholdByn ?? rarity.valuable_threshold_byn ?? 300 }} BYN
            </p>
          </button>
        </div>

        <div class="flex justify-between items-center">
          <div>
            <p class="text-sm font-semibold text-slate-900">
              {{ selectedRarity ? rarityLabel(selectedRarity.code) : 'Редкость' }}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:to-indigo-700"
            @click="openCreateModal"
          >
            Добавить приз
          </button>
        </div>

        <div class="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
          <table class="w-full table-fixed text-sm">
            <caption class="sr-only">Призы выбранной редкости</caption>
            <thead class="bg-slate-50/80 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" class="w-[42%] px-4 py-3 text-left">Приз</th>
                <th scope="col" class="w-[16%] px-4 py-3 text-left">Выдано / лимит</th>
                <th scope="col" class="w-[17%] px-4 py-3 text-left">Кому доступен</th>
                <th scope="col" class="w-[12%] px-4 py-3 text-left">Статус</th>
                <th scope="col" class="w-[13%] px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-if="!filteredPrizes.length">
                <td colspan="5" class="px-4 py-10 text-center text-slate-400">
                  В этой редкости пока нет призов. Добавьте приз, чтобы редкость могла выпадать.
                </td>
              </tr>
              <tr
                v-for="prize in filteredPrizes"
                :key="prize.id"
                class="align-top transition-colors duration-150 hover:bg-slate-50/60"
              >
                <td class="px-4 py-3">
                  <div class="flex min-w-0 items-start gap-3">
                    <div class="h-14 w-14 flex-none overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
                      <img
                        v-if="prize.image_url"
                        :src="prize.image_url"
                        :alt="`Фото приза: ${prize.title}`"
                        class="h-full w-full object-cover"
                      />
                      <div
                        v-else
                        class="flex h-full w-full items-center justify-center text-[10px] font-medium uppercase tracking-wide text-slate-400"
                      >
                        Нет фото
                      </div>
                    </div>
                    <div class="min-w-0">
                      <p class="truncate font-semibold text-slate-900">{{ prize.title }}</p>
                      <p
                        v-if="prizeDescription(prize)"
                        class="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500"
                      >
                        {{ prizeDescription(prize) }}
                      </p>
                      <p class="mt-1 truncate text-xs text-slate-500">
                        {{ prizePromoText(prize) }}
                      </p>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-slate-700 tabular-nums">
                  <div class="font-medium">{{ prizeIssueText(prize) }}</div>
                  <div v-if="prize.is_exhausted" class="mt-1 text-xs text-rose-600">Лимит исчерпан</div>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    {{ prizeAudienceText(prize) }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                    :class="prizeStatusClass(prize)"
                  >
                    {{ prizeStatusText(prize) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      class="min-h-9 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors duration-150 hover:border-blue-200 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      :aria-label="`Изменить приз ${prize.title}`"
                      @click="openEditModal(prize)"
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      class="min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 focus:outline-none focus:ring-2"
                      :class="
                        prize.is_active
                          ? 'border border-rose-100 bg-rose-50 text-rose-700 hover:border-rose-200 hover:bg-rose-100 focus:ring-rose-200'
                          : 'border border-emerald-100 bg-emerald-50 text-emerald-700 hover:border-emerald-200 hover:bg-emerald-100 focus:ring-emerald-200'
                      "
                      :aria-label="`${prize.is_active ? 'Выключить' : 'Включить'} приз ${prize.title}`"
                      @click="requestTogglePrize(prize)"
                    >
                      {{ prize.is_active ? 'Выключить' : 'Включить' }}
                    </button>
                    <button
                      v-if="canDeletePrize(prize)"
                      type="button"
                      class="min-h-9 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      :aria-label="`Удалить приз ${prize.title}`"
                      @click="requestDeletePrize(prize)"
                    >
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'settings'"
        id="wheel-panel-settings"
        role="tabpanel"
        aria-labelledby="wheel-tab-settings"
        class="space-y-4"
      >
        <h2 class="sr-only">Правила выпадения</h2>
        <div class="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Доступ и начисление</h3>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wider text-slate-500">Розница: сумма за 1 прокрутку, BYN</span>
              <input
                v-model.number="settingsForm.spin_byn_retail"
                type="number"
                min="1"
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wider text-slate-500">Опт: сумма за 1 прокрутку, BYN</span>
              <input
                v-model.number="settingsForm.spin_byn_wholesale"
                type="number"
                min="1"
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wider text-slate-500">
                Приз после прокруток без выигрыша
              </span>
              <input
                v-model.number="settingsForm.pity_threshold"
                type="number"
                min="1"
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wider text-slate-500">
                Срок промокода по умолчанию, дней
              </span>
              <input
                v-model.number="settingsForm.default_promo_validity_days"
                type="number"
                min="1"
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wider text-slate-500">
                Сколько выигрышей показывать в ленте
              </span>
              <input
                v-model.number="settingsForm.feed_size"
                type="number"
                min="1"
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wider text-slate-500">
                С какого момента учитывать покупки
              </span>
              <input
                v-model="settingsForm.start_collecting_at"
                type="datetime-local"
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
          </div>
          <label class="flex flex-col gap-1">
            <span class="text-xs uppercase tracking-wider text-slate-500">
              Кто может открыть рулетку
            </span>
            <textarea
              v-model="settingsForm.wheel_access_usernames_text"
              rows="5"
              class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            ></textarea>
            <span class="text-[11px] text-slate-400">
              Пустое поле — рулетка доступна всем. Иначе укажите Telegram-username по одному в строке, без @.
            </span>
          </label>
          <div class="rounded-2xl border border-slate-200/60 bg-slate-50/70 p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-slate-900">Вероятности</p>
                <p class="text-xs text-slate-500">
                  Оставшийся процент выпадет как «Ничего».
                </p>
              </div>
              <div class="rounded-xl bg-white px-3 py-2 text-right shadow-sm">
                <p class="text-[11px] uppercase tracking-[0.16em] text-slate-400">Ничего</p>
                <p class="text-sm font-semibold text-slate-900">
                  {{ nothingChancePercent }}%
                </p>
                <p v-if="nothingChancePercent === 0" class="mt-1 text-[11px] text-amber-700">
                  Пустых прокруток не будет
                </p>
              </div>
            </div>
            <div class="space-y-3">
              <div
                v-for="rarity in rarities.filter((item) => item.code !== 'nothing')"
                :key="rarity.code"
                class="rounded-2xl border border-white bg-white p-4 shadow-sm"
              >
                <div class="grid gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,180px)_minmax(0,180px)_minmax(0,1fr)] md:items-end">
                  <div class="min-w-0 self-center">
                    <p class="text-sm font-semibold text-slate-900">{{ rarityLabel(rarity.code) }}</p>
                  </div>
                  <label class="flex flex-col gap-1">
                    <span class="text-xs uppercase tracking-wider text-slate-500">
                      {{ rarity.code === 'valuable' ? 'Размер очереди' : 'Шанс, %' }}
                    </span>
                    <input
                      v-if="rarity.code !== 'valuable'"
                      v-model.number="rarity.chancePercent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <input
                      v-else
                      v-model.number="rarity.valuablePoolSize"
                      type="number"
                      min="1"
                      class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
                  <label class="flex flex-col gap-1">
                    <span class="text-xs uppercase tracking-wider text-slate-500">
                      {{ rarity.code === 'valuable' ? 'Покупок от, BYN' : ' ' }}
                    </span>
                    <input
                      v-if="rarity.code === 'valuable'"
                      v-model.number="rarity.valuableThresholdByn"
                      type="number"
                      min="1"
                      step="0.01"
                      class="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <div
                      v-else
                      aria-hidden="true"
                      class="h-[38px] rounded-lg border border-transparent px-3 py-2 text-sm"
                    ></div>
                  </label>
                  <div class="flex min-h-[68px] items-end justify-between gap-3">
                    <div class="text-xs text-slate-500">
                      <div>Призов: {{ rarity.prizeCount ?? rarity.prize_count ?? 0 }}</div>
                      <div>Доступно: {{ rarity.issuablePrizeCount ?? rarity.issuable_prize_count ?? 0 }}</div>
                    </div>
                    <button
                      type="button"
                      class="rounded-xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      :disabled="savingRarityCode === rarity.code"
                      @click="saveRarityRule(rarity)"
                    >
                        {{ savingRarityCode === rarity.code ? 'Сохранение...' : 'Сохранить редкость' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="flex justify-end">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition-colors duration-150 hover:from-blue-700 hover:to-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              @click="saveSettings"
            >
              Сохранить настройки
            </button>
          </div>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'spins'"
        id="wheel-panel-spins"
        role="tabpanel"
        aria-labelledby="wheel-tab-spins"
        class="space-y-4"
      >
        <h2 class="sr-only">История прокруток</h2>
        <div class="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">История прокруток рулетки</caption>
            <thead class="text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" class="text-left py-2">Дата</th>
                <th scope="col" class="text-left py-2">Клиент</th>
                <th scope="col" class="text-left py-2">Приз</th>
                <th scope="col" class="text-left py-2">Редкость</th>
                <th scope="col" class="text-center py-2">Тип клиента</th>
                <th scope="col" class="text-left py-2">Промокод</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-if="!spins.rows?.length">
                <td colspan="6" class="py-8 text-center text-slate-500">
                  Прокруток пока не было. История появится после первого запуска рулетки клиентом.
                </td>
              </tr>
              <tr v-for="spin in spins.rows || []" :key="spin.id">
                <td class="py-2 text-slate-600 whitespace-nowrap">
                  {{ formatDateTime(spin.spun_at) }}
                </td>
                <td class="py-2 text-slate-700">
                  {{ spin.first_name || 'Нет имени' }}
                  <span v-if="spin.telegram_username" class="text-slate-500">
                    @{{ spin.telegram_username }}
                  </span>
                </td>
                <td class="py-2 text-slate-800 font-medium">{{ spin.prize_title }}</td>
                <td class="py-2 text-slate-600">{{ rarityLabel(spin.rarity_code) }}</td>
                <td class="py-2 text-center">{{ spin.is_wholesale ? 'Опт' : 'Розница' }}</td>
                <td class="py-2 font-mono text-slate-700">
                  {{ spin.generated_promo_code || 'Без промокода' }}
                </td>
              </tr>
            </tbody>
          </table>
          <div class="mt-3 flex items-center justify-between text-sm text-slate-500">
            <span>{{ spinsRangeText }}</span>
            <div class="space-x-2">
              <button
                type="button"
                class="rounded border border-slate-200 px-3 py-1 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                :disabled="spinsOffset === 0"
                @click="changeSpinsPage(-1)"
              >
                Предыдущие
              </button>
              <button
                type="button"
                class="rounded border border-slate-200 px-3 py-1 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                :disabled="spinsOffset + spinsLimit >= spins.total"
                @click="changeSpinsPage(1)"
              >
                Следующие
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <Transition
      enter-active-class="transition ease-out duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="prizeModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        v-safe-backdrop-close="closeModal"
      >
        <Transition
          enter-active-class="transition ease-out duration-200"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition ease-in duration-150"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-2"
        >
          <form
            v-if="prizeModalOpen"
            class="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/40 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wheel-prize-modal-title"
            @keydown.esc="closeModal"
            @submit.prevent="savePrize"
          >
            <div class="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3">
              <div>
                <h3 id="wheel-prize-modal-title" class="text-lg font-bold text-slate-900">
                  {{ prizeForm.id ? 'Редактировать приз' : 'Новый приз' }}
                </h3>
                <p class="mt-0.5 text-xs text-slate-500">
                  Выберите промокод, фото и условия показа в рулетке.
                </p>
              </div>
              <button
                type="button"
                class="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Закрыть окно"
                @click="closeModal"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-4">
              <div
                v-if="prizeFormErrors.length"
                class="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                role="alert"
              >
                <p class="mb-1 font-semibold">Проверьте поля:</p>
                <ul class="list-disc list-inside space-y-0.5">
                  <li v-for="(err, idx) in prizeFormErrors" :key="idx">{{ err }}</li>
                </ul>
              </div>

              <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div class="space-y-3">
                  <section class="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                    <div class="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Содержимое приза</p>
                        <p class="mt-1 text-sm text-slate-500">Текст для клиента берётся из выбранного промокода.</p>
                      </div>
                    </div>

                    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <label for="wheel-prize-promo-template" class="block">
                        <span class="mb-1.5 block text-sm font-medium text-slate-700">Промокод</span>
                        <select
                          id="wheel-prize-promo-template"
                          v-model="prizeForm.promo_template_id"
                          class="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                          <option :value="null">Без промокода</option>
                          <option v-for="promo in availablePromoTemplates" :key="promo.id" :value="promo.id">
                            {{ promo.code }} ({{ promo.has_gift && Number(promo.discount_value) <= 0 ? 'Подарок' : promo.discount_type === 'fixed' ? `${promo.discount_value} BYN` : `${promo.discount_value}%` }})
                          </option>
                        </select>
                      </label>
                      <button
                        type="button"
                        class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition-colors duration-150 hover:border-blue-300 hover:bg-blue-100"
                        @click="openQuickPromoModal"
                      >
                        Создать промокод
                      </button>
                    </div>

                    <div class="mt-3 grid gap-2">
                      <p class="rounded-xl bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                        {{ selectedPromoValidityHint }}
                      </p>
                      <div
                        v-if="selectedPromoPreviewTitle || selectedPromoPreviewDescription"
                        class="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 space-y-1"
                      >
                        <p v-if="selectedPromoPreviewTitle">
                          <span class="font-semibold">Заголовок:</span> {{ selectedPromoPreviewTitle }}
                        </p>
                        <p v-if="selectedPromoPreviewDescription">
                          <span class="font-semibold">Описание:</span> {{ selectedPromoPreviewDescription }}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section class="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                    <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Редкость и выдача</p>
                    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.85fr)]">
                      <label class="block">
                        <span class="mb-1.5 block text-sm font-medium text-slate-700">Редкость</span>
                        <select
                          v-model="prizeForm.rarity_code"
                          required
                          class="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          :style="prizeRaritySelectStyle"
                        >
                          <option v-for="rarity in configurablePrizeRarities" :key="rarity.code" :value="rarity.code">
                            {{ rarityLabel(rarity.code) }}
                          </option>
                        </select>
                      </label>

                      <div>
                        <p class="mb-1.5 block text-sm font-medium text-slate-700">Показ и активность</p>
                        <div class="grid gap-2">
                          <label class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                            <span>Для розницы</span>
                            <input v-model="prizeForm.is_for_retail" type="checkbox" class="h-4 w-4" />
                          </label>
                          <label class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                            <span>Для опта</span>
                            <input v-model="prizeForm.is_for_wholesale" type="checkbox" class="h-4 w-4" />
                          </label>
                          <label class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800">
                            <span>Выдавать приз</span>
                            <input v-model="prizeForm.is_active" type="checkbox" class="h-4 w-4" />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div v-if="prizeForm.rarity_code === 'valuable'" class="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-800">Ценный приз</p>
                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label class="block">
                          <span class="mb-1.5 block text-sm font-medium text-slate-700">Участников до ценного приза</span>
                          <input
                            v-model.number="prizeForm.epic_pool_size"
                            type="number"
                            min="1"
                            required
                            class="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        </label>
                        <label class="block">
                          <span class="mb-1.5 block text-sm font-medium text-slate-700">Сумма покупок от, BYN</span>
                          <input
                            v-model.number="prizeForm.epic_pool_threshold_byn"
                            type="number"
                            min="1"
                            step="0.01"
                            required
                            class="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        </label>
                      </div>
                    </div>
                  </section>
                </div>

                <aside>
                  <section class="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                    <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Фото приза</p>
                    <div class="grid gap-3">
                      <div
                        class="relative mx-auto aspect-square w-full max-w-[220px] rounded-[24px] border-[2.5px] bg-white shadow-[0_24px_32px_rgba(170,178,189,0.12)]"
                        :style="prizeImagePreviewCardStyle"
                      >
                        <div
                          class="absolute flex items-center justify-center"
                          :class="prizeImagePreview ? 'inset-0 overflow-hidden rounded-[21px]' : 'inset-[5%]'"
                        >
                          <img
                            v-if="prizeImagePreview"
                            :src="prizeImagePreview"
                            :alt="selectedPromoPreviewTitle || 'Превью приза'"
                            class="h-full w-full object-cover drop-shadow-[0_10px_14px_rgba(15,23,42,0.10)]"
                          />
                          <div
                            v-else
                            class="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center text-sm text-slate-500"
                          >
                            Фото не добавлено
                          </div>
                        </div>
                        <div
                          class="absolute bottom-[-9px] left-1/2 z-10 inline-flex min-h-[18px] min-w-[86px] -translate-x-1/2 items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-center text-[8px] font-medium uppercase leading-[10px] tracking-[0.02em]"
                          :style="prizeImagePreviewBadgeStyle"
                        >
                          {{ rarityLabel(prizeForm.rarity_code) }}
                        </div>
                      </div>
                      <p class="text-center text-xs text-slate-500">
                        Так карточка будет выглядеть в рулетке.
                      </p>
                      <input
                        ref="prizeImageInputRef"
                        type="file"
                        accept="image/*"
                        class="hidden"
                        @change="handlePrizeImageSelected"
                      />
                      <button
                        type="button"
                        class="w-full rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:border-slate-300 hover:bg-white"
                        :disabled="isPrizeSaving"
                        @click="triggerPrizeImagePicker"
                      >
                        {{ prizeImagePreview ? 'Заменить фото' : 'Добавить фото' }}
                      </button>
                      <button
                        v-if="prizeImagePreview"
                        type="button"
                        class="w-full rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-sm font-medium text-rose-600 shadow-sm transition-colors duration-150 hover:border-rose-300 hover:bg-rose-50"
                        :disabled="isPrizeSaving"
                        @click="clearPrizeImage"
                      >
                        Удалить фото
                      </button>
                    </div>
                  </section>
                </aside>
              </div>
            </div>
            <div class="flex flex-col-reverse gap-3 border-t border-slate-100 bg-white px-5 py-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                class="rounded-xl border border-slate-200/70 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50"
                @click="closeModal"
              >
                Не сохранять
              </button>
              <button
                type="submit"
                class="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-colors duration-150 hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isPrizeSaving"
              >
                {{ isPrizeSaving ? 'Сохранение...' : 'Сохранить приз' }}
              </button>
            </div>
          </form>
        </Transition>
      </div>
    </Transition>

    <Transition
      enter-active-class="transition ease-out duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="promoQuickModalOpen"
        class="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        v-safe-backdrop-close="closeQuickPromoModal"
      >
        <Transition
          enter-active-class="transition ease-out duration-200"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition ease-in duration-150"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-2"
        >
          <div
            v-if="promoQuickModalOpen"
            class="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200/40 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wheel-promo-quick-dialog-title"
            @keydown.esc="closeQuickPromoModal"
          >
            <div class="border-b border-slate-100 px-5 py-3">
              <h3 id="wheel-promo-quick-dialog-title" class="text-lg font-bold text-slate-900">Создать промокод для приза</h3>
              <p class="mt-0.5 text-xs text-slate-500">Заполните текст приза, скидку и правила выдачи.</p>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-4">
              <div v-if="promoQuickError" class="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {{ promoQuickError }}
              </div>

              <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
                <section class="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                  <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Текст приза</p>
                  <div class="space-y-3">
                    <div>
                      <label for="wheel-promo-quick-prize-title" class="mb-1.5 block text-sm font-medium text-slate-700">
                        Название приза <span class="font-normal text-slate-500">(обязательно)</span>
                      </label>
                      <input
                        id="wheel-promo-quick-prize-title"
                        ref="promoQuickTitleInputRef"
                        v-model="promoQuickForm.description"
                        type="text"
                        placeholder="Например: Скидка на жидкость VINTAGE"
                        class="w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                        :class="promoQuickTitleError
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                          : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'"
                        :aria-invalid="Boolean(promoQuickTitleError)"
                        aria-required="true"
                        :aria-describedby="promoQuickTitleError ? 'wheel-promo-quick-prize-title-error' : 'wheel-promo-quick-prize-title-hint'"
                        @input="promoQuickTitleError = ''"
                      />
                      <p
                        v-if="promoQuickTitleError"
                        id="wheel-promo-quick-prize-title-error"
                        class="mt-1 text-xs font-medium text-red-600"
                      >
                        {{ promoQuickTitleError }}
                      </p>
                      <p v-else id="wheel-promo-quick-prize-title-hint" class="mt-1 text-xs text-slate-500">
                        Показывается на рулетке и в окне выигрыша.
                      </p>
                    </div>
                    <div>
                      <label for="wheel-promo-quick-code" class="mb-1.5 block text-sm font-medium text-slate-700">Промокод</label>
                      <div class="flex gap-2">
                        <input
                          id="wheel-promo-quick-code"
                          v-model="promoQuickForm.code"
                          type="text"
                          class="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm uppercase focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                        <button
                          type="button"
                          class="rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-3 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md"
                          @click="generatePromoTemplateCode"
                        >
                          Сгенерировать
                        </button>
                      </div>
                    </div>
                    <div>
                      <label for="wheel-promo-quick-customer-description" class="mb-1.5 block text-sm font-medium text-slate-700">Описание для клиента</label>
                      <textarea
                        id="wheel-promo-quick-customer-description"
                        v-model="promoQuickForm.customer_description"
                        rows="4"
                        class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      ></textarea>
                    </div>
                    <div>
                      <label for="wheel-promo-quick-manager-description" class="mb-1.5 block text-sm font-medium text-slate-700">Описание для менеджера</label>
                      <textarea
                        id="wheel-promo-quick-manager-description"
                        v-model="promoQuickForm.manager_description"
                        rows="3"
                        class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      ></textarea>
                    </div>
                  </div>
                </section>

                <section class="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                  <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Правила промокода</p>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label for="wheel-promo-quick-discount-type" class="mb-1.5 block text-sm font-medium text-slate-700">Тип скидки</label>
                      <select
                        id="wheel-promo-quick-discount-type"
                        v-model="promoQuickForm.discount_type"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      >
                        <option value="fixed">Фиксированная (BYN)</option>
                        <option value="percent">Процент (%)</option>
                      </select>
                    </div>
                    <div>
                      <label for="wheel-promo-quick-discount-value" class="mb-1.5 block text-sm font-medium text-slate-700">Размер скидки</label>
                      <input
                        id="wheel-promo-quick-discount-value"
                        v-model.number="promoQuickForm.discount_value"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <p class="mt-1 text-xs text-slate-500">0 = подарочный промокод</p>
                    </div>
                    <div>
                      <label for="wheel-promo-quick-min-order" class="mb-1.5 block text-sm font-medium text-slate-700">Мин. сумма</label>
                      <input
                        id="wheel-promo-quick-min-order"
                        v-model.number="promoQuickForm.min_order_amount"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                    <div>
                      <label for="wheel-promo-quick-max-uses" class="mb-1.5 block text-sm font-medium text-slate-700">Лимит победителей</label>
                      <input
                        id="wheel-promo-quick-max-uses"
                        v-model.number="promoQuickForm.max_uses"
                        type="number"
                        min="0"
                        class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <p class="mt-1 text-xs text-slate-500">0 = без лимита</p>
                    </div>
                    <div class="col-span-2">
                      <label for="wheel-promo-quick-duration" class="mb-1.5 block text-sm font-medium text-slate-700">Срок действия, дней</label>
                      <input
                        id="wheel-promo-quick-duration"
                        v-model.number="promoQuickForm.duration_days"
                        type="number"
                        min="1"
                        class="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <p class="mt-1 text-xs text-slate-500">
                        {{ quickPromoValidityHint }}
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div class="flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
              <button
                type="button"
                class="rounded-xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-gray-50/60 px-4 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300/50 hover:shadow-md"
                @click="closeQuickPromoModal"
              >
                Не создавать
              </button>
              <button
                type="button"
                class="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:to-indigo-700"
                @click="createQuickPromoTemplate"
              >
                Создать промокод для приза
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <Transition name="modal-fade">
      <div
        v-if="confirmTogglePrize"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmTogglePrize = null)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wheel-toggle-prize-title"
          @keydown.esc="confirmTogglePrize = null"
        >
          <h3 id="wheel-toggle-prize-title" class="text-base font-semibold text-slate-900 mb-2">
            {{ confirmTogglePrize?.is_active ? 'Отключить приз?' : 'Включить приз?' }}
          </h3>
          <p class="text-sm text-slate-600 mb-4">
            <template v-if="confirmTogglePrize?.is_active">
              Приз «{{ confirmTogglePrize.title }}» перестанет выпадать.
            </template>
            <template v-else>
              Приз «{{ confirmTogglePrize?.title }}» снова будет участвовать в рулетке.
            </template>
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmTogglePrize = null">
              Отмена
            </CrmButton>
            <CrmButton
              :variant="confirmTogglePrize?.is_active ? 'danger-solid' : 'success'"
              size="sm"
              @click="togglePrizeConfirmed"
            >
              {{ confirmTogglePrize?.is_active ? 'Отключить приз' : 'Включить приз' }}
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal-fade">
      <div
        v-if="confirmDeletePrize"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmDeletePrize = null)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wheel-delete-prize-title"
          @keydown.esc="confirmDeletePrize = null"
        >
          <h3 id="wheel-delete-prize-title" class="text-base font-semibold text-slate-900 mb-2">
            Удалить приз?
          </h3>
          <p class="text-sm text-slate-600 mb-4">
            Приз «{{ confirmDeletePrize.title }}» будет удалён из списка без возможности восстановления.
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmDeletePrize = null">
              Не удалять
            </CrmButton>
            <CrmButton variant="danger-solid" size="sm" @click="deletePrizeConfirmed">
              Удалить приз
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="toast-slide">
      <div
        v-if="toast"
        class="fixed bottom-6 right-6 z-[70] flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg max-w-sm"
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
        <span class="text-sm font-medium flex-1">{{ toast.text }}</span>
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
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, computed, watch } from 'vue'
import CrmButton from '@/components/admin/crm/CrmButton.vue'
import {
  BUSINESS_TIME_ZONE,
  getBusinessDateParts,
} from '@/utils/businessTime'
import { useAdminStore } from '@/stores/admin'
import { useCrmStore } from '@/stores/crm'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

interface WheelRarity {
  code: string
  label: string
  bgColor?: string
  textColor?: string
  sort_order?: number
  is_elite?: number | boolean
  chancePercent?: number
  chance_percent?: number
  valuablePoolSize?: number
  valuable_pool_size?: number
  valuableThresholdByn?: number
  valuable_threshold_byn?: number
  chanceIsDerived?: boolean
  chance_is_derived?: boolean
  prizeCount?: number
  prize_count?: number
  issuablePrizeCount?: number
  issuable_prize_count?: number
  issuedCount?: number
  issued_count?: number
  isAvailable?: boolean
  is_available?: boolean
  valuablePool?: {
    poolSize: number
    thresholdByn: number
    qualifiedCount: number
    isHot: boolean
  } | null
  valuable_pool?: {
    poolSize: number
    thresholdByn: number
    qualifiedCount: number
    isHot: boolean
  } | null
}

interface WheelPrize {
  id: string
  rarity_code: string
  title: string
  description: string | null
  image_url: string | null
  weight: number
  max_total: number
  issued_count: number
  is_for_retail: boolean | number
  is_for_wholesale: boolean | number
  promo_template_id: string | null
  promo_validity_days: number
  epic_pool_size: number
  epic_pool_threshold_byn: number
  is_active: boolean | number
  sort_order: number
  rarity?: WheelRarity | null
  template_available?: boolean
  is_exhausted?: boolean
  can_delete?: boolean
}

interface PromoTemplate {
  id: string
  code: string
  description?: string | null
  customer_description?: string | null
  manager_description?: string | null
  discount_type: string
  discount_value: number
  has_gift?: number | boolean
  max_uses?: number
  current_uses?: number
  duration_days?: number | null
  valid_from_date?: string | null
  active?: number | boolean
  is_wheel_template?: number | boolean
  wheel_owner_customer_id?: string | null
}

interface DashboardPrize {
  id: string
  title: string
  rarity_code: string
  issued_count: number
  max_total: number
  is_for_retail?: boolean | number
  is_for_wholesale?: boolean | number
  is_active?: boolean | number
}

interface DashboardData {
  totals?: {
    total_spins: number
    nothing_spins: number
    epic_releases: number
    pity_releases: number
  }
  rarity_breakdown?: Array<{ rarity_code: string; count: number }>
  active_epic_pools?: Array<{
    id: string
    rarity_code?: string
    pool_size: number
    threshold_byn: number
    qualified_customers: string[]
  }>
  prizes_issued?: DashboardPrize[]
  rarity_rules?: WheelRarity[]
}

interface SpinsResponse {
  rows: Array<{
    id: string
    spun_at: string
    rarity_code: string
    is_wholesale: number
    prize_title: string
    generated_promo_code: string | null
    first_name: string | null
    telegram_username: string | null
  }>
  total: number
}

const tabs = [
  { id: 'dashboard', label: 'Обзор' },
  { id: 'prizes', label: 'Призы' },
  { id: 'settings', label: 'Правила выпадения' },
  { id: 'spins', label: 'История прокруток' },
] as const

type WheelTabId = (typeof tabs)[number]['id']
const activeTab = ref<WheelTabId>('dashboard')
const adminStore = useAdminStore()
const crmStore = useCrmStore()

type ToastKind = 'success' | 'error' | 'info'
interface ToastMessage {
  kind: ToastKind
  text: string
}
const toast = ref<ToastMessage | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(kind: ToastKind, text: string) {
  toast.value = { kind, text }
  if (toastTimer) clearTimeout(toastTimer)
  // Errors stay until manager dismisses; success/info auto-hide.
  if (kind !== 'error') {
    toastTimer = setTimeout(() => {
      toast.value = null
    }, 3500)
  }
}

function dismissToast() {
  toast.value = null
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

const prizeFormErrors = ref<string[]>([])
const confirmDeletePrize = ref<WheelPrize | null>(null)
const confirmTogglePrize = ref<WheelPrize | null>(null)

const rarities = ref<WheelRarity[]>([])
const prizes = ref<WheelPrize[]>([])
const promoTemplates = ref<PromoTemplate[]>([])
const dashboard = ref<DashboardData>({})
const spins = ref<SpinsResponse>({ rows: [], total: 0 })
const spinsOffset = ref(0)
const spinsLimit = ref(50)

const settingsForm = reactive({
  spin_byn_retail: 40,
  spin_byn_wholesale: 200,
  pity_threshold: 3,
  default_promo_validity_days: 90,
  feed_size: 30,
  start_collecting_at: '',
  wheel_access_usernames_text: '',
})

const selectedRarityCode = ref('common')
const savingRarityCode = ref('')
const promoQuickModalOpen = ref(false)
const promoQuickForm = reactive({
  code: '',
  description: '',
  customer_description: '',
  manager_description: '',
  discount_type: 'fixed',
  discount_value: 10,
  has_gift: false,
  min_order_amount: 0,
  max_uses: 0,
  duration_days: 90,
  active: true,
})
const promoQuickError = ref('')
const promoQuickTitleError = ref('')
const promoQuickTitleInputRef = ref<HTMLInputElement | null>(null)

const prizeModalOpen = ref(false)
const prizeImageInputRef = ref<HTMLInputElement | null>(null)
const prizeImageFile = ref<File | null>(null)
const prizeImagePreview = ref('')
const isPrizeSaving = ref(false)
const prizeForm = reactive<{
  id: string | null
  title: string
  description: string
  image_url: string
  rarity_code: string
  promo_template_id: string | null
  weight: number
  max_total: number
  promo_validity_days: number
  epic_pool_size: number
  epic_pool_threshold_byn: number
  sort_order: number
  is_for_retail: boolean
  is_for_wholesale: boolean
  is_active: boolean
}>({
  id: null,
  title: '',
  description: '',
  image_url: '',
  rarity_code: 'common',
  promo_template_id: null,
  weight: 1,
  max_total: 0,
  promo_validity_days: 90,
  epic_pool_size: 5,
  epic_pool_threshold_byn: 300,
  sort_order: 0,
  is_for_retail: true,
  is_for_wholesale: false,
  is_active: true,
})

function revokePrizeImagePreview() {
  if (prizeImagePreview.value.startsWith('blob:')) {
    URL.revokeObjectURL(prizeImagePreview.value)
  }
}

function setPrizeImagePreview(url: string) {
  revokePrizeImagePreview()
  prizeImagePreview.value = url
}

const rarityByCode = computed(() => {
  const map = new Map<string, WheelRarity>()
  for (const rarity of rarities.value) map.set(rarity.code, rarity)
  return map
})

const availablePromoTemplates = computed(() => {
  const selectedId = prizeForm.promo_template_id
  return promoTemplates.value.filter((promo) => {
    if (selectedId && promo.id === selectedId) return true
    if (promo.active === 0 || promo.active === false) return false
    if (promo.wheel_owner_customer_id) return false
    return true
  })
})

const selectedPromoTemplate = computed(() =>
  promoTemplates.value.find((promo) => promo.id === prizeForm.promo_template_id) || null,
)

const selectedPromoValidityHint = computed(() => {
  const template = selectedPromoTemplate.value
  if (!template) return 'Выберите промокод: срок действия берётся из его настроек.'
  const templateDays = Number(template.duration_days || 0)
  return promoValidityHint(templateDays > 0 ? templateDays : settingsForm.default_promo_validity_days, {
    emptyText: 'У промокода нет срока. Для выданного кода будет использован срок по умолчанию.',
  })
})

const selectedPromoPreviewTitle = computed(() => {
  const template = selectedPromoTemplate.value
  if (!template) return ''
  return String(template.description || template.customer_description || template.code || '').trim()
})

const selectedPromoPreviewDescription = computed(() => {
  const template = selectedPromoTemplate.value
  if (!template) return ''
  const title = selectedPromoPreviewTitle.value.trim().toLowerCase()
  const customerText = String(template.customer_description || '').trim()
  if (!String(template.description || '').trim()) return ''
  if (!customerText || customerText.toLowerCase() === title) return ''
  return customerText
})

const selectedPrizeRarity = computed(() => rarityByCode.value.get(prizeForm.rarity_code) || null)

function extractFirstHex(value: string | undefined | null): string {
  if (!value) return '#E2E5EA'
  const match = value.match(/#([0-9a-fA-F]{3}){1,2}\b/)
  return match ? match[0] : value
}

const prizeImagePreviewCardStyle = computed(() => ({
  borderColor: extractFirstHex(selectedPrizeRarity.value?.bgColor),
  borderStyle: 'solid',
}))

const prizeImagePreviewBadgeStyle = computed(() => ({
  background: selectedPrizeRarity.value?.bgColor || '#64748B',
  color: selectedPrizeRarity.value?.textColor || '#FFFFFF',
}))

const prizeRaritySelectStyle = computed(() => {
  const color = extractFirstHex(selectedPrizeRarity.value?.bgColor)
  return {
    borderColor: color,
    boxShadow: `0 0 0 1px ${color}22`,
  }
})

const quickPromoValidityHint = computed(() =>
  promoValidityHint(promoQuickForm.duration_days, {
    emptyText: 'Укажите срок, чтобы менеджер видел дату окончания.',
  }),
)

const selectedRarity = computed(
  () => rarities.value.find((rarity) => rarity.code === selectedRarityCode.value) || rarities.value[0] || null,
)

const configurablePrizeRarities = computed(() =>
  rarities.value.filter((rarity) => rarity.code !== 'nothing'),
)

const filteredPrizes = computed(() =>
  prizes.value.filter((prize) => prize.rarity_code === selectedRarityCode.value),
)

const nothingChancePercent = computed(() => {
  const total = rarities.value
    .filter((rarity) => !['nothing', 'valuable'].includes(rarity.code))
    .reduce((sum, rarity) => sum + Number(rarity.chancePercent ?? rarity.chance_percent ?? 0), 0)
  return Math.max(0, 100 - Math.min(100, total))
})

const spinsRangeText = computed(() => {
  const total = Number(spins.value.total || 0)
  if (total <= 0) return 'Всего: 0'
  const start = Math.min(spinsOffset.value + 1, total)
  const end = Math.min(spinsOffset.value + spinsLimit.value, total)
  return `${start}-${end} из ${total}`
})

function tabLabel(tab: (typeof tabs)[number]): string {
  if (tab.id === 'prizes') return `${tab.label}: ${prizes.value.length}`
  if (tab.id === 'spins') return `${tab.label}: ${spins.value.total || 0}`
  return tab.label
}

function poolProgress(pool: { qualified_customers: string[]; pool_size: number }): number {
  const size = Math.max(1, Number(pool.pool_size || 1))
  return Math.max(0, Math.min(100, (pool.qualified_customers.length / size) * 100))
}

function rarityLabel(code: string): string {
  const labels: Record<string, string> = {
    common: 'Обычный',
    rare: 'Редкий',
    epic: 'Эпический',
    legendary: 'Легендарный',
    mythic: 'Мифический',
    valuable: 'Ценный',
    nothing: 'Ничего',
  }
  return labels[code] || rarityByCode.value.get(code)?.label || code
}

function prizeDescription(prize: WheelPrize): string {
  const description = String(prize.description || '').trim()
  if (!description || description.toLowerCase() === String(prize.title || '').trim().toLowerCase()) {
    return ''
  }
  return description
}

function prizePromoText(prize: WheelPrize): string {
  if (prize.rarity_code === 'nothing') return 'Без промокода'
  const template = promoTemplates.value.find((promo) => promo.id === prize.promo_template_id)
  if (!prize.promo_template_id) return 'Без промокода'
  if (!prize.template_available) return 'Промокод недоступен'
  return `Промокод: ${template?.code || prize.promo_template_id}`
}

function prizeIssueText(prize: WheelPrize): string {
  const issued = Number(prize.issued_count || 0)
  const template = promoTemplates.value.find((promo) => promo.id === prize.promo_template_id)
  const limit = Number(template?.max_uses ?? prize.max_total ?? 0)
  if (limit <= 0) return `${issued}, без лимита`
  return `${issued} из ${limit}`
}

function prizeAudienceText(prize: WheelPrize): string {
  const retail = Boolean(prize.is_for_retail)
  const wholesale = Boolean(prize.is_for_wholesale)
  if (retail && wholesale) return 'Розница и опт'
  if (retail) return 'Розница'
  if (wholesale) return 'Опт'
  return 'Не выбран'
}

function issuedPrizeLimit(prize: DashboardPrize): number {
  return Number(prize.max_total || 0)
}

function issuedPrizeIssueText(prize: DashboardPrize): string {
  const issued = Number(prize.issued_count || 0)
  const limit = issuedPrizeLimit(prize)
  if (limit <= 0) return `Выдано ${issued}`
  return `Выдано ${issued} из ${limit}`
}

function issuedPrizeRemainingText(prize: DashboardPrize): string {
  const issued = Number(prize.issued_count || 0)
  const limit = issuedPrizeLimit(prize)
  if (limit <= 0) return 'Без лимита'
  const remaining = Math.max(0, limit - issued)
  if (remaining <= 0) return 'Лимит закончился'
  return `Осталось ${remaining}`
}

function issuedPrizeRemainingClass(prize: DashboardPrize): string {
  const limit = issuedPrizeLimit(prize)
  if (limit <= 0) return 'text-slate-500'
  return Number(prize.issued_count || 0) >= limit ? 'font-medium text-rose-600' : 'text-slate-500'
}

function issuedPrizeAudienceText(prize: DashboardPrize): string {
  const retail = Boolean(prize.is_for_retail)
  const wholesale = Boolean(prize.is_for_wholesale)
  if (retail && wholesale) return 'Розница и опт'
  if (retail) return 'Розница'
  if (wholesale) return 'Опт'
  return 'Не выбран сегмент'
}

function issuedPrizeAudienceClass(prize: DashboardPrize): string {
  if (!prize.is_for_retail && !prize.is_for_wholesale) return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-700'
}

function issuedPrizeStatusText(prize: DashboardPrize): string {
  if (!prize.is_active) return 'Выключен'
  if (!prize.is_for_retail && !prize.is_for_wholesale) return 'Проверьте доступ'
  const limit = issuedPrizeLimit(prize)
  const issued = Number(prize.issued_count || 0)
  if (limit > 0 && issued >= limit) return 'Лимит закончился'
  if (issued <= 0) return 'Ещё не выпадал'
  if (limit <= 0) return 'Выдаётся без лимита'
  return 'Выдаётся'
}

function issuedPrizeStatusClass(prize: DashboardPrize): string {
  if (!prize.is_active) return 'bg-slate-100 text-slate-600'
  if (!prize.is_for_retail && !prize.is_for_wholesale) return 'bg-rose-100 text-rose-700'
  const limit = issuedPrizeLimit(prize)
  const issued = Number(prize.issued_count || 0)
  if (limit > 0 && issued >= limit) return 'bg-amber-100 text-amber-800'
  if (issued <= 0) return 'bg-slate-100 text-slate-600'
  return 'bg-emerald-100 text-emerald-700'
}

function issuedPrizeRarityClass(code: string): string {
  const classes: Record<string, string> = {
    common: 'bg-slate-100 text-slate-700',
    rare: 'bg-blue-100 text-blue-700',
    epic: 'bg-violet-100 text-violet-700',
    legendary: 'bg-amber-100 text-amber-800',
    mythic: 'bg-fuchsia-100 text-fuchsia-700',
    valuable: 'bg-orange-100 text-orange-800',
    nothing: 'bg-slate-100 text-slate-600',
  }
  return classes[code] || 'bg-slate-100 text-slate-700'
}

function prizeStatusText(prize: WheelPrize): string {
  if (!prize.is_active) return 'Выключен'
  if (prize.is_exhausted) return 'Лимит исчерпан'
  if (prize.rarity_code !== 'nothing' && !prize.template_available) return 'Промокод недоступен'
  return 'Активен'
}

function prizeStatusClass(prize: WheelPrize): string {
  if (!prize.is_active) return 'bg-slate-100 text-slate-600'
  if (prize.is_exhausted || (prize.rarity_code !== 'nothing' && !prize.template_available)) {
    return 'bg-amber-100 text-amber-800'
  }
  return 'bg-emerald-100 text-emerald-700'
}

function canDeletePrize(prize: WheelPrize): boolean {
  return Boolean(prize.can_delete)
}

function rarityPrizeCount(rarity: WheelRarity): number {
  return Number(rarity.prizeCount ?? rarity.prize_count ?? 0)
}

function rarityIssuablePrizeCount(rarity: WheelRarity): number {
  return Number(rarity.issuablePrizeCount ?? rarity.issuable_prize_count ?? 0)
}

function rarityBadgeText(rarity: WheelRarity): string {
  const total = rarityPrizeCount(rarity)
  const issuable = rarityIssuablePrizeCount(rarity)
  if (total <= 0) return 'Нет призов'
  if (issuable <= 0) return 'Есть, но недоступны'
  return 'Готово к выдаче'
}

function rarityBadgeClass(rarity: WheelRarity): string {
  const total = rarityPrizeCount(rarity)
  const issuable = rarityIssuablePrizeCount(rarity)
  if (total <= 0) return 'bg-slate-100 text-slate-600'
  if (issuable <= 0) return 'bg-amber-100 text-amber-800'
  return 'bg-emerald-100 text-emerald-700'
}

function promoValidityHint(
  rawDays: number | null | undefined,
  { emptyText }: { emptyText: string },
): string {
  const days = Number(rawDays || 0)
  if (!Number.isFinite(days) || days <= 0) return emptyText
  const endDate = new Date()
  endDate.setHours(0, 0, 0, 0)
  endDate.setDate(endDate.getDate() + Math.floor(days) - 1)
  const formatted = endDate.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  return `Срок промокода: ${Math.floor(days)} дн., если выиграют сегодня — до ${formatted} включительно.`
}

function promoTemplateDurationDays(template: PromoTemplate | null | undefined): number {
  const days = Number(template?.duration_days || 0)
  if (Number.isFinite(days) && days > 0) return Math.floor(days)
  return Number(settingsForm.default_promo_validity_days || 90)
}

function formatDateTime(value: string): string {
  if (!value) return ''
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('admin_token') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const details = Array.isArray(data?.details) ? data.details.filter(Boolean) : []
    const message =
      data?.message ||
      (details.length ? details.join(', ') : '') ||
      data?.error ||
      'Request failed'
    throw new Error(message)
  }
  return data as T
}

async function loadAll() {
  await Promise.all([
    loadRarities(),
    loadPrizes(),
    loadSettings(),
    loadDashboard(),
    loadPromoTemplates(),
  ])
}

async function loadRarities() {
  try {
    const data = await fetchJson<{ rarities: WheelRarity[] }>(
      '/api/admin/crm/wheel/rarities',
    )
    rarities.value = data.rarities || []
    if (!rarities.value.some((rarity) => rarity.code === selectedRarityCode.value)) {
      selectedRarityCode.value = rarities.value.find((rarity) => rarity.code !== 'nothing')?.code || rarities.value[0]?.code || 'common'
    }
  } catch (error) {
    console.error('[crm-wheel] load rarities failed', error)
    showToast('error', 'Не получилось загрузить редкости.')
  }
}

async function loadPrizes() {
  const data = await fetchJson<{ prizes: WheelPrize[] }>(
    '/api/admin/crm/wheel/prizes',
  )
  prizes.value = data.prizes || []
  // Note: rarities now come from the dedicated endpoint in loadRarities().
  // Keep the legacy fallback for safety: if loadRarities failed for any
  // reason, derive a partial map from whatever prizes carry inline.
  if (!rarities.value.length) {
    const rarityMap = new Map<string, WheelRarity>()
    for (const prize of data.prizes || []) {
      if (prize.rarity) rarityMap.set(prize.rarity_code, prize.rarity)
    }
    if (rarityMap.size) {
      rarities.value = [...rarityMap.values()]
    }
  }
  if (!prizes.value.some((prize) => prize.rarity_code === selectedRarityCode.value)) {
    selectedRarityCode.value = rarities.value.find((rarity) => rarity.code !== 'nothing')?.code || rarities.value[0]?.code || 'common'
  }
}

async function loadSettings() {
  const data = await fetchJson<{
    spin_byn_retail: number
    spin_byn_wholesale: number
    pity_threshold: number
    default_promo_validity_days: number
    feed_size: number
    start_collecting_at: string | null
    wheel_access_usernames?: string[]
  }>('/api/admin/crm/wheel/settings')
  settingsForm.spin_byn_retail = data.spin_byn_retail
  settingsForm.spin_byn_wholesale = data.spin_byn_wholesale
  settingsForm.pity_threshold = data.pity_threshold
  settingsForm.default_promo_validity_days = data.default_promo_validity_days
  settingsForm.feed_size = data.feed_size
  // S2-N5: backend stores start_collecting_at as a SQLite UTC string.
  // The datetime-local input expects "YYYY-MM-DDTHH:MM" interpreted as
  // local time — so we project the UTC instant into Minsk wall-clock
  // and feed that to the input. The previous code used `.toISOString()`
  // which is UTC and showed staff a value 3 hours behind the real
  // Minsk start moment.
  settingsForm.start_collecting_at = formatBackendDateForLocalInput(
    data.start_collecting_at,
  )
  settingsForm.wheel_access_usernames_text = Array.isArray(data.wheel_access_usernames)
    ? data.wheel_access_usernames.join('\n')
    : ''
}

function formatBackendDateForLocalInput(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = String(value).trim()
  if (!trimmed) return ''
  // Backend format is `YYYY-MM-DD HH:MM:SS` (UTC, no offset). Tag it as
  // UTC so Date parses correctly, then format Minsk parts manually.
  const isoUtc = trimmed.includes('T')
    ? /[Z+\-]\d{2}:?\d{2}$/.test(trimmed)
      ? trimmed
      : `${trimmed}Z`
    : `${trimmed.replace(' ', 'T')}Z`
  const reference = new Date(isoUtc)
  if (Number.isNaN(reference.getTime())) return ''
  const parts = getBusinessDateParts(reference, BUSINESS_TIME_ZONE)
  // Hours/minutes also need to come from a Minsk-aware formatter so we
  // can't reuse getBusinessDateParts which only returns date pieces.
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const time = timeFormatter.format(reference)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${time}`
}

async function loadDashboard() {
  dashboard.value = await fetchJson<DashboardData>(
    '/api/admin/crm/wheel/dashboard',
  )
  if (!rarities.value.length) {
    // Fallback: derive from rarity_breakdown so labels render before prizes load.
    const rarityMap = new Map<string, WheelRarity>()
    for (const row of dashboard.value.rarity_breakdown || []) {
      rarityMap.set(row.rarity_code, { code: row.rarity_code, label: row.rarity_code })
    }
    if (rarityMap.size) rarities.value = [...rarityMap.values()]
  }
}

async function loadPromoTemplates() {
  try {
    const data = await fetchJson<{ promo_codes: PromoTemplate[] } | PromoTemplate[]>(
      '/api/admin/crm/promo-codes?source=all',
    )
    promoTemplates.value = Array.isArray(data)
      ? data
      : Array.isArray(data?.promo_codes)
        ? data.promo_codes
        : []
  } catch (_error) {
    promoTemplates.value = []
  }
}

async function loadSpins() {
  const url = `/api/admin/crm/wheel/spins?limit=${spinsLimit.value}&offset=${spinsOffset.value}`
  spins.value = await fetchJson<SpinsResponse>(url)
}

async function refreshWheelStatusData() {
  await Promise.all([
    loadRarities(),
    loadPrizes(),
    loadDashboard(),
    activeTab.value === 'spins' ? loadSpins() : Promise.resolve(),
  ])
}

async function saveRarityRule(rarity: WheelRarity) {
  if (!rarity?.code || rarity.code === 'nothing') return
  const nextChance =
    rarity.code === 'valuable'
      ? 0
      : Number(rarity.chancePercent ?? rarity.chance_percent ?? 0)
  const nextPoolSize = Number(rarity.valuablePoolSize ?? rarity.valuable_pool_size ?? 5)
  const nextThreshold = Number(rarity.valuableThresholdByn ?? rarity.valuable_threshold_byn ?? 300)

  if (rarity.code !== 'valuable') {
    if (!Number.isFinite(nextChance) || nextChance < 0 || nextChance > 100) {
      showToast('error', 'Шанс должен быть числом от 0 до 100.')
      return
    }
    const totalChance = rarities.value
      .filter((item) => !['nothing', 'valuable'].includes(item.code))
      .reduce((sum, item) => {
        if (item.code === rarity.code) return sum + nextChance
        return sum + Number(item.chancePercent ?? item.chance_percent ?? 0)
      }, 0)
    if (totalChance > 100) {
      showToast('error', 'Сумма шансов не может быть больше 100%.')
      return
    }
  }
  if (rarity.code === 'valuable') {
    if (!Number.isInteger(nextPoolSize) || nextPoolSize < 1) {
      showToast('error', 'Размер очереди должен быть целым числом от 1.')
      return
    }
    if (!Number.isFinite(nextThreshold) || nextThreshold < 1) {
      showToast('error', 'Минимум покупок должен быть числом не меньше 1 BYN.')
      return
    }
  }
  try {
    savingRarityCode.value = rarity.code
    await fetchJson(`/api/admin/crm/wheel/rarities/${rarity.code}`, {
      method: 'PUT',
      body: JSON.stringify({
        chance_percent: nextChance,
        valuable_pool_size: nextPoolSize,
        valuable_threshold_byn: nextThreshold,
      }),
    })
    await refreshWheelStatusData()
    showToast('success', `Редкость «${rarityLabel(rarity.code)}» сохранена.`)
  } catch (error: unknown) {
    console.error('[crm-wheel] save rarity rule failed', error)
    showToast('error', (error as { message?: string })?.message || 'Не получилось сохранить редкость.')
  } finally {
    savingRarityCode.value = ''
  }
}

function generatePromoTemplateCode() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  promoQuickForm.code = `WHEEL-${random}`
}

function openQuickPromoModal() {
  const inheritedDuration = promoTemplateDurationDays(selectedPromoTemplate.value)
  promoQuickError.value = ''
  promoQuickTitleError.value = ''
  Object.assign(promoQuickForm, {
    code: '',
    description: '',
    customer_description: '',
    manager_description: '',
    discount_type: 'fixed',
    discount_value: 10,
    has_gift: false,
    min_order_amount: 0,
    max_uses: 0,
    duration_days: inheritedDuration,
    active: true,
  })
  generatePromoTemplateCode()
  promoQuickModalOpen.value = true
}

function closeQuickPromoModal() {
  promoQuickModalOpen.value = false
  promoQuickError.value = ''
  promoQuickTitleError.value = ''
}

async function createQuickPromoTemplate() {
  promoQuickError.value = ''
  promoQuickTitleError.value = ''
  try {
    const prizeTitle = promoQuickForm.description.trim()
    if (!prizeTitle) {
      promoQuickTitleError.value = 'Укажите название приза'
      await nextTick()
      promoQuickTitleInputRef.value?.focus()
      return
    }
    if (!Number.isFinite(Number(promoQuickForm.max_uses)) || Number(promoQuickForm.max_uses) < 0) {
      promoQuickError.value = 'Лимит победителей не может быть отрицательным.'
      return
    }
    const discountValue = Number(promoQuickForm.discount_value)
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      promoQuickError.value = 'Значение скидки не может быть отрицательным.'
      return
    }
    const promo = await crmStore.createPromoCode({
      code: promoQuickForm.code.trim().toUpperCase(),
      description: prizeTitle,
      customer_description: promoQuickForm.customer_description.trim() || null,
      manager_description: promoQuickForm.manager_description.trim() || null,
      discount_type: promoQuickForm.discount_type as 'fixed' | 'percent',
      discount_value: discountValue,
      has_gift: discountValue <= 0 ? 1 : 0,
      min_order_amount: Number(promoQuickForm.min_order_amount) || 0,
      max_uses: Number(promoQuickForm.max_uses) || 0,
      duration_days: Number(promoQuickForm.duration_days) || 90,
      is_wheel_template: 1,
      active: promoQuickForm.active ? 1 : 0,
    })
    await loadPromoTemplates()
    prizeForm.promo_template_id = promo.id
    closeQuickPromoModal()
    showToast('success', 'Промокод создан.')
  } catch (error: unknown) {
    promoQuickError.value =
      (error as { message?: string })?.message || 'Не получилось создать промокод.'
  }
}

function openCreateModal() {
  const defaultRarityCode =
    selectedRarityCode.value !== 'nothing'
      ? selectedRarityCode.value
      : configurablePrizeRarities.value[0]?.code || 'common'
  Object.assign(prizeForm, {
    id: null,
    title: '',
    description: '',
    image_url: '',
    rarity_code: defaultRarityCode,
    promo_template_id: null,
    weight: 1,
    max_total: 0,
    promo_validity_days: settingsForm.default_promo_validity_days || 90,
    epic_pool_size: Number(selectedRarity.value?.valuablePoolSize || selectedRarity.value?.valuable_pool_size || 5),
    epic_pool_threshold_byn: Number(selectedRarity.value?.valuableThresholdByn || selectedRarity.value?.valuable_threshold_byn || 300),
    sort_order: filteredPrizes.value.length * 10,
    is_for_retail: true,
    is_for_wholesale: false,
    is_active: true,
  })
  prizeImageFile.value = null
  setPrizeImagePreview('')
  prizeFormErrors.value = []
  prizeModalOpen.value = true
}

function openEditModal(prize: WheelPrize) {
  if (prize.rarity_code === 'nothing') {
    showToast('info', 'Редкость «Ничего» системная и не редактируется.')
    return
  }
  selectedRarityCode.value = prize.rarity_code
  Object.assign(prizeForm, {
    id: prize.id,
    title: prize.title,
    description: prize.description || '',
    image_url: prize.image_url || '',
    rarity_code: prize.rarity_code,
    promo_template_id: prize.promo_template_id || null,
    weight: Number(prize.weight) || 0,
    max_total: Number(prize.max_total) || 0,
    promo_validity_days: Number(prize.promo_validity_days) || 90,
    epic_pool_size: Number(prize.epic_pool_size) || 5,
    epic_pool_threshold_byn: Number(prize.epic_pool_threshold_byn) || 300,
    sort_order: Number(prize.sort_order) || 0,
    is_for_retail: Boolean(prize.is_for_retail),
    is_for_wholesale: Boolean(prize.is_for_wholesale),
    is_active: Boolean(prize.is_active),
  })
  prizeImageFile.value = null
  setPrizeImagePreview(prize.image_url || '')
  prizeFormErrors.value = []
  prizeModalOpen.value = true
}

function closeModal() {
  prizeImageFile.value = null
  setPrizeImagePreview('')
  if (prizeImageInputRef.value) {
    prizeImageInputRef.value.value = ''
  }
  prizeModalOpen.value = false
}

function triggerPrizeImagePicker() {
  prizeImageInputRef.value?.click()
}

function clearPrizeImage() {
  prizeImageFile.value = null
  prizeForm.image_url = ''
  setPrizeImagePreview('')
  if (prizeImageInputRef.value) {
    prizeImageInputRef.value.value = ''
  }
}

function handlePrizeImageSelected(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0] || null
  if (!file) return
  prizeImageFile.value = file
  setPrizeImagePreview(URL.createObjectURL(file))
}

function validatePrizeForm(): string[] {
  const errors: string[] = []
  if (!prizeForm.rarity_code) errors.push('Выберите редкость.')
  if (!Number.isFinite(prizeForm.weight) || prizeForm.weight < 0) {
    errors.push('Частота выпадения не может быть отрицательной.')
  }
  if (prizeForm.rarity_code === 'valuable') {
    if (!Number.isFinite(prizeForm.epic_pool_size) || prizeForm.epic_pool_size < 1) {
      errors.push('Количество участников до выдачи должно быть от 1.')
    }
    if (
      !Number.isFinite(prizeForm.epic_pool_threshold_byn) ||
      prizeForm.epic_pool_threshold_byn < 1
    ) {
      errors.push('Сумма покупок для ценной редкости должна быть от 1 BYN.')
    }
  }
  if (!prizeForm.is_for_retail && !prizeForm.is_for_wholesale) {
    errors.push('Выберите хотя бы один тип: розница или опт.')
  }
  if (
    prizeForm.rarity_code !== 'nothing' &&
    !prizeForm.promo_template_id
  ) {
    // Non-blocking warning: not strictly required by backend, but matches
    // the docs ("Если редкость не nothing — нужен шаблон промокода").
    errors.push(
      'Выберите промокод для приза, иначе клиент не получит код.',
    )
  }
  return errors
}

async function savePrize() {
  prizeFormErrors.value = validatePrizeForm()
  if (prizeFormErrors.value.length) return

  try {
    isPrizeSaving.value = true
    let imageUrl = prizeForm.image_url.trim() || null
    if (prizeImageFile.value) {
      const uploaded = await adminStore.uploadFiles([prizeImageFile.value], 'wheel-prizes')
      imageUrl = uploaded?.[0] || null
      prizeForm.image_url = imageUrl || ''
      if (imageUrl) {
        setPrizeImagePreview(imageUrl)
      }
    }

    const payload = {
      rarity_code: prizeForm.rarity_code,
      image_url: imageUrl,
      weight: prizeForm.weight,
      promo_template_id: prizeForm.promo_template_id,
      epic_pool_size: prizeForm.epic_pool_size,
      epic_pool_threshold_byn: prizeForm.epic_pool_threshold_byn,
      is_for_retail: prizeForm.is_for_retail,
      is_for_wholesale: prizeForm.is_for_wholesale,
      is_active: prizeForm.is_active,
      sort_order: prizeForm.sort_order,
    }

    if (prizeForm.id) {
      await fetchJson(`/api/admin/crm/wheel/prizes/${prizeForm.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    } else {
      await fetchJson('/api/admin/crm/wheel/prizes', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    }
    closeModal()
    await refreshWheelStatusData()
    showToast('success', prizeForm.id ? 'Приз обновлён.' : 'Приз создан.')
  } catch (error: unknown) {
    console.error('[crm-wheel] save prize failed', error)
    const message =
      (error as { message?: string })?.message ||
      'Не получилось сохранить приз.'
    showToast('error', message)
  } finally {
    isPrizeSaving.value = false
  }
}

function requestTogglePrize(prize: WheelPrize) {
  confirmTogglePrize.value = prize
}

async function togglePrizeConfirmed() {
  const prize = confirmTogglePrize.value
  if (!prize) return
  const nextActive = !Boolean(prize.is_active)
  try {
    await fetchJson(`/api/admin/crm/wheel/prizes/${prize.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: nextActive }),
    })
    await refreshWheelStatusData()
    showToast('success', `Приз «${prize.title}» ${nextActive ? 'включён' : 'выключен'}.`)
  } catch (error: unknown) {
    console.error('[crm-wheel] toggle prize failed', error)
    const message =
      (error as { message?: string })?.message ||
      `Не получилось ${nextActive ? 'включить' : 'выключить'} приз.`
    showToast('error', message)
  } finally {
    confirmTogglePrize.value = null
  }
}

function requestDeletePrize(prize: WheelPrize) {
  confirmDeletePrize.value = prize
}

async function deletePrizeConfirmed() {
  const prize = confirmDeletePrize.value
  if (!prize) return
  try {
    await fetchJson(`/api/admin/crm/wheel/prizes/${prize.id}`, {
      method: 'DELETE',
    })
    await refreshWheelStatusData()
    showToast('success', `Приз «${prize.title}» удалён.`)
  } catch (error: unknown) {
    console.error('[crm-wheel] delete prize failed', error)
    const message =
      (error as { message?: string })?.message ||
      'Не получилось удалить приз.'
    showToast('error', message)
  } finally {
    confirmDeletePrize.value = null
  }
}

async function saveSettings() {
  const wheelAccessUsernames = [
    ...new Set(
      settingsForm.wheel_access_usernames_text
        .split(/\r?\n/)
        .map((value) => value.trim().replace(/^@+/, '').toLowerCase())
        .filter(Boolean),
    ),
  ]
  const payload: Record<string, unknown> = {
    spin_byn_retail: settingsForm.spin_byn_retail,
    spin_byn_wholesale: settingsForm.spin_byn_wholesale,
    pity_threshold: settingsForm.pity_threshold,
    default_promo_validity_days: settingsForm.default_promo_validity_days,
    feed_size: settingsForm.feed_size,
    wheel_access_usernames: wheelAccessUsernames,
  }
  // S2-N5: send the raw datetime-local string ("YYYY-MM-DDTHH:MM"),
  // backend interprets it as Minsk-local. Previously we used
  // `new Date(...).toISOString()` here, which converted using the OS
  // timezone of whoever was operating the CRM — an admin in Moscow
  // would set "release at 13:00 Moscow" and the wheel would start
  // collecting one hour earlier in Minsk than they intended.
  if (settingsForm.start_collecting_at) {
    payload.start_collecting_at = settingsForm.start_collecting_at
  }
  try {
    await fetchJson('/api/admin/crm/wheel/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    await loadSettings()
    showToast('success', 'Настройки сохранены.')
  } catch (error: unknown) {
    console.error('[crm-wheel] save settings failed', error)
    const message =
      (error as { message?: string })?.message ||
      'Не получилось сохранить настройки.'
    showToast('error', message)
  }
}

function changeSpinsPage(direction: 1 | -1) {
  const next = spinsOffset.value + direction * spinsLimit.value
  if (next < 0) return
  spinsOffset.value = next
  loadSpins()
}

onMounted(async () => {
  await loadAll()
  if (activeTab.value === 'spins') {
    await loadSpins()
  }
})

watch(activeTab, (next) => {
  if (next === 'spins') loadSpins()
  if (next === 'dashboard') loadDashboard()
})

onBeforeUnmount(() => {
  revokePrizeImagePreview()
})
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>
