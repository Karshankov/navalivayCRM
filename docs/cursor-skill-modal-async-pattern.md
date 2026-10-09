# Паттерн: Модалки с асинхронными операциями

## Проблема

При работе с модалками, которые выполняют асинхронные операции (API вызовы), часто возникает баг: модалка не закрывается после успешного выполнения.

### Причина

Типичный антипаттерн:

```typescript
function closeModal() {
  if (isLoading.value) return; // ← Блокирует закрытие пока идет загрузка
  modalOpen.value = false;
}

async function submitAction() {
  isLoading.value = true;
  try {
    await apiCall();
    closeModal(); // ← НЕ СРАБОТАЕТ! isLoading все еще true
  } finally {
    isLoading.value = false;
  }
}
```

`closeModal()` проверяет `isLoading` и возвращается рано, потому что флаг сбрасывается только в `finally`.

## Решение

### Вариант 1: Закрывать напрямую (рекомендуется)

```typescript
async function submitAction() {
  isLoading.value = true;
  try {
    await apiCall();
    // Закрываем напрямую, минуя проверку
    modalOpen.value = false;
    orderData.value = null;
  } catch (error) {
    showError(error);
  } finally {
    isLoading.value = false;
  }
}
```

### Вариант 2: Сбросить флаг перед закрытием

```typescript
async function submitAction() {
  isLoading.value = true;
  try {
    await apiCall();
    isLoading.value = false; // Сбрасываем ДО закрытия
    closeModal();
  } catch (error) {
    showError(error);
    isLoading.value = false;
  }
}
```

### Вариант 3: Параметр force в closeModal

```typescript
function closeModal(force = false) {
  if (!force && isLoading.value) return;
  modalOpen.value = false;
}

async function submitAction() {
  isLoading.value = true;
  try {
    await apiCall();
    closeModal(true); // Принудительно закрыть
  } finally {
    isLoading.value = false;
  }
}
```

## Чеклист при создании модалок

- [ ] Проверить что `closeModal` вызывается когда `isLoading = false`
- [ ] Или закрывать модалку напрямую в try блоке
- [ ] Тестировать: нажать кнопку → дождаться ответа → модалка должна закрыться

## Примеры в проекте

- `CrmOrders.vue`: `applyDiscount`, `removeDiscount`, `confirmCancelOrder`
- Все используют прямое закрытие: `modalOpen.value = false`

## Соседние окна на Headless UI

Два соседних `AdminModal` нельзя держать открытыми одновременно. Их ловушки
фокуса работают независимо: нижнее окно может перехватить первый клик или
закрыться от действия в верхнем.

Когда из одного окна открывается другое, оставляйте активным только верхнее:

```vue
<AdminModal v-if="!childOpen" :is-open="parentOpen" />
<AdminModal v-if="childOpen" :is-open="true" />
```

Данные родительской формы храните в состоянии компонента, чтобы они пережили
временное скрытие, а прокрутку сохраните перед открытием дочернего окна и
восстановите после возврата. Одного условия в `is-open` недостаточно: во время
анимации закрытия старое окно ещё перехватывает фокус. Настоящие вложенные
`AdminModal`, объявленные внутри слота родителя, вручную скрывать не нужно: их
стеком управляет Headless UI.
