<template>
  <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm col-span-full">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-gray-900">
          Соглашения перед заказом
        </h3>
        <p class="text-sm text-gray-600">
          Чекбоксы между «Итого» и «Оформить заказ». Заголовок виден на чекбоксе, текст в модалке.
          Все активные соглашения обязательны: без принятых галочек заказ создать нельзя.
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        @click="openCreateForm"
      >
        + Добавить соглашение
      </button>
    </div>

    <div v-if="loading" class="mt-6 text-sm text-gray-500">Загрузка…</div>
    <div v-else-if="errorText" class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ errorText }}
    </div>
    <div
      v-else-if="!items.length"
      class="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500"
    >
      Соглашений ещё нет. Создайте первое, оно сразу появится в чекауте.
    </div>
    <ul v-else class="mt-6 space-y-3">
      <li
        v-for="item in sortedItems"
        :key="item.id"
        class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-sm font-semibold text-gray-900">{{ item.title }}</p>
            <span
              :class="
                item.is_active
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-200 text-gray-600'
              "
              class="rounded-full px-2 py-0.5 text-[11px] font-medium"
            >{{ item.is_active ? 'Активно' : 'Скрыто' }}</span>
            <span class="text-[11px] text-gray-500">порядок: {{ item.sort_order }}</span>
          </div>
          <p
            v-if="item.body"
            class="mt-1 line-clamp-2 text-xs text-gray-600"
            :title="item.body"
          >{{ item.body }}</p>
          <p v-else class="mt-1 text-xs italic text-gray-400">
            Текст соглашения не заполнен
          </p>
        </div>
        <div class="flex flex-shrink-0 gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
            @click="openEditForm(item)"
          >
            Редактировать
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
            :disabled="busyId === item.id"
            @click="handleDelete(item)"
          >
            Удалить
          </button>
        </div>
      </li>
    </ul>

    <!-- Form modal -->
    <AdminModal
      :isOpen="formOpen"
      :title="editingId ? 'Редактировать соглашение' : 'Новое соглашение'"
      size="lg"
      :showActions="false"
      @cancel="closeForm"
      @close="closeForm"
    >
      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">
            Текст-ссылка на чекбоксе (грамматика для «Соглашаюсь с …»)
          </label>
          <input
            v-model="form.title"
            type="text"
            required
            maxlength="200"
            placeholder="Например: правилами заказа"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
          <p class="text-xs text-gray-500">
            Клиент увидит: «Соглашаюсь с <span class="text-blue-600 underline">{{ form.title || '…' }}</span>». {{ form.title.length }} / 200 символов
          </p>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">
            Заголовок модалки (когда клиент кликнул по ссылке)
          </label>
          <input
            v-model="form.modal_title"
            type="text"
            maxlength="200"
            placeholder="Например: Правила заказа"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
          <p class="text-xs text-gray-500">
            Если пусто, в модалке покажется текст-ссылка из поля выше («{{ form.title || '…' }}»). {{ form.modal_title.length }} / 200 символов
          </p>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">
            Текст соглашения (виден в модалке)
          </label>
          <textarea
            v-model="form.body"
            rows="8"
            maxlength="20000"
            placeholder="Здесь подробное описание правил, которое клиент сможет прочитать полностью."
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          ></textarea>
          <p class="text-xs text-gray-500">{{ form.body.length }} / 20000 символов</p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input v-model="form.is_active" type="checkbox" class="h-4 w-4 rounded" />
            Показывать клиентам
          </label>
          <div class="space-y-1">
            <label class="text-xs font-medium text-gray-600">Порядок сортировки</label>
            <input
              v-model.number="form.sort_order"
              type="number"
              step="1"
              min="0"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </div>

        <div v-if="formError" class="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {{ formError }}
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            @click="closeForm"
          >
            Отмена
          </button>
          <button
            type="submit"
            :disabled="formSubmitting || !form.title.trim()"
            class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ formSubmitting ? 'Сохранение…' : editingId ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </form>
    </AdminModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import AdminModal from "@/components/AdminModal.vue";

interface Agreement {
  id: number;
  title: string;
  body: string;
  // Опциональный заголовок модалки. Пустая строка → fallback на title.
  modal_title: string;
  // Бэк-контракт (rowToAgreement в server/utils/agreements.js): всегда 0 | 1.
  is_active: 0 | 1;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

const items = ref<Agreement[]>([]);
const loading = ref(false);
const errorText = ref<string | null>(null);
const busyId = ref<number | null>(null);

const formOpen = ref(false);
const editingId = ref<number | null>(null);
const formSubmitting = ref(false);
const formError = ref<string | null>(null);
const form = reactive({
  title: "",
  body: "",
  modal_title: "",
  is_active: true,
  sort_order: 0,
});

const sortedItems = computed(() =>
  [...items.value].sort((a, b) => {
    const aOrder = Number(a.sort_order ?? 0);
    const bOrder = Number(b.sort_order ?? 0);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return Number(a.id) - Number(b.id);
  }),
);

async function fetchItems() {
  loading.value = true;
  errorText.value = null;
  try {
    const response = await fetch("/api/admin/crm/agreements", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Не удалось загрузить соглашения");
    }
    const data = (await response.json()) as { items: Agreement[] };
    items.value = Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.title = "";
  form.body = "";
  form.modal_title = "";
  form.is_active = true;
  form.sort_order = items.value.length
    ? Math.max(...items.value.map((it) => Number(it.sort_order ?? 0))) + 10
    : 0;
}

function openCreateForm() {
  editingId.value = null;
  formError.value = null;
  resetForm();
  formOpen.value = true;
}

function openEditForm(item: Agreement) {
  editingId.value = item.id;
  formError.value = null;
  form.title = item.title;
  form.body = item.body;
  form.modal_title = item.modal_title || "";
  form.is_active = Boolean(item.is_active);
  form.sort_order = Number(item.sort_order ?? 0);
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  editingId.value = null;
  formError.value = null;
}

async function handleSubmit() {
  if (!form.title.trim()) return;
  formSubmitting.value = true;
  formError.value = null;
  try {
    const payload = {
      title: form.title.trim(),
      body: form.body,
      modal_title: form.modal_title.trim(),
      is_active: form.is_active ? 1 : 0,
      sort_order: form.sort_order,
    };
    const url = editingId.value
      ? `/api/admin/crm/agreements/${editingId.value}`
      : "/api/admin/crm/agreements";
    const method = editingId.value ? "PUT" : "POST";
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const code = data?.error;
      // Маппим коды бэка в человеческие сообщения. Совпадает с util'ом
      // server/utils/agreements.js — если он добавит новые коды, пробросим
      // generic-сообщение через `else`.
      if (code === "title_required") {
        formError.value = "Заголовок обязателен";
      } else if (code === "title_too_long") {
        formError.value = "Заголовок слишком длинный (максимум 200 символов)";
      } else if (code === "body_too_long") {
        formError.value = "Текст соглашения слишком длинный (максимум 20000 символов)";
      } else if (code === "modal_title_too_long") {
        formError.value = "Заголовок модалки слишком длинный (максимум 200 символов)";
      } else if (code === "agreement_not_found") {
        formError.value = "Соглашение не найдено, возможно, оно уже удалено";
      } else {
        formError.value = data?.message || "Не удалось сохранить соглашение";
      }
      return;
    }
    closeForm();
    await fetchItems();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err);
  } finally {
    formSubmitting.value = false;
  }
}

async function handleDelete(item: Agreement) {
  if (!confirm(`Удалить соглашение «${item.title}»? Это действие необратимо.`)) {
    return;
  }
  busyId.value = item.id;
  try {
    const response = await fetch(`/api/admin/crm/agreements/${item.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      // 404 = другой админ уже удалил → синхронизируем список.
      // Прочие ошибки тоже синхронизируем чтобы UI не висел в неконсистентном
      // состоянии, и поднимаем сообщение пользователю.
      await fetchItems();
      const data = await response.json().catch(() => ({}));
      throw new Error(
        data?.error === 'agreement_not_found'
          ? 'Соглашение уже удалено другим администратором'
          : data?.message || 'Не удалось удалить соглашение',
      );
    }
    items.value = items.value.filter((it) => it.id !== item.id);
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  } finally {
    busyId.value = null;
  }
}

onMounted(() => {
  fetchItems();
});
</script>
