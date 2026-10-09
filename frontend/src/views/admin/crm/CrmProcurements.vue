<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-8">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="max-w-2xl space-y-2">
          <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl">Закупки</h1>
          <p class="text-sm text-gray-600 sm:text-base">
            Планируйте поставки, контролируйте себестоимость и пополняйте
            остатки
          </p>
        </div>
        <div
          v-if="profitUnlocked"
          class="flex w-full flex-wrap gap-3 sm:w-auto sm:justify-end"
        >
          <button
            @click="refreshProcurements"
            class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 sm:w-auto"
          >
            Обновить
          </button>
          <button
            @click="openCreateModal"
            class="w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
          >
            Создать закупку
          </button>
        </div>
      </div>

      <template v-if="profitUnlocked">
        <TotalControlPanel class="mb-6" />
        <LowStockGroupsPanel class="mb-6" />
        <div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div class="rounded-xl bg-white p-5 shadow-sm">
            <div class="text-sm text-gray-500">Черновиков</div>
            <div class="mt-2 flex items-end justify-between">
              <div class="text-3xl font-bold text-gray-900">
                {{ draftCount }}
              </div>
              <div class="text-sm text-gray-500">
                {{ formatCurrency(draftAmount) }}
              </div>
            </div>
            <p class="mt-3 text-xs text-gray-500">
              Планируемые списания с кассы
            </p>
          </div>
          <div class="rounded-xl bg-white p-5 shadow-sm">
            <div class="text-sm text-gray-500">Завершено</div>
            <div class="mt-2 flex items-end justify-between">
              <div class="text-3xl font-bold text-gray-900">
                {{ completedCount }}
              </div>
              <div class="text-sm text-gray-500">
                {{ formatCurrency(completedAmount) }}
              </div>
            </div>
            <p class="mt-3 text-xs text-gray-500">
              Фактические закупки по актуальным ценам
            </p>
          </div>
          <div class="rounded-xl bg-white p-5 shadow-sm">
            <div class="text-sm text-gray-500">Средняя стоимость позиции</div>
            <div class="mt-2 text-3xl font-bold text-gray-900">
              {{ draftItems.length ? formatCurrency(draftAverageCost) : "—" }}
            </div>
            <p class="mt-3 text-xs text-gray-500">
              По текущему черновику закупки
            </p>
          </div>
        </div>

        <div
          v-if="loadingProcurements"
          class="rounded-xl bg-white py-16 text-center shadow-sm"
        >
          <div
            class="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-r-transparent"
          ></div>
          <p class="mt-4 text-gray-600">Загрузка закупок…</p>
        </div>

        <div
          v-else-if="procurements.length"
          class="rounded-xl bg-white shadow-sm"
        >
          <div class="overflow-x-auto">
            <table class="w-full min-w-[980px] text-left">
              <thead
                class="border-b bg-gray-50 text-xs font-medium uppercase text-gray-500"
              >
                <tr>
                  <th class="px-6 py-3">№</th>
                  <th class="px-6 py-3">Поставщик</th>
                  <th class="px-6 py-3">Кто создал</th>
                  <th class="px-6 py-3">Кто принял</th>
                  <th class="px-6 py-3">Сумма</th>
                  <th class="px-6 py-3">Статус</th>
                  <th class="px-6 py-3">Создана</th>
                  <th class="px-6 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr
                  v-for="procurement in procurements"
                  :key="procurement.id"
                  class="transition hover:bg-gray-50"
                >
                  <td class="px-6 py-4 text-sm font-semibold text-gray-900">
                    #{{ procurement.procurement_number }}
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-700">
                    <div class="font-medium text-gray-900">
                      {{ procurement.supplier_name || "Без поставщика" }}
                    </div>
                    <div v-if="procurement.notes" class="text-xs text-gray-500">
                      {{ procurement.notes }}
                    </div>
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-700">
                    {{ procurement.created_by_name || "—" }}
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-700">
                    {{ procurement.accepted_by_name || "—" }}
                  </td>
                  <td class="px-6 py-4 text-sm font-semibold text-gray-900">
                    {{ formatCurrency(procurement.total_amount) }}
                  </td>
                  <td class="px-6 py-4">
                    <span
                      :class="statusBadgeClass(procurement.status)"
                      class="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                    >
                      {{ statusLabel(procurement.status) }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-500">
                    {{ formatDate(procurement.created_at) }}
                  </td>
                  <td class="px-6 py-4 text-right text-sm">
                    <div class="flex justify-end gap-3">
                      <button
                        v-if="procurement.status === 'draft'"
                        @click="finishProcurement(procurement.id)"
                        class="text-green-600 transition hover:text-green-800"
                      >
                        Оприходовать закупку
                      </button>
                      <button
                        v-if="procurement.status === 'draft'"
                        @click="startEditProcurement(procurement.id)"
                        class="admin-link-button admin-link-button--edit"
                      >
                        Редактировать
                      </button>
                      <button
                        class="admin-link-button admin-link-button--danger"
                        @click="deleteProcurementRecord(procurement.id)"
                      >
                        Удалить
                      </button>
                      <button
                        @click="openDetails(procurement.id)"
                        class="admin-link-button admin-link-button--info"
                      >
                        Подробнее
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-else class="rounded-xl bg-white py-16 text-center shadow-sm">
          <h3 class="text-lg font-semibold text-gray-900">
            Закупки пока не создавались
          </h3>
          <p class="mt-2 text-gray-600">
            Создайте первую закупку. Остатки изменятся после оприходования.
          </p>
          <button
            class="mt-6 inline-flex items-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            @click="openCreateModal"
          >
            Создать закупку
          </button>
        </div>
      </template>

      <div
        v-else
        class="relative overflow-hidden rounded-3xl border border-dashed border-blue-200 bg-white/80 p-10 text-center shadow-inner"
      >
        <div class="mx-auto flex max-w-xl flex-col items-center gap-5">
          <span
            class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600"
          >
            <LockClosedIcon class="h-8 w-8" />
          </span>
          <div class="space-y-2">
            <p class="text-sm text-gray-600">Оплатите подписку на сервис</p>
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            @click="openPasswordModal"
            :disabled="verifyingPassword"
          >
            <LockClosedIcon class="h-5 w-5" />
            <span>{{
              verifyingPassword ? "Проверяем…" : "Ввести лицензионный ключ"
            }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Profit Password Modal -->
    <AdminModal
      :isOpen="showPasswordModal"
      title="Подтверждение доступа"
      description="Введите лицензионный ключ"
      size="sm"
      :showActions="false"
      @close="closePasswordModal"
      @cancel="closePasswordModal"
    >
      <form class="space-y-4" autocomplete="on" @submit.prevent="submitPassword">
        <CrmProfitPasswordField
          v-model="passwordInput"
          :password-error="passwordError"
          :verifying-password="verifyingPassword"
          input-class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            :disabled="verifyingPassword"
          >
            {{ verifyingPassword ? "Проверяем…" : "Показать" }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
            @click="closePasswordModal"
            :disabled="verifyingPassword"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>

    <!-- В DOM активна только верхняя соседняя модалка: иначе Headless UI
         заставляет несколько ловушек фокуса спорить между собой. -->
    <AdminModal
      v-if="!actorPromptOpen && !showQuickProductModal"
      ref="createModalRef"
      :isOpen="showCreateModal"
      :title="editingProcurementId ? 'Редактирование закупки' : 'Новая закупка'"
      description="Подберите товары, укажите закупочную цену и количество - себестоимость пересчитается автоматически."
      size="wide"
      :showActions="false"
      :persistent="true"
      @close="closeCreateModal"
      @cancel="closeCreateModal"
    >
      <div class="grid gap-6">
        <div class="space-y-6">
          <div class="grid gap-4 rounded-xl border border-gray-200 p-5">
            <label class="text-sm font-medium text-gray-700" for="supplier"
              >Поставщик</label
            >
            <input
              id="supplier"
              v-model="supplierName"
              type="text"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Например, ООО «ВкусПоставки»"
            />
            <label class="text-sm font-medium text-gray-700" for="notes"
              >Комментарий</label
            >
            <textarea
              id="notes"
              v-model="draftNotes"
              rows="2"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Условия, ссылка на счет, номер накладной"
            ></textarea>
          </div>

          <!-- Поиск товаров -->
          <div class="rounded-xl border border-gray-200 p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 class="text-lg font-semibold text-gray-900">
                  Поиск товаров
                </h4>
                <p class="text-sm text-gray-500">
                  Добавьте позиции в закупку. Можно искать по названию или
                  вкусу.
                </p>
              </div>
              <button
                type="button"
                class="inline-flex items-center rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-50"
                @click="openQuickProductModal"
              >
                + Создать товар
              </button>
            </div>
            <div class="mt-4">
              <input
                v-model="productSearch"
                type="search"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Введите минимум 2 символа"
              />
              <p v-if="showSearchHint" class="mt-2 text-xs text-gray-500">
                Для поиска введите от двух символов
              </p>
            </div>
            <div
              class="mt-4 min-h-[120px] max-h-[800px] overflow-x-hidden overflow-y-auto rounded-lg border border-dashed border-gray-200 resize-y overscroll-contain"
              style="height: 208px; scrollbar-gutter: stable;"
              @scroll.passive="handleProductResultsScroll"
            >
              <div
                v-if="isSearchingProducts"
                class="flex items-center justify-center gap-2 py-6 text-sm text-gray-500"
              >
                <div
                  class="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"
                ></div>
                Поиск товаров…
              </div>
              <div
                v-else-if="searchError"
                class="px-4 py-6 text-sm text-red-600"
              >
                {{ searchError }}
              </div>
              <div
                v-else-if="
                  productResults.length === 0 &&
                  productSearch.trim().length >= 2
                "
                class="px-4 py-6 text-sm text-gray-500"
              >
                Ничего не нашли. Попробуйте скорректировать запрос.
              </div>
              <ul v-else class="divide-y text-sm">
                <li
                  v-for="(product, index) in productResults"
                  :key="product.id"
                  :class="[
                    'grid min-w-0 grid-cols-1 gap-3 px-3 py-3 transition-colors sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:items-center sm:px-4',
                    getAddedQuantity(product.id) > 0
                      ? 'bg-blue-50 ring-2 ring-inset ring-blue-400'
                      : 'hover:bg-gray-50'
                  ]"
                >
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="w-5 text-xs text-gray-400">{{ index + 1 }}.</span>
                    <img
                      v-if="product.image"
                      :src="product.image"
                      class="h-10 w-10 flex-shrink-0 rounded object-cover"
                      :alt="product.title"
                    />
                    <div v-else class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-gray-100">
                      <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div class="min-w-0">
                      <div class="truncate font-medium text-gray-900">
                        {{ product.title }}
                      </div>
                      <div
                        v-if="product.groupName"
                        class="truncate text-xs font-semibold text-blue-600"
                      >
                        {{ product.groupName }}
                      </div>
                      <div class="truncate text-xs text-gray-500">
                        Розница: {{ product.stock }} · Склад: {{ Number(product.warehouseStock || 0) }} · Себестоимость:
                        {{ formatCurrency(product.costPrice) }}
                      </div>
                    </div>
                  </div>
                  <div class="grid w-[9.5rem] max-w-full grid-cols-[2.5rem_minmax(3rem,1fr)_2.5rem] items-center gap-1 justify-self-end rounded-xl bg-gray-100 p-1">
                    <button type="button" class="h-10 w-10 rounded-lg bg-white text-lg font-semibold text-gray-700 shadow-sm hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="getAddedQuantity(product.id) === 0" aria-label="Уменьшить количество" @click.stop="decreaseProduct(product.id)">−</button>
                    <span class="min-w-10 text-center text-xs font-semibold text-gray-900">{{ getAddedQuantity(product.id) }} шт</span>
                    <button type="button" class="h-10 w-10 rounded-lg bg-blue-600 text-lg font-semibold text-white shadow-sm hover:bg-blue-700" aria-label="Увеличить количество" @click="addProduct(product)">+</button>
                  </div>
                </li>
              </ul>
              <div v-if="productSearchHasMore" class="border-t border-gray-100 p-3 text-center">
                <p v-if="loadMoreProductsError" class="mb-2 text-xs text-red-600" aria-live="polite">
                  {{ loadMoreProductsError }}
                </p>
                <button
                  type="button"
                  class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                  :disabled="isLoadingMoreProducts"
                  @click="loadMoreProducts"
                >
                  {{ isLoadingMoreProducts ? 'Загружаем…' : 'Показать ещё товары' }}
                </button>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-gray-200">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[780px] text-sm">
                <thead
                  class="bg-gray-50 text-xs font-medium uppercase text-gray-500"
                >
                  <tr>
                    <th class="w-8 px-2 py-3 text-left">#</th>
                    <th class="px-4 py-3 text-left">Товар</th>
                    <th class="px-4 py-3 text-left">Остаток</th>
                    <th class="px-4 py-3 text-left">Кол-во</th>
                    <th class="px-4 py-3 text-left">На склад</th>
                    <th class="px-4 py-3 text-left">Себестоимость</th>
                    <th class="px-4 py-3 text-left">Новая средняя</th>
                    <th class="px-4 py-3 text-right">Сумма</th>
                    <th class="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody v-if="draftItems.length" class="divide-y">
                  <tr v-for="(item, index) in draftItems" :key="item.product.id">
                    <td class="px-2 py-3 text-sm text-gray-400">{{ index + 1 }}</td>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3">
                        <img
                          v-if="item.product.image"
                          :src="item.product.image"
                          class="h-10 w-10 flex-shrink-0 rounded object-cover"
                          :alt="item.product.title"
                        />
                        <div v-else class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-gray-100">
                          <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div>
                          <div class="font-medium text-gray-900">
                            {{ item.product.title }}
                            <span v-if="item.product.variantName" class="text-gray-500 font-normal">
                              , {{ item.product.variantName }}
                            </span>
                          </div>
                          <div
                            v-if="item.product.groupName"
                            class="text-xs font-semibold text-blue-600"
                          >
                            {{ item.product.groupName }}
                          </div>
                          <div class="text-xs text-gray-500">
                            Текущая себестоимость:
                            {{ formatCurrency(item.product.costPrice) }}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-600">
                      <div>Розница: {{ item.product.stock }} шт</div>
                      <div>Склад: {{ Number(item.product.warehouseStock || 0) }} шт</div>
                    </td>
                    <td class="px-4 py-3">
                      <input
                        v-model.number="item.quantity"
                        type="number"
                        min="1"
                        class="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        @change="clampQuantity(item)"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <input
                        v-model.number="item.warehouseQuantity"
                        type="number"
                        min="0"
                        :max="item.quantity"
                        class="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        @change="clampWarehouseQuantity(item)"
                      />
                      <div class="mt-1 whitespace-nowrap text-[11px] text-gray-500">
                        В розницу: {{ item.quantity - item.warehouseQuantity }}
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <input
                        v-model.number="item.costPerUnit"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        @change="clampCost(item)"
                      />
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-600">
                      {{ projectedCostLabel(item) }}
                    </td>
                    <td
                      class="px-4 py-3 text-right font-semibold text-gray-900"
                    >
                      {{ formatCurrency(item.quantity * item.costPerUnit) }}
                    </td>
                    <td class="px-4 py-3 text-right">
                      <button
                        class="admin-link-button admin-link-button--danger"
                        @click="removeItem(item.product.id)"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                </tbody>
                <tbody v-else>
                  <tr>
                    <td
                      class="px-4 py-6 text-center text-sm text-gray-500"
                      colspan="9"
                    >
                      Добавьте товары, чтобы сформировать закупку
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="space-y-6">
          <div v-if="draftItems.length" class="rounded-xl border border-gray-200 bg-white p-5">
            <h4 class="text-sm font-semibold text-gray-900">Быстрое распределение</h4>
            <p class="mt-1 text-xs text-gray-500">Укажите, сколько единиц каждой позиции отправить на склад.</p>
            <div class="mt-4 flex gap-2">
              <input
                v-model.number="bulkWarehouseQuantity"
                type="number"
                min="0"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="Например, 5"
              />
              <button
                type="button"
                class="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                @click="applyWarehouseQuantityToAll"
              >
                Применить ко всем
              </button>
            </div>
          </div>

          <div class="rounded-xl border border-blue-100 bg-blue-50 p-5">
            <h4 class="text-sm font-semibold text-blue-900">
              Итого по закупке
            </h4>
            <div class="mt-4 space-y-2 text-sm text-blue-900">
              <div class="flex justify-between">
                <span>Позиций</span>
                <span>{{ draftItems.length }}</span>
              </div>
              <div class="flex justify-between">
                <span>Количество</span>
                <span>{{ draftTotalQuantity }} шт</span>
              </div>
              <div class="flex justify-between">
                <span>На склад</span>
                <span>{{ draftWarehouseQuantity }} шт</span>
              </div>
              <div class="flex justify-between">
                <span>В розницу</span>
                <span>{{ draftRetailQuantity }} шт</span>
              </div>
              <div class="flex justify-between text-base font-semibold">
                <span>Сумма закупки</span>
                <span>{{ formatCurrency(draftTotalAmount) }}</span>
              </div>
            </div>
          </div>

          <button
            class="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-blue-300"
            :disabled="!canSubmitProcurement || creatingProcurement"
            @click="requestSaveProcurement"
          >
            {{
              creatingProcurement
                ? "Сохраняем…"
                : editingProcurementId
                  ? "Сохранить изменения"
                  : "Создать закупку"
            }}
          </button>
        </aside>
      </div>
    </AdminModal>

    <AdminModal
      v-if="detailModalOpen && !actorPromptOpen"
      ref="detailModalRef"
      :isOpen="true"
      :title="
        activeProcurement
          ? `Закупка #${activeProcurement.procurement_number}`
          : 'Закупка'
      "
      :description="activeProcurement?.supplier_name || 'Без поставщика'"
      size="xl"
      :showActions="false"
      :persistent="true"
      @close="closeDetails"
      @cancel="closeDetails"
    >
      <div v-if="detailLoading" class="py-12 text-center text-gray-500">
        Загружаем детали…
      </div>
      <div v-else-if="activeProcurement" class="space-y-6">
        <div
          class="flex flex-wrap justify-end gap-2 border-b border-gray-100 pb-4"
        >
          <button
            v-if="activeProcurement.status === 'draft'"
            class="admin-link-button admin-link-button--edit admin-link-button--compact"
            @click="editFromDetails"
          >
            Редактировать
          </button>
          <button
            v-if="
              activeProcurement.expense_transaction_id &&
              activeProcurement.status === 'completed'
            "
            class="admin-link-button admin-link-button--danger"
            @click="removePaymentFromDetails"
          >
            Удалить оплату
          </button>
          <button
            class="admin-link-button admin-link-button--danger"
            @click="deleteCurrentProcurement"
          >
            Удалить закупку
          </button>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="text-xs uppercase text-gray-500">Статус</div>
            <div class="mt-2 text-sm font-semibold text-gray-900">
              {{ statusLabel(activeProcurement.status) }}
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="text-xs uppercase text-gray-500">Кто создал</div>
            <div class="mt-2 text-sm font-semibold text-gray-900">
              {{ activeProcurement.created_by_name || "—" }}
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="text-xs uppercase text-gray-500">Кто принял</div>
            <div class="mt-2 text-sm font-semibold text-gray-900">
              {{ activeProcurement.accepted_by_name || "—" }}
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="text-xs uppercase text-gray-500">Создана</div>
            <div class="mt-2 text-sm font-semibold text-gray-900">
              {{ formatDate(activeProcurement.created_at) }}
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="text-xs uppercase text-gray-500">Сумма</div>
            <div class="mt-2 text-sm font-semibold text-gray-900">
              {{ formatCurrency(activeProcurement.total_amount) }}
            </div>
          </div>
        </div>

        <div
          v-if="activeProcurement.notes"
          class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"
        >
          {{ activeProcurement.notes }}
        </div>

        <div class="rounded-lg border border-gray-200">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[680px] text-sm">
              <thead
                class="bg-gray-50 text-xs font-medium uppercase text-gray-500"
              >
                <tr>
                  <th class="px-4 py-3 text-left">Товар</th>
                  <th class="px-4 py-3 text-left">Кол-во</th>
                  <th class="px-4 py-3 text-left">Распределение</th>
                  <th class="px-4 py-3 text-left">Цена</th>
                  <th class="px-4 py-3 text-right">Сумма</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr
                  v-for="item in activeProcurement.items || []"
                  :key="item.id"
                >
                  <td class="px-4 py-3">
                    <div class="flex items-start gap-3">
                      <img
                        v-if="item.product_image"
                        :src="item.product_image"
                        class="h-10 w-10 flex-shrink-0 rounded object-cover ring-1 ring-gray-200"
                        :alt="item.product_title"
                        loading="lazy"
                      />
                      <div
                        v-else
                        class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-gray-100"
                        aria-hidden="true"
                      >
                        <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="font-medium text-gray-900">
                          {{ item.product_title }}
                          <span v-if="item.variant_name" class="text-gray-500 font-normal">
                            , {{ item.variant_name }}
                          </span>
                        </div>
                        <div
                          v-if="item.group_name"
                          class="text-xs font-semibold text-blue-600"
                        >
                          {{ item.group_name }}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">
                    {{ item.quantity }} шт
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">
                    <div>Склад: {{ Number(item.warehouse_quantity || 0) }} шт</div>
                    <div>Розница: {{ item.quantity - Number(item.warehouse_quantity || 0) }} шт</div>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">
                    {{ formatCurrency(item.cost_per_unit) }}
                  </td>
                  <td
                    class="px-4 py-3 text-right text-sm font-semibold text-gray-900"
                  >
                    {{ formatCurrency(item.total_cost) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <button
          v-if="activeProcurement.status === 'draft'"
          class="w-full rounded-lg bg-green-600 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-green-300"
          :disabled="completingProcurement"
          @click="completeFromDetails"
        >
          {{
            completingProcurement
              ? "Завершаем…"
              : "Подтвердить и оприходовать товары"
          }}
        </button>
      </div>
    </AdminModal>

    <AdminModal
      v-if="showQuickProductModal && !showQuickCategoryModal && !showQuickGroupModal"
      ref="quickProductModalRef"
      :isOpen="true"
      title="Новый товар"
      description="Быстро создайте товар, чтобы добавить его в закупку."
      size="lg"
      :showActions="false"
      :persistent="true"
      :isLoading="quickProductSaving || quickProductUploading"
      @close="closeQuickProductModal"
      @cancel="closeQuickProductModal"
    >
      <form
        class="w-full max-w-2xl space-y-4"
        @submit.prevent="submitQuickProduct"
      >
        <div class="grid gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
            Категория
            <select
              v-model="quickProduct.categoryId"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              required
            >
              <option value="" disabled>Выберите категорию</option>
              <option
                v-for="category in adminCategories"
                :key="category.id"
                :value="category.id"
              >
                {{ category.name }}
              </option>
            </select>
          </label>
          <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
            Линейка
            <select
              v-model="quickProduct.groupId"
              :disabled="!quickProduct.categoryId || !quickGroups.length"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
            >
              <option value="">Без линейки</option>
              <option
                v-for="group in quickGroups"
                :key="group.id"
                :value="group.id"
              >
                {{ group.name }}
              </option>
            </select>
          </label>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
            @click="openQuickCategoryModal"
          >
            + Новая категория
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg border border-dashed border-purple-200 px-3 py-2 text-xs font-semibold text-purple-600 transition hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            :disabled="!quickProduct.categoryId"
            @click="openQuickGroupModal"
          >
            + Новая линейка
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium text-gray-700">
            {{ quickProduct.titles.length > 1 ? "Названия товаров" : "Название товара" }}
          </span>
          <div
            v-for="(_, index) in quickProduct.titles"
            :key="index"
            class="flex items-center gap-2"
          >
            <input
              v-model.trim="quickProduct.titles[index]"
              :ref="(el) => setQuickTitleInput(el, index)"
              type="text"
              class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              :placeholder="index === 0 ? 'Например, Кремовое мороженое' : 'Ещё один вкус'"
              data-test="quick-product-title"
              @keydown.enter.prevent="addQuickProductTitle(index)"
            />
            <button
              v-if="quickProduct.titles.length > 1"
              type="button"
              class="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              :aria-label="`Убрать поле ${index + 1}`"
              data-test="quick-product-title-remove"
              @click="removeQuickProductTitle(index)"
            >
              ✕
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
              data-test="quick-product-title-add"
              @click="addQuickProductTitle()"
            >
              + Ещё название
            </button>
            <span class="text-xs text-gray-500">
              Категория, линейка, цены и остаток у всех будут общие
            </span>
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
            Розничная цена, BYN
            <input
              v-model.number="quickProduct.priceRub"
              type="number"
              min="0"
              step="1"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
          <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
            Себестоимость, BYN
            <input
              v-model.number="quickProduct.costPrice"
              type="number"
              min="0"
              step="0.01"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
            Остаток в рознице, шт
            <input
              v-model.number="quickProduct.stock"
              type="number"
              min="0"
              step="1"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
          <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
            Минимальный остаток, шт
            <input
              v-model.number="quickProduct.minStock"
              type="number"
              min="0"
              step="1"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
        </div>

        <!-- Использовать фото категории -->
        <div
          class="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer"
          @click="
            quickProduct.useCategoryImage = !quickProduct.useCategoryImage
          "
        >
          <input
            type="checkbox"
            :checked="quickProduct.useCategoryImage"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-200 pointer-events-none"
          />
          <div class="flex-1">
            <span class="text-sm font-medium text-gray-700">
              Использовать фото категории
            </span>
            <p class="text-xs text-gray-500 mt-0.5">
              Товар будет использовать обложку своей категории/линейки
            </p>
          </div>
        </div>

        <div
          v-if="!quickProduct.useCategoryImage"
          class="space-y-3 rounded-lg border border-gray-200 bg-white/60 p-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="text-sm font-medium text-gray-700">Фото товара</div>
            <div class="flex items-center gap-2">
              <input
                ref="quickProductFileInput"
                type="file"
                class="hidden"
                accept="image/*"
                multiple
                @change="onQuickProductFilesSelected"
              />
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                :disabled="quickProductUploading"
                @click="triggerQuickProductUpload"
              >
                <svg
                  v-if="quickProductUploading"
                  class="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span>{{
                  quickProductUploading ? "Загружаем…" : "Добавить фото"
                }}</span>
              </button>
            </div>
          </div>
          <div
            v-if="quickProductImages.length"
            class="grid gap-3 sm:grid-cols-3"
          >
            <div
              v-for="(image, index) in quickProductImages"
              :key="`${image}-${index}`"
              class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
            >
              <img
                :src="image"
                alt="Фото товара"
                class="h-32 w-full object-cover"
              />
              <button
                type="button"
                class="admin-link-button admin-link-button--danger admin-link-button--compact absolute top-2 right-2"
                @click="removeQuickProductImage(index)"
              >
                Удалить
              </button>
            </div>
          </div>
          <p v-else class="text-xs text-gray-500">
            Добавьте изображения товара
          </p>
        </div>

        <p
          v-if="quickProductError"
          class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {{ quickProductError }}
        </p>

        <div class="flex gap-3 pt-2">
          <button
            type="button"
            class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            :disabled="quickProductSaving || quickProductUploading"
            @click="submitQuickProduct"
          >
            {{ quickProductSubmitLabel }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
            :disabled="quickProductSaving || quickProductUploading"
            @click="closeQuickProductModal"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>

    <AdminModal
      v-if="showQuickCategoryModal"
      :isOpen="showQuickCategoryModal"
      title="Новая категория"
      description="Создайте категорию без выхода из формы закупки."
      size="sm"
      :showActions="false"
      :persistent="true"
      :isLoading="creatingQuickCategory"
      :initialFocus="quickCategoryNameInput"
      @close="closeQuickCategoryModal"
      @cancel="closeQuickCategoryModal"
    >
      <form class="space-y-4" @submit.prevent="submitQuickCategory">
        <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
          Название категории
          <input
            ref="quickCategoryNameInput"
            v-model.trim="quickCategoryName"
            type="text"
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="Например, Мороженое"
            required
          />
        </label>
        <p
          v-if="quickCategoryError"
          class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
        >
          {{ quickCategoryError }}
        </p>
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            :disabled="creatingQuickCategory"
          >
            {{ creatingQuickCategory ? "Создаём…" : "Создать" }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
            :disabled="creatingQuickCategory"
            @click="closeQuickCategoryModal"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>

    <AdminModal
      v-if="showQuickGroupModal"
      :isOpen="showQuickGroupModal"
      :title="quickProduct.categoryId ? 'Новая линейка' : 'Выберите категорию'"
      :description="
        quickProduct.categoryId
          ? 'Линейка будет добавлена в выбранную категорию.'
          : 'Сначала выберите категорию товара.'
      "
      size="sm"
      :showActions="false"
      :persistent="true"
      :isLoading="creatingQuickGroup"
      :initialFocus="quickGroupNameInput"
      @close="closeQuickGroupModal"
      @cancel="closeQuickGroupModal"
    >
      <form class="space-y-4" @submit.prevent="submitQuickGroup">
        <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
          Название линейки
          <input
            ref="quickGroupNameInput"
            v-model.trim="quickGroupName"
            type="text"
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="Например, Кремовая"
            required
          />
        </label>
        <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
          Родительская линейка
          <select
            v-model="quickGroupParentId"
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">Без родителя</option>
            <option
              v-for="group in quickGroups"
              :key="group.id"
              :value="group.id"
            >
              {{ group.name }}
            </option>
          </select>
        </label>
        <p
          v-if="quickGroupError"
          class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
        >
          {{ quickGroupError }}
        </p>
        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            class="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-300"
            :disabled="creatingQuickGroup"
          >
            {{ creatingQuickGroup ? "Создаём…" : "Создать" }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
            :disabled="creatingQuickGroup"
            @click="closeQuickGroupModal"
          >
            Отмена
          </button>
        </div>
      </form>
    </AdminModal>

    <StaffActorPrompt
      :open="actorPromptOpen"
      :title="actorPromptTitle"
      :description="actorPromptDescription"
      :context="actorPromptContext"
      :action-label="actorPromptActionLabel"
      :loading="actorPromptLoading"
      :error="actorPromptError"
      :error-code="actorPromptErrorCode"
      @close="closeActorPrompt"
      @confirm="confirmActorAction"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, reactive, nextTick } from "vue";
import { storeToRefs } from "pinia";
import {
  useCrmStore,
  type Procurement,
  type CrmProductSummary,
} from "@/stores/crm";
import { useAdminStore } from "@/stores/admin";
import AdminModal from "@/components/AdminModal.vue";
import LowStockGroupsPanel from "@/components/admin/LowStockGroupsPanel.vue";
import TotalControlPanel from "@/components/admin/TotalControlPanel.vue";
import { LockClosedIcon } from "@heroicons/vue/24/outline";
import CrmProfitPasswordField from "@/components/crm/CrmProfitPasswordField.vue";
import StaffActorPrompt from "@/components/admin/staff/StaffActorPrompt.vue";

interface DraftProcurementItem {
  product: CrmProductSummary;
  quantity: number;
  costPerUnit: number;
  warehouseQuantity: number;
}

const crmStore = useCrmStore();
const adminStore = useAdminStore();
const {
  procurements,
  loadingProcurements,
  lowStockProducts,
  profitUnlocked,
  verifyingProfitAccess,
  staffTrackingEnabled,
} = storeToRefs(crmStore);

const showCreateModal = ref(false);
const createModalRef = ref<{ scrollContainer: HTMLElement | null } | null>(null);
const savedCreateModalScrollTop = ref(0);
const editingProcurementId = ref<string | null>(null);
const supplierName = ref("");
const draftNotes = ref("");
const draftItems = ref<DraftProcurementItem[]>([]);
const productSearch = ref("");
const productResults = ref<CrmProductSummary[]>([]);
const isSearchingProducts = ref(false);
const isLoadingMoreProducts = ref(false);
const productSearchHasMore = ref(false);
const loadMoreProductsError = ref("");
const searchError = ref("");
const productSearchRequestId = ref(0);
const loadedProductSearchQuery = ref("");
const PRODUCT_SEARCH_PAGE_SIZE = 50;
const lowStockLoading = ref(false);
const creatingProcurement = ref(false);
const procurementCreateKey = ref(newRequestKey());
const actorPromptOpen = ref(false);
const actorPromptError = ref("");
const actorPromptErrorCode = ref("");
const actorAction = ref<"save" | "complete" | null>(null);
const actorProcurementId = ref<string | null>(null);
const actorPromptLoading = computed(
  () => creatingProcurement.value || completingProcurement.value,
);
const procurementCompletionKeys = new Map<string, string>();
const actorPromptTitle = computed(() =>
  actorAction.value === "complete"
    ? "Оприходовать закупку"
    : editingProcurementId.value
      ? "Сохранить изменения"
      : "Создать закупку",
);
const actorPromptDescription = computed(() =>
  actorAction.value === "complete"
    ? "Проверьте сотрудника: после подтверждения остатки изменятся."
    : "Подтвердите, кто оформляет закупку. Черновик формы останется на месте при ошибке.",
);
const actorPromptActionLabel = computed(() =>
  actorAction.value === "complete"
    ? "Оприходовать закупку"
    : editingProcurementId.value
      ? "Сохранить изменения"
      : "Создать закупку",
);
const actorPromptProcurement = computed(() => {
  const id = actorProcurementId.value || editingProcurementId.value;
  if (!id) return null;
  if (activeProcurement.value?.id === id) return activeProcurement.value;
  return procurements.value.find((procurement) => procurement.id === id) || null;
});
const actorPromptContext = computed(() => {
  if (!actorAction.value) return "";
  if (actorAction.value === "complete") {
    const procurement = actorPromptProcurement.value;
    if (!procurement) return "Выбранная закупка";
    const quantity = procurement.items?.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );
    return [
      `Закупка #${procurement.procurement_number}`,
      procurement.supplier_name || "Без поставщика",
      [
        quantity ? `${quantity} шт` : "",
        formatCurrency(procurement.total_amount),
      ].filter(Boolean).join(" · "),
    ].filter(Boolean).join("\n");
  }
  const edited = actorPromptProcurement.value;
  return [
    edited ? `Закупка #${edited.procurement_number}` : "Новая закупка",
    supplierName.value.trim() || "Без поставщика",
    `${draftItems.value.length} поз. · ${draftTotalQuantity.value} шт · ${formatCurrency(draftTotalAmount.value)}`,
  ].join("\n");
});
const bulkWarehouseQuantity = ref<number | null>(null);
const initialDraftSignature = ref("");

const showQuickProductModal = ref(false);
const quickProductModalRef = ref<{ scrollContainer: HTMLElement | null } | null>(null);
const savedQuickProductModalScrollTop = ref(0);
const quickProductSaving = ref(false);
const quickProductError = ref("");
const quickProduct = reactive({
  categoryId: "",
  groupId: "",
  // Вкусы одной линейки отличаются только названием, поэтому имён может быть
  // сколько угодно, а остальные поля общие: менеджеру не нужно открывать
  // форму заново на каждый вкус.
  titles: [""],
  priceRub: 0,
  costPrice: 0,
  stock: 0,
  minStock: 0,
  useCategoryImage: true,
});
const quickProductImages = ref<string[]>([]);
const quickProductUploading = ref(false);
const quickProductFileInput = ref<HTMLInputElement | null>(null);
const quickTitleInputs = ref<HTMLInputElement[]>([]);

function setQuickTitleInput(el: unknown, index: number) {
  if (el instanceof HTMLInputElement) quickTitleInputs.value[index] = el;
}

function restoreModalScroll(
  modalRef: { value: { scrollContainer: HTMLElement | null } | null },
  scrollTop: number,
) {
  void nextTick(() => {
    const scrollContainer = modalRef.value?.scrollContainer;
    if (scrollContainer) scrollContainer.scrollTop = scrollTop;
  });
}

/**
 * Новое поле для названия. Курсор уезжает в него сразу: вкусы вбивают пачкой,
 * и тянуться мышкой после каждого имени — та же морока, ради которой всё и
 * затевалось.
 */
function addQuickProductTitle(afterIndex?: number) {
  const at = afterIndex === undefined ? quickProduct.titles.length : afterIndex + 1;
  quickProduct.titles.splice(at, 0, "");
  nextTick(() => quickTitleInputs.value[at]?.focus());
}

function removeQuickProductTitle(index: number) {
  if (quickProduct.titles.length <= 1) return;
  quickProduct.titles.splice(index, 1);
  quickTitleInputs.value.splice(index, 1);
}

const quickProductSubmitLabel = computed(() => {
  const count = quickProductTitles.value.length;
  if (quickProductSaving.value) return "Создаём…";
  return count > 1 ? `Создать ${count} и добавить` : "Создать и добавить";
});

/** Непустые названия без повторов: одно и то же имя дважды создало бы дубль. */
const quickProductTitles = computed(() => {
  const seen = new Set<string>();
  return quickProduct.titles
    .map((title) => title.trim())
    .filter((title) => {
      if (!title) return false;
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
});
const showQuickCategoryModal = ref(false);
const quickCategoryName = ref("");
const quickCategoryNameInput = ref<HTMLInputElement | null>(null);
const quickCategoryError = ref("");
const creatingQuickCategory = ref(false);
const showQuickGroupModal = ref(false);
const quickGroupName = ref("");
const quickGroupNameInput = ref<HTMLInputElement | null>(null);
const quickGroupParentId = ref("");
const quickGroupError = ref("");
const creatingQuickGroup = ref(false);
const loadedQuickGroupCategories = new Set<string>();

const detailModalOpen = ref(false);
const detailModalRef = ref<{ scrollContainer: HTMLElement | null } | null>(null);
const savedDetailModalScrollTop = ref(0);
const detailLoading = ref(false);
const activeProcurement = ref<Procurement | null>(null);
const completingProcurement = ref(false);

const showPasswordModal = ref(false);
const passwordInput = ref("");
const passwordError = ref("");
const verifyingPassword = computed(() => verifyingProfitAccess.value);

const draftCount = computed(
  () => procurements.value.filter((p) => p.status === "draft").length,
);
const completedCount = computed(
  () => procurements.value.filter((p) => p.status === "completed").length,
);
const draftAmount = computed(() =>
  procurements.value
    .filter((p) => p.status === "draft")
    .reduce((total, p) => total + (p.total_amount || 0), 0),
);
const completedAmount = computed(() =>
  procurements.value
    .filter((p) => p.status === "completed")
    .reduce((total, p) => total + (p.total_amount || 0), 0),
);

const adminCategories = computed(() => adminStore.categories);
const adminCategoryGroups = computed(() => adminStore.categoryGroups);
const quickGroups = computed(() => {
  if (!quickProduct.categoryId) return [];
  return adminCategoryGroups.value.filter(
    (group) => group.categoryId === quickProduct.categoryId,
  );
});

const draftTotalQuantity = computed(() =>
  draftItems.value.reduce((sum, item) => sum + item.quantity, 0),
);
const draftTotalAmount = computed(() =>
  draftItems.value.reduce(
    (sum, item) => sum + item.quantity * item.costPerUnit,
    0,
  ),
);
const draftWarehouseQuantity = computed(() =>
  draftItems.value.reduce((sum, item) => sum + Number(item.warehouseQuantity || 0), 0),
);
const draftRetailQuantity = computed(() => draftTotalQuantity.value - draftWarehouseQuantity.value);
const draftAverageCost = computed(() => {
  if (!draftItems.value.length) return 0;
  return draftTotalAmount.value / draftTotalQuantity.value || 0;
});
const hasDraftIssues = computed(() =>
  draftItems.value.some((item) =>
    item.quantity <= 0
    || item.costPerUnit <= 0
    || item.warehouseQuantity < 0
    || item.warehouseQuantity > item.quantity,
  ),
);
const canSubmitProcurement = computed(
  () => draftItems.value.length > 0 && !hasDraftIssues.value,
);

const lowStockSuggestions = computed(() => {
  const selected = new Set(draftItems.value.map((item) => item.product.id));
  return lowStockProducts.value
    .map((row: any) => normalizeProduct(row))
    .filter((product) => !selected.has(product.id))
    .slice(0, 6);
});

const showSearchHint = computed(() => {
  const length = productSearch.value.trim().length;
  return length > 0 && length < 2;
});

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

function invalidateProductSearch() {
  productSearchRequestId.value += 1;
  isSearchingProducts.value = false;
  isLoadingMoreProducts.value = false;
}

function clearProductSearchState() {
  if (searchDebounce) {
    clearTimeout(searchDebounce);
    searchDebounce = null;
  }
  invalidateProductSearch();
  searchError.value = "";
  loadMoreProductsError.value = "";
  productResults.value = [];
  productSearchHasMore.value = false;
  loadedProductSearchQuery.value = "";
}

onMounted(async () => {
  await crmStore.fetchStaffSettings().catch(() => undefined);
  if (profitUnlocked.value) {
    await crmStore.fetchProcurements();
  }
  void ensureCategoriesLoaded();
});

watch(profitUnlocked, async (unlocked) => {
  if (unlocked) {
    await crmStore.fetchProcurements();
  } else {
    showCreateModal.value = false;
    detailModalOpen.value = false;
    showQuickProductModal.value = false;
    showQuickCategoryModal.value = false;
    showQuickGroupModal.value = false;
    showPasswordModal.value = false;
  }
});

// Автообновление списка товаров с низким остатком при открытии модального окна
watch(showCreateModal, async (isOpen) => {
  if (!isOpen) {
    clearProductSearchState();
    return;
  }
  if (profitUnlocked.value) {
    // Обновляем список каждый раз при открытии
    await refreshLowStock();
  }
});

watch(productSearch, (query) => {
  if (!showCreateModal.value) return;
  if (searchDebounce) clearTimeout(searchDebounce);
  invalidateProductSearch();
  productSearchHasMore.value = false;
  loadMoreProductsError.value = "";
  searchDebounce = setTimeout(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      void loadProducts();
      return;
    }
    if (trimmed.length < 2) {
      clearProductSearchState();
      return;
    }
    void loadProducts(trimmed);
  }, 250);
});

watch(
  () => quickProduct.categoryId,
  async (categoryId) => {
    quickProduct.groupId = "";
    quickGroupParentId.value = "";
    if (!categoryId) return;
    try {
      if (!loadedQuickGroupCategories.has(categoryId)) {
        await adminStore.fetchCategoryGroups(categoryId);
        loadedQuickGroupCategories.add(categoryId);
      }
    } catch (error) {
      console.error("[CRM] fetch category groups error", error);
      quickProductError.value =
        "Не удалось загрузить линейки для выбранной категории";
    }
  },
);

function normalizeProduct(row: any): CrmProductSummary {
  return {
    id: String(row.id),
    productId: row.product_id ? String(row.product_id) : String(row.id), // Для вариантов - ID базового товара
    title: row.title ?? row.product_title ?? "Без названия",
    priceRub: Number(row.priceRub ?? row.price_rub ?? 0),
    costPrice: Number(row.costPrice ?? row.cost_price ?? 0),
    stock: Number(row.stock ?? 0),
    warehouseStock: Number(row.warehouse_stock ?? row.warehouseStock ?? 0),
    companyStock: Number(
      row.total_stock
      ?? row.base_total_stock
      ?? row.companyStock
      ?? (Number(row.stock ?? 0) + Number(row.warehouse_stock ?? row.warehouseStock ?? 0)),
    ),
    minStock: Number(row.minStock ?? row.min_stock ?? 0),
    categoryId: String(row.categoryId ?? row.category_id ?? ""),
    categoryName: row.categoryName ?? row.category_name ?? null,
    groupId: row.groupId
      ? String(row.groupId)
      : row.group_id
        ? String(row.group_id)
        : null,
    groupName: row.groupName ?? row.group_name ?? null,
    isVariant: row.is_variant === true,
    variantName: row.variant_name ?? null,
    image: row.image ?? row.product_image ?? null,
  };
}

function convertAdminProductToCrmSummary(product: any): CrmProductSummary {
  const category = adminCategories.value.find(
    (c) => c.id === product.categoryId,
  );
  const group = product.groupId
    ? adminCategoryGroups.value.find((g) => g.id === product.groupId)
    : null;
  return {
    id: String(product.id),
    title: product.title ?? "Без названия",
    priceRub: Number(product.priceRub ?? 0),
    costPrice: Number(product.costPrice ?? 0),
    stock: Number(product.stock ?? 0),
    warehouseStock: Number(product.warehouseStock ?? 0),
    companyStock: Number(product.stock ?? 0) + Number(product.warehouseStock ?? 0),
    minStock: Number(product.minStock ?? 0),
    categoryId: String(product.categoryId ?? ""),
    categoryName: category?.name ?? null,
    groupId: product.groupId ? String(product.groupId) : null,
    groupName: group?.name ?? null,
  };
}

async function loadProducts(search?: string, append = false) {
  const requestId = ++productSearchRequestId.value;
  if (append) {
    isLoadingMoreProducts.value = true;
  } else {
    isSearchingProducts.value = true;
  }
  searchError.value = "";
  loadMoreProductsError.value = "";
  try {
    const results = await crmStore.searchCrmProducts({
      search,
      offset: append ? productResults.value.length : 0,
      limit: PRODUCT_SEARCH_PAGE_SIZE + 1,
    });
    if (requestId !== productSearchRequestId.value) return;
    const page = results.slice(0, PRODUCT_SEARCH_PAGE_SIZE);
    productSearchHasMore.value = results.length > PRODUCT_SEARCH_PAGE_SIZE;
    if (append) {
      const knownIds = new Set(productResults.value.map((product) => product.id));
      productResults.value.push(...page.filter((product) => !knownIds.has(product.id)));
    } else {
      productResults.value = page;
      loadedProductSearchQuery.value = search?.trim() ?? "";
    }
  } catch (error) {
    if (requestId !== productSearchRequestId.value) return;
    console.error("[CRM] search products error", error);
    if (append) {
      loadMoreProductsError.value = "Не удалось догрузить товары. Нажмите ещё раз.";
    } else {
      searchError.value =
        "Не удалось загрузить список товаров. Попробуйте обновить страницу.";
      productResults.value = [];
    }
  } finally {
    if (requestId === productSearchRequestId.value) {
      isSearchingProducts.value = false;
      isLoadingMoreProducts.value = false;
    }
  }
}

function loadMoreProducts() {
  if (!productSearchHasMore.value || isLoadingMoreProducts.value || isSearchingProducts.value) return;
  void loadProducts(loadedProductSearchQuery.value || undefined, true);
}

function handleProductResultsScroll(event: Event) {
  const target = event.currentTarget as HTMLElement;
  if (target.scrollHeight - target.scrollTop - target.clientHeight <= 80) {
    loadMoreProducts();
  }
}

function openPasswordModal() {
  passwordInput.value = "";
  passwordError.value = "";
  showPasswordModal.value = true;
}

function closePasswordModal() {
  showPasswordModal.value = false;
  passwordInput.value = "";
  passwordError.value = "";
}

async function submitPassword() {
  if (!passwordInput.value.trim()) {
    passwordError.value = "Введите ключ";
    return;
  }

  passwordError.value = "";
  try {
    await crmStore.verifyProfitPassword(passwordInput.value.trim());
    closePasswordModal();
    await crmStore.fetchProcurements();
  } catch (error) {
    passwordError.value = "Неверный ключ";
  }
}

async function openCreateModal() {
  if (!profitUnlocked.value) {
    openPasswordModal();
    return;
  }

  editingProcurementId.value = null;
  procurementCreateKey.value = newRequestKey();
  supplierName.value = "";
  draftNotes.value = "";
  draftItems.value = [];
  bulkWarehouseQuantity.value = null;
  productSearch.value = "";
  clearProductSearchState();
  initialDraftSignature.value = procurementDraftSignature();
  showCreateModal.value = true;
  quickProductError.value = "";
  await loadProducts();
  // Обновление произойдет автоматически через watch(showCreateModal)
}

function closeCreateModal(force = false) {
  if (
    !force
    &&
    procurementDraftSignature() !== initialDraftSignature.value
    && !confirm("Закрыть закупку? Несохранённые товары и распределение будут потеряны.")
  ) {
    return;
  }
  showCreateModal.value = false;
  editingProcurementId.value = null;
  procurementCreateKey.value = newRequestKey();
  initialDraftSignature.value = "";
  clearProductSearchState();
}

async function refreshLowStock() {
  lowStockLoading.value = true;
  try {
    await crmStore.fetchLowStockProducts();
  } finally {
    lowStockLoading.value = false;
  }
}

function addProduct(product: CrmProductSummary) {
  const existing = draftItems.value.find(
    (item) => item.product.id === product.id,
  );
  if (existing) {
    existing.quantity += 1;
    return;
  }
  draftItems.value.push({
    product,
    quantity: 1,
    costPerUnit: product.costPrice > 0 ? product.costPrice : product.priceRub,
    warehouseQuantity: 0,
  });
}

function getAddedQuantity(productId: string): number {
  const item = draftItems.value.find((i) => i.product.id === productId);
  return item?.quantity ?? 0;
}

function decreaseProduct(productId: string) {
  const item = draftItems.value.find((i) => i.product.id === productId);
  if (!item) return;
  if (item.quantity <= 1) {
    draftItems.value = draftItems.value.filter((i) => i.product.id !== productId);
  } else {
    item.quantity -= 1;
    clampWarehouseQuantity(item);
  }
}

async function startEditProcurement(id: string, existing?: Procurement | null) {
  try {
    let procurement: Procurement | null = existing ?? null;
    if (
      !procurement &&
      activeProcurement.value &&
      activeProcurement.value.id === id &&
      activeProcurement.value.items
    ) {
      procurement = activeProcurement.value;
    }
    if (!procurement) {
      procurement = await crmStore.fetchProcurement(id);
    }
    if (!procurement) return;

    editingProcurementId.value = id;
    supplierName.value = procurement.supplier_name || "";
    draftNotes.value = procurement.notes || "";
    draftItems.value = (procurement.items || []).map((item) => ({
      product: normalizeProduct({
        id: item.variant_id || item.product_id, // Для вариантов используем variant_id как id
        product_id: item.variant_id ? item.product_id : undefined, // productId только для вариантов
        title: item.product_title,
        group_name: item.group_name ?? null,
        cost_price: item.product_cost_price ?? item.cost_per_unit,
        priceRub: item.cost_per_unit,
        stock: item.variant_stock ?? item.stock ?? 0,
        warehouse_stock: item.variant_warehouse_stock ?? item.warehouse_stock ?? 0,
        base_total_stock: item.base_total_stock,
        min_stock: item.min_stock ?? 0,
        is_variant: !!item.variant_id,
        variant_name: item.variant_name ?? null,
        product_image: item.product_image ?? null,
      }),
      quantity: Number(item.quantity || 0),
      costPerUnit: Number(item.cost_per_unit || 0),
      warehouseQuantity: Number(item.warehouse_quantity || 0),
    }));
    bulkWarehouseQuantity.value = null;
    initialDraftSignature.value = procurementDraftSignature();

    productSearch.value = "";
    clearProductSearchState();
    showCreateModal.value = true;
    quickProductError.value = "";
    if (!lowStockProducts.value.length) {
      await refreshLowStock();
    }
    await loadProducts();
  } catch (error) {
    console.error("[CRM] edit procurement load error", error);
    alert("Не удалось загрузить закупку для редактирования");
  }
}

async function ensureCategoriesLoaded() {
  if (!adminCategories.value.length) {
    try {
      await adminStore.fetchCategories();
    } catch (error) {
      console.error("[CRM] fetch categories error", error);
      quickProductError.value = "Не удалось загрузить категории";
    }
  }
}

async function openQuickProductModal() {
  quickProductError.value = "";
  quickProduct.categoryId = "";
  quickProduct.groupId = "";
  quickProduct.titles = [""];
  quickProduct.priceRub = 0;
  quickProduct.costPrice = 0;
  quickProduct.stock = 0;
  quickProduct.minStock = 0;
  quickProduct.useCategoryImage = true;
  quickProductImages.value = [];
  quickGroupParentId.value = "";
  quickCategoryName.value = "";
  quickCategoryError.value = "";
  quickGroupName.value = "";
  quickGroupError.value = "";
  await ensureCategoriesLoaded();
  savedCreateModalScrollTop.value =
    createModalRef.value?.scrollContainer?.scrollTop ?? 0;
  showQuickProductModal.value = true;
}

function closeQuickProductModal() {
  showQuickProductModal.value = false;
  quickProductSaving.value = false;
  quickProductUploading.value = false;
  quickProductImages.value = [];
  quickCategoryError.value = "";
  quickGroupError.value = "";
  quickCategoryName.value = "";
  quickGroupName.value = "";
  quickGroupParentId.value = "";
  if (quickProductFileInput.value) {
    quickProductFileInput.value.value = "";
  }
  restoreModalScroll(createModalRef, savedCreateModalScrollTop.value);
}

function triggerQuickProductUpload() {
  quickProductFileInput.value?.click();
}

async function onQuickProductFilesSelected(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target?.files || !target.files.length) return;
  quickProductError.value = "";
  const files = Array.from(target.files);
  try {
    quickProductUploading.value = true;
    const uploaded = await adminStore.uploadFiles(files, "temp");
    if (uploaded && uploaded.length) {
      quickProductImages.value = [...quickProductImages.value, ...uploaded];
    }
  } catch (error) {
    console.error("[CRM] quick product upload error", error);
    quickProductError.value = "Не удалось загрузить фото товара";
  } finally {
    quickProductUploading.value = false;
    if (quickProductFileInput.value) {
      quickProductFileInput.value.value = "";
    }
  }
}

function removeQuickProductImage(index: number) {
  quickProductImages.value = quickProductImages.value.filter(
    (_, i) => i !== index,
  );
}

function openQuickCategoryModal() {
  quickCategoryName.value = "";
  quickCategoryError.value = "";
  savedQuickProductModalScrollTop.value =
    quickProductModalRef.value?.scrollContainer?.scrollTop ?? 0;
  showQuickCategoryModal.value = true;
  void nextTick(() => quickCategoryNameInput.value?.focus());
}

function closeQuickCategoryModal() {
  if (creatingQuickCategory.value) return;
  showQuickCategoryModal.value = false;
  quickCategoryError.value = "";
  quickCategoryName.value = "";
  restoreModalScroll(quickProductModalRef, savedQuickProductModalScrollTop.value);
}

async function submitQuickCategory() {
  if (creatingQuickCategory.value) return;
  const trimmed = quickCategoryName.value.trim();
  if (!trimmed) {
    quickCategoryError.value = "Введите название категории";
    return;
  }
  creatingQuickCategory.value = true;
  quickCategoryError.value = "";
  try {
    const created = await adminStore.createCategory({ name: trimmed });
    if (created) {
      if (
        !adminStore.categories.some((category) => category.id === created.id)
      ) {
        adminStore.categories.push(created);
      }
      quickProduct.categoryId = created.id;
      quickProduct.groupId = "";
      loadedQuickGroupCategories.delete(created.id);
      showQuickCategoryModal.value = false;
      quickCategoryName.value = "";
      restoreModalScroll(quickProductModalRef, savedQuickProductModalScrollTop.value);
    }
  } catch (error: any) {
    quickCategoryError.value =
      error?.data?.message || error?.message || "Не удалось создать категорию";
  } finally {
    creatingQuickCategory.value = false;
  }
}

async function openQuickGroupModal() {
  if (!quickProduct.categoryId) {
    quickProductError.value = "Сначала выберите категорию";
    return;
  }
  quickProductError.value = "";
  quickGroupError.value = "";
  quickGroupName.value = "";
  quickGroupParentId.value = "";
  try {
    if (!loadedQuickGroupCategories.has(quickProduct.categoryId)) {
      await adminStore.fetchCategoryGroups(quickProduct.categoryId);
      loadedQuickGroupCategories.add(quickProduct.categoryId);
    }
  } catch (error) {
    console.error("[CRM] fetch groups before create error", error);
    quickGroupError.value =
      "Не удалось загрузить линейки для выбранной категории";
  }
  if (!quickGroupError.value) {
    savedQuickProductModalScrollTop.value =
      quickProductModalRef.value?.scrollContainer?.scrollTop ?? 0;
    showQuickGroupModal.value = true;
    await nextTick();
    quickGroupNameInput.value?.focus();
  }
}

function closeQuickGroupModal() {
  if (creatingQuickGroup.value) return;
  showQuickGroupModal.value = false;
  quickGroupError.value = "";
  quickGroupName.value = "";
  quickGroupParentId.value = "";
  restoreModalScroll(quickProductModalRef, savedQuickProductModalScrollTop.value);
}

async function submitQuickGroup() {
  if (creatingQuickGroup.value) return;
  if (!quickProduct.categoryId) {
    quickGroupError.value = "Сначала выберите категорию";
    return;
  }
  const trimmed = quickGroupName.value.trim();
  if (!trimmed) {
    quickGroupError.value = "Введите название линейки";
    return;
  }
  creatingQuickGroup.value = true;
  quickGroupError.value = "";
  try {
    const created = await adminStore.createCategoryGroup({
      categoryId: quickProduct.categoryId,
      name: trimmed,
      parentId: quickGroupParentId.value || undefined,
    });
    if (created) {
      quickProduct.groupId = created.id;
      showQuickGroupModal.value = false;
      quickGroupName.value = "";
      quickGroupParentId.value = "";
      restoreModalScroll(quickProductModalRef, savedQuickProductModalScrollTop.value);
    }
  } catch (error: any) {
    quickGroupError.value =
      error?.data?.message || error?.message || "Не удалось создать линейку";
  } finally {
    creatingQuickGroup.value = false;
  }
}

async function submitQuickProduct() {
  if (quickProductSaving.value) return;
  quickProductError.value = "";

  if (!quickProductTitles.value.length) {
    quickProductError.value = "Укажите название товара";
    return;
  }
  if (!quickProduct.categoryId) {
    quickProductError.value = "Выберите категорию";
    return;
  }
  // Фото обязательно только если НЕ используется фото категории
  if (!quickProduct.useCategoryImage && !quickProductImages.value.length) {
    quickProductError.value =
      'Добавьте хотя бы одно фото товара или включите "Использовать фото категории"';
    return;
  }
  if (quickProduct.priceRub <= 0) {
    quickProductError.value = "Укажите розничную цену";
    return;
  }
  if (quickProduct.costPrice < 0) {
    quickProductError.value = "Себестоимость не может быть отрицательной";
    return;
  }

  quickProductSaving.value = true;
  const titles = quickProductTitles.value;
  // Товары создаются по одному, и сорваться может любой. Уже созданные надо
  // довести до закупки и убрать из формы, иначе повторное сохранение сделает
  // дубли, а менеджер не поймёт, на каком имени всё встало.
  const done: string[] = [];
  let failure = "";

  try {
    for (const title of titles) {
      try {
        const created = await adminStore.createProduct({
          categoryId: quickProduct.categoryId,
          groupId: quickProduct.groupId || null,
          title,
          priceRub: Math.round(quickProduct.priceRub),
          description: "",
          images: quickProduct.useCategoryImage
            ? []
            : [...quickProductImages.value],
          links: [],
          strength: null,
          costPrice: Number(quickProduct.costPrice || 0),
          stock: Number(quickProduct.stock || 0),
          minStock: Number(quickProduct.minStock || 0),
          useCategoryImage: quickProduct.useCategoryImage,
        });

        const summary = convertAdminProductToCrmSummary(created);
        addProduct(summary);
        productResults.value = [summary, ...productResults.value];
        done.push(title);
      } catch (error: any) {
        console.error("[CRM] quick product create error", title, error);
        failure = `${title}: ${error?.message || "не удалось создать"}`;
        break;
      }
    }

    if (done.length) {
      // Обновляем список товаров с низким остатком (вдруг новый товар уже в зоне риска)
      await refreshLowStock();
    }

    if (!failure) {
      closeQuickProductModal();
      return;
    }

    const doneKeys = new Set(done.map((title) => title.toLowerCase()));
    quickProduct.titles = quickProduct.titles.filter(
      (title) => !doneKeys.has(title.trim().toLowerCase()),
    );
    if (!quickProduct.titles.length) quickProduct.titles = [""];
    quickProductError.value = done.length
      ? `Добавили ${done.length} из ${titles.length}. Дальше не пошло — ${failure}`
      : `Не удалось создать товар. ${failure}`;
  } finally {
    quickProductSaving.value = false;
    if (!showQuickProductModal.value) quickProductImages.value = [];
  }
}

function removeItem(productId: string) {
  draftItems.value = draftItems.value.filter(
    (item) => item.product.id !== productId,
  );
}

function clampQuantity(item: DraftProcurementItem) {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    item.quantity = 1;
  }
  item.quantity = Math.floor(item.quantity);
  clampWarehouseQuantity(item);
}

function clampWarehouseQuantity(item: DraftProcurementItem) {
  const value = Math.floor(Number(item.warehouseQuantity || 0));
  item.warehouseQuantity = Math.min(Math.max(value, 0), item.quantity);
}

function applyWarehouseQuantityToAll() {
  const value = Math.max(0, Math.floor(Number(bulkWarehouseQuantity.value || 0)));
  bulkWarehouseQuantity.value = value;
  draftItems.value.forEach((item) => {
    item.warehouseQuantity = Math.min(value, item.quantity);
  });
}

function clampCost(item: DraftProcurementItem) {
  if (!Number.isFinite(item.costPerUnit) || item.costPerUnit <= 0) {
    item.costPerUnit =
      item.product.costPrice > 0
        ? item.product.costPrice
        : item.product.priceRub;
  }
}

function projectedCost(item: DraftProcurementItem) {
  const baseProductId = item.product.productId || item.product.id;
  const relatedItems = draftItems.value.filter(
    (draftItem) => (draftItem.product.productId || draftItem.product.id) === baseProductId,
  );
  const currentStock = Number(
    item.product.companyStock
    ?? (item.product.stock + Number(item.product.warehouseStock || 0)),
  );
  const currentTotal = currentStock * item.product.costPrice;
  const upcomingTotal = relatedItems.reduce(
    (sum, draftItem) => sum + draftItem.quantity * draftItem.costPerUnit,
    0,
  );
  const upcomingQuantity = relatedItems.reduce(
    (sum, draftItem) => sum + draftItem.quantity,
    0,
  );
  const totalQuantity = currentStock + upcomingQuantity;
  if (totalQuantity <= 0) return null;
  return (currentTotal + upcomingTotal) / totalQuantity;
}

function projectedCostLabel(item: DraftProcurementItem) {
  const value = projectedCost(item);
  if (value === null || Number.isNaN(value)) return "—";
  return formatCurrency(value);
}

async function ensureStaffTrackingKnown() {
  if (staffTrackingEnabled.value !== null) return true;
  try {
    await crmStore.fetchStaffSettings();
    return true;
  } catch {
    actorPromptError.value = "Не удалось проверить режим учёта сотрудников";
    window.alert(actorPromptError.value);
    return false;
  }
}

async function requestSaveProcurement() {
  if (!canSubmitProcurement.value || creatingProcurement.value) return;
  if (editingProcurementId.value) {
    await submitProcurement();
    return;
  }
  if (!await ensureStaffTrackingKnown()) return;
  if (!staffTrackingEnabled.value) {
    await submitProcurement();
    return;
  }
  actorAction.value = "save";
  actorProcurementId.value = null;
  actorPromptError.value = "";
  actorPromptErrorCode.value = "";
  savedCreateModalScrollTop.value =
    createModalRef.value?.scrollContainer?.scrollTop ?? 0;
  actorPromptOpen.value = true;
}

async function requestCompleteProcurement(id: string) {
  if (completingProcurement.value) return;
  if (!await ensureStaffTrackingKnown()) return;
  if (!staffTrackingEnabled.value) {
    await performCompleteProcurement(id);
    return;
  }
  actorAction.value = "complete";
  actorProcurementId.value = id;
  actorPromptError.value = "";
  actorPromptErrorCode.value = "";
  savedDetailModalScrollTop.value =
    detailModalRef.value?.scrollContainer?.scrollTop ?? 0;
  actorPromptOpen.value = true;
}

function closeActorPrompt() {
  if (actorPromptLoading.value) return;
  actorPromptOpen.value = false;
  actorPromptError.value = "";
  actorPromptErrorCode.value = "";
  actorAction.value = null;
  actorProcurementId.value = null;
  if (showCreateModal.value) {
    restoreModalScroll(createModalRef, savedCreateModalScrollTop.value);
  } else if (detailModalOpen.value) {
    restoreModalScroll(detailModalRef, savedDetailModalScrollTop.value);
  }
}

async function confirmActorAction(actor: { employeeId: string; pin: string }) {
  if (actorPromptLoading.value) return;
  if (actorAction.value === "save") {
    await submitProcurement(actor);
    return;
  }
  if (actorAction.value === "complete" && actorProcurementId.value) {
    await performCompleteProcurement(actorProcurementId.value, actor);
  }
}

async function submitProcurement(actor?: { employeeId: string; pin: string }) {
  if (!canSubmitProcurement.value || creatingProcurement.value) return;
  creatingProcurement.value = true;
  actorPromptError.value = "";
  actorPromptErrorCode.value = "";
  try {
    const payload = {
      supplier_name: supplierName.value.trim() || undefined,
      notes: draftNotes.value.trim() || undefined,
      ...(actor
        ? {
            actor_employee_id: actor.employeeId,
            actor_pin: actor.pin,
          }
        : {}),
      items: draftItems.value.map((item) => ({
        product_id: (item.product as any).productId || item.product.id, // Используем productId для вариантов
        variant_id: item.product.isVariant ? item.product.id : undefined, // ID варианта для товаров с вариантами
        quantity: item.quantity,
        warehouse_quantity: item.warehouseQuantity,
        cost_per_unit: item.costPerUnit,
      })),
    };

    if (editingProcurementId.value) {
      const updated = await crmStore.updateProcurement(
        editingProcurementId.value,
        payload,
      );
      closeCreateModal(true);
      await crmStore.fetchProcurements();
      await openDetails(updated.id);
    } else {
      const procurement = await crmStore.createProcurement({
        ...payload,
        idempotency_key: procurementCreateKey.value,
      });
      closeCreateModal(true);
      await crmStore.fetchProcurements();
      await openDetails(procurement.id);
    }
    actorPromptOpen.value = false;
    actorAction.value = null;
  } catch (error) {
    actorPromptErrorCode.value = String(
      (error as any)?.code || (error as any)?.data?.error || "",
    );
    console.error("[CRM] create procurement error", error);
    const typedError = error as Error & { code?: string; status?: number; outcomeUnknown?: boolean };
    actorPromptError.value = typedError.outcomeUnknown
      ? "Ответ сервера не получен. Проверьте список закупок перед повтором, чтобы не создать дубль."
      : typedError.status === 409
        ? "Закупка уже изменилась. Закройте окно и обновите данные."
        : typedError.message || "Не удалось сохранить закупку. Форма не потеряна.";
  } finally {
    creatingProcurement.value = false;
  }
}

async function refreshProcurements() {
  await Promise.all([
    crmStore.fetchProcurements(),
    crmStore.fetchTotalControlGroups(),
    crmStore.fetchLowStockGroups(),
  ]);
}

function newRequestKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function procurementDraftSignature() {
  return JSON.stringify({
    supplier: supplierName.value.trim(),
    notes: draftNotes.value.trim(),
    items: draftItems.value.map((item) => ({
      productId: item.product.productId || item.product.id,
      variantId: item.product.isVariant ? item.product.id : null,
      quantity: item.quantity,
      warehouseQuantity: item.warehouseQuantity,
      costPerUnit: item.costPerUnit,
    })),
  });
}

async function deleteProcurementRecord(id: string) {
  if (
    !confirm(
      "Удалить закупку? Откат остатков и оплат будет выполнен автоматически.",
    )
  )
    return;
  try {
    await crmStore.deleteProcurement(id);
    await crmStore.fetchProcurements();
    if (activeProcurement.value?.id === id) {
      closeDetails();
    }
  } catch (error) {
    console.error("[CRM] delete procurement error", error);
    alert(
      "Не удалось удалить закупку. Проверьте остатки и попробуйте ещё раз.",
    );
  }
}

async function openDetails(id: string) {
  detailModalOpen.value = true;
  detailLoading.value = true;
  try {
    activeProcurement.value = await crmStore.fetchProcurement(id);
  } catch (error) {
    console.error("[CRM] load procurement details error", error);
    alert("Не удалось загрузить детали закупки");
    detailModalOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function closeDetails() {
  detailModalOpen.value = false;
  activeProcurement.value = null;
}

async function removePaymentFromDetails() {
  if (
    !activeProcurement.value ||
    !activeProcurement.value.expense_transaction_id
  )
    return;
  if (
    !confirm(
      "Удалить оплату для этой закупки? Баланс кассы будет восстановлен.",
    )
  )
    return;
  try {
    const updated = await crmStore.removeProcurementPayment(
      activeProcurement.value.id,
    );
    activeProcurement.value = updated;
    await crmStore.fetchProcurements();
  } catch (error) {
    console.error("[CRM] remove procurement payment error", error);
    alert("Не удалось удалить оплату");
  }
}

async function editFromDetails() {
  if (!activeProcurement.value || activeProcurement.value.status !== "draft")
    return;
  const procurement = activeProcurement.value;
  closeDetails();
  await startEditProcurement(procurement.id, procurement);
}

async function deleteCurrentProcurement() {
  if (!activeProcurement.value) return;
  await deleteProcurementRecord(activeProcurement.value.id);
}

async function completeFromDetails() {
  if (!activeProcurement.value || completingProcurement.value) return;
  requestCompleteProcurement(activeProcurement.value.id);
}

async function performCompleteProcurement(
  id: string,
  actor?: { employeeId: string; pin: string },
) {
  if (completingProcurement.value) return;
  const idempotencyKey =
    procurementCompletionKeys.get(id) || newRequestKey();
  procurementCompletionKeys.set(id, idempotencyKey);
  completingProcurement.value = true;
  actorPromptError.value = "";
  actorPromptErrorCode.value = "";
  try {
    await crmStore.completeProcurement(id, {
      ...(actor
        ? {
            actor_employee_id: actor.employeeId,
            actor_pin: actor.pin,
          }
        : {}),
      idempotency_key: idempotencyKey,
    });
    procurementCompletionKeys.delete(id);
    await crmStore.fetchProcurements();
    if (activeProcurement.value?.id === id) {
      activeProcurement.value = await crmStore.fetchProcurement(id);
    }
    // Обновляем список товаров с низким остатком после завершения закупки
    await refreshLowStock();
    actorPromptOpen.value = false;
    actorAction.value = null;
    actorProcurementId.value = null;
    if (detailModalOpen.value) {
      restoreModalScroll(detailModalRef, savedDetailModalScrollTop.value);
    }
  } catch (error: any) {
    actorPromptErrorCode.value = String(error?.code || error?.data?.error || "");
    console.error("[CRM] complete procurement error", error);
    actorPromptError.value = error?.outcomeUnknown
      ? "Ответ сервера не получен. Обновите закупку перед повтором: она могла быть оприходована."
      : error?.status === 409
        ? "Закупка уже изменена другим пользователем. Обновите данные."
        : error?.message || "Не удалось оприходовать закупку";
  } finally {
    completingProcurement.value = false;
  }
}

async function finishProcurement(id: string) {
  requestCompleteProcurement(id);
}

function formatCurrency(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "BYN",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateString?: string | null) {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: Procurement["status"]) {
  if (status === "completed") {
    return "bg-green-100 text-green-800";
  }
  return "bg-yellow-100 text-yellow-800";
}

function statusLabel(status: Procurement["status"]) {
  return status === "completed" ? "Завершена" : "Черновик";
}
</script>
