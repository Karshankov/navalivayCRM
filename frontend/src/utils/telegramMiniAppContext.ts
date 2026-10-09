import type { Router } from 'vue-router'

/** Реальный контекст Mini App: подписанный initData и id пользователя (не заглушка из браузера). */
export function hasTelegramMiniAppUserContext(): boolean {
  if (typeof window === 'undefined') return false
  const tg = window.Telegram?.WebApp
  if (!tg) return false
  const initData = String(tg.initData || '').trim()
  const userId = tg.initDataUnsafe?.user?.id
  // Локальный dev-мок не может подделать подписанный initData, поэтому
  // помечает WebApp отдельно. В production этот флаг недоступен и для
  // авторизации по-прежнему требуется настоящий initData.
  const isDevMock =
    import.meta.env.DEV &&
    (tg as typeof tg & { __navalivayDevMock?: boolean }).__navalivayDevMock === true
  return Boolean(userId && (initData || isDevMock))
}

/**
 * Кодирует оптовую пару code/secret для startapp (лимит Telegram 64 символа).
 * Префикс w + base64url(JSON {"c","s"}).
 */
export function wholesalePairToStartParam(code: string, secret: string): string | null {
  const c = String(code || '').trim()
  const s = String(secret || '').trim()
  if (!c || !s) return null
  try {
    const payload = JSON.stringify({ c, s })
    const b64 = btoa(unescape(encodeURIComponent(payload)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const out = `w${b64}`
    if (out.length > 64) return null
    return out
  } catch {
    return null
  }
}

export function parseWholesaleStartParam(param: string): { code: string; secret: string } | null {
  const raw = String(param || '').trim()
  if (!raw.startsWith('w')) return null
  try {
    const b64 = raw.slice(1).replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    const json = decodeURIComponent(escape(atob(b64 + pad)))
    const o = JSON.parse(json) as { c?: unknown; s?: unknown }
    const code = typeof o.c === 'string' ? o.c.trim() : ''
    const secret = typeof o.s === 'string' ? o.s.trim() : ''
    if (!code || !secret) return null
    return { code, secret }
  } catch {
    return null
  }
}

/**
 * @param miniAppShortName Если задан (как в @BotFather у Direct Link Mini App), используем формат
 * `t.me/bot/appname?startapp=…&mode=compact` — на части клиентов он лучше открывает компакт, чем main `?startapp=…` без сегмента.
 */
export function buildTelegramMiniAppOpenUrl(
  botUsername: string,
  startParam: string,
  options?: { miniAppShortName?: string | null },
): string | null {
  const bot = String(botUsername || '').trim().replace(/^@/, '')
  const sp = String(startParam || '').trim()
  const shortRaw = String(options?.miniAppShortName ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  const shortSeg =
    shortRaw && /^[a-zA-Z0-9_]+$/.test(shortRaw) ? shortRaw : ''
  if (!bot || !sp) return null
  // mode=compact: половина экрана (core.telegram.org/bots/webapps). Порядок: startapp, затем mode=compact.
  const qs = `startapp=${encodeURIComponent(sp)}&mode=compact`
  const url = shortSeg
    ? `https://t.me/${bot}/${shortSeg}?${qs}`
    : `https://t.me/${bot}?${qs}`
  return url
}

/** Если пользователь открыл бота с ?startapp=w... — переходим на активацию опта. */
export async function applyTelegramWholesaleStartParam(router: Router): Promise<void> {
  if (!hasTelegramMiniAppUserContext()) return
  const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param?.trim()
  if (!sp) return
  const parsed = parseWholesaleStartParam(sp)
  if (!parsed) return
  const current = router.currentRoute.value
  if (
    current.name === 'wholesale-entry' &&
    String(current.params.code || '') === parsed.code &&
    String(current.params.secret || '') === parsed.secret
  ) {
    return
  }
  await router.replace({
    name: 'wholesale-entry',
    params: { code: parsed.code, secret: parsed.secret },
  })
}
