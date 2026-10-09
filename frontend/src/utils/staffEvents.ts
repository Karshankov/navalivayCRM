/**
 * Подписи системных событий сотрудника.
 *
 * Раньше таких словаря было два, с одинаковым именем и разным набором ключей:
 * в сторе не хватало отмены перемещения, и она показывалась в ленте как
 * «Розница → Склад» без единого слова о том, что произошло.
 */
export const STAFF_EVENT_LABELS: Record<string, string> = {
  order_assembled: "Заказ собран",
  order_issued: "Заказ выдан",
  procurement_created: "Создана закупка",
  procurement_accepted: "Закупка оприходована",
  transfer_created: "Создано перемещение",
  transfer_accepted: "Перемещение принято",
  transfer_cancelled: "Перемещение отменено",
  task_approved: "Задача принята",
};

export function staffEventLabel(eventType: string, fallback = "") {
  return STAFF_EVENT_LABELS[eventType] || fallback || eventType;
}
