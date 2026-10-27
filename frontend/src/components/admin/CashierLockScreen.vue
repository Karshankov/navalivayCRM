<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[100] flex flex-col md:flex-row bg-[#eef4ff] text-[#172b53] font-inter select-none overflow-auto scale-[1.08] origin-top-left w-[92.6%] h-[92.6%]" data-no-smoke>
      <main class="flex-1 p-5 sm:p-7 lg:p-9 overflow-y-auto min-w-0 max-w-7xl mx-auto w-full">

        <!-- Header -->
        <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div class="text-[11px] font-extrabold tracking-[1.5px] text-[#8393af] uppercase mb-1">CRM / КАССА</div>
            <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#102650] m-0">Продажа через кассу</h1>
          </div>
          <div class="flex items-center gap-3 self-start sm:self-auto">
            <button
              type="button"
              @click="resetSale"
              :disabled="cart.length === 0"
              class="border border-[#e6edfb] bg-[#f0f5ff] text-[#3a527a] px-4.5 py-2.5 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 transition hover:brightness-105 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>↻ Сбросить</span>
            </button>
          </div>
        </header>

        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">

          <div class="flex flex-col gap-5 min-w-0">

            <!-- Шаг 1: поле сверху. Оно же — скрытый вход в CRM. Никаких
                 подписей про пароль здесь нет. -->
            <div class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] overflow-hidden">
              <div class="p-5 sm:p-6">
                <label class="block text-[11px] font-extrabold text-[#435777] mb-2">ПОИСК ПО ШТРИХКОДУ</label>
                <!-- Поле лежит в форме без других полей: на мобильной клавиатуре
                     клавиша «Готово» отправляет форму, keydown Enter там не
                     приходит. Второе поле в этой форме сломает вход. -->
                <form class="relative" @submit.prevent="handleSecretSubmit">
                  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[#92a1b8] text-base pointer-events-none">⌗</span>
                  <input
                    ref="secretInput"
                    v-model="secretInputValue"
                    type="text"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    enterkeyhint="search"
                    class="w-full h-[46px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl pl-11 pr-4 text-xs font-semibold text-[#1b3157] outline-none transition focus:border-[#5b9aff] focus:ring-4 focus:ring-[#197aff]/10 focus:bg-white placeholder:text-slate-400 placeholder:font-normal shadow-sm"
                    placeholder="Отсканируйте или введите штрихкод товара…"
                  />
                </form>
              </div>
            </div>

            <!-- Шаг 2: все товары -->
            <div class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] overflow-hidden">
              <div class="p-5 sm:p-6 pb-4 flex items-center justify-between gap-3 border-b border-[#e8eef8]/60">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-xl bg-[#edf5ff] text-[#1677ff] font-black flex items-center justify-center text-xs shrink-0">1</div>
                  <div>
                    <div class="text-sm font-extrabold tracking-tight text-[#102650]">Все товары</div>
                    <div class="text-[11px] text-[#91a0b8] mt-0.5">Нажмите товар, чтобы добавить его в чек</div>
                  </div>
                </div>
                <button
                  type="button"
                  @click="openProductModal()"
                  class="w-9 h-9 rounded-xl bg-[#1677ff] text-white text-lg font-black leading-none inline-flex items-center justify-center shadow-[0_6px_16px_rgba(22,119,255,.3)] transition hover:brightness-110 shrink-0"
                  aria-label="Добавить товар"
                  title="Добавить товар"
                >+</button>
              </div>

              <div class="p-5 sm:p-6 pt-4 space-y-4">
                <div class="relative">
                  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[#92a1b8] text-base pointer-events-none">⌕</span>
                  <input
                    v-model="catalogSearch"
                    type="text"
                    class="w-full h-[42px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl pl-10 pr-4 text-xs font-semibold text-[#1b3157] outline-none transition focus:border-[#5b9aff] focus:bg-white placeholder:text-slate-400 placeholder:font-normal shadow-sm"
                    placeholder="Найти товар по названию"
                  />
                </div>

                <div v-if="catalogLoading && visibleItems.length === 0" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div v-for="n in 4" :key="`skeleton-${n}`" class="rounded-2xl border border-[#edf1f8] bg-[#f8faff] h-[186px] animate-pulse"></div>
                </div>

                <div v-else-if="visibleItems.length === 0" class="border border-dashed border-[#dce6f5] bg-[#fafcff] rounded-xl p-6 text-center text-[#8797b1] text-xs leading-relaxed">
                  <div class="text-xl mb-1">▤</div>
                  <b class="text-[#102650]">{{ catalogSearch ? 'Ничего не нашлось' : 'Товаров пока нет' }}</b><br />
                  <template v-if="catalogSearch">
                    Попробуйте другое название или добавьте товар кнопкой «+».
                  </template>
                  <template v-else>
                    Отметьте «Показывать на кассе» в категории или линейке либо добавьте товар кнопкой «+».
                  </template>
                </div>

                <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div
                    v-for="item in displayItems"
                    :key="`${item.source}-${item.id}`"
                    class="relative"
                  >
                  <!-- Кнопка правки лежит ВНЕ кнопки добавления: вложенные
                       кнопки невалидны и на телефоне перехватывают нажатие. -->
                  <button
                    v-if="item.source === 'custom'"
                    type="button"
                    @click.stop="openProductModal(customProductFromItem(item))"
                    class="absolute right-1.5 top-1.5 z-10 w-6 h-6 rounded-lg bg-white/95 border border-[#dbe7f8]  shadow-sm inline-flex items-center justify-center text-[11px] font-black text-[#3a527a] hover:bg-white"
                    :aria-label="`Изменить товар ${item.title}`"
                    title="Изменить товар"
                  >✎</button>
                  <button
                    type="button"
                    @click="addToCart(item)"
                    :disabled="item.stock <= 0"
                    class="w-full text-left rounded-2xl border border-[#e8eef8] bg-white overflow-hidden shadow-sm transition hover:border-[#b8d4ff] hover:shadow-[0_10px_24px_rgba(35,72,135,.12)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div class="relative aspect-square bg-[#f3f7ff] flex items-center justify-center overflow-hidden">
                      <img
                        v-if="item.image_url"
                        :src="item.image_url"
                        :alt="item.title"
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <span v-else class="text-[#c3d2e8] text-2xl">▨</span>
                      <span
                        v-if="item.source === 'custom'"
                        class="absolute left-1.5 top-1.5 rounded-md bg-[#e7f0ff] text-[#176bfa] text-[9px] font-extrabold px-1.5 py-0.5"
                      >СВОЙ</span>
                      <span
                        v-if="item.stock <= 0"
                        class="absolute inset-0 bg-white/70 flex items-center justify-center text-[10px] font-extrabold text-[#8797b1]"
                      >НЕТ В НАЛИЧИИ</span>
                    </div>
                    <div class="p-2.5">
                      <div class="text-[11px] font-extrabold text-[#102650] leading-snug line-clamp-2 min-h-[2.2em]">{{ item.title }}</div>
                      <div class="flex items-baseline justify-between gap-1 mt-1.5">
                        <span class="text-xs font-black text-[#102650]">{{ formatPrice(item.price) }} BYN</span>
                        <span class="text-[10px] font-semibold text-[#8d9bb2]">×{{ item.stock }}</span>
                      </div>
                      <div class="flex items-center justify-between mt-0.5">
                        <span class="text-[9.5px] font-semibold text-[#9aa8bd]">{{ markupLabel(item) }}</span>
                        <span class="text-[9.5px] font-semibold text-[#9aa8bd]">{{ item.source === 'custom' ? '' : (item.variant_name ? 'вкус' : '') }}</span>
                      </div>
                    </div>
                  </button>
                  </div>
                </div>

                <div v-if="hasMoreItems" class="text-center">
                  <button
                    type="button"
                    @click="toggleShowAll"
                    class="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#176bfa] hover:underline px-3 py-2"
                  >
                    {{ showAll ? 'Свернуть' : 'Показать все' }}
                    <span class="text-[10px] text-[#8d9bb2]">({{ visibleItems.length }})</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Шаг 3: состав продажи -->
            <div class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] overflow-hidden">
              <div class="p-5 sm:p-6 pb-4 flex items-center justify-between gap-3 border-b border-[#e8eef8]/60">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-xl bg-[#edf5ff] text-[#1677ff] font-black flex items-center justify-center text-xs shrink-0">2</div>
                  <div>
                    <div class="text-sm font-extrabold tracking-tight text-[#102650]">Состав продажи</div>
                    <div class="text-[11px] text-[#91a0b8] mt-0.5">Проверьте позиции и количество перед проведением</div>
                  </div>
                </div>
                <span class="bg-white border border-[#e7edf7] px-3.5 py-1.5 rounded-xl text-xs font-extrabold text-[#647594] shadow-sm whitespace-nowrap">
                  {{ cartItemCount }} {{ pluralize(cartItemCount, 'позиция', 'позиции', 'позиций') }}
                </span>
              </div>

              <div class="p-5 sm:p-6 pt-4 space-y-4">
                <div v-if="cart.length === 0" class="border border-dashed border-[#dce6f5] bg-[#fafcff] rounded-xl p-6 text-center text-[#8797b1] text-xs leading-relaxed">
                  <div class="text-xl mb-1">▤</div>
                  <b class="text-[#102650]">Пока нет товаров в чеке</b><br />Выберите товар в блоке выше.
                </div>

                <div v-else class="space-y-2.5">
                  <div
                    v-for="(line, index) in cart"
                    :key="line.key"
                    class="p-3 rounded-xl bg-[#f8faff] border border-[#edf1f8] shadow-sm"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-xs font-bold text-[#102650] truncate">{{ line.title }}</div>
                        <div class="text-[10px] text-[#8d9bb2] mt-0.5">
                          {{ formatPrice(line.price) }} BYN × {{ line.quantity }}
                          <template v-if="line.stock !== null">· остаток {{ line.stock }}</template>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <div class="inline-flex items-center rounded-lg border border-[#e2eaf7] bg-white overflow-hidden">
                          <button
                            type="button"
                            class="w-7 h-7 text-[#3a527a] font-black leading-none hover:bg-[#f0f5ff]"
                            @click="decrementLine(index)"
                            aria-label="Уменьшить количество"
                          >−</button>
                          <span class="w-8 text-center text-xs font-extrabold text-[#102650]">{{ line.quantity }}</span>
                          <button
                            type="button"
                            class="w-7 h-7 text-[#3a527a] font-black leading-none hover:bg-[#f0f5ff] disabled:opacity-30"
                            :disabled="line.stock !== null && line.quantity >= line.stock"
                            @click="incrementLine(index)"
                            aria-label="Увеличить количество"
                          >+</button>
                        </div>
                        <div class="w-[86px] text-right text-xs font-extrabold text-[#102650]">
                          {{ formatPrice(lineBase(line) - lineDiscountValue(line)) }} BYN
                        </div>
                        <button
                          type="button"
                          class="text-red-500 hover:text-red-700 text-xs font-bold px-1.5"
                          @click="removeLine(index)"
                          aria-label="Удалить позицию"
                        >✕</button>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 mt-2">
                      <span class="text-[10px] font-bold text-[#8d9bb2]">Скидка</span>
                      <input
                        v-model.number="line.discount"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-[74px] h-7 border border-[#dfe7f3] bg-white rounded-lg px-2 text-[11px] font-semibold text-[#1b3157] outline-none focus:border-[#5b9aff]"
                        placeholder="0"
                      />
                      <div class="inline-flex rounded-lg border border-[#e2eaf7] bg-white overflow-hidden text-[10px] font-extrabold">
                        <button
                          type="button"
                          class="px-2 h-7"
                          :class="line.discountMode === 'amount' ? 'bg-[#eaf3ff] text-[#176bfa]' : 'text-[#8d9bb2]'"
                          @click="line.discountMode = 'amount'"
                        >₽</button>
                        <button
                          type="button"
                          class="px-2 h-7"
                          :class="line.discountMode === 'percent' ? 'bg-[#eaf3ff] text-[#176bfa]' : 'text-[#8d9bb2]'"
                          @click="line.discountMode = 'percent'"
                        >%</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                  <div>
                    <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Скидка на чек (BYN)</label>
                    <input
                      v-model.number="checkDiscount"
                      type="number"
                      min="0"
                      step="0.01"
                      class="w-full h-[46px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none transition focus:border-[#5b9aff] focus:bg-white shadow-sm"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Оплата</label>
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        class="h-[46px] rounded-xl text-xs font-extrabold border transition"
                        :class="paymentMethod === 'cash' ? 'bg-[#eaf3ff] border-[#b8d4ff] text-[#176bfa]' : 'bg-white border-[#dfe7f3] text-[#7f90aa]'"
                        @click="paymentMethod = 'cash'"
                      >Наличными</button>
                      <button
                        type="button"
                        class="h-[46px] rounded-xl text-xs font-extrabold border transition"
                        :class="paymentMethod === 'card' ? 'bg-[#eaf3ff] border-[#b8d4ff] text-[#176bfa]' : 'bg-white border-[#dfe7f3] text-[#7f90aa]'"
                        @click="paymentMethod = 'card'"
                      >Картой</button>
                    </div>
                  </div>
                </div>

                <div v-if="paymentMethod === 'card'" class="p-3 bg-[#f4f8ff] border border-[#e2eaf7] rounded-xl text-[11px] text-[#647594] leading-relaxed">
                  Оплата картой учитывается в общем лимите магазина на день.
                </div>

                <!-- Итоги -->
                <div class="border-t border-[#e8eef8] pt-4 mt-4 space-y-1.5">
                  <div class="flex items-center justify-between text-[11px] font-semibold text-[#7f90aa]">
                    <span>Сумма</span>
                    <span>{{ formatPrice(cartSubtotal) }} BYN</span>
                  </div>
                  <div v-if="totalDiscount > 0" class="flex items-center justify-between text-[11px] font-semibold text-emerald-700">
                    <span>Скидка</span>
                    <span>−{{ formatPrice(totalDiscount) }} BYN</span>
                  </div>
                  <div class="flex items-center justify-between pt-1">
                    <div>
                      <div class="text-xs font-extrabold text-[#7f90aa]">Итого к оплате</div>
                      <div class="text-[10px] text-[#9aa8bd] mt-0.5">Проверьте сумму перед завершением</div>
                    </div>
                    <div class="text-2xl font-black tracking-tight text-[#102650]">
                      {{ formatPrice(totalToPay) }} BYN
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  @click="submitSale"
                  :disabled="!canSubmit || isSubmitting"
                  class="w-full h-[46px] bg-gradient-to-r from-[#08bce9] to-[#2163ff] text-white rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 shadow-[0_7px_18px_rgba(22,121,255,0.27)] transition hover:brightness-104 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{{ isSubmitting ? 'Проводим…' : '✓ Провести чек' }}</span>
                </button>

                <div v-if="successMessage" class="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 shadow-sm">
                  {{ successMessage }}
                </div>
                <div v-if="errorMessage" class="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800 shadow-sm">
                  {{ errorMessage }}
                </div>

              </div>
            </div>

            <!-- Отложенные чеки (старый поток) -->
            <div v-if="pendingSales.length > 0" class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] p-5">
              <div class="text-xs font-extrabold text-[#102650] mb-3">Отложенные чеки ({{ pendingSales.length }})</div>
              <div class="space-y-3">
                <div v-for="sale in pendingSales" :key="sale.id" class="flex items-center justify-between p-3.5 bg-[#f8faff] border border-[#edf1f8] rounded-xl shadow-sm">
                  <div>
                    <div class="text-xs font-bold text-[#102650]">{{ sale.product_name }}</div>
                    <div class="text-[10px] text-[#8d9bb2] mt-0.5">{{ formatPrice(sale.price) }} BYN</div>
                  </div>
                  <button type="button" @click="openCompletePendingModal(sale)" class="bg-[#eaf3ff] text-[#176bfa] px-3.5 py-1.5 rounded-lg text-[11px] font-extrabold shadow-sm">
                    Дозаполнить
                  </button>
                </div>
              </div>
            </div>

          </div>

          <!-- Клиент чека -->
          <aside class="bg-white/96 border border-[#e8eef8] rounded-[20px] shadow-[0_14px_36px_rgba(35,72,135,.09)] sticky top-5 overflow-hidden">
            <div class="p-5 bg-gradient-to-br from-[#f3f8ff] to-white border-b border-[#eaf0fa]">
              <div class="flex items-center justify-between mb-3.5">
                <div>
                  <div class="text-sm font-extrabold tracking-tight text-[#102650]">3. Клиент чека</div>
                  <div class="text-[11px] text-[#91a0b8] mt-0.5">Привяжите покупку к клиенту</div>
                </div>
                <span class="text-lg">♙</span>
              </div>

              <div class="rounded-xl border border-[#dfe7f3] bg-white p-3 shadow-sm">
                <PosCustomerPanel v-model="selectedCustomer" />
              </div>
            </div>

            <div class="p-4 bg-[#fff9e9] border-t border-[#ffefc5] text-[11px] text-[#9a7330] leading-relaxed">
              <b>Подсказка:</b> привязка клиента помогает сохранить историю покупок и быстрее находить его при следующей продаже.
            </div>
          </aside>

        </div>
      </main>

      <!-- Модалка «свой» товар -->
      <Transition name="fade">
        <div
          v-if="productModalOpen"
          class="fixed inset-0 z-[110] flex items-center justify-center bg-[#0e204a]/40 p-4 backdrop-blur-sm"
          v-safe-backdrop-close="closeProductModal"
        >
          <div class="bg-white rounded-[20px] p-6 w-full max-w-md shadow-[0_25px_80px_rgba(13,36,80,0.27)] max-h-[92vh] overflow-y-auto">
            <h2 class="text-base font-black text-[#102650] mb-1">{{ editingProduct ? 'Изменить товар' : 'Новый товар' }}</h2>
            <p class="text-xs text-[#8291a9] mb-4">Товар появится только на кассе, в каталог магазина он не попадёт.</p>

            <!-- Фото -->
            <div class="mb-4">
              <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Фото</label>
              <div class="flex items-center gap-3">
                <div class="w-20 h-20 rounded-xl border border-[#e2eaf7] bg-[#f3f7ff] overflow-hidden flex items-center justify-center shrink-0">
                  <img v-if="productForm.image_url" :src="productForm.image_url" alt="" class="w-full h-full object-cover" />
                  <span v-else class="text-[#c3d2e8] text-2xl">▨</span>
                </div>
                <div class="flex flex-col gap-2">
                  <button
                    type="button"
                    class="border border-[#e6edfb] bg-[#f0f5ff] text-[#3a527a] px-3.5 py-2 rounded-xl text-[11px] font-extrabold shadow-sm"
                    @click="triggerPhotoPick"
                  >{{ productForm.image_url ? 'Заменить фото' : 'Загрузить фото' }}</button>
                  <button
                    v-if="productForm.image_url"
                    type="button"
                    class="text-[11px] font-bold text-red-500 hover:underline text-left"
                    @click="productForm.image_url = null"
                  >Убрать фото</button>
                  <span v-if="photoUploading" class="text-[10px] text-[#8d9bb2]">Загружаем…</span>
                </div>
              </div>
              <input ref="photoInput" type="file" accept="image/*" class="hidden" @change="onPhotoPicked" />
            </div>

            <div class="space-y-3">
              <div>
                <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Название</label>
                <input
                  v-model="productForm.title"
                  type="text"
                  class="w-full h-[44px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none focus:border-[#5b9aff]"
                  placeholder="Например: Одноразка PPWJ 2000"
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Себестоимость (BYN)</label>
                  <input
                    v-model.number="productForm.cost_price"
                    type="number"
                    min="0"
                    step="0.01"
                    class="w-full h-[44px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none focus:border-[#5b9aff]"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Розничная цена (BYN)</label>
                  <input
                    v-model.number="productForm.retail_price"
                    type="number"
                    min="0"
                    step="0.01"
                    class="w-full h-[44px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none focus:border-[#5b9aff]"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Количество на складе</label>
                <input
                  v-model.number="productForm.quantity"
                  type="number"
                  min="0"
                  step="1"
                  class="w-full h-[44px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none focus:border-[#5b9aff]"
                  placeholder="0"
                />
                <p class="text-[10px] text-[#8d9bb2] mt-1">Укажите итоговое наличие — сколько товара есть сейчас.</p>
              </div>

              <div class="p-3 bg-[#f4f8ff] border border-[#e2eaf7] rounded-xl text-[11px] font-semibold text-[#647594]">
                Наценка:
                <span :class="productMarkup === null ? 'text-[#8d9bb2]' : 'text-[#102650] font-black'">
                  {{ productMarkup === null ? '—' : `${productMarkup}%` }}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 mt-5">
              <button
                v-if="editingProduct"
                type="button"
                class="text-[11px] font-bold text-red-500 hover:underline"
                @click="deleteProduct"
              >Удалить товар</button>
              <span v-else></span>
              <div class="flex gap-3">
                <button type="button" @click="closeProductModal" class="border border-[#e6edfb] bg-[#f0f5ff] text-[#3a527a] px-4.5 py-2.5 rounded-xl text-xs font-extrabold shadow-sm">Отмена</button>
                <button
                  type="button"
                  @click="saveProduct"
                  :disabled="!canSaveProduct || productSaving"
                  class="bg-gradient-to-r from-[#08bce9] to-[#2163ff] text-white px-4.5 py-2.5 rounded-xl text-xs font-extrabold shadow-md disabled:opacity-50"
                >{{ productSaving ? 'Сохраняем…' : 'Сохранить' }}</button>
              </div>
            </div>

            <div v-if="productError" class="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800">
              {{ productError }}
            </div>
          </div>
        </div>
      </Transition>

      <!-- Дозаполнение отложенного чека -->
      <Transition name="fade">
        <div
          v-if="showCompletePendingModal && selectedPendingSale"
          class="fixed inset-0 z-[110] flex items-center justify-center bg-[#0e204a]/40 p-4 backdrop-blur-sm"
          v-safe-backdrop-close="closeCompletePendingModal"
        >
          <div class="bg-white rounded-[20px] p-6 w-full max-w-md shadow-[0_25px_80px_rgba(13,36,80,0.27)]">
            <h2 class="text-base font-black text-[#102650] mb-1">Дозаполнить чек</h2>
            <p class="text-xs text-[#8291a9] mb-4">{{ selectedPendingSale.product_name }} — {{ formatPrice(selectedPendingSale.price) }} BYN</p>

            <div class="mb-4">
              <label class="block text-[11px] font-extrabold text-[#435777] mb-2">Комментарий / закупка</label>
              <input
                ref="pendingCostInput"
                v-model="pendingCostPrice"
                type="number"
                step="0.01"
                min="0"
                class="w-full h-[46px] border border-[#dfe7f3] bg-[#fbfcff] rounded-xl px-4 text-xs font-semibold text-[#1b3157] outline-none shadow-sm"
                placeholder="Сумма"
                @keydown.enter="completePendingSale"
              />
            </div>

            <div class="flex justify-end gap-3 mt-4">
              <button type="button" @click="closeCompletePendingModal" class="border border-[#e6edfb] bg-[#f0f5ff] text-[#3a527a] px-4.5 py-2.5 rounded-xl text-xs font-extrabold shadow-sm">Отмена</button>
              <button type="button" @click="completePendingSale" class="bg-gradient-to-r from-[#08bce9] to-[#2163ff] text-white px-4.5 py-2.5 rounded-xl text-xs font-extrabold shadow-md">Провести</button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useAdminStore } from '@/stores/admin'
import {
  useCrmStore,
  type PosSale,
  type PosCatalogItem,
  type PosProduct,
  type PosCheckLineInput,
  type Customer,
} from '@/stores/crm'
import PosCustomerPanel from '@/components/admin/PosCustomerPanel.vue'
import { vSafeBackdropClose } from '@/directives/safeBackdropClose'

const emit = defineEmits<{
  (e: 'unlocked'): void
}>()

const adminStore = useAdminStore()
const crmStore = useCrmStore()

// Refs
const secretInput = ref<HTMLInputElement>()
const pendingCostInput = ref<HTMLInputElement>()
const photoInput = ref<HTMLInputElement>()

// Скрытый вход в CRM. Поле выглядит как поиск по штрихкоду; введённый текст
// проверяется как ключ администратора. Верный ключ разблокирует панель,
// неверный — просто очищается: на экране кассира это никак не отражено.
const secretInputValue = ref('')

// Состояние
const isSubmitting = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

const selectedCustomer = ref<Customer | null>(null)

// Каталог
const catalogItems = ref<PosCatalogItem[]>([])
const catalogLoading = ref(false)
const catalogSearch = ref('')
const showAll = ref(false)
const FIRST_SCREEN_TILES = 4

// Корзина
interface CartLine {
  key: string
  source: 'catalog' | 'custom'
  product_id: string | null
  variant_id: string | null
  pos_product_id: string | null
  title: string
  price: number
  cost_price: number
  quantity: number
  stock: number | null
  discount: number
  discountMode: 'amount' | 'percent'
}

const cart = ref<CartLine[]>([])
const checkDiscount = ref<number>(0)
const paymentMethod = ref<'cash' | 'card'>('cash')

// Модалка своего товара
const productModalOpen = ref(false)
const editingProduct = ref<PosProduct | null>(null)
const productForm = ref({
  title: '',
  cost_price: 0 as number | null,
  retail_price: 0 as number | null,
  quantity: 0 as number | null,
  image_url: null as string | null,
})
const productSaving = ref(false)
const productError = ref('')
const photoUploading = ref(false)

// Отложенные чеки (старый поток)
const pendingSales = ref<PosSale[]>([])
const showCompletePendingModal = ref(false)
const selectedPendingSale = ref<PosSale | null>(null)
const pendingCostPrice = ref('')

// -------------------------------------------------------------- утилиты

function formatPrice(price: number): string {
  return Number(price || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function roundMoney(value: number): number {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Number(`${Math.round(Number(`${amount}e2`))}e-2`)
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/** «Наценка 100%» — считается от себестоимости к цене продажи. */
function markupPercent(cost: number, price: number): number | null {
  const costValue = Number(cost)
  const priceValue = Number(price)
  if (!Number.isFinite(costValue) || costValue <= 0) return null
  if (!Number.isFinite(priceValue) || priceValue <= 0) return null
  return Math.round(((priceValue - costValue) / costValue) * 100)
}

function markupLabel(item: PosCatalogItem): string {
  const percent = markupPercent(item.cost_price, item.price)
  if (percent === null) return ''
  return `наценка ${percent}%`
}

// -------------------------------------------------------------- каталог

const visibleItems = computed(() => catalogItems.value)

const displayItems = computed(() => {
  if (showAll.value) return visibleItems.value
  return visibleItems.value.slice(0, FIRST_SCREEN_TILES)
})

const hasMoreItems = computed(() => visibleItems.value.length > FIRST_SCREEN_TILES)

function toggleShowAll() {
  showAll.value = !showAll.value
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(catalogSearch, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    loadCatalog()
  }, 300)
})

async function loadCatalog() {
  catalogLoading.value = true
  try {
    const result = await crmStore.fetchPosCatalog({
      search: catalogSearch.value.trim() || undefined,
      limit: 60,
    })
    catalogItems.value = result.items
  } catch (error: any) {
    // Каталог может не загрузиться из-за сети — не роняем экран кассы,
    // «свои» товары всё равно должны продаваться.
    catalogItems.value = []
  } finally {
    catalogLoading.value = false
  }
}

// -------------------------------------------------------------- корзина

function lineKey(item: PosCatalogItem): string {
  return `${item.source}:${item.id}`
}

function addToCart(item: PosCatalogItem) {
  const key = lineKey(item)
  const existing = cart.value.find((line) => line.key === key)
  if (existing) {
    if (existing.stock !== null && existing.quantity >= existing.stock) return
    existing.quantity += 1
    return
  }
  cart.value.push({
    key,
    source: item.source,
    product_id: item.product_id ?? (item.source === 'catalog' ? item.id : null),
    variant_id: item.variant_id ?? null,
    pos_product_id: item.source === 'custom' ? item.id : null,
    title: item.title,
    price: item.price,
    cost_price: item.cost_price,
    quantity: 1,
    stock: item.stock,
    discount: 0,
    discountMode: 'amount',
  })
}

function incrementLine(index: number) {
  const line = cart.value[index]
  if (!line) return
  if (line.stock !== null && line.quantity >= line.stock) return
  line.quantity += 1
}

function decrementLine(index: number) {
  const line = cart.value[index]
  if (!line) return
  if (line.quantity <= 1) {
    removeLine(index)
    return
  }
  line.quantity -= 1
}

function removeLine(index: number) {
  cart.value.splice(index, 1)
}

function lineBase(line: CartLine): number {
  return roundMoney(line.price * line.quantity)
}

function lineDiscountValue(line: CartLine): number {
  const gross = lineBase(line)
  const raw = Number(line.discount) || 0
  if (raw <= 0) return 0
  const value = line.discountMode === 'percent' ? (gross * Math.min(raw, 100)) / 100 : raw
  return roundMoney(Math.min(gross, Math.max(0, value)))
}

const cartSubtotal = computed(() =>
  roundMoney(cart.value.reduce((sum, line) => sum + lineBase(line), 0)),
)

const lineDiscountsTotal = computed(() =>
  roundMoney(cart.value.reduce((sum, line) => sum + lineDiscountValue(line), 0)),
)

const afterLineDiscounts = computed(() =>
  roundMoney(Math.max(0, cartSubtotal.value - lineDiscountsTotal.value)),
)

const checkDiscountValue = computed(() => {
  const raw = Number(checkDiscount.value) || 0
  return roundMoney(Math.min(afterLineDiscounts.value, Math.max(0, raw)))
})

const totalDiscount = computed(() => roundMoney(lineDiscountsTotal.value + checkDiscountValue.value))

const totalToPay = computed(() =>
  roundMoney(Math.max(0, cartSubtotal.value - totalDiscount.value)),
)

const cartItemCount = computed(() => cart.value.length)

const canSubmit = computed(() => cart.value.length > 0 && totalToPay.value >= 0)

function resetSale() {
  cart.value = []
  checkDiscount.value = 0
  paymentMethod.value = 'cash'
  errorMessage.value = ''
  successMessage.value = ''
}

function buildLineInputs(): PosCheckLineInput[] {
  return cart.value.map((line) => {
    const discountValue = lineDiscountValue(line)
    return {
      source: line.source,
      product_id: line.product_id,
      variant_id: line.variant_id,
      pos_product_id: line.pos_product_id,
      quantity: line.quantity,
      // Скидку позиции отдаём суммой: серверу так проще считать прибыль,
      // и не нужно повторно пересчитывать процент.
      discount_amount: discountValue > 0 ? discountValue : 0,
    }
  })
}

let idempotencyKey = ''

async function submitSale() {
  if (!canSubmit.value || isSubmitting.value) return

  // Ключ идемпотентности генерируем один раз на чек и держим до успеха:
  // повторная отправка после ошибки сети не должна создать второй чек.
  if (!idempotencyKey) {
    idempotencyKey = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  isSubmitting.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    await crmStore.submitPosCheck(
      {
        items: buildLineInputs(),
        payment_method: paymentMethod.value,
        discount_amount: checkDiscountValue.value,
        customer_id: selectedCustomer.value?.id ?? null,
      },
      idempotencyKey,
    )

    // Порядок важен: resetSale очищает сообщения, поэтому сначала сбрасываем
    // чек, потом показываем подтверждение — иначе его никто не увидит.
    resetSale()
    successMessage.value = 'Чек проведён!'
    idempotencyKey = ''
    selectedCustomer.value = null
    await loadCatalog()

    setTimeout(() => {
      successMessage.value = ''
    }, 3000)
  } catch (error: any) {
    errorMessage.value = describeCheckError(error)
    // Ключ обнуляем только при явной ошибке валидации: после сетевого сбоя
    // повтор должен попасть в тот же чек, а не создать новый.
    if (error?.status && error.status >= 400 && error.status < 500) {
      idempotencyKey = ''
      await loadCatalog()
    }
  } finally {
    isSubmitting.value = false
  }
}

function describeCheckError(error: any): string {
  const code = error?.code
  if (code === 'insufficient_stock') {
    const item = error?.item
    if (item?.title) {
      return `Недостаточно товара: ${item.title}. Осталось ${item.available ?? 0} шт.`
    }
    return 'Одного из товаров не хватает на складе. Проверьте количество.'
  }
  if (code === 'catalog_item_not_published') {
    return 'Товар больше не продаётся на кассе. Обновите список.'
  }
  if (code === 'catalog_item_unavailable') {
    return 'Товар удалён из каталога. Уберите его из чека.'
  }
  if (code === 'pos_product_not_found') {
    return 'Свой товар удалён. Уберите его из чека.'
  }
  if (code === 'card_limit_exceeded') {
    return 'Лимит оплаты картой на сегодня исчерпан. Проведите оплату наличными.'
  }
  if (code === 'cash_account_not_found') {
    return 'Не найден кассовый счёт магазина. Обратитесь к менеджеру.'
  }
  if (code === 'invalid_quantity' || code === 'invalid_discount') {
    return 'Проверьте количество и скидку в чеке.'
  }
  return error?.message || 'Не удалось провести чек. Попробуйте ещё раз.'
}

// -------------------------------------------------------------- свой товар

const productMarkup = computed(() =>
  markupPercent(Number(productForm.value.cost_price) || 0, Number(productForm.value.retail_price) || 0),
)

const canSaveProduct = computed(() =>
  Boolean(productForm.value.title.trim()) && Number(productForm.value.retail_price) > 0,
)

/**
 * Своего товара в карточке каталога достаточно, чтобы открыть форму правки:
 * сервер вернёт полные данные при сохранении, а показать нужно ровно эти
 * четыре поля.
 */
function customProductFromItem(item: PosCatalogItem): PosProduct {
  return {
    id: item.pos_product_id || item.id,
    title: item.title,
    cost_price: item.cost_price,
    retail_price: item.retail_price,
    quantity: item.stock,
    image_url: item.image_url,
    created_at: '',
    updated_at: '',
  }
}

function openProductModal(editing: PosProduct | null = null) {
  editingProduct.value = editing
  productError.value = ''
  productForm.value = editing
    ? {
        title: editing.title,
        cost_price: editing.cost_price,
        retail_price: editing.retail_price,
        quantity: editing.quantity,
        image_url: editing.image_url,
      }
    : { title: '', cost_price: 0, retail_price: 0, quantity: 0, image_url: null }
  productModalOpen.value = true
}

function closeProductModal() {
  productModalOpen.value = false
  editingProduct.value = null
  productError.value = ''
}

function triggerPhotoPick() {
  photoInput.value?.click()
}

async function onPhotoPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  photoUploading.value = true
  productError.value = ''
  try {
    productForm.value.image_url = await crmStore.uploadPosProductImage(file)
  } catch (error: any) {
    productError.value = error?.code === 'file_too_large'
      ? 'Фото больше 5 МБ. Выберите файл меньше.'
      : 'Не удалось загрузить фото.'
  } finally {
    photoUploading.value = false
  }
}

async function saveProduct() {
  if (!canSaveProduct.value || productSaving.value) return
  productSaving.value = true
  productError.value = ''
  try {
    const payload = {
      title: productForm.value.title.trim(),
      cost_price: Number(productForm.value.cost_price) || 0,
      retail_price: Number(productForm.value.retail_price) || 0,
      quantity: Number(productForm.value.quantity) || 0,
      image_url: productForm.value.image_url,
    }
    if (editingProduct.value) {
      await crmStore.updatePosProduct(editingProduct.value.id, payload)
    } else {
      await crmStore.createPosProduct(payload)
    }
    closeProductModal()
    await loadCatalog()
  } catch (error: any) {
    productError.value = error?.code === 'invalid_quantity'
      ? 'Количество должно быть целым числом.'
      : error?.code === 'invalid_retail_price'
        ? 'Укажите розничную цену больше нуля.'
        : error?.message || 'Не удалось сохранить товар.'
  } finally {
    productSaving.value = false
  }
}

async function deleteProduct() {
  const target = editingProduct.value
  if (!target || productSaving.value) return
  productSaving.value = true
  productError.value = ''
  try {
    await crmStore.deletePosProduct(target.id)
    closeProductModal()
    await loadCatalog()
  } catch (error: any) {
    productError.value = error?.code === 'pos_product_in_use'
      ? 'Этот товар уже был продан, поэтому его нельзя удалить.'
      : error?.message || 'Не удалось удалить товар.'
  } finally {
    productSaving.value = false
  }
}

// -------------------------------------------------------------- скрытый вход

async function handleSecretSubmit() {
  const query = secretInputValue.value.trim()
  if (!query) return

  // Две проверки одной строкой: сначала пробуем полноценный вход в CRM
  // (менеджер за кассой), затем — кассовую сессию (кассир). Наружу любая
  // неудача выглядит одинаково: «поиск ничего не нашёл», поле чистится.
  let unlocked = false
  if (query.length >= 3) {
    try {
      await adminStore.login({ username: 'admin', password: query })
      if (adminStore.isAuthenticated) {
        emit('unlocked')
        unlocked = true
      }
    } catch {
      // Неверный ключ — обычное дело, на экране кассира ничего не меняем.
    }
  }

  if (unlocked) {
    // Менеджер вошёл в CRM: экран кассы закрывается, сессия кассы не нужна.
    return
  }

  try {
    const session = await crmStore.startPosSession(query)
    if (session) {
      // Ключ подошёл для кассы: грузим товары и отложенные чеки молча.
      secretInputValue.value = ''
      await Promise.all([loadCatalog(), loadPendingSales()])
      nextTick(() => {
        secretInput.value?.focus()
      })
      return
    }
  } catch {
    // Сеть отвалилась или сервер недоступен — ведём себя как «не нашлось».
  }

  // Строка не была ключом: чистим поле, чтобы кассир мог сканировать дальше.
  secretInputValue.value = ''
  nextTick(() => {
    secretInput.value?.focus()
  })
}

// -------------------------------------------------------------- отложенные чеки

function openCompletePendingModal(sale: PosSale | null) {
  if (sale) {
    selectedPendingSale.value = sale
  } else if (pendingSales.value.length > 0) {
    selectedPendingSale.value = pendingSales.value[0]
  } else {
    return
  }
  pendingCostPrice.value = ''
  showCompletePendingModal.value = true
  nextTick(() => {
    pendingCostInput.value?.focus()
  })
}

function closeCompletePendingModal() {
  showCompletePendingModal.value = false
  selectedPendingSale.value = null
  pendingCostPrice.value = ''
}

async function completePendingSale() {
  if (!selectedPendingSale.value || !pendingCostPrice.value || isSubmitting.value) return
  isSubmitting.value = true
  try {
    await crmStore.updatePosSale(selectedPendingSale.value.id, {
      cost_price: Number(pendingCostPrice.value),
    })
    pendingSales.value = pendingSales.value.filter((s) => s.id !== selectedPendingSale.value?.id)
    closeCompletePendingModal()
    successMessage.value = 'Чек проведён!'
    setTimeout(() => {
      successMessage.value = ''
    }, 3000)
  } catch (error: any) {
    errorMessage.value = error?.message || 'Ошибка при обновлении чека'
  } finally {
    isSubmitting.value = false
  }
}

async function loadPendingSales() {
  try {
    pendingSales.value = <any>await crmStore.fetchPendingPosSales()
  } catch {
    // Отложенные чеки — вспомогательный блок, его падение не должно мешать
    // продаже.
  }
}

onMounted(async () => {
  // Менеджер уже в CRM (экран после кнопки «Заблокировать»): его токен
  // проходит в кассу как есть, отдельная сессия не нужна. Без входа каталог
  // загрузится после первого скана ключа — до этого экран просто пустой,
  // как и положено рабочему месту до начала смены.
  if (adminStore.isAuthenticated) {
    await Promise.all([loadCatalog(), loadPendingSales()])
  }
  nextTick(() => {
    secretInput.value?.focus()
  })
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>