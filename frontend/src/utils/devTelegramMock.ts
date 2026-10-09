/**
 * Dev-only СѓС‚РёР»РёС‚Р° РґР»СЏ С‚РµСЃС‚РёСЂРѕРІР°РЅРёСЏ РєР»РёРµРЅС‚СЃРєРѕРіРѕ РёРЅС‚РµСЂС„РµР№СЃР° РІ РѕР±С‹С‡РЅРѕРј Р±СЂР°СѓР·РµСЂРµ
 * Р±РµР· СЂРµР°Р»СЊРЅРѕРіРѕ Telegram Mini App.
 *
 * РђРєС‚РёРІРёСЂСѓРµС‚СЃСЏ query-РїР°СЂР°РјРµС‚СЂРѕРј `?telegram_id=...` (РёР»Рё РєРѕСЂРѕС‚РєРѕРµ `?as=...`).
 * Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ РјРѕР¶РЅРѕ РїРµСЂРµРґР°С‚СЊ `?username=...&first_name=...`.
 *
 * РџРѕСЃР»Рµ РїСЂРёРјРµРЅРµРЅРёСЏ РїР°СЂР°РјРµС‚СЂС‹ СѓРґР°Р»СЏСЋС‚СЃСЏ РёР· URL, identity СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ РІ sessionStorage,
 * Рё `window.Telegram.WebApp` РёРЅР¶РµРєС‚РёС‚СЃСЏ СЃ РїРѕР»РµРј `initDataUnsafe.user`.
 *
 * Р“Р°СЂРґ `import.meta.env.DEV` РіР°СЂР°РЅС‚РёСЂСѓРµС‚ tree-shaking РёР· РїСЂРѕРґ-СЃР±РѕСЂРєРё:
 * Vite РЅР° СЌС‚Р°РїРµ СЃР±РѕСЂРєРё Р·Р°РјРµРЅРёС‚ РІС‹СЂР°Р¶РµРЅРёРµ РЅР° `false`, Рё РІРµСЃСЊ РєРѕРґ С„СѓРЅРєС†РёРё
 * Р±СѓРґРµС‚ СѓРґР°Р»С‘РЅ РјРёРЅРёС„РёРєР°С‚РѕСЂРѕРј.
 */

const DEV_MOCK_KEY = 'navalivay_dev_telegram_mock'

interface DevMockIdentity {
  id: string
  username: string
  first_name: string
}

function readStoredIdentity(): DevMockIdentity | null {
  try {
    const raw = sessionStorage.getItem(DEV_MOCK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DevMockIdentity>
    if (!parsed?.id) return null
    return {
      id: String(parsed.id),
      username: String(parsed.username || ''),
      first_name: String(parsed.first_name || `Dev User ${parsed.id}`),
    }
  } catch {
    return null
  }
}

function persistIdentity(identity: DevMockIdentity): void {
  try {
    sessionStorage.setItem(DEV_MOCK_KEY, JSON.stringify(identity))
  } catch {
    /* noop: РїСЂРёРІР°С‚РЅС‹Р№ СЂРµР¶РёРј / РєРІРѕС‚Р° */
  }
}

function injectMockWebApp(identity: DevMockIdentity): boolean {
  const w = window as unknown as { Telegram?: { WebApp?: unknown } }
  const existing = w.Telegram?.WebApp as { initData?: string } | undefined
  if (existing && String(existing.initData || '').trim()) {
    // Р РµР°Р»СЊРЅС‹Р№ Mini App СѓР¶Рµ РїРѕРґРјРѕРЅС‚РёСЂРѕРІР°РЅ вЂ” РЅРµ РїРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј.
    return false
  }

  const noop = () => {}

  w.Telegram = {
    WebApp: {
      initData: '',
      __navalivayDevMock: true,
      initDataUnsafe: {
        user: {
          id: Number(identity.id),
          is_bot: false,
          first_name: identity.first_name,
          username: identity.username || undefined,
          language_code: 'ru',
        },
        auth_date: Math.floor(Date.now() / 1000),
        hash: '',
      },
      colorScheme: 'light',
      themeParams: {},
      headerColor: '#ffffff',
      backgroundColor: '#ffffff',
      isExpanded: true,
      viewportHeight: window.innerHeight,
      viewportStableHeight: window.innerHeight,
      isFullscreen: false,
      isActive: true,
      ready: noop,
      expand: noop,
      close: noop,
      setHeaderColor: noop,
      setBottomBarColor: noop,
      setBackgroundColor: noop,
      onEvent: noop,
      offEvent: noop,
      sendData: noop,
      openLink: (url: string) => window.open(url, '_blank', 'noopener,noreferrer'),
      openTelegramLink: (url: string) => window.open(url, '_blank', 'noopener,noreferrer'),
      showAlert: (msg: string, cb?: () => void) => {
        window.alert(msg)
        cb?.()
      },
      showConfirm: (msg: string, cb?: (ok: boolean) => void) => {
        cb?.(window.confirm(msg))
      },
      showPopup: (params: { message?: string }, cb?: (id: string) => void) => {
        window.alert(params?.message || '')
        cb?.('')
      },
      MainButton: {
        text: '',
        isVisible: false,
        isActive: true,
        setText: noop,
        onClick: noop,
        offClick: noop,
        show: noop,
        hide: noop,
        enable: noop,
        disable: noop,
        showProgress: noop,
        hideProgress: noop,
      },
      BackButton: {
        isVisible: false,
        onClick: noop,
        offClick: noop,
        show: noop,
        hide: noop,
      },
      SettingsButton: {
        isVisible: false,
        onClick: noop,
        offClick: noop,
        show: noop,
        hide: noop,
      },
      HapticFeedback: {
        impactOccurred: noop,
        notificationOccurred: noop,
        selectionChanged: noop,
      },
      version: '7.0',
      platform: 'web',
      isVersionAtLeast: () => true,
    },
  }

  return true
}

/**
 * РџР°С‚С‡РёС‚ `window.fetch` С‡С‚РѕР±С‹ РґР»СЏ РІСЃРµС… Р·Р°РїСЂРѕСЃРѕРІ Рє `/api/*` (РєСЂРѕРјРµ `/api/admin/*`)
 * Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕРґРєР»Р°РґС‹РІР°Р»СЃСЏ `telegram_id` РёР· РјРѕРє-РёРґРµРЅС‚РёС‡РЅРѕСЃС‚Рё вЂ” РІ query РґР»СЏ
 * GET/HEAD/DELETE Рё РІ JSON-С‚РµР»Рѕ РґР»СЏ POST/PUT/PATCH.
 *
 * Р­С‚Рѕ РЅСѓР¶РЅРѕ РїРѕС‚РѕРјСѓ С‡С‚Рѕ РјРѕРє РЅРµ РјРѕР¶РµС‚ РїРѕРґРґРµР»Р°С‚СЊ `initData` СЃ РІР°Р»РёРґРЅРѕР№ РїРѕРґРїРёСЃСЊСЋ,
 * РїРѕСЌС‚РѕРјСѓ Р±СЌРєРµРЅРґ-Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ РїР°РґР°РµС‚ РЅР° РїСЂРѕРІРµСЂРєРµ HMAC. Insecure-fallback
 * РЅР° Р±СЌРєРµ (`getInsecureFallbackIdentity`) С‡РёС‚Р°РµС‚ `telegram_id` РёР· query/body,
 * С‚Р°Рє С‡С‚Рѕ РїСЂРѕРєРёРґС‹РІР°РµРј identity РёРјРµРЅРЅРѕ С‚СѓРґР°.
 *
 * Р“Р°СЂРґ `import.meta.env.DEV` РіР°СЂР°РЅС‚РёСЂСѓРµС‚ С‡С‚Рѕ РїР°С‚С‡ РїРѕР»РЅРѕСЃС‚СЊСЋ РІС‹СЂРµР·Р°РµС‚СЃСЏ
 * РёР· РїСЂРѕРґ-СЃР±РѕСЂРєРё tree-shaking'РѕРј.
 */
function patchFetchForDevMock(identity: DevMockIdentity): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return

  const flagKey = '__navalivayDevFetchPatched' as const
  const flagged = window as unknown as Record<string, unknown>
  if (flagged[flagKey]) return
  flagged[flagKey] = true

  const originalFetch = window.fetch.bind(window)

  const isJsonContentType = (value: string | null): boolean => {
    if (!value) return false
    return value.toLowerCase().includes('application/json')
  }

  const ensureQueryParams = (urlObj: URL): boolean => {
    let mutated = false
    if (!urlObj.searchParams.has('telegram_id')) {
      urlObj.searchParams.set('telegram_id', identity.id)
      mutated = true
    }
    if (identity.username && !urlObj.searchParams.has('telegram_username')) {
      urlObj.searchParams.set('telegram_username', identity.username)
      mutated = true
    }
    if (identity.first_name && !urlObj.searchParams.has('first_name')) {
      urlObj.searchParams.set('first_name', identity.first_name)
      mutated = true
    }
    return mutated
  }

  const ensureJsonBodyFields = (
    body: Record<string, unknown>,
  ): { body: Record<string, unknown>; mutated: boolean } => {
    let mutated = false
    if (typeof body.telegram_id === 'undefined' || body.telegram_id === null || body.telegram_id === '') {
      body.telegram_id = identity.id
      mutated = true
    }
    if (
      identity.username &&
      (typeof body.telegram_username === 'undefined' ||
        body.telegram_username === null ||
        body.telegram_username === '')
    ) {
      body.telegram_username = identity.username
      mutated = true
    }
    if (
      identity.first_name &&
      (typeof body.first_name === 'undefined' || body.first_name === null || body.first_name === '')
    ) {
      body.first_name = identity.first_name
      mutated = true
    }
    return { body, mutated }
  }

  const patchedFetch: typeof window.fetch = async (input, init) => {
    try {
      // РўРѕР»СЊРєРѕ Request/string/URL вЂ” РІСЃРµ СЃС‚Р°РЅРґР°СЂС‚РЅС‹Рµ С‚РёРїС‹.
      const isRequest = typeof Request !== 'undefined' && input instanceof Request
      const rawUrl = isRequest ? (input as Request).url : String(input)

      let urlObj: URL
      try {
        urlObj = new URL(rawUrl, window.location.origin)
      } catch {
        return originalFetch(input as RequestInfo, init)
      }

      // РўРѕР»СЊРєРѕ same-origin.
      if (urlObj.origin !== window.location.origin) {
        return originalFetch(input as RequestInfo, init)
      }

      const path = urlObj.pathname
      // РђРґРјРёРЅ-СЌРЅРґРїРѕРёРЅС‚С‹ РёСЃРїРѕР»СЊР·СѓСЋС‚ РѕС‚РґРµР»СЊРЅС‹Р№ С‚РѕРєРµРЅ вЂ” РЅРµ С‚СЂРѕРіР°РµРј.
      if (!path.startsWith('/api/') || path.startsWith('/api/admin/')) {
        return originalFetch(input as RequestInfo, init)
      }

      const method = String(
        (init?.method || (isRequest ? (input as Request).method : 'GET')) || 'GET',
      ).toUpperCase()

      // GET/HEAD/DELETE: РїРѕРґРєР»Р°РґС‹РІР°РµРј РІ query.
      if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
        const mutated = ensureQueryParams(urlObj)
        if (!mutated) {
          return originalFetch(input as RequestInfo, init)
        }
        // Р•СЃР»Рё Р±С‹Р» Request вЂ” РїРµСЂРµСЃРѕР±РёСЂР°РµРј РµРіРѕ СЃ РЅРѕРІС‹Рј URL, СЃРѕС…СЂР°РЅСЏСЏ headers/body/credentials.
        if (isRequest) {
          const req = input as Request
          const cloned = new Request(urlObj.toString(), req)
          return originalFetch(cloned, init)
        }
        return originalFetch(urlObj.toString(), init)
      }

      // POST/PUT/PATCH СЃ JSON-С‚РµР»РѕРј: РїР°СЂСЃРёРј, РёРЅР¶РµРєС‚РёРј, РїРµСЂРµРїР°РєРѕРІС‹РІР°РµРј.
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        let headersObj: Headers
        let bodyText: string | null = null
        let credentials: RequestCredentials | undefined
        let mode: RequestMode | undefined
        let cache: RequestCache | undefined
        let redirect: RequestRedirect | undefined
        let referrer: string | undefined
        let integrity: string | undefined
        let keepalive: boolean | undefined
        let signal: AbortSignal | null | undefined

        if (isRequest) {
          const req = input as Request
          headersObj = new Headers(req.headers)
          // init РјРѕР¶РµС‚ РїРµСЂРµРѕРїСЂРµРґРµР»РёС‚СЊ headers/body/method вЂ” СѓС‡РёС‚С‹РІР°РµРј СЌС‚Рѕ.
          if (init?.headers) {
            const overrideHeaders = new Headers(init.headers as HeadersInit)
            overrideHeaders.forEach((v, k) => headersObj.set(k, v))
          }
          if (init?.body !== undefined) {
            bodyText = typeof init.body === 'string' ? init.body : null
          } else {
            try {
              bodyText = await req.clone().text()
            } catch {
              bodyText = null
            }
          }
          credentials = init?.credentials ?? req.credentials
          mode = init?.mode ?? req.mode
          cache = init?.cache ?? req.cache
          redirect = init?.redirect ?? req.redirect
          referrer = init?.referrer ?? req.referrer
          integrity = init?.integrity ?? req.integrity
          keepalive = init?.keepalive ?? req.keepalive
          signal = init?.signal ?? req.signal
        } else {
          headersObj = new Headers((init?.headers as HeadersInit) || {})
          bodyText = typeof init?.body === 'string' ? (init?.body as string) : null
          credentials = init?.credentials
          mode = init?.mode
          cache = init?.cache
          redirect = init?.redirect
          referrer = init?.referrer
          integrity = init?.integrity
          keepalive = init?.keepalive
          signal = init?.signal
        }

        const contentType = headersObj.get('content-type')
        const isJson = isJsonContentType(contentType)

        // Р•СЃР»Рё РЅРµ JSON РёР»Рё С‚РµР»Рѕ РЅРµ СЃС‚СЂРѕРєРѕР№ (FormData/Blob/...) вЂ” fallback РІ query.
        if (!isJson || typeof bodyText !== 'string') {
          const mutated = ensureQueryParams(urlObj)
          if (!mutated) {
            return originalFetch(input as RequestInfo, init)
          }
          if (isRequest) {
            const req = input as Request
            const cloned = new Request(urlObj.toString(), req)
            return originalFetch(cloned, init)
          }
          return originalFetch(urlObj.toString(), init)
        }

        // РџР°СЂСЃРёРј JSON.
        let parsed: unknown = null
        if (bodyText.trim()) {
          try {
            parsed = JSON.parse(bodyText)
          } catch {
            // РќРµРІР°Р»РёРґРЅС‹Р№ JSON вЂ” fallback РІ query.
            const mutated = ensureQueryParams(urlObj)
            if (!mutated) {
              return originalFetch(input as RequestInfo, init)
            }
            if (isRequest) {
              const req = input as Request
              const cloned = new Request(urlObj.toString(), req)
              return originalFetch(cloned, init)
            }
            return originalFetch(urlObj.toString(), init)
          }
        }

        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          // РўРѕР»СЊРєРѕ plain-object body РјРѕР¶РµРј СЂР°СЃС€РёСЂРёС‚СЊ.
          parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        }

        const { body: nextBody, mutated } = ensureJsonBodyFields(
          parsed as Record<string, unknown>,
        )

        if (!mutated) {
          return originalFetch(input as RequestInfo, init)
        }

        const nextBodyText = JSON.stringify(nextBody)

        const nextInit: RequestInit = {
          method,
          headers: headersObj,
          body: nextBodyText,
          credentials,
          mode,
          cache,
          redirect,
          referrer,
          integrity,
          keepalive,
          signal: signal ?? undefined,
        }

        return originalFetch(urlObj.toString(), nextInit)
      }

      return originalFetch(input as RequestInfo, init)
    } catch (err) {

      console.warn('[dev] fetch patch error, falling back to original', err)
      return originalFetch(input as RequestInfo, init)
    }
  }

  window.fetch = patchedFetch as typeof window.fetch


  console.info('[dev] fetch patched for dev Telegram identity')
}

export function applyDevTelegramMockIfNeeded(): void {
  if (!import.meta.env.DEV) return
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  const queryId =
    url.searchParams.get('telegram_id') || url.searchParams.get('as') || ''
  const queryUsername = url.searchParams.get('username') || ''
  const queryFirstName = url.searchParams.get('first_name') || ''

  const stored = readStoredIdentity()

  let identity: DevMockIdentity | null = stored

  if (queryId.trim()) {
    identity = {
      id: queryId.trim(),
      username: queryUsername.trim() || stored?.username || '',
      first_name:
        queryFirstName.trim() ||
        stored?.first_name ||
        `Dev User ${queryId.trim()}`,
    }
    persistIdentity(identity)

    url.searchParams.delete('telegram_id')
    url.searchParams.delete('as')
    url.searchParams.delete('username')
    url.searchParams.delete('first_name')
    window.history.replaceState({}, '', url.toString())
  }

  if (!identity) return

  const injected = injectMockWebApp(identity)

  ;(window as unknown as { clearDevTelegramMock: () => void }).clearDevTelegramMock = () => {
    try {
      sessionStorage.removeItem(DEV_MOCK_KEY)
    } catch {
      /* noop */
    }
    delete (window as unknown as { Telegram?: unknown }).Telegram
    window.location.reload()
  }

  // Real Mini App already mounted — do not patch fetch.
  if (!injected) return

  patchFetchForDevMock(identity)

  console.warn('[dev] Telegram WebApp mock applied', identity)
}

export function isDevTelegramMockActive(): boolean {
  return import.meta.env.DEV && Boolean(readStoredIdentity())
}
