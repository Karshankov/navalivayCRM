import { defineStore } from "pinia";
import { ref, computed, shallowRef } from "vue";
import { isKanbanBoardOrder } from "@/utils/crm-kanban-board";
import { STAFF_EVENT_LABELS } from "@/utils/staffEvents";

const API_BASE = "/api/admin/crm";
let inMemoryStaffToken = "";
let inMemoryShiftToken = "";
let staffUnauthorizedHandler: (() => void) | null = null;

export type StaffRole = "manager" | "employee";

export interface Employee {
  id: string;
  username?: string;
  first_name: string;
  last_name: string | null;
  position: string | null;
  active: number | boolean;
  created_at?: string;
  updated_at?: string;
  role?: StaffRole;
  responsibilities?: string | string[] | null;
  color?: string | null;
  avatar_url?: string | null;
  pin_configured?: boolean;
  telegram_id?: string | null;
  telegram_username?: string | null;
}

export interface StaffIdentity {
  employee: Employee;
  role: StaffRole;
  permissions?: string[];
}

export interface StaffShift {
  id: string;
  version: number;
  employee_id: string;
  employee_name?: string | null;
  employee?: Partial<Employee> | null;
  employee_avatar?: string | null;
  employee_color?: string | null;
  status: "active" | "open" | "closed" | "auto_closed";
  business_date?: string;
  planned_start_at?: string;
  planned_end_at?: string;
  started_at?: string;
  ended_at?: string | null;
  opened_at?: string;
  closed_at?: string | null;
  worked_minutes?: number | null;
  note?: string | null;
  correction_reason?: string | null;
  corrected_at?: string | null;
  close_reason?: string | null;
}

export interface StaffShiftCandidate {
  id: string;
  first_name: string;
  last_name?: string | null;
  position?: string | null;
  color?: string | null;
  avatar?: string | null;
  avatar_url?: string | null;
}

export interface StaffActivity {
  id: string | number;
  type: string;
  title: string;
  description?: string | null;
  occurred_at: string;
  value?: number | null;
  amount?: number | null;
  source?: "system" | "manual" | string;
  tone?: "positive" | "negative" | "neutral" | string;
}

export interface StaffAnalytics {
  employee?: Employee;
  month?: string;
  period?: {
    type: "day" | "month" | "year" | "custom";
    start: string;
    end: string;
  };
  worked_minutes?: number;
  shifts_count?: number;
  tasks_completed?: number;
  orders_assembled?: number;
  orders_issued?: number;
  orders_amount?: number;
  assembled_orders?: number;
  issued_orders?: number;
  issued_revenue?: number;
  issued_profit?: number;
  procurements_created?: number;
  procurements_completed?: number;
  transfers_created?: number;
  transfers_completed?: number;
  efficiency_percent?: number | null;
  estimated_salary?: number | null;
  worked_hours?: number;
  events_total?: number;
  event_counts?: Array<{
    event_type: string;
    polarity?: string | null;
    count: number;
  }>;
  metrics?: Record<string, number>;
  shifts?: StaffShift[];
  marks?: StaffMark[];
  mark_counts?: {
    positive?: number;
    negative?: number;
    manual_positive?: number;
    manual_negative?: number;
    system_positive?: number;
  };
  tasks?: Record<string, number>;
  expected_salary?: Record<string, any> | null;
  activities?: StaffActivity[];
  daily_activity?: Array<{
    date: string;
    count?: number;
    worked_minutes?: number;
    color?: string | null;
    events?: Record<string, number>;
    /** Плюсы и минусы за день, отдельно от журнала действий. */
    marks?: {
      manual_positive?: number;
      manual_negative?: number;
      system_positive?: number;
      positive?: number;
      negative?: number;
    };
  }>;
}

export type StaffTaskStatus =
  | "open"
  | "claimed"
  | "submitted"
  | "approved"
  | "cancelled";

export interface StaffTask {
  id: string;
  title: string;
  description?: string | null;
  status: StaffTaskStatus;
  priority?: "low" | "normal" | "high" | string;
  assignee_employee_id?: string | null;
  assignee_name?: string | null;
  assignee_employee_name_snapshot?: string | null;
  target_employee_id?: string | null;
  target_employee_name_snapshot?: string | null;
  created_by_name?: string | null;
  created_by_name_snapshot?: string | null;
  due_at?: string | null;
  result_note?: string | null;
  claimed_at?: string | null;
  submitted_at?: string | null;
  completed_at?: string | null;
  approved_at?: string | null;
  cancelled_at?: string | null;
  created_at?: string;
}

export interface StaffSalary {
  id?: string;
  employee_id: string;
  employee_name?: string | null;
  month: string;
  worked_minutes?: number;
  shifts_count?: number;
  tasks_completed?: number;
  base_amount?: number;
  bonus_amount?: number;
  penalty_amount?: number;
  estimated_amount?: number;
  final_amount?: number | null;
  amount?: number | null;
  amount_minor?: number | null;
  currency?: string | null;
  employee_name_snapshot?: string | null;
  status?: "draft" | "approved" | "paid" | string;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StaffMark {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  kind: "positive" | "negative";
  mark_type?: "positive" | "negative";
  title: string;
  description?: string | null;
  occurred_at: string;
  happened_at?: string;
  source?: "manual" | "system" | string;
  created_by_name?: string | null;
  voided_at?: string | null;
  deleted_at?: string | null;
  void_reason?: string | null;
  current_version: number;
}

export interface StaffHistoryVersion {
  id?: string;
  version: number;
  action?: string;
  title?: string;
  description?: string | null;
  mark_type?: "positive" | "negative";
  happened_at?: string;
  amount_minor?: number;
  currency?: string;
  status?: string;
  note?: string | null;
  reason?: string | null;
  changed_by_name_snapshot?: string | null;
  created_at?: string;
}

export interface StaffNotification {
  id: string;
  title: string;
  message?: string | null;
  type?: string;
  created_at: string;
  read_at?: string | null;
  task_id?: string | null;
}

export interface StaffNotificationTemplate {
  event_type: string;
  event_group: string;
  title: string;
  placeholders: string[];
  default_text: string;
  text: string;
  customized: boolean;
}

export interface StaffNotificationsPayload {
  settings?: Array<Record<string, unknown>>;
  recipients?: Array<Record<string, unknown>>;
  outbox?: Array<Record<string, unknown>>;
  templates?: StaffNotificationTemplate[];
}

export interface Customer {
  id: string;
  telegram_id: string | null;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  first_visit_at: string;
  last_visit_at: string | null;
  last_order_at: string | null;
  total_orders: number;
  total_spent: number;
  card_payment?: {
    enabled: boolean;
    max_order_minor: number;
    cooldown_until: string | null;
    card_available: boolean;
  } | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  blocked_count?: number;
  orders?: Order[];
  blocks?: CustomerBlock[];
  visitLogs?: VisitLog[];
  recent_visits?: VisitLog[];
}

export interface CustomerBlock {
  id: string;
  customer_id: string;
  block_type: string;
  reason: string | null;
  blocked_at: string;
  blocked_by: string | null;
  active: number;
}

/**
 * Активный блок реального клиента (есть в customers).
 * Возвращается из GET /api/admin/crm/blocks как `active[]`.
 */
export interface ActiveCustomerBlock {
  id: string;
  kind: "active";
  customer_id: string;
  block_until: string | null; // SQLite UTC datetime, null = бессрочно
  reason: string | null;
  blocked_at: string;
  blocked_by: string | null;
  unblocked_at: string | null;
  unblocked_by: string | null;
  unblock_reason: string | null;
  customer?: {
    telegram_id: string | null;
    telegram_username: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  };
}

/**
 * Pending-блок: превентивный бан по @username, клиент ещё не появлялся в БД.
 * Активируется автоматически при первом upsertPublicCustomer.
 */
export interface PendingCustomerBlock {
  id: number;
  kind: "pending";
  telegram_username: string;
  block_until: string | null;
  reason: string | null;
  blocked_at: string;
  blocked_by: string | null;
}

export interface CustomerBlockDuration {
  unit: "minutes" | "hours" | "days" | "forever";
  value?: number;
}

export interface CreateCustomerBlockPayload {
  customer_id?: string;
  telegram_username?: string;
  reason?: string | null;
  duration: CustomerBlockDuration;
}

export interface Order {
  id: string;
  order_number: number;
  customer_id: string | null;
  employee_id: string | null;
  status: "new" | "in_progress" | "completed" | "delivered" | "cancelled";
  delivery_type: "pickup" | "delivery";
  delivery_address: string | null;
  total_amount: number;
  discount_amount: number;
  discount_percent: number;
  final_amount: number;
  profit: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  pickup_cell_number?: number | null;
  pickup_cell_assignment_id?: string | null;
  pickup_cell_assigned_at?: string | null;
  payment_type?: "cash" | "card" | null;
  customer_telegram_id?: string | null;
  customer_card_payment_enabled?: number;
  card_amount_minor?: number;
  cash_due_minor?: number;
  payment_account_id?: string | null;
  paid_amount?: number | null;
  paid_at?: string | null;
  payment_notes?: string | null;
  telegram_username?: string;
  customer_name?: string;
  phone?: string | null;
  needs_manager_action?: number;
  manager_action_type?: 'modified' | 'cancelled_by_customer' | null;
  manager_action_note?: string | null;
  promo_code_id?: string | null;
  promo_code_text?: string | null;
  promo_has_gift?: number;
  promo_manager_description?: string | null;
  promo_customer_description?: string | null;
  is_wholesale?: number;
  wholesale_tier_id?: string | null;
  wholesale_tier_label?: string | null;
  wholesale_min_amount?: number | null;
  items?: OrderItem[];
  // Свод последней авто-отправки уведомления клиенту (sent/failed). null
  // если для этого заказа auto-notify ещё не запускался. Используется для
  // подсветки красной рамкой в карточке заказа когда сообщение не дошло.
  auto_notification?: {
    status: 'sent' | 'failed' | 'pending_retry';
    error?: string | null;
    via?: string | null;
    via_attempt?: number | null;
    warn?: string | null;
    next_retry_at?: string | null;
  } | null;
  // true = у клиента уже были завершённые заказы (постоянный), false/undefined = первый заказ
  is_returning_customer?: boolean;
  is_blocked?: boolean;
  has_userbot_access?: boolean;
  /** Внутренняя заметка менеджера о клиенте (customers.notes). */
  customer_notes?: string | null;
  referral?: {
    invitee_customer_id: string;
    inviter_customer_id: string | null;
    inviter_username: string | null;
    inviter_first_name: string | null;
    inviter_last_name: string | null;
    inviter_invite_ban_id: string | null;
    inviter_is_invite_banned: number;
  } | null;
  access_authorization?: {
    customer_id: string;
    access_authorization_source: string | null;
    access_authorized_by: string | null;
  } | null;
}

export interface PickupCell {
  number: number;
  occupied: boolean;
  assignment_id?: string;
  assigned_at?: string;
  order_id?: string;
  order_number?: number;
  status?: Order["status"];
  customer_name?: string;
}

export interface PickupCellsState {
  capacity: number;
  occupied: number;
  available: number;
  cells: PickupCell[];
}

export interface PendingCustomerNote {
  id: number;
  kind: "pending";
  telegram_username: string;
  notes: string;
  created_by: string | null;
  created_at: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id?: string | null;
  product_title: string;
  product_description?: string | null;
  group_name?: string | null;
  base_product_id?: string | null;
  base_product_title?: string | null;
  variant_name?: string | null;
  quantity: number;
  price_per_unit: number;
  // Снимок каталожной цены на момент оформления: сколько товар стоил без
  // акции и сколько с него срезала акция. У заказов старше миграции пусто.
  base_price_per_unit?: number | null;
  catalog_discount_per_unit?: number | null;
  cost_per_unit: number;
  manual_discount_amount?: number;
  loyalty_discount_amount?: number;
  loyalty_units_applied?: number;
  discount_amount: number;
  total_price: number;
  total_cost: number;
}

export interface CrmLoyaltyMapping {
  id: string;
  loyalty_category_id: string;
  category_id: string | null;
  group_id: string | null;
  created_at: string;
}

export interface CrmLoyaltyCategory {
  id: string;
  key: string;
  title: string;
  description: string | null;
  threshold: number;
  discount_amount: number;
  sort_order: number;
  active: number;
  mappings: CrmLoyaltyMapping[];
}

export interface CrmLoyaltyCustomer {
  id: string;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  last_activity_at: string | null;
  categories: Array<{
    key: string;
    balance: number;
    available_bonus_count: number;
  }>;
}

export interface CrmLoyaltyLedgerEntry {
  id: string;
  customer_id: string;
  loyalty_category_id: string;
  order_id: string | null;
  order_item_id: string | null;
  delta: number;
  balance_after: number;
  reason: string;
  created_at: string;
  category_key: string;
  category_title: string;
}

export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  customer_description?: string | null;
  manager_description?: string | null;
  has_gift?: number;
  is_wheel_template?: number;
  is_wheel_generated?: number;
  wheel_owner_customer_id?: string | null;
  discount_type: 'fixed' | 'percent';
  discount_value: number;
  min_order_amount: number;
  max_uses: number;
  current_uses: number;
  valid_from_date?: string | null;
  duration_days?: number | null;
  effective_valid_until_date?: string | null;
  valid_from: string | null;
  valid_until: string | null;
  active: number;
  created_at: string;
}

export interface PromoUsage {
  id: string;
  promo_code_id: string;
  order_id: string;
  customer_id: string | null;
  discount_applied: number;
  used_at: string;
  order_number?: number;
  order_amount?: number;
  customer_name?: string;
  telegram_username?: string;
}

export interface Procurement {
  id: string;
  procurement_number: number;
  employee_id: string | null;
  supplier_name: string | null;
  total_amount: number;
  status: "draft" | "completed";
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  employee_name?: string;
  created_by_employee_id?: string | null;
  created_by_name?: string | null;
  accepted_by_employee_id?: string | null;
  accepted_by_name?: string | null;
  expense_transaction_id?: string | null;
  items?: ProcurementItem[];
}

export interface ProcurementItem {
  id: string;
  procurement_id: string;
  product_id: string;
  product_title: string;
  product_image?: string | null;
  group_name?: string | null;
  variant_id?: string | null;
  variant_name?: string | null;
  variant_stock?: number | null;
  variant_warehouse_stock?: number | null;
  quantity: number;
  warehouse_quantity?: number;
  cost_per_unit: number;
  total_cost: number;
  stock?: number;
  warehouse_stock?: number;
  base_total_stock?: number;
  product_cost_price?: number;
  min_stock?: number;
}

export interface TotalControlItem {
  id: string;
  productId: string;
  variantId: string | null;
  label: string;
  stock: number;
}

export interface TotalControlGroup {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  hasCoverImage: boolean;
  totalStock: number;
  itemCount: number;
  items: TotalControlItem[];
}

export interface WriteOff {
  id: string;
  writeoff_number: number;
  employee_id: string | null;
  reason: string;
  notes: string | null;
  created_at: string;
  employee_name?: string;
  items?: WriteOffItem[];
}

export interface WriteOffItem {
  id: string;
  writeoff_id: string;
  product_id: string;
  variant_id?: string | null;
  product_title: string;
  group_name?: string | null;
  variant_name?: string | null;
  quantity: number;
  cost_per_unit: number;
  total_cost: number;
  stock?: number;
}

export interface CrmProductSummary {
  id: string;
  productId?: string; // Для вариантов - ID базового товара
  title: string;
  description?: string | null; // Описание товара (расшифровка вкуса и т.п.)
  priceRub: number;
  costPrice: number;
  stock: number;
  warehouseStock?: number;
  companyStock?: number;
  minStock: number;
  categoryId: string;
  categoryName?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  isVariant?: boolean; // Это вариант товара
  variantName?: string | null; // Название варианта (цвет)
  imageUrl?: string | null; // URL изображения товара или линейки
  image?: string | null; // Итоговое фото (товар > линейка > категория)
}

export interface CashAccount {
  id: string;
  name: string;
  balance: number;
  is_default: number;
  active: number;
  created_at: string;
}

export interface CashTransaction {
  id: string;
  account_id: string;
  account_name: string;
  type: "income" | "expense";
  amount: number;
  description: string | null;
  order_id: string | null;
  pos_sale_id?: string | null;
  pos_sale_number?: number | null;
  employee_id: string | null;
  employee_name: string | null;
  created_at: string;
}

export interface CardAccountProfile {
  source: "linked" | "pending" | "new";
  telegram_id: string | null;
  telegram_username: string | null;
  enabled: boolean;
  monthly_limit_minor: number;
  max_order_minor: number;
  tariff_id: string | null;
  tariff_title: string | null;
  cooldown_started_at: string | null;
  cooldown_until: string | null;
  cooldown_days_left: number;
  cooldown_days: number;
  last_issued_at: string | null;
}

export interface CardPaymentAdminSnapshot {
  limits: {
    business_date: string;
    month_key: string;
    monthly_limit_minor: number;
    spent_month_minor: number;
    remaining_month_minor: number;
    base_daily_limit_minor: number;
    daily_increase_minor: number;
    daily_limit_minor: number;
    spent_today_minor: number;
    reserved_minor: number;
    committed_today_minor: number;
    remaining_today_minor: number;
    can_start_order: boolean;
    exceeded_today_minor: number;
  };
  months?: Array<{
    month_key: string;
    limit_minor: number;
    updated_at: string | null;
    is_current: boolean;
  }>;
  accounts: Array<{
    telegram_id: string;
    telegram_username: string | null;
    enabled: number;
    max_order_minor: number;
    monthly_limit_minor: number;
    cooldown_started_at: string | null;
    last_issued_at: string | null;
    tariff_id: string | null;
    tariff_title: string | null;
    tariff_monthly_limit_minor: number | null;
    tariff_per_order_limit_minor: number | null;
    tariff_transition_cost_text: string | null;
  }>;
  pending_accounts: Array<{
    telegram_username: string;
    enabled: number;
    max_order_minor: number;
    monthly_limit_minor: number;
  }>;
  tariffs: Array<{
    id: string;
    title: string;
    limit_minor: number;
    monthly_limit_minor: number | null;
    per_order_limit_minor: number | null;
    transition_cost_text: string | null;
    position: number;
    active: number;
  }>;
  requests: Array<{
    id: string;
    telegram_id: string;
    telegram_username: string | null;
    tariff_id: string | null;
    tariff_title: string | null;
    current_limit_minor: number;
    requested_limit_minor: number;
    tariff_transition_cost_text: string | null;
    tariff_monthly_limit_minor: number | null;
    tariff_per_order_limit_minor: number | null;
    status: "new" | "processed" | "rejected";
    created_at: string;
    resolved_by: string | null;
    resolution_note: string | null;
  }>;
  operations: Array<{
    id: string;
    operation_type: "manual" | "order";
    operation_status: string;
    order_id: string | null;
    order_number: number | null;
    customer_telegram_id: string | null;
    amount_minor: number;
    business_date: string;
    note: string | null;
    actor_username: string | null;
    created_at: string;
    issued_at: string | null;
    reversed_at: string | null;
  }>;
}

export interface CashPacingMonth {
  id: string;
  month_key: string;
  title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashPacingItem {
  id: string;
  month_id: string;
  entry_type: "base" | "addition";
  title: string;
  quantity: number;
  cost_with_vat: number;
  markup_percent: number;
  effective_from: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  retail_unit: number;
  retail_total_precise: number;
  retail_total: number;
}

export interface CashPacingDailyFact {
  id: string;
  month_id: string;
  fact_date: string;
  actual_amount: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashPacingDayPlan {
  date: string;
  active_limit: number;
  recommended_amount: number;
  actual_amount: number | null;
  deviation_amount: number | null;
  cumulative_actual: number;
  remaining_after_day: number;
  has_fact: boolean;
}

export interface CashPacingSummary {
  month_key: string;
  total_limit: number;
  actual_total: number;
  remaining_total: number;
  remaining_days: number;
  recommendation_date: string | null;
  recommendation_amount: number | null;
  active_limit_on_recommendation_date: number;
  days_in_month: number;
  days_with_facts: number;
  completion_percent: number;
  overrun_amount: number;
  month_status: "past" | "current" | "future";
}

export interface CashPacingMonthListItem {
  month: CashPacingMonth;
  summary: CashPacingSummary;
}

export interface CashPacingMonthDetail {
  month: CashPacingMonth;
  items: CashPacingItem[];
  daily_facts: CashPacingDailyFact[];
  daily_plan: CashPacingDayPlan[];
  summary: CashPacingSummary;
}

export interface PosSale {
  id: string;
  sale_number: number;
  transaction_id?: string | null;
  product_name: string;
  price: number;
  cost_price: number | null;
  profit: number | null;
  status: 'completed' | 'pending';
  notes: string | null;
  employee_id: string | null;
  employee_name?: string | null;
  // Привязанный клиент (после миграции add_pos_customer_link).
  // Null если чек анонимный.
  customer_id?: string | null;
  // Поля приходят из LEFT JOIN customers в GET /api/admin/pos/pending —
  // используются для отображения клиента в списке отложенных чеков.
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_phone?: string | null;
  customer_telegram_username?: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface VisitLog {
  id: string;
  customer_id: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  page_path: string | null;
  action: string | null;
  visited_at: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  type: string;
  active: number;
  created_at: string;
  updated_at: string | null;
}

export interface CustomerFeedback {
  id: string;
  customer_id: string;
  telegram_username: string | null;
  customer_name: string | null;
  reason: string;
  processed_at: string;
  created_at: string;
}

export interface DashboardStats {
  period: string;
  stats: {
    totalSales: number;
    revenue: number;
    profit: number;
    averageCheck: number;
    uniqueCustomers: number;
  };
  topProducts: Array<{
    group_id: string;
    group_name: string;
    has_cover_image: boolean;
    total_quantity: number;
    total_revenue: number;
    total_profit: number;
  }>;
  topProductsHasMore?: boolean;
  ordersByStatus: Array<{
    status: string;
    count: number;
  }>;
  deliveryStats?: {
    deliveries: number;
    profit: number;
  };
  pickupStats?: {
    pickups: number;
    profit: number;
  };
}

/**
 * Линейка с заканчивающимся остатком — для плашки в «Закупки».
 * Бэк: GET /api/admin/crm/low-stock-groups → { items, reasons }.
 *
 * Полное cover_image (может быть base64 на сотни KB) НЕ передаётся в этом
 * payload — приходит только `hasCoverImage`. Сама картинка лениво подгружается
 * в компоненте через GET /api/admin/category-groups/:id/image.
 */
export interface LowStockGroup {
  id: string;
  name: string;
  slug: string | null;
  hasCoverImage: boolean;
  threshold: number | null;
  totalStock: number;
  categoryId: string | null;
  categoryName: string | null;
}

export interface LowStockFlavor {
  id: string;
  name: string;
  stock: number;
  warehouse_stock?: number;
}

/**
 * Причина паузы линейки — соответствует PAUSE_REASONS на бэке
 * (server/utils/low-stock-groups.js).
 */
export type LowStockPauseReason = "short" | "no_supply" | "not_produced";

export interface LowStockPauseConfig {
  label: string;
  days: number;
}

/**
 * Результат авто-отправки уведомления при смене статуса заказа.
 * Возвращается из PATCH /api/admin/crm/orders/:id рядом с обновлённым заказом.
 *  - sent=true       → клиенту улетело сообщение
 *  - sent=false + skipped=true → не отправляли намеренно (например, клиент не верифицирован)
 *  - sent=false без skipped → попытка была, но Telegram отказал
 */
export interface AutoNotificationResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  event?: string;
  telegram_message_id?: number | null;
}

/**
 * Маркер ошибки авторизации. Бросается из fetchAPI при 401.
 * Caller'ы могут проверить через `error instanceof UnauthorizedError`.
 * Поддерживает `cause` — присваивается вручную, потому что текущий
 * tsconfig.lib не тянет ES2022-сигнатуру конструктора Error(options).
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized", options?: { cause?: unknown }) {
    super(message);
    this.name = "UnauthorizedError";
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class StaffApiError extends Error {
  code?: string;
  status?: number;
  outcomeUnknown?: boolean;

  constructor(
    message: string,
    options: { code?: string; status?: number; outcomeUnknown?: boolean } = {},
  ) {
    super(message);
    this.name = "StaffApiError";
    this.code = options.code;
    this.status = options.status;
    this.outcomeUnknown = options.outcomeUnknown;
  }
}

function localStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

function staffHeaders(
  includeStaff = true,
  includeShift = false,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const adminToken = localStorageValue("admin_token");
  const staffToken = includeStaff ? inMemoryStaffToken : "";
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  if (staffToken) headers["X-Staff-Token"] = staffToken;
  if (includeShift && inMemoryShiftToken) {
    headers["X-Shift-Token"] = inMemoryShiftToken;
  }
  return headers;
}

function clearStoredStaffAccess() {
  inMemoryStaffToken = "";
}

function clearStoredShiftToken() {
  inMemoryShiftToken = "";
}

export function getInMemoryStaffHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (inMemoryStaffToken) headers["X-Staff-Token"] = inMemoryStaffToken;
  return headers;
}

async function staffFetchAPI<T>(
  endpoint: string,
  options: RequestInit = {},
  config: { includeStaff?: boolean; includeShift?: boolean } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...staffHeaders(
          config.includeStaff !== false,
          config.includeShift === true,
        ),
        ...options.headers,
      },
    });
  } catch (error) {
    throw new StaffApiError(
      "Нет связи с сервером. Проверьте интернет и повторите попытку.",
      { outcomeUnknown: true },
    );
  }

  const payload = await response
    .json()
    .catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const record = payload as Record<string, unknown>;
    const code = String(record.error || record.code || "request_failed");
    if (response.status === 401 && code === "unauthorized") {
      // Просрочен именно основной вход CRM. Допуск по ПИН больше нельзя
      // считать принадлежащим текущему пользователю, поэтому снимаем оба
      // состояния. Ошибки проверки основного пароля (`invalid_admin_password`)
      // сюда намеренно не попадают.
      clearStoredStaffAccess();
      staffUnauthorizedHandler?.();
      try {
        const { useAdminStore } = await import("./admin");
        await useAdminStore().logout();
      } catch (logoutError) {
        console.warn("[CRM] Failed to clear admin state on staff 401:", logoutError);
      }
      throw new UnauthorizedError();
    }
    const knownMessages: Record<string, string> = {
      invalid_staff_credentials: "Неверный ПИН",
      invalid_pin_format: "ПИН должен состоять из четырёх цифр",
      staff_auth_locked: "Слишком много попыток. Попробуйте позже",
      staff_access_expired: "Время доступа истекло. Введите ПИН ещё раз",
      invalid_staff_token: "Время доступа истекло. Введите ПИН ещё раз",
      manager_access_required: "Действие доступно только руководителю",
      shift_required: "Сначала откройте смену",
      shift_conflict: "Смена уже открыта у другого сотрудника",
      shift_owned_by_another_employee:
        "Сейчас открыта смена другого сотрудника",
      shift_not_found: "Открытая смена не найдена",
      shift_open_outside_hours: "Смену можно открыть только в рабочее время",
      shift_close_reason_required: "Укажите причину закрытия смены",
      reason_required: "Укажите причину",
      idempotency_key_required: "Не удалось защитить действие от повтора",
      pin_already_in_use: "Этот ПИН уже используется",
      task_claim_conflict: "Задачу уже забрал другой сотрудник",
      task_submit_conflict: "Состояние задачи изменилось. Обновите список",
      task_approve_conflict: "Состояние задачи изменилось. Обновите список",
      task_cancel_conflict: "Задачу уже нельзя отменить",
      task_release_conflict: "Задачу уже нельзя освободить",
      staff_tracking_disabled: "Учёт сотрудников пока выключен",
      invalid_admin_password: "Неверный основной пароль",
      manager_already_bootstrapped: "Руководитель уже настроен",
      active_manager_required: "Сначала настройте активного руководителя",
      staff_pins_required:
        "Сначала задайте ПИН каждому действующему сотруднику",
      employee_not_found: "Сотрудник не найден. Обновите список",
      employee_inactive: "Сотрудник уволен. Выберите другого сотрудника",
      employee_scope_required: "Выберите сотрудника",
      staff_employee_required: "Выберите сотрудника",
      username_already_in_use: "Это имя пользователя уже занято",
      invalid_username: "Проверьте имя пользователя Telegram",
      too_many_responsibilities:
        "Укажите не более 30 зон ответственности",
      invalid_responsibility:
        "Сократите описание зоны ответственности",
      first_name_required: "Укажите имя сотрудника",
      invalid_employee_avatar: "Выберите другое фото сотрудника",
      invalid_employee_color: "Выберите корректный цвет метки",
      invalid_employee_role: "Выберите роль сотрудника",
      last_active_manager_required:
        "Нельзя уволить или понизить последнего действующего руководителя",
      manager_recovery_target_required:
        "Выберите действующего руководителя",
      enabled_boolean_required: "Не удалось изменить настройку",
      active_shift_must_be_closed_first:
        "Сначала закройте открытую смену сотрудника",
      shift_not_active: "Смена уже закрыта. Обновите список",
      shift_period_conflict:
        "У сотрудника уже есть смена в это время",
      shift_version_required:
        "Смена уже изменилась. Обновите список",
      invalid_shift_period: "Проверьте начало и окончание смены",
      staff_actor_changed:
        "Выбранный сотрудник изменился. Подтвердите действие ещё раз",
      staff_actor_proof_expired:
        "Время подтверждения истекло. Введите ПИН ещё раз",
      invalid_month: "Выберите корректный месяц",
      invalid_salary_amount: "Укажите корректную сумму зарплаты",
      salary_currency_must_be_byn: "Зарплата указывается в BYN",
      salary_not_found:
        "Запись о зарплате не найдена. Обновите список",
      mark_not_found: "Отметка не найдена. Обновите список",
      mark_already_voided: "Отметка уже аннулирована",
      mark_conflict: "Отметка уже изменилась. Обновите список",
      mark_version_required:
        "Отметка уже изменилась. Обновите список",
      invalid_mark_type: "Выберите тип отметки",
      invalid_mark_date: "Проверьте дату отметки",
      invalid_event_date: "Проверьте дату события",
      task_not_found: "Задача не найдена. Обновите список",
      task_due_at_required: "Укажите срок задачи",
      invalid_task_due_at: "Проверьте срок задачи",
      task_target_not_supported:
        "Назначение этой задачи недоступно",
      invalid_notification_group: "Выберите тип сообщений",
      invalid_notification_setting:
        "Не удалось изменить настройку уведомлений",
      notification_group_not_found:
        "Настройка уведомлений не найдена. Обновите страницу",
      notification_recipient_not_found:
        "Получатель не найден. Обновите список",
      invalid_telegram_id: "Не удалось подтвердить Telegram-профиль",
      telegram_recipient_not_found: "Telegram-профиль не найден",
      telegram_recipient_ambiguous:
        "Найдено несколько профилей. Уточните имя пользователя",
      telegram_recipient_invalid: "Telegram-профиль недоступен",
      telegram_recipient_confirmation_mismatch:
        "Telegram-профиль изменился. Найдите его заново",
      notification_not_unknown:
        "Повтор для этого уведомления уже недоступен",
      internal_notifications_not_initialized:
        "Уведомления временно недоступны",
      idempotency_key_conflict:
        "Действие уже выполнялось с другими данными. Обновите страницу",
      idempotency_key_too_long: "Не удалось подготовить действие",
      staff_event_idempotency_conflict:
        "Действие уже выполнено. Обновите данные",
      invalid_analytics_period: "Выберите корректный период",
      invalid_analytics_range: "Проверьте даты периода",
      analytics_range_too_large: "Выберите более короткий период",
      invalid_analytics_year: "Выберите корректный год",
      invalid_date: "Проверьте дату",
    };
    const serverMessage = String(record.message || "").trim();
    const safeServerMessage =
      serverMessage && !/^[a-z0-9_.-]+$/i.test(serverMessage)
        ? serverMessage
        : "";
    const message = String(
      knownMessages[code] ||
        safeServerMessage ||
        "Не удалось выполнить действие. Проверьте данные и повторите",
    );
    if (
      code === "staff_access_expired" ||
      code === "invalid_staff_token"
    ) {
      clearStoredStaffAccess();
      staffUnauthorizedHandler?.();
    }
    throw new StaffApiError(message, { code, status: response.status });
  }
  return payload as T;
}

function listFromPayload<T>(
  payload: T[] | { items?: T[]; data?: T[] } | null | undefined,
  named?: T[],
): T[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(named)) return named;
  const wrapped = payload as { items?: T[]; data?: T[] } | null | undefined;
  if (Array.isArray(wrapped?.items)) return wrapped.items;
  if (Array.isArray(wrapped?.data)) return wrapped.data;
  return [];
}

function normalizeStaffTask(task: StaffTask): StaffTask {
  return {
    ...task,
    assignee_name:
      task.assignee_name || task.assignee_employee_name_snapshot || null,
    created_by_name:
      task.created_by_name || task.created_by_name_snapshot || null,
  };
}

function employeeActiveForStaff(employee: Employee) {
  return Boolean(Number(employee.active));
}

function clientIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const pendingMutationKeys = new Map<string, string>();

function pendingMutationKey(scope: string, payload: unknown) {
  const signature = `${scope}:${JSON.stringify(payload)}`;
  let key = pendingMutationKeys.get(signature);
  if (!key) {
    key = clientIdempotencyKey();
    pendingMutationKeys.set(signature, key);
    if (pendingMutationKeys.size > 100) {
      const oldest = pendingMutationKeys.keys().next().value;
      if (oldest) pendingMutationKeys.delete(oldest);
    }
  }
  return { key, signature };
}

function normalizeStaffSalary(salary: StaffSalary): StaffSalary {
  const amount =
    salary.final_amount ??
    salary.amount ??
    (salary.amount_minor == null ? null : Number(salary.amount_minor) / 100);
  return {
    ...salary,
    employee_name:
      salary.employee_name || salary.employee_name_snapshot || null,
    final_amount: amount,
  };
}

function normalizeStaffMark(mark: StaffMark): StaffMark {
  const kind = mark.kind || mark.mark_type || "negative";
  const occurredAt = mark.occurred_at || mark.happened_at || "";
  return {
    ...mark,
    kind,
    mark_type: kind,
    occurred_at: occurredAt,
    happened_at: occurredAt,
    voided_at: mark.voided_at || mark.deleted_at || null,
    current_version: Number(mark.current_version || 1),
  };
}

function normalizeStaffAnalytics(
  analytics: StaffAnalytics & {
    events?: Array<Record<string, any>>;
  },
): StaffAnalytics {
  const counts = new Map<string, number>();
  for (const item of analytics.event_counts || []) {
    counts.set(item.event_type, Number(item.count || 0));
  }
  const eventCount = (...names: string[]) =>
    names.reduce((sum, name) => sum + Number(counts.get(name) || 0), 0);
  const metric = (name: string, ...fallbackNames: string[]) =>
    Number(
      analytics.metrics?.[name] ??
        eventCount(name, ...fallbackNames),
    );
  const rawEvents = analytics.activities || analytics.events || [];
  const activities: StaffActivity[] = rawEvents.map((event: any) => {
    const type = String(event.type || event.event_type || "activity");
    return {
      ...event,
      id: event.id,
      type,
      title:
        event.title ||
        STAFF_EVENT_LABELS[type] ||
        event.source_name_snapshot ||
        "Действие",
      description:
        event.description ||
        event.source_name_snapshot ||
        event.source_type ||
        null,
      occurred_at:
        event.occurred_at || event.happened_at || event.created_at || "",
      tone: event.tone || event.polarity,
    };
  });
  const dailyActivity =
    analytics.daily_activity && analytics.daily_activity.length
      ? analytics.daily_activity.map((day: any) => ({
          ...day,
          count: Number(day.count ?? day.total ?? 0),
        }))
      : Array.from(
          activities.reduce((days, event) => {
            const date = String(event.occurred_at || "").slice(0, 10);
            if (date) days.set(date, Number(days.get(date) || 0) + 1);
            return days;
          }, new Map<string, number>()),
        ).map(([date, count]) => ({ date, count }));
  return {
    ...analytics,
    tasks_completed:
      analytics.tasks_completed ??
      analytics.metrics?.tasks_completed ??
      Number(analytics.tasks?.approved || 0),
    orders_assembled:
      analytics.orders_assembled ??
      analytics.assembled_orders ??
      metric("order_assembled", "order.assembled"),
    orders_issued:
      analytics.orders_issued ??
      analytics.issued_orders ??
      metric("order_issued", "order.issued"),
    orders_amount:
      analytics.orders_amount ??
      analytics.issued_revenue ??
      Number(analytics.metrics?.orders_issued_amount || 0),
    procurements_created:
      analytics.procurements_created ??
      metric("procurement_created", "procurement.created"),
    procurements_completed:
      analytics.procurements_completed ??
      metric(
        "procurement_accepted",
        "procurement_completed",
        "procurement.accepted",
      ),
    transfers_created:
      analytics.transfers_created ??
      metric("transfer_created", "transfer.created"),
    transfers_completed:
      analytics.transfers_completed ??
      metric(
        "transfer_accepted",
        "transfer_completed",
        "transfer.accepted",
      ),
    estimated_salary:
      analytics.estimated_salary ??
      (analytics.expected_salary
        ? Number(
            analytics.expected_salary.amount ??
              Number(analytics.expected_salary.amount_minor || 0) / 100,
          )
        : null),
    marks: (analytics.marks || []).map((mark) =>
      normalizeStaffMark(mark as unknown as StaffMark),
    ),
    activities,
    daily_activity: dailyActivity,
  };
}

// TODO: при появлении ролевой модели (manager/cashier) — рассмотреть отдельную
// обработку 403 (Forbidden). Сейчас на бэке используется только 401 для всех
// auth-сценариев, поэтому отдельная ветка не нужна.
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...staffHeaders(),
        ...options?.headers,
      },
    });
  } catch {
    throw new StaffApiError(
      "Нет связи с сервером. Проверьте результат перед повтором.",
      {
        outcomeUnknown:
          Boolean(options?.method) &&
          String(options?.method || "GET").toUpperCase() !== "GET",
      },
    );
  }

  // Только `unauthorized` означает, что истёк основной вход CRM. Остальные 401
  // могут быть ожидаемыми ошибками проверки ПИН или отдельного кода доступа:
  // они должны остаться внутри формы и не выбрасывать пользователя из CRM.
  if (response.status === 401) {
    const payload = await response
      .json()
      .catch(() => ({} as Record<string, unknown>));
    const code = String(payload.error || payload.code || "unauthorized");
    if (code !== "unauthorized") {
      throw new StaffApiError(
        String(payload.message || payload.error || "Не удалось подтвердить действие"),
        { code, status: response.status },
      );
    }

    // Динамический импорт, чтобы не создавать циклическую зависимость stores.
    try {
      const { useAdminStore } = await import("./admin");
      const adminStore = useAdminStore();
      // Идемпотентность: при N параллельных 401 не плодим лишних logout-операций
      // (важно если когда-нибудь logout станет реально асинхронным с side-effects).
      if (adminStore.isAuthenticated) {
        await adminStore.logout();
      }
    } catch (logoutError) {
      console.warn("[CRM] Failed to clear admin state on 401:", logoutError);
    }
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "unknown" }));
    // Prefer the human-readable message; fall back to the slug. Attach
    // both `code` (machine-readable, e.g. `in_use_by_wheel`) and `status`
    // so callers can branch on specific outcomes.
    const message = payload.message || payload.error || "Request failed";
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = payload.error;
    err.status = response.status;
    throw err;
  }

  return response.json();
}

export const useCrmStore = defineStore("crm", () => {
  // Profit access - restore localStorage handling
  const savedProfitState =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("crm_profit_unlocked")
      : null;
  const profitUnlocked = ref(savedProfitState === "true");
  /**
   * Пропуск в «Обзор» живёт только в памяти, а замок считаем закрытым, пока
   * сервер не ответил обратное: неизвестное состояние не должно открывать
   * раздел само по себе.
   */
  const dashboardToken = ref("");
  const dashboardLocked = ref(true);
  /**
   * Спрашивает ли этот магазин пароли поверх обычного входа. Выключаются
   * переменной окружения сервера OVERVIEW_PASSWORD_ENABLED
   * (см. server/utils/dashboard-access.js),
   * и тогда profitUnlocked поднимается сам. Закрыт им не только «Обзор»:
   * на нём же себестоимость в «Товарах», «Финансы», «Заказы», «Архив»,
   * «Закупки» и «Касса». До ответа сервера считаем, что пароли спрашивают.
   */
  const overviewPasswordRequired = ref(true);
  const verifyingProfitAccess = ref(false);
  const isProfitUnlocked = computed(() => profitUnlocked.value);

  function lockProfitAccess() {
    // Когда пароли «Обзора» выключены настройкой, запирать нечего: иначе на
    // экране повис бы запрос пароля, которого магазину никто не выдавал.
    profitUnlocked.value = !overviewPasswordRequired.value;
    // Пропуск в «Обзор» уходит вместе с ключом: иначе после блокировки хватило
    // бы обычного ключа, чтобы снова увидеть сводку.
    dashboardToken.value = "";
    dashboardLocked.value = overviewPasswordRequired.value;
    // Загруженную сводку тоже забываем, иначе после повторного входа она
    // отрисуется из памяти, хотя доступ уже отобран.
    dashboardStats.value = null;
    dashboardTimeseries.value = [];
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("crm_profit_unlocked");
    }
  }

  // ========== Global Order Notifications ==========
  const newOrdersCount = ref(0);
  const unseenOrderIds = ref<Set<string>>(new Set());
  const lastKnownOrderIds = ref<Set<string>>(new Set());
  const actionRequiredCount = ref(0);
  const unseenActionIds = ref<Set<string>>(new Set());
  const lastKnownActionIds = ref<Set<string>>(new Set());
  // In-app toast notification (fallback for Safari)
  const inAppToast = ref<{
    show: boolean;
    message: string;
    count: number;
    hint: string;
  }>({
    show: false,
    message: "",
    count: 0,
    hint: "",
  });
  const pendingReviewCount = ref(0);
  const reviewAlertBaseline = ref(0);
  type MonthlyDrawAlert = {
    id: string;
    period_key: string;
    drawn_at: string;
    winner_count: number;
  };
  const latestMonthlyDraw = ref<MonthlyDrawAlert | null>(null);
  const acknowledgedDrawId = ref(
    typeof localStorage !== "undefined"
      ? localStorage.getItem("crm_ack_draw_id") || ""
      : "",
  );
  const notificationsEnabled = ref(
    typeof localStorage !== "undefined"
      ? localStorage.getItem("crm_notifications_enabled") !== "false"
      : true
  );
  const soundEnabled = ref(
    typeof localStorage !== "undefined"
      ? localStorage.getItem("crm_sound_enabled") !== "false"
      : true
  );
  const autoRefreshEnabled = ref(true);
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let pollingInitialized = false;
  const POLLING_INTERVAL_MS = 15000;
  const latestOrderActivityAt = ref<string | null>(null);
  const orderActivityListeners = new Set<(activitySince: string) => void>();

  function setNotificationsEnabled(enabled: boolean) {
    notificationsEnabled.value = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("crm_notifications_enabled", enabled ? "true" : "false");
    }
    if (enabled) {
      ensureNotificationPermission();
    }
  }

  function setSoundEnabled(enabled: boolean) {
    soundEnabled.value = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("crm_sound_enabled", enabled ? "true" : "false");
    }
    // Unlock AudioContext on user interaction (required for Safari)
    if (enabled) {
      unlockAudioContext();
    }
  }

  function setAutoRefreshEnabled(enabled: boolean) {
    autoRefreshEnabled.value = enabled;
    if (enabled) {
      startPolling();
    } else {
      stopPolling();
    }
  }

  // Pre-created audio context for Safari (needs user gesture to unlock)
  let audioContextUnlocked = false;
  let cachedAudioContext: AudioContext | null = null;
  
  function unlockAudioContext() {
    if (audioContextUnlocked) return;
    try {
      cachedAudioContext = new AudioContext();
      // Create a silent buffer to unlock
      const buffer = cachedAudioContext.createBuffer(1, 1, 22050);
      const source = cachedAudioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(cachedAudioContext.destination);
      source.start(0);
      audioContextUnlocked = true;
    } catch (e) {
      // ignore
    }
  }

  function playNotificationSound() {
    if (typeof window === "undefined") return;
    try {
      // Try to use cached context or create new one
      const ctx = cachedAudioContext && cachedAudioContext.state !== 'closed' 
        ? cachedAudioContext 
        : new AudioContext();
      
      // Resume if suspended (Safari)
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.value = 880;
      oscillator.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1);

      oscillator.start(now);
      oscillator.stop(now + 1);

      // Don't close cached context
      if (ctx !== cachedAudioContext) {
        setTimeout(() => ctx.close().catch(() => null), 1500);
      }
    } catch (error) {
      console.warn("[CRM] Notification sound failed:", error);
    }
  }

  function triggerBrowserNotification(
    count: number,
    options: { isActionRequired?: boolean; isReview?: boolean; isMonthlyDraw?: boolean } = {},
  ) {
    const { isActionRequired = false, isReview = false, isMonthlyDraw = false } = options;
    // Always show in-app toast (works in Safari and all browsers)
    const toastMessage = isMonthlyDraw
      ? "Розыгрыш отзывов"
      : isReview
        ? (count === 1 ? "Новый отзыв!" : `Новых отзывов: ${count}`)
        : isActionRequired
          ? (count === 1 ? "Заказ требует действий!" : `Заказов требует действий: ${count}`)
          : (count === 1 ? "Новый заказ!" : `Новых заказов: ${count}`);
    const toastHint = isMonthlyDraw
      ? "Список в разделе Отзывы"
      : isReview
        ? "Откройте раздел «Отзывы» для модерации"
        : "Проверьте колонку «Новые»";
    inAppToast.value = { show: true, message: toastMessage, count, hint: toastHint };
    // Auto-hide after 10 seconds
    setTimeout(() => {
      if (inAppToast.value.count === count && inAppToast.value.message === toastMessage) {
        inAppToast.value = { show: false, message: "", count: 0, hint: "" };
      }
    }, 10000);
    
    // Also try browser notification (may not work in Safari)
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const title = isMonthlyDraw
      ? "Розыгрыш отзывов"
      : isReview
        ? (count === 1 ? "Новый отзыв" : `Новых отзывов: ${count}`)
        : isActionRequired
          ? (count === 1 ? "Требует действий" : `Требует действий: ${count}`)
          : (count === 1 ? "Новый заказ" : `Новых заказов: ${count}`);
    const body = isMonthlyDraw
      ? "Появился список победителей."
      : isReview
        ? (count === 1
            ? "Появился отзыв на модерации."
            : "Появились новые отзывы на модерации.")
        : isActionRequired
          ? (count === 1
              ? "Заказ требует внимания менеджера."
              : "Несколько заказов требуют внимания менеджера.")
          : (count === 1
              ? "Появился новый заказ в колонке «Новые»."
              : "На доске появились новые заказы. Проверьте колонку «Новые».");

    try {
      new Notification(title, {
        body,
        icon: "/favicon.png",
      });
    } catch (error) {
      console.warn("[CRM] Browser notification failed:", error);
    }
  }
  
  function hideInAppToast() {
    inAppToast.value = { show: false, message: "", count: 0, hint: "" };
  }

  type OrderPollSummary = {
    newOrderIds: string[];
    actionRequiredIds: string[];
    latestOrderActivityAt: string | null;
    pendingReviewCount?: number;
    latestMonthlyDraw?: MonthlyDrawAlert | null;
  };

  const hasUnseenReviews = computed(
    () => pendingReviewCount.value > reviewAlertBaseline.value,
  );

  const hasUnseenDraw = computed(() => {
    const draw = latestMonthlyDraw.value;
    if (!draw?.id) return false;
    return draw.id !== acknowledgedDrawId.value;
  });

  function notifyOrderActivityListeners(activitySince: string) {
    for (const listener of orderActivityListeners) {
      try {
        listener(activitySince);
      } catch (error) {
        console.error("[CRM] Order activity listener failed:", error);
      }
    }
  }

  function subscribeOrderActivity(listener: (activitySince: string) => void) {
    orderActivityListeners.add(listener);
    return () => {
      orderActivityListeners.delete(listener);
    };
  }

  function applyOrderPollSummary(summary: OrderPollSummary) {
    const currentNewOrders = summary.newOrderIds || [];
    const currentIds = new Set(currentNewOrders);

    const newIds: string[] = [];
    currentIds.forEach((id) => {
      if (!lastKnownOrderIds.value.has(id)) {
        newIds.push(id);
        unseenOrderIds.value.add(id);
      }
    });

    lastKnownOrderIds.value = currentIds;

    const cleanedUnseen = new Set<string>();
    unseenOrderIds.value.forEach((id) => {
      if (currentIds.has(id)) {
        cleanedUnseen.add(id);
      }
    });
    unseenOrderIds.value = cleanedUnseen;
    newOrdersCount.value = unseenOrderIds.value.size;

    const currentActionIds = new Set(summary.actionRequiredIds || []);
    const newActionIds: string[] = [];
    currentActionIds.forEach((id) => {
      if (!lastKnownActionIds.value.has(id)) {
        newActionIds.push(id);
        unseenActionIds.value.add(id);
      }
    });

    lastKnownActionIds.value = currentActionIds;

    const cleanedAction = new Set<string>();
    unseenActionIds.value.forEach((id) => {
      if (currentActionIds.has(id)) {
        cleanedAction.add(id);
      }
    });
    unseenActionIds.value = cleanedAction;
    actionRequiredCount.value = unseenActionIds.value.size;

    const previousActivity = latestOrderActivityAt.value;
    latestOrderActivityAt.value = summary.latestOrderActivityAt || null;
    if (previousActivity && latestOrderActivityAt.value && previousActivity !== latestOrderActivityAt.value) {
      notifyOrderActivityListeners(previousActivity);
    }

    const currentPendingReviews = Number(summary.pendingReviewCount || 0);
    const newReviewDelta = Math.max(
      0,
      currentPendingReviews - pendingReviewCount.value,
    );
    pendingReviewCount.value = currentPendingReviews;

    if (pollingInitialized && newIds.length > 0) {
      if (notificationsEnabled.value) {
        triggerBrowserNotification(newIds.length);
      }
      if (soundEnabled.value) {
        playNotificationSound();
      }
    }

    if (pollingInitialized && newActionIds.length > 0) {
      if (notificationsEnabled.value) {
        triggerBrowserNotification(newActionIds.length, { isActionRequired: true });
      }
      if (soundEnabled.value) {
        playNotificationSound();
      }
    }

    if (pollingInitialized && newReviewDelta > 0) {
      if (notificationsEnabled.value) {
        triggerBrowserNotification(newReviewDelta, { isReview: true });
      }
      if (soundEnabled.value) {
        playNotificationSound();
      }
    }

    const previousDrawId = latestMonthlyDraw.value?.id || null;
    const nextDraw = summary.latestMonthlyDraw || null;
    latestMonthlyDraw.value = nextDraw;
    const isNewDraw = Boolean(
      pollingInitialized
      && nextDraw?.id
      && nextDraw.id !== previousDrawId,
    );
    if (isNewDraw) {
      if (notificationsEnabled.value) {
        triggerBrowserNotification(1, { isMonthlyDraw: true });
      }
      if (soundEnabled.value) {
        playNotificationSound();
      }
    }

    pollingInitialized = true;
  }

  function markReviewsAsSeen() {
    reviewAlertBaseline.value = pendingReviewCount.value;
  }

  function markDrawAsSeen(drawId?: string) {
    const resolvedId = drawId || latestMonthlyDraw.value?.id || "";
    if (!resolvedId) return;
    acknowledgedDrawId.value = resolvedId;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("crm_ack_draw_id", resolvedId);
    }
  }

  const isDrawBannerDismissed = computed(() => {
    const draw = latestMonthlyDraw.value;
    if (!draw?.id) return false;
    return acknowledgedDrawId.value === draw.id;
  });

  function clearDrawAcknowledgement() {
    acknowledgedDrawId.value = "";
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("crm_ack_draw_id");
    }
  }

  async function fetchOrderPollSummary() {
    return await fetchAPI<OrderPollSummary>(`${API_BASE}/orders/poll-summary`);
  }

  async function pollOrderSummary() {
    try {
      const summary = await fetchOrderPollSummary();
      applyOrderPollSummary(summary);
    } catch (error) {
      console.error("[CRM] Poll order summary failed:", error);
    }
  }

  async function ensureNotificationPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch (error) {
        console.warn("[CRM] Notification permission request failed:", error);
      }
    }
  }

  async function checkForNewOrders() {
    await pollOrderSummary();
  }

  async function checkForActionRequired() {
    await pollOrderSummary();
  }

  function startPolling() {
    if (pollingTimer) return;
    void pollOrderSummary();
    // Низкий приоритет — индикатор сайдбара. Ловим .catch чтобы не валить
    // основные опросы заказов.
    fetchLowStockSummary().catch(() => {});
    pollingTimer = setInterval(() => {
      void pollOrderSummary();
      fetchLowStockSummary().catch(() => {});
    }, POLLING_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function markOrderAsSeen(orderId: string) {
    if (unseenOrderIds.value.has(orderId)) {
      unseenOrderIds.value.delete(orderId);
      unseenOrderIds.value = new Set(unseenOrderIds.value);
      newOrdersCount.value = unseenOrderIds.value.size;
    }
  }

  function markAllOrdersAsSeen() {
    unseenOrderIds.value.clear();
    unseenOrderIds.value = new Set();
    newOrdersCount.value = 0;
  }

  function isOrderUnseen(orderId: string): boolean {
    return unseenOrderIds.value.has(orderId);
  }
  // ========== End Global Order Notifications ==========

  // Dashboard
  const dashboardStats = ref<DashboardStats | null>(null);
  const loadingDashboard = ref(false);

  async function fetchDashboard(
    period: "today" | "week" | "month" | "year" | "custom" = "today",
    offset: number = 0,
    options: {
      from?: string;          // YYYY-MM-DD, нужен только при period === 'custom'
      to?: string;            // YYYY-MM-DD, нужен только при period === 'custom'
      topSort?: "profit" | "quantity";
      topLimit?: number;
      topSearch?: string;
    } = {},
  ) {
    // Для произвольного периода без обеих границ — не делаем запрос.
    // Backend всё равно вернёт 400, и это бы зашумляло UX (мигание ошибки при инициализации).
    if (period === "custom" && (!options.from || !options.to)) {
      return;
    }

    loadingDashboard.value = true;
    try {
      const params = new URLSearchParams({
        period,
        offset: String(offset),
      });
      if (period === "custom") {
        params.append("from", options.from!);
        params.append("to", options.to!);
      }
      if (options.topSort) params.append("top_sort", options.topSort);
      if (options.topLimit !== undefined) {
        params.append("top_limit", String(options.topLimit));
      }
      if (options.topSearch) params.append("top_search", options.topSearch);

      dashboardStats.value = await fetchAPI<DashboardStats>(
        `${API_BASE}/dashboard?${params.toString()}`,
        { headers: dashboardHeaders() },
      );
    } catch (error: any) {
      // Окно проверок могло начаться, пока раздел был открыт: закрываем его.
      if (error?.data?.error === "dashboard_locked") {
        dashboardToken.value = "";
        dashboardLocked.value = true;
      }
      throw error;
    } finally {
      loadingDashboard.value = false;
    }
  }

  // Dashboard Timeseries - детализированные данные для графиков
  const dashboardTimeseries = ref<
    Array<{ label: string; orders: number; revenue: number; profit: number }>
  >([]);
  const loadingTimeseries = ref(false);

  async function fetchDashboardTimeseries(
    period: "today" | "month" | "year" = "month",
    offset: number = 0,
    year?: number,
  ) {
    loadingTimeseries.value = true;
    try {
      const params = new URLSearchParams({ period, offset: offset.toString() });
      if (year) params.append("year", year.toString());
      const data = await fetchAPI<
        Array<{
          label: string;
          orders: number;
          revenue: number;
          profit: number;
        }>
      >(`${API_BASE}/dashboard-timeseries?${params.toString()}`, {
        headers: dashboardHeaders(),
      });
      dashboardTimeseries.value = data;
    } catch (error) {
      console.error("[CRM] Failed to fetch timeseries:", error);
      dashboardTimeseries.value = [];
    } finally {
      loadingTimeseries.value = false;
    }
  }

  // Employees
  const employees = ref<Employee[]>([]);
  const loadingEmployees = ref(false);

  async function fetchEmployees() {
    loadingEmployees.value = true;
    try {
      employees.value = await fetchAPI<Employee[]>(`${API_BASE}/employees`);
    } finally {
      loadingEmployees.value = false;
    }
  }

  async function createEmployee(data: {
    username: string;
    password: string;
    first_name: string;
    last_name: string;
    position?: string;
  }) {
    const employee = await fetchAPI<Employee>(`${API_BASE}/employees`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    employees.value.push(employee);
    return employee;
  }

  async function updateEmployee(
    id: string,
    data: Partial<
      Omit<Employee, "id" | "username" | "created_at" | "updated_at">
    >,
  ) {
    const employee = await fetchAPI<Employee>(`${API_BASE}/employees/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    const index = employees.value.findIndex((e) => e.id === id);
    if (index !== -1) {
      employees.value[index] = employee;
    }
    return employee;
  }

  async function deleteEmployee(id: string) {
    await fetchAPI(`${API_BASE}/employees/${id}`, { method: "DELETE" });
    employees.value = employees.value.filter((e) => e.id !== id);
  }

  // Staff workspace. The admin session remains the outer security boundary;
  // the short-lived staff token identifies the person currently at the desk.
  const staffIdentity = ref<StaffIdentity | null>(null);
  const staffToken = ref("");
  const staffShiftToken = ref("");
  const staffAccessLoading = ref(false);
  const staffAccessError = ref("");
  const staffTrackingEnabled = ref<boolean | null>(null);
  const staffSettingsLoading = ref(false);
  const staffSettingsError = ref("");
  const staffEmployees = ref<Employee[]>([]);
  const staffEmployeesLoading = ref(false);
  const staffEmployeesError = ref("");
  let staffEmployeesRequestVersion = 0;
  let staffEmployeesPendingRequests = 0;
  const currentStaffShift = ref<StaffShift | null>(null);
  const staffShiftHistory = ref<StaffShift[]>([]);
  const staffShiftHistoryLoading = ref(false);
  const staffShiftHistoryError = ref("");
  const staffShiftCandidates = ref<StaffShiftCandidate[]>([]);
  const staffShiftCandidatesLoading = ref(false);
  const staffShiftCandidatesError = ref("");
  const staffShiftLoading = ref(false);
  const staffShiftError = ref("");
  const staffAnalytics = ref<StaffAnalytics | null>(null);
  const staffAnalyticsLoading = ref(false);
  const staffAnalyticsError = ref("");
  const staffAnalyticsPrevious = ref<StaffAnalytics | null>(null);
  const staffTeamAnalytics = ref<StaffAnalytics[]>([]);
  const staffTeamAnalyticsLoading = ref(false);
  const staffTeamAnalyticsError = ref("");
  const staffTasks = ref<StaffTask[]>([]);
  const staffTasksLoading = ref(false);
  const staffTasksError = ref("");
  const staffSalaries = ref<StaffSalary[]>([]);
  const staffSalariesLoading = ref(false);
  const staffSalariesError = ref("");
  const staffMarks = ref<StaffMark[]>([]);
  const staffMarksLoading = ref(false);
  const staffMarksError = ref("");
  const staffNotifications = ref<StaffNotificationsPayload | null>(null);
  const staffNotificationsLoading = ref(false);
  const staffNotificationsError = ref("");
  let staffShiftFetchSequence = 0;
  let staffShiftMutationEpoch = 0;
  let staffAnalyticsRequestSequence = 0;
  let staffAnalyticsPreviousRequestSequence = 0;
  let staffTeamAnalyticsRequestSequence = 0;
  let staffTasksRequestSequence = 0;
  let staffSalaryRequestSequence = 0;
  let staffMarksRequestSequence = 0;
  let staffShiftHistoryRequestSequence = 0;
  const hasStaffAccess = computed(
    () => Boolean(staffToken.value && staffIdentity.value?.employee?.id),
  );
  const staffRole = computed<StaffRole>(
    () => staffIdentity.value?.role || "employee",
  );
  const isStaffManager = computed(() => staffRole.value === "manager");
  const openStaffTaskCount = computed(
    () =>
      staffTasks.value.filter((task) =>
        ["open", "claimed", "submitted"].includes(task.status),
      ).length,
  );

  function persistStaffIdentity(identity: StaffIdentity | null) {
    staffIdentity.value = identity;
  }

  function setStaffIdentityFromPayload(payload: Record<string, any>) {
    const nestedIdentity = payload.identity as
      | StaffIdentity
      | Employee
      | undefined;
    const identityEmployee =
      nestedIdentity && "employee" in nestedIdentity
        ? nestedIdentity.employee
        : nestedIdentity;
    const employee =
      payload.employee ||
      payload.staff ||
      payload.user ||
      identityEmployee;
    if (!employee?.id) return;
    persistStaffIdentity({
      employee,
      role:
        payload.role ||
        ("role" in (nestedIdentity || {})
          ? (nestedIdentity as StaffIdentity | Employee).role
          : undefined) ||
        employee.role ||
        "employee",
      permissions:
        payload.permissions ||
        ("permissions" in (nestedIdentity || {})
          ? (nestedIdentity as StaffIdentity).permissions
          : undefined) ||
        [],
    });
  }

  function applyStaffAccessResponse(payload: Record<string, any>) {
    const token = String(payload.staff_token || payload.token || "");
    if (token) {
      staffToken.value = token;
      inMemoryStaffToken = token;
    }
    const shiftToken = String(payload.shift_token || "");
    if (shiftToken) {
      staffShiftToken.value = shiftToken;
      inMemoryShiftToken = shiftToken;
    }
    setStaffIdentityFromPayload(payload);
    if (!staffIdentity.value?.employee?.id && payload.shift?.employee?.id) {
      setStaffIdentityFromPayload({
        employee: payload.shift.employee,
        role: payload.shift.employee.role || "employee",
      });
    }
    return token;
  }

  function lockStaffAccess() {
    staffShiftMutationEpoch += 1;
    staffAnalyticsRequestSequence += 1;
    staffTeamAnalyticsRequestSequence += 1;
    staffTasksRequestSequence += 1;
    staffSalaryRequestSequence += 1;
    staffMarksRequestSequence += 1;
    staffShiftHistoryRequestSequence += 1;
    clearStoredStaffAccess();
    clearStoredShiftToken();
    staffToken.value = "";
    staffShiftToken.value = "";
    persistStaffIdentity(null);
    staffAnalytics.value = null;
    staffAnalyticsPrevious.value = null;
    staffTeamAnalytics.value = [];
    staffSalaries.value = [];
    staffMarks.value = [];
    staffShiftHistory.value = [];
    staffTasks.value = [];
    staffNotifications.value = null;
    staffAccessError.value = "";
  }
  staffUnauthorizedHandler = lockStaffAccess;

  async function accessStaff(pin: string) {
    if (!/^\d{4}$/.test(pin)) {
      throw new StaffApiError("Введите четыре цифры", {
        code: "invalid_pin_format",
      });
    }
    staffAccessLoading.value = true;
    staffAccessError.value = "";
    try {
      lockStaffAccess();
      const response = await staffFetchAPI<Record<string, any>>(
        `${API_BASE}/staff/access`,
        {
          method: "POST",
          body: JSON.stringify({ pin }),
        },
        { includeStaff: false },
      );
      const token = applyStaffAccessResponse(response);
      if (!token) {
        throw new StaffApiError("Сервер не выдал допуск сотрудника", {
          code: "missing_staff_token",
        });
      }
      await refreshStaffWorkspace({ quiet: true });
      if (!staffIdentity.value?.employee?.id) {
        throw new StaffApiError(
          "Не удалось определить сотрудника. Войдите ещё раз.",
          { code: "missing_staff_identity" },
        );
      }
      return staffIdentity.value;
    } catch (error: any) {
      if (!staffToken.value || error?.code === "missing_staff_identity") {
        lockStaffAccess();
      }
      staffAccessError.value =
        error?.message || "Не удалось проверить ПИН";
      throw error;
    } finally {
      staffAccessLoading.value = false;
    }
  }

  function clearInactiveStaffShift() {
    staffShiftMutationEpoch += 1;
    staffShiftFetchSequence += 1;
    currentStaffShift.value = null;
    clearStoredShiftToken();
    staffShiftToken.value = "";
    staffShiftLoading.value = false;
    staffShiftError.value = "";
  }

  async function fetchStaffSettings() {
    staffSettingsLoading.value = true;
    staffSettingsError.value = "";
    try {
      const response = await staffFetchAPI<{ enabled: boolean }>(
        `${API_BASE}/staff/settings/tracking`,
        {},
        { includeStaff: false },
      );
      staffTrackingEnabled.value = Boolean(response.enabled);
      if (!staffTrackingEnabled.value) clearInactiveStaffShift();
      return { trackingEnabled: staffTrackingEnabled.value };
    } catch (error: any) {
      staffSettingsError.value =
        error?.message || "Не удалось загрузить настройки учёта";
      throw error;
    } finally {
      staffSettingsLoading.value = false;
    }
  }

  async function updateStaffTracking(enabled: boolean) {
    staffSettingsLoading.value = true;
    staffSettingsError.value = "";
    try {
      const response = await staffFetchAPI<{ enabled: boolean }>(
        `${API_BASE}/staff/settings/tracking`,
        {
          method: "PUT",
          body: JSON.stringify({ enabled }),
        },
      );
      staffTrackingEnabled.value = Boolean(response.enabled);
      if (!staffTrackingEnabled.value) clearInactiveStaffShift();
      return staffTrackingEnabled.value;
    } catch (error: any) {
      staffSettingsError.value =
        error?.message || "Не удалось изменить учёт сотрудников";
      throw error;
    } finally {
      staffSettingsLoading.value = false;
    }
  }

  async function bootstrapStaffManager(data: {
    admin_password: string;
    first_name: string;
    last_name?: string;
    position?: string;
    new_pin: string;
    enable_tracking: boolean;
  }) {
    const response = await staffFetchAPI<{
      employee: Employee;
      tracking_enabled: boolean;
    }>(
      `${API_BASE}/staff/bootstrap-manager`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      { includeStaff: false },
    );
    staffTrackingEnabled.value = Boolean(response.tracking_enabled);
    return response.employee;
  }

  async function recoverStaffManager(data: {
    admin_password: string;
    employee_id: string;
    new_pin: string;
  }) {
    const response = await staffFetchAPI<{ employee: Employee }>(
      `${API_BASE}/staff/recovery-manager`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      { includeStaff: false },
    );
    const employee = response.employee;
    const index = staffEmployees.value.findIndex(
      (item) => item.id === employee.id,
    );
    if (index !== -1) staffEmployees.value[index] = employee;
    return employee;
  }

  async function fetchStaffRecoveryManagerCandidates(adminPassword: string) {
    const response = await staffFetchAPI<{
      managers?: Employee[];
      employees?: Employee[];
    }>(
      `${API_BASE}/staff/recovery-manager/candidates`,
      {
        method: "POST",
        body: JSON.stringify({ admin_password: adminPassword }),
      },
      { includeStaff: false },
    );
    return response.managers || response.employees || [];
  }

  async function fetchStaffEmployees(options: { includeInactive?: boolean } = {}) {
    const requestVersion = ++staffEmployeesRequestVersion;
    staffEmployeesPendingRequests += 1;
    staffEmployeesLoading.value = true;
    staffEmployeesError.value = "";
    try {
      const query = new URLSearchParams();
      if (options.includeInactive) query.set("include_inactive", "1");
      const suffix = query.toString() ? `?${query}` : "";
      const response = await staffFetchAPI<
        Employee[] | { employees?: Employee[]; items?: Employee[]; data?: Employee[] }
      >(`${API_BASE}/staff/employees${suffix}`);
      const employees = listFromPayload(
        response,
        !Array.isArray(response) ? response.employees : undefined,
      );
      if (requestVersion === staffEmployeesRequestVersion) {
        staffEmployees.value = employees;
      }
      return employees;
    } catch (error: any) {
      if (requestVersion === staffEmployeesRequestVersion) {
        staffEmployeesError.value =
          error?.message || "Не удалось загрузить сотрудников";
      }
      throw error;
    } finally {
      staffEmployeesPendingRequests = Math.max(
        0,
        staffEmployeesPendingRequests - 1,
      );
      staffEmployeesLoading.value = staffEmployeesPendingRequests > 0;
    }
  }

  async function createStaffEmployee(data: {
    first_name: string;
    last_name: string;
    position?: string | null;
    responsibilities?: string | null;
      color?: string | null;
      avatar_url?: string | null;
      role: StaffRole;
      pin: string;
  }) {
    const response = await staffFetchAPI<Employee | { employee: Employee }>(
      `${API_BASE}/staff/employees`,
      { method: "POST", body: JSON.stringify(data) },
    );
    const employee = "employee" in response ? response.employee : response;
    staffEmployees.value = [employee, ...staffEmployees.value];
    return employee;
  }

  /** Пустой юзернейм снимает привязку Telegram. */
  async function linkStaffEmployeeTelegram(id: string, username: string) {
    const response = await staffFetchAPI<{ employee: Employee }>(
      `${API_BASE}/staff/employees/${encodeURIComponent(id)}/telegram`,
      { method: "PUT", body: JSON.stringify({ username }) },
    );
    const employee = response.employee;
    staffEmployees.value = staffEmployees.value.map((item) =>
      item.id === employee.id ? employee : item,
    );
    return employee;
  }

  async function updateStaffEmployee(
    id: string,
    data: Partial<{
      first_name: string;
      last_name: string;
      position: string | null;
      responsibilities: string | null;
      color: string | null;
      avatar_url: string | null;
      role: StaffRole;
      pin: string;
      active: number | boolean;
    }>,
  ) {
    const response = await staffFetchAPI<Employee | { employee: Employee }>(
      `${API_BASE}/staff/employees/${id}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
    const employee = "employee" in response ? response.employee : response;
    const index = staffEmployees.value.findIndex((item) => item.id === id);
    if (index !== -1) staffEmployees.value[index] = employee;
    if (staffIdentity.value?.employee.id === id) {
      persistStaffIdentity({
        ...staffIdentity.value,
        employee,
        role: employee.role || staffIdentity.value.role,
      });
    }
    return employee;
  }

  async function deactivateStaffEmployee(id: string, reason: string) {
    const response = await staffFetchAPI<Employee | { employee: Employee }>(
      `${API_BASE}/staff/employees/${id}/deactivate`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
    const employee = "employee" in response ? response.employee : response;
    const index = staffEmployees.value.findIndex((item) => item.id === id);
    if (index !== -1) staffEmployees.value[index] = employee;
    return employee;
  }

  async function restoreStaffEmployee(
    id: string,
    params: { newPin?: string; adminPassword?: string } = {},
  ) {
    const body: Record<string, string> = {};
    if (params.newPin) body.new_pin = params.newPin;
    if (params.adminPassword) body.admin_password = params.adminPassword;
    const response = await staffFetchAPI<Employee | { employee: Employee }>(
      `${API_BASE}/staff/employees/${id}/restore`,
      { method: "POST", body: JSON.stringify(body) },
    );
    const employee = "employee" in response ? response.employee : response;
    const index = staffEmployees.value.findIndex((item) => item.id === id);
    if (index !== -1) staffEmployees.value[index] = employee;
    return employee;
  }

  async function resetStaffEmployeePin(id: string, newPin: string) {
    const response = await staffFetchAPI<Employee | { employee: Employee }>(
      `${API_BASE}/staff/employees/${id}/reset-pin`,
      {
        method: "POST",
        body: JSON.stringify({ new_pin: newPin }),
      },
    );
    const employee = "employee" in response ? response.employee : response;
    const index = staffEmployees.value.findIndex((item) => item.id === id);
    if (index !== -1) staffEmployees.value[index] = employee;
    return employee;
  }

  function normalizeShiftPayload(payload: Record<string, any>): StaffShift | null {
    return payload.shift || payload.current_shift || payload.data || null;
  }

  async function fetchStaffShift() {
    const requestSequence = ++staffShiftFetchSequence;
    const mutationEpoch = staffShiftMutationEpoch;
    staffShiftLoading.value = true;
    staffShiftError.value = "";
    try {
      const response = await staffFetchAPI<Record<string, any>>(
        `${API_BASE}/staff/shift`,
        {},
        { includeStaff: false },
      );
      if (
        requestSequence !== staffShiftFetchSequence ||
        mutationEpoch !== staffShiftMutationEpoch
      ) {
        return currentStaffShift.value;
      }
      currentStaffShift.value = normalizeShiftPayload(response);
      if (
        !currentStaffShift.value ||
        !["active", "open"].includes(currentStaffShift.value.status)
      ) {
        clearStoredShiftToken();
        staffShiftToken.value = "";
      }
      return currentStaffShift.value;
    } catch (error: any) {
      if (
        requestSequence !== staffShiftFetchSequence ||
        mutationEpoch !== staffShiftMutationEpoch
      ) {
        throw error;
      }
      if (
        error?.status === 401 ||
        error?.code === "invalid_staff_token" ||
        error?.code === "staff_access_expired"
      ) {
        lockStaffAccess();
      }
      staffShiftError.value =
        error?.message || "Не удалось проверить смену";
      throw error;
    } finally {
      if (
        requestSequence === staffShiftFetchSequence &&
        mutationEpoch === staffShiftMutationEpoch
      ) {
        staffShiftLoading.value = false;
      }
    }
  }

  async function fetchStaffShiftCandidates() {
    staffShiftCandidatesLoading.value = true;
    staffShiftCandidatesError.value = "";
    try {
      const response = await staffFetchAPI<
        StaffShiftCandidate[] | {
          candidates?: StaffShiftCandidate[];
          items?: StaffShiftCandidate[];
          data?: StaffShiftCandidate[];
        }
      >(
        `${API_BASE}/staff/shift/candidates`,
        {},
        { includeStaff: false },
      );
      staffShiftCandidates.value = listFromPayload(
        response,
        !Array.isArray(response) ? response.candidates : undefined,
      );
      return staffShiftCandidates.value;
    } catch (error: any) {
      staffShiftCandidatesError.value =
        error?.message || "Не удалось загрузить сотрудников";
      throw error;
    } finally {
      staffShiftCandidatesLoading.value = false;
    }
  }

  async function openStaffShift(data: {
    employee_id?: string;
    pin?: string;
    note?: string;
  } = {}) {
    staffShiftMutationEpoch += 1;
    staffShiftLoading.value = true;
    staffShiftError.value = "";
    try {
      const response = await staffFetchAPI<Record<string, any>>(
        `${API_BASE}/staff/shift/open`,
        { method: "POST", body: JSON.stringify(data) },
        { includeStaff: false },
      );
      staffShiftMutationEpoch += 1;
      applyStaffAccessResponse(response);
      currentStaffShift.value = normalizeShiftPayload(response);
      return currentStaffShift.value;
    } catch (error: any) {
      staffShiftError.value = error?.message || "Не удалось открыть смену";
      throw error;
    } finally {
      staffShiftLoading.value = false;
    }
  }

  async function closeStaffShift(data: { note?: string } = {}) {
    staffShiftMutationEpoch += 1;
    staffShiftLoading.value = true;
    staffShiftError.value = "";
    try {
      const response = await staffFetchAPI<Record<string, any>>(
        `${API_BASE}/staff/shift/close`,
        { method: "POST", body: JSON.stringify(data) },
        { includeShift: true },
      );
      staffShiftMutationEpoch += 1;
      currentStaffShift.value = normalizeShiftPayload(response);
      clearStoredShiftToken();
      staffShiftToken.value = "";
      return currentStaffShift.value;
    } catch (error: any) {
      staffShiftError.value = error?.message || "Не удалось закрыть смену";
      throw error;
    } finally {
      staffShiftLoading.value = false;
    }
  }

  async function fetchStaffShiftHistory(params: {
    month?: string;
    employeeId?: string;
  } = {}) {
    const requestSequence = ++staffShiftHistoryRequestSequence;
    staffShiftHistoryLoading.value = true;
    staffShiftHistoryError.value = "";
    try {
      const query = new URLSearchParams();
      if (params.month) query.set("month", params.month);
      let shifts: StaffShift[];
      if (params.employeeId) {
        query.set("employee_id", params.employeeId);
        const response = await staffFetchAPI<{
          shifts?: StaffShift[];
        }>(
          `${API_BASE}/staff/shifts?${query}`,
        );
        const employee =
          staffEmployees.value.find(
            (item) => item.id === params.employeeId,
          ) || null;
        shifts = (response.shifts || []).map((shift) => ({
          ...shift,
          employee: shift.employee || employee,
          employee_name:
            shift.employee_name ||
            [employee?.first_name, employee?.last_name]
              .filter(Boolean)
              .join(" "),
        }));
      } else {
        const response = await staffFetchAPI<{
          employees?: StaffAnalytics[];
        }>(`${API_BASE}/staff/analytics/team?${query}`);
        shifts = (response.employees || []).flatMap(
          (analytics) =>
            (analytics.shifts || []).map((shift) => ({
              ...shift,
              employee: shift.employee || analytics.employee || null,
              employee_name:
                shift.employee_name ||
                [analytics.employee?.first_name, analytics.employee?.last_name]
                  .filter(Boolean)
                  .join(" "),
            })),
        );
      }
      try {
        const auditResponse = await staffFetchAPI<{
          audit?: Array<{
            shift_id: string;
            action: string;
            reason?: string | null;
            created_at?: string;
          }>;
        }>(`${API_BASE}/staff/shifts/audit?limit=200`);
        for (const audit of auditResponse.audit || []) {
          if (!["correct", "force_close"].includes(audit.action)) continue;
          const shift = shifts.find(
            (item) => item.id === audit.shift_id,
          );
          if (!shift || shift.corrected_at) continue;
          shift.corrected_at = audit.created_at || null;
          shift.correction_reason = audit.reason || null;
        }
      } catch {
        // Смены остаются доступны, даже если журнал правок временно не загрузился.
      }
      shifts.sort(
        (left, right) =>
          new Date(right.started_at || "").getTime() -
          new Date(left.started_at || "").getTime(),
      );
      if (requestSequence !== staffShiftHistoryRequestSequence) {
        return staffShiftHistory.value;
      }
      staffShiftHistory.value = shifts;
      return staffShiftHistory.value;
    } catch (error: any) {
      if (requestSequence === staffShiftHistoryRequestSequence) {
        staffShiftHistoryError.value =
          error?.message || "Не удалось загрузить историю смен";
      }
      throw error;
    } finally {
      if (requestSequence === staffShiftHistoryRequestSequence) {
        staffShiftHistoryLoading.value = false;
      }
    }
  }

  async function correctStaffShift(data: {
    shift_id: string;
    expected_version: number;
    reason: string;
    started_at?: string;
    ended_at?: string;
    force?: boolean;
  }) {
    staffShiftMutationEpoch += 1;
    const endpoint = data.force
      ? `${API_BASE}/staff/shift/close`
      : `${API_BASE}/staff/shifts/${data.shift_id}/correct`;
    const body = data.force
      ? { ...data, manager_correction: true }
      : {
          started_at: data.started_at,
          ended_at: data.ended_at,
          reason: data.reason,
          expected_version: data.expected_version,
        };
    const response = await staffFetchAPI<
      StaffShift | { shift: StaffShift }
    >(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const shift = "shift" in response ? response.shift : response;
    staffShiftMutationEpoch += 1;
    shift.correction_reason = data.reason;
    shift.corrected_at = new Date().toISOString();
    const index = staffShiftHistory.value.findIndex(
      (item) => item.id === shift.id,
    );
    if (index === -1) staffShiftHistory.value.unshift(shift);
    else staffShiftHistory.value[index] = shift;
    if (currentStaffShift.value?.id === shift.id) {
      currentStaffShift.value = shift;
    }
    if (data.force) {
      clearStoredShiftToken();
      staffShiftToken.value = "";
    }
    return shift;
  }

  async function fetchStaffAnalytics(params: {
    period?: "day" | "month" | "year" | "custom";
    month?: string;
    date?: string;
    year?: string | number;
    from?: string;
    to?: string;
    employeeId?: string;
  } = {}) {
    const requestSequence = ++staffAnalyticsRequestSequence;
    staffAnalyticsLoading.value = true;
    staffAnalyticsError.value = "";
    try {
      const query = new URLSearchParams();
      if (params.period) query.set("period", params.period);
      if (params.month) query.set("month", params.month);
      if (params.date) query.set("date", params.date);
      if (params.year) query.set("year", String(params.year));
      if (params.from) query.set("from", params.from);
      if (params.to) query.set("to", params.to);
      if (params.employeeId) query.set("employee_id", params.employeeId);
      const suffix = query.toString() ? `?${query}` : "";
      const response = await staffFetchAPI<
        StaffAnalytics | { analytics: StaffAnalytics }
      >(`${API_BASE}/staff/analytics${suffix}`);
      const analytics = normalizeStaffAnalytics(
        "analytics" in response ? response.analytics : response,
      );
      if (requestSequence !== staffAnalyticsRequestSequence) {
        return staffAnalytics.value;
      }
      staffAnalytics.value = analytics;
      if (
        staffAnalytics.value.employee &&
        staffAnalytics.value.employee.id ===
          staffIdentity.value?.employee.id
      ) {
        setStaffIdentityFromPayload({ employee: staffAnalytics.value.employee });
      }
      return staffAnalytics.value;
    } catch (error: any) {
      if (requestSequence === staffAnalyticsRequestSequence) {
        staffAnalyticsError.value =
          error?.message || "Не удалось загрузить показатели";
      }
      throw error;
    } finally {
      if (requestSequence === staffAnalyticsRequestSequence) {
        staffAnalyticsLoading.value = false;
      }
    }
  }

  /**
   * Показатели за предыдущий период. Нужны только для дельт рядом с метриками,
   * поэтому ошибка тут не всплывает наверх: без сравнения раздел работает как раньше.
   */
  async function fetchStaffAnalyticsPrevious(params: {
    period?: "day" | "month" | "year" | "custom";
    month?: string;
    date?: string;
    year?: string | number;
    from?: string;
    to?: string;
    employeeId?: string;
  } = {}) {
    const requestSequence = ++staffAnalyticsPreviousRequestSequence;
    try {
      const query = new URLSearchParams();
      if (params.period) query.set("period", params.period);
      if (params.month) query.set("month", params.month);
      if (params.date) query.set("date", params.date);
      if (params.year) query.set("year", String(params.year));
      if (params.from) query.set("from", params.from);
      if (params.to) query.set("to", params.to);
      if (params.employeeId) query.set("employee_id", params.employeeId);
      const suffix = query.toString() ? `?${query}` : "";
      const response = await staffFetchAPI<
        StaffAnalytics | { analytics: StaffAnalytics }
      >(`${API_BASE}/staff/analytics${suffix}`);
      const analytics = normalizeStaffAnalytics(
        "analytics" in response ? response.analytics : response,
      );
      if (requestSequence !== staffAnalyticsPreviousRequestSequence) {
        return staffAnalyticsPrevious.value;
      }
      staffAnalyticsPrevious.value = analytics;
      return staffAnalyticsPrevious.value;
    } catch {
      if (requestSequence === staffAnalyticsPreviousRequestSequence) {
        staffAnalyticsPrevious.value = null;
      }
      return null;
    }
  }

  async function fetchStaffTeamAnalytics(params: {
    period?: "day" | "month" | "year" | "custom";
    month?: string;
    date?: string;
    year?: string | number;
    from?: string;
    to?: string;
  } = {}) {
    const requestSequence = ++staffTeamAnalyticsRequestSequence;
    staffTeamAnalyticsLoading.value = true;
    staffTeamAnalyticsError.value = "";
    try {
      const query = new URLSearchParams();
      if (params.period) query.set("period", params.period);
      if (params.month) query.set("month", params.month);
      if (params.date) query.set("date", params.date);
      if (params.year) query.set("year", String(params.year));
      if (params.from) query.set("from", params.from);
      if (params.to) query.set("to", params.to);
      const suffix = query.toString() ? `?${query}` : "";
      const response = await staffFetchAPI<{
        employees?: StaffAnalytics[];
      }>(`${API_BASE}/staff/analytics/team${suffix}`);
      const employees = (response.employees || []).map(normalizeStaffAnalytics);
      if (requestSequence !== staffTeamAnalyticsRequestSequence) {
        return staffTeamAnalytics.value;
      }
      staffTeamAnalytics.value = employees;
      return staffTeamAnalytics.value;
    } catch (error: any) {
      if (requestSequence === staffTeamAnalyticsRequestSequence) {
        staffTeamAnalyticsError.value =
          error?.message || "Не удалось загрузить показатели команды";
      }
      throw error;
    } finally {
      if (requestSequence === staffTeamAnalyticsRequestSequence) {
        staffTeamAnalyticsLoading.value = false;
      }
    }
  }

  async function fetchStaffTasks(params: {
    status?: string;
    employeeId?: string;
  } = {}) {
    if (!staffToken.value) {
      staffTasks.value = [];
      return [];
    }
    const requestSequence = ++staffTasksRequestSequence;
    staffTasksLoading.value = true;
    staffTasksError.value = "";
    try {
      const query = new URLSearchParams();
      if (params.status) query.set("status", params.status);
      if (params.employeeId) query.set("employee_id", params.employeeId);
      const suffix = query.toString() ? `?${query}` : "";
      const response = await staffFetchAPI<
        StaffTask[] | { tasks?: StaffTask[]; items?: StaffTask[]; data?: StaffTask[] }
      >(`${API_BASE}/staff/tasks${suffix}`);
      const tasks = listFromPayload(
        response,
        !Array.isArray(response) ? response.tasks : undefined,
      ).map(normalizeStaffTask);
      if (requestSequence !== staffTasksRequestSequence) {
        return staffTasks.value;
      }
      staffTasks.value = tasks;
      return staffTasks.value;
    } catch (error: any) {
      if (requestSequence === staffTasksRequestSequence) {
        staffTasksError.value =
          error?.message || "Не удалось загрузить задачи";
      }
      throw error;
    } finally {
      if (requestSequence === staffTasksRequestSequence) {
        staffTasksLoading.value = false;
      }
    }
  }

  async function fetchStaffTaskHistory(id: string) {
    return staffFetchAPI<{
      task: StaffTask;
      history: Array<Record<string, any>>;
    }>(`${API_BASE}/staff/tasks/${id}/history`);
  }

  async function createStaffTask(data: {
    title: string;
    description?: string;
    priority?: string;
    due_at?: string | null;
    employee_id?: string | null;
  }) {
    const body = {
      title: data.title,
      description: data.description,
      due_at: data.due_at,
      // Пусто значит свободная задача, её сможет взять любой на смене.
      ...(data.employee_id ? { employee_id: data.employee_id } : {}),
    };
    const pending = pendingMutationKey("staff.task.create", body);
    const response = await staffFetchAPI<StaffTask | { task: StaffTask }>(
      `${API_BASE}/staff/tasks`,
      {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: JSON.stringify(body),
      },
    );
    pendingMutationKeys.delete(pending.signature);
    const task = normalizeStaffTask(
      "task" in response ? response.task : response,
    );
    staffTasksRequestSequence += 1;
    staffTasksLoading.value = false;
    staffTasksError.value = "";
    staffTasks.value = [task, ...staffTasks.value];
    return task;
  }

  async function performStaffTaskAction(
    id: string,
    action: "claim" | "submit" | "approve" | "cancel" | "release",
    data: Record<string, unknown> = {},
  ) {
    const pending = pendingMutationKey(
      `staff.task.${id}.${action}`,
      data,
    );
    const response = await staffFetchAPI<StaffTask | { task: StaffTask }>(
      `${API_BASE}/staff/tasks/${id}/${action}`,
      {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: JSON.stringify(data),
      },
    );
    pendingMutationKeys.delete(pending.signature);
    const task = normalizeStaffTask(
      "task" in response ? response.task : response,
    );
    staffTasksRequestSequence += 1;
    staffTasksLoading.value = false;
    staffTasksError.value = "";
    const index = staffTasks.value.findIndex((item) => item.id === id);
    if (index === -1) staffTasks.value.unshift(task);
    else staffTasks.value[index] = task;
    return task;
  }

  async function fetchStaffSalaries(params: {
    month?: string;
    employeeId?: string;
  } = {}) {
    const requestSequence = ++staffSalaryRequestSequence;
    staffSalariesLoading.value = true;
    staffSalariesError.value = "";
    try {
      const loadOne = async (employeeId?: string) => {
        const query = new URLSearchParams();
        if (params.month) query.set("month", params.month);
        if (employeeId) query.set("employee_id", employeeId);
        const suffix = query.toString() ? `?${query}` : "";
        const response = await staffFetchAPI<
          StaffSalary[] | {
            salary?: StaffSalary | null;
            salaries?: StaffSalary[];
            items?: StaffSalary[];
            data?: StaffSalary[];
          }
        >(`${API_BASE}/staff/salaries${suffix}`);
        if (!Array.isArray(response) && "salary" in response) {
          return response.salary ? [normalizeStaffSalary(response.salary)] : [];
        }
        return listFromPayload(
          response,
          !Array.isArray(response) ? response.salaries : undefined,
        ).map(normalizeStaffSalary);
      };
      if (
        !params.employeeId &&
        isStaffManager.value &&
        staffEmployees.value.length
      ) {
        const salaries = (
          await Promise.all(
            staffEmployees.value
              .map((employee) => loadOne(employee.id)),
          )
        ).flat();
        if (requestSequence !== staffSalaryRequestSequence) {
          return staffSalaries.value;
        }
        staffSalaries.value = salaries;
      } else {
        const salaries = await loadOne(params.employeeId);
        if (requestSequence !== staffSalaryRequestSequence) {
          return staffSalaries.value;
        }
        staffSalaries.value = salaries;
      }
      return staffSalaries.value;
    } catch (error: any) {
      if (requestSequence === staffSalaryRequestSequence) {
        staffSalariesError.value =
          error?.message || "Не удалось загрузить зарплаты";
      }
      throw error;
    } finally {
      if (requestSequence === staffSalaryRequestSequence) {
        staffSalariesLoading.value = false;
      }
    }
  }

  async function saveStaffSalary(data: StaffSalary) {
    const response = await staffFetchAPI<
      StaffSalary | { salary: StaffSalary }
    >(`${API_BASE}/staff/salaries`, {
      method: "PUT",
      body: JSON.stringify({
        employee_id: data.employee_id,
        month: data.month,
        amount:
          data.final_amount ??
          data.amount ??
          (data.amount_minor == null ? 0 : Number(data.amount_minor) / 100),
        note: data.note,
      }),
    });
    const salary = normalizeStaffSalary(
      "salary" in response ? response.salary : response,
    );
    const index = staffSalaries.value.findIndex(
      (item) =>
        item.employee_id === salary.employee_id && item.month === salary.month,
    );
    if (index === -1) staffSalaries.value.unshift(salary);
    else staffSalaries.value[index] = salary;
    return salary;
  }

  async function fetchStaffSalaryHistory(id: string) {
    const response = await staffFetchAPI<{
      salary: StaffSalary;
      versions: StaffHistoryVersion[];
    }>(`${API_BASE}/staff/salaries/${id}/history`);
    return {
      salary: normalizeStaffSalary(response.salary),
      versions: response.versions || [],
    };
  }

  async function fetchStaffMarks(params: {
    month?: string;
    employeeId?: string;
  } = {}) {
    const requestSequence = ++staffMarksRequestSequence;
    staffMarksLoading.value = true;
    staffMarksError.value = "";
    try {
      const query = new URLSearchParams();
      if (params.month) query.set("month", params.month);
      if (params.employeeId) query.set("employee_id", params.employeeId);
      const suffix = query.toString() ? `?${query}` : "";
      const response = await staffFetchAPI<
        StaffMark[] | { marks?: StaffMark[]; items?: StaffMark[]; data?: StaffMark[] }
      >(`${API_BASE}/staff/marks${suffix}`);
      const marks = listFromPayload(
        response,
        !Array.isArray(response) ? response.marks : undefined,
      ).map(normalizeStaffMark);
      if (requestSequence !== staffMarksRequestSequence) {
        return staffMarks.value;
      }
      staffMarks.value = marks;
      return staffMarks.value;
    } catch (error: any) {
      if (requestSequence === staffMarksRequestSequence) {
        staffMarksError.value = error?.message || "Не удалось загрузить отметки";
      }
      throw error;
    } finally {
      if (requestSequence === staffMarksRequestSequence) {
        staffMarksLoading.value = false;
      }
    }
  }

  async function createStaffMark(data: {
    employee_id: string;
    kind: "positive" | "negative";
    title: string;
    description?: string;
    occurred_at?: string;
  }) {
    const payload = {
      ...data,
      mark_type: data.kind,
      happened_at: data.occurred_at,
    };
    const pending = pendingMutationKey("staff.mark.create", payload);
    const response = await staffFetchAPI<StaffMark | { mark: StaffMark }>(
      `${API_BASE}/staff/marks`,
      {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: JSON.stringify(payload),
      },
    );
    pendingMutationKeys.delete(pending.signature);
    const mark = normalizeStaffMark(
      "mark" in response ? response.mark : response,
    );
    staffMarks.value = [
      mark,
      ...staffMarks.value.filter((item) => item.id !== mark.id),
    ];
    return mark;
  }

  async function fetchStaffMarkHistory(id: string) {
    const response = await staffFetchAPI<{
      mark: StaffMark;
      versions: StaffHistoryVersion[];
    }>(`${API_BASE}/staff/marks/${id}/history`);
    return {
      mark: normalizeStaffMark(response.mark),
      versions: response.versions || [],
    };
  }

  async function updateStaffMark(
    id: string,
    data: Partial<
      Pick<
        StaffMark,
        "kind" | "title" | "description" | "occurred_at" | "void_reason"
      >
    > & { voided?: boolean; expected_version: number },
  ) {
    const payload = {
      ...data,
      mark_type: data.kind,
      happened_at: data.occurred_at,
    };
    const pending = pendingMutationKey(`staff.mark.update:${id}`, payload);
    const response = await staffFetchAPI<StaffMark | { mark: StaffMark }>(
      `${API_BASE}/staff/marks/${id}`,
      {
        method: "PATCH",
        headers: { "Idempotency-Key": pending.key },
        body: JSON.stringify(payload),
      },
    );
    pendingMutationKeys.delete(pending.signature);
    const mark = normalizeStaffMark(
      "mark" in response ? response.mark : response,
    );
    const index = staffMarks.value.findIndex((item) => item.id === id);
    if (index !== -1) staffMarks.value[index] = mark;
    return mark;
  }

  async function fetchStaffNotifications() {
    if (!staffToken.value) {
      staffNotifications.value = null;
      return null;
    }
    staffNotificationsLoading.value = true;
    staffNotificationsError.value = "";
    try {
      const response = await staffFetchAPI<StaffNotificationsPayload>(
        `${API_BASE}/staff/notifications`,
      );
      staffNotifications.value = response;
      return staffNotifications.value;
    } catch (error: any) {
      staffNotificationsError.value =
        error?.message || "Не удалось загрузить уведомления";
      throw error;
    } finally {
      staffNotificationsLoading.value = false;
    }
  }

  async function updateStaffNotificationSettings(
    settings: Array<{ event_group: string; enabled: boolean }>,
  ) {
    const response = await staffFetchAPI<{
      settings?: Array<Record<string, unknown>>;
    }>(`${API_BASE}/staff/notifications/settings`, {
      method: "PUT",
      body: JSON.stringify({ settings }),
    });
    staffNotifications.value = {
      ...(staffNotifications.value || {}),
      settings: response.settings || [],
    };
    return response.settings || [];
  }

  async function saveStaffNotificationTemplate(eventType: string, text: string) {
    const response = await staffFetchAPI<{
      templates?: StaffNotificationTemplate[];
    }>(
      `${API_BASE}/staff/notifications/templates/${encodeURIComponent(eventType)}`,
      { method: "PUT", body: JSON.stringify({ text }) },
    );
    staffNotifications.value = {
      ...(staffNotifications.value || {}),
      templates: response.templates || [],
    };
    return response.templates || [];
  }

  async function previewStaffNotificationTemplate(text: string) {
    const response = await staffFetchAPI<{ preview: string }>(
      `${API_BASE}/staff/notifications/templates/preview`,
      { method: "POST", body: JSON.stringify({ text }) },
    );
    return response.preview;
  }

  async function resolveStaffNotificationRecipient(username: string) {
    return staffFetchAPI<{
      telegram_id: string;
      telegram_username: string;
      display_name: string;
    }>(`${API_BASE}/staff/notifications/resolve-recipient`, {
      method: "POST",
      body: JSON.stringify({ username }),
    });
  }

  async function addStaffNotificationRecipient(data: {
    event_group: string;
    telegram_id: string;
    telegram_username: string;
  }) {
    await staffFetchAPI(`${API_BASE}/staff/notifications/recipients`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return fetchStaffNotifications();
  }

  async function removeStaffNotificationRecipient(
    id: string | number,
    confirmation: { telegram_id: string; telegram_username: string },
  ) {
    await staffFetchAPI(
      `${API_BASE}/staff/notifications/recipients/${id}`,
      {
        method: "DELETE",
        body: JSON.stringify(confirmation),
      },
    );
    return fetchStaffNotifications();
  }

  async function resumeStaffNotification(
    id: string | number,
    reason: string,
  ) {
    await staffFetchAPI(
      `${API_BASE}/staff/notifications/outbox/${id}/resume`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
    return fetchStaffNotifications();
  }

  async function refreshStaffWorkspace(options: { quiet?: boolean } = {}) {
    if (!staffToken.value) return;
    const requests: Array<Promise<unknown>> = [
      fetchStaffShift(),
      fetchStaffTasks(),
    ];
    if (isStaffManager.value) {
      requests.push(fetchStaffNotifications());
    } else {
      staffNotifications.value = null;
      staffNotificationsError.value = "";
    }
    const results = await Promise.allSettled(requests);
    if (!options.quiet) {
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
  }

  // Customers
  const customers = ref<Customer[]>([]);
  const currentCustomer = ref<Customer | null>(null);
  const loadingCustomers = ref(false);
  let customersRequestId = 0;

  // Customer Feedbacks
  const customerFeedbacks = ref<CustomerFeedback[]>([]);
  const loadingCustomerFeedbacks = ref(false);

  async function fetchCustomers(
    filter?: "inactive" | "cold",
    options: { limit?: number; query?: string; unprocessed?: boolean } = {},
  ) {
    const requestId = ++customersRequestId;
    loadingCustomers.value = true;
    try {
      const params = new URLSearchParams();
      if (filter) params.set("filter", filter);
      if (options.limit) params.set("limit", String(options.limit));
      if (options.query) params.set("q", options.query);
      if (options.unprocessed) params.set("unprocessed", "1");
      const suffix = params.size ? `?${params.toString()}` : "";
      const result = await fetchAPI<Customer[]>(`${API_BASE}/customers${suffix}`);
      if (requestId === customersRequestId) customers.value = result;
    } finally {
      if (requestId === customersRequestId) loadingCustomers.value = false;
    }
  }

  async function fetchCustomer(id: string) {
    currentCustomer.value = await fetchAPI<Customer>(
      `${API_BASE}/customers/${id}`,
    );
    return currentCustomer.value;
  }

  async function updateCustomer(
    id: string,
    data: { notes?: string; phone?: string },
  ) {
    const customer = await fetchAPI<Customer>(`${API_BASE}/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    const index = customers.value.findIndex((c) => c.id === id);
    if (index !== -1) {
      customers.value[index] = customer;
    }
    return customer;
  }

  async function blockCustomer(id: string, reason: string) {
    await fetchAPI(`${API_BASE}/customers/${id}/block`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    await fetchCustomer(id);
  }

  async function unblockCustomer(id: string) {
    await fetchAPI(`${API_BASE}/customers/${id}/unblock`, {
      method: "POST",
    });
    await fetchCustomer(id);
  }

  // ===== Универсальные блокировки клиентов (новый API) =====
  const customerBlocksList = ref<{
    active: ActiveCustomerBlock[];
    pending: PendingCustomerBlock[];
  }>({ active: [], pending: [] });
  const loadingCustomerBlocks = ref(false);

  async function fetchCustomerBlocksList() {
    loadingCustomerBlocks.value = true;
    try {
      customerBlocksList.value = await fetchAPI<{
        active: ActiveCustomerBlock[];
        pending: PendingCustomerBlock[];
      }>(`${API_BASE}/blocks`);
      return customerBlocksList.value;
    } finally {
      loadingCustomerBlocks.value = false;
    }
  }

  async function createCustomerBlock(payload: CreateCustomerBlockPayload) {
    const result = await fetchAPI<{
      ok: true;
      kind: "active" | "pending";
      block: ActiveCustomerBlock | PendingCustomerBlock;
    }>(`${API_BASE}/blocks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return result;
  }

  async function removeCustomerBlock(blockId: string | number, unblock_reason?: string) {
    return fetchAPI<{ ok: true; kind: "unblocked" | "pending_removed" }>(
      `${API_BASE}/blocks/${blockId}`,
      {
        method: "DELETE",
        body: JSON.stringify({ unblock_reason: unblock_reason ?? null }),
      },
    );
  }

  // ===== Заметки о клиентах (канбан) =====
  function patchCustomerNotesOnOrders(customerId: string, notes: string | null) {
    if (!customerId) return;
    orders.value = orders.value.map((order) =>
      order.customer_id === customerId
        ? { ...order, customer_notes: notes }
        : order,
    );
  }

  async function upsertCustomerNote(payload: {
    customer_id?: string;
    telegram_username?: string;
    notes: string;
  }) {
    const result = await fetchAPI<{
      ok: true;
      kind: "active" | "pending" | "pending_cleared";
      notes?: string | null;
      customer?: { id: string; notes: string | null; telegram_username: string | null };
      pending?: PendingCustomerNote;
      removed?: number;
    }>(`${API_BASE}/customer-notes`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (result.kind === "active" && result.customer?.id) {
      patchCustomerNotesOnOrders(
        result.customer.id,
        result.notes ?? result.customer.notes ?? null,
      );
      if (latestOrderActivityAt.value) {
        try {
          await syncKanbanBoardSince(latestOrderActivityAt.value);
        } catch {
          /* board-sync best-effort */
        }
      }
    }
    return result;
  }

  async function clearCustomerNote(payload: {
    customer_id?: string;
    telegram_username?: string;
    pending_id?: number;
  }) {
    const result = await fetchAPI<{
      ok: true;
      kind: string;
      customer?: { id: string; notes: string | null };
    }>(`${API_BASE}/customer-notes`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
    const customerId =
      payload.customer_id ||
      (result as { customer?: { id: string } }).customer?.id;
    if (customerId) {
      patchCustomerNotesOnOrders(customerId, null);
    }
    return result;
  }

  async function fetchPendingCustomerNotes(limit = 100) {
    const result = await fetchAPI<{ pending: PendingCustomerNote[] }>(
      `${API_BASE}/customer-notes/pending?limit=${limit}`,
    );
    return result.pending;
  }

  // ===== POS-клиенты (касса): поиск, создание/merge, история покупок =====

  async function searchCustomersForPos(
    q: string,
    limit = 20,
    options: { includeRecent?: boolean; allCustomers?: boolean } = {},
  ) {
    const trimmed = (q || "").trim();
    // includeRecent=true → бэк возвращает последних клиентов при пустом q
    // (для постоянно видимого «блокнота» на кассирском экране).
    if (!trimmed && !options.includeRecent) return [] as Customer[];
    const params = new URLSearchParams({ q: trimmed, limit: String(limit) });
    if (options.includeRecent) params.set("recent", "1");
    // По умолчанию POS-блокнот показывает только клиентов проходняка
    // (без telegram_id или с pos_sales). Костин TZ — «база на проходняк»,
    // онлайн-клиенты Mini App там лишние. Передай allCustomers=true чтобы
    // отключить фильтр (если функция переиспользуется в общем CRM-поиске).
    if (!options.allCustomers) params.set("pos_only", "1");
    const result = await fetchAPI<{ items: Customer[] }>(
      `${API_BASE}/customers/search?${params.toString()}`,
    );
    return result.items;
  }

  async function createPosCustomer(payload: { name: string; phone: string }) {
    return fetchAPI<{ ok: true; customer: Customer; merged: boolean }>(
      `${API_BASE}/pos-customers`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  }

  /**
   * Soft-delete клиента из блокнота кассы. Запись остаётся в БД, история
   * чеков сохраняется, но клиент пропадает из всех списков-выдач.
   * Используется кнопкой «Удалить» в PosCustomerPanel.
   */
  async function deletePosCustomer(customerId: string) {
    return fetchAPI<{ ok: true; removed: number }>(
      `${API_BASE}/pos-customers/${encodeURIComponent(customerId)}`,
      { method: "DELETE" },
    );
  }

  async function fetchCustomerPurchaseHistory(customerId: string, limit = 50) {
    const params = new URLSearchParams({ limit: String(limit) });
    const result = await fetchAPI<{
      items: Array<{
        id: string;
        source: "order" | "pos";
        number: number | null;
        amount: number;
        status: string;
        created_at: string;
        completed_at: string | null;
      }>;
    }>(`${API_BASE}/customers/${customerId}/purchases?${params.toString()}`);
    return result.items;
  }

  async function deleteCustomer(id: string) {
    await fetchAPI(`${API_BASE}/customers/${id}`, {
      method: "DELETE",
    });
    customers.value = customers.value.filter((c) => c.id !== id);
  }

  // Customer Feedbacks
  async function fetchCustomerFeedbacks() {
    loadingCustomerFeedbacks.value = true;
    try {
      customerFeedbacks.value = await fetchAPI<CustomerFeedback[]>(
        `${API_BASE}/customer-feedbacks`,
      );
    } finally {
      loadingCustomerFeedbacks.value = false;
    }
  }

  async function createCustomerFeedback(data: {
    customer_id: string;
    reason: string;
  }) {
    const feedback = await fetchAPI<CustomerFeedback>(
      `${API_BASE}/customer-feedbacks`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    customerFeedbacks.value.unshift(feedback);
    return feedback;
  }

  async function deleteCustomerFeedback(id: string) {
    await fetchAPI(`${API_BASE}/customer-feedbacks/${id}`, {
      method: "DELETE",
    });
    customerFeedbacks.value = customerFeedbacks.value.filter(
      (f) => f.id !== id,
    );
  }

  // Orders (shallowRef — большие списки без deep-reactivity на каждую позицию)
  const orders = shallowRef<Order[]>([]);
  const currentOrder = ref<Order | null>(null);
  const loadingOrders = ref(false);
  const ordersPagination = ref({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const pickupCells = ref<PickupCellsState>({
    capacity: 50,
    occupied: 0,
    available: 50,
    cells: [],
  });
  const loadingPickupCells = ref(false);

  async function fetchPickupCells() {
    loadingPickupCells.value = true;
    try {
      pickupCells.value = await fetchAPI<PickupCellsState>(
        `${API_BASE}/pickup-cells`,
      );
      return pickupCells.value;
    } finally {
      loadingPickupCells.value = false;
    }
  }

  async function updatePickupCellCapacity(capacity: number) {
    pickupCells.value = await fetchAPI<PickupCellsState>(
      `${API_BASE}/pickup-cells/settings`,
      { method: "PATCH", body: JSON.stringify({ capacity }) },
    );
    return pickupCells.value;
  }

  type KanbanBoardSyncResponse = {
    latestOrderActivityAt: string | null;
    boardOrderIds: string[];
    changedOrderIds: string[];
    removedOrderIds: string[];
    orders: Order[];
  };

  function upsertOrdersInList(updated: Order[]) {
    if (!updated.length) return;
    const byId = new Map(orders.value.map((order) => [order.id, order]));
    for (const order of updated) {
      byId.set(order.id, order);
    }
    orders.value = Array.from(byId.values());
  }

  function removeOrdersFromList(orderIds: string[]) {
    if (!orderIds.length) return;
    const remove = new Set(orderIds);
    orders.value = orders.value.filter((order) => !remove.has(order.id));
  }

  async function fetchKanbanBoard(params?: {
    background?: boolean;
    limit?: number;
  }) {
    const background = params?.background === true;
    if (!background) {
      loadingOrders.value = true;
    }
    try {
      const query = new URLSearchParams();
      if (params?.limit) query.append("limit", params.limit.toString());
      const response = await fetchAPI<{
        orders: Order[];
        pagination: typeof ordersPagination.value;
      }>(`${API_BASE}/orders/board?${query}`);
      orders.value = response.orders;
      ordersPagination.value = response.pagination;
    } finally {
      if (!background) {
        loadingOrders.value = false;
      }
    }
  }

  async function syncKanbanBoardSince(activitySince: string) {
    const query = new URLSearchParams();
    query.append("since", activitySince);
    const sync = await fetchAPI<KanbanBoardSyncResponse>(
      `${API_BASE}/orders/board-sync?${query}`,
    );
    removeOrdersFromList(sync.removedOrderIds || []);
    upsertOrdersInList(sync.orders || []);
    if (sync.latestOrderActivityAt) {
      latestOrderActivityAt.value = sync.latestOrderActivityAt;
    }
  }

  async function fetchOrders(params?: {
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
    /** Не скрывать канбан спиннером — фоновое обновление (poll, кнопка «Обновить»). */
    background?: boolean;
  }) {
    const background = params?.background === true;
    if (!background) {
      loadingOrders.value = true;
    }
    try {
      const query = new URLSearchParams();
      if (params?.status) query.append("status", params.status);
      if (params?.page) query.append("page", params.page.toString());
      if (params?.limit) query.append("limit", params.limit.toString());
      if (params?.search) query.append("search", params.search);

      const response = await fetchAPI<{
        orders: Order[];
        pagination: typeof ordersPagination.value;
      }>(`${API_BASE}/orders?${query}`);
      orders.value = response.orders;
      ordersPagination.value = response.pagination;
    } finally {
      if (!background) {
        loadingOrders.value = false;
      }
    }
  }

  async function fetchOrder(id: string) {
    currentOrder.value = await fetchAPI<Order>(`${API_BASE}/orders/${id}`);
    return currentOrder.value;
  }

  async function fetchOrderHistory(id: string) {
    return await fetchAPI<Array<{
      id: string;
      order_id: string;
      previous_status: string | null;
      new_status: string;
      changed_at: string;
      note: string | null;
    }>>(`${API_BASE}/orders/${id}/history`);
  }

  const deliveredOrders = ref<Order[]>([]);
  const loadingDelivered = ref(false);
  const deliveredStats = ref<{
    totalCount: number;
    totalAmount: number;
    deliveryCount: number;
    deliveryAmount: number;
    pickupCount: number;
    pickupAmount: number;
  } | null>(null);
  const deliveredPagination = ref<{ page: number; limit: number; total: number; totalPages: number } | null>(null);

  async function fetchDeliveredOrders(params?: { page?: number; limit?: number; search?: string; period?: string }) {
    loadingDelivered.value = true;
    try {
      const query = new URLSearchParams();
      if (params?.page) query.append("page", params.page.toString());
      if (params?.limit) query.append("limit", params.limit.toString());
      if (params?.search) query.append("search", params.search);
      if (params?.period) query.append("period", params.period);
      const response = await fetchAPI<{
        orders: Order[];
        stats: typeof deliveredStats.value;
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(
        `${API_BASE}/orders/delivered?${query}`,
      );
      if (params?.page && params.page > 1) {
        deliveredOrders.value = [...deliveredOrders.value, ...response.orders];
      } else {
        deliveredOrders.value = response.orders;
      }
      deliveredStats.value = response.stats;
      deliveredPagination.value = response.pagination;
      return response;
    } finally {
      loadingDelivered.value = false;
    }
  }

  async function createOrder(data: {
    idempotency_key?: string;
    customer_id?: string;
    delivery_type: "pickup" | "delivery";
    delivery_address?: string;
    discount_amount?: number;
    discount_percent?: number;
    notes?: string;
    items: Array<{
      product_id: string;
      variant_id?: string | null;
      quantity: number;
      price_per_unit?: number;
      discount_amount?: number;
      manual_discount_amount?: number;
      loyalty_discount_amount?: number;
      loyalty_units_applied?: number;
      variant_name?: string | null;
    }>;
  }) {
    const { idempotency_key, ...payload } = data;
    const pending = pendingMutationKey("order.create", payload);
    const order = await fetchAPI<Order>(`${API_BASE}/orders`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotency_key || pending.key },
      body: JSON.stringify(payload),
    });
    pendingMutationKeys.delete(pending.signature);
    orders.value = [order, ...orders.value];
    return order;
  }

  function upsertOrderInList(order: Order) {
    if (!isKanbanBoardOrder(order)) {
      removeOrdersFromList([order.id]);
      return;
    }
    const index = orders.value.findIndex((item) => item.id === order.id);
    if (index === -1) {
      orders.value = [order, ...orders.value];
      return;
    }
    orders.value = orders.value.map((item, i) => (i === index ? order : item));
  }

  async function updateOrder(
    id: string,
    data: {
      status?: string;
      delivery_address?: string | null;
      notes?: string | null;
      discount_amount?: number;
      discount_percent?: number;
      items?: Array<{
        product_id: string;
        variant_id?: string | null;
        quantity: number;
        price_per_unit?: number;
        discount_amount?: number;
        manual_discount_amount?: number;
        loyalty_discount_amount?: number;
        loyalty_units_applied?: number;
        variant_name?: string | null;
      }>;
      payment_type?: "cash" | "card";
      payment_account_id?: string;
      paid_amount?: number;
      payment_notes?: string;
      reactivate?: boolean;
      actor_employee_id?: string;
      actor_pin?: string;
    },
  ) {
    const response = await fetchAPI<Order & { auto_notification?: AutoNotificationResult | null }>(
      `${API_BASE}/orders/${id}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
    // Отделяем технический результат авто-уведомления от полей самого заказа,
    // чтобы он не утекал в orders.value (там должен лежать чистый Order).
    const { auto_notification: autoNotification, ...order } = response;
    upsertOrderInList(order as Order);
    return { ...(order as Order), auto_notification: autoNotification ?? null };
  }

  async function resolveManagerAction(id: string) {
    const order = await fetchAPI<Order>(`${API_BASE}/orders/${id}/resolve-action`, {
      method: "POST",
    });
    upsertOrderInList(order);
    // Remove from unseen action ids
    if (unseenActionIds.value.has(id)) {
      unseenActionIds.value.delete(id);
      unseenActionIds.value = new Set(unseenActionIds.value);
      actionRequiredCount.value = unseenActionIds.value.size;
    }
    return order;
  }

  async function issueOrder(
    id: string,
    data: {
      payment_type: "cash" | "card";
      payment_account_id?: string;
      amount: number;
      payment_notes?: string;
      actor_employee_id?: string;
      actor_pin?: string;
    },
  ) {
    const response = await fetchAPI<{
      order: Order;
      transaction: CashTransaction | null;
      // Бэкенд возвращает результат авто-уведомления клиенту (см.
      // server/routes/crm-operations.js POST /orders/:id/issue). Фронт
      // показывает по нему тост (CrmOrders.vue submitPayment), чтобы
      // менеджер сразу видел: «сообщение клиенту дошло» или причину фейла.
      auto_notification?: AutoNotificationResult | null;
    }>(`${API_BASE}/orders/${id}/issue`, {
      method: "POST",
      body: JSON.stringify({
        payment_type: data.payment_type,
        payment_account_id: data.payment_account_id,
        amount: data.amount,
        payment_notes: data.payment_notes,
        actor_employee_id: data.actor_employee_id,
        actor_pin: data.actor_pin,
      }),
    });

    upsertOrderInList(response.order);

    if (response.transaction) {
      cashTransactions.value.unshift(response.transaction);
    }
    return response;
  }

  async function deleteOrderPayment(id: string) {
    const order = await fetchAPI<Order>(`${API_BASE}/orders/${id}/payment`, {
      method: "DELETE",
    });

    upsertOrderInList(order);
    if (currentOrder.value?.id === id) {
      currentOrder.value = order;
    }

    return order;
  }

  // Procurements
  const procurements = ref<Procurement[]>([]);
  const currentProcurement = ref<Procurement | null>(null);
  const loadingProcurements = ref(false);
  const totalControlGroups = ref<TotalControlGroup[]>([]);
  const totalControlGroupsLoading = ref(false);
  const totalControlGroupsError = ref("");

  async function fetchTotalControlGroups() {
    totalControlGroupsLoading.value = true;
    totalControlGroupsError.value = "";
    try {
      const data = await fetchAPI<{ items: TotalControlGroup[] }>(
        `${API_BASE}/total-control-groups`,
      );
      totalControlGroups.value = Array.isArray(data?.items) ? data.items : [];
      return totalControlGroups.value;
    } catch (error) {
      totalControlGroupsError.value = totalControlGroups.value.length
        ? "Не удалось обновить остатки. Показаны последние загруженные данные."
        : "Не удалось загрузить сводку. Повторите попытку.";
      throw error;
    } finally {
      totalControlGroupsLoading.value = false;
    }
  }

  async function fetchProcurements() {
    loadingProcurements.value = true;
    try {
      procurements.value = await fetchAPI<Procurement[]>(
        `${API_BASE}/procurements`,
      );
    } finally {
      loadingProcurements.value = false;
    }
  }

  async function fetchProcurement(id: string) {
    currentProcurement.value = await fetchAPI<Procurement>(
      `${API_BASE}/procurements/${id}`,
    );
    return currentProcurement.value;
  }

  async function createProcurement(data: {
    idempotency_key?: string;
    supplier_name?: string;
    notes?: string;
    actor_employee_id?: string;
    actor_pin?: string;
    items: Array<{
      product_id: string;
      variant_id?: string;
      quantity: number;
      warehouse_quantity?: number;
      cost_per_unit: number;
    }>;
  }) {
    const { idempotency_key, ...payload } = data;
    const pending = pendingMutationKey("procurement.create", payload);
    const procurement = await fetchAPI<Procurement>(
      `${API_BASE}/procurements`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotency_key || pending.key },
        body: JSON.stringify(payload),
      },
    );
    pendingMutationKeys.delete(pending.signature);
    procurements.value.unshift(procurement);
    return procurement;
  }

  async function completeProcurement(
    id: string,
    actor: {
      actor_employee_id?: string;
      actor_pin?: string;
      idempotency_key?: string;
    } = {},
  ) {
    const { idempotency_key, ...body } = actor;
    const procurement = await fetchAPI<Procurement>(
      `${API_BASE}/procurements/${id}/complete`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotency_key || clientIdempotencyKey() },
        body: JSON.stringify(body),
      },
    );
    const index = procurements.value.findIndex((p) => p.id === id);
    if (index !== -1) {
      procurements.value[index] = procurement;
    }
    return procurement;
  }

  async function updateProcurement(
    id: string,
    data: {
      supplier_name?: string;
      notes?: string;
      actor_employee_id?: string;
      actor_pin?: string;
      items?: Array<{
        product_id: string;
        variant_id?: string;
        quantity: number;
        warehouse_quantity?: number;
        cost_per_unit: number;
      }>;
    },
  ) {
    const procurement = await fetchAPI<Procurement>(
      `${API_BASE}/procurements/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    const index = procurements.value.findIndex((p) => p.id === id);
    if (index !== -1) {
      procurements.value[index] = procurement;
    }
    if (currentProcurement.value?.id === id) {
      currentProcurement.value = procurement;
    }
    return procurement;
  }

  async function deleteProcurement(id: string) {
    await fetchAPI(`${API_BASE}/procurements/${id}`, { method: "DELETE" });
    procurements.value = procurements.value.filter((p) => p.id !== id);
    if (currentProcurement.value?.id === id) {
      currentProcurement.value = null;
    }
  }

  async function removeProcurementPayment(id: string) {
    const procurement = await fetchAPI<Procurement>(
      `${API_BASE}/procurements/${id}/payment`,
      {
        method: "DELETE",
      },
    );
    const index = procurements.value.findIndex((p) => p.id === id);
    if (index !== -1) {
      procurements.value[index] = procurement;
    }
    if (currentProcurement.value?.id === id) {
      currentProcurement.value = procurement;
    }
    return procurement;
  }

  // Write-offs
  const writeOffs = ref<WriteOff[]>([]);
  const currentWriteOff = ref<WriteOff | null>(null);
  const loadingWriteOffs = ref(false);

  async function fetchWriteOffs() {
    loadingWriteOffs.value = true;
    try {
      writeOffs.value = await fetchAPI<WriteOff[]>(`${API_BASE}/write-offs`);
    } finally {
      loadingWriteOffs.value = false;
    }
  }

  async function fetchWriteOff(id: string) {
    currentWriteOff.value = await fetchAPI<WriteOff>(
      `${API_BASE}/write-offs/${id}`,
    );
    return currentWriteOff.value;
  }

  async function createWriteOff(data: {
    reason: string;
    notes?: string;
    items: Array<{
      product_id: string;
      variant_id?: string;
      quantity: number;
    }>;
  }) {
    const writeOff = await fetchAPI<WriteOff>(`${API_BASE}/write-offs`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    writeOffs.value.unshift(writeOff);
    return writeOff;
  }

  async function updateWriteOff(
    id: string,
    data: {
      reason?: string;
      notes?: string;
      items?: Array<{
        product_id: string;
        variant_id?: string;
        quantity: number;
      }>;
    },
  ) {
    const writeOff = await fetchAPI<WriteOff>(`${API_BASE}/write-offs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });

    const index = writeOffs.value.findIndex((w) => w.id === id);
    if (index !== -1) {
      writeOffs.value[index] = writeOff;
    }
    if (currentWriteOff.value?.id === id) {
      currentWriteOff.value = writeOff;
    }

    return writeOff;
  }

  async function deleteWriteOff(id: string) {
    await fetchAPI(`${API_BASE}/write-offs/${id}`, { method: "DELETE" });
    writeOffs.value = writeOffs.value.filter((w) => w.id !== id);
    if (currentWriteOff.value?.id === id) {
      currentWriteOff.value = null;
    }
  }

  // Cash
  const cashAccounts = ref<CashAccount[]>([]);
  const cashTransactions = ref<CashTransaction[]>([]);
  const loadingCash = ref(false);

  async function fetchCashAccounts() {
    loadingCash.value = true;
    try {
      cashAccounts.value = await fetchAPI<CashAccount[]>(
        `${API_BASE}/cash-accounts`,
      );
    } finally {
      loadingCash.value = false;
    }
  }

  async function createCashAccount(data: {
    name: string;
    balance?: number;
    is_default?: boolean;
  }) {
    const account = await fetchAPI<CashAccount>(`${API_BASE}/cash-accounts`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    cashAccounts.value.push(account);
    return account;
  }

  async function updateCashAccount(
    id: string,
    data: { name?: string; is_default?: boolean },
  ) {
    const account = await fetchAPI<CashAccount>(
      `${API_BASE}/cash-accounts/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    const index = cashAccounts.value.findIndex((a) => a.id === id);
    if (index !== -1) {
      cashAccounts.value[index] = account;
    }
    return account;
  }

  async function deleteCashAccount(id: string) {
    await fetchAPI(`${API_BASE}/cash-accounts/${id}`, { method: "DELETE" });
    cashAccounts.value = cashAccounts.value.filter((a) => a.id !== id);
  }

  async function fetchCashTransactions(params?: {
    account_id?: string;
    type?: "income" | "expense";
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.account_id) query.append("account_id", params.account_id);
    if (params?.type) query.append("type", params.type);
    if (params?.limit) query.append("limit", params.limit.toString());
    if (params?.offset) query.append("offset", params.offset.toString());

    cashTransactions.value = await fetchAPI<CashTransaction[]>(
      `${API_BASE}/cash-transactions?${query}`,
    );
  }

  async function createCashTransaction(data: {
    account_id: string;
    type: "income" | "expense";
    amount: number;
    description?: string;
  }) {
    const transaction = await fetchAPI<CashTransaction>(
      `${API_BASE}/cash-transactions`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    cashTransactions.value.unshift(transaction);
    return transaction;
  }

  async function updateCashTransaction(
    id: string,
    data: {
      account_id?: string;
      type?: "income" | "expense";
      amount?: number;
      description?: string;
    },
  ) {
    const transaction = await fetchAPI<CashTransaction>(
      `${API_BASE}/cash-transactions/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    const index = cashTransactions.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      cashTransactions.value[index] = transaction;
    }
    await fetchCashAccounts();
    return transaction;
  }

  async function deleteCashTransaction(id: string) {
    await fetchAPI(`${API_BASE}/cash-transactions/${id}`, { method: "DELETE" });
    cashTransactions.value = cashTransactions.value.filter((t) => t.id !== id);
  }

  const cardPaymentAdminSnapshot = ref<CardPaymentAdminSnapshot | null>(null);
  const loadingCardPaymentAdmin = ref(false);
  // Последний найденный профиль клиента (окно «Оплата картой и лимиты»).
  // Обновляется поиском и action'ами cooldown, чтобы карточка была живой.
  const foundCardProfileRef = ref<CardAccountProfile | null>(null);

  async function searchCardProfile(username: string) {
    const profile = await fetchAPI<CardAccountProfile>(
      `${API_BASE}/card-payments/profile/${encodeURIComponent(username)}`,
    );
    foundCardProfileRef.value = profile;
    return profile;
  }

  async function fetchCardPaymentAdmin() {
    loadingCardPaymentAdmin.value = true;
    try {
      cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
        `${API_BASE}/card-payments`,
      );
      return cardPaymentAdminSnapshot.value;
    } finally {
      loadingCardPaymentAdmin.value = false;
    }
  }

  async function setCardMonthlyLimit(monthKey: string, amount: number) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/monthly-limit`,
      { method: "PUT", body: JSON.stringify({ month_key: monthKey, amount }) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function adjustCardDailyLimit(delta: number) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/daily-adjust`,
      { method: "POST", body: JSON.stringify({ delta }) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function addManualCardPayment(amount: number, note?: string) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/manual`,
      { method: "POST", body: JSON.stringify({ amount, note }) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function saveCardAccount(data: {
    telegram_username?: string;
    telegram_id?: string;
    enabled?: boolean;
    monthly_limit?: number;
    max_order?: number;
  }) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/accounts`,
      { method: "POST", body: JSON.stringify(data) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function updateCardAccount(
    telegramId: string,
    data: {
      telegram_username?: string;
      enabled?: boolean;
      monthly_limit?: number;
      max_order?: number;
    },
  ) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/accounts/${encodeURIComponent(telegramId)}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function setCardPermissionByTelegramId(telegramId: string, enabled: boolean) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/accounts/by-telegram-id/${encodeURIComponent(telegramId)}`,
      { method: "PUT", body: JSON.stringify({ enabled }) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function updateCardRequest(
    id: string,
    status: "new" | "processed" | "rejected",
    note?: string,
  ) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/requests/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status, note }) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function saveCardTariff(
    data: {
      id?: string;
      title: string;
      limit: number;
      monthly_limit?: number;
      per_order_limit?: number;
      transition_cost_text?: string;
      position?: number;
      active?: boolean;
    },
  ) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      data.id
        ? `${API_BASE}/card-payments/tariffs/${encodeURIComponent(data.id)}`
        : `${API_BASE}/card-payments/tariffs`,
      {
        method: data.id ? "PATCH" : "POST",
        body: JSON.stringify(data),
      },
    );
    return cardPaymentAdminSnapshot.value;
  }

  async function deleteCardTariff(id: string) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/tariffs/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return cardPaymentAdminSnapshot.value;
  }

  // Применить тариф к аккаунту: лимиты меняются автоматически.
  // tariffId === null — сброс на стандартные лимиты.
  async function applyCardTariff(telegramId: string, tariffId: string | null) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/accounts/${encodeURIComponent(telegramId)}/tariff`,
      { method: "PUT", body: JSON.stringify({ tariff_id: tariffId }) },
    );
    return cardPaymentAdminSnapshot.value;
  }

  // Длительность паузы после выдачи (0 = паузы нет).
  async function setCardAccountCooldownDays(telegramId: string, days: number) {
    const response = await fetchAPI<{ ok: boolean; profile: CardAccountProfile }>(
      `${API_BASE}/card-payments/accounts/${encodeURIComponent(telegramId)}/cooldown-days`,
      { method: "PUT", body: JSON.stringify({ days }) },
    );
    if (response.profile) {
      foundCardProfileRef.value = response.profile;
    }
    return response;
  }

  // Принудительно снять активную паузу.
  async function clearCardAccountCooldown(telegramId: string) {
    const response = await fetchAPI<{ cleared: boolean; profile: CardAccountProfile | null }>(
      `${API_BASE}/card-payments/accounts/${encodeURIComponent(telegramId)}/clear-cooldown`,
      { method: "POST" },
    );
    if (response.profile) {
      foundCardProfileRef.value = response.profile;
    }
    return response;
  }

  // Одобрить заявку: лимиты тарифа применяются к аккаунту автоматически.
  async function approveCardRequest(id: string) {
    cardPaymentAdminSnapshot.value = await fetchAPI<CardPaymentAdminSnapshot>(
      `${API_BASE}/card-payments/requests/${encodeURIComponent(id)}/approve`,
      { method: "POST" },
    );
    return cardPaymentAdminSnapshot.value;
  }

  // Cash pacing
  const cashPacingMonths = ref<CashPacingMonthListItem[]>([]);
  const currentCashPacingMonth = ref<CashPacingMonthDetail | null>(null);
  const loadingCashPacing = ref(false);
  const suggestedCashPacingMonthKey = ref("");

  async function fetchCashPacingMonths() {
    loadingCashPacing.value = true;
    try {
      const response = await fetchAPI<{
        months: CashPacingMonthListItem[];
        suggested_month_key: string;
      }>(`${API_BASE}/cash-pacing/months`);
      cashPacingMonths.value = response.months;
      suggestedCashPacingMonthKey.value = response.suggested_month_key;
      return response;
    } finally {
      loadingCashPacing.value = false;
    }
  }

  async function fetchCashPacingMonth(id: string) {
    loadingCashPacing.value = true;
    try {
      const detail = await fetchAPI<CashPacingMonthDetail>(
        `${API_BASE}/cash-pacing/months/${id}`,
      );
      currentCashPacingMonth.value = detail;
      return detail;
    } finally {
      loadingCashPacing.value = false;
    }
  }

  async function createCashPacingMonth(data: {
    month_key: string;
    title?: string;
    notes?: string;
  }) {
    const detail = await fetchAPI<CashPacingMonthDetail>(
      `${API_BASE}/cash-pacing/months`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    currentCashPacingMonth.value = detail;
    await fetchCashPacingMonths();
    return detail;
  }

  async function updateCashPacingMonth(
    id: string,
    data: { title?: string; notes?: string },
  ) {
    const detail = await fetchAPI<CashPacingMonthDetail>(
      `${API_BASE}/cash-pacing/months/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    currentCashPacingMonth.value = detail;
    await fetchCashPacingMonths();
    return detail;
  }

  async function createCashPacingItem(
    monthId: string,
    data: {
      title: string;
      quantity: number;
      cost_with_vat: number;
      markup_percent: number;
      effective_from: string;
      entry_type?: "base" | "addition";
      note?: string;
    },
  ) {
    const detail = await fetchAPI<CashPacingMonthDetail>(
      `${API_BASE}/cash-pacing/months/${monthId}/items`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    currentCashPacingMonth.value = detail;
    await fetchCashPacingMonths();
    return detail;
  }

  async function updateCashPacingItem(
    itemId: string,
    data: {
      title?: string;
      quantity?: number;
      cost_with_vat?: number;
      markup_percent?: number;
      effective_from?: string;
      entry_type?: "base" | "addition";
      note?: string;
    },
  ) {
    const detail = await fetchAPI<CashPacingMonthDetail>(
      `${API_BASE}/cash-pacing/items/${itemId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    currentCashPacingMonth.value = detail;
    await fetchCashPacingMonths();
    return detail;
  }

  async function deleteCashPacingItem(itemId: string) {
    const detail = await fetchAPI<CashPacingMonthDetail>(
      `${API_BASE}/cash-pacing/items/${itemId}`,
      {
        method: "DELETE",
      },
    );
    currentCashPacingMonth.value = detail;
    await fetchCashPacingMonths();
    return detail;
  }

  async function upsertCashPacingDailyFact(
    monthId: string,
    data: {
      fact_date: string;
      actual_amount: number;
      note?: string;
    },
  ) {
    const detail = await fetchAPI<CashPacingMonthDetail>(
      `${API_BASE}/cash-pacing/months/${monthId}/daily-facts`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    currentCashPacingMonth.value = detail;
    await fetchCashPacingMonths();
    return detail;
  }

  async function deleteCashPacingDailyFact(monthId: string, factDate: string) {
    const detail = await fetchAPI<CashPacingMonthDetail>(
      `${API_BASE}/cash-pacing/months/${monthId}/daily-facts/${factDate}`,
      {
        method: "DELETE",
      },
    );
    currentCashPacingMonth.value = detail;
    await fetchCashPacingMonths();
    return detail;
  }

  // POS Sales
  const posSales = ref<PosSale[]>([]);
  const pendingPosSales = ref<PosSale[]>([]);
  const loadingPosSales = ref(false);
  const posSalesTotal = ref(0);

  async function fetchPosSales(params?: {
    status?: 'completed' | 'pending';
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    loadingPosSales.value = true;
    try {
      const query = new URLSearchParams();
      if (params?.status) query.append('status', params.status);
      if (params?.from) query.append('from', params.from);
      if (params?.to) query.append('to', params.to);
      if (params?.limit) query.append('limit', params.limit.toString());
      if (params?.offset) query.append('offset', params.offset.toString());

      const response = await fetchAPI<{ sales: PosSale[]; total: number }>(
        `/api/admin/pos/sales?${query}`
      );
      posSales.value = response.sales;
      posSalesTotal.value = response.total;
      return response;
    } finally {
      loadingPosSales.value = false;
    }
  }

  async function fetchPendingPosSales() {
    try {
      pendingPosSales.value = await fetchAPI<PosSale[]>('/api/admin/pos/pending');
      return pendingPosSales.value;
    } catch (error) {
      console.error('Failed to fetch pending POS sales:', error);
      return [];
    }
  }

  async function createPosSale(data: {
    product_name: string;
    price: number;
    cost_price?: number | null;
    notes?: string;
    employee_id?: string;
    customer_id?: string | null;
  }) {
    const sale = await fetchAPI<PosSale>('/api/admin/pos/sales', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    if (sale.status === 'pending') {
      pendingPosSales.value.unshift(sale);
    } else {
      posSales.value.unshift(sale);
    }
    
    return sale;
  }

  async function updatePosSale(
    id: string,
    data: {
      product_name?: string;
      price?: number;
      cost_price?: number;
      notes?: string;
    }
  ) {
    const sale = await fetchAPI<PosSale>(`/api/admin/pos/sales/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });

    // Обновляем в списке отложенных
    const pendingIndex = pendingPosSales.value.findIndex((s) => s.id === id);
    if (pendingIndex !== -1) {
      if (sale.status === 'completed') {
        // Убираем из отложенных, добавляем в основной список
        pendingPosSales.value.splice(pendingIndex, 1);
        posSales.value.unshift(sale);
      } else {
        pendingPosSales.value[pendingIndex] = sale;
      }
    } else {
      // Обновляем в основном списке
      const index = posSales.value.findIndex((s) => s.id === id);
      if (index !== -1) {
        posSales.value[index] = sale;
      }
    }

    return sale;
  }

  async function deletePosSale(id: string) {
    await fetchAPI(`/api/admin/pos/sales/${id}`, { method: 'DELETE' });
    posSales.value = posSales.value.filter((s) => s.id !== id);
    pendingPosSales.value = pendingPosSales.value.filter((s) => s.id !== id);
  }

  // Promo Codes
  const promoCodes = ref<PromoCode[]>([]);
  const promoCodesLoading = ref(false);
  const promoCodesTotal = ref(0);

  async function fetchPromoCodes(params?: {
    search?: string;
    filter?: string;
    source?: 'regular' | 'wheel' | 'all';
    limit?: number;
    offset?: number;
    append?: boolean;
  }) {
    promoCodesLoading.value = true;
    try {
      const query = new URLSearchParams();
      if (params?.search) query.set('search', params.search);
      if (params?.filter) query.set('filter', params.filter);
      if (params?.source) query.set('source', params.source);
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      const qs = query.toString();
      const data = await fetchAPI<{ promo_codes: PromoCode[]; total: number }>(`${API_BASE}/promo-codes${qs ? `?${qs}` : ''}`);
      if (params?.append) {
        const existingIds = new Set(promoCodes.value.map((promo) => promo.id));
        const nextPromos = data.promo_codes.filter((promo) => !existingIds.has(promo.id));
        promoCodes.value = [...promoCodes.value, ...nextPromos];
      } else {
        promoCodes.value = data.promo_codes;
      }
      promoCodesTotal.value = data.total;
      return data;
    } finally {
      promoCodesLoading.value = false;
    }
  }

  async function createPromoCode(data: Partial<PromoCode>) {
    const promo = await fetchAPI<PromoCode>(`${API_BASE}/promo-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    promoCodes.value = [promo, ...promoCodes.value];
    promoCodesTotal.value++;
    return promo;
  }

  async function updatePromoCode(id: string, data: Partial<PromoCode>) {
    const promo = await fetchAPI<PromoCode>(`${API_BASE}/promo-codes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const idx = promoCodes.value.findIndex((p) => p.id === id);
    if (idx !== -1) promoCodes.value[idx] = promo;
    return promo;
  }

  async function deletePromoCode(id: string) {
    await fetchAPI(`${API_BASE}/promo-codes/${id}`, { method: 'DELETE' });
    promoCodes.value = promoCodes.value.filter((p) => p.id !== id);
    promoCodesTotal.value = Math.max(promoCodesTotal.value - 1, 0);
  }

  async function fetchPromoUsage(id: string) {
    return await fetchAPI<PromoUsage[]>(`${API_BASE}/promo-codes/${id}/usage`);
  }

  // Loyalty
  const loyaltyCategories = ref<CrmLoyaltyCategory[]>([]);
  const loyaltyCustomers = ref<CrmLoyaltyCustomer[]>([]);
  const loyaltyLedger = ref<CrmLoyaltyLedgerEntry[]>([]);
  const loyaltyLoading = ref(false);

  async function fetchLoyaltyCategories() {
    loyaltyLoading.value = true;
    try {
      const data = await fetchAPI<{ categories: CrmLoyaltyCategory[] }>(
        `${API_BASE}/loyalty/categories`,
      );
      loyaltyCategories.value = data.categories || [];
      return loyaltyCategories.value;
    } finally {
      loyaltyLoading.value = false;
    }
  }

  async function updateLoyaltyCategory(
    id: string,
    data: {
      threshold: number;
      discount_amount: number;
      title: string;
      description?: string | null;
      active: boolean;
    },
  ) {
    const category = await fetchAPI<CrmLoyaltyCategory>(
      `${API_BASE}/loyalty/categories/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    const index = loyaltyCategories.value.findIndex((item) => item.id === id);
    if (index !== -1) {
      loyaltyCategories.value[index] = category;
    }
    return category;
  }

  async function updateLoyaltyMappings(
    id: string,
    data: { category_ids: string[]; group_ids: string[] },
  ) {
    const category = await fetchAPI<CrmLoyaltyCategory>(
      `${API_BASE}/loyalty/categories/${id}/mappings`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    const index = loyaltyCategories.value.findIndex((item) => item.id === id);
    if (index !== -1) {
      loyaltyCategories.value[index] = category;
    }
    return category;
  }

  async function fetchLoyaltyCustomers(search = "") {
    const query = new URLSearchParams();
    if (search.trim()) query.set("search", search.trim());
    const data = await fetchAPI<{ customers: CrmLoyaltyCustomer[] }>(
      `${API_BASE}/loyalty/customers?${query.toString()}`,
    );
    loyaltyCustomers.value = data.customers || [];
    return loyaltyCustomers.value;
  }

  async function fetchLoyaltyLedger(customerId: string) {
    const data = await fetchAPI<{ entries: CrmLoyaltyLedgerEntry[] }>(
      `${API_BASE}/loyalty/customers/${customerId}/ledger`,
    );
    loyaltyLedger.value = data.entries || [];
    return loyaltyLedger.value;
  }

  // Low stock
  const lowStockProducts = ref<any[]>([]);

  async function fetchLowStockProducts() {
    lowStockProducts.value = await fetchAPI<any[]>(
      `${API_BASE}/products/low-stock`,
    );
  }

  // Low stock GROUPS (линейки) — отдельная сущность, плашка в Закупках.
  const lowStockGroups = ref<LowStockGroup[]>([]);
  const lowStockReasons = ref<Record<LowStockPauseReason, LowStockPauseConfig>>(
    {} as Record<LowStockPauseReason, LowStockPauseConfig>,
  );
  const lowStockGroupsLoading = ref(false);
  const lowStockHasAny = ref(false);
  const lowStockCount = ref(0);

  async function fetchLowStockGroups() {
    lowStockGroupsLoading.value = true;
    try {
      const data = await fetchAPI<{
        items: LowStockGroup[];
        reasons: Record<LowStockPauseReason, LowStockPauseConfig>;
      }>(`${API_BASE}/low-stock-groups`);
      lowStockGroups.value = Array.isArray(data?.items) ? data.items : [];
      lowStockReasons.value = data?.reasons ?? ({} as Record<LowStockPauseReason, LowStockPauseConfig>);
      // Держим summary в синхроне с детальным списком, чтобы индикатор сайдбара
      // не «лагал» сразу после действия пользователя.
      lowStockHasAny.value = lowStockGroups.value.length > 0;
      lowStockCount.value = lowStockGroups.value.length;
      return lowStockGroups.value;
    } finally {
      lowStockGroupsLoading.value = false;
    }
  }

  async function fetchLowStockSummary() {
    try {
      const data = await fetchAPI<{ hasAny: boolean; count: number }>(
        `${API_BASE}/low-stock-groups/summary`,
      );
      lowStockHasAny.value = Boolean(data?.hasAny);
      lowStockCount.value = Number(data?.count ?? 0);
      return data;
    } catch (err) {
      // Ошибка summary не должна ломать UI — просто оставляем последнее значение.
      console.warn("[CRM] Failed to fetch low-stock summary:", err);
      return { hasAny: lowStockHasAny.value, count: lowStockCount.value };
    }
  }

  async function fetchLowStockGroupFlavors(groupId: string) {
    if (!groupId) {
      throw new Error("group_id_required");
    }
    const data = await fetchAPI<{ items: LowStockFlavor[] }>(
      `${API_BASE}/low-stock-groups/${encodeURIComponent(groupId)}/flavors`,
    );
    return Array.isArray(data?.items) ? data.items : [];
  }

  async function pauseLowStockGroup(groupId: string, reason: LowStockPauseReason) {
    if (!groupId) {
      throw new Error("group_id_required");
    }
    await fetchAPI(`${API_BASE}/low-stock-groups/${groupId}/pause`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    // Локально удаляем линейку из плашки сразу — пользователь увидит результат
    // моментально, без ожидания нового запроса.
    lowStockGroups.value = lowStockGroups.value.filter((g) => g.id !== groupId);
    lowStockHasAny.value = lowStockGroups.value.length > 0;
    lowStockCount.value = lowStockGroups.value.length;
  }

  async function resumeLowStockGroup(groupId: string) {
    if (!groupId) {
      throw new Error("group_id_required");
    }
    await fetchAPI(`${API_BASE}/low-stock-groups/${groupId}/pause`, {
      method: "DELETE",
    });
    // После снятия паузы линейка может снова появиться — перечитываем список.
    await fetchLowStockGroups();
  }

  async function searchCrmProducts(
    params: { search?: string; offset?: number; limit?: number } = {},
  ) {
    const query = new URLSearchParams();
    query.set("limit", String(params.limit ?? 25));
    if (params.offset) {
      query.set("offset", String(params.offset));
    }
    if (params.search) {
      query.set("search", params.search);
    }

    const response = await fetch(
      `/api/admin/crm/products/search?${query.toString()}`,
      {
        credentials: "include",
      },
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить товары");
    }

    const rawProducts = await response.json();
    const productsArray = Array.isArray(rawProducts) ? rawProducts : [];

    return productsArray.map((product: any) => ({
      id: String(product.id),
      productId: product.product_id
        ? String(product.product_id)
        : String(product.id),
      title: product.title ?? "Без названия",
      description: product.description ?? null,
      priceRub: Number(product.priceRub ?? product.price_rub ?? 0),
      costPrice: Number(product.costPrice ?? product.cost_price ?? 0),
      stock: Number(product.stock ?? 0),
      warehouseStock: Number(product.warehouse_stock ?? product.warehouseStock ?? 0),
      companyStock: Number(
        product.total_stock
        ?? product.base_total_stock
        ?? product.companyStock
        ?? (Number(product.stock ?? 0) + Number(product.warehouse_stock ?? product.warehouseStock ?? 0)),
      ),
      minStock: Number(product.minStock ?? product.min_stock ?? 0),
      categoryId: String(product.categoryId ?? product.category_id),
      categoryName: product.categoryName ?? product.category_name ?? null,
      groupId: product.groupId
        ? String(product.groupId)
        : product.group_id
          ? String(product.group_id)
          : null,
      groupName: product.groupName ?? product.group_name ?? null,
      isVariant: product.is_variant === true,
      variantName: product.variant_name ?? null,
      imageUrl: product.imageUrl ?? null,
      image: product.image ?? null,
    })) as CrmProductSummary[];
  }

  // Generate message for order contact
  async function generateOrderMessage(orderId: string, templateId?: string) {
    return await fetchAPI<{
      message: string;
      telegramUsername: string | null;
      telegramId: string | null;
      templateUsed: string;
    }>(`${API_BASE}/orders/${orderId}/generate-message`, {
      method: "POST",
      body: JSON.stringify({ templateId }),
    });
  }

  // Message Templates
  const messageTemplates = ref<MessageTemplate[]>([]);
  const loadingTemplates = ref(false);

  async function fetchMessageTemplates() {
    loadingTemplates.value = true;
    try {
      messageTemplates.value = await fetchAPI<MessageTemplate[]>(
        `${API_BASE}/message-templates`,
      );
    } finally {
      loadingTemplates.value = false;
    }
  }

  async function createMessageTemplate(data: {
    name: string;
    content: string;
    type?: string;
  }) {
    const template = await fetchAPI<MessageTemplate>(
      `${API_BASE}/message-templates`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    messageTemplates.value.push(template);
    return template;
  }

  async function updateMessageTemplate(
    id: string,
    data: Partial<Omit<MessageTemplate, "id" | "created_at" | "updated_at">>,
  ) {
    const template = await fetchAPI<MessageTemplate>(
      `${API_BASE}/message-templates/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
    const index = messageTemplates.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      messageTemplates.value[index] = template;
    }
    return template;
  }

  async function deleteMessageTemplate(id: string) {
    await fetchAPI(`${API_BASE}/message-templates/${id}`, { method: "DELETE" });
    messageTemplates.value = messageTemplates.value.filter((t) => t.id !== id);
  }

  /**
   * Пропуск в «Обзор». Отдельно от общего ключа CRM: с 10:00 до 16:00 по Минску
   * туда пускает только пароль владельца, в остальное время работает и обычный.
   * Пропуск держим в памяти, чтобы он не пережил перезагрузку вкладки.
   */
  function dashboardHeaders(): Record<string, string> {
    return dashboardToken.value
      ? { "X-Dashboard-Token": dashboardToken.value }
      : {};
  }

  async function fetchDashboardAccessState() {
    const state = await fetchAPI<{ locked: boolean; profit_required?: boolean }>(
      `/api/admin/dashboard-access/state`,
    );
    // Поля может не быть только если сервер старее этой сборки. Тогда ведём
    // себя как раньше и пароль спрашиваем.
    // Обратной дороги здесь нет: когда пароль нужен, допуск не сбрасываем, а
    // оставляем как был. Иначе переход между вкладками отбирал бы допуск,
    // выданный минуту назад.
    const wasRequired = overviewPasswordRequired.value;
    overviewPasswordRequired.value = state.profit_required !== false;
    dashboardLocked.value = Boolean(state.locked);
    if (!overviewPasswordRequired.value) {
      profitUnlocked.value = true;
    } else if (!wasRequired) {
      // Пароли включили обратно, пока вкладка была открыта. Поднятый нами
      // допуск надо отобрать, иначе себестоимость и «Финансы» так и остались
      // бы видны без пароля до перезагрузки страницы.
      profitUnlocked.value =
        typeof localStorage !== "undefined" &&
        localStorage.getItem("crm_profit_unlocked") === "true";
    }
    return state;
  }

  async function verifyDashboardAccess(password: string) {
    const result = await fetchAPI<{ ok: boolean; token: string }>(
      `/api/admin/dashboard-access/verify`,
      { method: "POST", body: JSON.stringify({ password }) },
    );
    if (result.ok && result.token) {
      dashboardToken.value = result.token;
      // Сервер уже подтвердил право на финансовые цифры, второй раз спрашивать
      // тот же пароль незачем.
      profitUnlocked.value = true;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("crm_profit_unlocked", "true");
      }
    }
    return result;
  }

  function clearDashboardAccess() {
    dashboardToken.value = "";
  }

  async function verifyProfitPassword(password: string) {
    verifyingProfitAccess.value = true;
    try {
      const result = await fetchAPI<{ ok: boolean }>(
        `/api/admin/settings/profit-password/verify`,
        {
          method: "POST",
          body: JSON.stringify({ password }),
        },
      );
      if (result.ok) {
        profitUnlocked.value = true;
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("crm_profit_unlocked", "true");
        }
      }
      return result;
    } catch (error) {
      profitUnlocked.value = false;
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("crm_profit_unlocked");
      }
      throw error;
    } finally {
      verifyingProfitAccess.value = false;
    }
  }

  return {
    // Profit access
    profitUnlocked,
    isProfitUnlocked,
    verifyingProfitAccess,
    lockProfitAccess,

    // Global Order Notifications
    newOrdersCount,
    unseenOrderIds,
    actionRequiredCount,
    unseenActionIds,
    notificationsEnabled,
    soundEnabled,
    autoRefreshEnabled,
    setNotificationsEnabled,
    setSoundEnabled,
    setAutoRefreshEnabled,
    startPolling,
    stopPolling,
    subscribeOrderActivity,
    checkForNewOrders,
    checkForActionRequired,
    markOrderAsSeen,
    markAllOrdersAsSeen,
    isOrderUnseen,
    pendingReviewCount,
    hasUnseenReviews,
    markReviewsAsSeen,
    latestMonthlyDraw,
    hasUnseenDraw,
    isDrawBannerDismissed,
    markDrawAsSeen,
    clearDrawAcknowledgement,
    // In-app toast (Safari fallback)
    inAppToast,
    hideInAppToast,
    // Audio unlock for Safari
    unlockAudioContext,

    // Dashboard
    dashboardStats,
    loadingDashboard,
    fetchDashboard,
    dashboardTimeseries,
    loadingTimeseries,
    fetchDashboardTimeseries,

    // Employees
    employees,
    loadingEmployees,
    fetchEmployees,
    createEmployee,
    updateEmployee,
    deleteEmployee,

    // Staff access, shifts and performance
    staffIdentity,
    staffToken,
    staffShiftToken,
    staffRole,
    isStaffManager,
    hasStaffAccess,
    staffAccessLoading,
    staffAccessError,
    staffTrackingEnabled,
    staffSettingsLoading,
    staffSettingsError,
    staffEmployees,
    staffEmployeesLoading,
    staffEmployeesError,
    currentStaffShift,
    staffShiftHistory,
    staffShiftHistoryLoading,
    staffShiftHistoryError,
    staffShiftCandidates,
    staffShiftCandidatesLoading,
    staffShiftCandidatesError,
    staffShiftLoading,
    staffShiftError,
    staffAnalytics,
    staffAnalyticsPrevious,
    staffAnalyticsLoading,
    staffAnalyticsError,
    staffTeamAnalytics,
    staffTeamAnalyticsLoading,
    staffTeamAnalyticsError,
    staffTasks,
    staffTasksLoading,
    staffTasksError,
    openStaffTaskCount,
    staffSalaries,
    staffSalariesLoading,
    staffSalariesError,
    staffMarks,
    staffMarksLoading,
    staffMarksError,
    staffNotifications,
    staffNotificationsLoading,
    staffNotificationsError,
    accessStaff,
    lockStaffAccess,
    fetchStaffSettings,
    updateStaffTracking,
    bootstrapStaffManager,
    fetchStaffRecoveryManagerCandidates,
    recoverStaffManager,
    fetchStaffEmployees,
    createStaffEmployee,
    updateStaffEmployee,
    linkStaffEmployeeTelegram,
    deactivateStaffEmployee,
    restoreStaffEmployee,
    resetStaffEmployeePin,
    fetchStaffShift,
    fetchStaffShiftCandidates,
    openStaffShift,
    closeStaffShift,
    fetchStaffShiftHistory,
    correctStaffShift,
    fetchStaffAnalytics,
    fetchStaffAnalyticsPrevious,
    fetchStaffTeamAnalytics,
    fetchStaffTasks,
    fetchStaffTaskHistory,
    createStaffTask,
    performStaffTaskAction,
    fetchStaffSalaries,
    saveStaffSalary,
    fetchStaffSalaryHistory,
    fetchStaffMarks,
    createStaffMark,
    updateStaffMark,
    fetchStaffMarkHistory,
    fetchStaffNotifications,
    updateStaffNotificationSettings,
    saveStaffNotificationTemplate,
    previewStaffNotificationTemplate,
    resolveStaffNotificationRecipient,
    addStaffNotificationRecipient,
    removeStaffNotificationRecipient,
    resumeStaffNotification,
    refreshStaffWorkspace,

    // Customers
    customers,
    currentCustomer,
    loadingCustomers,
    fetchCustomers,
    fetchCustomer,
    updateCustomer,
    blockCustomer,
    unblockCustomer,
    deleteCustomer,

    // Универсальные блокировки (новый API: pre-ban по @username + срок)
    customerBlocksList,
    loadingCustomerBlocks,
    fetchCustomerBlocksList,
    createCustomerBlock,
    removeCustomerBlock,

    patchCustomerNotesOnOrders,
    upsertCustomerNote,
    clearCustomerNote,
    fetchPendingCustomerNotes,

    // POS-клиенты (касса)
    searchCustomersForPos,
    createPosCustomer,
    deletePosCustomer,
    fetchCustomerPurchaseHistory,

    // Customer Feedbacks
    customerFeedbacks,
    loadingCustomerFeedbacks,
    fetchCustomerFeedbacks,
    createCustomerFeedback,
    deleteCustomerFeedback,

    // Orders
    orders,
    currentOrder,
    loadingOrders,
    ordersPagination,
    pickupCells,
    loadingPickupCells,
    fetchPickupCells,
    updatePickupCellCapacity,
    fetchOrders,
    fetchKanbanBoard,
    syncKanbanBoardSince,
    fetchOrder,
    fetchOrderHistory,
    deliveredOrders,
    loadingDelivered,
    deliveredStats,
    deliveredPagination,
    fetchDeliveredOrders,
    createOrder,
    updateOrder,
    resolveManagerAction,
    issueOrder,

    // Procurements
    procurements,
    currentProcurement,
    loadingProcurements,
    fetchProcurements,
    fetchProcurement,
    createProcurement,
    completeProcurement,
    totalControlGroups,
    totalControlGroupsLoading,
    totalControlGroupsError,
    fetchTotalControlGroups,

    // Write-offs
    writeOffs,
    currentWriteOff,
    loadingWriteOffs,
    fetchWriteOffs,
    fetchWriteOff,
    createWriteOff,
    updateWriteOff,
    deleteWriteOff,

    // Cash
    cashAccounts,
    cashTransactions,
    loadingCash,
    fetchCashAccounts,
    createCashAccount,
    updateCashAccount,
    deleteCashAccount,
    fetchCashTransactions,
    createCashTransaction,
    updateCashTransaction,
    deleteCashTransaction,
    cardPaymentAdminSnapshot,
    loadingCardPaymentAdmin,
    fetchCardPaymentAdmin,
    setCardMonthlyLimit,
    adjustCardDailyLimit,
    searchCardProfile,
    setCardAccountCooldownDays,
    clearCardAccountCooldown,
    addManualCardPayment,
    saveCardAccount,
    updateCardAccount,
    setCardPermissionByTelegramId,
    updateCardRequest,
    saveCardTariff,
    deleteCardTariff,
    applyCardTariff,
    approveCardRequest,

    // Cash pacing
    cashPacingMonths,
    currentCashPacingMonth,
    loadingCashPacing,
    suggestedCashPacingMonthKey,
    fetchCashPacingMonths,
    fetchCashPacingMonth,
    createCashPacingMonth,
    updateCashPacingMonth,
    createCashPacingItem,
    updateCashPacingItem,
    deleteCashPacingItem,
    upsertCashPacingDailyFact,
    deleteCashPacingDailyFact,

    // POS Sales
    posSales,
    pendingPosSales,
    loadingPosSales,
    posSalesTotal,
    fetchPosSales,
    fetchPendingPosSales,
    createPosSale,
    updatePosSale,
    deletePosSale,

    // Promo Codes
    promoCodes,
    promoCodesLoading,
    promoCodesTotal,
    fetchPromoCodes,
    createPromoCode,
    updatePromoCode,
    deletePromoCode,
    fetchPromoUsage,

    // Loyalty
    loyaltyCategories,
    loyaltyCustomers,
    loyaltyLedger,
    loyaltyLoading,
    fetchLoyaltyCategories,
    updateLoyaltyCategory,
    updateLoyaltyMappings,
    fetchLoyaltyCustomers,
    fetchLoyaltyLedger,

    // Low stock
    lowStockProducts,
    fetchLowStockProducts,

    // Low stock GROUPS (линейки) — плашка в Закупках + индикатор в сайдбаре
    lowStockGroups,
    lowStockReasons,
    lowStockGroupsLoading,
    lowStockHasAny,
    lowStockCount,
    fetchLowStockGroups,
    fetchLowStockSummary,
    fetchLowStockGroupFlavors,
    pauseLowStockGroup,
    resumeLowStockGroup,

    searchCrmProducts,
    generateOrderMessage,

    // Message Templates
    messageTemplates,
    loadingTemplates,
    fetchMessageTemplates,
    createMessageTemplate,
    updateMessageTemplate,
    deleteMessageTemplate,

    // Payments management
    deleteOrderPayment,
    updateProcurement,
    deleteProcurement,
    removeProcurementPayment,
    verifyProfitPassword,
    overviewPasswordRequired,
    verifyDashboardAccess,
    fetchDashboardAccessState,
    clearDashboardAccess,
    dashboardToken,
    dashboardLocked,
  };
});
