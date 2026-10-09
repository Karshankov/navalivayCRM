export type FetchOptions = {
  method?: string
  headers?: Record<string, string>
  body?: any
}

export async function $fetch<T = any>(url: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body } = options

  const init: RequestInit = { method, headers: { ...headers } }

  // Handle body
  if (body !== undefined && body !== null) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      // Let the browser set Content-Type with proper boundary
      init.body = body as any
    } else if (typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer) {
      init.body = body as any
    } else {
      init.body = JSON.stringify(body)
      ;(init.headers as Record<string, string>)['Content-Type'] = (init.headers as Record<string, string>)['Content-Type'] || 'application/json'
    }
  }

  ;(init.headers as Record<string, string>)['Accept'] = (init.headers as Record<string, string>)['Accept'] || 'application/json'

  const res = await fetch(url, init)
  const contentType = res.headers.get('content-type') || ''

  let data: any
  if (contentType.includes('application/json')) {
    data = await res.json()
  } else {
    data = await res.text()
  }

  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || `Request failed with status ${res.status}`) as any
    err.data = data
    err.status = res.status
    throw err
  }

  return data as T
}