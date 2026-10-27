<template>
  <div class="crm-ref">
    <!-- Заголовок страницы (как «Заказы») -->
    <div class="crm-ref-heading">
      <h1 class="crm-ref-title">Товары</h1>
      <div class="crm-ref-search">
        <input
          v-model="search"
          type="search"
          placeholder="Поиск по названию, описанию или линейке..."
          class="crm-ref-search-input"
          aria-label="Поиск по товарам"
          @input="onSearchInput"
        />
        <svg
          v-if="!search"
          class="crm-ref-search-icon"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
    </div>

    <!-- Тулбар (как «Заказы») -->
    <div class="crm-ref-toolbar">
      <button
        v-if="location === 'retail'"
        type="button"
        class="crm-ref-button crm-ref-button--primary"
        data-test="create-product"
        @click="$emit('create')"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span>Создать товар</span>
      </button>
      <button
        type="button"
        class="crm-ref-button crm-ref-button--gray"
        @click="$emit('transfer', location)"
      >
        <ArrowsRightLeftIcon class="h-4 w-4" />
        <span>Перемещение</span>
      </button>
      <button
        type="button"
        class="crm-ref-button crm-ref-button--gray"
        data-test="inventory-check"
        title="Пересчитать вкусы линейки и поправить остатки"
        @click="$emit('inventory-check', location)"
      >
        <ClipboardDocumentCheckIcon class="h-4 w-4" />
        <span>Пересорт</span>
      </button>
      <div class="crm-ref-segment" role="group" aria-label="Точка">
        <button
          v-for="option in locationOptions"
          :key="option.value"
          type="button"
          :data-test="`location-${option.value}`"
          :class="{ 'is-active': location === option.value }"
          :aria-pressed="location === option.value"
          @click="switchLocation(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <span class="crm-ref-toolbar-spacer" aria-hidden="true" />
      <span class="crm-ref-counter">{{ total }} всего</span>
      <span v-if="selectedIds.length" class="crm-ref-counter crm-ref-counter--danger">
        Выбрано {{ selectedIds.length }}
      </span>
    </div>

    <!-- Панель фильтров -->
    <div class="crm-ref-card p-5 mb-4">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-3 flex-wrap">
          <!-- Розница: фильтры лентой чипов, как на складе.
               Сначала категории; при выборе категории — линейки этой категории
               (все, включая без остатков — они в конце и приглушены). -->
          <template v-if="location === 'retail'">
            <div class="flex items-center gap-2 min-w-0">
              <button
                type="button"
                class="crm-ref-chip-button !rounded-full !py-2 flex-shrink-0"
                :class="!category ? 'crm-ref-chip-button--primary' : ''"
                :aria-pressed="!category"
                data-test="retail-category-chip"
                @click="selectRetailCategory('')"
              >
                Все категории
              </button>
              <button
                v-for="c in categories"
                :key="c.id"
                type="button"
                class="crm-ref-chip-button !rounded-full !py-2 flex-shrink-0"
                :class="category === c.id ? 'crm-ref-chip-button--primary' : ''"
                :aria-pressed="category === c.id"
                data-test="retail-category-chip"
                @click="selectRetailCategory(c.id)"
              >
                {{ c.name }}
              </button>
              <button
                type="button"
                class="crm-ref-chip-button !px-3 shrink-0"
                title="Создать категорию"
                @click="openInlineCategoryModal"
              >
                <PlusIcon class="h-4 w-4" />
                <span class="sr-only">Создать категорию</span>
              </button>
            </div>
          </template>
          <!-- Склад: прежние селекты -->
          <template v-else>
            <div class="flex items-center gap-2 min-w-0">
              <select
                v-model="category"
                class="crm-ref-select w-full sm:w-[220px]"
                @change="onCategoryFilterChange"
              >
                <option value="">Все категории</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <button
                type="button"
                class="crm-ref-chip-button !px-3 shrink-0"
                title="Создать категорию"
                @click="openInlineCategoryModal"
              >
                <PlusIcon class="h-4 w-4" />
                <span class="sr-only">Создать категорию</span>
              </button>
            </div>
            <div class="flex items-center gap-2 min-w-0">
              <div ref="groupDropdownTriggerRef" class="relative min-w-0">
                <button
                  type="button"
                  @click="toggleGroupDropdown"
                  :disabled="!groupFilterOptions.length"
                  class="crm-ref-select !w-[200px] flex items-center justify-between gap-2 text-left disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <span class="truncate">{{ selectedGroupName }}</span>
                </button>
              </div>
              <button
                type="button"
                class="crm-ref-chip-button !px-3 shrink-0"
                :disabled="!category"
                :title="category ? 'Создать линейку' : 'Сначала выберите категорию'"
                @click="openInlineGroupModal"
              >
                <PlusIcon class="h-4 w-4" />
                <span class="sr-only">Создать линейку</span>
              </button>
            </div>
          </template>

          <div class="hidden lg:flex items-center gap-1 crm-ref-segment !p-1" role="group" aria-label="Вид">
            <button
              :class="{ 'is-active': viewMode === 'table' }"
              title="Вид таблицы"
              @click="viewMode = 'table'"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              :class="{ 'is-active': viewMode === 'list' }"
              title="Вид списка"
              @click="viewMode = 'list'"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <div class="flex items-center gap-2 text-[11px] font-bold text-[#8898b5] uppercase tracking-[.14em]">
            <span>На странице</span>
            <select
              v-model.number="pageSize"
              class="crm-ref-select !w-auto !py-2 !px-8"
              @change="onPageSizeChange"
            >
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Быстрый доступ к линейкам: тот же фильтр, что в выпадающем списке,
           но без разворачивания и поиска. Только для склада: там линейки уже
           отобраны по остатку, а в рознице их сотни и лентой это не листается,
           для неё остаётся выпадающий список с поиском. -->
      <div
        v-if="location === 'warehouse' && groupChipOptions.length"
        class="hidden gap-2 overflow-x-auto pb-1 mt-4 sm:flex"
        role="group"
        aria-label="Фильтр по линейкам"
      >
        <button
          type="button"
          data-test="product-group-chip"
          class="crm-ref-chip-button !rounded-full !py-2 flex-shrink-0"
          :class="!group ? 'crm-ref-chip-button--primary' : ''"
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
          class="crm-ref-chip-button !rounded-full !py-2 flex-shrink-0"
          :class="group === option.id ? 'crm-ref-chip-button--primary' : ''"
          :aria-pressed="group === option.id"
          @click="selectGroupChip(option.id)"
        >
          {{ option.name }}
        </button>
      </div>

      <!-- Розница: линейки выбранной категории. Все, включая без остатков —
           безостаточные уходят в конец ленты и показываются приглушённо.
           По умолчанию — одна прокручиваемая строка, стрелкой разворачивается
           на несколько строк. -->
      <div
        v-if="location === 'retail' && category && retailGroupChipOptions.length"
        class="mt-4 hidden sm:block"
      >
        <div
          class="retail-group-ribbon"
          :class="{ 'retail-group-ribbon--expanded': retailRibbonExpanded }"
          role="group"
          aria-label="Фильтр по линейкам категории"
        >
          <button
            type="button"
            data-test="retail-group-chip"
            class="crm-ref-chip-button !rounded-full !py-2 flex-shrink-0"
            :class="!group ? 'crm-ref-chip-button--primary' : ''"
            :aria-pressed="!group"
            @click="selectGroupChip('')"
          >
            Все линейки
          </button>
          <button
            v-for="option in retailGroupChipOptions"
            :key="option.id"
            type="button"
            data-test="retail-group-chip"
            class="crm-ref-chip-button !rounded-full !py-2 flex-shrink-0"
            :class="[group === option.id ? 'crm-ref-chip-button--primary' : '', option.outOfStock ? 'retail-group-chip--empty' : '']"
            :aria-pressed="group === option.id"
            :title="option.outOfStock ? 'Нет товаров в наличии' : undefined"
            @click="selectGroupChip(option.id)"
          >
            {{ option.name }}
          </button>
        </div>
        <button
          v-if="retailGroupChipOptions.length > 1"
          type="button"
          class="crm-ref-chip-button !px-3 !py-1.5 mt-2"
          data-test="retail-ribbon-toggle"
          :aria-expanded="retailRibbonExpanded"
          @click="retailRibbonExpanded = !retailRibbonExpanded"
        >
          <ChevronDownIcon class="h-3.5 w-3.5" :class="{ 'rotate-180': retailRibbonExpanded }" aria-hidden="true" />
          <span>{{ retailRibbonExpanded ? 'Свернуть' : 'Показать все' }}</span>
        </button>
      </div>
    </div>

    <!-- Мобильная панель фильтров -->
    <div class="flex flex-wrap items-center gap-2 sm:hidden mb-4">
      <button
        type="button"
        class="crm-ref-button crm-ref-button--gray flex-1"
        @click="showFiltersModal = true"
      >
        <FunnelIcon class="h-4 w-4" />
        <span>Фильтры</span>
      </button>
      <div class="crm-ref-segment" role="group" aria-label="Вид">
        <button
          :class="{ 'is-active': viewMode === 'table' }"
          title="Вид таблицы"
          @click="viewMode = 'table'"
        >
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          :class="{ 'is-active': viewMode === 'list' }"
          title="Вид списка"
          @click="viewMode = 'list'"
        >
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="location === 'retail' && selectedIds.length" class="crm-ref-card p-4 sm:p-5 mb-4 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <span class="text-[14px] font-bold text-[#081b4b]">Выбрано: {{ selectedIds.length }}</span>
        <button
          type="button"
          class="crm-ref-chip-button"
          @click="clearSelection"
        >
          ✕ Отменить
        </button>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          class="crm-ref-chip-button"
          @click="batchChangeCategory"
        >
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          Сменить категорию
        </button>
        <button
          type="button"
          class="crm-ref-chip-button"
          @click="batchChangeGroup"
        >
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          Назначить линейку
        </button>
        <button
          type="button"
          class="crm-ref-chip-button crm-ref-chip-button--danger"
          @click="batchDelete"
        >
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          Удалить
        </button>
      </div>
    </div>

    <!-- Table View -->
    <div v-if="viewMode === 'table'" class="crm-ref-card">
      <div ref="tableScrollContainer" class="relative overflow-x-auto">
        <table ref="tableRef" class="crm-ref-table">
          <colgroup>
            <col v-for="(width, index) in displayedColumnWidths" :key="index" :style="width ? { width: `${width}px` } : undefined" />
          </colgroup>
          <thead>
            <tr>
              <th class="w-12 px-4 py-3" :style="columnStyle(0)">
                <input
                  v-if="location === 'retail'"
                  type="checkbox"
                  :checked="isAllSelected"
                  @change="toggleSelectAll"
                  class="rounded border-[#c9d6ec] accent-[#1759ed]"
                >
              </th>

              <th
                class="p-0 text-left whitespace-normal break-words"
                :style="columnStyle(1)"
                :aria-sort="ariaSort('title')"
              >
                <button
                  type="button"
                  class="crm-ref-sort"
                  :class="{ 'is-active': sortKey === 'title' }"
                  @click="toggleSort('title')"
                >
                  <span>Товар</span>
                  <span class="text-[10px] leading-none opacity-70">{{ sortIndicator('title') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left whitespace-normal break-words"
                :style="columnStyle(2)"
                :aria-sort="ariaSort('category')"
              >
                <button
                  type="button"
                  class="crm-ref-sort"
                  :class="{ 'is-active': sortKey === 'category' }"
                  @click="toggleSort('category')"
                >
                  <span>Категория</span>
                  <span class="text-[10px] leading-none opacity-70">{{ sortIndicator('category') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left whitespace-normal break-words"
                :style="columnStyle(3)"
                :aria-sort="ariaSort('group')"
              >
                <button
                  type="button"
                  class="crm-ref-sort"
                  :class="{ 'is-active': sortKey === 'group' }"
                  @click="toggleSort('group')"
                >
                  <span>Линейка</span>
                  <span class="text-[10px] leading-none opacity-70">{{ sortIndicator('group') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left whitespace-normal break-words"
                :style="columnStyle(4)"
                :aria-sort="ariaSort('strength')"
              >
                <button
                  type="button"
                  class="crm-ref-sort"
                  :class="{ 'is-active': sortKey === 'strength' }"
                  @click="toggleSort('strength')"
                >
                  <span>Крепость</span>
                  <span class="text-[10px] leading-none opacity-70">{{ sortIndicator('strength') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left whitespace-normal break-words"
                :style="columnStyle(5)"
                :aria-sort="ariaSort('costPrice')"
              >
                <button
                  type="button"
                  class="crm-ref-sort"
                  :class="{ 'is-active': sortKey === 'costPrice' }"
                  @click="toggleSort('costPrice')"
                >
                  <span>Себес</span>
                  <span class="text-[10px] leading-none opacity-70">{{ sortIndicator('costPrice') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left whitespace-normal break-words"
                :style="columnStyle(6)"
                :aria-sort="ariaSort('stock')"
              >
                <button
                  type="button"
                  class="crm-ref-sort"
                  :class="{ 'is-active': sortKey === 'stock' }"
                  @click="toggleSort('stock')"
                >
                  <span>Остаток</span>
                  <span class="text-[10px] leading-none opacity-70">{{ sortIndicator('stock') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-left whitespace-normal break-words"
                :style="columnStyle(7)"
                :aria-sort="ariaSort('priceRub')"
              >
                <button
                  type="button"
                  class="crm-ref-sort"
                  :class="{ 'is-active': sortKey === 'priceRub' }"
                  @click="toggleSort('priceRub')"
                >
                  <span>Цена</span>
                  <span class="text-[10px] leading-none opacity-70">{{ sortIndicator('priceRub') }}</span>
                </button>
              </th>
              <th
                class="p-0 text-right whitespace-normal break-words"
                :style="columnStyle(8)"
              >Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="isLoading">
              <td colspan="9" class="py-8 text-center text-[#8898b5]">Загрузка...</td>
            </tr>
            <template v-for="p in paged" :key="p.id">
            <tr
              :class="[
                selectedIds.includes(p.id) ? 'is-selected' : '',
              ]"
            >
            <td class="px-4 py-4" :style="columnStyle(0)">
              <div class="flex items-center gap-2">
                <button
                  v-if="p.hasVariants && p.variants && p.variants.length > 0"
                  @click="toggleProductExpansion(p.id)"
                  class="flex items-center justify-center w-5 h-5 rounded hover:bg-[#e7f1ff] transition-colors"
                  :title="isProductExpanded(p.id) ? 'Свернуть' : 'Развернуть'"
                >
                  <svg
                    class="w-3 h-3 text-[#66799e] transition-transform"
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
                  class="rounded border-[#c9d6ec] accent-[#1759ed]"
                >
              </div>
            </td>
            <td class="px-4 py-4 min-w-[220px]" :style="columnStyle(1)">
              <div class="flex items-center gap-3 min-w-0">
                <img :src="getProductCover(p)" class="w-12 h-12 object-cover rounded-[10px] border border-[#eaf0f9]" />
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-[#081b4b] truncate">{{ p.title || p.id }}</span>
                    <span
                      v-if="discountBadge(p)"
                      data-test="product-discount-badge"
                      class="flex-shrink-0 rounded-full bg-[#fa2948] px-2 py-0.5 text-[10px] font-bold text-white"
                      :title="discountTitle(p)"
                    >{{ discountBadge(p) }}</span>
                  </div>
                  <div v-if="p.description" class="text-[11px] text-[#8898b5] truncate">{{ p.description }}</div>
                </div>
              </div>
            </td>
            <td class="text-[#425778]" :style="columnStyle(2)">{{ categoryName(p.categoryId) }}</td>
            <td class="text-[#425778]" :style="columnStyle(3)">
              <span v-if="p.groupName">{{ p.groupName }}</span>
              <span v-else class="text-[#a0acc6]">Без линейки</span>
            </td>
            <td class="text-[#425778]" :style="columnStyle(4)">
              <span v-if="p.strength && p.strength.trim().length && p.strength !== '0'" class="font-bold text-[#081b4b]">{{ p.strength }}</span>
              <span v-else class="text-[#a0acc6]">Без крепости</span>
            </td>
            <td class="text-right min-w-[100px]" :style="columnStyle(5)">
              <div class="flex items-center justify-center">
                <span v-if="profitUnlocked" class="font-bold text-[#081b4b]">{{ formatRub(p.costPrice) }}</span>
                <span
                  v-else
                  class="inline-flex items-center rounded-full bg-[#f0f4fa] p-1.5 text-[#8999b7]"
                  :aria-label="`Себестоимость скрыта`"
                >
                  <LockClosedIcon class="h-4 w-4" />
                </span>
              </div>
            </td>
            <td class="text-right" :style="columnStyle(6)">
              <div class="flex items-center justify-end gap-2 whitespace-nowrap">
                <span
                  v-if="p.hasVariants"
                  class="font-bold"
                  :class="isBelowMin(p) ? 'text-[#fa2948]' : 'text-[#081b4b]'"
                >
                  {{ productStockLabel(p) }}
                </span>
                <span
                  v-else
                  class="font-bold"
                  :class="isBelowMin(p) ? 'text-[#fa2948]' : 'text-[#081b4b]'"
                >
                  {{ displayProductStock(p) }}
                </span>
                <span v-if="location === 'retail' && Number(p.minStock ?? 0) > 0" class="text-[11px] text-[#8898b5] whitespace-nowrap">
                  мин. {{ Number(p.minStock ?? 0) }}
                </span>
              </div>
            </td>
            <td class="text-right text-[#425778]" :style="columnStyle(7)">
              <span v-if="!p.hasVariants" class="font-bold text-[#081b4b]">{{ formatRub(p.priceRub) }}</span>
              <span v-else class="text-[11px] text-[#66799e]">Вар-ты</span>
            </td>
            <td class="text-right" :style="columnStyle(8)">
              <div class="flex items-center justify-end gap-1.5">
                <button
                  v-if="location === 'retail'"
                  data-test="product-discount-button"
                  @click="$emit('discount', p)"
                  class="crm-ref-chip-button !p-2"
                  :class="activeDiscount(p) ? 'crm-ref-chip-button--danger-gradient' : ''"
                  :title="activeDiscount(p) ? discountTitle(p) : 'Поставить скидку'"
                >
                  <span class="block text-[11px] font-black leading-none">%</span>
                </button>
                <button
                  v-if="location === 'retail'"
                  @click="$emit('edit', p)"
                  class="crm-ref-chip-button !p-2"
                  title="Редактировать"
                >
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.656 2.656L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
                <button
                  v-if="location === 'retail'"
                  @click="$emit('delete', p)"
                  class="crm-ref-chip-button crm-ref-chip-button--danger !p-2"
                  title="Удалить"
                >
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
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
              class="!bg-[#f7fbff] hover:!bg-[#edf5ff]"
            >
              <td class="px-4 py-3" :style="columnStyle(0)">
                <!-- Пустая ячейка или индикатор вложенности -->
                <div class="pl-7 text-[#a0acc6] text-xs">└</div>
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
                      <span class="text-sm text-[#081b4b] truncate">{{ variant.name }}</span>
                      <span
                        v-if="variantDiscountBadge(p, variant)"
                        data-test="variant-discount-badge"
                        class="flex-shrink-0 rounded-full bg-[#fa2948] px-2 py-0.5 text-[10px] font-bold text-white"
                        :title="variantDiscountTitle(p, variant)"
                      >{{ variantDiscountBadge(p, variant) }}</span>
                    </div>
                    <div class="text-[11px] text-[#8898b5]">Вариант</div>
                  </div>
                </div>
              </td>
              <td class="py-3" :style="columnStyle(2)"></td>
              <td class="py-3" :style="columnStyle(3)"></td>
              <td class="py-3" :style="columnStyle(4)"></td>
              <td class="text-right min-w-[100px]" :style="columnStyle(5)">
                <div class="flex items-center justify-center">
                  <span v-if="profitUnlocked" class="text-sm text-[#425778]">{{ formatRub(p.costPrice) }}</span>
                  <span
                    v-else
                    class="inline-flex items-center rounded-full bg-[#f0f4fa] p-1 text-[#8999b7]"
                    :aria-label="`Себестоимость скрыта`"
                  >
                    <LockClosedIcon class="h-4 w-4" />
                  </span>
                </div>
              </td>
              <td class="text-right" :style="columnStyle(6)">
                <span class="text-sm text-[#081b4b]">{{ displayVariantStock(variant) }}</span>
              </td>
              <td class="text-right text-[#425778]" :style="columnStyle(7)">
                <span class="text-sm font-bold text-[#081b4b]">{{ formatRub(getVariantPrice(p, variant)) }}</span>
              </td>
              <td class="text-right py-3" :style="columnStyle(8)">
                <!-- Пустая ячейка для действий варианта -->
              </td>
            </tr>
          </template>
          </template>
            <tr v-if="!isLoading && !paged.length">
              <td colspan="9" class="py-8 text-center text-[#8898b5]">
                {{ location === 'warehouse' && !search && !category && !group ? 'На складе пока нет товаров. Добавьте их через перемещение.' : 'Ничего не найдено' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- List View -->
    <div v-else-if="viewMode === 'list'" class="crm-ref-card">
      <div class="p-4 border-b border-[#dce8fa] flex items-center justify-between">
        <div v-if="location === 'retail'" class="flex items-center gap-3">
          <input
            type="checkbox"
            :checked="isAllSelected"
            @change="toggleSelectAll"
            class="rounded border-[#c9d6ec] accent-[#1759ed]"
          >
          <span class="text-[12px] text-[#66799e]">Выбрать все</span>
        </div>
        <span class="text-[11px] font-bold text-[#8898b5] uppercase tracking-[.14em]">Показано {{ total === 0 ? 0 : (to - from + 1) }} из {{ total }}</span>
      </div>
      
      <div v-if="isLoading" class="py-12 text-center text-[#8898b5]">
        Загрузка...
      </div>
      
      <div v-else-if="!paged.length" class="py-12 text-center text-[#8898b5]">
        {{ location === 'warehouse' && !search && !category && !group ? 'На складе пока нет товаров. Добавьте их через перемещение.' : 'Ничего не найдено' }}
      </div>
      
      <div v-else class="divide-y divide-[#eaf0f9]">
        <template v-for="p in paged" :key="p.id">
        <div
          class="p-3 sm:p-4 transition-colors hover:bg-[#f7fbff]"
          :class="{ 'bg-[#e7f1ff]': selectedIds.includes(p.id) }"
        >
          <!-- Мобильная версия - компактный лейаут -->
          <div class="block sm:hidden">
            <div class="flex gap-2">
              <div class="flex flex-col gap-1 items-center">
                <button
                  v-if="p.hasVariants && p.variants && p.variants.length > 0"
                  @click="toggleProductExpansion(p.id)"
                  class="flex items-center justify-center w-5 h-5 rounded hover:bg-[#e7f1ff] transition-colors touch-manipulation"
                  :title="isProductExpanded(p.id) ? 'Свернуть' : 'Развернуть'"
                >
                  <svg
                    class="w-3 h-3 text-[#66799e] transition-transform"
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
                  class="rounded border-[#c9d6ec] accent-[#1759ed] w-4 h-4 touch-manipulation"
                >
              </div>
              <img
                :src="getProductCover(p)"
                class="w-12 h-12 object-cover rounded-[10px] border border-[#eaf0f9] flex-shrink-0"
              />
              <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start gap-2">
                  <div class="flex-1 min-w-0">
                    <h3 class="text-sm font-bold text-[#081b4b] truncate leading-tight">
                      {{ p.title || p.id }}
                    </h3>
                    <div class="mt-0.5">
                    <p class="text-xs text-[#8898b5] leading-snug">
                      {{ categoryName(p.categoryId) }}
                    </p>
                    <p v-if="p.groupName" class="text-xs text-[#1759ed] leading-snug">
                      Линейка: <span class="font-semibold">{{ p.groupName }}</span>
                    </p>
                    <p v-if="p.strength && p.strength.trim() && p.strength !== '0'" class="text-xs text-[#66799e] leading-snug">
                      Крепость: <span class="font-semibold text-[#081b4b]">{{ p.strength }}</span>
                    </p>
                    <p class="text-base font-bold text-[#081b4b] mt-0.5 flex items-center gap-1.5">
                      <span v-if="!p.hasVariants">{{ formatRub(p.priceRub) }}</span>
                      <span v-else class="inline-flex items-center rounded-full bg-[#e7f1ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#1759ed]">
                        индивид
                      </span>
                    </p>
                    <p class="text-xs text-[#66799e] leading-snug">
                      Себес:
                      <span v-if="profitUnlocked" class="font-semibold">{{ formatRub(p.costPrice) }}</span>
                      <span v-else class="inline-flex items-center rounded-full bg-[#f0f4fa] p-0.5 text-[#8999b7]">
                        <LockClosedIcon class="h-3.5 w-3.5" />
                      </span>
                    </p>
                    <p class="text-xs leading-snug" :class="isBelowMin(p) ? 'text-[#fa2948] font-semibold' : 'text-[#66799e]'">
                      Остаток: {{ displayStockLabel(p) }}<span v-if="location === 'retail' && Number(p.minStock ?? 0) > 0"> / мин. {{ Number(p.minStock ?? 0) }}</span>
                    </p>
                    </div>
                  </div>
                  <!-- Компактные кнопки действий в вертикальной группе -->
                  <div class="flex flex-col gap-1 flex-shrink-0">
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('edit', p)" 
                      class="crm-ref-chip-button !p-1.5 touch-manipulation"
                      title="Редактировать"
                    >
                      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13.586 3.586a2 2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('delete', p)" 
                      class="crm-ref-chip-button crm-ref-chip-button--danger !p-1.5 touch-manipulation"
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
                class="flex items-center justify-center w-6 h-6 rounded hover:bg-[#e7f1ff] transition-colors"
                :title="isProductExpanded(p.id) ? 'Свернуть' : 'Развернуть'"
              >
                <svg
                  class="w-4 h-4 text-[#66799e] transition-transform"
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
                class="rounded border-[#c9d6ec] accent-[#1759ed]"
              >
            </div>
            <img
              :src="getProductCover(p)"
              class="w-20 h-20 object-cover rounded-[13px] border border-[#eaf0f9] flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <h3 class="text-[17px] font-bold text-[#081b4b] truncate">
                    {{ p.title || p.id }}
                  </h3>
                  <div class="mt-1 space-y-1">
                    <p v-if="p.description" class="text-sm text-[#8898b5]">
                      {{ p.description }}
                    </p>
                    <p class="text-sm text-[#66799e]">
                      Категория: <span class="font-medium">{{ categoryName(p.categoryId) }}</span>
                    </p>
                    <p v-if="p.groupName" class="text-sm text-[#1759ed]">
                      Линейка: <span class="font-medium">{{ p.groupName }}</span>
                    </p>
                    <p v-if="p.strength && p.strength.trim() && p.strength !== '0'" class="text-sm text-[#66799e]">
                      Крепость: <span class="font-semibold text-[#081b4b]">{{ p.strength }}</span>
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
                          <LockClosedIcon class="h-4 w-4" />
                        </span>
                      </span>
                      <span :class="isBelowMin(p) ? 'text-[#fa2948] font-semibold' : 'text-[#66799e]'">
                        Остаток: {{ displayStockLabel(p) }}<span v-if="location === 'retail' && Number(p.minStock ?? 0) > 0"> / мин. {{ Number(p.minStock ?? 0) }}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-4">
                  <div class="text-right">
                    <div class="text-xl font-bold text-[#081b4b] flex items-center gap-2">
                      <span v-if="!p.hasVariants">{{ formatRub(p.priceRub) }}</span>
                      <span v-else class="inline-flex items-center rounded-full bg-[#e7f1ff] px-2 py-1 text-[0.7rem] font-semibold text-[#1759ed]">
                        индивид
                      </span>
                    </div>
                  </div>
                <div class="flex items-center gap-2">
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('edit', p)" 
                    class="crm-ref-chip-button !p-2"
                      title="Редактировать"
                    >
                      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    <button 
                      v-if="location === 'retail'"
                      @click="$emit('delete', p)" 
                    class="crm-ref-chip-button crm-ref-chip-button--danger !p-2"
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
            <div class="border-t border-[#eaf0f9] pt-3">
              <h4 class="text-[11px] font-bold text-[#8898b5] uppercase tracking-[.14em] mb-2 px-2">Варианты товара</h4>
              <div class="space-y-2">
                <div
                  v-for="(variant, vIndex) in p.variants"
                  :key="`${p.id}-variant-list-${vIndex}`"
                  class="bg-[#f7fbff] rounded-[11px] p-3 hover:bg-[#edf5ff] transition-colors"
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
                          <div class="text-sm font-bold text-[#081b4b]">{{ variant.name }}</div>
                          <div class="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs">
                            <div class="text-gray-600">
                              <span class="font-medium">Себес:</span>
                              <span v-if="profitUnlocked" class="ml-1">{{ formatRub(p.costPrice) }}</span>
                              <LockClosedIcon v-else class="inline h-3 w-3 text-[#8999b7] ml-1" />
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
    
    <!-- Пагинация (как «Заказы») -->
    <div class="pt-5 flex justify-center">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="crm-ref-button crm-ref-button--gray"
          :disabled="page <= 1"
          @click="go(page - 1)"
        >
          Назад
        </button>
        <div class="rounded-[40px] bg-[#f0f4fa] px-5 py-2.5 text-[12px] font-bold text-[#253663] tabular-nums">
          Стр. {{ page }} / {{ totalPages }}
        </div>
        <button
          type="button"
          class="crm-ref-button crm-ref-button--gray"
          :disabled="page >= totalPages"
          @click="go(page + 1)"
        >
          Вперёд
        </button>
      </div>
    </div>

    <!-- Help text -->
    <p class="crm-ref-hint mt-4">
      {{ location === 'warehouse' ? 'На сайте показывается только розничный остаток' : 'Чекбоксы включают массовые операции с товарами' }}
    </p>

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
    <div v-if="showGroupModal" class="fixed inset-0 z-50 flex items-center justify-center bg-[#081b4b]/38 backdrop-blur-[9px] p-4">
      <div class="w-full max-w-md rounded-[20px] border border-[#eaf0f9] bg-[radial-gradient(ellipse_at_75%_0%,#e7f1ff_0%,transparent_60%),#ffffff] p-6 text-[#081b4b] shadow-[0_24px_70px_#03071140]">
        <h3 class="text-lg font-bold tracking-[-.02em] mb-2">Назначить линейку</h3>
        <p class="text-sm text-[#66799e] mb-4">Выбрано товаров: {{ selectedIds.length }}</p>

        <div class="space-y-4">
          <div>
            <label class="block text-[12px] font-bold text-[#253663] mb-2">Категория</label>
            <select v-model="groupModalCategoryId" class="crm-ref-select">
              <option value="">Выберите категорию</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div>
            <label class="block text-[12px] font-bold text-[#253663] mb-2">Линейка</label>
            <select v-model="selectedGroupId" :disabled="!groupModalCategoryId || groupModalLoading" class="crm-ref-select">
              <option value="">Без линейки</option>
              <option v-for="group in modalGroupOptions" :key="group.id" :value="group.id">
                {{ group.name }}
              </option>
            </select>
            <p v-if="groupModalLoading" class="text-xs text-[#8898b5] mt-2 animate-pulse">Загружаем список линеек…</p>
            <p v-else-if="groupModalCategoryId && !modalGroupOptions.length" class="text-xs text-[#8898b5] mt-2">
              Для выбранной категории пока нет линеек.
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2.5 mt-6">
          <button type="button" class="crm-ref-button crm-ref-button--gray" @click="cancelGroupChange">
            Отмена
          </button>
          <button
            type="button"
            class="crm-ref-button crm-ref-button--primary"
            :disabled="!groupModalCategoryId"
            @click="confirmGroupChange"
          >
            Применить
          </button>
        </div>
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
        <div class="w-full max-w-md rounded-[20px] border border-[#eaf0f9] bg-[radial-gradient(ellipse_at_75%_0%,#e7f1ff_0%,transparent_60%),#ffffff] p-6 text-[#081b4b] shadow-[0_24px_70px_#03071140]">
          <div class="flex items-center justify-between gap-2 mb-4">
            <h3 class="text-lg font-bold tracking-[-.02em]">Фильтры</h3>
            <button
              type="button"
              class="crm-ref-chip-button !p-2"
              @click="closeFiltersModal"
            >
              <XMarkIcon class="h-4 w-4" />
              <span class="sr-only">Закрыть</span>
            </button>
          </div>

          <div class="mt-4 space-y-4">
            <div class="space-y-2">
              <label class="block text-[12px] font-bold text-[#253663] mb-1">Поиск</label>
              <input
                v-model="search"
                type="text"
                placeholder="Поиск по названию..."
                class="crm-ref-input"
                @input="onSearchInput"
              />
            </div>

            <div class="space-y-3">
              <label class="block text-[12px] font-bold text-[#253663] mb-1">Категория и линейка</label>
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2">
                  <select
                    v-model="category"
                    class="crm-ref-select"
                    @change="onCategoryFilterChange"
                  >
                    <option value="">Все категории</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                  <button
                    type="button"
                    class="crm-ref-chip-button !p-2.5"
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
                      class="crm-ref-input !pl-9"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <select
                      v-model="group"
                      :disabled="!groupFilterOptions.length"
                      class="crm-ref-select"
                      @change="onFiltersChanged"
                    >
                      <option value="">Все линейки</option>
                      <option v-for="option in mobileFilteredGroupOptions" :key="option.id" :value="option.id">
                        {{ option.name }}
                      </option>
                    </select>
                    <button
                      type="button"
                      class="crm-ref-chip-button !p-2.5"
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
              <label class="block text-[12px] font-bold text-[#253663] mb-1">Показывать на странице</label>
              <select
                v-model.number="pageSize"
                class="crm-ref-select"
                @change="onPageSizeChange"
              >
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
              </select>
            </div>

            <div class="space-y-2">
              <label class="block text-[12px] font-bold text-[#253663] mb-1">Режим отображения</label>
              <div class="crm-ref-segment w-full">
                <button
                  @click="viewMode = 'table'"
                  :class="{ 'is-active': viewMode === 'table' }"
                  class="flex-1"
                  title="Вид таблицы"
                >
                  <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h5a1 1 0 000-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM13 16a1 1 0 102 0v-5.586l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 101.414 1.414L13 10.414V16z"/>
                  </svg>
                </button>
                <button
                  @click="viewMode = 'list'"
                  :class="{ 'is-active': viewMode === 'list' }"
                  class="flex-1"
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
              class="crm-ref-button crm-ref-button--primary"
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
        class="fixed z-[100] w-72 rounded-2xl border border-[#eaf0f9] bg-white shadow-[0_12px_35px_#20386926]"
        :style="groupDropdownStyle"
      >
        <div class="p-2 border-b border-[#eaf0f9]">
          <div class="relative">
            <MagnifyingGlassIcon class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ba8c0] pointer-events-none" />
            <input
              ref="groupSearchInputRef"
              v-model="groupSearchQuery"
              type="text"
              placeholder="Поиск линейки..."
              class="w-full rounded-[11px] border border-[#eaf0f9] bg-white py-2 pl-9 pr-3 text-sm text-[#081b4b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0958ff]"
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
              group === '' ? 'text-[#1759ed] font-bold' : 'text-[#425778] hover:text-[#1759ed]'
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
              group === option.id ? 'text-[#1759ed] font-bold' : 'text-[#425778] hover:text-[#1759ed]'
            ]"
          >
            {{ option.name }}
          </button>
          <div v-if="filteredGroupOptions.length === 0 && groupSearchQuery" class="px-3 py-4 text-center text-sm text-[#8898b5]">
            Ничего не найдено
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { PlusIcon, FunnelIcon, XMarkIcon, MagnifyingGlassIcon, LockClosedIcon, ArrowsRightLeftIcon, ChevronDownIcon, ClipboardDocumentCheckIcon } from '@heroicons/vue/24/outline'
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
  availableGroups?: Array<{ id: string; name: string; categoryId: string; hasStock?: number }>
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
  (e: 'inventory-check', location: 'retail' | 'warehouse'): void
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
// Розница: лента линеек развёрнута в несколько строк (стрелка «Показать все»)
const retailRibbonExpanded = ref(false)
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

/**
 * Розница: линейки выбранной категории — все, включая без остатков.
 * Наличие (hasStock) приходит с сервера в availableGroups — он считается
 * по всей базе, а не по текущей странице пагинации. Безостаточные уходят
 * в конец ленты и помечаются outOfStock — UI показывает их приглушённо.
 */
const retailGroupChipOptions = computed(() => {
  if (props.location !== 'retail' || !category.value) return []
  const groups = props.availableGroups.filter((item) => item.categoryId === category.value)

  const decorated = groups.map((item) => ({
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    outOfStock: !Number(item.hasStock ?? 0),
  }))

  // Есть остаток — вперёд по алфавиту; без остатка — в конец, тоже по алфавиту.
  return decorated.sort((a, b) => {
    if (a.outOfStock !== b.outOfStock) return a.outOfStock ? 1 : -1
    return a.name.localeCompare(b.name, 'ru')
  })
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

/** Розница: выбор категории чипом — линейка сбрасывается, появляются
 *  чипы линеек новой категории. Повторный клик по активной категории
 *  ничего не перезапрашивает. */
function selectRetailCategory(categoryId: string) {
  if (category.value === categoryId) return
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  category.value = categoryId
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

<style scoped>
/* Розница, лента линеек: чипы без остатков — в конце и приглушённые,
 * чтобы было видно: линейка есть, но товара в ней сейчас нет. */
.retail-group-chip--empty:not(.crm-ref-chip-button--primary) {
  opacity: .55;
  border-style: dashed;
  color: #8898b5;
}

/* Лента линеек: по умолчанию одна прокручиваемая строка,
 * развёрнутая — переносится на несколько строк. */
.retail-group-ribbon {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.retail-group-ribbon--expanded {
  flex-wrap: wrap;
  overflow-x: visible;
  padding-bottom: 0;
}
</style>
