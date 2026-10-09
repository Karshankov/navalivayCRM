<template>
  <div class="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-7xl space-y-8">
      <div class="flex flex-col gap-3">
        <button @click="$router.push('/admin/crm/orders')" class="inline-flex w-fit items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Назад к заказам
        </button>
        
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 sm:text-3xl">Шаблоны сообщений</h1>
            <p class="mt-2 text-sm text-gray-600 sm:text-base">Управление шаблонами для связи с клиентами</p>
          </div>
          <button @click="showCreateModal = true" class="w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-blue-700 sm:w-auto">
            Создать шаблон
          </button>
        </div>
      </div>

      <div v-if="loadingTemplates" class="text-center py-12">
        <div class="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
        <p class="mt-4 text-gray-600">Загрузка...</p>
      </div>

      <div v-else-if="messageTemplates.length > 0" class="space-y-4">
        <div v-for="template in messageTemplates" :key="template.id" class="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-3">
                <h3 class="text-lg font-semibold text-gray-900">{{ template.name }}</h3>
                <span class="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {{ template.type === 'order_contact' ? 'Связь с клиентом' : template.type }}
                </span>
              </div>
              <div class="mt-3 rounded-md bg-gray-50 p-4">
                <p class="text-sm text-gray-700 whitespace-pre-wrap font-mono">{{ template.content }}</p>
              </div>
              <div class="mt-3 text-xs text-gray-500">
                <p>Создан: {{ formatDate(template.created_at) }}</p>
                <p v-if="template.updated_at">Изменён: {{ formatDate(template.updated_at) }}</p>
              </div>
              <div class="mt-3 rounded-md bg-blue-50 p-3 text-xs text-blue-700">
                <p class="font-medium mb-1">Доступные переменные:</p>
                <p class="font-mono">[order_number] [items] [total] [phone] [address]</p>
              </div>
            </div>
            <div class="flex gap-2 sm:flex-col">
              <button @click="editTemplate(template)" class="admin-link-button admin-link-button--edit">
                Редактировать
              </button>
              <button @click="deleteTemplateConfirm(template)" class="admin-link-button admin-link-button--danger">
                Удалить
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="text-center py-12 bg-white rounded-lg shadow-sm">
        <p class="text-gray-600">Шаблонов нет. Создайте первый шаблон для быстрой связи с клиентами.</p>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <AdminModal
      :isOpen="showCreateModal || !!editingTemplate"
      :title="editingTemplate ? 'Редактировать шаблон' : 'Создать шаблон'"
      description="Заполните данные шаблона. Используйте переменные для динамических данных."
      size="md"
      :showActions="false"
      @close="closeModal"
      @cancel="closeModal"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Название шаблона</label>
          <input v-model="form.name" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Например: Уведомление о заказе" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Тип шаблона</label>
          <select v-model="form.type" class="w-full px-3 py-2 border border-gray-300 rounded-md">
            <option value="order_contact">Связь с клиентом</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Текст сообщения</label>
          <textarea
            v-model="form.content"
            rows="8"
            class="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
            placeholder="Введите текст сообщения. Используйте переменные: [order_number], [items], [total], [phone], [address]"
          />
        </div>
        <div class="rounded-md bg-blue-50 p-3 text-xs text-blue-700">
          <p class="font-medium mb-1">Доступные переменные:</p>
          <ul class="list-disc list-inside space-y-1 font-mono">
            <li>[order_number] - номер заказа</li>
            <li>[items] - состав заказа</li>
            <li>[total] - итоговая сумма</li>
            <li>[phone] - телефон клиента</li>
            <li>[address] - адрес доставки</li>
          </ul>
        </div>
        <div v-if="error" class="rounded-md bg-red-50 p-3 text-sm text-red-600">
          {{ error }}
        </div>
        <div class="flex gap-3 pt-2">
          <button @click="submit" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700" :disabled="isSaving">
            {{ isSaving ? 'Сохранение...' : 'Сохранить' }}
          </button>
          <button @click="closeModal" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">
            Отмена
          </button>
        </div>
      </div>
    </AdminModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCrmStore } from '@/stores/crm'
import { storeToRefs } from 'pinia'
import type { MessageTemplate } from '@/stores/crm'
import AdminModal from '@/components/AdminModal.vue'

const crmStore = useCrmStore()
const { messageTemplates, loadingTemplates } = storeToRefs(crmStore)
const showCreateModal = ref(false)
const editingTemplate = ref<MessageTemplate | null>(null)
const form = ref({
  name: '',
  content: '',
  type: 'order_contact'
})
const error = ref('')
const isSaving = ref(false)

onMounted(() => {
  crmStore.fetchMessageTemplates()
})

function editTemplate(template: MessageTemplate) {
  editingTemplate.value = template
  form.value = {
    name: template.name,
    content: template.content,
    type: template.type
  }
}

function closeModal() {
  showCreateModal.value = false
  editingTemplate.value = null
  form.value = { name: '', content: '', type: 'order_contact' }
  error.value = ''
}

async function submit() {
  error.value = ''
  
  if (!form.value.name.trim()) {
    error.value = 'Введите название шаблона'
    return
  }
  
  if (!form.value.content.trim()) {
    error.value = 'Введите текст сообщения'
    return
  }
  
  isSaving.value = true
  
  try {
    if (editingTemplate.value) {
      await crmStore.updateMessageTemplate(editingTemplate.value.id, {
        name: form.value.name,
        content: form.value.content,
        type: form.value.type
      })
    } else {
      await crmStore.createMessageTemplate({
        name: form.value.name,
        content: form.value.content,
        type: form.value.type
      })
    }
    closeModal()
    await crmStore.fetchMessageTemplates()
  } catch (err: any) {
    error.value = err?.message || 'Ошибка сохранения'
  } finally {
    isSaving.value = false
  }
}

async function deleteTemplateConfirm(template: MessageTemplate) {
  if (!confirm(`Удалить шаблон "${template.name}"?`)) return
  
  try {
    await crmStore.deleteMessageTemplate(template.id)
    await crmStore.fetchMessageTemplates()
  } catch (err) {
    alert('Ошибка удаления')
  }
}

function formatDate(dateString: string | null) {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>
