import { ProxyAgent } from 'undici';

const proxyDispatcher = (() => {
  const url = (process.env.TELEGRAM_HTTP_PROXY || '').trim();
  if (!url) {
    return null;
  }
  try {
    return new ProxyAgent({ uri: url });
  } catch (err) {
    console.error(
      '[telegram-http-proxy] failed to initialize ProxyAgent:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
})();

export function hasTelegramHttpProxy() {
  return Boolean(proxyDispatcher);
}

export function applyTelegramHttpProxy(fetchOptions = {}) {
  if (!proxyDispatcher) {
    return fetchOptions;
  }
  return {
    ...fetchOptions,
    dispatcher: proxyDispatcher,
  };
}