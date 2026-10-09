<template>
  <form @submit.prevent="onSubmit" class="space-y-4 sm:space-y-5 w-full max-w-full">
    <!-- Category - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="w-full">
      <label class="block text-sm font-medium text-gray-700 mb-2">Категория</label>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2">
        <select 
          v-model="form.categoryId" 
          required 
          class="
            w-full max-w-full box-border
            px-3 sm:px-4 py-2 sm:py-3 
            text-sm sm:text-base
            border border-gray-300 rounded-xl 
            focus:ring-2 focus:ring-brand-dark focus:border-transparent
            min-w-0
          "
        >
          <option disabled value="">Выберите категорию</option>
          <option v-for="c in localCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button
          type="button"
          class="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-dashed border-brand-dark/40 px-3 py-2 text-xs sm:text-sm font-medium text-brand-dark transition hover:border-brand-dark hover:bg-brand-dark/10"
          @click="openCreateCategoryModal"
        >
          + Новая категория
        </button>
      </div>
    </div>

    <!-- Group selection -->
    <div class="w-full" v-if="form.categoryId">
      <label class="block text-sm font-medium text-gray-700 mb-2">Линейка</label>
      <div class="flex flex-col gap-2">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2">
          <select
            v-model="form.groupId"
            :disabled="isGroupLoading"
            class="
              w-full max-w-full box-border
              px-3 sm:px-4 py-2 sm:py-3
              text-sm sm:text-base
              border border-gray-300 rounded-xl
              focus:ring-2 focus:ring-brand-dark focus:border-transparent
              min-w-0
            "
          >
            <option value="">Без линейки</option>
            <option
              v-for="group in availableGroups"
              :key="group.id"
              :value="group.id"
            >
              {{ `${'— '.repeat(group.depth ?? 0)}${group.name}`.trim() }}
            </option>
          </select>
          <button
            type="button"
            class="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-dashed border-brand-dark/40 px-3 py-2 text-xs sm:text-sm font-medium text-brand-dark transition hover:border-brand-dark hover:bg-brand-dark/10"
            @click="openCreateGroupModal"
          >
            + Новая линейка
          </button>
        </div>
        <p v-if="isGroupLoading" class="text-xs text-gray-500 animate-pulse">Загружаем линейки…</p>
        <p v-else-if="!availableGroups.length" class="text-xs text-gray-500">
          Для этой категории пока не создано линейок.
        </p>
      </div>
    </div>

    <!-- Title - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="w-full">
      <label class="block text-sm font-medium text-gray-700 mb-2">Название</label>
      <input 
        v-model.trim="form.title" 
        type="text" 
        class="
          w-full max-w-full box-border
          px-3 sm:px-4 py-2 sm:py-3 
          text-sm sm:text-base
          border border-gray-300 rounded-xl 
          focus:ring-2 focus:ring-brand-dark focus:border-transparent
          min-w-0
        " 
        placeholder="Классическая толстовка" 
      />
    </div>

    <!-- Has Variants Checkbox -->
    <div class="w-full">
      <label class="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          v-model="form.hasVariants"
          class="mt-1 w-4 h-4 text-brand-dark border-gray-300 rounded focus:ring-2 focus:ring-brand-dark cursor-pointer"
        />
        <div class="flex-1">
          <span class="text-sm font-medium text-gray-700 group-hover:text-gray-900">
            Товар с вариантами (функционал для POD устройств)
          </span>
          <p class="text-xs text-gray-500 mt-1">
            Включите для устройств с несколькими цветовыми вариантами. Каждый вариант будет иметь свои изображения и цену.
          </p>
        </div>
      </label>
    </div>

    <!-- Price - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="w-full" v-if="!form.hasVariants">
      <label class="block text-sm font-medium text-gray-700 mb-2">Цена, BYN (целое число)</label>
      <input
        v-model.number="form.priceRub"
        type="number"
        min="1"
        step="1"
        required
        class="
          w-full max-w-full box-border
          px-3 sm:px-4 py-2 sm:py-3 
          text-sm sm:text-base
          border border-gray-300 rounded-xl 
          focus:ring-2 focus:ring-brand-dark focus:border-transparent
          min-w-0
        "
        placeholder="2500"
      />
      <p class="mt-1 text-xs text-gray-500 break-words">Без копеек, только целые рубли. Пример: 3990</p>
    </div>

    <div
      class="w-full rounded-xl border p-4 transition"
      :class="form.discountEnabled ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-white'"
    >
      <label class="flex cursor-pointer items-start gap-3">
        <input
          v-model="form.discountEnabled"
          type="checkbox"
          class="mt-0.5 h-5 w-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500/30"
        />
        <span>
          <span class="block text-sm font-semibold text-gray-800">Скидка на товар</span>
          <span class="mt-1 block text-xs leading-5 text-gray-600">
            Действует на все вкусы этого товара. Бонусы за покупку со скидкой не
            начисляются и не списываются.
          </span>
        </span>
      </label>

      <div v-if="form.discountEnabled" class="mt-3 flex flex-wrap gap-3 pl-8">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700">Цена со скидкой, BYN</label>
          <input
            v-model="form.discountPrice"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500/30"
            placeholder="Например 12"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700">Действует по</label>
          <input
            v-model="form.discountUntil"
            type="date"
            class="w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500/30"
          />
        </div>
      </div>
    </div>

    <!-- Inventory fields -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
      <div v-if="!form.hasVariants">
        <label class="block text-sm font-medium text-gray-700 mb-2">Крепость</label>
        <input
          v-model.trim="form.strength"
          type="text"
          class="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-dark focus:border-transparent"
          placeholder="Например, 3 мг"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">Себестоимость, BYN</label>
        <input
          v-model.number="form.costPrice"
          type="number"
          min="0"
          step="0.01"
          class="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-dark focus:border-transparent"
          placeholder="0"
        />
      </div>
      <div v-if="!form.hasVariants">
        <label class="block text-sm font-medium text-gray-700 mb-2">Остаток на складе, шт</label>
        <input
          v-model.number="form.stock"
          type="number"
          min="0"
          step="1"
          class="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-dark focus:border-transparent"
          placeholder="0"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">Минимальный остаток, шт</label>
        <input
          v-model.number="form.minStock"
          type="number"
          min="0"
          step="1"
          class="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-dark focus:border-transparent"
          placeholder="0"
        />
        <p class="mt-1 text-xs text-gray-500">
          <span v-if="form.hasVariants">Порог для любого варианта этого товара. Если хотя бы один вариант ниже - товар попадёт в закупки.</span>
          <span v-else>Используется для подсветки товаров с низким остатком и автоматических закупок.</span>
        </p>
      </div>
    </div>

    <!-- Description - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="w-full">
      <label class="block text-sm font-medium text-gray-700 mb-2">Описание</label>
      <textarea 
        v-model.trim="form.description" 
        rows="4" 
        class="
          w-full max-w-full box-border
          px-3 sm:px-4 py-2 sm:py-3 
          text-sm sm:text-base
          border border-gray-300 rounded-xl 
          focus:ring-2 focus:ring-brand-dark focus:border-transparent
          resize-none min-w-0
        " 
        placeholder="Материал, особенности и т.п."
      ></textarea>
    </div>

    <!-- Links -->
    <div class="space-y-3 w-full" v-if="!form.useCategoryImage && !form.hasVariants">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <label class="block text-sm font-medium text-gray-700">Ссылки на товар</label>
        <button
          type="button"
          class="
            w-full sm:w-auto px-3 py-2
            bg-brand-dark text-white rounded-lg
            text-xs sm:text-sm font-medium
            hover:bg-brand-dark/90
            focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-opacity-50
            transition-all duration-200
            min-w-0 max-w-full truncate box-border
          "
          @click.prevent="addLink"
        >
          Добавить ссылку
        </button>
      </div>

      <div v-if="form.links && form.links.length === 0" class="text-xs text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-lg px-3 py-3">
        Добавьте ссылки на карточки товара в соцсетях, магазинах или др. источниках. Поля будут сохранены даже если указано только URL.
      </div>

      <div
        v-for="(link, index) in form.links"
        :key="`product-link-${index}`"
        class="flex flex-col gap-2 sm:gap-3 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_auto] lg:items-start"
      >
        <div class="w-full lg:w-full">
          <input
            v-model.trim="link.label"
            type="text"
            class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent"
            placeholder="Название (опционально)"
          />
        </div>

        <div class="flex-1 w-full space-y-2 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,280px)_minmax(120px,200px)] lg:gap-3 lg:items-start">
          <input
            v-model.trim="link.url"
            type="url"
            class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent"
            placeholder="https://example.com/товар"
          />
          <div class="relative w-full overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50">
            <div class="w-full pb-[125%] lg:pb-0 lg:h-48 bg-gradient-to-br from-gray-100 to-gray-200"></div>
            <Transition name="fade">
              <img
                v-if="getLinkPreview(link.url)"
                :src="getLinkPreview(link.url)"
                class="absolute inset-0 w-full h-full object-cover"
                alt="Предпросмотр"
              />
            </Transition>
          </div>
        </div>
        <button
          type="button"
          class="
            px-3 py-2 rounded-lg text-sm font-medium
            bg-red-50 text-red-600 border border-red-200
            hover:bg-red-100 hover:border-red-300 hover:text-red-700
            focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1
            transition-all duration-200
            w-full shrink-0 sm:w-auto lg:w-auto
          "
          @click="removeLink(index)"
        >
          Удалить
        </button>
      </div>

      <p class="text-xs text-gray-500">URL должны начинаться с https://. Название помогает отличать ссылки в интерфейсе.</p>
    </div>

    <!-- Variants Section -->
    <div class="space-y-4" v-if="form.hasVariants">
      <div class="flex items-center justify-between">
        <label class="text-sm font-medium text-gray-700">Варианты товара</label>
        <button
          type="button"
          class="px-3 py-2 bg-brand-dark text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-brand-dark/90"
          @click="addVariant"
        >
          + Добавить вариант
        </button>
      </div>

      <div v-for="(variant, index) in form.variants" :key="`variant-${index}`" class="p-4 border border-gray-200 rounded-xl space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-medium text-gray-700">Вариант {{ index + 1 }}</h4>
          <button
            v-if="(form.variants?.length ?? 0) > 1"
            type="button"
            class="
              px-3 py-1.5 rounded-lg text-sm font-medium
              bg-red-50 text-red-600 border border-red-200
              hover:bg-red-100 hover:border-red-300 hover:text-red-700
              focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1
              transition-all duration-200
            "
            @click="removeVariant(index)"
          >
            Удалить
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Название (цвет)</label>
            <input
              v-model="variant.name"
              type="text"
              required
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark"
              placeholder="Например, Черный"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Отображение цвета</label>
            <div class="space-y-2">
              <!-- Переключатель: цвет или картинка -->
              <div class="flex items-center gap-4">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    :name="`color-type-${index}`"
                    :checked="variant.colorDisplayMode !== 'image'"
                    @change="variant.colorDisplayMode = 'color'"
                    class="w-4 h-4 text-brand-dark"
                  />
                  <span class="text-sm text-gray-600">Цвет</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    :name="`color-type-${index}`"
                    :checked="variant.colorDisplayMode === 'image'"
                    @change="variant.colorDisplayMode = 'image'"
                    class="w-4 h-4 text-brand-dark"
                  />
                  <span class="text-sm text-gray-600">Картинка</span>
                </label>
              </div>
              
              <!-- Выбор цвета (режим "цвет") -->
              <div v-if="variant.colorDisplayMode !== 'image'" class="flex gap-2">
                <input
                  v-model="variant.colorCode"
                  type="text"
                  class="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark"
                  placeholder="#000000"
                />
                <input
                  :value="variant.colorCode || '#000000'"
                  @input="variant.colorCode = ($event.target as HTMLInputElement).value"
                  type="color"
                  class="w-12 h-10 border border-gray-300 rounded-lg cursor-pointer"
                />
              </div>
              
              <!-- Картинка цвета (режим "картинка") -->
              <div v-else class="flex items-center gap-3">
                <template v-if="variant.colorImage">
                  <div class="relative w-12 h-12 rounded-full overflow-hidden border-2 border-gray-300 shadow-sm">
                    <img :src="variant.colorImage" class="w-full h-full object-cover" />
                  </div>
                  <button
                    type="button"
                    @click="triggerColorImageUpload(index)"
                    class="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    Заменить
                  </button>
                  <button
                    type="button"
                    @click="variant.colorImage = ''"
                    class="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                  >
                    Удалить
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    @click="triggerColorImageUpload(index)"
                    class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 border border-dashed border-gray-300"
                  >
                    Загрузить картинку цвета
                  </button>
                </template>
              </div>
              
              <!-- Скрытый input для загрузки картинки цвета -->
              <input
                :ref="el => colorImageInputs[index] = el as HTMLInputElement"
                type="file"
                accept="image/*"
                class="hidden"
                @change="(e) => onColorImageSelected(e, index)"
              />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Цена (опционально)</label>
            <input
              v-model.number="variant.priceRub"
              type="number"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark"
              placeholder="Если отличается от основной"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Скидка на вкус, BYN</label>
            <input
              v-model="variant.discountPrice"
              type="number"
              min="0"
              step="0.01"
              inputmode="decimal"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500/30"
              placeholder="Пусто, если скидки нет"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Скидка действует по</label>
            <input
              v-model="variant.discountUntil"
              type="date"
              :disabled="!variant.discountPrice"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500/30 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Остаток, шт</label>
            <input
              v-model.number="variant.stock"
              type="number"
              min="0"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark"
              placeholder="0"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Изображения варианта</label>
          <input 
            :ref="el => variantFileInputs[index] = el as HTMLInputElement" 
            type="file" 
            accept="image/*" 
            multiple 
            class="hidden" 
            @change="(e) => onVariantFilesSelected(e, index)" 
          />
          <button
            type="button"
            class="mb-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            @click="triggerVariantFile(index)"
          >
            Добавить фото
          </button>
          <AdminProductImagesSorter 
            v-model="variant.images" 
            @remove="(imageIndex) => onRemoveVariantImage(index, imageIndex)" 
          />
        </div>
      </div>

      <p v-if="!form.variants || form.variants.length === 0" class="text-sm text-red-600">
        Добавьте хотя бы один вариант товара
      </p>
    </div>

    <!-- Use Category Image Checkbox (only for non-variant products) -->
    <div class="w-full" v-if="!form.hasVariants">
      <label class="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          v-model="form.useCategoryImage"
          class="mt-1 w-4 h-4 text-brand-dark border-gray-300 rounded focus:ring-2 focus:ring-brand-dark cursor-pointer"
        />
        <div class="flex-1">
          <span class="text-sm font-medium text-gray-700 group-hover:text-gray-900">
            Использовать изображение категории
          </span>
          <p class="text-xs text-gray-500 mt-1">
            Если включено, товар будет использовать обложку своей категории. Отключите, чтобы добавить собственные изображения.
          </p>
        </div>
      </label>
    </div>

    <!-- Images - МОБИЛЬНО АДАПТИВНОЕ -->
    <div class="space-y-3 w-full" v-if="!form.useCategoryImage && !form.hasVariants">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <label class="text-sm font-medium break-words" :class="!hasMedia ? 'text-red-600' : 'text-gray-700'">
          Медиа (фото или ссылки)
          <span v-if="!hasMedia" class="text-red-500 text-xs block sm:inline">
            добавьте хотя бы одно фото или ссылку
          </span>
        </label>
        <div class="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFilesSelected" />
          <button 
            type="button" 
            :disabled="isUploading" 
            @click="triggerFile" 
            class="
              w-full sm:w-auto px-3 py-2 
              bg-brand-dark text-white rounded-lg 
              text-xs sm:text-sm font-medium
              disabled:opacity-50 min-w-0 max-w-full
              truncate box-border
            "
          >
            <span class="truncate">
              {{ isUploading ? 'Загрузка...' : 'Добавить фото' }}
            </span>
          </button>
        </div>
      </div>

      <div class="w-full overflow-x-hidden">
        <AdminProductImagesSorter v-model="form.images" :disabled="isUploading" @reorder="onImagesReorder" @remove="onRemoveImage" />
      </div>

      <div class="text-xs text-gray-500 break-words space-y-1">
        <p>🖼️ Товары: <strong>3:4</strong> | Рекомендуется: <strong>900×1200px</strong></p>
        <p>Поддерживаются форматы JPG, PNG, WebP.</p>
      </div>
    </div>

    <!-- Actions - МОБИЛЬНО ОПТИМИЗИРОВАННЫЕ -->
    <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 sm:pt-6 border-t border-gray-100 w-full max-w-full">
      <button 
        type="button" 
        @click="$emit('cancel')"
        class="
          w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 
          text-sm sm:text-base font-medium
          text-gray-700 bg-gray-50 hover:bg-gray-100 hover:text-gray-900
          border border-gray-200 rounded-lg
          focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent
          transition-all duration-200 touch-manipulation
          min-w-0 max-w-full box-border
        "
      >
        Отмена
      </button>
      <button 
        type="submit" 
        :disabled="isSubmitting || isUploading || !hasMedia" 
        class="
          w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 
          text-sm sm:text-base font-medium rounded-lg
          bg-brand-dark text-white shadow-lg
          hover:bg-brand-dark/90 hover:shadow-xl
          focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-opacity-50
          active:bg-brand-dark/95 active:shadow-md
          transition-all duration-200 touch-manipulation
          min-w-0 max-w-full justify-center inline-flex items-center box-border
          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg
        "
      >
        <span v-if="isSubmitting || isUploading" class="inline-flex items-center justify-center truncate">
          <svg class="animate-spin -ml-1 mr-2 h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="truncate">{{ isSubmitting ? 'Сохранение...' : 'Загрузка...' }}</span>
        </span>
        <span v-else-if="!hasMedia" class="truncate">Добавьте медиа</span>
        <span v-else class="truncate">{{ isCreateMode ? 'Создать' : 'Применить' }}</span>
      </button>
    </div>
  </form>

  <AdminModal
    :isOpen="showCreateCategoryModal"
    title="Новая категория"
    description="Создайте категорию без выхода из формы"
    size="sm"
    :showActions="false"
    @close="closeCreateCategoryModal"
    @cancel="closeCreateCategoryModal"
  >
    <form class="space-y-4" @submit.prevent="submitCreateCategory">
      <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
        Название категории
        <input
          v-model.trim="newCategoryName"
          type="text"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-dark/20"
          placeholder="Например, Мороженое"
          required
        />
      </label>
      <p v-if="createCategoryError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
        {{ createCategoryError }}
      </p>
      <div class="flex gap-3 pt-2">
        <button
          type="submit"
          class="flex-1 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="creatingCategory"
        >
          {{ creatingCategory ? 'Создаём…' : 'Создать' }}
        </button>
        <button
          type="button"
          class="flex-1 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300"
          @click="closeCreateCategoryModal"
        >
          Отмена
        </button>
      </div>
    </form>
  </AdminModal>

  <AdminModal
    :isOpen="showCreateGroupModal"
    title="Новая линейка"
    :description="currentCategoryName ? `Категория: ${currentCategoryName}` : 'Выберите категорию'"
    size="sm"
    :showActions="false"
    @close="closeCreateGroupModal"
    @cancel="closeCreateGroupModal"
  >
    <form class="space-y-4" @submit.prevent="submitCreateGroup">
      <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
        Название линейки
        <input
          v-model.trim="newGroupName"
          type="text"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-dark/20"
          placeholder="Например, Кремовая"
          required
        />
      </label>
      <label class="flex flex-col gap-2 text-sm font-medium text-gray-700">
        Родительская линейка
        <select
          v-model="selectedParentGroupId"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-dark/20"
        >
          <option value="">Без родителя</option>
          <option v-for="group in availableGroups" :key="group.id" :value="group.id">
            {{ `${'— '.repeat(group.depth ?? 0)}${group.name}`.trim() }}
          </option>
        </select>
      </label>
      <p v-if="createGroupError" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
        {{ createGroupError }}
      </p>
      <div class="flex gap-3 pt-2">
        <button
          type="submit"
          class="flex-1 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="creatingGroup"
        >
          {{ creatingGroup ? 'Создаём…' : 'Создать' }}
        </button>
        <button
          type="button"
          class="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
          @click="closeCreateGroupModal"
        >
          Отмена
        </button>
      </div>
    </form>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import AdminProductImagesSorter from '@/components/admin/AdminProductImagesSorter.vue'
import { useAdminStore, type CategoryGroup as AdminCategoryGroup } from '@/stores/admin'

interface Category { id: string; name: string }
interface ProductLink { label?: string; url: string }
interface ProductDiscount {
  price: number
  untilDate: string | null
  active: boolean
}

interface ProductVariant {
  id?: string
  name: string
  colorCode?: string | null
  colorImage?: string | null
  colorDisplayMode?: 'color' | 'image'  // Режим отображения: цвет или картинка
  priceRub?: number | null
  discount?: ProductDiscount | null
  discountPrice?: string
  discountUntil?: string
  stock?: number
  images: string[]
}
interface Product {
  id: string
  categoryId: string
  groupId?: string | null
  groupName?: string
  groupSlug?: string
  title?: string
  priceRub: number
  description?: string
  useCategoryImage?: boolean
  hasVariants?: boolean
  variants?: ProductVariant[]
  images: string[]
  links?: ProductLink[]
  createdAt?: string
  strength?: string | null
  costPrice?: number
  stock?: number
  minStock?: number
  discount?: ProductDiscount | null
  discountEnabled?: boolean
  discountPrice?: string
  discountUntil?: string
}

const props = defineProps<{ product: Product | null; categories: Category[] }>()
const emit = defineEmits<{ (e: 'submit', payload: Omit<Product, 'id' | 'createdAt' | 'categoryName'>): void; (e: 'cancel'): void }>()

const admin = useAdminStore()

const isCreateMode = computed(() => !props.product)
const productIdForUpload = computed(() => props.product?.id || '')
const isUploading = ref(false)
const isSubmitting = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/** Цена скидки: пустое поле и мусор означают «скидки нет». */
function parseDiscountPrice(value: string | undefined): number | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = Number(raw.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const form = reactive<Omit<Product, 'id'>>({
  categoryId: props.product?.categoryId || '',
  groupId: props.product?.groupId || '',
  title: props.product?.title || '',
  priceRub: props.product?.priceRub || 0,
  description: props.product?.description || '',
  strength: props.product?.strength || '',
  costPrice: props.product?.costPrice ?? 0,
  stock: props.product?.stock ?? 0,
  minStock: props.product?.minStock ?? 0,
  useCategoryImage: props.product?.useCategoryImage ?? true,
  hasVariants: props.product?.hasVariants ?? false,
  variants: props.product?.variants ? props.product.variants.map(v => ({
    ...v,
    colorCode: v.colorCode || null,
    colorImage: v.colorImage || null,
    colorDisplayMode: (v.colorDisplayMode as 'color' | 'image') || (v.colorImage ? 'image' : 'color'),
    discountPrice: v.discount ? String(v.discount.price) : '',
    discountUntil: v.discount?.untilDate ?? '',
    images: [...(v.images || [])]
  })) : [],
  discountEnabled: Boolean(props.product?.discount),
  discountPrice: props.product?.discount ? String(props.product.discount.price) : '',
  discountUntil: props.product?.discount?.untilDate ?? '',
  images: [...(props.product?.images || [])],
  links: [...(props.product?.links || [])]
})

const localCategories = ref<Category[]>([...props.categories])
const showCreateCategoryModal = ref(false)
const newCategoryName = ref('')
const createCategoryError = ref('')
const creatingCategory = ref(false)

const showCreateGroupModal = ref(false)
const newGroupName = ref('')
const selectedParentGroupId = ref('')
const createGroupError = ref('')
const creatingGroup = ref(false)

const currentCategoryName = computed(() => localCategories.value.find((c) => c.id === form.categoryId)?.name || '')

const isGroupLoading = ref(false)
const fetchedGroupCategories = new Set<string>()

interface CategoryGroupNode extends AdminCategoryGroup {
  depth: number
  children: CategoryGroupNode[]
}

type CategoryGroupWithDepth = Omit<CategoryGroupNode, 'children'>

function buildGroupTree(categoryId: string): CategoryGroupNode[] {
  const groups = (admin.categoryGroups || []).filter(group => group.categoryId === categoryId)
  const nodes = new Map<string, CategoryGroupNode>()

  groups.forEach(group => {
    nodes.set(group.id, { ...group, depth: 0, children: [] })
  })

  const roots: CategoryGroupNode[] = []

  nodes.forEach(node => {
    const parentId = node.parentId || null
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const assignDepth = (list: CategoryGroupNode[], depth: number) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    list.forEach(node => {
      node.depth = depth
      if (node.children.length) {
        assignDepth(node.children, depth + 1)
      }
    })
  }

  assignDepth(roots, 0)
  return roots
}

function flattenGroupTree(nodes: CategoryGroupNode[]): CategoryGroupWithDepth[] {
  const result: CategoryGroupWithDepth[] = []
  nodes.forEach(node => {
    const { children, ...rest } = node
    result.push(rest)
    if (children.length) {
      result.push(...flattenGroupTree(children))
    }
  })
  return result
}

const availableGroups = computed((): CategoryGroupWithDepth[] => {
  if (!form.categoryId) return []
  const tree = buildGroupTree(form.categoryId)
  return flattenGroupTree(tree)
})

const validLinks = computed(() => (form.links || [])
  .map(link => link?.url?.trim() || '')
  .filter(url => url.length > 0))

const hasMedia = computed(() => {
  // Для товаров с вариантами медиа считается корректным если есть варианты с изображениями
  if (form.hasVariants) {
    return form.variants && form.variants.length > 0 && form.variants.every(v => v.images && v.images.length > 0)
  }
  // Если включен чекбокс "использовать изображение категории", медиа не требуется
  if (form.useCategoryImage) return true
  // Иначе проверяем наличие своих изображений или ссылок
  return form.images.length > 0 || validLinks.value.length > 0
})

function openCreateCategoryModal() {
  newCategoryName.value = ''
  createCategoryError.value = ''
  showCreateCategoryModal.value = true
}

function closeCreateCategoryModal() {
  showCreateCategoryModal.value = false
  createCategoryError.value = ''
}

async function submitCreateCategory() {
  if (creatingCategory.value) return
  const trimmed = newCategoryName.value.trim()
  if (!trimmed) {
    createCategoryError.value = 'Введите название категории'
    return
  }
  creatingCategory.value = true
  createCategoryError.value = ''
  try {
    const created = await admin.createCategory({ name: trimmed })
    if (created) {
      if (!admin.categories.some(category => category.id === created.id)) {
        admin.categories.push(created)
      }
      if (!localCategories.value.some(category => category.id === created.id)) {
        localCategories.value = [...localCategories.value, created]
      }
      form.categoryId = created.id
      form.groupId = ''
      fetchedGroupCategories.delete(created.id)
      showCreateCategoryModal.value = false
      newCategoryName.value = ''
    }
  } catch (error: any) {
    createCategoryError.value = error?.data?.message || error?.message || 'Не удалось создать категорию'
  } finally {
    creatingCategory.value = false
  }
}

async function openCreateGroupModal() {
  if (!form.categoryId) {
    alert('Выберите категорию, прежде чем создавать линейку')
    return
  }
  createGroupError.value = ''
  newGroupName.value = ''
  selectedParentGroupId.value = ''
  showCreateGroupModal.value = true
  if (!fetchedGroupCategories.has(form.categoryId)) {
    await ensureGroupsForCategory(form.categoryId)
  }
}

function closeCreateGroupModal() {
  showCreateGroupModal.value = false
  createGroupError.value = ''
}

async function submitCreateGroup() {
  if (creatingGroup.value) return
  if (!form.categoryId) {
    createGroupError.value = 'Сначала выберите категорию'
    return
  }
  const trimmed = newGroupName.value.trim()
  if (!trimmed) {
    createGroupError.value = 'Введите название линейки'
    return
  }
  creatingGroup.value = true
  createGroupError.value = ''
  try {
    const created = await admin.createCategoryGroup({
      categoryId: form.categoryId,
      name: trimmed,
      parentId: selectedParentGroupId.value || undefined
    })
    if (created) {
      form.groupId = created.id
      showCreateGroupModal.value = false
      newGroupName.value = ''
      selectedParentGroupId.value = ''
    }
  } catch (error: any) {
    createGroupError.value = error?.data?.message || error?.message || 'Не удалось создать линейку'
  } finally {
    creatingGroup.value = false
  }
}

watch(() => props.categories, (next) => {
  if (!Array.isArray(next)) return
  const map = new Map<string, Category>()
  localCategories.value.forEach((category) => {
    map.set(category.id, category)
  })
  next.forEach((category) => {
    map.set(category.id, category)
  })
  localCategories.value = Array.from(map.values())
})

watch(() => props.product, (p) => {
  form.categoryId = p?.categoryId || ''
  form.groupId = p?.groupId || ''
  form.title = p?.title || ''
  form.priceRub = p?.priceRub || 0
  form.description = p?.description || ''
  form.strength = p?.strength || ''
  form.costPrice = p?.costPrice ?? 0
  form.stock = p?.stock ?? 0
  form.minStock = p?.minStock ?? 0
  form.useCategoryImage = p?.useCategoryImage ?? true
  form.hasVariants = p?.hasVariants ?? false
  form.variants = p?.variants ? p.variants.map(v => ({
    ...v,
    colorCode: v.colorCode || null,
    colorImage: v.colorImage || null,
    // Определяем режим: если есть colorImage - режим 'image', иначе 'color'
    colorDisplayMode: (v.colorDisplayMode as 'color' | 'image') || (v.colorImage ? 'image' : 'color'),
    discountPrice: v.discount ? String(v.discount.price) : '',
    discountUntil: v.discount?.untilDate ?? '',
    images: [...(v.images || [])]
  })) : []
  form.discountEnabled = Boolean(p?.discount)
  form.discountPrice = p?.discount ? String(p.discount.price) : ''
  form.discountUntil = p?.discount?.untilDate ?? ''
  form.images = [...(p?.images || [])]
  form.links = [...(p?.links || [])]
  if (form.categoryId) {
    void ensureGroupsForCategory(form.categoryId)
  }
})

watch(() => form.categoryId, (categoryId, previous) => {
  if (!categoryId) {
    form.groupId = ''
    return
  }

  if (previous !== categoryId) {
    form.groupId = ''
  }

  void ensureGroupsForCategory(categoryId)
})

watch(availableGroups, (groups) => {
  if (!groups.length) {
    form.groupId = ''
    return
  }
  if (form.groupId && !groups.some(group => group.id === form.groupId)) {
    form.groupId = ''
  }
})

async function ensureGroupsForCategory(categoryId: string) {
  if (!categoryId || fetchedGroupCategories.has(categoryId)) return
  try {
    isGroupLoading.value = true
    await admin.fetchCategoryGroups(categoryId)
    fetchedGroupCategories.add(categoryId)
  } catch (error) {
    console.error('[AdminProductForm] Failed to fetch category groups:', error)
  } finally {
    isGroupLoading.value = false
  }
}

function triggerFile() { fileInput.value?.click() }

function addLink() {
  form.links = [...(form.links || []), { label: '', url: '' }]
}

function removeLink(index: number) {
  if (!form.links || index < 0 || index >= form.links.length) {
    return
  }
  form.links = form.links.filter((_, i) => i !== index)
}

function getLinkPreview(url?: string) {
  if (!url) return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed, window.location.origin)
    if (!/^https?:$/i.test(parsed.protocol)) {
      return ''
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

// Привязать загруженные изображения к товару в базе
async function attachImagesToProduct(productId: string, urls: string[]) {
  try {
    const response = await fetch(`/api/admin/products/${productId}/images/attach`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${admin.token}`
      },
      body: JSON.stringify({ urls })
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Не удалось привязать изображения (${response.status}): ${errorText}`)
    }
    
    console.log('Изображения успешно привязаны к товару', urls)
  } catch (error) {
    console.error('Ошибка привязки изображений:', error)
    throw error
  }
}

async function onFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  
  console.log('Файлы выбраны:', files ? files.length : 0)
  
  if (!files || files.length === 0) {
    console.log('Нет файлов для загрузки')
    return
  }
  
  try {
    isUploading.value = true
    
    // Для новых товаров загружаем в темпорарную папку
    const uploadPath = isCreateMode.value ? 'temp' : `products/${productIdForUpload.value}`
    console.log('Начинаем загрузку в:', uploadPath)
    
    // Загрузка файлов
    const uploaded = await admin.uploadFiles(files, uploadPath)
    console.log('Файлы загружены:', uploaded)
    
    if (uploaded && Array.isArray(uploaded) && uploaded.length > 0) {
      console.log('Загружено файлов:', uploaded.length, uploaded)
      
      if (!isCreateMode.value && productIdForUpload.value) {
        // Для существующих товаров - привязать к базе
        console.log('Привязываем изображения к товару...')
        await attachImagesToProduct(productIdForUpload.value, uploaded)
      }
      
      // Обновляем локальное состояние
      console.log('Состояние form.images до:', [...form.images])
      // Создаем новый массив для корректной реактивности Vue
      form.images = [...form.images, ...uploaded]
      console.log('Состояние form.images после:', [...form.images])
      console.log('Изображения добавлены в форму. Всего:', form.images.length)
    } else {
      console.log('Не удалось загрузить файлы или пустой результат:', uploaded)
      alert('Не удалось загрузить файлы')
    }
    
  } catch (error) {
    console.error('Ошибка загрузки файлов:', error)
    alert(`Ошибка загрузки: ${error}`)
  } finally {
    isUploading.value = false
    if (input) input.value = ''
  }
}

function onImagesReorder(newOrder: string[]) {
  // Обновляем порядок с новым массивом
  form.images = [...newOrder]
}

function onRemoveImage(index: number) {
  console.log(`Удаляем изображение по индексу: ${index}`)
  if (index >= 0 && index < form.images.length) {
    const removedImage = form.images[index]
    form.images = form.images.filter((_, i) => i !== index)
    console.log(`Изображение ${removedImage} удалено. Осталось: ${form.images.length}`)
  } else {
    console.error(`Неверный индекс для удаления: ${index}`)
  }
}

// Variant-related functions
const variantFileInputs = ref<Record<number, HTMLInputElement>>({})
const colorImageInputs = ref<Record<number, HTMLInputElement>>({})

function addVariant() {
  if (!form.variants) form.variants = []
  form.variants.push({
    name: '',
    colorCode: null,
    colorImage: null,
    colorDisplayMode: 'color',  // По умолчанию режим "цвет"
    priceRub: null,
    stock: 0,
    images: []
  })
}

function removeVariant(index: number) {
  if (form.variants && index >= 0 && index < form.variants.length) {
    form.variants.splice(index, 1)
  }
}

function triggerVariantFile(index: number) {
  const input = variantFileInputs.value[index]
  if (input) input.click()
}

function triggerColorImageUpload(index: number) {
  const input = colorImageInputs.value[index]
  if (input) input.click()
}

async function onColorImageSelected(e: Event, variantIndex: number) {
  const input = e.target as HTMLInputElement
  const files = input.files
  
  if (!files || files.length === 0 || !form.variants) return
  
  try {
    isUploading.value = true
    const uploadPath = 'color-images'
    const uploaded = await admin.uploadFiles(files, uploadPath)
    
    if (uploaded && Array.isArray(uploaded) && uploaded.length > 0) {
      form.variants[variantIndex].colorImage = uploaded[0]
      // Очищаем colorCode при загрузке картинки
      form.variants[variantIndex].colorCode = null
    }
  } catch (error) {
    console.error('Ошибка загрузки картинки цвета:', error)
    alert(`Ошибка загрузки: ${error}`)
  } finally {
    isUploading.value = false
    if (input) input.value = ''
  }
}

async function onVariantFilesSelected(e: Event, variantIndex: number) {
  const input = e.target as HTMLInputElement
  const files = input.files
  
  if (!files || files.length === 0 || !form.variants) return
  
  try {
    isUploading.value = true
    const uploadPath = 'temp'
    const uploaded = await admin.uploadFiles(files, uploadPath)
    
    if (uploaded && Array.isArray(uploaded) && uploaded.length > 0) {
      form.variants[variantIndex].images = [...form.variants[variantIndex].images, ...uploaded]
    }
  } catch (error) {
    console.error('Ошибка загрузки файлов варианта:', error)
    alert(`Ошибка загрузки: ${error}`)
  } finally {
    isUploading.value = false
    if (input) input.value = ''
  }
}

function onRemoveVariantImage(variantIndex: number, imageIndex: number) {
  if (form.variants && form.variants[variantIndex]) {
    form.variants[variantIndex].images = form.variants[variantIndex].images.filter((_, i) => i !== imageIndex)
  }
}

async function onSubmit() {
  isSubmitting.value = true
  try {
    // Валидация ссылок
    const linksArray = form.links || []
    const hasEmptyLink = linksArray.some(link => !link.url || link.url.trim().length === 0)
    if (hasEmptyLink) {
      alert('Заполните URL для всех ссылок или удалите пустые строки')
      return
    }

    const normalizedLinks = linksArray
      .map(link => ({
        label: link.label?.trim() || '',
        url: link.url.trim()
      }))
      .filter(link => link.url.length > 0)

    // Валидация вариантов
    if (form.hasVariants) {
      if (!form.variants || form.variants.length === 0) {
        alert('Добавьте хотя бы один вариант')
        return
      }
      for (const variant of form.variants) {
        if (!variant.name || variant.name.trim().length === 0) {
          alert('Заполните название для всех вариантов')
          return
        }
        if (!variant.images || variant.images.length === 0) {
          alert(`Добавьте изображение для варианта "${variant.name}"`)
          return
        }
      }
    } else {
      // Для обычных товаров проверяем media
      if (!hasMedia.value) {
        alert('Добавьте хотя бы одно фото через загрузку или ссылку')
        return
      }
    }

    const payload: any = {
      categoryId: form.categoryId,
      groupId: form.groupId || null,
      title: form.title,
      priceRub: form.hasVariants ? 0 : form.priceRub,
      description: form.description,
      costPrice: Number(form.costPrice ?? 0),
      minStock: Number(form.minStock ?? 0),
      discount: form.discountEnabled
        ? { price: parseDiscountPrice(form.discountPrice), untilDate: form.discountUntil || null }
        : { price: null, untilDate: null },
      links: normalizedLinks.length ? normalizedLinks : []
    }
    
    // Крепость и остаток только для товаров без вариантов
    if (!form.hasVariants) {
      payload.strength = form.strength?.trim() || null
      payload.stock = Number(form.stock ?? 0)
    }

    if (form.hasVariants) {
      payload.hasVariants = true
      payload.variants = form.variants?.map(v => ({
        id: v.id,
        name: v.name.trim(),
        colorCode: v.colorDisplayMode === 'image' ? null : (v.colorCode?.trim() || null),
        colorImage: v.colorDisplayMode === 'image' ? (v.colorImage || null) : null,
        colorDisplayMode: v.colorDisplayMode || 'color',
        priceRub: v.priceRub !== null && v.priceRub !== undefined ? Number(v.priceRub) : null,
        stock: v.stock !== undefined ? Number(v.stock) : 0,
        // Пустое поле означает «скидки нет», сервер по нему её снимает.
        discount: {
          price: parseDiscountPrice(v.discountPrice),
          untilDate: v.discountUntil || null,
        },
        images: [...v.images]
      }))
    } else {
      payload.hasVariants = false
      payload.useCategoryImage = form.useCategoryImage
      payload.images = [...form.images]
    }

    emit('submit', payload)
  } finally {
    isSubmitting.value = false
  }
}
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
</style>
