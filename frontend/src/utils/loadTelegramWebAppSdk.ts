const TELEGRAM_WEB_APP_SDK_URL =
  "https://telegram.org/js/telegram-web-app.js?59";

let sdkLoadPromise: Promise<void> | null = null;

/** Нужен только в Mini App; в /admin и в обычном Chrome не дергаем telegram.org. */
export function shouldLoadTelegramWebAppSdk(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.pathname.startsWith("/admin")) return false;
  if (window.Telegram?.WebApp) return false;

  const hash = window.location.hash || "";
  const search = window.location.search || "";
  if (hash.includes("tgWebAppData") || search.includes("tgWebAppData")) {
    return true;
  }

  const ua = navigator.userAgent || "";
  return /\bTelegram\b/i.test(ua) || /\btgios\b/i.test(ua);
}

/** Подгружает SDK без блокировки HTML; при ошибке сети админка не страдает. */
export function loadTelegramWebAppSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!shouldLoadTelegramWebAppSdk()) return Promise.resolve();
  if (window.Telegram?.WebApp) return Promise.resolve();

  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-telegram-web-app-sdk="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TELEGRAM_WEB_APP_SDK_URL;
    script.async = true;
    script.dataset.telegramWebAppSdk = "1";
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}
