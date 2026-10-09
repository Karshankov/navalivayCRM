<template>
  <CustomerModalShell
    :open="phase !== 'hidden'"
    :title="modalTitle"
    :closable="false"
    :close-disabled="true"
  >
    <div v-if="phase === 'checking'" class="referral-gate__status" aria-live="polite">
      <span class="referral-gate__spinner" aria-hidden="true"></span>
      <p>Проверяем ваш доступ…</p>
    </div>

    <div v-else-if="phase === 'error'" class="referral-gate__status" aria-live="polite">
      <p class="referral-gate__error" role="alert">{{ errorMessage }}</p>
    </div>

    <form
      v-else-if="phase === 'required'"
      id="referral-authorization-form"
      class="referral-gate"
      @submit.prevent="submit"
    >
      <p class="referral-gate__copy">Чтобы посмотреть цены, укажите клиента, который вас пригласил.</p>
      <label class="referral-gate__label" for="global-referral-username">
        Username пригласившего
      </label>
      <div class="referral-gate__input-wrap">
        <span aria-hidden="true">@</span>
        <input
          id="global-referral-username"
          ref="inputRef"
          v-model.trim="inviterUsername"
          class="referral-gate__input"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          placeholder="username"
          :disabled="submitting"
          aria-describedby="global-referral-feedback"
          @input="handleInput"
          @paste="handleNativePaste"
        />
        <button
          type="button"
          class="referral-gate__paste"
          :aria-busy="clipboardBusy"
          :aria-disabled="submitting || clipboardBusy"
          aria-label="Вставить username из буфера обмена"
          @click="pasteInviterUsername"
        >
          {{ clipboardBusy ? "Читаем…" : "Вставить" }}
        </button>
      </div>
      <div id="global-referral-feedback" aria-live="polite">
        <p v-if="errorMessage" class="referral-gate__error" role="alert">{{ errorMessage }}</p>
        <p v-if="clipboardHint" class="referral-gate__clipboard-hint">{{ clipboardHint }}</p>
        <p class="referral-gate__attempts">Осталось попыток: {{ attemptsRemaining }}</p>
      </div>
    </form>

    <template #footer>
      <div class="referral-gate__actions">
        <button
          v-if="phase === 'required'"
          form="referral-authorization-form"
          type="submit"
          class="referral-gate__cta"
          :disabled="submitting || clipboardBusy || !inviterUsername.trim()"
        >
          {{ submitting ? "Проверяем…" : "Пройти авторизацию" }}
        </button>
        <template v-else-if="phase === 'error'">
          <button
            ref="retryButtonRef"
            type="button"
            class="referral-gate__cta"
            @click="handleRetry"
          >
            Повторить
          </button>
          <button
            v-if="canCloseMiniApp"
            type="button"
            class="referral-gate__close-app"
            @click="closeMiniApp"
          >
            Закрыть магазин
          </button>
        </template>
        <button
          v-else-if="phase === 'checking' && canCloseMiniApp"
          type="button"
          class="referral-gate__close-app"
          @click="closeMiniApp"
        >
          Закрыть магазин
        </button>
      </div>
    </template>
  </CustomerModalShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CustomerModalShell from "@/components/CustomerModalShell.vue";
import { useCustomerBlock } from "@/composables/useCustomerBlock";
import { getTelegramIdentity } from "@/utils/customerOrders";
import { isDevTelegramMockActive } from "@/utils/devTelegramMock";
import { getTelegramInitData, withTelegramAuthHeaders } from "@/utils/telegramAuth";

type GatePhase = "hidden" | "checking" | "required" | "error";

const USERNAME_RETRY_DELAYS_MS = [0, 1200, 2400, 4000] as const;
const USERNAME_RETRY_TIMEOUT_MS = 16000;
const STATUS_CHECK_TIMEOUT_MS = 14000;
const BROWSER_CLIPBOARD_TIMEOUT_MS = 1200;
const TELEGRAM_CLIPBOARD_TIMEOUT_MS = 800;
const TELEGRAM_SERVICE_PATHS = new Set([
  "a",
  "addemoji",
  "addlist",
  "addstickers",
  "addstyle",
  "addtheme",
  "auction",
  "auth",
  "boost",
  "call",
  "confirmphone",
  "contact",
  "giftcode",
  "invoice",
  "iv",
  "joinchat",
  "k",
  "login",
  "m",
  "newbot",
  "nft",
  "oauth",
  "proxy",
  "setlanguage",
  "share",
  "socks",
  "web",
  "z",
]);

const emit = defineEmits<{
  authorized: [];
  "gate-active": [active: boolean];
}>();
const { applyBlockFromResponse } = useCustomerBlock();
const phase = ref<GatePhase>("checking");
const inviterUsername = ref("");
const errorMessage = ref("");
const attemptsRemaining = ref(3);
const submitting = ref(false);
const clipboardBusy = ref(false);
const clipboardHint = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const retryButtonRef = ref<HTMLButtonElement | null>(null);
let refreshRunId = 0;
let clipboardRunId = 0;
let activeRefreshController: AbortController | null = null;

const modalTitle = computed(() => {
  if (phase.value === "checking") return "Проверяем доступ";
  if (phase.value === "error") return "Не удалось проверить доступ";
  return "Кто порекомендовал нас?";
});

const canCloseMiniApp = computed(() => typeof window.Telegram?.WebApp?.close === "function");

function wait(ms: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, ms);
    function handleAbort() {
      window.clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function checkLiveUsername(runId: number, retryUntilUpdated: boolean, signal: AbortSignal) {
  const delays = retryUntilUpdated ? USERNAME_RETRY_DELAYS_MS : [0];
  let lastStatus: Record<string, unknown> = {};

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const delay = delays[attempt] ?? 0;
    if (delay > 0 && !await wait(delay, signal)) return false;
    if (runId !== refreshRunId || signal.aborted) return false;

    const cacheBuster = `${Date.now()}-${attempt}`;
    const usernameResponse = await fetch(`/api/telegram/username-status?check=${cacheBuster}`, {
      headers: withTelegramAuthHeaders(),
      credentials: "include",
      cache: "no-store",
      signal,
    });
    const usernameStatus = await usernameResponse.json().catch(() => ({}));
    if (runId !== refreshRunId) return false;
    if (usernameResponse.status === 401) {
      errorMessage.value = "Сессия Telegram устарела. Закройте и заново откройте магазин.";
      phase.value = "error";
      return false;
    }
    if (!usernameResponse.ok) {
      throw new Error("Не удалось проверить username. Проверьте интернет и повторите.");
    }
    if (usernameStatus?.hasUsername) return true;
    lastStatus = usernameStatus;
  }

  if (retryUntilUpdated) {
    errorMessage.value = "Telegram ещё не обновил username. Подождите 10–20 секунд и повторите проверку.";
  } else if (lastStatus?.status === "missing") {
    errorMessage.value = "Установите имя пользователя @username в настройках Telegram";
  } else {
    errorMessage.value = String(lastStatus?.message || "Не удалось получить обновлённый username. Попробуйте ещё раз.");
  }
  phase.value = "error";
  return false;
}

async function refreshStatus(options: { retryUsername?: boolean } = {}) {
  const runId = ++refreshRunId;
  activeRefreshController?.abort();
  const controller = new AbortController();
  activeRefreshController = controller;
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.retryUsername ? USERNAME_RETRY_TIMEOUT_MS : STATUS_CHECK_TIMEOUT_MS,
  );
  const identity = getTelegramIdentity();
  if ((!getTelegramInitData() && !isDevTelegramMockActive()) || !identity.telegramId) {
    window.clearTimeout(timeout);
    if (activeRefreshController === controller) activeRefreshController = null;
    errorMessage.value = "Откройте приложение через Telegram, чтобы пройти авторизацию.";
    phase.value = "error";
    return;
  }
  phase.value = "checking";
  errorMessage.value = "";
  try {
    if (!identity.telegramUsername) {
      const hasLiveUsername = await checkLiveUsername(
        runId,
        Boolean(options.retryUsername),
        controller.signal,
      );
      if (runId !== refreshRunId) return;
      if (controller.signal.aborted) throw new DOMException("Проверка прервана", "AbortError");
      if (!hasLiveUsername) return;
    }
    const response = await fetch("/api/referral-authorization/status", {
      headers: withTelegramAuthHeaders(),
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (runId !== refreshRunId || controller.signal.aborted) return;
    if (!response.ok) throw new Error("Не удалось проверить доступ. Проверьте интернет и повторите.");
    const status = await response.json();
    if (runId !== refreshRunId || controller.signal.aborted) return;
    attemptsRemaining.value = Number(status?.attempts_remaining ?? 3);
    if (status?.blocked) {
      applyBlockFromResponse({
        reason: status?.block?.reason ?? "Авторизация не пройдена",
        block_until: status?.block?.block_until ?? null,
      });
      phase.value = "hidden";
      return;
    }
    phase.value = status?.enabled && status?.required ? "required" : "hidden";
  } catch (error) {
    if (runId !== refreshRunId) return;
    if (controller.signal.aborted) {
      errorMessage.value = "Telegram отвечает дольше обычного. Подождите несколько секунд и повторите проверку.";
      phase.value = "error";
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : "Не удалось проверить доступ";
    phase.value = "error";
  } finally {
    window.clearTimeout(timeout);
    if (activeRefreshController === controller) activeRefreshController = null;
  }
}

function handleRetry() {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
  void refreshStatus({ retryUsername: true });
}

function handleTelegramActivated() {
  if (phase.value === "required") {
    window.requestAnimationFrame(() => focusInviterInput());
    return;
  }
  if (phase.value === "error" && !getTelegramIdentity().telegramUsername) {
    void refreshStatus({ retryUsername: true });
  }
}

function closeMiniApp() {
  window.Telegram?.WebApp?.close?.();
}

function handleAuthorizationRequired() {
  void refreshStatus();
}

watch(
  phase,
  async (nextPhase) => {
    if (nextPhase !== "required") {
      clipboardRunId += 1;
      clipboardBusy.value = false;
    }
    emit("gate-active", nextPhase !== "hidden");
    await nextTick();
    if (nextPhase === "required") inputRef.value?.focus();
    if (nextPhase === "error") retryButtonRef.value?.focus();
  },
  { immediate: true },
);

function handleInput(event: Event) {
  clipboardRunId += 1;
  clipboardBusy.value = false;
  const input = event.target as HTMLInputElement | null;
  inviterUsername.value = String(input?.value || "").trimStart().replace(/^@+/, "");
  errorMessage.value = "";
  clipboardHint.value = "";
}

function focusInviterInput(selectExisting = false) {
  const input = inputRef.value;
  if (!input || phase.value !== "required") return;
  input.focus({ preventScroll: true });
  if (selectExisting && input.value) {
    input.select();
    return;
  }
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function normalizeClipboardUsername(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";

  let candidate = text.replace(/^@+/, "");
  const link = text.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (link?.[1]) {
    candidate = link[1];
    if (TELEGRAM_SERVICE_PATHS.has(candidate.toLowerCase())) return "";
  }
  return /^[a-zA-Z0-9_]{5,32}$/.test(candidate) ? candidate : "";
}

function applyPastedUsername(username: string) {
  inviterUsername.value = username;
  errorMessage.value = "";
  clipboardHint.value = "Username вставлен";
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
  void nextTick(() => focusInviterInput());
}

function handleNativePaste(event: ClipboardEvent) {
  event.preventDefault();
  const clipboardText = event.clipboardData?.getData("text") || "";
  clipboardRunId += 1;
  clipboardBusy.value = false;
  if (!clipboardText) {
    clipboardHint.value = "Не удалось прочитать вставку. Скопируйте username и повторите.";
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
    focusInviterInput(true);
    return;
  }
  const username = normalizeClipboardUsername(clipboardText);
  if (!username) {
    clipboardHint.value = "В буфере нет корректного Telegram username.";
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
    focusInviterInput(true);
    return;
  }
  applyPastedUsername(username);
}

function settleWithin<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    promise.then((value) => finish(value), () => finish(null));
  });
}

function readBrowserClipboard() {
  if (typeof navigator.clipboard?.readText !== "function") {
    return Promise.resolve<string | null>(null);
  }
  try {
    return settleWithin(navigator.clipboard.readText(), BROWSER_CLIPBOARD_TIMEOUT_MS);
  } catch {
    return Promise.resolve<string | null>(null);
  }
}

function readTelegramClipboard() {
  const webApp = window.Telegram?.WebApp;
  const readText = webApp?.readTextFromClipboard;
  if (typeof readText !== "function") return Promise.resolve<string | null>(null);

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), TELEGRAM_CLIPBOARD_TIMEOUT_MS);
    try {
      readText.call(webApp, (value) => finish(value || null));
    } catch {
      finish(null);
    }
  });
}

async function readClipboardUsername() {
  const [browserValue, telegramValue] = await Promise.all([
    readBrowserClipboard(),
    readTelegramClipboard(),
  ]);
  const browserText = String(browserValue || "").trim();
  const telegramText = String(telegramValue || "").trim();
  const browserUsername = normalizeClipboardUsername(browserText);
  if (browserUsername) return { username: browserUsername, hasText: true };
  const telegramUsername = normalizeClipboardUsername(telegramText);
  if (telegramUsername) return { username: telegramUsername, hasText: true };
  return { username: "", hasText: Boolean(browserText || telegramText) };
}

async function pasteInviterUsername() {
  if (clipboardBusy.value || submitting.value) return;
  const runId = ++clipboardRunId;
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
  focusInviterInput(true);
  clipboardBusy.value = true;
  clipboardHint.value = "";
  try {
    const { username, hasText } = await readClipboardUsername();
    if (runId !== clipboardRunId || phase.value !== "required") return;
    if (!username) {
      clipboardHint.value = hasText
        ? "В буфере нет корректного Telegram username."
        : "Telegram защищает буфер. Зажмите поле и выберите «Вставить».";
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("warning");
      focusInviterInput(true);
      return;
    }
    applyPastedUsername(username);
  } finally {
    if (runId === clipboardRunId) clipboardBusy.value = false;
  }
}

async function submit() {
  if (submitting.value || clipboardBusy.value || !inviterUsername.value.trim()) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    const response = await fetch("/api/referral-authorization/authorize", {
      method: "POST",
      headers: withTelegramAuthHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ inviter_username: inviterUsername.value.trim() }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      attemptsRemaining.value = Number(result?.attempts_remaining ?? attemptsRemaining.value);
      if (result?.error === "customer_blocked") {
        applyBlockFromResponse(result?.block ?? { reason: "Авторизация не пройдена", block_until: null });
        phase.value = "hidden";
        return;
      }
      errorMessage.value = result?.message || "Не удалось проверить пригласившего";
      return;
    }
    phase.value = "hidden";
    emit("authorized");
  } catch {
    errorMessage.value = "Не удалось проверить доступ. Проверьте интернет и повторите.";
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  window.addEventListener("referral-authorization-required", handleAuthorizationRequired);
  window.Telegram?.WebApp?.onEvent?.("activated", handleTelegramActivated);
  void refreshStatus();
});

onBeforeUnmount(() => {
  refreshRunId += 1;
  clipboardRunId += 1;
  activeRefreshController?.abort();
  activeRefreshController = null;
  window.removeEventListener("referral-authorization-required", handleAuthorizationRequired);
  window.Telegram?.WebApp?.offEvent?.("activated", handleTelegramActivated);
});
</script>

<style scoped>
.referral-gate,
.referral-gate__status {
  display: grid;
  gap: 14px;
}

.referral-gate__copy,
.referral-gate__status p,
.referral-gate__attempts,
.referral-gate__error,
.referral-gate__clipboard-hint {
  margin: 0;
  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 20px;
}

.referral-gate__copy {
  color: #626975;
}

.referral-gate__label {
  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #30343b;
}

.referral-gate__input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 58px;
  padding: 0 18px;
  border: 1px solid #d8dce2;
  border-radius: 18px;
  background: #fff;
  color: #737b87;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.referral-gate__input-wrap:focus-within {
  border-color: #f50302;
  box-shadow: 0 0 0 3px rgba(245, 3, 2, 0.1);
}

.referral-gate__input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 16px;
  color: #191919;
}

.referral-gate__paste {
  min-height: 44px;
  min-width: 66px;
  flex: 0 0 auto;
  padding: 0 2px 0 10px;
  border: 0;
  background: transparent;
  color: #d20a09;
  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.referral-gate__paste:active:not([aria-disabled="true"]) {
  opacity: 0.58;
}

.referral-gate__paste:focus-visible {
  outline: 2px solid rgba(210, 10, 9, 0.32);
  outline-offset: 2px;
  border-radius: 8px;
}

.referral-gate__paste[aria-disabled="true"] {
  cursor: wait;
  opacity: 0.48;
}

.referral-gate__error {
  margin-top: 10px;
  color: #b42318;
}

.referral-gate__attempts {
  margin-top: 6px;
  color: #7a828e;
}

.referral-gate__clipboard-hint {
  margin-top: 8px;
  color: #626975;
}

.referral-gate__cta {
  width: 100%;
  min-height: 54px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  color: #fff;
  font-family: "Montserrat", sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.referral-gate__actions {
  display: grid;
  gap: 10px;
  width: 100%;
}

.referral-gate__close-app {
  min-height: 44px;
  padding: 2px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #626975;
  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.referral-gate__close-app:active {
  opacity: 0.6;
}

.referral-gate__close-app:focus-visible {
  outline: 2px solid rgba(210, 10, 9, 0.32);
  outline-offset: 2px;
}

.referral-gate__cta:active:not(:disabled) {
  transform: scale(0.985);
}

.referral-gate__cta:disabled {
  cursor: wait;
  opacity: 0.58;
}

.referral-gate__status {
  justify-items: center;
  padding: 10px 0 2px;
  color: #626975;
  text-align: center;
}

.referral-gate__spinner {
  width: 26px;
  height: 26px;
  border: 3px solid #eceff3;
  border-top-color: #d20a09;
  border-radius: 50%;
  animation: referral-gate-spin 0.75s linear infinite;
}

@keyframes referral-gate-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .referral-gate__spinner { animation-duration: 1.5s; }
  .referral-gate__cta { transition: none; }
}
</style>
