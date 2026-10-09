# Личный кабинет и нижняя навигация (Profile + BottomTabBar)

## Назначение

Личный кабинет пользователя в Telegram Mini App с аватаркой из Telegram, нижний таб-бар для навигации между разделами, и placeholder под бонусную систему (блок D).

## Архитектура

### База данных

Поля в таблице `customers` (SQLite):

```sql
-- Добавлены миграцией add_customer_photo.js
photo_url TEXT           -- Кешированный URL аватарки из Telegram
photo_updated_at TEXT    -- Время последнего обновления фото (кеш 24ч)
```

Миграция: `server/migrations/add_customer_photo.js`

### Backend API

Роутер: `server/routes/public.js`

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/customer/me?telegram_id=XXX` | Профиль клиента с аватаркой |

Логика получения аватарки:
1. Проверяет `photo_url` в БД - если есть и не старше 24ч, возвращает кеш
2. Если кеш устарел - вызывает Telegram Bot API `getChat` -> `photo.big_file_id` -> `getFile` -> формирует URL
3. Сохраняет URL в `customers.photo_url` + `photo_updated_at`
4. Если у пользователя нет фото - возвращает `null`, фронт показывает заглушку

Использует существующую функцию `fetchTelegramChat()` из `public.js`.

### Frontend

**Компоненты:**
- `frontend/src/components/BottomTabBar.vue` - нижний таб-бар (4 вкладки)
- `frontend/src/views/ProfileView.vue` - страница личного кабинета
- `frontend/src/views/PlaceholderView.vue` - заглушка для будущих разделов

**Store:** `frontend/src/stores/user.ts`
- `profile` - данные пользователя (UserProfile)
- `isLoading`, `error` - состояние загрузки
- `fetchProfile(telegramId?)` - загрузка профиля с API, fallback на initDataUnsafe
- `displayName` - computed: "Имя Фамилия" или "Пользователь"
- `hasUsername` - computed: boolean
- `photoUrl` - computed: URL аватарки или null

**Роутинг:**
- `/profile` -> ProfileView
- `/section-2` -> PlaceholderView (будущий раздел)
- `/section-3` -> PlaceholderView (будущий раздел)

## Нижний таб-бар (BottomTabBar)

4 вкладки на красном градиентном фоне:
1. Главная (домик) -> `/`
2. Раздел 2 (квадратик, placeholder) -> `/section-2`
3. Раздел 3 (квадратик, placeholder) -> `/section-3`
4. Профиль (человечек) -> `/profile`

Активная вкладка подсвечивается белым + точка-индикатор снизу.

Корзина НЕ в таб-баре - остается всплывающей кнопкой на главной странице.

Таб-бар скрывается на:
- `/admin/*` (админка)
- `/checkout` (оформление заказа)

Подключен в `App.vue` через computed `showTabBar`.

## Страница профиля (ProfileView)

Структура:
- Аватарка (64px, круглая) + имя/фамилия + @username
- Placeholder бонусной системы (красная карточка с `id="bonus-system-slot"`)
- Кнопка "Наш телеграм канал"

Данные берутся из:
1. `window.Telegram?.WebApp?.initDataUnsafe?.user` - id, first_name, last_name, username (без фото)
2. `GET /api/customer/me` - полный профиль с аватаркой из серверного кеша

Если Telegram недоступен (не Mini App) - показывается заглушка "Пользователь".

## Важные паттерны

### Аватарка из Telegram

`initDataUnsafe.user` НЕ содержит фото. Для аватарки нужен серверный вызов:

```javascript
// server/routes/public.js
const chat = await fetchTelegramChat(telegramId);
if (chat?.photo?.big_file_id) {
  const fileResp = await fetch(
    `https://api.telegram.org/bot${TOKEN}/getFile?file_id=${chat.photo.big_file_id}`
  );
  const fileData = await fileResp.json();
  photoUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileData.result.file_path}`;
}
```

Кеш 24 часа в поле `photo_updated_at`. Если Bot API недоступен - используется старый кеш.

### Fallback данных пользователя

Store `user.ts` использует двухуровневый fallback:
1. Пытается загрузить с сервера (`/api/customer/me`)
2. Если ошибка - берет данные из `initDataUnsafe.user` (без фото и статистики)

```typescript
// stores/user.ts
catch (e) {
  // Fallback to Telegram data
  if (tgUser) {
    profile.value = {
      ...tgUser fields,
      photoUrl: null,  // Нет фото без сервера
      totalOrders: 0,
    }
  }
}
```

### Padding для таб-бара

Страницы с таб-баром должны иметь нижний отступ:

```css
padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px) + 16px);
```

Это уже сделано в ProfileView и PlaceholderView. При создании новых страниц - не забывать.

## Интеграция с блоком D (Бонусная система)

В ProfileView есть placeholder:

```html
<div id="bonus-system-slot" class="bonus-placeholder">
  <!-- Блок D: Бонусная система -->
</div>
```

Блок D должен заменить содержимое этого div компонентом бонусной системы с табами "Жидкости / Одноразки / Устройства" и шкалой прогресса штампов.

API для данных пользователя: `GET /api/customer/me?telegram_id=XXX`

## Файлы системы

```
server/
├── migrations/add_customer_photo.js  # Миграция: photo_url, photo_updated_at
├── routes/public.js                  # GET /api/customer/me
└── db.js                            # Подключение миграции

frontend/src/
├── components/
│   └── BottomTabBar.vue             # Нижний таб-бар
├── views/
│   ├── ProfileView.vue              # Личный кабинет
│   └── PlaceholderView.vue          # Заглушка будущих разделов
├── stores/user.ts                   # Store пользователя
├── router/index.ts                  # Роуты /profile, /section-2, /section-3
└── App.vue                          # Подключение BottomTabBar
```
