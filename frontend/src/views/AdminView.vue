<template>
  <div class="min-h-screen bg-gray-50 md:h-screen md:overflow-hidden">
    
    <!-- Login/Lock screen - Cashier POS interface -->
    <CashierLockScreen v-if="!adminStore.isAuthenticated || isLocked" @unlocked="handleUnlock" />

    <!-- Authenticated layout -->
<AdminLayout v-else-if="adminStore.isAuthenticated" v-model="layoutTab" :tabs="adminTabs" :main-active="!isCrmRoute" :crm-links="crmLinks" @lock="handleLock">
        <template #default>
          <!--
            Разделы CRM меняются здесь, поэтому и анимация живёт здесь.
            Раньше её изображал верхний <Transition> в App.vue: он уводил и
            возвращал всю админку целиком, а этот RouterView успевал подменить
            содержимое ещё до начала ухода — было видно, как раздел сменился
            раньше анимации. Теперь уезжает ровно то, что меняется.
            Класс page-fade объявлен в App.vue в неизолированном <style>.
          -->
          <RouterView v-if="isCrmRoute" v-slot="{ Component, route: crmRoute }">
            <Transition name="page-fade" mode="out-in">
              <component :is="Component" :key="crmRoute.fullPath" />
            </Transition>
          </RouterView>
          <template v-else>
            <!-- Overview -->
            <template v-if="activeTab === 'dashboard'">
              <!-- Profit access form for dashboard -->
              <div v-if="!dashboardReady" class="flex justify-center py-12">
                <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow">
                  <h3 class="text-lg font-semibold text-gray-900 text-center mb-3">Введите код доступа</h3>
                  <form class="space-y-4" @submit.prevent="handleProfitUnlocked">
                    <input
                      v-model="profitPassword"
                      type="password"
                      autocomplete="current-password"
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-dark/20"
                      placeholder="Пароль"
                    />
                    <p v-if="profitError" class="text-sm text-red-600">{{ profitError }}</p>
                    <button
                      type="submit"
                      class="w-full rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark/90 disabled:cursor-not-allowed disabled:bg-brand-dark/60"
                      :disabled="verifyingProfit"
                    >
                      {{ verifyingProfit ? 'Проверяем…' : 'Войти' }}
                    </button>
                  </form>
                </div>
              </div>
              
              <div v-else class="space-y-6">
            <!-- Main Dashboard Card -->
            <section class="relative overflow-hidden rounded-3xl bg-gradient-to-r from-gray-900 via-red-700 to-red-500 text-white shadow-2xl">
              <Transition name="dash-fade" mode="out-in">
                <div :key="`${overviewPeriod}-${selectedMetric}`" class="relative z-10 p-6 sm:p-8">
                  <div class="flex flex-col lg:flex-row gap-6 lg:gap-8">
                    <!-- Left: Metrics Cards -->
                    <div class="flex-shrink-0 space-y-4" style="width: 100%; max-width: 280px;">
                      <!-- Header -->
                      <div class="mb-2">
                        <h2 class="text-2xl sm:text-3xl font-extrabold text-white leading-tight capitalize">{{ currentMonthName }}</h2>
                        <p class="text-[10px] sm:text-[11px] uppercase tracking-wider text-white/60 mt-1">{{ dashboardHeader }}</p>
                      </div>

                      <!-- Interactive Metric Cards -->
                      <button
                        @click="selectedMetric = 'revenue'"
                        class="metric-card w-full rounded-2xl px-5 py-4 text-left cursor-pointer relative"
                        :class="{
                          'metric-card--active': selectedMetric === 'revenue',
                          'metric-card--inactive': selectedMetric !== 'revenue',
                          'metric-card--pulse': selectedMetric === 'revenue' && chartTransitioning
                        }"
                        :title="dashboardTimeseries && dashboardTimeseries.length > 0 ? `Сумма из ${dashboardTimeseries.length} точек графика` : ''"
                      >
                        <p class="relative z-10 text-[0.65rem] font-bold uppercase tracking-[0.3em] text-white/80">Выручка</p>
                        <p class="relative z-10 mt-2 text-3xl sm:text-4xl font-bold text-white">
                          <CountUpCurrency v-if="overviewStats" :value="overviewStats.revenue ?? 0" :key="`${overviewPeriod}-${overviewOffset}-revenue`" />
                          <span v-else>—</span>
                        </p>
                      </button>

                      <button
                        @click="selectedMetric = 'profit'"
                        class="metric-card w-full rounded-2xl px-5 py-4 text-left cursor-pointer relative"
                        :class="{
                          'metric-card--active': selectedMetric === 'profit',
                          'metric-card--inactive': selectedMetric !== 'profit',
                          'metric-card--pulse': selectedMetric === 'profit' && chartTransitioning
                        }"
                        :title="dashboardTimeseries && dashboardTimeseries.length > 0 ? `Сумма из ${dashboardTimeseries.length} точек графика` : ''"
                      >
                        <p class="relative z-10 text-[0.65rem] font-bold uppercase tracking-[0.3em] text-white/80">Прибыль</p>
                        <p class="relative z-10 mt-2 text-3xl sm:text-4xl font-bold text-white">
                          <CountUpCurrency v-if="overviewStats" :value="overviewStats.profit ?? 0" :key="`${overviewPeriod}-${overviewOffset}-profit`" />
                          <span v-else>—</span>
                        </p>
                      </button>

                      <button
                        @click="selectedMetric = 'orders'"
                        class="metric-card w-full rounded-2xl px-5 py-4 text-left cursor-pointer relative"
                        :class="{
                          'metric-card--active': selectedMetric === 'orders',
                          'metric-card--inactive': selectedMetric !== 'orders',
                          'metric-card--pulse': selectedMetric === 'orders' && chartTransitioning
                        }"
                        :title="dashboardTimeseries && dashboardTimeseries.length > 0 ? `Сумма из ${dashboardTimeseries.length} точек графика` : ''"
                      >
                        <p class="relative z-10 text-[0.65rem] font-bold uppercase tracking-[0.3em] text-white/80">Заказов</p>
                        <p class="relative z-10 mt-2 text-3xl sm:text-4xl font-bold text-white">
                          <CountUp v-if="overviewStats" :value="overviewStats.totalSales ?? 0" :key="`${overviewPeriod}-${overviewOffset}-orders`" />
                          <span v-else>—</span>
                        </p>
                      </button>
                    </div>

                    <!-- Right: Chart -->
                    <div class="flex-1 flex flex-col gap-4 min-w-0">
                      <!-- Period Selector -->
                      <div class="flex flex-wrap items-center gap-2">
                        <button
                          v-for="option in overviewPeriods"
                          :key="option.value"
                          type="button"
                          class="rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200"
                          :class="overviewPeriod === option.value ? 'bg-white text-red-600 shadow-lg scale-105' : 'bg-white/15 text-white/90 hover:bg-white/25'"
                          @click="overviewPeriod = option.value; overviewOffset = 0"
                        >
                          {{ option.label }}
                        </button>
                      </div>

                      <!-- Произвольный диапазон дат -->
                      <div v-if="overviewPeriod === 'custom'" class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" role="group" aria-label="Произвольный диапазон дат">
                        <label class="flex items-center gap-2 text-xs font-semibold text-white/80">
                          <span>с</span>
                          <input
                            v-model="customRangeFrom"
                            type="date"
                            :max="customRangeTo || undefined"
                            aria-label="Начало диапазона"
                            class="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white placeholder-white/50 backdrop-blur-sm border border-white/20 focus:border-white/60 focus:outline-none"
                          />
                        </label>
                        <label class="flex items-center gap-2 text-xs font-semibold text-white/80">
                          <span>по</span>
                          <input
                            v-model="customRangeTo"
                            type="date"
                            :min="customRangeFrom || undefined"
                            aria-label="Конец диапазона"
                            class="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white placeholder-white/50 backdrop-blur-sm border border-white/20 focus:border-white/60 focus:outline-none"
                          />
                        </label>
                        <span v-if="!isCustomRangeReady" class="text-[10px] uppercase tracking-wide text-white/50">
                          выберите обе даты
                        </span>
                      </div>

                      <!-- Chart Area -->
                      <div class="flex-1 rounded-2xl bg-white/5 backdrop-blur-sm p-4 sm:p-5 border border-white/10">
                        <div v-if="overviewPeriod === 'custom'" class="flex flex-col items-center justify-center h-64 gap-2 text-center">
                          <p class="text-sm text-white/70 font-medium">График по дням для произвольного диапазона пока недоступен</p>
                          <p class="text-[11px] text-white/40">Сводные показатели справа учитывают выбранный диапазон корректно</p>
                        </div>
                        <div v-else-if="loadingTimeseries" class="flex flex-col items-center justify-center h-64 gap-4">
                          <div class="h-10 w-10 animate-spin rounded-full border-3 border-white/30 border-t-white"></div>
                          <p class="text-xs text-white/60 font-medium animate-pulse">Загрузка графика...</p>
                        </div>
                        <div v-else-if="chartData.length > 0" class="space-y-4">
                          <div class="relative h-64 sm:h-72">
                            <!-- Chart bars -->
                            <div :key="chartAnimationKey" class="absolute inset-0 flex items-end justify-between gap-1 px-2">
                              <div
                                v-for="(point, index) in chartData"
                                :key="`${point.label}-${index}`"
                                class="flex-1 relative flex flex-col items-center justify-end group"
                              >
                                <!-- Value label above bar -->
                                <div
                                  v-if="point.value > 0"
                                  :key="`value-${chartAnimationKey}-${index}`"
                                  class="chart-value-label absolute text-[9px] sm:text-[10px] font-semibold text-white/60 group-hover:text-white/90 whitespace-nowrap pointer-events-none"
                                  :style="{
                                    '--value-delay': (index * 20 + 150) + 'ms',
                                    bottom: (getBarHeightPx(point.value) + 4) + 'px'
                                  }"
                                >
                                  {{ formatChartValueCompact(point.value) }}
                                </div>
                                
                                <!-- Tooltip -->
                                <Transition
                                  enter-active-class="transition-all duration-150 ease-out"
                                  enter-from-class="opacity-0 scale-90"
                                  enter-to-class="opacity-100 scale-100"
                                  leave-active-class="transition-all duration-100 ease-in"
                                  leave-from-class="opacity-100 scale-100"
                                  leave-to-class="opacity-0 scale-90"
                                >
                                  <div
                                    v-if="hoveredBarIndex === index"
                                    class="absolute left-1/2 -translate-x-1/2 rounded-lg bg-gradient-to-br from-gray-900 to-gray-800 px-2.5 py-1.5 text-sm text-white shadow-2xl whitespace-nowrap z-20 border border-white/10"
                                    :style="{ bottom: (getBarHeightPx(point.value) + 20) + 'px' }"
                                  >
                                    <!-- Метрика с иконкой -->
                                    <div class="flex items-center gap-1.5 mb-1 pb-1 border-b border-white/10">
                                      <div class="w-4 h-4 rounded flex items-center justify-center" :class="{
                                        'bg-green-500/20': selectedMetric === 'revenue',
                                        'bg-blue-500/20': selectedMetric === 'profit',
                                        'bg-purple-500/20': selectedMetric === 'orders'
                                      }">
                                        <svg v-if="selectedMetric === 'revenue'" class="w-2.5 h-2.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z"/>
                                          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clip-rule="evenodd"/>
                                        </svg>
                                        <svg v-else-if="selectedMetric === 'profit'" class="w-2.5 h-2.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                          <path fill-rule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clip-rule="evenodd"/>
                                        </svg>
                                        <svg v-else class="w-2.5 h-2.5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
                                          <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/>
                                        </svg>
                                      </div>
                                      <span class="text-[10px] font-semibold uppercase tracking-wide text-white/60">
                                        {{ selectedMetric === 'revenue' ? 'Выручка' : selectedMetric === 'profit' ? 'Прибыль' : 'Заказов' }}
                                      </span>
                                    </div>
                                    
                                    <!-- Значение и дата в одной строке -->
                                    <div class="flex items-baseline justify-between gap-3">
                                      <div class="font-bold text-base" :class="{
                                        'text-green-400': selectedMetric === 'revenue',
                                        'text-blue-400': selectedMetric === 'profit',
                                        'text-purple-400': selectedMetric === 'orders'
                                      }">
                                        {{ formatChartValue(point.value) }}
                                      </div>
                                      <div class="flex items-center gap-1 text-[10px] text-white/40">
                                        <svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                          <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/>
                                        </svg>
                                        <span>{{ point.label }}</span>
                                      </div>
                                    </div>
                                  </div>
                                </Transition>
                                <!-- Bar with dual animation modes -->
                                <div
                                  class="chart-bar w-full rounded-t-sm cursor-pointer"
                                  :class="{
                                    'chart-bar--hovered': hoveredBarIndex === index,
                                    'chart-bar--morphing': chartTransitioning
                                  }"
                                  :style="{
                                    '--bar-height': getBarHeightPx(point.value) + 'px',
                                    '--bar-delay': (index * 20) + 'ms',
                                    backgroundColor: hoveredBarIndex === index ? '#ffffff' : 'rgba(255, 255, 255, 0.85)'
                                  }"
                                  @mouseenter="hoveredBarIndex = index"
                                  @mouseleave="hoveredBarIndex = null"
                                ></div>
                              </div>
                            </div>
                          </div>
                          <!-- Labels -->
                          <div class="flex items-center justify-between gap-1 px-2">
                            <div
                              v-for="(point, index) in chartData"
                              :key="`label-${point.label}-${index}`"
                              class="flex-1 text-center text-[9px] sm:text-[10px] text-white/70 font-medium truncate"
                              :class="{ 'chart-label': isInitialChartLoad }"
                              :style="{ '--label-delay': (index * 20 + 100) + 'ms' }"
                            >
                              {{ point.label }}
                            </div>
                          </div>
                        </div>
                        <div v-else class="h-64 flex flex-col items-center justify-center text-white/60 text-sm gap-2">
                          <svg class="w-12 h-12 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          <p class="font-medium">Нет данных за выбранный период</p>
                          <p class="text-xs text-white/40">Выберите другой период или добавьте заказы через CRM</p>
                        </div>
                      </div>

                      <!-- Navigation: для произвольного диапазона стрелки скрываем —
                           вместо них уже есть два инпута дат сверху -->
                      <div v-if="overviewPeriod !== 'custom'" class="flex items-center justify-center gap-3 text-xs font-semibold uppercase tracking-wider text-white/90">
                        <button
                          @click="prevOverviewRange"
                          class="rounded-lg bg-white/15 border border-white/20 px-3 py-1.5 hover:bg-white/25 transition"
                        >
                          ←
                        </button>
                        <span class="px-2">{{ overviewRangeLabel }}</span>
                        <button
                          @click="nextOverviewRange"
                          :disabled="isAtCurrentOverview"
                          class="rounded-lg bg-white/15 border border-white/20 px-3 py-1.5 hover:bg-white/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          →
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Transition>
            </section>

            <Transition name="dash-fade" mode="out-in">
              <div v-if="loadingDashboard" key="loading" class="flex items-center justify-center py-16">
                <div class="h-12 w-12 animate-spin rounded-full border-4 border-brand-dark border-t-transparent"></div>
              </div>
              <div v-else-if="dashboardStats" :key="`${overviewPeriod}-${overviewOffset}`" class="space-y-8">
                <section class="grid gap-6 xl:grid-cols-[1.6fr,1fr]">
                  <div class="card-base relative overflow-hidden rounded-3xl border border-red-100/60 bg-white p-6 shadow-lg">
                    <div class="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 class="text-lg font-semibold text-gray-900">
                          {{ topGroupsSort === 'quantity' ? 'Топ линеек по продажам' : 'Топ линеек по прибыли' }}
                        </h3>
                        <p class="mt-1 text-xs text-gray-400">Если линеек меньше пяти, отображаются только доступные</p>
                      </div>
                      <span v-if="topGroups.length" class="rounded-full bg-brand-primary/20 px-3 py-1 text-xs font-semibold text-brand-dark">
                        {{ topGroups.length }}
                      </span>
                    </div>

                    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div class="inline-flex rounded-xl bg-gray-100 p-1 text-xs font-semibold" role="group" aria-label="Сортировка топ-линеек">
                        <button
                          type="button"
                          class="rounded-lg px-3 py-1.5 transition"
                          :class="topGroupsSort === 'profit' ? 'bg-white text-brand-dark shadow' : 'text-gray-500 hover:text-gray-700'"
                          :aria-pressed="topGroupsSort === 'profit'"
                          @click="topGroupsSort = 'profit'"
                        >
                          По прибыли
                        </button>
                        <button
                          type="button"
                          class="rounded-lg px-3 py-1.5 transition"
                          :class="topGroupsSort === 'quantity' ? 'bg-white text-brand-dark shadow' : 'text-gray-500 hover:text-gray-700'"
                          :aria-pressed="topGroupsSort === 'quantity'"
                          @click="topGroupsSort = 'quantity'"
                        >
                          По количеству
                        </button>
                      </div>
                      <input
                        v-model="topGroupsSearch"
                        type="search"
                        placeholder="Поиск по названию линейки…"
                        aria-label="Поиск по названию линейки"
                        class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30 sm:max-w-xs"
                      />
                    </div>

                    <div v-if="topGroups.length" class="mt-6 space-y-4">
                      <div
                        v-for="(group, index) in topGroups"
                        :key="group.group_id || index"
                        class="relative overflow-hidden rounded-2xl border border-gray-200/70 bg-white/90 p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                      >
                        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div class="flex items-center gap-3 min-w-0">
                            <div class="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                              <img
                                v-if="topGroupCoverImages[group.group_id]"
                                :src="topGroupCoverImages[group.group_id]"
                                :alt="group.group_name || ''"
                                class="h-full w-full object-cover"
                                loading="lazy"
                              />
                              <PhotoIcon v-else class="h-6 w-6 text-gray-300" />
                            </div>
                            <div class="min-w-0">
                              <p class="text-xs font-semibold uppercase tracking-[0.3em] text-brand-dark/70">№{{ index + 1 }}</p>
                              <p class="mt-1 truncate text-base font-semibold text-gray-900">
                                {{ group.group_name || 'Без названия' }}
                              </p>
                              <p class="text-xs text-gray-500">Продано: {{ group.total_quantity }} шт</p>
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <p class="text-lg font-semibold text-brand-dark" title="Прибыль">
                              {{ formatCurrency(group.total_profit ?? 0) }}
                            </p>
                          </div>
                        </div>
                        <div class="mt-4 h-2 w-full rounded-full bg-gray-100">
                          <div
                            class="h-full rounded-full bg-gradient-to-r from-brand-dark via-red-500 to-brand-primary"
                            :style="{ width: `${Math.min(100, Math.max(0, topGroupsMaxValue ? ((Number(topGroupsSort === 'quantity' ? group.total_quantity : group.total_profit) || 0) / topGroupsMaxValue) * 100 : 0))}%` }"
                          ></div>
                        </div>
                      </div>

                      <button
                        v-if="topGroupsHasMore || topGroupsExpanded"
                        type="button"
                        class="w-full rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-brand-dark transition hover:border-brand-primary hover:bg-brand-primary/5"
                        :aria-expanded="topGroupsExpanded"
                        @click="topGroupsExpanded = !topGroupsExpanded"
                      >
                        {{ topGroupsExpanded ? 'Свернуть до топ-5' : 'Показать весь список' }}
                      </button>
                    </div>
                    <div v-else class="mt-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500">
                      {{ topGroupsSearch ? 'Ничего не найдено по этому запросу.' : 'Нет данных по продажам за выбранный период.' }}
                    </div>
                  </div>

                  <div class="space-y-6">
                    <div class="card-base relative overflow-hidden rounded-3xl border border-red-100/60 bg-white p-6 shadow-lg">
                      <div class="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                        <span class="rounded-xl bg-brand-primary/20 p-2 text-brand-dark">
                          <ClipboardDocumentCheckIcon class="h-6 w-6" />
                        </span>
                        <div>
                          <h3 class="text-lg font-semibold text-gray-900">Статусы заказов</h3>
                          <p class="text-sm text-gray-500">Баланс процессов от новых до доставленных заказов</p>
                        </div>
                      </div>
                      <div v-if="overviewStatuses.length" class="space-y-4">
                        <div v-for="status in overviewStatuses" :key="status.status" class="space-y-2">
                          <div class="flex w-full flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
                            <span>{{ status.label }}</span>
                            <span class="font-semibold text-gray-900">{{ status.count }}</span>
                          </div>
                          <div class="h-1.5 w-full rounded-full bg-gray-100">
                            <div
                              class="h-full rounded-full bg-gradient-to-r from-brand-dark via-red-500 to-brand-primary"
                          :style="{ width: `${status.count ? Math.min(100, Math.max(4, overviewStatusTotal ? (status.count / overviewStatusTotal) * 100 : 0)) : 0}%` }"
                            ></div>
                          </div>
                        </div>
                      </div>
                      <div v-else class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500">
                        Нет данных о статусах заказов.
                      </div>
                    </div>

                    <div class="card-base relative overflow-hidden rounded-3xl border border-red-100/60 bg-white p-6 shadow-lg">
                      <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                        <span class="rounded-xl bg-brand-primary/20 p-2 text-brand-dark">
                          <TruckIcon class="h-6 w-6" />
                        </span>
                        <div>
                          <h3 class="text-lg font-semibold text-gray-900">Логистика и доставка</h3>
                          <p class="text-sm text-gray-500">Как быстро и эффективно вы доставляете заказы</p>
                        </div>
                      </div>
                      <div class="mt-6 space-y-4">
                        <div>
                          <p class="text-xs uppercase tracking-[0.3em] text-gray-500">Доставок</p>
                          <p class="mt-2 text-3xl font-semibold text-brand-dark">{{ overviewDeliveries.deliveries }}</p>
                        </div>
                        <div class="rounded-2xl bg-brand-primary/10 px-4 py-3 text-center text-sm text-brand-dark sm:text-left">
                          Прибыль с доставок: <strong>{{ formatCurrency(overviewDeliveries.profit) }}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

              </div>
              <div v-else key="empty" class="rounded-3xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
                Нет данных для выбранного периода.
              </div>
            </Transition>

          </div>

          </template>
          <template v-else-if="activeTab === 'banners'">
            <div class="space-y-6">
              <AdminBannersList
                :banners="adminStore.banners"
                :isLoading="adminStore.isLoading"
                @create="handleCreateBanner"
                @edit="handleEditBanner"
                @delete="handleDeleteBanner"
                @batchDelete="handleBatchDeleteBanners"
                @batchToggle="handleBatchToggleBannerStatus"
                @reorder="handleReorderBanners"
                @toggleStatus="handleToggleBannerStatus"
              />
            </div>
          </template>

          <template v-else-if="activeTab === 'categories'">
            <div v-if="!profitUnlocked" class="flex justify-center py-12">
              <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow">
                <h3 class="text-lg font-semibold text-gray-900 text-center mb-3">Введите код доступа</h3>
                <form class="space-y-4" @submit.prevent="handleProfitUnlocked">
                  <input
                    v-model="profitPassword"
                    type="password"
                    autocomplete="current-password"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-dark/20"
                    placeholder="Пароль"
                  />
                  <p v-if="profitError" class="text-sm text-red-600">{{ profitError }}</p>
                  <button
                    type="submit"
                    class="w-full rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark/90 disabled:cursor-not-allowed disabled:bg-brand-dark/60"
                    :disabled="verifyingProfit"
                  >
                    {{ verifyingProfit ? 'Проверяем…' : 'Войти' }}
                  </button>
                </form>
              </div>
            </div>
            <div v-else class="space-y-6">
              <IncompleteGroupsPanel @open-group="handleOpenIncompleteGroup" />
              <AdminCategoriesList
                :categories="adminStore.categories"
                :isLoading="adminStore.isLoading"
                :group-counts="groupCounts"
                :cross-sell-counts="crossSellCounts"
                @create="handleCreateCategory"
                @edit="handleEditCategory"
                @delete="handleDeleteCategory"
                @reorder="handleReorderCategories"
                @manage-wholesale-links="openWholesaleLinksModal"
                @manage-groups="handleManageGroups"
                @manage-cross-sell="handleManageCrossSell"
              />
            </div>
          </template>

          <template v-else-if="activeTab === 'products'">
            <div v-if="!profitUnlocked" class="flex justify-center py-12">
              <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow">
                <h3 class="text-lg font-semibold text-gray-900 text-center mb-3">Введите код доступа</h3>
                <form class="space-y-4" @submit.prevent="handleProfitUnlocked">
                  <input
                    v-model="profitPassword"
                    type="password"
                    autocomplete="current-password"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-dark/20"
                    placeholder="Пароль"
                  />
                  <p v-if="profitError" class="text-sm text-red-600">{{ profitError }}</p>
                  <button
                    type="submit"
                    class="w-full rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark/90 disabled:cursor-not-allowed disabled:bg-brand-dark/60"
                    :disabled="verifyingProfit"
                  >
                    {{ verifyingProfit ? 'Проверяем…' : 'Войти' }}
                  </button>
                </form>
              </div>
            </div>
            <div v-else class="space-y-6">
              <AdminProductsTable
                :products="adminProductsForTable"
                :categories="adminStore.categories || []"
                :pagination="adminStore.productsPagination"
                :isLoading="adminStore.isLoading"
                :location="adminStore.productsLocation"
                :availableGroups="adminStore.availableProductGroups"
                @create="handleCreateProduct"
                @edit="handleEditProduct"
                @discount="openProductDiscount"
                @delete="handleDeleteProduct"
                @changePage="handleProductsPageChange"
                @changePageSize="handleProductsPageSizeChange"
                @filters="handleProductsFilters"
                @batchDelete="handleBatchDeleteProducts"
                @batchChangeCategory="handleBatchChangeProductCategory"
                @batchChangeGroup="handleBatchChangeProductGroup"
                @createCategory="handleCreateCategoryFromProducts"
                @createGroup="handleCreateGroupFromProducts"
                @transfer="openStockTransfer"
                @changeLocation="handleProductsLocationChange"
              />
            </div>
          </template>

          <!-- Settings -->
          <template v-else-if="activeTab === 'settings'">
            <div class="space-y-6">
              <AdminSectionHero
                title="Настройки"
                :description="currentTabDescription"
                :icon="Cog6ToothIcon"
                tone="slate"
              />

              <div class="mx-auto w-full max-w-7xl space-y-6">
                <div class="grid gap-6 lg:grid-cols-2">
                <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div class="space-y-1">
                    <h3 class="text-lg font-semibold text-gray-900">Смена пароля администратора</h3>
                    <p class="text-sm text-gray-600">Для обновления пароля введите старый и подтвердите новый.</p>
                  </div>

                  <form @submit.prevent="handlePasswordChange" class="mt-6 space-y-4">
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">Текущий пароль</label>
                      <input
                        v-model="passwordForm.currentPassword"
                        type="password"
                        required
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                    </div>
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">Новый пароль</label>
                      <input
                        v-model="passwordForm.newPassword"
                        type="password"
                        required
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                    </div>
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">Подтверждение</label>
                      <input
                        v-model="passwordForm.confirmPassword"
                        type="password"
                        required
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                    </div>
                    <button
                      type="submit"
                      :disabled="adminStore.isLoading"
                      class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-slate-800 hover:via-slate-700 hover:to-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {{ adminStore.isLoading ? 'Изменяем пароль...' : 'Обновить пароль' }}
                    </button>
                  </form>
                </section>

                <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div class="space-y-1">
                    <h3 class="text-lg font-semibold text-gray-900">Лицензионный ключ</h3>
                  </div>

                  <form @submit.prevent="handleProfitPasswordUpdate" class="mt-6 space-y-4">
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">Текущий ключ</label>
                      <input
                        v-model="profitPasswordForm.current"
                        type="password"
                        required
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                    </div>
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">Новый ключ</label>
                      <input
                        v-model="profitPasswordForm.next"
                        type="password"
                        required
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                    </div>
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">Подтверждение</label>
                      <input
                        v-model="profitPasswordForm.confirm"
                        type="password"
                        required
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                    </div>
                    <p
                      v-if="profitPasswordErrorMessage"
                      class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                    >
                      {{ profitPasswordErrorMessage }}
                    </p>
                    <p
                      v-else-if="profitPasswordSuccessMessage"
                      class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"
                    >
                      {{ profitPasswordSuccessMessage }}
                    </p>
                    <button
                      type="submit"
                      class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-slate-800 hover:via-slate-700 hover:to-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="profitPasswordSaving"
                    >
                      {{ profitPasswordSaving ? 'Сохраняем...' : 'Обновить ключ' }}
                    </button>
                  </form>
                </section>
              </div>

              <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div class="space-y-1">
                  <h3 class="text-lg font-semibold text-gray-900">Настройки менеджера</h3>
                </div>

                <form @submit.prevent="handleManagerSettingsUpdate" class="mt-6 space-y-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium text-gray-700">
                      Telegram username (без @)
                      <span class="mt-1 block text-xs font-normal text-gray-500">Используется для переадресации покупателей при оформлении заказов</span>
                    </label>
                    <input
                      v-model="managerForm.telegram"
                      type="text"
                      required
                      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      :placeholder="adminStore.settings.manager_telegram || 'Rez0nsky'"
                    />
                  </div>

                  <button
                    type="submit"
                    :disabled="adminStore.isLoading"
                    class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-slate-800 hover:via-slate-700 hover:to-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {{ adminStore.isLoading ? 'Сохранение...' : 'Сохранить настройки' }}
                  </button>
                </form>
              </section>

              <!-- Настройки доставки (раздел свёрнут — почти не используется) -->
              <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm col-span-full">
                <details class="group">
                  <summary class="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg p-1 -m-1 hover:bg-gray-50">
                    <div class="space-y-1">
                      <h3 class="text-lg font-semibold text-gray-900">Настройки доставки</h3>
                      <p class="text-sm text-gray-500">Минимальная сумма заказа, баннеры и редирект в Telegram. Раздел старый, оставлен на случай если понадобится.</p>
                    </div>
                    <span
                      class="mt-1 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center text-gray-400 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    >
                      <svg class="h-4 w-4" viewBox="0 0 12 12" fill="none">
                        <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                  </summary>

                <form @submit.prevent="handleDeliverySettingsUpdate" class="mt-6 space-y-6">
                  <!-- Минимальная сумма для доставки -->
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">
                        Минимальная сумма для доставки (BYN)
                        <span class="mt-1 block text-xs font-normal text-gray-500">Если сумма заказа меньше - доставка недоступна</span>
                      </label>
                      <input
                        v-model="deliverySettingsForm.min_delivery_amount"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        placeholder="45"
                      />
                    </div>

                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">
                        Telegram для редиректа после заказа (без @)
                        <span class="mt-1 block text-xs font-normal text-gray-500">Покупатель будет перенаправлен сюда после оформления</span>
                      </label>
                      <input
                        v-model="deliverySettingsForm.order_redirect_telegram"
                        type="text"
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        placeholder="Rez0nsky"
                      />
                    </div>
                  </div>

                  <!-- Шаблон текста для редиректа -->
                  <div class="space-y-2">
                    <label class="text-sm font-medium text-gray-700">
                      Шаблон текста сообщения
                      <span class="mt-1 block text-xs font-normal text-gray-500">Используйте {order_number} для подстановки номера заказа</span>
                    </label>
                    <input
                      v-model="deliverySettingsForm.order_redirect_text_template"
                      type="text"
                      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      placeholder="Здравствуйте, хочу уточнить по покупке"
                    />
                  </div>

                  <!-- Баннер минимальной суммы -->
                  <div class="border-t border-gray-200 pt-6">
                    <h4 class="text-sm font-semibold text-gray-900 mb-4">Баннер минимальной суммы</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div class="space-y-2">
                        <label class="text-sm font-medium text-gray-700">
                          Картинка баннера
                          <span class="mt-1 block text-xs font-normal text-gray-500">Рекомендуемый размер: 640×400 px (соотношение 16:10)</span>
                        </label>
                        <div class="flex items-center gap-3">
                          <div v-if="deliverySettingsForm.min_delivery_banner_image" class="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                            <img :src="deliverySettingsForm.min_delivery_banner_image" class="w-full h-full object-cover" />
                            <button
                              type="button"
                              @click="deliverySettingsForm.min_delivery_banner_image = ''"
                              class="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                            >
                              &times;
                            </button>
                          </div>
                          <label class="cursor-pointer inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                            <input type="file" accept="image/*" class="hidden" @change="uploadDeliveryBannerImage" />
                            {{ deliverySettingsForm.min_delivery_banner_image ? 'Заменить' : 'Загрузить' }}
                          </label>
                        </div>
                      </div>

                      <div class="space-y-4">
                        <div class="space-y-2">
                          <label class="text-sm font-medium text-gray-700">Текст кнопки</label>
                          <input
                            v-model="deliverySettingsForm.min_delivery_banner_button_text"
                            type="text"
                            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                            placeholder="Понятно"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="text-sm font-medium text-gray-700">Цвет кнопки</label>
                          <div class="flex items-center gap-2">
                            <input
                              v-model="deliverySettingsForm.min_delivery_banner_button_color"
                              type="color"
                              class="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer"
                            />
                            <input
                              v-model="deliverySettingsForm.min_delivery_banner_button_color"
                              type="text"
                              class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                              placeholder="#FFD700"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Баннер условий доставки (fullscreen) -->
                  <div class="border-t border-gray-200 pt-6">
                    <h4 class="text-sm font-semibold text-gray-900 mb-4">Баннер условий доставки (полноэкранный)</h4>
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-gray-700">
                        Картинка условий доставки
                        <span class="mt-1 block text-xs font-normal text-gray-500">Показывается после выбора доставки (если сумма достаточна)</span>
                        <span class="mt-1 block text-xs font-normal text-gray-500">Рекомендуемый размер: 720×1280 px (соотношение 9:16, вертикальный для Telegram)</span>
                      </label>
                      <div class="flex items-center gap-3">
                        <div v-if="deliverySettingsForm.delivery_conditions_image" class="relative w-32 h-20 rounded-lg overflow-hidden border border-gray-200">
                          <img :src="deliverySettingsForm.delivery_conditions_image" class="w-full h-full object-cover" />
                          <button
                            type="button"
                            @click="deliverySettingsForm.delivery_conditions_image = ''"
                            class="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                          >
                            &times;
                          </button>
                        </div>
                        <label class="cursor-pointer inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                          <input type="file" accept="image/*" class="hidden" @change="uploadDeliveryConditionsImage" />
                          {{ deliverySettingsForm.delivery_conditions_image ? 'Заменить' : 'Загрузить' }}
                        </label>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    :disabled="deliverySettingsSaving"
                    class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-slate-800 hover:via-slate-700 hover:to-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {{ deliverySettingsSaving ? 'Сохранение...' : 'Сохранить настройки доставки' }}
                  </button>
                </form>
                </details>
              </section>

              <AdminAgreementsSection />
              <AdminBotSection />
            </div>
          </div>
          </template>
          </template>
        </template>
      </AdminLayout>

    <!-- Banner Modal - УЛУЧШЕННОЕ -->
    <AdminModal 
      :isOpen="showBannerModal" 
      :title="modalTitle" 
      size="lg"
      :showActions="false"
      @cancel="showBannerModal = false" 
      @close="showBannerModal = false"
    >
      <AdminBannerForm :banner="editingBanner" @submit="handleBannerFormSubmit" @cancel="showBannerModal = false" />
    </AdminModal>

    <!-- Category Modal - УЛУЧШЕННОЕ -->
    <AdminModal 
      :isOpen="showCategoryModal" 
      :title="modalTitle" 
      size="md"
      :showActions="false"
      @cancel="showCategoryModal = false" 
      @close="showCategoryModal = false"
    >
      <AdminCategoryForm :category="editingCategory" @submit="handleCategoryFormSubmit" @cancel="showCategoryModal = false" />
    </AdminModal>

    <!-- Product Modal - УЛУЧШЕННОЕ -->
    <AdminModal 
      :isOpen="showProductModal" 
      :title="modalTitle" 
      size="xl"
      :showActions="false"
      @cancel="showProductModal = false" 
      @close="showProductModal = false"
    >
      <AdminProductForm :product="editingProduct" :categories="adminStore.categories" @submit="handleProductFormSubmit" @cancel="showProductModal = false" />
</AdminModal>

    <AdminStockTransferModal
      :isOpen="showStockTransferModal"
      :initialSource="stockTransferInitialSource"
      @close="showStockTransferModal = false"
      @saved="handleStockTransferSaved"
      @completed="handleStockTransferCompleted"
      @cancelled="handleStockTransferCancelled"
    />

    <!-- Category Groups Modal -->
    <AdminModal
      v-if="showGroupModal && !showWholesaleLinksModal && !minStockEditorOpen"
      ref="groupModalRef"
      :isOpen="true"
      :title="activeGroupCategory ? `Линейки: ${activeGroupCategory.name}` : 'Линейки'"
      size="lg"
      :showActions="false"
      @cancel="closeGroupModal"
      @close="closeGroupModal"
    >
      <div v-if="activeGroupCategory">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <p class="text-sm text-gray-600">Категория</p>
            <p class="text-lg font-semibold text-gray-900">{{ activeGroupCategory.name }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
              @click="openWholesaleLinksModal"
            >
              Оптовые ссылки
            </button>
            <button
              class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-brand-dark text-white hover:bg-brand-dark/90 transition-colors"
              @click="openGroupForm(undefined, activeGroupCategory)"
            >
              <PlusIcon class="w-4 h-4" />
              Добавить линейку
            </button>
          </div>
        </div>

        <p v-if="groupModalLoading" class="text-xs text-gray-500 mb-3">Синхронизация…</p>

        <div v-if="editableGroups.length" class="space-y-3">
          <div
            v-for="(group, index) in editableGroups"
            :key="group.id"
            class="border rounded-lg p-4 shadow-sm"
            :class="(group.totalStockSum ?? group.stockSum ?? 0) === 0 ? 'border-gray-300 bg-gray-100 opacity-70' : 'border-gray-200 bg-white'"
          >
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-3">
            <div class="flex items-start gap-3" :style="{ paddingLeft: `${(group.depth ?? 0) * 16}px` }">
                <span v-if="group.parentId" class="text-gray-300 text-lg leading-none mt-1">-</span>
                <div :class="[
                  'rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-200',
                  group.parentId ? 'w-8 h-8' : 'w-12 h-12'
                ]">
                  <img v-if="group.coverImage" :src="group.coverImage" class="w-full h-full object-cover" alt="" />
                  <div v-else class="w-full h-full flex items-center justify-center text-gray-400">
                    <PhotoIcon :class="group.parentId ? 'w-4 h-4' : 'w-5 h-5'" />
                  </div>
                </div>
                <div class="space-y-1">
                <p :class="[
                  (group.totalStockSum ?? group.stockSum ?? 0) === 0 ? 'text-gray-500' : 'text-gray-900',
                  group.parentId ? 'text-sm font-medium' : 'text-lg font-bold'
                ]">
                  {{ group.name }}
                  <span v-if="!group.parentId && adminStore.categoryGroups.some(g => g.parentId === group.id)" class="ml-1 text-xs font-normal text-gray-400">главная</span>
                </p>
                <div v-if="group.hideEmpty" class="mt-2">
                  <span class="inline-flex items-center gap-1 text-xs text-orange-600">
                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-5.25h1.5v1.5h-1.5v-1.5zm0-6h1.5v4.5h-1.5v-4.5z"/></svg>
                    Скрывать пустую
                  </span>
                </div>
                <div v-if="(group.totalStockSum ?? group.stockSum ?? 0) === 0" class="mt-2">
                  <span class="inline-flex items-center gap-1 text-xs text-gray-500">
                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                    Нет в наличии, не отображается на витрине{{ group.emptySince ? ` уже ${getDaysEmpty(group.emptySince)} дн.` : '' }}
                  </span>
                </div>
                <div class="mt-2 rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2">
                  <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Оптовые цены</p>
                      <p class="text-xs text-gray-500">
                        Заполнено {{ getFilledWholesaleCount(group) }} из {{ getGroupWholesaleTiers(group).length || 0 }}
                      </p>
                    </div>
                    <p class="text-xs text-gray-500 whitespace-nowrap">
                      Себестоимость:
                      <strong class="ml-1 text-gray-900">{{ formatWholesalePrice(group.averageCostAuto, true) }}</strong>
                    </p>
                  </div>

                  <div class="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <div
                      v-for="tier in getGroupWholesaleTiers(group)"
                      :key="`${group.id}-${tier.code}`"
                      class="rounded-md border px-2 py-1.5"
                      :class="group.wholesalePrices?.[tier.code] ? 'border-emerald-200 bg-emerald-50/70' : 'border-gray-200 bg-white'"
                    >
                      <p class="text-[11px] font-semibold leading-none text-gray-500">{{ tier.code }}+</p>
                      <p
                        class="mt-1 text-xs font-semibold leading-none"
                        :class="group.wholesalePrices?.[tier.code] ? 'text-emerald-700' : 'text-gray-400'"
                      >{{ formatWholesaleCompact(group.wholesalePrices?.[tier.code] ?? null) }}</p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  class="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                  :class="minStockBadgeClasses(group)"
                  :disabled="groupModalLoading"
                  :title="minStockBadgeTitle(group)"
                  @click="openMinStockEditor(group)"
                >
                  <svg class="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 6h8M6 2v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                  {{ minStockBadgeLabel(group) }}
                </button>
              </div>
              </div>
              <div class="flex flex-col gap-2 sm:items-end">
                <div class="flex items-center justify-center sm:justify-end gap-1 flex-wrap">
                  <button
                    class="p-1 rounded-md border border-gray-200 hover:bg-gray-100 disabled:opacity-40"
                    :disabled="index === 0 || groupModalLoading"
                    @click="moveGroupUp(index)"
                  >
                    <ChevronUpIcon class="w-4 h-4" />
                  </button>
                  <button
                    class="p-1 rounded-md border border-gray-200 hover:bg-gray-100 disabled:opacity-40"
                    :disabled="index === editableGroups.length - 1 || groupModalLoading"
                    @click="moveGroupDown(index)"
                  >
                    <ChevronDownIcon class="w-4 h-4" />
                  </button>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md"
                    :disabled="groupModalLoading"
                    @click="openGroupForm(group, activeGroupCategory)"
                  >
                    <PencilSquareIcon class="w-4 h-4" />
                    Редактировать
                  </button>
                  <button
                    class="admin-link-button admin-link-button--danger"
                    :disabled="groupModalLoading"
                    @click="deleteGroup(group)"
                  >
                    <TrashIcon class="w-4 h-4" />
                    Удалить
                  </button>
                </div>
                </div>
              </div>
            </div>
        </div>
        <p v-else class="text-sm text-gray-500">Линеек пока нет. Создайте первую.</p>
      </div>
    </AdminModal>

    <!-- Пока открыт быстрый редактор, окно линеек размонтировано: иначе его
         ловушка фокуса перехватывает ввод в Teleport-окне. -->
    <AdminGroupMinStockEditor
      v-if="minStockEditorOpen && minStockEditorGroup"
      :key="minStockEditorGroup.id"
      :is-open="true"
      :group-name="minStockEditorGroup?.name || ''"
      :current-threshold="minStockEditorGroup?.minStockThreshold ?? null"
      :current-stock="Number(minStockEditorGroup?.totalStockSum ?? minStockEditorGroup?.stockSum ?? 0)"
      :busy="minStockEditorBusy"
      :error-text="minStockEditorError"
      @close="closeMinStockEditor"
      @apply="applyMinStockThreshold"
    />

    <!-- Category Group Form Modal -->
    <AdminModal
      v-if="showGroupFormModal"
      :isOpen="true"
      :title="editingGroup ? 'Редактировать линейку' : 'Добавить линейку'"
      size="md"
      :showActions="false"
      @cancel="closeGroupForm"
      @close="closeGroupForm"
    >
      <AdminCategoryGroupForm
        :editing-group="editingGroup || undefined"
        :is-submitting="groupFormSubmitting"
        :available-groups="groupFormOptions"
        :wholesale-tiers="resolvedWholesaleTiers"
        :show-strength-tier="activeGroupCategory?.storefrontFiltersProfile === 'liquids' || activeGroupCategory?.storefront_filters_profile === 'liquids'"
        @submit="handleGroupFormSubmit"
        @cancel="closeGroupForm"
      />
    </AdminModal>

    <ProductDiscountModal
      :is-open="showProductDiscountModal"
      :product="discountProduct"
      @close="showProductDiscountModal = false"
      @saved="reloadProductsAfterDiscount"
    />

    <AdminModal
      v-if="showWholesaleLinksModal"
      :isOpen="true"
      title="Оптовые ссылки"
      size="lg"
      :showActions="false"
      @cancel="closeWholesaleLinksModal"
      @close="closeWholesaleLinksModal"
    >
      <AdminWholesaleLinksPanel
        :links="adminStore.wholesaleLinks"
        :is-loading="wholesaleLinksLoading"
      />
    </AdminModal>

    <!-- Cross-sell Modal -->
    <AdminModal
      :isOpen="showCrossSellModal"
      :title="activeCrossSellCategory ? `Cross-sell: ${activeCrossSellCategory.name}` : 'Cross-sell'"
      size="lg"
      :showActions="false"
      @cancel="closeCrossSellModal"
      @close="closeCrossSellModal"
    >
      <div v-if="activeCrossSellCategory">
        <div class="flex flex-col gap-3 mb-4">
          <div class="flex items-center justify-between">
            <p class="text-sm text-gray-600">Выбрано: <strong>{{ crossSellSelection.length }}</strong></p>
            <button
              class="px-4 py-2 text-sm font-semibold rounded-lg bg-brand-dark text-white hover:bg-brand-dark/90 disabled:opacity-50 flex-shrink-0"
              :disabled="crossSellSubmitting"
              @click="saveCrossSell"
            >
              {{ crossSellSubmitting ? 'Сохранение...' : 'Сохранить' }}
            </button>
          </div>
        </div>

        <!-- Уже добавленные товары -->
        <div v-if="selectedCrossSellProducts.length" class="mb-4">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Добавлены в "Вдруг пригодится?"</p>
          <div class="space-y-2">
            <div
              v-for="product in selectedCrossSellProducts"
              :key="'selected-' + product.id"
              class="flex items-center justify-between gap-3 border border-green-200 bg-green-50 rounded-lg px-3 py-2"
            >
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <svg class="w-4 h-4 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
                <p class="text-sm font-semibold text-gray-900 truncate flex-1">{{ product.title || 'Без названия' }}</p>
              </div>
              <button
                type="button"
                class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                title="Убрать из cross-sell"
                @click="crossSellSelection = crossSellSelection.filter(id => id !== product.id)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Разделитель -->
        <div v-if="selectedCrossSellProducts.length && availableCrossSellProducts.length" class="border-t border-gray-200 my-4"></div>

        <!-- Поиск и добавление новых товаров -->
        <div>
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Добавить товары</p>
          <input
            v-model="crossSellSearch"
            type="text"
            placeholder="Поиск по названию"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-1 focus:ring-brand-dark/40 focus:border-brand-dark/40 text-sm mb-3"
          />
        </div>

        <div v-if="availableCrossSellProducts.length" class="space-y-2 max-h-64 overflow-y-auto">
          <label
            v-for="product in availableCrossSellProducts"
            :key="product.id"
            class="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 cursor-pointer"
          >
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <input
                type="checkbox"
                class="w-4 h-4 text-brand-dark border-gray-300 rounded flex-shrink-0 cursor-pointer"
                :value="product.id"
                v-model="crossSellSelection"
              />
              <p class="text-sm font-semibold text-gray-900 truncate flex-1">{{ product.title || 'Без названия' }}</p>
            </div>
          </label>
        </div>
        <div v-else-if="crossSellSearch && !availableCrossSellProducts.length" class="py-4 text-center text-sm text-gray-500">
          Товары не найдены
        </div>
        <div v-else-if="!selectedCrossSellProducts.length && !availableCrossSellProducts.length" class="py-8 text-center text-sm text-gray-500">
          Нет товаров для добавления
        </div>
      </div>
    </AdminModal>

    <!-- Global Toast for Admin actions -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="toast.visible"
        :class="[
          'fixed bottom-4 left-1/2 transform -translate-x-1/2 px-5 py-4 rounded-lg shadow-2xl z-[10000] text-base font-semibold text-white border-2 border-white/20 max-w-sm mx-auto text-center',
          toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'
        ]"
      >
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, reactive, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ChevronUpIcon, ChevronDownIcon, PencilSquareIcon, TrashIcon, PlusIcon, ArrowTrendingUpIcon, CurrencyDollarIcon, ChartBarIcon, BoltIcon, TruckIcon, ClipboardDocumentCheckIcon, SparklesIcon, LockOpenIcon, Cog6ToothIcon, PhotoIcon } from '@heroicons/vue/24/outline'
import { useAdminStore, type Category, type CategoryGroup, type Product } from '@/stores/admin'
import { useCrmStore } from '@/stores/crm'
import { formatChartValueCompact } from '@/utils/chartValue'
import AdminBannersList from '@/components/admin/AdminBannersList.vue'
import AdminCategoriesList from '@/components/admin/AdminCategoriesList.vue'
import AdminModal from '@/components/AdminModal.vue'
import AdminBannerForm from '@/components/admin/AdminBannerForm.vue'
import AdminCategoryForm from '@/components/admin/AdminCategoryForm.vue'
import AdminProductForm from '@/components/admin/AdminProductForm.vue'
import AdminLayout from '@/components/admin/layout/AdminLayout.vue'
import AdminSectionHero from '@/components/admin/layout/AdminSectionHero.vue'
import AdminProductsTable from '@/components/admin/AdminProductsTable.vue'
import AdminStockTransferModal from '@/components/admin/AdminStockTransferModal.vue'
import AdminCategoryGroupForm from '@/components/admin/AdminCategoryGroupForm.vue'
import AdminGroupMinStockEditor from '@/components/admin/AdminGroupMinStockEditor.vue'
import ProductDiscountModal from '@/components/admin/ProductDiscountModal.vue'
import AdminWholesaleLinksPanel from '@/components/admin/AdminWholesaleLinksPanel.vue'
import IncompleteGroupsPanel from '@/components/admin/IncompleteGroupsPanel.vue'
import AdminAgreementsSection from '@/components/admin/AdminAgreementsSection.vue'
import AdminBotSection from '@/components/admin/AdminBotSection.vue'
import CashierLockScreen from '@/components/admin/CashierLockScreen.vue'
import CountUp from '@/components/CountUp.vue'
import CountUpCurrency from '@/components/CountUpCurrency.vue'
import { adminTabs, crmLinks, adminTabOptions, type AdminTabId } from '@/constants/adminNavigation'
import { formatBusinessDate, formatBusinessPeriodLabel, formatBusinessPeriodTitle, getBusinessYear } from '@/utils/businessTime'

const router = useRouter()
const route = useRoute()
const adminStore = useAdminStore()
const crmStore = useCrmStore()
const { dashboardStats, loadingDashboard, profitUnlocked, verifyingProfitAccess, dashboardTimeseries, loadingTimeseries, dashboardToken, dashboardLocked } = storeToRefs(crmStore)

// Раздел «Обзор» закрыт отдельно: с 10:00 до 16:00 по Минску обычный ключ CRM
// сюда не пускает, нужен пароль владельца. В остальное время всё как раньше.
const dashboardReady = computed(
  () => profitUnlocked.value && (!dashboardLocked.value || Boolean(dashboardToken.value)),
)
const isCrmRoute = computed(() => route.path.startsWith('/admin/crm'))

// Lock screen state
const LOCK_STATE_KEY = 'admin_panel_locked'
const isLocked = ref(false)

const overviewPeriods = [
  { value: 'today', label: 'за день' },
  { value: 'month', label: 'за месяц' },
  { value: 'year', label: 'за год' },
  { value: 'custom', label: 'произвольный' }
] as const
type OverviewPeriod = typeof overviewPeriods[number]['value']
const overviewPeriod = ref<OverviewPeriod>('year')
const selectedMetric = ref<'revenue' | 'profit' | 'orders'>('profit')
const overviewOffset = ref(0)
// Произвольный диапазон (используется когда overviewPeriod === 'custom')
const customRangeFrom = ref<string>('')
const customRangeTo = ref<string>('')
// Параметры блока «Топ линеек»
const topGroupsSort = ref<'profit' | 'quantity'>('profit')
const topGroupsSearch = ref<string>('')
const topGroupsSearchDebounced = ref<string>('') // что реально уходит в backend
const topGroupsExpanded = ref<boolean>(false)
const TOP_GROUPS_DEFAULT_LIMIT = 5
const TOP_GROUPS_EXPANDED_LIMIT = 1000
const activeOverviewLabel = computed(() => overviewPeriods.find(option => option.value === overviewPeriod.value)?.label || '')
const isCustomRangeReady = computed(() => Boolean(customRangeFrom.value && customRangeTo.value))

// Debounce ввода поиска по топ-линейкам — чтобы не дёргать backend на каждый символ
let topGroupsSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(topGroupsSearch, (value) => {
  if (topGroupsSearchDebounceTimer !== null) {
    clearTimeout(topGroupsSearchDebounceTimer)
  }
  topGroupsSearchDebounceTimer = setTimeout(() => {
    topGroupsSearchDebounced.value = value
  }, 300)
})

// Сброс expanded при смене периода — иначе после прыжка из expanded year в month
// получаем неконсистентное «1000 строк за этот месяц» (которых там может не быть)
watch(overviewPeriod, () => {
  topGroupsExpanded.value = false
})

// Текущее состояние UI блока топ-линеек (используется во ВСЕХ вызовах fetchDashboard,
// чтобы не было рассинхронизации, когда дашборд перезагружается из побочных мест)
function currentDashboardOptions() {
  return {
    from: overviewPeriod.value === 'custom' ? customRangeFrom.value : undefined,
    to: overviewPeriod.value === 'custom' ? customRangeTo.value : undefined,
    topSort: topGroupsSort.value,
    topLimit: topGroupsExpanded.value ? TOP_GROUPS_EXPANDED_LIMIT : TOP_GROUPS_DEFAULT_LIMIT,
    topSearch: topGroupsSearchDebounced.value || undefined,
  } as const
}

// Вычисляемый год на основе offset (для периода 'year')
const currentYearForView = computed(() => {
  return getBusinessYear(new Date(), overviewPeriod.value === 'year' ? overviewOffset.value : 0)
})

const isAtCurrentOverview = computed(() => overviewOffset.value >= 0)
const overviewRangeLabel = computed(() => {
  return formatBusinessPeriodLabel(overviewPeriod.value, overviewOffset.value)
  const now = new Date()
  const off = overviewOffset.value
  if (overviewPeriod.value === 'today') {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() + off)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  }
  if ((overviewPeriod.value as string) === 'week') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const day = d.getUTCDay() || 7
    const monday = new Date(d.getTime() - (day - 1) * 86400000 + off * 7 * 86400000)
    const sunday = new Date(monday.getTime() + 6 * 86400000)
    return `${monday.toLocaleDateString('ru-RU')} - ${sunday.toLocaleDateString('ru-RU')}`
  }
  if (overviewPeriod.value === 'month') {
    const y = now.getUTCFullYear(); const m = now.getUTCMonth() + off
    const d = new Date(Date.UTC(y, m, 1))
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  }
  if (overviewPeriod.value === 'year') {
    const y = now.getUTCFullYear() + off
    return `${y}`
  }
  return ''
})

function prevOverviewRange() { overviewOffset.value = overviewOffset.value - 1 }
function nextOverviewRange() { if (isAtCurrentOverview.value) return; overviewOffset.value = overviewOffset.value + 1 }
const showProfitModal = ref(false)
const profitPassword = ref('')
const profitError = ref('')
const verifyingProfit = computed(() => verifyingProfitAccess.value)

type CategoryGroupNode = CategoryGroup & { children: CategoryGroupNode[] }

// Forms and modals
const showBannerModal = ref(false)
const showCategoryModal = ref(false)
const showProductModal = ref(false)
const showStockTransferModal = ref(false)
const stockTransferInitialSource = ref<'retail' | 'warehouse'>('retail')
const editingBanner = ref<any>(null)
const editingCategory = ref<any>(null)
const editingProduct = ref<any>(null)
const modalTitle = ref('')

const showGroupModal = ref(false)
const showGroupFormModal = ref(false)
const showWholesaleLinksModal = ref(false)
const groupFormSubmitting = ref(false)
const groupModalLoading = ref(false)
const wholesaleLinksLoading = ref(false)
const activeGroupCategory = ref<Category | null>(null)
const groupFormCategoryId = ref<string | null>(null)
type CategoryGroupWithDepth = CategoryGroup & { depth: number }

const editingGroup = ref<CategoryGroup | null>(null)
const editableGroups = ref<CategoryGroupWithDepth[]>([])
const groupModalRef = ref<InstanceType<typeof AdminModal> | null>(null)
const savedGroupModalScrollTop = ref(0)

// Quick-edit мин. остатка из строки линейки (без открытия большой формы).
// Хранит ссылку на CategoryGroupWithDepth (для актуального totalStockSum
// и minStockThreshold), без отдельной копии — реактивность вытащит свежий
// snapshot при каждом открытии.
const minStockEditorOpen = ref(false)
const minStockEditorGroup = ref<CategoryGroupWithDepth | null>(null)
const minStockEditorBusy = ref(false)
const minStockEditorError = ref<string | null>(null)

const showCrossSellModal = ref(false)
const crossSellSubmitting = ref(false)
const activeCrossSellCategory = ref<Category | null>(null)
const crossSellSelection = ref<string[]>([])
const crossSellSearch = ref('')
const crossSellProducts = ref<Product[]>([])

// Simple global toast state for admin actions
const toast = ref<{ visible: boolean; message: string; type: 'success' | 'error'; timer: number | null }>({
  visible: false,
  message: '',
  type: 'success',
  timer: null
})

function getDaysEmpty(emptySince: string | null | undefined): number {
  if (!emptySince) return 0
  const diff = Date.now() - new Date(emptySince).getTime()
  return Math.floor(diff / 86400000)
}

function formatWholesalePrice(value: number | null | undefined, emptyAsHint = false): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return emptyAsHint ? 'Нет данных' : 'Не задано'
  }

  return `${Number(value).toFixed(2)} BYN`
}

function formatWholesaleCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '-'
  }

  return `${Number(value).toFixed(2)} BYN`
}

function getGroupWholesaleTiers(group: CategoryGroup) {
  if (group.wholesaleTiers?.length) {
    return group.wholesaleTiers
  }

  return resolvedWholesaleTiers.value
}

function getFilledWholesaleCount(group: CategoryGroup): number {
  return getGroupWholesaleTiers(group).reduce((total, tier) => {
    const value = group.wholesalePrices?.[tier.code]
    return value !== null && value !== undefined && Number.isFinite(Number(value)) ? total + 1 : total
  }, 0)
}

function showToast(message: string, type: 'success' | 'error' = 'success', timeout = 2500) {
  // Clear previous timer if any
  if (toast.value.timer) {
    clearTimeout(toast.value.timer)
    toast.value.timer = null
  }
  toast.value.message = message
  toast.value.type = type
  toast.value.visible = true
  toast.value.timer = window.setTimeout(() => {
    toast.value.visible = false
    toast.value.message = ''
    toast.value.timer = null
  }, timeout)
}

async function openWholesaleLinksModal() {
  const scrollContainer = groupModalRef.value?.scrollContainer
  if (showGroupModal.value && scrollContainer) {
    savedGroupModalScrollTop.value = scrollContainer.scrollTop
  }
  showWholesaleLinksModal.value = true
  wholesaleLinksLoading.value = true
  try {
    await adminStore.fetchWholesaleLinks()
  } catch (error) {
    console.error('Failed to load wholesale links:', error)
    showToast('Не удалось загрузить оптовые ссылки', 'error')
  } finally {
    wholesaleLinksLoading.value = false
  }
}

function closeWholesaleLinksModal() {
  showWholesaleLinksModal.value = false
  if (!showGroupModal.value) return

  nextTick(() => {
    const scrollContainer = groupModalRef.value?.scrollContainer
    if (scrollContainer) {
      scrollContainer.scrollTop = savedGroupModalScrollTop.value
    }
  })
}

function resetLoadedState() {
  ;(Object.keys(dataLoaded) as DataSliceKey[]).forEach((key) => {
    dataLoaded[key] = false
  })
}

async function runDataLoaders(loaders: Array<{ key: DataSliceKey; loader: () => Promise<unknown> }>) {
  if (!loaders.length) {
    return true
  }

  const results = await Promise.allSettled(loaders.map((item) => item.loader()))
  let hadError = false

  results.forEach((result, index) => {
    const { key } = loaders[index]
    if (result.status === 'fulfilled') {
      dataLoaded[key] = true
    } else {
      hadError = true
      console.error(`[AdminView] Failed to load data chunk "${key}"`, result.reason)
    }
  })

  return !hadError
}

async function ensureTabData(tab: AdminTabId) {
  if (!adminStore.isAuthenticated) {
    return
  }

  // Замок «Обзора» зависит от времени, поэтому браузерным часам тут доверять
  // нельзя и состояние спрашиваем у сервера при каждом заходе.
  // Спрашиваем на любой вкладке, а не только на «Обзоре»: тем же флагом
  // profitUnlocked закрыты себестоимость в «Товарах», «Финансы», «Заказы»,
  // «Архив», «Закупки» и «Касса», и на них тоже нужно знать, спрашивает ли
  // этот магазин пароль вообще.
  await crmStore.fetchDashboardAccessState().catch(() => undefined)

  if (tab === 'dashboard') {
    if (dataLoaded.dashboard || !dashboardReady.value) {
      return
    }

    const success = await runDataLoaders([{
      key: 'dashboard',
      loader: () => crmStore.fetchDashboard(overviewPeriod.value, overviewOffset.value, currentDashboardOptions())
    }])

    if (!success) {
      showToast('Не удалось обновить показатели дашборда. Попробуйте ещё раз.', 'error', 4000)
    }
    return
  }

  const loaders: Array<{ key: DataSliceKey; loader: () => Promise<unknown> }> = []

  if (tab === 'banners' && !dataLoaded.banners) {
    loaders.push({ key: 'banners', loader: () => adminStore.fetchBanners() })
  }

  if (tab === 'categories') {
    if (!profitUnlocked.value) {
      return
    }
    if (!dataLoaded.categories) {
      loaders.push({ key: 'categories', loader: () => adminStore.fetchCategories() })
    }
    if (!dataLoaded.categoryGroups) {
      loaders.push({ key: 'categoryGroups', loader: () => adminStore.fetchCategoryGroups() })
    }
  }

  if (tab === 'products') {
    if (!profitUnlocked.value) {
      return
    }
    // Всегда обновляем данные товаров при входе в раздел, чтобы остатки были актуальными
    const page = adminStore.productsPagination?.page ?? 1
    const limit = adminStore.productsPagination?.limit ?? 10
    loaders.push({ key: 'products', loader: () => adminStore.fetchProducts({ page, limit }) })
    
    if (!dataLoaded.categories) {
      loaders.push({ key: 'categories', loader: () => adminStore.fetchCategories() })
    }
    if (!dataLoaded.categoryGroups) {
      loaders.push({ key: 'categoryGroups', loader: () => adminStore.fetchCategoryGroups() })
    }
  }

  if (tab === 'settings' && !dataLoaded.settings) {
    loaders.push({ key: 'settings', loader: () => adminStore.fetchSettings() })
  }

  const success = await runDataLoaders(loaders)
  if (tab === 'categories' && profitUnlocked.value) {
    void adminStore.fetchIncompleteGroups()
  }
  if (!success) {
    showToast('Не удалось загрузить данные раздела. Попробуйте обновить страницу.', 'error', 5000)
  }
}

async function loadInitialAdminData() {
  const loaders: Array<{ key: DataSliceKey; loader: () => Promise<unknown> }> = [
    { key: 'banners', loader: () => adminStore.fetchBanners() },
    { key: 'settings', loader: () => adminStore.fetchSettings() }
  ]

  if (profitUnlocked.value) {
    loaders.push(
      { key: 'categories', loader: () => adminStore.fetchCategories() },
      { key: 'categoryGroups', loader: () => adminStore.fetchCategoryGroups() },
      { key: 'products', loader: () => adminStore.fetchProducts({ page: 1, limit: 10 }) }
    )
    if (dashboardReady.value) {
      loaders.push({
        key: 'dashboard',
        loader: () => crmStore.fetchDashboard(overviewPeriod.value, overviewOffset.value, currentDashboardOptions())
      })
    }
  }

  const success = await runDataLoaders(loaders)
  if (!success) {
    showToast('Не удалось загрузить часть данных админки. Откройте нужный раздел повторно.', 'error', 5000)
  }
}

function buildGroupTreeForCategory(categoryId: string): CategoryGroupNode[] {
  const groups = (adminStore.categoryGroups || []).filter(group => group.categoryId === categoryId)
  const map = new Map<string, CategoryGroupNode>()

  groups.forEach(group => {
    map.set(group.id, { ...group, children: [] })
  })

  const roots: CategoryGroupNode[] = []

  map.forEach(node => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortNodes = (nodes: CategoryGroupNode[]) => {
    nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    nodes.forEach(child => sortNodes(child.children))
  }

  sortNodes(roots)
  return roots
}

function flattenGroupTree(nodes: CategoryGroupNode[], depth = 0): CategoryGroupWithDepth[] {
  const list: CategoryGroupWithDepth[] = []
  nodes.forEach(node => {
    const { children, ...rest } = node
    list.push({ ...(rest as CategoryGroup), depth })
    if (children.length) {
      list.push(...flattenGroupTree(children, depth + 1))
    }
  })
  return list
}

const resolvedWholesaleTiers = computed(() => {
  const fromGroups = adminStore.categoryGroups.find((group) => group.wholesaleTiers?.length)?.wholesaleTiers
  if (fromGroups?.length) {
    return fromGroups
  }

  return (adminStore.wholesaleLinks || []).map((link) => ({
    id: link.id,
    code: link.code,
    label: link.label,
    minOrderAmount: link.minOrderAmount,
    sortOrder: link.sortOrder,
  }))
})

const tabOptions = adminTabOptions
const currentTabDescription = computed(() =>
  adminTabs.find((option) => option.id === activeTab.value)?.description || '',
)
const adminProductsForTable = computed(() => (adminStore.products || []) as any)

type DataSliceKey = 'banners' | 'categories' | 'categoryGroups' | 'products' | 'settings' | 'dashboard'
const dataLoaded = reactive<Record<DataSliceKey, boolean>>({
  banners: false,
  categories: false,
  categoryGroups: false,
  products: false,
  settings: false,
  dashboard: false
})

const getInitialTab = (): AdminTabId => {
  const tabParam = route.query.tab as string | undefined
  if (tabParam && tabOptions.includes(tabParam as AdminTabId)) {
    return tabParam as AdminTabId
  }
  return 'dashboard'
}

const activeTab = ref<AdminTabId>(getInitialTab())
const layoutTab = computed<AdminTabId>({
  get: () => activeTab.value,
  set: (value: AdminTabId) => {
    activeTab.value = value
    const query = value === 'dashboard' ? {} : { tab: value }
    router.push({ path: '/admin', query }).catch(() => {})
  }
})

watch(activeTab, (tab) => {
  // Загружаем данные только если пользователь авторизован
  if (adminStore.isAuthenticated) {
    void ensureTabData(tab)
  }
}, { immediate: true })

const passwordForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })
const managerForm = ref({ telegram: '' })
const deliverySettingsForm = ref({
  min_delivery_amount: '0',
  min_delivery_banner_image: '',
  min_delivery_banner_button_text: 'Понятно',
  min_delivery_banner_button_color: '#FFD700',
  delivery_conditions_image: '',
  order_redirect_telegram: '',
  order_redirect_text_template: 'Здравствуйте, хочу уточнить по покупке'
})
const deliverySettingsSaving = ref(false)
const profitPasswordForm = ref<{ current: string; next: string; confirm: string }>({
  current: '',
  next: '',
  confirm: ''
})
const profitPasswordErrorMessage = ref('')
const profitPasswordSuccessMessage = ref('')
const profitPasswordSaving = ref(false)

// Computed stats from store data
const stats = computed(() => ({
  categories: adminStore.categories?.length || 0,
  products: adminStore.productsPagination?.total || 0,
  banners: adminStore.banners?.length || 0
}))

// Метрики вычисляются из детализированных данных графика
// Это гарантирует 100% синхронизацию между карточками и графиком
const overviewStats = computed(() => {
  // Для произвольного диапазона timeseries не строим (бэк его не умеет), и
  // fallback на agregated stats обязателен — иначе карточки покажут не тот период.
  if (overviewPeriod.value === 'custom') {
    return dashboardStats.value?.stats ?? null
  }
  // Приоритет: детализированные данные (timeseries)
  if (dashboardTimeseries.value && dashboardTimeseries.value.length > 0) {
    // Суммируем данные из точек графика
    const revenue = dashboardTimeseries.value.reduce((sum, point) => sum + (point.revenue ?? 0), 0)
    const profit = dashboardTimeseries.value.reduce((sum, point) => sum + (point.profit ?? 0), 0)
    const totalSales = dashboardTimeseries.value.reduce((sum, point) => sum + (point.orders ?? 0), 0)
    
    const stats = {
      revenue,
      profit,
      totalSales,
      averageCheck: totalSales > 0 ? revenue / totalSales : 0,
      uniqueCustomers: 0
    }
    
    console.log(`[Dashboard] ✅ Метрики синхронизированы с графиком:`, {
      'Точек данных': dashboardTimeseries.value.length,
      'Выручка': revenue,
      'Прибыль': profit,
      'Заказов': totalSales,
      'Пример точки': dashboardTimeseries.value[0],
      'Источник': 'Прямой расчет из timeseries API'
    })
    
    return stats
  }
  
  // Fallback: если timeseries нет, используем агрегированные данные
  console.log('[Dashboard] Fallback на dashboardStats')
  return dashboardStats.value?.stats ?? null
})

const profitMargin = computed(() => {
  const revenue = overviewStats.value?.revenue ?? 0
  const profit = overviewStats.value?.profit ?? 0
  if (!revenue) return null
  const percentage = (profit / revenue) * 100
  const precision = percentage % 1 === 0 ? 0 : 1
  return percentage.toFixed(precision)
})
const overviewDeliveries = computed(() => ({
  deliveries: dashboardStats.value?.deliveryStats?.deliveries ?? 0,
  profit: dashboardStats.value?.deliveryStats?.profit ?? 0
}))
const overviewStatuses = computed(() => {
  const mapping: Record<string, string> = {
    new: 'Новые',
    in_progress: 'В работе',
    completed: 'Завершены',
    delivered: 'Выданы',
    cancelled: 'Отменены'
  }
  const baseCounts: Record<string, number> = {
    new: 0,
    in_progress: 0,
    completed: 0,
    delivered: 0,
    cancelled: 0
  }
  for (const item of dashboardStats.value?.ordersByStatus ?? []) {
    if (item && typeof baseCounts[item.status] === 'number') {
      baseCounts[item.status] = item.count
    }
  }
  return Object.entries(baseCounts).map(([status, count]) => ({
    status,
    count,
    label: mapping[status] ?? status
  }))
})
const topGroups = computed(() => {
  // Backend уже возвращает нужное количество с учётом топ-limit, сортировки и поиска.
  return dashboardStats.value?.topProducts ?? []
})

// Бэкенд возвращает honest флаг: запрашивает на 1 строку больше limit и сообщает наличие хвоста.
const topGroupsHasMore = computed(() => {
  if (topGroupsExpanded.value) return false
  return Boolean(dashboardStats.value?.topProductsHasMore)
})
const overviewStatusTotal = computed(() => overviewStatuses.value.reduce((sum, status) => sum + (status.count ?? 0), 0))

// Максимальное значение по выбранной метрике сортировки — для шкалы прогресс-бара
const topGroupsMaxValue = computed(() => {
  const field = topGroupsSort.value === 'quantity' ? 'total_quantity' : 'total_profit'
  const values = topGroups.value.map((g: any) => Number(g?.[field] ?? 0))
  return values.length ? Math.max(...values) : 0
})

const topGroupCoverImages = reactive<Record<string, string>>({})
const topGroupCoverFetchInFlight = new Set<string>()

async function loadTopGroupCoverImage(groupId: string) {
  if (!groupId || topGroupCoverImages[groupId] || topGroupCoverFetchInFlight.has(groupId)) return
  topGroupCoverFetchInFlight.add(groupId)
  try {
    const response = await fetch(
      `/api/admin/category-groups/${encodeURIComponent(groupId)}/image`,
      { credentials: 'include' },
    )
    if (!response.ok) return
    const data = await response.json() as { cover_image?: string | null }
    if (data?.cover_image) {
      topGroupCoverImages[groupId] = data.cover_image
    }
  } catch (error) {
    console.warn('[AdminView] failed to load top group cover for', groupId, error)
  } finally {
    topGroupCoverFetchInFlight.delete(groupId)
  }
}

watch(
  topGroups,
  (groups) => {
    for (const group of groups) {
      if (group.group_id && group.has_cover_image) {
        void loadTopGroupCoverImage(group.group_id)
      }
    }
    const liveIds = new Set(groups.map((group) => group.group_id))
    for (const id of Object.keys(topGroupCoverImages)) {
      if (!liveIds.has(id)) {
        delete topGroupCoverImages[id]
      }
    }
  },
  { immediate: true },
)

const groupCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  ;(adminStore.categoryGroups || []).forEach(group => {
    counts[group.categoryId] = (counts[group.categoryId] || 0) + 1
  })
  return counts
})

const crossSellCounts = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {}
  const records = adminStore.categoryCrossSells || {}
  for (const key in records) {
    result[key] = records[key]?.length || 0
  }
  return result
})

const groupNameById = computed<Record<string, string>>(() => {
  const mapping: Record<string, string> = {}
  ;(adminStore.categoryGroups || []).forEach(group => {
    mapping[group.id] = group.name
  })
  return mapping
})

const availableCrossSellProducts = computed<Product[]>(() => {
  if (!activeCrossSellCategory.value) return []
  
  const query = crossSellSearch.value.trim().toLowerCase()
  const selectedIds = new Set(crossSellSelection.value)
  
  return crossSellProducts.value.filter(product => {
    // Исключаем уже выбранные товары (они показываются отдельно вверху)
    if (selectedIds.has(product.id)) return false
    
    const title = (product.title || '').toLowerCase()
    return !query || title.includes(query)
  })
})

const crossSellFilteredCount = computed(() => {
  // Больше не используется - теперь можно добавлять любые товары
  return 0
})

// Товары которые уже добавлены в cross-sell для текущей категории
const selectedCrossSellProducts = computed<Product[]>(() => {
  if (!activeCrossSellCategory.value || !crossSellSelection.value.length) return []
  
  const selectedIds = new Set(crossSellSelection.value)
  return crossSellProducts.value.filter(p => selectedIds.has(p.id))
})

const groupFormOptions = computed(() => {
  const categoryId = groupFormCategoryId.value || activeGroupCategory.value?.id || null
  if (!categoryId) {
    return []
  }
  return flattenGroupTree(buildGroupTreeForCategory(categoryId))
})

const currentTabName = computed(() => adminTabs.find(t => t.id === activeTab.value)?.name || 'Админ-панель')
const currentMonthName = computed(() => {
  return formatBusinessPeriodTitle(overviewPeriod.value, overviewOffset.value)
  if (overviewPeriod.value === 'month') {
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth() + overviewOffset.value
    const d = new Date(Date.UTC(y, m, 1))
    return d.toLocaleDateString('ru-RU', { month: 'long' })
  }
  if (overviewPeriod.value === 'year') {
    return `${currentYearForView.value} год`
  }
  if (overviewPeriod.value === 'today') {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + overviewOffset.value)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
  }
  return ''
})

function formatCustomRangeBoundary(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return formatBusinessDate(
    { year: +m[1], month: +m[2], day: +m[3] },
    { day: '2-digit', month: 'long', year: 'numeric' },
  )
}

const dashboardHeader = computed(() => {
  if (overviewPeriod.value === 'custom') {
    if (customRangeFrom.value && customRangeTo.value) {
      return `Показатели: ${formatCustomRangeBoundary(customRangeFrom.value)} - ${formatCustomRangeBoundary(customRangeTo.value)}`
    }
    return 'Показатели за выбранный диапазон'
  }
  const periodMap: Record<string, string> = {
    today: 'Показатели за день',
    month: 'Показатели за текущий месяц',
    year: 'Показатели за год'
  }
  return periodMap[overviewPeriod.value] || 'Показатели'
})

// Products table state for client-side filters (mock store)
const productsFilters = ref({ search: '', category: '', group: '', location: 'retail' as 'retail' | 'warehouse' })

// Auth
async function handleLoginSuccess() {
  // AdminLockScreen handles login internally
  // Just load initial data after successful authentication
  if (adminStore.isAuthenticated) {
    resetLoadedState()
    await loadInitialAdminData()
    updateManagerForm()
  }
}

function handleLogout() {
  adminStore.logout()
  resetLoadedState()
  crmStore.lockProfitAccess()
  router.push('/')
}

function handleLock() {
  isLocked.value = true
  localStorage.setItem(LOCK_STATE_KEY, 'true')
  // Экран блокировки — граница смены пользователя. Общий пароль CRM
  // не должен наследовать допуск, выданный по личному ПИН руководителя.
  crmStore.lockStaffAccess()
  // Также сбрасываем доступ к финансовым данным при блокировке
  crmStore.lockProfitAccess()
}

function handleUnlock() {
  isLocked.value = false
  localStorage.removeItem(LOCK_STATE_KEY)
  // Load initial data after successful authentication/unlock
  if (adminStore.isAuthenticated) {
    resetLoadedState()
    loadInitialAdminData()
    updateManagerForm()
  }
}

// Overview navigation
function handleOverviewClick(tabId: 'banners' | 'categories' | 'products' | 'settings') {
  activeTab.value = tabId
}

watch([overviewPeriod, overviewOffset, profitUnlocked, customRangeFrom, customRangeTo, topGroupsSort, topGroupsSearchDebounced, topGroupsExpanded], async ([p, off, unlocked]) => {
  if (!adminStore.isAuthenticated) {
    return
  }
  if (!unlocked || !dashboardReady.value) {
    dataLoaded.dashboard = false
    return
  }

  // Для произвольного периода ждём, пока обе границы заполнены
  if (p === 'custom' && !isCustomRangeReady.value) {
    return
  }

  console.log(`[Dashboard] 🔄 Загрузка данных: period=${p}, offset=${off}`)

  try {
    // Загружаем сводные показатели
    await crmStore.fetchDashboard(p as any, off as number, currentDashboardOptions())
    if (p === 'custom') {
      // Бэкенд timeseries не умеет произвольный диапазон — обнуляем массив,
      // чтобы overviewStats упал на агрегированные данные dashboardStats.stats
      dashboardTimeseries.value = []
    } else {
      // Загружаем детализированные данные для графика
      try {
        const yearForApi = p === 'year' ? currentYearForView.value : undefined
        await crmStore.fetchDashboardTimeseries(p as 'today' | 'month' | 'year', off as number, yearForApi)
        console.log(`[Dashboard] ✅ Данные успешно загружены из API`)
      } catch (timeseriesError) {
        console.error('❌ Failed to load timeseries:', timeseriesError)
        // Не показываем ошибку пользователю, просто оставляем пустой график
      }
    }
    dataLoaded.dashboard = true
  } catch (error) {
    console.error('❌ Failed to update dashboard stats:', error)
    showToast('Не удалось обновить показатели дашборда', 'error', 4000)
  }
})

// Dashboard initialization moved to handleLogin and watch

function openProfitModal() {
  profitPassword.value = ''
  profitError.value = ''
  showProfitModal.value = true
}

function closeProfitModal() {
  showProfitModal.value = false
  profitPassword.value = ''
  profitError.value = ''
}

async function loadDataAfterProfitUnlock() {
  const tab = activeTab.value
  if (tab === 'dashboard') {
    if (!dashboardReady.value) {
      return
    }
    // Если выбран custom без обеих границ — не считаем dashboard загруженным:
    // watcher на customRangeFrom/customRangeTo догрузит данные сразу как юзер выберет диапазон
    if (overviewPeriod.value === 'custom' && !isCustomRangeReady.value) {
      return
    }
    await crmStore.fetchDashboard(overviewPeriod.value, overviewOffset.value, currentDashboardOptions())
    if (overviewPeriod.value === 'custom') {
      dashboardTimeseries.value = []
    } else {
      try {
        await crmStore.fetchDashboardTimeseries(
          overviewPeriod.value as 'today' | 'month' | 'year',
          overviewOffset.value,
          overviewPeriod.value === 'year' ? currentYearForView.value : undefined
        )
      } catch (e) {
        console.error('Timeseries load failed:', e)
      }
    }
    dataLoaded.dashboard = true
    return
  }
  if (tab === 'categories') {
    const catLoaders: Array<{ key: DataSliceKey; loader: () => Promise<unknown> }> = []
    if (!dataLoaded.categories) {
      catLoaders.push({ key: 'categories', loader: () => adminStore.fetchCategories() })
    }
    if (!dataLoaded.categoryGroups) {
      catLoaders.push({ key: 'categoryGroups', loader: () => adminStore.fetchCategoryGroups() })
    }
    if (catLoaders.length) {
      const success = await runDataLoaders(catLoaders)
      if (!success) {
        showToast('Не удалось загрузить категории. Попробуйте ещё раз.', 'error', 5000)
      }
    }
  }
  if (tab === 'products') {
    const page = adminStore.productsPagination?.page ?? 1
    const limit = adminStore.productsPagination?.limit ?? 10
    const productLoaders: Array<{ key: DataSliceKey; loader: () => Promise<unknown> }> = [
      { key: 'products', loader: () => adminStore.fetchProducts({ page, limit }) }
    ]
    if (!dataLoaded.categories) {
      productLoaders.push({ key: 'categories', loader: () => adminStore.fetchCategories() })
    }
    if (!dataLoaded.categoryGroups) {
      productLoaders.push({ key: 'categoryGroups', loader: () => adminStore.fetchCategoryGroups() })
    }
    const success = await runDataLoaders(productLoaders)
    if (!success) {
      showToast('Не удалось загрузить товары. Попробуйте ещё раз.', 'error', 5000)
    }
  }
}

async function submitProfitPassword() {
  if (!profitPassword.value.trim()) {
    profitError.value = 'Введите ключ'
    return
  }
  profitError.value = ''
  try {
    await crmStore.verifyProfitPassword(profitPassword.value.trim())
    closeProfitModal()
    await loadDataAfterProfitUnlock()
  } catch (error) {
    profitError.value = 'Неверный ключ'
  }
}

async function handleProfitUnlocked() {
  if (!profitPassword.value.trim()) {
    profitError.value = 'Введите ключ'
    return
  }

  profitError.value = ''
  const entered = profitPassword.value.trim()

  try {
    // На вкладке «Обзор» вход идёт через отдельную проверку: в окно проверок
    // она принимает только пароль владельца, вне окна и обычный ключ тоже.
    if (activeTab.value === 'dashboard') {
      await crmStore.verifyDashboardAccess(entered)
    } else {
      await crmStore.verifyProfitPassword(entered)
    }
    profitPassword.value = ''
    await loadDataAfterProfitUnlock()
  } catch (error: any) {
    console.error('Failed to unlock profit access:', error)
    profitError.value =
      error?.data?.error === 'too_many_attempts'
        ? 'Слишком много попыток. Попробуйте позже'
        : 'Неверный ключ'
  }
}

async function handleProfitModalUnlocked() {
  // Called when profit modal is unlocked (for backward compatibility)
  showProfitModal.value = false
  await handleProfitUnlocked()
}

async function handleProfitPasswordUpdate() {
  profitPasswordErrorMessage.value = ''
  profitPasswordSuccessMessage.value = ''
  adminStore.clearError()

  const current = profitPasswordForm.value.current.trim()
  const next = profitPasswordForm.value.next.trim()
  const confirm = profitPasswordForm.value.confirm.trim()

  if (!current) {
    profitPasswordErrorMessage.value = 'Введите текущий ключ'
    return
  }

  if (!next) {
    profitPasswordErrorMessage.value = 'Введите новый ключ'
    return
  }

  if (next.length < 4) {
    profitPasswordErrorMessage.value = 'Ключ должен содержать не менее 4 символов'
    return
  }

  if (next !== confirm) {
    profitPasswordErrorMessage.value = 'Ключи не совпадают'
    return
  }

  try {
    profitPasswordSaving.value = true
    await adminStore.updateProfitPassword({
      currentPassword: current,
      newPassword: next
    })
    crmStore.lockProfitAccess()
    profitPasswordForm.value.current = ''
    profitPasswordForm.value.next = ''
    profitPasswordForm.value.confirm = ''
    profitPasswordSuccessMessage.value = 'Ключ успешно обновлён'
    showToast('Лицензионный ключ обновлён', 'success')
  } catch (error: any) {
    profitPasswordErrorMessage.value = adminStore.error || error?.data?.message || 'Не удалось обновить ключ'
  } finally {
    profitPasswordSaving.value = false
  }
}

const hoveredBarIndex = ref<number | null>(null)
const chartAnimationKey = ref(0)
const isInitialChartLoad = ref(true)
const chartTransitioning = ref(false)

const chartData = computed(() => {
  const metric = selectedMetric.value
  if (!dashboardTimeseries.value || dashboardTimeseries.value.length === 0) {
    return []
  }
  
  // Маппим данные из API напрямую без изменений
  const data = dashboardTimeseries.value.map(point => ({
    label: point.label,
    value: metric === 'revenue' ? point.revenue : metric === 'profit' ? point.profit : point.orders
  }))
  
  return data
})

// Trigger chart re-animation on data change
watch([overviewPeriod, selectedMetric], () => {
  // Trigger morph animation for data changes (not on first load)
  if (!isInitialChartLoad.value) {
    chartTransitioning.value = true
    setTimeout(() => {
      chartTransitioning.value = false
    }, 50) // Just trigger the animation
  }
  chartAnimationKey.value++
})

// Mark as loaded after first chart data appears
watch(chartData, (newData) => {
  if (newData.length > 0 && isInitialChartLoad.value) {
    setTimeout(() => {
      isInitialChartLoad.value = false
    }, 600) // After initial animation completes
  }
})

function formatChartValue(value: number): string {
  if (selectedMetric.value === 'orders') return value.toString()
  return formatCurrency(value)
}

function getBarHeightPx(value: number): number {
  const CHART_HEIGHT_SM = 256 // h-64 = 16rem = 256px
  const CHART_HEIGHT_LG = 288 // h-72 = 18rem = 288px
  const CHART_HEIGHT = CHART_HEIGHT_LG
  const MIN_HEIGHT = 8
  if (chartData.value.length === 0 || value === 0) return MIN_HEIGHT
  const maxValue = Math.max(...chartData.value.map(d => d.value), 1)
  const ratio = value / maxValue
  const height = ratio * CHART_HEIGHT
  return Math.max(MIN_HEIGHT, Math.min(CHART_HEIGHT, Math.round(height)))
}

function formatCurrency(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—'
  }
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'BYN',
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value)
}

// Banners
function handleCreateBanner() {
  editingBanner.value = null
  modalTitle.value = 'Добавить баннер'
  showBannerModal.value = true
}
function handleEditBanner(banner: any) {
  editingBanner.value = banner
  modalTitle.value = 'Редактировать баннер'
  showBannerModal.value = true
}
async function handleDeleteBanner(bannerId: string) {
  if (confirm('Удалить баннер?')) {
    await adminStore.deleteBanner(bannerId)
  }
}
async function handleReorderBanners(reorderedBanners: any[]) {
  await adminStore.reorderBanners(reorderedBanners)
}
async function handleToggleBannerStatus(bannerId: string) {
  await adminStore.toggleBannerStatus(bannerId)
}
async function handleBannerFormSubmit(formData: any) {
  if (editingBanner.value) await adminStore.updateBanner(editingBanner.value.id, formData)
  else await adminStore.createBanner(formData)
  showBannerModal.value = false
}

// Массовые операции с баннерами
async function handleBatchDeleteBanners(bannerIds: string[]) {
  try {
    await Promise.all(bannerIds.map(id => adminStore.deleteBanner(id)))
  } catch (error) {
    console.error('Batch delete banners failed:', error)
  }
}

async function handleBatchToggleBannerStatus(bannerIds: string[], active: boolean) {
  try {
    await Promise.all(bannerIds.map(id => adminStore.updateBanner(id, { active: active ? 1 : 0 })))
  } catch (error) {
    console.error('Batch toggle banner status failed:', error)
  }
}

// Products
function handleCreateProduct() {
  editingProduct.value = null
  modalTitle.value = 'Создать товар'
  showProductModal.value = true
}
function handleEditProduct(p: any) {
  editingProduct.value = p
  modalTitle.value = 'Редактировать товар'
  showProductModal.value = true
}
async function handleDeleteProduct(product: any) {
  if (confirm(`Удалить товар "${product.title || product.id}"?`)) {
    await adminStore.deleteProduct(product.id)
  }
}
async function handleProductFormSubmit(formData: any) {
  try {
    if (editingProduct.value) {
      // Редактирование существующего товара
      await adminStore.updateProduct(editingProduct.value.id, formData)
      if (Array.isArray(formData.images)) {
        // @ts-ignore - метод присутствует и в mock, и в реальном сторе
        await adminStore.reorderProductImages(editingProduct.value.id, formData.images)
      }
    } else {
      // Создание нового товара
      await adminStore.createProduct(formData)
    }
    showProductModal.value = false
    
    // Обновляем список товаров с учётом текущих фильтров
    await adminStore.fetchProducts({ 
      page: adminStore.productsPagination?.page || 1, 
      limit: adminStore.productsPagination?.limit || 10,
      category: productsFilters.value.category || undefined,
      search: productsFilters.value.search || undefined,
      group: productsFilters.value.group || undefined,
      location: productsFilters.value.location,
    })
    
    // Обновляем счётчики в линейках если товар был назначен в линейку
    if (formData.categoryId) {
      await adminStore.fetchCategoryGroups(formData.categoryId)
    }
  } catch (err: any) {
    console.error('[AdminView] Error in handleProductFormSubmit:', err)
    alert(`Ошибка сохранения: ${err?.message || 'Неизвестная ошибка'}`)
  }
}

// Pagination & filters for products (works with mock store; server can use same events)
function handleProductsPageChange(page: number) {
  adminStore.fetchProducts({ 
    page, 
    limit: adminStore.productsPagination?.limit || 10,
    category: productsFilters.value.category || undefined,
    search: productsFilters.value.search || undefined,
    group: productsFilters.value.group || undefined,
    location: productsFilters.value.location,
  })
}
function handleProductsPageSizeChange(limit: number) {
  adminStore.fetchProducts({ 
    page: 1, 
    limit,
    category: productsFilters.value.category || undefined,
    search: productsFilters.value.search || undefined,
    group: productsFilters.value.group || undefined,
    location: productsFilters.value.location,
  })
}
function handleProductsFilters(v: { search: string; category: string; group: string }) {
  productsFilters.value = { ...productsFilters.value, ...v }
  // Вызываем API с новыми фильтрами
  adminStore.fetchProducts({ 
    page: 1, 
    limit: adminStore.productsPagination?.limit || 10,
    category: v.category || undefined,
    search: v.search || undefined,
    group: v.group || undefined,
    location: productsFilters.value.location,
  })
}

function handleProductsLocationChange(location: 'retail' | 'warehouse') {
  productsFilters.value = { ...productsFilters.value, group: '', location }
  adminStore.fetchProducts({
    page: 1,
    limit: adminStore.productsPagination?.limit || 10,
    category: productsFilters.value.category || undefined,
    search: productsFilters.value.search || undefined,
    location,
  })
}

function openStockTransfer(location: 'retail' | 'warehouse') {
  stockTransferInitialSource.value = location
  showStockTransferModal.value = true
}

function handleStockTransferSaved(details: { number: number }) {
  showToast(`Заявка №${details.number} сохранена. Остатки пока не изменились.`, 'success')
}

function handleStockTransferCancelled(details: { number: number }) {
  showToast(`Заявка №${details.number} отменена`, 'success')
}

async function handleStockTransferCompleted(details: { quantity: number; destination: 'retail' | 'warehouse' }) {
  showToast(
    `Перемещено ${details.quantity} шт ${details.destination === 'warehouse' ? 'на склад' : 'в розницу'}`,
    'success',
  )
  await adminStore.fetchProducts({
    page: adminStore.productsPagination?.page || 1,
    limit: adminStore.productsPagination?.limit || 10,
    category: productsFilters.value.category || undefined,
    search: productsFilters.value.search || undefined,
    group: productsFilters.value.group || undefined,
    location: productsFilters.value.location,
  })
}

// Массовые операции с товарами
async function handleBatchDeleteProducts(productIds: string[]) {
  try {
    // Используем новый batch метод
    await adminStore.batchDeleteProducts(productIds)
    
    // Обновляем список для синхронизации
    await adminStore.fetchProducts({ 
      page: adminStore.productsPagination?.page || 1, 
      limit: adminStore.productsPagination?.limit || 10 
    })
  } catch (error) {
    console.error('Batch delete products failed:', error)
  }
}

async function handleBatchChangeProductCategory(productIds: string[], categoryId: string) {
  try {
    // Используем batch update метод
    const updates = productIds.map(id => ({ id, data: { categoryId } }))
    await adminStore.batchUpdateProducts(updates)
    
    // Обновляем список для синхронизации
    await adminStore.fetchProducts({ 
      page: adminStore.productsPagination?.page || 1, 
      limit: adminStore.productsPagination?.limit || 10 
    })
    
    // Обновляем счётчики в линейках для категории
    await adminStore.fetchCategoryGroups(categoryId)
  } catch (error) {
    console.error('Batch change product category failed:', error)
  }
}

async function handleBatchChangeProductGroup(productIds: string[], payload: { categoryId: string; groupId: string | null }) {
  try {
    const updates = productIds.map(id => ({
      id,
      data: {
        categoryId: payload.categoryId,
        groupId: payload.groupId
      }
    }))

    await adminStore.batchUpdateProducts(updates)

    await adminStore.fetchProducts({
      page: adminStore.productsPagination?.page || 1,
      limit: adminStore.productsPagination?.limit || 10
    })
    
    // Обновляем счётчики в линейках для категории
    if (payload.categoryId) {
      await adminStore.fetchCategoryGroups(payload.categoryId)
    }
  } catch (error) {
    console.error('Batch change product group failed:', error)
  }
}

function handleCreateCategoryFromProducts() {
  handleCreateCategory()
}

async function handleCreateGroupFromProducts(payload: { categoryId: string | null }) {
  const categoryId = payload?.categoryId || ''
  const targetCategory = categoryId ? adminStore.categories.find((cat) => cat.id === categoryId) || null : null
  if (!targetCategory) {
    showToast('Сначала выберите категорию в фильтре', 'error')
    return
  }
  try {
    await adminStore.fetchCategoryGroups(targetCategory.id)
  } catch (error) {
    console.error('[AdminView] Failed to preload groups:', error)
  }
  void openGroupForm(null, targetCategory)
}


// Categories
function handleCreateCategory() {
  editingCategory.value = null
  modalTitle.value = 'Добавить категорию'
  showCategoryModal.value = true
}
function handleEditCategory(category: any) {
  editingCategory.value = category
  modalTitle.value = 'Редактировать категорию'
  showCategoryModal.value = true
}
async function handleDeleteCategory(categoryId: string) {
  if (confirm('Удалить категорию?')) {
    await adminStore.deleteCategory(categoryId)
  }
}
async function handleReorderCategories(reorderedCategories: any[]) {
  await adminStore.reorderCategories(reorderedCategories)
}
async function handleCategoryFormSubmit(formData: any) {
  try {
    const categoryData = {
      name: formData.name,
      hide_empty: formData.hideEmpty || false,
      cover_image: formData.coverImage ?? null,
      storefront_filters_profile: formData.storefrontFiltersProfile ?? 'none',
    }

    if (editingCategory.value) {
      await adminStore.updateCategory(editingCategory.value.id, categoryData)
      showToast('Категория обновлена', 'success')
    } else {
      await adminStore.createCategory({
        name: formData.name,
        hideEmpty: formData.hideEmpty || false,
        coverImage: formData.coverImage ?? null,
        storefrontFiltersProfile: formData.storefrontFiltersProfile ?? 'none',
      })
      showToast('Категория создана', 'success')
    }

    showCategoryModal.value = false
    // НЕ вызываем fetchCategories() - updateCategory уже обновил локальное состояние с cover_image
    // fetchCategories() перезаписывает состояние без cover_image (API не возвращает его для экономии трафика)
  } catch (error: any) {
    console.error('[AdminView] Category form submission failed:', error)
    // Явная обработка дубликатов категорий
    const msg = (typeof error?.message === 'string' ? error.message : '')
    if (/Категория\s+с\s+(таким|похожим)\s+названием\s+уже\s+существует/i.test(msg)) {
      showToast(msg, 'error', 3500)
    } else {
      showToast('Не удалось сохранить категорию. Попробуйте ещё раз', 'error')
    }
    // Модал остается открытым при ошибке
  }
}

function syncEditableGroups(categoryId: string, restoreScroll = false) {
  const scrollContainer = groupModalRef.value?.scrollContainer
  const scrollPos = restoreScroll && scrollContainer 
    ? scrollContainer.scrollTop 
    : 0
  
  const groups = flattenGroupTree(buildGroupTreeForCategory(categoryId))
  // Сортируем: сначала с остатком, потом без остатка (учитываем totalStockSum)
  groups.sort((a, b) => {
    const aEmpty = (a.totalStockSum ?? a.stockSum ?? 0) === 0 ? 1 : 0
    const bEmpty = (b.totalStockSum ?? b.stockSum ?? 0) === 0 ? 1 : 0
    return aEmpty - bEmpty
  })
  editableGroups.value = groups
  
  if (restoreScroll && scrollPos > 0) {
    nextTick(() => {
      const container = groupModalRef.value?.scrollContainer
      if (container) {
        container.scrollTop = scrollPos
      }
    })
  }
}

function getGroupBlockRange(list: CategoryGroupWithDepth[], startIndex: number) {
  const startDepth = list[startIndex]?.depth ?? 0
  let endIndex = startIndex + 1
  while (endIndex < list.length && (list[endIndex].depth ?? 0) > startDepth) {
    endIndex += 1
  }
  return { start: startIndex, end: endIndex }
}

function findPreviousSiblingIndex(list: CategoryGroupWithDepth[], startIndex: number) {
  const targetDepth = list[startIndex]?.depth ?? 0
  for (let i = startIndex - 1; i >= 0; i -= 1) {
    const depth = list[i]?.depth ?? 0
    if (depth === targetDepth) {
      return i
    }
    if (depth < targetDepth) {
      break
    }
  }
  return -1
}

function findNextSiblingIndex(list: CategoryGroupWithDepth[], startIndex: number) {
  const targetDepth = list[startIndex]?.depth ?? 0
  const currentRange = getGroupBlockRange(list, startIndex)
  let i = currentRange.end
  while (i < list.length) {
    const depth = list[i]?.depth ?? 0
    if (depth === targetDepth) {
      return i
    }
    if (depth < targetDepth) {
      break
    }
    const nextRange = getGroupBlockRange(list, i)
    i = nextRange.end
  }
  return -1
}

function handleManageGroups(category: Category) {
  void openManageGroups(category)
}

async function handleOpenIncompleteGroup(payload: { categoryId: string; groupId: string }) {
  const category = adminStore.categories.find((cat) => cat.id === payload.categoryId) || null
  if (!category) {
    showToast('Категория не найдена', 'error')
    return
  }
  await openManageGroups(category)
  const group = adminStore.categoryGroups.find((g) => g.id === payload.groupId) || null
  if (group) {
    openGroupForm(group, category)
  } else {
    showToast('Линейка не найдена', 'error')
  }
}

async function openManageGroups(category: Category) {
  activeGroupCategory.value = category
  groupFormCategoryId.value = category.id
  try {
    await adminStore.fetchCategoryGroups(category.id)
  } catch (error) {
    console.error('Failed to load groups:', error)
    showToast('Не удалось загрузить линейки', 'error')
  }
  syncEditableGroups(category.id)
  showGroupModal.value = true
}

function closeGroupModal() {
  showGroupModal.value = false
  if (!showGroupFormModal.value) {
    activeGroupCategory.value = null
    editableGroups.value = []
    groupFormCategoryId.value = null
  }
}
function openGroupForm(group?: (CategoryGroup & { depth?: number }) | null, category?: Category | null) {
  const targetCategory = category ?? activeGroupCategory.value ?? null
  if (targetCategory) {
    activeGroupCategory.value = targetCategory
    groupFormCategoryId.value = targetCategory.id
  }
  // Save scroll position before closing modal
  const scrollContainer = groupModalRef.value?.scrollContainer
  if (scrollContainer) {
    savedGroupModalScrollTop.value = scrollContainer.scrollTop
  }
  showGroupModal.value = false
  editingGroup.value = group
    ? {
        ...group,
        wholesalePrices: { ...(group.wholesalePrices || {}) },
      }
    : null
  showGroupFormModal.value = true
}

function closeGroupForm() {
  showGroupFormModal.value = false
  editingGroup.value = null
  groupFormCategoryId.value = null
  if (activeGroupCategory.value) {
    showGroupModal.value = true
    // Restore scroll position after modal reopens
    nextTick(() => {
      const scrollContainer = groupModalRef.value?.scrollContainer
      if (scrollContainer && savedGroupModalScrollTop.value > 0) {
        scrollContainer.scrollTop = savedGroupModalScrollTop.value
      }
    })
  }
}

const showProductDiscountModal = ref(false)
const discountProduct = ref<any | null>(null)

function openProductDiscount(product: any) {
  discountProduct.value = product
  showProductDiscountModal.value = true
}

async function reloadProductsAfterDiscount() {
  showToast('Скидка сохранена', 'success')
  await adminStore.fetchProducts({
    page: adminStore.productsPagination?.page || 1,
    limit: adminStore.productsPagination?.limit || 10,
    category: productsFilters.value.category || undefined,
    search: productsFilters.value.search || undefined,
    group: productsFilters.value.group || undefined,
    location: productsFilters.value.location,
  })
}

async function handleGroupFormSubmit(payload: { name: string; slug?: string; coverImage?: string | null; hideEmpty?: boolean; parentId?: string | null; metaLabel?: string | null; metaValue?: string | null; minStockThreshold?: number | null; totalControl?: boolean; isNew?: boolean; newDays?: number; discount?: { price: number | null; untilDate: string | null }; wholesalePrices?: Record<string, number | null>; waiveDescription?: boolean; waiveMinStock?: boolean; waiveWholesale?: boolean; waiveStrengthTier?: boolean; strengthTier?: string | null }) {
  const categoryId = groupFormCategoryId.value || activeGroupCategory.value?.id || null
  if (!categoryId) {
    showToast('Сначала выберите категорию', 'error')
    return
  }

  if (!activeGroupCategory.value || activeGroupCategory.value.id !== categoryId) {
    const resolvedCategory = adminStore.categories.find((cat) => cat.id === categoryId) || null
    if (resolvedCategory) {
      activeGroupCategory.value = resolvedCategory
    }
  }

  groupFormSubmitting.value = true
  try {
    if (editingGroup.value) {
      await adminStore.updateCategoryGroup(editingGroup.value.id!, {
        name: payload.name,
        slug: payload.slug,
        coverImage: payload.coverImage ?? null,
        hideEmpty: payload.hideEmpty,
        parentId: payload.parentId ?? null,
        metaLabel: payload.metaLabel ?? null,
        metaValue: payload.metaValue ?? null,
        minStockThreshold: payload.minStockThreshold ?? null,
        totalControl: payload.totalControl ?? false,
        isNew: payload.isNew ?? false,
        ...(payload.newDays !== undefined ? { newDays: payload.newDays } : {}),
        ...(payload.discount !== undefined ? { discount: payload.discount } : {}),
        wholesalePrices: payload.wholesalePrices ?? {},
        waiveDescription: payload.waiveDescription,
        waiveMinStock: payload.waiveMinStock,
        waiveWholesale: payload.waiveWholesale,
        waiveStrengthTier: payload.waiveStrengthTier,
        strengthTier: payload.strengthTier ?? null,
      })
      showToast('Линейка обновлена', 'success')
    } else {
      await adminStore.createCategoryGroup({
        categoryId,
        name: payload.name,
        slug: payload.slug,
        coverImage: payload.coverImage ?? null,
        hideEmpty: payload.hideEmpty,
        parentId: payload.parentId ?? null,
        metaLabel: payload.metaLabel ?? null,
        metaValue: payload.metaValue ?? null,
        minStockThreshold: payload.minStockThreshold ?? null,
        totalControl: payload.totalControl ?? false,
        isNew: payload.isNew ?? false,
        ...(payload.newDays !== undefined ? { newDays: payload.newDays } : {}),
        wholesalePrices: payload.wholesalePrices ?? {},
        waiveDescription: payload.waiveDescription,
        waiveMinStock: payload.waiveMinStock,
        waiveWholesale: payload.waiveWholesale,
        waiveStrengthTier: payload.waiveStrengthTier,
        strengthTier: payload.strengthTier ?? null,
      })
      showToast('Линейка создана', 'success')
    }
    await adminStore.fetchCategoryGroups(categoryId)
    await adminStore.fetchIncompleteGroups()
    syncEditableGroups(categoryId, true)
    showGroupFormModal.value = false
    groupFormCategoryId.value = null
    showGroupModal.value = true
    // Restore scroll position after modal reopens
    nextTick(() => {
      const scrollContainer = groupModalRef.value?.scrollContainer
      if (scrollContainer && savedGroupModalScrollTop.value > 0) {
        scrollContainer.scrollTop = savedGroupModalScrollTop.value
      }
    })
  } catch (error) {
    console.error('Failed to save group:', error)
    showToast('Не удалось сохранить линейку', 'error')
  } finally {
    groupFormSubmitting.value = false
  }
}

async function reorderGroups(newOrder: CategoryGroupWithDepth[]) {
  if (!activeGroupCategory.value) return
  groupModalLoading.value = true
  try {
    const payload = newOrder.map((group, idx) => ({ id: group.id!, order: idx + 1 }))
    await adminStore.reorderCategoryGroups(payload)
    await adminStore.fetchCategoryGroups(activeGroupCategory.value.id)
    syncEditableGroups(activeGroupCategory.value.id, true)
  } catch (error) {
    console.error('Failed to reorder groups:', error)
    showToast('Не удалось изменить порядок линеек', 'error')
  } finally {
    groupModalLoading.value = false
  }
}

function moveGroupUp(index: number) {
  const list = editableGroups.value
  if (!list[index]) return
  const prevIndex = findPreviousSiblingIndex(list, index)
  if (prevIndex === -1) return
  const currentRange = getGroupBlockRange(list, index)
  const prevRange = getGroupBlockRange(list, prevIndex)
  const block = list.slice(currentRange.start, currentRange.end)
  const remaining = [...list]
  remaining.splice(currentRange.start, currentRange.end - currentRange.start)
  const insertIndex = prevRange.start
  remaining.splice(insertIndex, 0, ...block)
  editableGroups.value = remaining
  void reorderGroups(remaining)
}

function moveGroupDown(index: number) {
  const list = editableGroups.value
  if (!list[index]) return
  const nextIndex = findNextSiblingIndex(list, index)
  if (nextIndex === -1) return
  const currentRange = getGroupBlockRange(list, index)
  const nextRange = getGroupBlockRange(list, nextIndex)
  const block = list.slice(currentRange.start, currentRange.end)
  const remaining = [...list]
  remaining.splice(currentRange.start, currentRange.end - currentRange.start)
  const adjust = currentRange.end - currentRange.start
  const insertIndex = nextRange.end - adjust
  remaining.splice(insertIndex, 0, ...block)
  editableGroups.value = remaining
  void reorderGroups(remaining)
}

async function deleteGroup(group: CategoryGroupWithDepth) {
  if (!activeGroupCategory.value || !group.id) return
  if (!confirm(`Удалить линейку "${group.name}"?`)) return
  groupModalLoading.value = true
  try {
    await adminStore.deleteCategoryGroup(group.id)
    await adminStore.fetchCategoryGroups(activeGroupCategory.value.id)
    syncEditableGroups(activeGroupCategory.value.id, true)
    showToast('Линейка удалена', 'success')
  } catch (error) {
    console.error('Failed to delete group:', error)
    showToast('Не удалось удалить линейку', 'error')
  } finally {
    groupModalLoading.value = false
  }
}

// === Quick-edit минимального остатка линейки ============================
//
// Логика:
//  - Pill в строке линейки показывает текущий порог («Не менее 45 шт»),
//    либо нейтральный плейсхолдер «Минимальный остаток» если порог не задан.
//  - Цвет pill подсказывает статус: красный — линейка уже ниже порога
//    (попала в плашку «Заканчивающиеся»), оранжевый — порог задан и stock
//    в норме, серый — порог не задан.
//  - Клик открывает мини-модалку с одним полем + пресетами + текущим stock.
//  - Применить → updateCategoryGroup({ minStockThreshold }), оптимистично
//    обновляем editableGroups, без перезагрузки всего списка.

function getGroupStock(group: CategoryGroupWithDepth): number {
  return Number(group.totalStockSum ?? group.stockSum ?? 0)
}

function minStockBadgeLabel(group: CategoryGroupWithDepth): string {
  const threshold = group.minStockThreshold
  if (threshold && threshold > 0) {
    return `Не менее ${threshold} шт`
  }
  return 'Минимальный остаток'
}

function minStockBadgeTitle(group: CategoryGroupWithDepth): string {
  const stock = getGroupStock(group)
  const threshold = group.minStockThreshold
  if (threshold && threshold > 0) {
    return `Сейчас: ${stock} шт. Порог: ${threshold} шт. Нажмите, чтобы изменить.`
  }
  return `Сейчас: ${stock} шт. Нажмите, чтобы задать порог.`
}

function minStockBadgeClasses(group: CategoryGroupWithDepth): string[] {
  const threshold = group.minStockThreshold
  const stock = getGroupStock(group)
  if (threshold && threshold > 0) {
    if (stock < threshold) {
      return ['border', 'border-red-200', 'bg-red-50', 'text-red-700', 'hover:bg-red-100']
    }
    return ['border', 'border-amber-200', 'bg-amber-50', 'text-amber-800', 'hover:bg-amber-100']
  }
  return ['border', 'border-dashed', 'border-gray-300', 'bg-gray-50', 'text-gray-600', 'hover:bg-gray-100']
}

function openMinStockEditor(group: CategoryGroupWithDepth) {
  const scrollContainer = groupModalRef.value?.scrollContainer
  if (scrollContainer) savedGroupModalScrollTop.value = scrollContainer.scrollTop
  minStockEditorGroup.value = group
  minStockEditorError.value = null
  minStockEditorOpen.value = true
}

function closeMinStockEditor() {
  if (minStockEditorBusy.value) return
  minStockEditorOpen.value = false
  minStockEditorGroup.value = null
  minStockEditorError.value = null
  nextTick(() => {
    const scrollContainer = groupModalRef.value?.scrollContainer
    if (scrollContainer) scrollContainer.scrollTop = savedGroupModalScrollTop.value
  })
}

async function applyMinStockThreshold(value: number | null) {
  const group = minStockEditorGroup.value
  if (!group?.id) return
  minStockEditorBusy.value = true
  minStockEditorError.value = null
  try {
    const updated = await adminStore.updateCategoryGroup(group.id, {
      minStockThreshold: value,
    })
    // Оптимистично заменяем поле в локальном editableGroups, чтобы pill
    // обновился сразу. Полная перезагрузка fetchCategoryGroups была бы
    // тяжелее для UX (моргает весь список), а здесь точечно меняем только
    // нужную запись.
    const idx = editableGroups.value.findIndex((g) => g.id === group.id)
    if (idx !== -1) {
      editableGroups.value[idx] = {
        ...editableGroups.value[idx],
        minStockThreshold: updated?.minStockThreshold ?? value,
      }
    }
    showToast(value === null ? 'Порог снят' : `Порог обновлён: ${value} шт`, 'success')
    minStockEditorOpen.value = false
    minStockEditorGroup.value = null
    nextTick(() => {
      const scrollContainer = groupModalRef.value?.scrollContainer
      if (scrollContainer) scrollContainer.scrollTop = savedGroupModalScrollTop.value
    })
  } catch (error) {
    console.error('Failed to update min stock threshold:', error)
    minStockEditorError.value = error instanceof Error ? error.message : 'Не удалось сохранить порог'
  } finally {
    minStockEditorBusy.value = false
  }
}

watch(
  () => adminStore.categoryGroups,
  () => {
    if (activeGroupCategory.value) {
      syncEditableGroups(activeGroupCategory.value.id, true)
    }
  }
)

async function handleManagerSettingsUpdate() {
  if (!managerForm.value.telegram || !managerForm.value.telegram.trim()) {
    showToast('Укажите Telegram username', 'error')
    return
  }
  
  try {
    await adminStore.updateSettings({
      manager_telegram: managerForm.value.telegram.trim()
    })
    showToast('Настройки менеджера успешно сохранены!', 'success')
  } catch (error) {
    console.error('Failed to update manager settings:', error)
    showToast('Ошибка при сохранении настроек', 'error')
  }
}

// Delivery settings handlers
async function handleDeliverySettingsUpdate() {
  deliverySettingsSaving.value = true
  try {
    await adminStore.updateSettings({
      min_delivery_amount: deliverySettingsForm.value.min_delivery_amount,
      min_delivery_banner_image: deliverySettingsForm.value.min_delivery_banner_image,
      min_delivery_banner_button_text: deliverySettingsForm.value.min_delivery_banner_button_text,
      min_delivery_banner_button_color: deliverySettingsForm.value.min_delivery_banner_button_color,
      delivery_conditions_image: deliverySettingsForm.value.delivery_conditions_image,
      order_redirect_telegram: deliverySettingsForm.value.order_redirect_telegram,
      order_redirect_text_template: deliverySettingsForm.value.order_redirect_text_template
    })
    showToast('Настройки доставки успешно сохранены!', 'success')
  } catch (error) {
    console.error('Failed to update delivery settings:', error)
    showToast('Ошибка при сохранении настроек доставки', 'error')
  } finally {
    deliverySettingsSaving.value = false
  }
}

async function uploadDeliveryBannerImage(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  
  try {
    const urls = await adminStore.uploadFiles(input.files, 'settings')
    if (urls && urls.length > 0) {
      deliverySettingsForm.value.min_delivery_banner_image = urls[0]
      showToast('Изображение загружено', 'success')
    }
  } catch (error) {
    console.error('Failed to upload banner image:', error)
    showToast('Ошибка при загрузке изображения', 'error')
  }
  input.value = ''
}

async function uploadDeliveryConditionsImage(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  
  try {
    const urls = await adminStore.uploadFiles(input.files, 'settings')
    if (urls && urls.length > 0) {
      deliverySettingsForm.value.delivery_conditions_image = urls[0]
      showToast('Изображение загружено', 'success')
    }
  } catch (error) {
    console.error('Failed to upload conditions image:', error)
    showToast('Ошибка при загрузке изображения', 'error')
  }
  input.value = ''
}

async function handlePasswordChange() {
  if (!passwordForm.value.currentPassword || !passwordForm.value.newPassword || !passwordForm.value.confirmPassword) {
    showToast('Заполните все поля', 'error')
    return
  }

  if (passwordForm.value.newPassword.length < 6) {
    showToast('Новый пароль должен содержать не менее 6 символов', 'error')
    return
  }

  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    showToast('Пароли не совпадают', 'error')
    return
  }

  try {
    await adminStore.changePassword(
      passwordForm.value.currentPassword,
      passwordForm.value.newPassword
    )
    
    // Очищаем форму
    passwordForm.value.currentPassword = ''
    passwordForm.value.newPassword = ''
    
    passwordForm.value.confirmPassword = ''
    showToast('Пароль успешно изменён!', 'success')
  } catch (error: any) {
    console.error('Password change failed:', error)
    
    // Показываем конкретную ошибку из стора
    const errorMessage = adminStore.error || 'Не удалось изменить пароль'
    showToast(errorMessage, 'error', 4000)
  }
}

// Init
onMounted(async () => {
  // Check lock state
  const savedLockState = localStorage.getItem(LOCK_STATE_KEY)
  if (savedLockState === 'true') {
    isLocked.value = true
  }

  resetLoadedState()
  // @ts-ignore - checkAuth method exists in adminStore
  await adminStore.checkAuth()
  if (adminStore.isAuthenticated) {
    // Загружаем данные для текущей вкладки
    await ensureTabData(activeTab.value)
    updateManagerForm()
    // Запускаем глобальный polling новых заказов
    crmStore.startPolling()
  }
})

onUnmounted(() => {
  // Останавливаем polling при выходе из админки
  crmStore.stopPolling()
  // Чистим debounce-таймер поиска по топ-линейкам, чтобы callback
  // не выполнился на размонтированном компоненте
  if (topGroupsSearchDebounceTimer !== null) {
    clearTimeout(topGroupsSearchDebounceTimer)
    topGroupsSearchDebounceTimer = null
  }
})

watch(() => adminStore.isAuthenticated, async (loggedIn, wasLoggedIn) => {
  if (loggedIn && !wasLoggedIn) {
    // Пользователь только что авторизовался - загружаем данные для текущей вкладки
    await ensureTabData(activeTab.value)
  } else if (!loggedIn) {
    crmStore.lockProfitAccess()
    resetLoadedState()
  }
})

watch(
  () => [profitPasswordForm.value.current, profitPasswordForm.value.next, profitPasswordForm.value.confirm],
  () => {
    if (profitPasswordErrorMessage.value) {
      profitPasswordErrorMessage.value = ''
    }
    if (profitPasswordSuccessMessage.value) {
      profitPasswordSuccessMessage.value = ''
    }
    if (adminStore.error) {
      adminStore.clearError()
    }
  }
)

// Отслеживаем изменения параметра tab в URL
watch(
  () => route.query.tab,
  (newTab) => {
    if (typeof newTab === 'string' && tabOptions.includes(newTab as AdminTabId)) {
      activeTab.value = newTab as AdminTabId
    }
  }
)

// Отслеживаем изменения настроек для обновления формы
watch(() => adminStore.settings.manager_telegram, () => {
  updateManagerForm()
})

watch(() => adminStore.settings, () => {
  updateDeliverySettingsForm()
}, { deep: true })

function updateManagerForm() {
  const currentValue = adminStore.settings.manager_telegram || 'Rez0nsky'
  managerForm.value.telegram = currentValue
}

function updateDeliverySettingsForm() {
  const s = adminStore.settings
  deliverySettingsForm.value.min_delivery_amount = s.min_delivery_amount || '0'
  deliverySettingsForm.value.min_delivery_banner_image = s.min_delivery_banner_image || ''
  deliverySettingsForm.value.min_delivery_banner_button_text = s.min_delivery_banner_button_text || 'Понятно'
  deliverySettingsForm.value.min_delivery_banner_button_color = s.min_delivery_banner_button_color || '#FFD700'
  deliverySettingsForm.value.delivery_conditions_image = s.delivery_conditions_image || ''
  deliverySettingsForm.value.order_redirect_telegram = s.order_redirect_telegram || ''
  deliverySettingsForm.value.order_redirect_text_template = s.order_redirect_text_template || 'Здравствуйте, хочу уточнить по покупке'
}

function closeCrossSellModal() {
  showCrossSellModal.value = false
  activeCrossSellCategory.value = null
  crossSellSelection.value = []
  crossSellSearch.value = ''
  crossSellProducts.value = []
}

function handleManageCrossSell(category: Category) {
  void openCrossSellModal(category)
}

async function openCrossSellModal(category: Category) {
  activeCrossSellCategory.value = category
  crossSellSearch.value = ''
  try {
    await adminStore.fetchCategoryCrossSells(category.id)
    const existing = adminStore.categoryCrossSells?.[category.id] || []
    const options = await adminStore.fetchProductOptions(100)
    const optionsById = new Map(options.map(product => [product.id, product]))
    existing.forEach(product => optionsById.set(product.id, product))
    crossSellProducts.value = Array.from(optionsById.values())
    crossSellSelection.value = existing.map(product => product.id)
    showCrossSellModal.value = true
  } catch (error) {
    console.error('Failed to load cross-sell:', error)
    showToast('Не удалось загрузить cross-sell для категории', 'error')
  }
}

async function saveCrossSell() {
  if (!activeCrossSellCategory.value) return
  crossSellSubmitting.value = true
  try {
    await adminStore.updateCategoryCrossSells(activeCrossSellCategory.value.id, [...crossSellSelection.value])
    showToast('Cross-sell обновлён', 'success')
    closeCrossSellModal()
  } catch (error) {
    console.error('Failed to save cross-sell:', error)
    showToast('Не удалось сохранить cross-sell', 'error')
  } finally {
    crossSellSubmitting.value = false
  }
}

function formatPrice(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value)
}
</script>

<style scoped>
/* Dashboard fade transition */
.dash-fade-enter-active, .dash-fade-leave-active {
  transition: opacity 320ms ease, transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dash-fade-enter-from {
  opacity: 0;
  transform: translateY(14px) scale(0.99);
}
.dash-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.995);
}

/* Chart bar animations - dual mode */
.chart-bar {
  height: var(--bar-height, 8px);
  transform-origin: bottom center;
  /* Smooth height transition for data changes */
  transition: height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1),
              background-color 0.25s ease,
              transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
              filter 0.25s ease;
  /* Initial load animation */
  animation: barGrow 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  animation-delay: var(--bar-delay, 0ms);
  opacity: 0;
  transform: scaleY(0);
}

/* Morphing animation for data changes */
.chart-bar--morphing {
  animation: barMorph 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
  animation-delay: calc(var(--bar-delay, 0ms) / 2) !important;
}

.chart-bar--hovered {
  transform: scaleY(1.05) scaleX(1.02);
  filter: brightness(1.15) drop-shadow(0 4px 12px rgba(255, 255, 255, 0.4));
}

/* Initial load: grow from bottom */
@keyframes barGrow {
  0% {
    opacity: 0;
    transform: scaleY(0) translateY(4px);
  }
  50% {
    opacity: 0.6;
  }
  100% {
    opacity: 1;
    transform: scaleY(1) translateY(0);
  }
}

/* Data change: bounce/pulse effect */
@keyframes barMorph {
  0% {
    transform: scaleX(1) scaleY(1);
    filter: brightness(1);
  }
  25% {
    transform: scaleX(1.08) scaleY(0.95);
    filter: brightness(1.3);
  }
  50% {
    transform: scaleX(0.95) scaleY(1.1);
    filter: brightness(1.15);
  }
  75% {
    transform: scaleX(1.03) scaleY(0.98);
    filter: brightness(1.1);
  }
  100% {
    transform: scaleX(1) scaleY(1);
    filter: brightness(1);
  }
}

/* Pulse animation for empty bars */
@keyframes barPulse {
  0%, 100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.8;
  }
}

/* Chart label animations - only on initial load */
.chart-label {
  animation: labelFadeIn 0.3s ease-out forwards;
  animation-delay: var(--label-delay, 0ms);
  opacity: 0;
  transform: translateY(8px);
}

/* Labels without animation class are already visible */
div:not(.chart-label).text-white\/70 {
  opacity: 1;
  transform: translateY(0);
}

@keyframes labelFadeIn {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Value labels above bars - synchronized with bar animation */
.chart-value-label {
  /* Анимация всегда активна */
  animation: valueLabelFadeIn 0.4s ease-out forwards;
  animation-delay: var(--value-delay, 0ms);
  opacity: 0;
  transform: translateY(-4px) scale(0.9);
  
  /* Плавный переход позиции при смене данных */
  transition: bottom 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s ease;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 8px rgba(0, 0, 0, 0.2);
}

@keyframes valueLabelFadeIn {
  0% {
    opacity: 0;
    transform: translateY(-4px) scale(0.9);
  }
  60% {
    opacity: 0.8;
    transform: translateY(1px) scale(1.05);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Smooth height transitions */
.chart-bar:not(.chart-bar--hovered) {
  will-change: height, transform;
}

/* Performance optimizations */
.chart-bar {
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  perspective: 1000px;
  -webkit-perspective: 1000px;
}

/* Loading state shimmer effect */
@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* Metric card animations */
.metric-card {
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 2px solid transparent;
}

.metric-card--active {
  background: rgba(255, 255, 255, 0.2);
  border-color: white;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1);
  transform: translateY(-2px) scale(1.02);
}

.metric-card--inactive {
  background: rgba(255, 255, 255, 0.1);
  border-color: transparent;
}

.metric-card--inactive:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.metric-card--inactive:active {
  transform: translateY(0) scale(0.98);
}

/* Ripple effect on card click */
.metric-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
  opacity: 0;
  transform: scale(0);
  transition: opacity 0.6s, transform 0.6s;
}

.metric-card:active::before {
  opacity: 1;
  transform: scale(1);
  transition: opacity 0s, transform 0.3s;
}

/* Pulse animation for active card during data change */
.metric-card--pulse {
  animation: cardPulse 0.5s ease-in-out;
}

@keyframes cardPulse {
  0% {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
  50% {
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2), 0 0 0 3px rgba(255, 255, 255, 0.3),
                0 0 20px rgba(255, 255, 255, 0.2);
    transform: translateY(-3px) scale(1.03);
  }
  100% {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
}
</style>

<style scoped>
/* РАДИКАЛЬНОЕ переопределение всех стилей */
* {
  box-sizing: border-box !important;
}

.profit-mask-bar {
  position: relative;
  width: 8.5rem;
  height: 2.25rem;
  border-radius: 9999px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.profit-mask-bar::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.32) 0px,
    rgba(255, 255, 255, 0.32) 6px,
    transparent 6px,
    transparent 12px
  );
  opacity: 0.4;
}

</style>
