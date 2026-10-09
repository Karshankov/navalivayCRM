import {
  TagIcon,
  CubeIcon,
  PhotoIcon,
  HomeIcon,
  Cog6ToothIcon,
  ClipboardDocumentCheckIcon,
  UserGroupIcon,
  ArrowDownTrayIcon,
  BanknotesIcon,
  ArchiveBoxXMarkIcon,
  ArchiveBoxIcon,
  ReceiptPercentIcon,
  GiftIcon,
  SparklesIcon,
  StarIcon,
  IdentificationIcon
} from '@heroicons/vue/24/outline'

export const adminTabOptions = ['dashboard', 'products', 'categories', 'banners', 'settings'] as const

export type AdminTabId = typeof adminTabOptions[number]

export interface AdminTab {
  id: AdminTabId
  name: string
  icon: any
  description: string
}

export interface SidebarLink {
  id: string
  name: string
  description: string
  icon: any
  to: string
}

export const adminTabs: AdminTab[] = [
  { id: 'dashboard', name: 'Обзор', icon: HomeIcon, description: 'Сводная статистика' },
  { id: 'products', name: 'Товары', icon: CubeIcon, description: 'Каталог и остатки' },
  { id: 'categories', name: 'Категории', icon: TagIcon, description: 'Структура ассортимента' },
  { id: 'banners', name: 'Баннеры', icon: PhotoIcon, description: 'Промо и баннеры' },
  { id: 'settings', name: 'Настройки', icon: Cog6ToothIcon, description: 'Параметры системы' }
]

export const crmLinks: SidebarLink[] = [
  {
    id: 'crm-orders',
    name: 'Заказы',
    description: 'Управление заказами',
    icon: ClipboardDocumentCheckIcon,
    to: '/admin/crm/orders'
  },
  {
    id: 'crm-customers',
    name: 'Клиенты',
    description: 'База клиентов',
    icon: UserGroupIcon,
    to: '/admin/crm/customers'
  },
  {
    id: 'crm-employees',
    name: 'Сотрудники и зарплаты',
    description: 'Смены и показатели команды',
    icon: IdentificationIcon,
    to: '/admin/crm/employees'
  },
  {
    id: 'crm-reviews',
    name: 'Отзывы',
    description: 'Модерация и розыгрыш',
    icon: StarIcon,
    to: '/admin/crm/reviews'
  },
  {
    id: 'crm-procurements',
    name: 'Закупки',
    description: 'Поставки товаров',
    icon: ArrowDownTrayIcon,
    to: '/admin/crm/procurements'
  },
  {
    id: 'crm-finances',
    name: 'Финансы',
    description: 'Счета и транзакции',
    icon: BanknotesIcon,
    to: '/admin/crm/finances'
  },
  {
    id: 'crm-write-offs',
    name: 'Списания',
    description: 'Учёт списаний товаров',
    icon: ArchiveBoxXMarkIcon,
    to: '/admin/crm/write-offs'
  },
  {
    id: 'crm-pos-sales',
    name: 'Продажи касса',
    description: 'Продажи через кассу',
    icon: ReceiptPercentIcon,
    to: '/admin/crm/pos-sales'
  },
  {
    id: 'crm-loyalty',
    name: 'Бонусы и промокоды',
    description: 'Скидки и акции',
    icon: GiftIcon,
    to: '/admin/crm/loyalty'
  },
  {
    id: 'crm-wheel',
    name: 'Рулетка призов',
    description: 'Призы, спины',
    icon: SparklesIcon,
    to: '/admin/crm/wheel'
  }
]
