/**
 * Тексты для тостов и плашек по итогу авто-уведомления клиенту.
 *
 * Контракт `AutoNotifyResult` соответствует тому, что бэкенд возвращает в
 * ответе PATCH /orders/:id и POST /orders/:id/issue (см. server/utils/auto-notify.js):
 *   - sent=true              → отправили, telegram_message_id может быть
 *   - skipped=true + reason  → намеренно не слали (нет коннекта, шаблон выкл.,
 *                              клиент не верифицирован, статус не сменился)
 *   - sent=false без skipped → попытка была, отправка упала (Telegram отверг,
 *                              или userbot вернул ambiguous)
 *
 * Для GET /api/admin/crm/orders формат другой ({status, error, via}) — там
 * описание уже подставлено бэкендом через describeAutoNotifyReason.
 */

export type AutoNotifyResult = {
  sent?: boolean
  skipped?: boolean
  pending?: boolean
  reason?: string
  event?: string
  via?: string | null
  telegram_message_id?: number | null
} | null | undefined

export type ToastKind = 'success' | 'error' | 'info'

export type ToastPayload = {
  kind: ToastKind
  message: string
}

/**
 * Тост по итогу PATCH/issue ответа. `actionDescription` — короткое описание
 * действия, например `Заказ #1234: собран`. Без кавычек и слова «статус» —
 * Костя 10.05.2026 хотел минимальный визуальный шум.
 */
export function buildAutoNotifyToast(
  notify: AutoNotifyResult,
  options: { actionDescription: string },
): ToastPayload {
  const base = options.actionDescription
  if (!notify) {
    return { kind: 'info', message: base }
  }
  if (notify.pending && notify.reason !== 'retry_scheduled') {
    return {
      kind: 'info',
      message: `${base}. Уведомление клиенту отправляется в фоне.`,
    }
  }
  if (notify.pending || notify.reason === 'retry_scheduled') {
    return {
      kind: 'info',
      message: `${base}. Отправка отложена, уведомление уйдёт, когда восстановится связь с Telegram.`,
    }
  }
  if (notify.sent) {
    // «Отправили», не «дошло» — userbot подтверждает только успех отправки,
    // факт прочтения клиентом мы не знаем.
    return { kind: 'success', message: `${base}. Клиенту отправили.` }
  }
  if (notify.skipped) {
    // Этот ответ возможен только в старом потоке с выключенной обязательной
    // авторизацией. Авторизованным клиентам возраст заказа не мешает.
    if (notify.reason === 'new_customer_no_dialog') {
      return {
        kind: 'info',
        message: `${base}. Клиент ещё не прошёл авторизацию.`,
      }
    }
    const tail = describeSkipReason(notify.reason)
    if (!tail) return { kind: 'info', message: base }
    return { kind: 'error', message: `${base}. ${tail}` }
  }
  return {
    kind: 'error',
    message: `${base}. Клиенту не написали — ${describeSendError(notify.reason)}.`,
  }
}

export function describeSkipReason(reason: string | undefined): string {
  switch (reason) {
    case 'reactivation_skipped':
    case 'status_unchanged':
    case 'no_event_for_status':
      return ''
    case 'customer_blocked':
      return 'Клиент заблокирован, уведомления ему не уходят.'
    case 'customer_not_verified':
      return 'Telegram клиента ещё не подтверждён.'
    case 'customer_has_no_telegram_id':
      return 'У клиента не привязан Telegram.'
    case 'order_has_no_customer':
      return 'К заказу не привязан клиент.'
    case 'template_inactive_or_missing':
      return 'Шаблон сообщения выключен в настройках бота.'
    case 'template_empty':
      return 'Шаблон пустой. Заполните его в настройках бота.'
    case 'userbot_unavailable':
    case 'userbot_unreachable':
    case 'retry_scheduled':
      return 'Нет связи с Telegram. Уведомление в очереди.'
    case 'userbot_ambiguous':
      return 'Не дождались ответа от Telegram. Проверьте чат с клиентом перед повторной отправкой.'
    case 'new_customer_no_dialog':
      return ''
    default:
      return reason ? `Не отправили: ${reason}.` : ''
  }
}

export function describeSendError(reason: string | undefined): string {
  if (!reason) return 'Telegram отклонил сообщение'
  if (reason === 'send_failed') return 'Telegram отклонил сообщение'
  if (reason === 'notify_internal_error') return 'внутренняя ошибка'
  if (reason === 'bot_token_missing') return 'бот не настроен'
  if (reason === 'invalid_payload') return 'внутренняя ошибка'
  if (reason.includes('BUSINESS_PEER_USAGE_MISSING'))
    return 'клиент отключил бота в своём чате'
  if (reason.includes('PEER_ID_INVALID')) return 'клиент ни разу не писал в чат'
  if (reason.includes('USER_IS_BLOCKED') || reason.includes('user is blocked'))
    return 'клиент заблокировал бота'
  // GramJS «Could not find the input entity» — userbot не нашёл клиента в
  // своём кэше диалогов и не смог отрезолвить через @username (либо его нет,
  // либо аккаунт удалён). Показываем по-человечески.
  if (reason.includes('Could not find the input entity'))
    return 'у userbot нет диалога с клиентом, напишите ему первым вручную'
  if (reason.includes('FLOOD_WAIT'))
    return 'Telegram попросил подождать, попробуйте позже'
  if (reason.includes('AUTH_KEY'))
    return 'userbot разлогинился, нужна повторная авторизация'
  // Default: читаемое сообщение вместо сырой техники в тосте у Кости.
  // Сам reason остаётся в console.error/логах для разработчика.
  return 'Telegram отклонил сообщение'
}
