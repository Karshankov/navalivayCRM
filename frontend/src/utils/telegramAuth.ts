export const TELEGRAM_INIT_DATA_HEADER = "X-Telegram-Init-Data"

export function getTelegramInitData(): string {
  if (typeof window === "undefined") return ""
  return window.Telegram?.WebApp?.initData?.trim() || ""
}

export function withTelegramAuthHeaders(headers: HeadersInit = {}): Record<string, string> {
  const nextHeaders = new Headers(headers)
  const initData = getTelegramInitData()

  if (initData) {
    nextHeaders.set(TELEGRAM_INIT_DATA_HEADER, initData)
  }

  return Object.fromEntries(nextHeaders.entries())
}
