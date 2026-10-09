<template>
  <form @submit="onSubmit" class="space-y-6">
    <!-- Название категории -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Название категории *
      </label>
      <input
        v-model="name"
        v-bind="nameAttrs"
        type="text"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent"
        placeholder="Например: Пиджаки"
        :class="{ 'border-red-300 focus:ring-red-500 focus:border-red-300': errors.name }"
      />
      <p v-if="errors.name" class="mt-1 text-sm text-red-600">{{ errors.name }}</p>
    </div>

    <!-- Действия -->
    <div class="flex justify-end space-x-3 pt-4">
      <button
        type="button"
        @click="$emit('cancel')"
        class="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
      >
        Отмена
      </button>
      <button
        type="submit"
        :disabled="!meta.valid || isSubmitting"
        class="px-4 py-2 bg-brand-dark text-white rounded-lg hover:bg-brand-dark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {{ isSubmitting ? 'Сохранение...' : (editingCategory ? 'Применить' : 'Создать') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useForm } from 'vee-validate'

interface Category {
  id?: string
  name: string
  order?: number
}

interface Props {
  editingCategory?: Category | null
  isSubmitting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  editingCategory: null,
  isSubmitting: false
})

const emit = defineEmits<{
  submit: [category: Pick<Category, 'name'>]
  cancel: []
}>()

// Схема валидации: только имя
const validationSchema = {
  name: (value: string) => {
    if (!value) return 'Название категории обязательно'
    if (value.length > 100) return 'Название не должно превышать 100 символов'
    return true
  }
}

// Форма
const { defineField, handleSubmit, errors, meta, setValues, resetForm } = useForm({
  validationSchema,
  initialValues: {
    name: props.editingCategory?.name || ''
  }
})

const [name, nameAttrs] = defineField('name')

// Синхронизация при редактировании
watch(() => props.editingCategory, (newCategory) => {
  if (newCategory) {
    setValues({ name: newCategory.name })
  } else {
    resetForm({ values: { name: '' } })
  }
}, { immediate: true })

// Отправка
const onSubmit = handleSubmit((values) => {
  emit('submit', { name: values.name })
})
</script>
