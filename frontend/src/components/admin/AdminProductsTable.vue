<template>
  <div class="space-y-6">
    <AdminSectionHero
      title="Товары"
      description="Управление товарами в каталоге"
      :icon="CubeIcon"
      eyebrow="Каталог"
      tone="brand"
    >
      <template #actions>
        <button
          v-if="location === 'retail'"
          @click="$emit('create')"
          class="flex items-center justify-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-transparent"
        >
          <PlusIcon class="h-4 w-4" />
          <span>Создать товар</span>
        </button>
      </template>
    </AdminSectionHero>

    <div class="inline-flex w-full flex-col gap-2 rounded-3xl border border-white/70 bg-white/85 p-2 shadow-xl backdrop-blur sm:w-auto sm:flex-row sm:items-center">
      <div class="grid w-full grid-cols-2 rounded-2xl bg-gray-100/80 p-1 sm:w-[360px]">
        <button
          v-for="option in locationOptions"
          :key="option.value"
          type="button"
          :data-test="`location-${option.value}`"
          :aria-pressed="location === option.value"
          :class="[
            'rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-rose-300/70 focus:ring-offset-1',
            location === option.value
              ? 'bg-brand-dark text-white shadow-md'
              : 'text-gray-500 hover:bg-white/70 hover:text-gray-900'
          ]"
          @click="switchLocation(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="hidden h-8 w-px bg-gray-200 sm:block"></div>

      <button
        type="button"
        class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-dark via-rose-500 to-brand-primary px-6 py-3 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-rose-300/70 focus:ring-offset-2 sm:w-auto"
        @click="$emit('transfer', location)"
      >
        <ArrowsRightLeftIcon class="h-5 w-5" />
        Перемещение
      </button>
    </div>

    <div class="relative overflow-hidden rounded-3xl border border-white/60 bg-white/85 p-4 sm:p-6 shadow-xl backdrop-blur space-y-4">
      <div class="pointer-events-none absolute -top-16 -right-14 h-44 w-44 rounded-full bg-rose-200/35 blur-3xl"></div>
      <div class="pointer-events-none absolute bottom-0 left-6 h-28 w-28 rounded-full bg-brand-dark/10 blur-2xl"></div>

      <div class="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
          <div class="relative flex-1 min-w-0">
            <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-rose-300">
              <MagnifyingGlassIcon class="h-5 w-5" />
            </span>
            <input
              v-model="search"
              type="text"
              placeholder="Поиск по названию..."
              class="w-full rounded-2xl border border-white/60 bg-white/85 px-4 py-3 pl-12 text-sm font-medium text-gray-900 shadow-inner transition focus:border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-200/70"
              @input="onSearchInput"
            />
          </div>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
            <div class="flex items-center gap-2">
              <select
                v-model="category"
                class="rounded-2xl border border-white/60 bg-white/85 px-4 py-3 text-sm font-medium text-gray-900 shadow-inner transition focus:border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-200/70"
                @change="onCategoryFilterChange"
              >
                <option value="">Все категории</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-xl border border-white/60 bg-white/85 p-2 text-rose-500 transition hover:bg-white hover:text-rose-600"
                title="Создать категорию"
                @click="openInlineCategoryModal"
              >
                <PlusIcon class="h-4 w-4" />
                <span class="sr-only">Создать категорию</span>
              </button>
            </div>
            <div class="flex items-center gap-2">
              <div ref="groupDropdownTriggerRef" class="relative">
                <button
                  type="button"
                  @click="toggleGroupDropdown"
                  :disabled="!groupFilterOptions.length"
                  class="flex items-center justify-between gap-2 min-w-[180px] rounded-2xl border border-white/60 bg-white/85 px-4 py-3 text-sm font-medium text-gray-900 shadow-inner transition focus:border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-200/70 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <span class="truncate">{{ selectedGroupName }}</span>
                  <svg class="h-4 w-4 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-xl border border-white/60 bg-white/85 p-2 text-rose-500 transition hover:bg-white hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!category"
                :title="category ? 'Создать линейку' : 'Сначала выберите категорию'"
                @click="openInlineGroupModal"
              >
                <PlusIcon class="h-4 w-4" />
                <span class="sr-only">Создать линейку</span>
              </button>
            </div>
          </div>
        </div>

        <div class="hidden lg:flex items-center gap-4">
          <div class="flex items-center gap-1 rounded-2xl border border-white/60 bg-white/85 p-1 shadow-inner">
            <button
              @click="viewMode = 'table'"
              :class="[
                'flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition-all',
                viewMode === 'table'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-500 hover:text-gray-700'
              ]"
              title="Вид таблицы"
            >
              Таблица
            </button>
            <button
              @click="viewMode = 'list'"
              :class="[
                'flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition-all',
                viewMode === 'list'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-500 hover:text-gray-700'
              ]"
              title="Вид списка"
            >
              Список
            </button>
          </div>
        </div>
      </div>

      <!-- Быстрый доступ к линейкам: тот же фильтр, что в выпадающем списке,
           но без разворачивания и поиска. Только для склада: там линейки уже
           отобраны по остатку, а в рознице их сотни и лентой это не листается,
           для неё остаётся выпадающий список с поиском. -->
      <div
        v-if="location === 'warehouse' && groupChipOptions.length"
        class="hidden gap-2 overflow-x-auto pb-1 sm:flex"
        role="group"
        aria-label="Фильтр по линейкам"
      >
        <button
          type="button"
          data-test="product-group-chip"
          class="flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
          :class="group
            ? 'border-white/60 bg-white/85 text-gray-700 hover:border-rose-200'
            : 'border-rose-300 bg-rose-500 text-white'"
          :aria-pressed="!group"
          @click="selectGroupChip('')"
        >
          Все линейки
        </button>
        <button
          v-for="option in groupChipOptions"
          :key="option.id"
          type="button"
          data-test="product-group-chip"
          class="flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
          :class="group === option.id
            ? 'border-rose-300 bg-rose-500 text-white'
            : 'border-white/60 bg-white/85 text-gray-700 hover:border-rose-200'"
          :aria-pressed="group === option.id"
          @click="selectGroupChip(option.id)"
        >
          {{ option.name }}
        </button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
        <div class="flex flex-wrap items-center gap-2">
          <span>Показано {{ total === 0 ? 0 : (to - from + 1) }} из {{ total }}</span>
          <span
            v-if="selectedIds.length"
            class="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-rose-700"
          >
            Выбрано {{ selectedIds.length }}
          </span>
        </div>
        <div class="flex w-full items-center justify-between gap-2 rounded-2xl border border-white/60 bg-white/85 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-gray-500 sm:w-auto sm:justify-end">
          <span>На странице</span>
          <select
            v-model.number="pageSize"
            class="rounded-xl border border-white/60 bg-white/90 px-3 py-1 text-sm font-medium text-gray-900 shadow-inner transition focus:border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-200/70"
            @change="onPageSizeChange"
          >
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 sm:hidden">
        <button
          type="button"
          class="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/60 bg-white/85 px-4 py-2 text-sm font-medium text-gray-700 shadow-inner transition hover:bg-white hover:text-gray-900"
          @click="showFiltersModal = true"
        >
          <FunnelIcon class="h-5 w-5" />
          <span>Фильтры</span>
        </button>
        <div class="flex items-center gap-1 rounded-2xl border border-white/60 bg-white/85 p-1 shadow-inner">
          <button
            @click="viewMode = 'table'"
            :class="[
              'flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition-all',
              viewMode === 'table'
                ? 'bg-white text-gray-900 shadow'
                : 'text-gray-500 hover:text-gray-700'
            ]"
            title="Вид таблицы"
          >
            Таблица
          </button>
          <button
            @click="viewMode = 'list'"
            :class="[
              'flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition-all',
              viewMode === 'list'
                ? 'bg-white text-gray-900 shadow'
                : 'text-gray-500 hover:text-gray-700'
            ]"
            title="Вид списка"
          >
            Список
          </button>
        </div>
      </div>
    </div>

    <div v-if="location === 'retail' && selectedIds.length" class="relative overflow-hidden rounded-3xl border border-rose-200/70 bg-white/90 p-4 sm:p-5 shadow-xl backdrop-blur space-y-3">
      <div class="pointer-events-none absolute -top-12 right-0 h-28 w-28 rounded-full bg-rose-200/35 blur-3xl"></div>
      <div class="pointer-events-none absolute bottom-0 left-4 h-24 w-24 rounded-full bg-brand-dark/10 blur-2xl"></div>
      <div class="relative flex items-center justify-between">
        <span class="text-sm font-semibold text-rose-900">Выбрано: {{ selectedIds.length }}</span>
        <button
          @click="clearSelection"
          class="inline-flex items-center gap-1 rounded-full border border-rose-400/40 bg-white/70 px-3 py-1 text-xs font-semibold text-rose-800 shadow-sm transition hover:border-rose-500/60 hover:bg-white"
        >
          ✕ Отменить
        </button>
      </div>
      <div class="relative grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          @click="batchChangeCategory"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-emerald-400/10 to-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:shadow-md hover:from-emerald-500/25 hover:via-emerald-400/20 hover:to-emerald-500/30"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
          </svg>
          Сменить категорию
        </button>
        <button
          @click="batchChangeGroup"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-500/15 via-purple-400/10 to-purple-500/20 px-3 py-2 text-sm font-semibold text-purple-700 shadow-sm transition hover:shadow-md hover:from-purple-500/25 hover:via-purple-400/20 hover:to-purple-500/30"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 5a1 1 0 011-1h4.382a1 1 0 01.894.553L11 6h9a1 1 0 011 1v2a1 1 0 01-1 1h-1.382l-1.447 2.894A1 1 0 0116.236 13H11l-.724 1.447A1 1 0 019.382 15H5a1 1 0 01-1-1V5z" />
          </svg>
          Назначить линейку
        </button>
        <button
          @click="batchDelete"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500/15 via-red-500/10 to-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:shadow-md hover:from-rose-500/25 hover:via-red-500/20 hover:to-rose-500/30"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
          Удалить
        </button>
      </div>
    </div>

    <!-- Table View -->
    <div v-if="viewMode === 'table'" class="relative overflow-hidden rounded-3xl border border-white/70 bg-white shadow-xl">
      <div ref="tableScrollContainer" class="relative overflow-x-auto">
        <table ref="tableRef" class="w-full text-left text-sm">
          <colgroup>
            <col v-for="(width, index) in displayedColumnWidths" :key="index" :style="width ? { width: `${width}px` } : undefined" />
          </colgroup>
          <thead class="bg-white border-b border-rose-100">
            <tr class="text-gray-600">
              <th class="w-12 px-4 py-3" :style="columnStyle(0)">
                <input
                  v-if="location === 'retail'"
                  type="checkbox"
                  :checked="isAllSelected"
                  @change="toggleSelectAll"
                  class="rounded border-rose-200 text-brand-dark focus:ring-brand-dark"
                >
              </th>

              <th
                class="p-0 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(1)"
                :aria-sort="ariaSort('title')"
              >
                <button
                  type="button"
                  :class="sortButtonClass('title')"
                  @click="toggleSort('title')"
                >
                  <span>Товар</span>
                  <span class="text-[10px] leading-none" :class="sortIndicatorClass('title')">{{ sortIndicator('title') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(2)"
                :aria-sort="ariaSort('category')"
              >
                <button
                  type="button"
                  :class="sortButtonClass('category')"
                  @click="toggleSort('category')"
                >
                  <span>Категория</span>
                  <span class="text-[10px] leading-none" :class="sortIndicatorClass('category')">{{ sortIndicator('category') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(3)"
                :aria-sort="ariaSort('group')"
              >
                <button
                  type="button"
                  :class="sortButtonClass('group')"
                  @click="toggleSort('group')"
                >
                  <span>Линейка</span>
                  <span class="text-[10px] leading-none" :class="sortIndicatorClass('group')">{{ sortIndicator('group') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(4)"
                :aria-sort="ariaSort('strength')"
              >
                <button
                  type="button"
                  :class="sortButtonClass('strength')"
                  @click="toggleSort('strength')"
                >
                  <span>Крепость</span>
                  <span class="text-[10px] leading-none" :class="sortIndicatorClass('strength')">{{ sortIndicator('strength') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(5)"
                :aria-sort="ariaSort('costPrice')"
              >
                <button
                  type="button"
                  :class="sortButtonClass('costPrice')"
                  @click="toggleSort('costPrice')"
                >
                  <span>Себес</span>
                  <span class="text-[10px] leading-none" :class="sortIndicatorClass('costPrice')">{{ sortIndicator('costPrice') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(6)"
                :aria-sort="ariaSort('stock')"
              >
                <button
                  type="button"
                  :class="sortButtonClass('stock')"
                  @click="toggleSort('stock')"
                >
                  <span>Остаток</span>
                  <span class="text-[10px] leading-none" :class="sortIndicatorClass('stock')">{{ sortIndicator('stock') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(7)"
                :aria-sort="ariaSort('priceRub')"
              >
                <button
                  type="button"
                  :class="sortButtonClass('priceRub')"
                  @click="toggleSort('priceRub')"
                >
                  <span>Цена</span>
                  <span class="text-[10px] leading-none" :class="sortIndicatorClass('priceRub')">{{ sortIndicator('priceRub') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-right text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-gray-500 whitespace-normal break-words"
                :style="columnStyle(8)"
              >Действия</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-rose-50">
            <tr v-if="isLoading">
              <td colspan="9" class="py-8 text-center text-gray-600">Загрузка...</td>
            </tr>
            <template v-for="p in paged" :key="p.id">
            <tr
              class="transition-colors hover:bg-rose-50/50"
              :class="[
                selectedIds.includes(p.id) ? 'bg-rose-50/70' : '',
                isBelowMin(p) ? 'ring-1 ring-rose-200 ring-inset' : ''
              ]"
            >
            <td class="px-4 py-4" :style="columnStyle(0)">
              <div class="flex items-center gap-2">
                <button
                  v-if="p.hasVariants && p.variants && p.variants.length > 0"
                  @click="toggleProductExpansion(p.id)"
                  class="flex items-center justify-center w-5 h-5 rounded hover:bg-rose-100 transition-colors"
                  :title="isProductExpanded(p.id) ? 'Свернуть' : 'Развернуть'"
                >
                  <svg
                    class="w-3 h-3 text-gray-600 transition-transform"
                    :class="{ 'rotate-90': isProductExpanded(p.id) }"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                  </svg>
                </button>
                <input
                  v-if="location === 'retail'"
                  type="checkbox"
                  :checked="selectedIds.includes(p.id)"
                  @change="toggleSelect(p.id)"
                  class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark"
                >
              </div>
            </td>
            <td class="px-4 py-4 min-w-[220px]" :style="columnStyle(1)">
              <div class="flex items-center gap-3 min-w-0">
                <img :src="getProductCover(p)" class="w-12 h-12 object-cover rounded border" />
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-gray-900 truncate">{{ p.title || p.id }}</span>
                    <span
                      v-if="discountBadge(p)"
                      data-test="product-discount-badge"
                      class="flex-shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[0.65rem] font-bold text-white"
                      :title="discountTitle(p)"
                    >{{ discountBadge(p) }}</span>
                  </div>
                  <div v-if="p.description" class="text-xs text-gray-500 truncate">{{ p.description }}</div>
                </div>
              </div>
            </td>
            <td class="px-4 py-4 text-gray-700" :style="columnStyle(2)">{{ categoryName(p.categoryId) }}</td>
            <td class="px-4 py-4 text-gray-700" :style="columnStyle(3)">
              <span v-if="p.groupName">{{ p.groupName }}</span>
              <span v-else class="text-gray-400">Без линейки</span>
            </td>
            <td class="px-4 py-4 text-gray-700" :style="columnStyle(4)">
              <span v-if="p.strength && p.strength.trim().length && p.strength !== '0'" class="font-medium text-gray-900">{{ p.strength }}</span>
              <span v-else class="text-gray-400">Без крепости</span>
            </td>
            <td class="px-4 py-4 text-right text-gray-700 min-w-[100px]" :style="columnStyle(5)">
              <div class="flex items-center justify-center">
                <span v-if="profitUnlocked" class="font-medium text-gray-900">{{ formatRub(p.costPrice) }}</span>
                <span
                  v-else
                  class="inline-flex items-center rounded-full bg-gray-100 p-1"
                  :aria-label="`Себестоимость скрыта`"
                >
                  <LockClosedIcon class="h-4 w-4 text-gray-400" />
                </span>
              </div>
            </td>
            <td class="px-4 py-4 text-right" :style="columnStyle(6)">
              <div class="flex items-center justify-end gap-2 whitespace-nowrap">
                <span v-if="p.hasVariants" :class="isBelowMin(p) ? 'text-red-600 font-semibold' : 'text-gray-900 font-medium'">
                  {{ productStockLabel(p) }}
                </span>
                <span v-else :class="isBelowMin(p) ? 'text-red-600 font-semibold' : 'text-gray-900 font-medium'">
                  {{ displayProductStock(p) }}
                </span>
                <span v-if="location === 'retail' && Number(p.minStock ?? 0) > 0" class="text-xs text-gray-500 whitespace-nowrap">
                  мин. {{ Number(p.minStock ?? 0) }}
                </span>
              </div>
            </td>
            <td class="px-4 py-4 text-right text-gray-700" :style="columnStyle(7)">
              <span v-if="!p.hasVariants">{{ formatRub(p.priceRub) }}</span>
              <span v-else class="text-[0.8em]">Вар-ты</span>
            </td>
            <td class="px-4 py-4 text-right" :style="columnStyle(8)">
              <div class="flex items-center justify-end gap-2">
                <button
                  v-if="location === 'retail'"
                  data-test="product-discount-button"
                  @click="$emit('discount', p)"
                  class="rounded-full p-2 transition"
                  :class="activeDiscount(p)
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 hover:text-rose-800'"
                  :title="activeDiscount(p) ? discountTitle(p) : 'Поставить скидку'"
                >
                  <span class="block h-4 w-4 text-center text-xs font-black leading-4">%</span>
                </button>
                <button 
                  v-if="location === 'retail'"
                  @click="$emit('edit', p)" 
                  class="rounded-full bg-blue-500/10 p-2 text-blue-600 transition hover:bg-blue-500/20 hover:text-blue-800"
                  title="Редактировать"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                </button>
                <button 
                  v-if="location === 'retail'"
                  @click="$emit('delete', p)" 
                  class="rounded-full bg-rose-500/10 p-2 text-rose-600 transition hover:bg-rose-500/20 hover:text-rose-800"
                  title="Удалить"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            </td>
          </tr>

          <!-- Variant rows -->
          <template v-if="p.hasVariants && p.variants && p.variants.length > 0 && isProductExpanded(p.id)">
            <tr
              v-for="(variant, vIndex) in p.variants"
              :key="`${p.id}-variant-${vIndex}`"
              class="bg-rose-50/30 transition-colors hover:bg-rose-50/50"
            >
              <td class="px-4 py-3" :style="columnStyle(0)">
                <!-- Пустая ячейка или индикатор вложенности -->
                <div class="pl-7 text-gray-400 text-xs">└</div>
              </td>
              <td class="px-4 py-3 min-w-[220px]" :style="columnStyle(1)">
                <div class="flex items-center gap-3 min-w-0 pl-4">
                  <!-- Картинка цвета -->
                  <div
                    v-if="variant.colorImage"
                    class="w-6 h-6 rounded-full border-2 border-white shadow-sm flex-shrink-0 overflow-hidden"
                    :title="variant.name"
                  >
                    <img :src="variant.colorImage" class="w-full h-full object-cover" alt="" />
                  </div>
                  <!-- Цвет -->
                  <div
                    v-else-if="variant.colorCode"
                    class="w-6 h-6 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                    :style="{ backgroundColor: variant.colorCode }"
                    :title="variant.name"
                  ></div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-700 truncate">{{ variant.name }}</span>
                      <span
                        v-if="variantDiscountBadge(p, variant)"
                        data-test="variant-discount-badge"
                        class="flex-shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[0.65rem] font-bold text-white"
                        :title="variantDiscountTitle(p, variant)"
                      >{{ variantDiscountBadge(p, variant) }}</span>
                    </div>
                    <div class="text-xs text-gray-500">Вариант</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-gray-500 text-sm" :style="columnStyle(2)"></td>
              <td class="px-4 py-3 text-gray-500 text-sm" :style="columnStyle(3)"></td>
              <td class="px-4 py-3 text-gray-500 text-sm" :style="columnStyle(4)"></td>
              <td class="px-4 py-3 text-right text-gray-700 min-w-[100px]" :style="columnStyle(5)">
                <div class="flex items-center justify-center">
                  <span v-if="profitUnlocked" class="text-sm">{{ formatRub(p.costPrice) }}</span>
                  <span
                    v-else
                    class="inline-flex items-center rounded-full bg-gray-100 p-1"
                    :aria-label="`Себестоимость скрыта`"
                  >
                    <LockClosedIcon class="h-4 w-4 text-gray-400" />
                  </span>
                </div>
              </td>
              <td class="px-4 py-3 text-right" :style="columnStyle(6)">
                <span class="text-sm text-gray-900">{{ displayVariantStock(variant) }}</span>
              </td>
              <td class="px-4 py-3 text-right text-gray-700" :style="columnStyle(7)">
                <span class="text-sm">{{ formatRub(getVariantPrice(p, variant)) }}</span>
              </td>
              <td class="px-4 py-3 text-right" :style="columnStyle(8)">
                <!-- Пустая ячейка для действий варианта -->
              </td>
            </tr>
          </template>
          </template>
            <tr v-if="!isLoading && !paged.length">
              <td colspan="9" class="py-8 text-center text-gray-600">
                {{ location === 'warehouse' && !search && !category && !group ? 'На складе пока нет товаров. Добавьте их через перемещение.' : 'Ничего не найдено' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- List View -->
    <div v-else-if="viewMode === 'list'" class="relative overflow-hidden rounded-3xl border border-white/70 bg-white shadow-xl">
      <div class="relative p-4 bg-white/80 border-b border-rose-100 flex items-center justify-between">
        <div v-if="location === 'retail'" class="flex items-center gap-3">
          <input
            type="checkbox"
            :checked="isAllSelected"
            @change="toggleSelectAll"
            class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark"
          >
          <span class="text-sm text-gray-600">Выбрать все</span>
        </div>
        <span class="text-xs text-gray-500">Показано {{ total === 0 ? 0 : (to - from + 1) }} из {{ total }}</span>
      </div>
      
      <div v-if="isLoading" class="py-12 text-center text-gray-600">
        Загрузка...
      </div>
      
      <div v-else-if="!paged.length" class="py-12 text-center text-gray-600">
        {{ location === 'warehouse' && !search && !category && !group ? 'На складе пока нет товаров. Добавьте их через перемещение.' : 'Ничего не найдено' }}
      </div>
      
      <div v-else class="divide-y divide-rose-50">
        <template v-for="p in paged" :key="p.id">
        <div
          class="p-2 sm:p-4 transition-colors hover:bg-rose-50/50"
          :class="{ 'bg-rose-50/70': selectedIds.includes(p.id) }"
        >
          <!-- Мобильная версия - компактный лейаут -->
          <div class="block sm:hidden">
            <div class="flex gap-2">
              <div class="flex flex-col gap-1 items-center">
                <button
                  v-if="p.hasVariants && p.variants && p.variants.length > 0"
                  @click="toggleProductExpansion(p.id)"
                  class="flex items-center justify-center w-5 h-5 rounded hover:bg-rose-100 transition-colors touch-manipulation"
                  :title="isProductExpanded(p.id) ? 'Свернуть' : 'Развернуть'"
                >
                  <svg
                    class="w-3 h-3 text-gray-600 transition-transform"
                    :class="{ 'rotate-90': isProductExpanded(p.id) }"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                  </svg>
                </button>
                <input
                  v-if="location === 'retail'"
                  type="checkbox"
                  :checked="selectedIds.includes(p.id)"
                  @change="toggleSelect(p.id)"
                  class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark w-4 h-4 touch-manipulation"
                >
              </div>
              <img
                :src="getProductCover(p)"
                class="w-12 h-12 object-cover rounded border flex-shrink-0"
              />
              <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start gap-2">
                  <div class="flex-1 min-w-0">
                    <h3 class="text-sm font-medium text-gray-900 truncate leading-tight">
                      {{ p.title || p.id }}
                    </h3>
                    <div class="mt-0.5">
                    <p class="text-xs text-gray-500 leading-snug">
                      {{ categoryName(p.categoryId) }}
                    </p>
                    <p v-if="p.groupName" class="text-xs text-purple-600 leading-snug">
                      Линейка: <span class="font-semibold">{{ p.groupName }}</span>
                    </p>
                    <p v-if="p.strength && p.strength.trim() && p.strength !== '0'" class="text-xs text-gray-600 leading-snug">
                      Крепость: <span class="font-semibold text-gray-900">{{ p.strength }}</span>
                    </p>
                    <p class="text-base text-gray-900 mt-0.5 flex items-center gap-1.5">
                      <span v-if="!p.hasVariants">{{ formatRub(p.priceRub) }}</span>
                      <span v-else class="inline-flex items-center rounded-full bg-purple-100 px-1.5 py-0.5 text-[0.6rem] font-semibold text-purple-700">
                        индивид
                      </span>
                    </p>
                    <p class="text-xs text-gray-600 leading-snug">
                      Себес:
                      <span v-if="profitUnlocked" class="font-semibold">{{ formatRub(p.costPrice) }}</span>
                      <span v-else class="inline-flex items-center rounded-full bg-gray-100 p-0.5">
                        <LockClosedIcon class="h-3.5 w-3.5 text-gray-400" />
                      </span>
                    </p>
                    <p class="text-xs leading-snug" :class="isBelowMin(p) ? 'text-red-600 font-semibold' : 'text-gray-600'">
                      Остаток: {{ displayStockLabel(p) }}<span v-if="location === 'retail' && Number(p.minStock ?? 0) > 0"> / мин. {{ Number(p.minStock ?? 0) }}</span>
                    </p>
                    </div>
                  </div>
                  <!-- Компактные кнопки действий в вертикальной группе -->
                  <div class="flex flex-col gap-1 flex-shrink-0">
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('edit', p)" 
                      class="flex items-center justify-center rounded-full bg-blue-500/10 p-1.5 text-blue-600 transition-colors hover:bg-blue-500/20 hover:text-blue-800 touch-manipulation"
                      title="Редактировать"
                    >
                      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13.586 3.586a2 2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('delete', p)" 
                      class="flex items-center justify-center rounded-full bg-rose-500/10 p-1.5 text-rose-600 transition-colors hover:bg-rose-500/20 hover:text-rose-800 touch-manipulation"
                      title="Удалить"
                    >
                      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Десктопная версия - горизонтальный лейаут -->
            <div class="hidden sm:flex items-start gap-4">
            <div class="flex flex-col gap-2 items-center mt-1">
              <button
                v-if="p.hasVariants && p.variants && p.variants.length > 0"
                @click="toggleProductExpansion(p.id)"
                class="flex items-center justify-center w-6 h-6 rounded hover:bg-rose-100 transition-colors"
                :title="isProductExpanded(p.id) ? 'Свернуть' : 'Развернуть'"
              >
                <svg
                  class="w-4 h-4 text-gray-600 transition-transform"
                  :class="{ 'rotate-90': isProductExpanded(p.id) }"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                </svg>
              </button>
              <input
                v-if="location === 'retail'"
                type="checkbox"
                :checked="selectedIds.includes(p.id)"
                @change="toggleSelect(p.id)"
                class="rounded border-gray-300 text-brand-dark focus:ring-brand-dark"
              >
            </div>
            <img
              :src="getProductCover(p)"
              class="w-20 h-20 object-cover rounded-lg border flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <h3 class="text-lg font-medium text-gray-900 truncate">
                    {{ p.title || p.id }}
                  </h3>
                  <div class="mt-1 space-y-1">
                    <p v-if="p.description" class="text-sm text-gray-500">
                      {{ p.description }}
                    </p>
                    <p class="text-sm text-gray-600">
                      Категория: <span class="font-medium">{{ categoryName(p.categoryId) }}</span>
                    </p>
                    <p v-if="p.groupName" class="text-sm text-purple-600">
                      Линейка: <span class="font-medium">{{ p.groupName }}</span>
                    </p>
                    <p v-if="p.strength && p.strength.trim() && p.strength !== '0'" class="text-sm text-gray-600">
                      Крепость: <span class="font-medium text-gray-900">{{ p.strength }}</span>
                    </p>
                    <div class="flex flex-wrap gap-4 text-sm">
                      <span class="text-gray-600">
                        Себес:
                        <span v-if="profitUnlocked" class="font-medium">{{ formatRub(p.costPrice) }}</span>
                        <span
                          v-else
                          class="inline-flex items-center rounded-full bg-gray-100 p-1"
                          :aria-label="`Себестоимость скрыта`"
                        >
                          <LockClosedIcon class="h-4 w-4 text-gray-400" />
                        </span>
                      </span>
                      <span :class="isBelowMin(p) ? 'text-red-600 font-semibold' : 'text-gray-600'">
                        Остаток: {{ displayStockLabel(p) }}<span v-if="location === 'retail' && Number(p.minStock ?? 0) > 0"> / мин. {{ Number(p.minStock ?? 0) }}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-4">
                  <div class="text-right">
                    <div class="text-xl text-gray-900 flex items-center gap-2">
                      <span v-if="!p.hasVariants">{{ formatRub(p.priceRub) }}</span>
                      <span v-else class="inline-flex items-center rounded-full bg-purple-100 px-2 py-1 text-[0.7rem] font-semibold text-purple-700">
                        индивид
                      </span>
                    </div>
                  </div>
                <div class="flex items-center gap-2">
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('edit', p)" 
                    class="rounded-full bg-blue-500/10 p-2 text-blue-600 transition hover:bg-blue-500/20 hover:text-blue-800"
                      title="Редактировать"
                    >
                      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('delete', p)" 
                    class="rounded-full bg-rose-500/10 p-2 text-rose-600 transition hover:bg-rose-500/20 hover:text-rose-800"
                      title="Удалить"
                    >
                      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Variants list (for both mobile and desktop) -->
          <div v-if="p.hasVariants && p.variants && p.variants.length > 0 && isProductExpanded(p.id)" class="mt-3 space-y-2">
            <div class="border-t border-rose-100 pt-3">
              <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">Варианты товара</h4>
              <div class="space-y-2">
                <div
                  v-for="(variant, vIndex) in p.variants"
                  :key="`${p.id}-variant-list-${vIndex}`"
                  class="bg-rose-50/40 rounded-lg p-3 hover:bg-rose-50/60 transition-colors"
                >
                  <div class="flex items-start gap-3">
                    <!-- Картинка цвета -->
                    <div
                      v-if="variant.colorImage"
                      class="w-8 h-8 rounded-full border-2 border-white shadow-sm flex-shrink-0 overflow-hidden"
                      :title="variant.name"
                    >
                      <img :src="variant.colorImage" class="w-full h-full object-cover" alt="" />
                    </div>
                    <!-- Цвет -->
                    <div
                      v-else-if="variant.colorCode"
                      class="w-8 h-8 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                      :style="{ backgroundColor: variant.colorCode }"
                      :title="variant.name"
                    ></div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-2">
                        <div class="flex-1">
                          <div class="text-sm font-medium text-gray-900">{{ variant.name }}</div>
                          <div class="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs">
                            <div class="text-gray-600">
                              <span class="font-medium">Себес:</span>
                              <span v-if="profitUnlocked" class="ml-1">{{ formatRub(p.costPrice) }}</span>
                              <LockClosedIcon v-else class="inline h-3 w-3 text-gray-400 ml-1" />
                            </div>
                            <div class="text-gray-600">
                              <span class="font-medium">Цена:</span>
                              <span class="ml-1">{{ formatRub(getVariantPrice(p, variant)) }}</span>
                            </div>
                            <div class="text-gray-600">
                              <span class="font-medium">Остаток:</span>
                              <span class="ml-1">{{ displayVariantStock(variant) }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </template>
      </div>
    </div>
    
    <!-- Help text -->
    <div class="relative overflow-hidden rounded-2xl border border-dashed border-rose-200/60 bg-rose-50/40 px-6 py-3 text-center text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-rose-500 shadow-inner">
      <div class="relative">
        {{ location === 'warehouse' ? 'На сайте показывается только розничный остаток.' : 'Используйте чекбоксы для массовых операций с товарами.' }}
      </div>
    </div>

    <!-- Category Change Modal -->
    <div v-if="showCategoryModal" class="fixed inset-0 bg-white/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Сменить категорию</h3>
        <p class="text-sm text-gray-600 mb-4">Выбрано товаров: {{ selectedIds.length }}</p>
        
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">Новая категория</label>
          <select 
            v-model="selectedCategoryId"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent"
          >
            <option value="">Выберите категорию</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        
        <div class="flex justify-end gap-3">
          <button 
            @click="cancelCategoryChange"
            class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Отмена
          </button>
          <button 
            @click="confirmCategoryChange"
            :disabled="!selectedCategoryId"
            class="px-4 py-2 text-sm bg-brand-dark text-white rounded-lg hover:bg-brand-dark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Применить
          </button>
        </div>
      </div>
    </div>

    <!-- Group Change Modal -->
    <div v-if="showGroupModal" class="fixed inset-0 bg-white/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Назначить линейку</h3>
        <p class="text-sm text-gray-600 mb-4">Выбрано товаров: {{ selectedIds.length }}</p>

        <div class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Категория</label>
            <select
              v-model="groupModalCategoryId"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent"
            >
              <option value="">Выберите категорию</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Линейка</label>
            <select
              v-model="selectedGroupId"
              :disabled="!groupModalCategoryId || groupModalLoading"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">Без линейки</option>
              <option v-for="group in modalGroupOptions" :key="group.id" :value="group.id">
                {{ group.name }}
              </option>
            </select>
            <p v-if="groupModalLoading" class="text-xs text-gray-500 mt-2 animate-pulse">Загружаем список линеек…</p>
            <p v-else-if="groupModalCategoryId && !modalGroupOptions.length" class="text-xs text-gray-500 mt-2">
              Для выбранной категории пока нет линеек.
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            @click="cancelGroupChange"
            class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Отмена
          </button>
          <button
            @click="confirmGroupChange"
            :disabled="!groupModalCategoryId"
            class="px-4 py-2 text-sm bg-brand-dark text-white rounded-lg hover:bg-brand-dark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Применить
          </button>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div class="pt-6">
      <div class="mx-auto flex w-full max-w-sm items-center justify-center gap-3 rounded-2xl border border-white/60 bg-white/90 px-4 py-3 text-sm font-semibold text-gray-700 shadow-lg shadow-rose-100/40 backdrop-blur">
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-rose-100/70 bg-white/75 px-4 py-2 text-xs uppercase tracking-[0.25em] text-gray-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-200/60 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-white"
          :disabled="page <= 1"
          @click="go(page - 1)"
        >
          Назад
        </button>
        <div class="rounded-xl border border-white/70 bg-white px-5 py-2 text-xs uppercase tracking-[0.35em] text-gray-500 shadow-inner">
          Стр. {{ page }} / {{ totalPages }}
        </div>
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-rose-100/70 bg-white/75 px-4 py-2 text-xs uppercase tracking-[0.25em] text-gray-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-200/60 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-white"
          :disabled="page >= totalPages"
          @click="go(page + 1)"
        >
          Вперёд
        </button>
      </div>
    </div>
    
    <!-- Filters Modal (mobile) -->
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showFiltersModal"
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center"
        v-safe-backdrop-close="closeFiltersModal"
      >
        <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-lg font-semibold text-gray-900">Фильтры</h3>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
              @click="closeFiltersModal"
            >
              <XMarkIcon class="h-5 w-5" />
              <span class="sr-only">Закрыть</span>
            </button>
          </div>

          <div class="mt-4 space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700">Поиск</label>
              <input
                v-model="search"
                type="text"
                placeholder="Поиск по названию..."
                class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-primary"
                @input="onSearchInput"
              />
            </div>

            <div class="space-y-3">
              <label class="text-sm font-medium text-gray-700">Категория и линейка</label>
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2">
                  <select
                    v-model="category"
                    class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-primary"
                    @change="onCategoryFilterChange"
                  >
                    <option value="">Все категории</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                  <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-600 transition hover:bg-gray-100 hover:text-gray-800"
                    title="Создать категорию"
                    @click="handleFiltersModalAction('category')"
                  >
                    <PlusIcon class="h-4 w-4" />
                    <span class="sr-only">Создать категорию</span>
                  </button>
                </div>
                <div class="space-y-2">
                  <div class="relative">
                    <MagnifyingGlassIcon class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      v-model="mobileGroupSearchQuery"
                      type="text"
                      placeholder="Поиск линейки..."
                      class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-primary"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <select
                      v-model="group"
                      :disabled="!groupFilterOptions.length"
                      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-primary disabled:bg-gray-100 disabled:text-gray-400"
                      @change="onFiltersChanged"
                    >
                      <option value="">Все линейки</option>
                      <option v-for="option in mobileFilteredGroupOptions" :key="option.id" :value="option.id">
                        {{ option.name }}
                      </option>
                    </select>
                    <button
                      type="button"
                      class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-600 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="!category"
                      :title="category ? 'Создать линейку' : 'Сначала выберите категорию'"
                      @click="handleFiltersModalAction('group')"
                    >
                      <PlusIcon class="h-4 w-4" />
                      <span class="sr-only">Создать линейку</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700">Показывать на странице</label>
              <select
                v-model.number="pageSize"
                class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-brand-primary"
                @change="onPageSizeChange"
              >
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
              </select>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-gray-700">Режим отображения</label>
              <div class="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
                <button
                  @click="viewMode = 'table'"
                  :class="[
                    'flex flex-1 items-center justify-center rounded-md p-2 transition-all',
                    viewMode === 'table' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700'
                  ]"
                  title="Вид таблицы"
                >
                  <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h5a1 1 0 000-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM13 16a1 1 0 102 0v-5.586l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 101.414 1.414L13 10.414V16z"/>
                  </svg>
                </button>
                <button
                  @click="viewMode = 'list'"
                  :class="[
                    'flex flex-1 items-center justify-center rounded-md p-2 transition-all',
                    viewMode === 'list' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700'
                  ]"
                  title="Вид списка"
                >
                  <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark/90"
              @click="closeFiltersModal"
            >
              Готово
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>

  <Teleport to="body">
    <div
      v-if="showBottomScrollbar && bottomScrollbarWidth > 0"
      class="pointer-events-none fixed bottom-0 z-[60]"
      :style="bottomScrollbarStyle"
    >
      <div
        ref="bottomScrollRef"
        class="pointer-events-auto h-4 overflow-x-auto overflow-y-hidden rounded-full bg-white/90 shadow-lg ring-1 ring-black/10 backdrop-blur"
      >
        <div class="h-full" :style="{ width: `${bottomScrollContentWidth}px` }"></div>
      </div>
    </div>
  </Teleport>

  <!-- Group dropdown via Teleport -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="showGroupDropdown"
        ref="groupDropdownRef"
        class="fixed z-[100] w-72 rounded-2xl border border-white/60 bg-white shadow-2xl"
        :style="groupDropdownStyle"
      >
        <div class="p-2 border-b border-gray-100">
          <div class="relative">
            <MagnifyingGlassIcon class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref="groupSearchInputRef"
              v-model="groupSearchQuery"
              type="text"
              placeholder="Поиск линейки..."
              class="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-200"
              @keydown.escape="closeGroupDropdown"
              @keydown.enter="selectFirstFilteredGroup"
            />
          </div>
        </div>
        <div class="max-h-72 overflow-y-auto py-1 bg-white">
          <button
            type="button"
            @click="selectGroup('')"
            :class="[
              'w-full px-3 py-2 text-left text-sm transition bg-white border-0',
              group === '' ? 'text-rose-600 font-medium' : 'text-gray-700 hover:text-rose-600'
            ]"
          >
            Все линейки
          </button>
          <button
            v-for="option in filteredGroupOptions"
            :key="option.id"
            type="button"
            @click="selectGroup(option.id)"
            :class="[
              'w-full px-3 py-2 text-left text-sm transition bg-white border-0',
              group === option.id ? 'text-rose-600 font-medium' : 'text-gray-700 hover:text-rose-600'
            ]"
          >
            {{ option.name }}
          </button>
          <div v-if="filteredGroupOptions.length === 0 && groupSearchQuery" class="px-3 py-4 text-center text-sm text-gray-500">
            Ничего не найдено
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { PlusIcon, FunnelIcon, XMarkIcon, CubeIcon, MagnifyingGlassIcon, LockClosedIcon, ArrowsRightLeftIcon } from '@heroicons/vue/24/outline'
import AdminSectionHero from '@/components/admin/layout/AdminSectionHero.vue'
import { useAdminStore } from '@/stores/admin'
import { useCrmStore } from '@/stores/crm'
import { storeToRefs } from 'pinia'
import { discountPercent } from '@/components/product/groupPrice'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

interface ProductLink { label?: string; url: string }
interface Category { id: string; name: string }
interface ProductVariant {
  id?: string
  product_id?: string
  name: string
  colorCode?: string | null
  colorImage?: string | null
  priceRub?: number | null
  stock?: number
  warehouseStock?: number
  locationStock?: number
  position?: number
  images: string[]
}
interface Product {
  id: string
  categoryId: string
  groupId?: string | null
  groupName?: string | null
  groupImage?: string | null
  categoryImage?: string | null
  title?: string
  description?: string
  priceRub: number
  createdAt?: string
  images?: string[]
  links?: ProductLink[]
  strength?: string | null
  costPrice?: number
  stock?: number
  warehouseStock?: number
  locationStock?: number
  minStock?: number
  hasVariants?: boolean
  variants?: ProductVariant[]
}
interface Pagination { page: number; limit: number; total: number; totalPages: number }

type SortKey = 'title' | 'category' | 'group' | 'strength' | 'costPrice' | 'stock' | 'priceRub'
type SortDirection = 'asc' | 'desc'

const props = withDefaults(defineProps<{
  products: Product[]
  categories: Category[]
  pagination?: Pagination
  isLoading?: boolean
  location?: 'retail' | 'warehouse'
  availableGroups?: Array<{ id: string; name: string; categoryId: string }>
}>(), { isLoading: false, location: 'retail', availableGroups: () => [] })

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'edit', p: Product): void
  (e: 'discount', p: Product): void
  (e: 'delete', p: Product): void
  (e: 'changePage', page: number): void
  (e: 'changePageSize', limit: number): void
  (e: 'filters', v: { search: string; category: string; group: string }): void
  (e: 'changeLocation', location: 'retail' | 'warehouse'): void
  (e: 'transfer', location: 'retail' | 'warehouse'): void
  (e: 'batchDelete', ids: string[]): void
  (e: 'batchChangeCategory', ids: string[], categoryId: string): void
  (e: 'batchChangeGroup', ids: string[], payload: { categoryId: string; groupId: string | null }): void
  (e: 'createCategory'): void
  (e: 'createGroup', payload: { categoryId: string | null }): void
}>()

const search = ref('')
const category = ref('')
const group = ref('')
const pageSize = ref(props.pagination?.limit || 10)
const page = ref(props.pagination?.page || 1)
const selectedIds = ref<string[]>([])
const showCategoryModal = ref(false)
const selectedCategoryId = ref('')
const isMobile = ref(false)
const viewMode = ref<'table' | 'list'>('table')
const isInitialized = ref(false)
const expandedProductIds = ref<Set<string>>(new Set())
const adminStore = useAdminStore()
const crmStore = useCrmStore()
const { profitUnlocked } = storeToRefs(crmStore)
const showGroupModal = ref(false)
const selectedGroupId = ref('')
const groupModalCategoryId = ref('')
const sortKey = ref<SortKey | null>(null)
const sortDirection = ref<SortDirection>('asc')
const groupModalLoading = ref(false)
const modalFetchedCategories = new Set<string>()
const showFiltersModal = ref(false)
const showGroupDropdown = ref(false)
const groupSearchQuery = ref('')
const groupDropdownRef = ref<HTMLDivElement | null>(null)
const groupDropdownTriggerRef = ref<HTMLDivElement | null>(null)
const groupSearchInputRef = ref<HTMLInputElement | null>(null)
const groupDropdownPosition = ref({ top: 0, left: 0 })
const showMobileGroupDropdown = ref(false)
const mobileGroupSearchQuery = ref('')
const mobileGroupDropdownRef = ref<HTMLDivElement | null>(null)
const tableRef = ref<HTMLTableElement | null>(null)
const tableScrollContainer = ref<HTMLDivElement | null>(null)
const bottomScrollRef = ref<HTMLDivElement | null>(null)
const showBottomScrollbar = ref(false)
const bottomScrollbarLeft = ref(16)
const bottomScrollbarWidth = ref(0)
const bottomScrollContentWidth = ref(0)
const locationOptions = [
  { value: 'retail' as const, label: 'Розница' },
  { value: 'warehouse' as const, label: 'Склад' },
]

const bottomScrollbarStyle = computed(() => ({
  left: `${bottomScrollbarLeft.value}px`,
  width: `${bottomScrollbarWidth.value}px`
}))
const columnWidths = ref<(number | undefined)[]>([])
const COLUMN_COUNT = 9
const displayedColumnWidths = computed(() => {
  if (!columnWidths.value.length) {
    return Array.from({ length: COLUMN_COUNT }, () => undefined)
  }
  if (columnWidths.value.length >= COLUMN_COUNT) {
    return columnWidths.value.slice(0, COLUMN_COUNT)
  }
  return [...columnWidths.value, ...Array.from({ length: COLUMN_COUNT - columnWidths.value.length }, () => undefined)]
})
let measureRaf: number | null = null
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const groupFilterOptions = computed(() => {
  const currentCategory = category.value
  const allGroups = props.location === 'warehouse'
    ? props.availableGroups
    : (adminStore.categoryGroups || [])
  const filtered = currentCategory
    ? allGroups.filter(g => g.categoryId === currentCategory)
    : allGroups
  return filtered.map(g => ({
    id: g.id,
    name: g.name,
    categoryId: g.categoryId
  })).sort((a, b) => a.name.localeCompare(b.name))
})

/**
 * Линейки для ленты чипов. Если остаток у выбранной линейки обнулился, она
 * выпадает из списка склада, поэтому дописываем её первой: иначе активный
 * фильтр остался бы без чипа и снять его было бы нечем.
 */
const groupChipOptions = computed(() => {
  const options = groupFilterOptions.value
  if (!group.value || options.some((option) => option.id === group.value)) return options
  const selected = selectedGroupFallback.value
  return selected ? [selected, ...options] : options
})

/** Выбранная линейка, которой уже нет в списке точки. */
const selectedGroupFallback = computed(() => {
  if (!group.value) return null
  const found = (adminStore.categoryGroups || []).find((item) => item.id === group.value)
  return found ? { id: found.id, name: found.name, categoryId: found.categoryId } : null
})

const modalGroupOptions = computed(() => {
  if (!groupModalCategoryId.value) return []
  return (adminStore.categoryGroups || [])
    .filter(group => group.categoryId === groupModalCategoryId.value)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
})

const filteredGroupOptions = computed(() => {
  const query = groupSearchQuery.value.toLowerCase().trim()
  if (!query) return groupFilterOptions.value
  return groupFilterOptions.value.filter(g => g.name.toLowerCase().includes(query))
})

const selectedGroupName = computed(() => {
  if (!group.value) return 'Все линейки'
  const found = groupFilterOptions.value.find(g => g.id === group.value)
  // Линейка могла остаться без остатка и выпасть из списка, но фильтр по ней
  // ещё работает, поэтому имя показываем всё равно.
  return found?.name || selectedGroupFallback.value?.name || 'Все линейки'
})

const groupDropdownStyle = computed(() => ({
  top: `${groupDropdownPosition.value.top}px`,
  left: `${groupDropdownPosition.value.left}px`
}))

function toggleGroupDropdown() {
  if (showGroupDropdown.value) {
    closeGroupDropdown()
  } else {
    openGroupDropdown()
  }
}

function openGroupDropdown() {
  if (!groupDropdownTriggerRef.value) return
  const rect = groupDropdownTriggerRef.value.getBoundingClientRect()
  groupDropdownPosition.value = {
    top: rect.bottom + 4,
    left: rect.left
  }
  showGroupDropdown.value = true
  groupSearchQuery.value = ''
  nextTick(() => {
    groupSearchInputRef.value?.focus()
  })
}

function closeGroupDropdown() {
  showGroupDropdown.value = false
  groupSearchQuery.value = ''
}

function selectGroup(id: string) {
  group.value = id
  closeGroupDropdown()
  onFiltersChanged()
}

function selectFirstFilteredGroup() {
  if (filteredGroupOptions.value.length > 0) {
    selectGroup(filteredGroupOptions.value[0].id)
  } else if (!groupSearchQuery.value) {
    selectGroup('')
  }
}

function handleClickOutsideGroupDropdown(event: MouseEvent) {
  const target = event.target as Node
  if (showGroupDropdown.value) {
    const isInsideDropdown = groupDropdownRef.value?.contains(target)
    const isInsideTrigger = groupDropdownTriggerRef.value?.contains(target)
    if (!isInsideDropdown && !isInsideTrigger) {
      closeGroupDropdown()
    }
  }
  if (mobileGroupDropdownRef.value && !mobileGroupDropdownRef.value.contains(target)) {
    closeMobileGroupDropdown()
  }
}

const mobileFilteredGroupOptions = computed(() => {
  const query = mobileGroupSearchQuery.value.toLowerCase().trim()
  if (!query) return groupFilterOptions.value
  return groupFilterOptions.value.filter(g => g.name.toLowerCase().includes(query))
})

function closeMobileGroupDropdown() {
  showMobileGroupDropdown.value = false
  mobileGroupSearchQuery.value = ''
}

function measureColumnWidths() {
  const table = tableRef.value
  if (!table) return

  const isMeasurable = (row: HTMLTableRowElement) => {
    const cells = Array.from(row.cells)
    if (!cells.length) return false
    if (cells.length === 1 && cells[0].colSpan > 1) return false
    return true
  }

  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'))
  const dataRows = rows.filter(isMeasurable)

  if (!dataRows.length) {
    columnWidths.value = []
    return
  }

  // Заголовки меряем наравне с данными: подписи набраны крупными буквами с
  // разрядкой и почти всегда шире самих значений. Без этого колонка «Остаток»
  // получала ширину по числу «3», а её заголовок вылезал на соседнюю колонку,
  // потому что кнопка сортировки не разрешает перенос строки.
  const headerRows = Array.from(
    table.querySelectorAll<HTMLTableRowElement>('thead tr'),
  ).filter(isMeasurable)
  const measuredRows = [...headerRows, ...dataRows]

  const widths = new Array(COLUMN_COUNT).fill(0)
  const measureContainer = document.createElement('div')
  measureContainer.style.position = 'absolute'
  measureContainer.style.visibility = 'hidden'
  measureContainer.style.pointerEvents = 'none'
  measureContainer.style.zIndex = '-1'
  measureContainer.style.top = '0'
  measureContainer.style.left = '0'
  measureContainer.style.whiteSpace = 'nowrap'
  measureContainer.style.width = 'max-content'
  measureContainer.style.height = '0'
  measureContainer.style.overflow = 'hidden'

  const host = table.parentElement || table
  host.appendChild(measureContainer)

  measuredRows.forEach(row => {
    Array.from(row.cells).forEach((cell: HTMLTableCellElement, index) => {
      if (index >= COLUMN_COUNT) return
      const clone = cell.cloneNode(true) as HTMLElement
      clone.style.width = 'auto'
      clone.style.minWidth = 'max-content'
      clone.style.maxWidth = 'none'
      clone.style.position = 'static'
      clone.style.pointerEvents = 'none'
      measureContainer.appendChild(clone)
      const width = Math.ceil(clone.getBoundingClientRect().width)
      measureContainer.removeChild(clone)
      if (width > widths[index]) {
        widths[index] = width
      }
    })
  })

  measureContainer.remove()
  widths[0] = Math.max(widths[0], 48)
  columnWidths.value = widths.map(value => (value > 0 ? value : undefined))
  updateScrollMetrics()
}

function queueColumnMeasurement() {
  if (viewMode.value !== 'table') {
    columnWidths.value = []
    return
  }
  if (measureRaf !== null) {
    cancelAnimationFrame(measureRaf)
  }
  measureRaf = requestAnimationFrame(() => {
    measureRaf = null
    void nextTick(() => {
      measureColumnWidths()
      updateScrollMetrics()
    })
  })
}

function columnStyle(index: number) {
  const width = displayedColumnWidths.value[index]
  if (!width) return undefined
  // Для колонки "Себес" (index 5) устанавливаем минимальную ширину 100px
  const minWidth = index === 5 ? Math.max(width, 100) : width
  return {
    width: `${width}px`,
    maxWidth: `${width}px`,
    minWidth: `${minWidth}px`
  }
}

// Media query для отслеживания мобильных устройств
const checkIsMobile = () => {
  const next = window.innerWidth < 768
  if (!next) {
    showFiltersModal.value = false
  }
  isMobile.value = next

  // При первой загрузке на мобильных сразу включаем список
  if (!isInitialized.value && next) {
    viewMode.value = 'list'
  }
  isInitialized.value = true
}

onMounted(() => {
  checkIsMobile()
  queueColumnMeasurement()
  void nextTick(() => {
    updateScrollMetrics()
  })
  window.addEventListener('resize', checkIsMobile)
  window.addEventListener('resize', queueColumnMeasurement)
  window.addEventListener('resize', updateScrollMetrics)
  window.addEventListener('scroll', handleWindowScroll, { passive: true })
  document.addEventListener('click', handleClickOutsideGroupDropdown)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkIsMobile)
  window.removeEventListener('resize', queueColumnMeasurement)
  window.removeEventListener('resize', updateScrollMetrics)
  window.removeEventListener('scroll', handleWindowScroll)
  document.removeEventListener('click', handleClickOutsideGroupDropdown)
  detachScrollSync()
  if (windowScrollRaf !== null) {
    cancelAnimationFrame(windowScrollRaf)
    windowScrollRaf = null
  }
  if (measureRaf !== null) {
    cancelAnimationFrame(measureRaf)
    measureRaf = null
  }
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
})

watch(() => props.pagination, (pg) => {
  if (pg) {
    page.value = pg.page
    pageSize.value = pg.limit
  }
  queueColumnMeasurement()
})

watch(() => tableScrollContainer.value, (el, oldEl) => {
  if (el === oldEl) return
  void nextTick(() => {
    updateScrollMetrics()
  })
})

watch(groupModalCategoryId, (val) => {
  selectedGroupId.value = ''
  if (val) {
    void ensureModalGroups(val)
  }
})


function onFiltersChanged() {
  emit('filters', { search: search.value.trim(), category: category.value, group: group.value })
  page.value = 1
  emit('changePage', 1)
}

function switchLocation(nextLocation: 'retail' | 'warehouse') {
  if (nextLocation === props.location) return
  selectedIds.value = []
  group.value = ''
  emit('changeLocation', nextLocation)
  page.value = 1
}

function onSearchInput() {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer)
  }
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    onFiltersChanged()
  }, 300)
}

/**
 * Скидка в строке товара: показываем процент, чтобы менеджер видел глубину
 * скидки сразу, а точную цену и срок кладём в подсказку.
 */
function activeDiscount(product: any): { price: number; untilDate: string | null } | null {
  const own = product?.discount
  const inherited = product?.groupDiscount
  const candidates = [own, inherited].filter((item) => item && item.active)
  if (!candidates.length) return null
  return candidates.reduce((best, item) => (item.price < best.price ? item : best))
}

function discountBadge(product: any): string | null {
  const discount = activeDiscount(product)
  if (!discount) return null
  const percent = discountPercent(Number(product?.priceRub ?? 0), discount.price)
  return percent > 0 ? `-${percent}%` : 'Скидка'
}

function discountTitle(product: any): string {
  const discount = activeDiscount(product)
  if (!discount) return ''
  const until = discount.untilDate ? `, до ${formatDiscountDate(discount.untilDate)}` : ' без срока'
  const source = product?.discount?.active ? 'на товар' : 'на линейку'
  return `Скидка ${source}: ${discount.price} BYN${until}`
}

function variantDiscountBadge(product: any, variant: any): string | null {
  const discount = variant?.discount?.active ? variant.discount : activeDiscount(product)
  if (!discount) return null
  const base = Number(variant?.priceRub ?? product?.priceRub ?? 0)
  const percent = discountPercent(base, discount.price)
  return percent > 0 ? `-${percent}%` : 'Скидка'
}

function variantDiscountTitle(product: any, variant: any): string {
  const discount = variant?.discount?.active ? variant.discount : activeDiscount(product)
  if (!discount) return ''
  const until = discount.untilDate ? `, до ${formatDiscountDate(discount.untilDate)}` : ' без срока'
  return `Скидка: ${discount.price} BYN${until}`
}

/** Дата в привычном виде: в базе она хранится как ГГГГ-ММ-ДД. */
function formatDiscountDate(value: string): string {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

/** Повторный клик по выбранной линейке снимает фильтр. */
function selectGroupChip(groupId: string) {
  const next = group.value === groupId ? '' : groupId
  // Клик по уже активному чипу не должен перезапрашивать список и сбрасывать
  // человека на первую страницу.
  if (next === group.value) return
  group.value = next
  onFiltersChanged()
}

function onCategoryFilterChange() {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  group.value = ''
  onFiltersChanged()
}

function onPageSizeChange() {
  emit('changePageSize', pageSize.value)
}

function openInlineCategoryModal() {
  emit('createCategory')
}

function openInlineGroupModal() {
  emit('createGroup', { categoryId: category.value || null })
}

function closeFiltersModal() {
  showFiltersModal.value = false
}

function handleFiltersModalAction(target: 'category' | 'group') {
  showFiltersModal.value = false
  requestAnimationFrame(() => {
    if (target === 'category') {
      openInlineCategoryModal()
    } else {
      openInlineGroupModal()
    }
  })
}

async function ensureModalGroups(categoryId: string) {
  if (!categoryId || modalFetchedCategories.has(categoryId)) return
  try {
    groupModalLoading.value = true
    await adminStore.fetchCategoryGroups(categoryId)
    modalFetchedCategories.add(categoryId)
  } catch (error) {
    console.error('[AdminProductsTable] Failed to load category groups:', error)
  } finally {
    groupModalLoading.value = false
  }
}

const placeholder = 'https://placehold.co/64x64/f3f4f6/9ca3af?text=IMG'

function getProductCover(product: Product) {
  const fromImages = product.images?.find(src => typeof src === 'string' && src.trim().length > 0)
  if (fromImages) return fromImages

  const fromLinks = product.links?.find(link => typeof link?.url === 'string' && link.url.trim().length > 0)?.url
  if (fromLinks) return fromLinks

  // Фолбэк на изображение группы/категории
  if (product.groupImage) return product.groupImage
  if (product.categoryImage) return product.categoryImage

  return placeholder
}

function isBelowMin(product: Product) {
  if (props.location === 'warehouse') return false
  const min = Number(product.minStock ?? 0)
  if (min <= 0) return false
  
  if (product.hasVariants) {
    // Для товаров с вариантами проверяем минимальный остаток
    const minStock = Number((product as any).minVariantStock ?? 0)
    return minStock <= min
  } else {
    const stock = Number(product.stock ?? 0)
    return stock <= min
  }
}

function displayProductStock(product: Product) {
  return numericValue(product.locationStock ?? (props.location === 'warehouse' ? product.warehouseStock : product.stock))
}

function displayVariantStock(variant: ProductVariant) {
  return numericValue(variant.locationStock ?? (props.location === 'warehouse' ? variant.warehouseStock : variant.stock))
}

function productStockLabel(product: Product) {
  const stocks = (product.variants || []).map(displayVariantStock)
  if (!stocks.length) return '0'
  const min = Math.min(...stocks)
  const max = Math.max(...stocks)
  return min === max ? String(min) : `${min}-${max}`
}

function displayStockLabel(product: Product) {
  return product.hasVariants ? productStockLabel(product) : String(displayProductStock(product))
}

function productSortStock(product: Product) {
  const stocks = (product.variants || []).map(displayVariantStock)
  return stocks.length ? Math.min(...stocks) : 0
}

// Computed для фильтрации (нужен для вычисления selectedIds)
function normalizeString(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeSearchWords(value: unknown) {
  const normalized = normalizeString(value)
  if (!normalized) return []
  const words = normalized.split(/\s+/).filter(word => word.length > 0)
  const unique: string[] = []
  const seen = new Set<string>()
  for (const word of words) {
    if (seen.has(word)) continue
    seen.add(word)
    unique.push(word)
  }
  return unique
}

function numericValue(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

const filteredProducts = computed(() => {
  const words = normalizeSearchWords(search.value)
  const cid = category.value
  const gid = group.value
  return (props.products || []).filter(p => {
    // Skip null/undefined products
    if (!p || !p.id) return false
    const title = normalizeString(p.title)
    const groupName = normalizeString(p.groupName)
    const description = normalizeString(p.description)
    // Поиск по всем словам в названии, описании и названии группы (линейки)
    const bySearch = words.length === 0 || words.every(word =>
      title.includes(word) ||
      groupName.includes(word) ||
      description.includes(word)
    )
    const byCat = !cid || p.categoryId === cid
    const byGroup = !gid || p.groupId === gid
    return bySearch && byCat && byGroup
  })
})

const sortedProducts = computed(() => {
  const key = sortKey.value
  if (!key) {
    return filteredProducts.value.slice()
  }
  const direction = sortDirection.value === 'asc' ? 1 : -1
  return filteredProducts.value.slice().sort((a, b) => {
    switch (key) {
      case 'title':
        return normalizeString(a.title).localeCompare(normalizeString(b.title), 'ru', { sensitivity: 'base' }) * direction
      case 'category':
        return normalizeString(categoryName(a.categoryId)).localeCompare(normalizeString(categoryName(b.categoryId)), 'ru', { sensitivity: 'base' }) * direction
      case 'group':
        return normalizeString(a.groupName).localeCompare(normalizeString(b.groupName), 'ru', { sensitivity: 'base' }) * direction
      case 'strength':
        return normalizeString(a.strength).localeCompare(normalizeString(b.strength), 'ru', { sensitivity: 'base' }) * direction
      case 'costPrice':
        return (numericValue(a.costPrice) - numericValue(b.costPrice)) * direction
      case 'stock': {
        // Для товаров с вариантами сортируем по минимальному остатку
        const stockA = a.hasVariants ? productSortStock(a) : displayProductStock(a)
        const stockB = b.hasVariants ? productSortStock(b) : displayProductStock(b)
        return (stockA - stockB) * direction
      }
      case 'priceRub':
        return (numericValue(a.priceRub) - numericValue(b.priceRub)) * direction
      default:
        return 0
    }
  })
})

const filtered = computed(() => sortedProducts.value)

// Selection logic
const isAllSelected = computed(() => {
  return filteredProducts.value.length > 0 && 
         filteredProducts.value.every(product => selectedIds.value.includes(product.id))
})

const total = computed(() => props.pagination?.total ?? filtered.value.length)
const totalPages = computed(() => props.pagination?.totalPages ?? Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))

const paged = computed(() => {
  if (props.pagination) {
    // Assume server-side pagination; show current list as-is
    // Filter out null/undefined products
    return filtered.value.filter(p => p && p.id)
  }
  const start = (page.value - 1) * pageSize.value
  return filtered.value.filter(p => p && p.id).slice(start, start + pageSize.value)
})

watch(paged, () => {
  queueColumnMeasurement()
}, { deep: true })

watch(filteredProducts, () => {
  queueColumnMeasurement()
}, { deep: true })

watch([sortKey, sortDirection], () => {
  if (!props.pagination) {
    page.value = 1
  }
  queueColumnMeasurement()
})

watch(() => viewMode.value, (next) => {
  if (next === 'table') {
    queueColumnMeasurement()
    void nextTick(() => updateScrollMetrics())
  } else {
    columnWidths.value = []
    updateScrollMetrics()
  }
})

watch(() => props.isLoading, () => {
  queueColumnMeasurement()
})

watch(profitUnlocked, () => {
  queueColumnMeasurement()
})

function go(p: number) {
  const newPage = Math.min(Math.max(1, p), totalPages.value)
  page.value = newPage
  emit('changePage', newPage)
}

const from = computed(() => (total.value === 0 ? 0 : ((page.value - 1) * pageSize.value) + 1))
const to = computed(() => Math.min(page.value * pageSize.value, total.value))

function ariaSort(key: SortKey): 'none' | 'ascending' | 'descending' {
  if (sortKey.value !== key) return 'none'
  return sortDirection.value === 'asc' ? 'ascending' : 'descending'
}

function sortIndicator(key: SortKey) {
  if (sortKey.value === key) {
    return sortDirection.value === 'asc' ? '▲' : '▼'
  }
  return '⇅'
}

const numericSortKeys: SortKey[] = []
const headerMinWidthClasses: Partial<Record<SortKey, string>> = {
  title: 'min-w-[120px]',
  category: 'min-w-[110px]',
  group: 'min-w-[110px]',
  strength: 'min-w-[110px]',
  costPrice: 'min-w-[110px]',
  stock: 'min-w-[110px]',
  priceRub: 'min-w-[110px]'
}

function sortButtonClass(key: SortKey) {
  const isActive = sortKey.value === key
  const alignment = numericSortKeys.includes(key)
    ? 'justify-end text-right'
    : 'justify-start text-left'

  return [
    'flex w-full items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.25em] transition-colors appearance-none border border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/70',
    alignment,
    headerMinWidthClasses[key] ?? '',
    isActive
      ? 'text-brand-dark'
      : 'text-gray-600 hover:text-gray-900',
    'bg-transparent'
  ]
}

function sortIndicatorClass(key: SortKey) {
  const isActive = sortKey.value === key
  return [
    isActive ? 'text-brand-dark' : 'text-rose-400',
    isActive ? 'opacity-100' : 'opacity-60'
  ]
}

let syncingFromTable = false
let syncingFromBottom = false
let containerScrollTarget: HTMLDivElement | null = null
let bottomScrollTarget: HTMLDivElement | null = null
let windowScrollRaf: number | null = null

function updateScrollMetrics() {
  const container = tableScrollContainer.value
  if (!container || viewMode.value !== 'table') {
    showBottomScrollbar.value = false
    bottomScrollContentWidth.value = 0
    bottomScrollbarWidth.value = 0
    detachScrollSync()
    return
  }

  const needsScrollbar = container.scrollWidth > container.clientWidth + 1
  showBottomScrollbar.value = needsScrollbar
  bottomScrollContentWidth.value = container.scrollWidth

  const rect = container.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const safeMargin = 0
  const viewportLeft = safeMargin
  const viewportRight = viewportWidth - safeMargin
  let left = Math.min(Math.max(rect.left, viewportLeft), viewportRight)
  let right = Math.max(left, Math.min(rect.right, viewportRight))
  let width = Math.max(0, right - left)

  if (width < 24) {
    left = viewportLeft
    right = viewportRight
    width = Math.max(0, right - left)
  }

  bottomScrollbarLeft.value = left
  bottomScrollbarWidth.value = width

  if (!needsScrollbar) {
    detachScrollSync()
    return
  }

  attachScrollSync()
  const bottom = bottomScrollRef.value
  if (bottom && !syncingFromTable) {
    syncingFromTable = true
    bottom.scrollLeft = container.scrollLeft
  }
}

function handleContainerScroll() {
  if (syncingFromBottom) {
    syncingFromBottom = false
  } else {
    const bottom = bottomScrollRef.value
    if (bottom) {
      syncingFromTable = true
      bottom.scrollLeft = containerScrollTarget?.scrollLeft ?? 0
    }
  }
  updateScrollMetrics()
  syncingFromTable = false
}

function handleBottomScroll() {
  if (syncingFromTable) {
    syncingFromTable = false
    return
  }
  const container = tableScrollContainer.value
  const bottom = bottomScrollRef.value
  if (!container || !bottom) return
  syncingFromBottom = true
  container.scrollLeft = bottom.scrollLeft
}

function attachScrollSync() {
  const container = tableScrollContainer.value
  const bottom = bottomScrollRef.value
  if (!container || !bottom || !showBottomScrollbar.value) {
    detachScrollSync()
    return
  }

  if (containerScrollTarget !== container) {
    if (containerScrollTarget) {
      containerScrollTarget.removeEventListener('scroll', handleContainerScroll)
    }
    container.addEventListener('scroll', handleContainerScroll, { passive: true })
    containerScrollTarget = container
  }

  if (bottomScrollTarget !== bottom) {
    if (bottomScrollTarget) {
      bottomScrollTarget.removeEventListener('scroll', handleBottomScroll)
    }
    bottom.addEventListener('scroll', handleBottomScroll, { passive: true })
    bottomScrollTarget = bottom
  }
}

function detachScrollSync() {
  if (containerScrollTarget) {
    containerScrollTarget.removeEventListener('scroll', handleContainerScroll)
    containerScrollTarget = null
  }
  if (bottomScrollTarget) {
    bottomScrollTarget.removeEventListener('scroll', handleBottomScroll)
    bottomScrollTarget = null
  }
}

function handleWindowScroll() {
  if (windowScrollRaf !== null) return
  windowScrollRaf = requestAnimationFrame(() => {
    windowScrollRaf = null
    updateScrollMetrics()
  })
}

watch(() => bottomScrollRef.value, () => {
  void nextTick(() => {
    updateScrollMetrics()
  })
})

watch(showBottomScrollbar, (visible) => {
  if (visible) {
    void nextTick(() => {
      attachScrollSync()
      const container = tableScrollContainer.value
      const bottom = bottomScrollRef.value
      if (container && bottom) {
        syncingFromTable = true
        bottom.scrollLeft = container.scrollLeft
      }
    })
  } else {
    detachScrollSync()
  }
})

function toggleSort(key: SortKey) {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortDirection.value = 'asc'
    return
  }

  if (sortDirection.value === 'asc') {
    sortDirection.value = 'desc'
  } else {
    sortKey.value = null
    sortDirection.value = 'asc'
  }
}

function categoryName(id: string) {
  return props.categories.find(c => c.id === id)?.name || '-'
}

function formatRub(value?: number) {
  const numeric = Number(value ?? 0)
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'BYN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number.isFinite(numeric) ? numeric : 0)
}

function toggleProductExpansion(productId: string) {
  if (expandedProductIds.value.has(productId)) {
    expandedProductIds.value.delete(productId)
  } else {
    expandedProductIds.value.add(productId)
  }
  // Триггерим реактивность
  expandedProductIds.value = new Set(expandedProductIds.value)
  // Перемеряем колонки после изменения количества строк
  queueColumnMeasurement()
}

function isProductExpanded(productId: string): boolean {
  return expandedProductIds.value.has(productId)
}

function getVariantPrice(product: Product, variant: ProductVariant): number {
  return variant.priceRub ?? product.priceRub
}

// Selection methods
function toggleSelect(id: string) {
  const index = selectedIds.value.indexOf(id)
  if (index === -1) {
    selectedIds.value.push(id)
  } else {
    selectedIds.value.splice(index, 1)
  }
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = [...filteredProducts.value.map(p => p.id)]
  }
}

function clearSelection() {
  selectedIds.value = []
}

// Batch operations
function batchDelete() {
  if (selectedIds.value.length === 0) return
  if (confirm(`Удалить ${selectedIds.value.length} товаров?`)) {
    emit('batchDelete', [...selectedIds.value])
    clearSelection()
  }
}

function batchChangeCategory() {
  if (selectedIds.value.length === 0) return
  
  // Показываем модальное окно для выбора категории
  showCategoryModal.value = true
}

function batchChangeGroup() {
  if (selectedIds.value.length === 0) return
  const defaultCategory = category.value || (props.products.find(p => p && selectedIds.value.includes(p.id))?.categoryId ?? '')
  showGroupModal.value = true
  groupModalCategoryId.value = defaultCategory
  selectedGroupId.value = ''
  if (defaultCategory) {
    void ensureModalGroups(defaultCategory)
  }
}


// Modal handlers
function confirmCategoryChange() {
  if (selectedCategoryId.value && selectedIds.value.length > 0) {
    emit('batchChangeCategory', [...selectedIds.value], selectedCategoryId.value)
    clearSelection()
    cancelCategoryChange()
  }
}

function cancelCategoryChange() {
  showCategoryModal.value = false
  selectedCategoryId.value = ''
}

function confirmGroupChange() {
  if (!groupModalCategoryId.value || selectedIds.value.length === 0) return
  emit('batchChangeGroup', [...selectedIds.value], {
    categoryId: groupModalCategoryId.value,
    groupId: selectedGroupId.value || null
  })
  clearSelection()
  closeGroupModal()
}

function closeGroupModal() {
  showGroupModal.value = false
  selectedGroupId.value = ''
  groupModalCategoryId.value = ''
}

function cancelGroupChange() {
  closeGroupModal()
}


// Watch props - очищаем выбор при изменении товаров
watch(() => props.products, () => {
  selectedIds.value = []
  queueColumnMeasurement()
}, { deep: true })
</script>
