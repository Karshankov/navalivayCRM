//! Нативные уведомления macOS для CRM.
//!
//! Задача: уведомления должны приходить, когда окно свёрнуто или скрыто.
//! Браузерный `Notification` так не умеет — он молчит, если страница неактивна,
//! и не работает в фоне на macOS.
//!
//! Решение — перехватить уведомления в самом окне и передать в систему.
//! Скрипт внедряется до загрузки страницы и подменяет `window.Notification`:
//! внешне он ведёт себя как обычный (те же `permission`, `requestPermission`,
//! конструктор), но показ уходит в системное уведомление.
//!
//! Благодаря этому фронтенд CRM остаётся обычным веб-приложением и не знает
//! ни о Tauri, ни о macOS: тот же код продолжает работать в браузере и в
//! Telegram. Ни одна строка CRM ради этого не менялась.
//!
//! Общение идёт через штатный плагин уведомлений и штатное окно: у них уже
//! есть готовые разрешения в capabilities. Свои команды пришлось бы отдельно
//! объявлять в ACL, а такие детали ломаются при обновлении Tauri.

/// Скрипт-перехватчик. Внедряется в окно до загрузки страницы.
///
/// Написан осторожно: если что-то недоступно, приложение продолжает работать
/// с обычным `Notification`, а не падает.
pub const NOTIFICATION_BRIDGE: &str = r#"
(function () {
  // Без Tauri (страница открыта в браузере или в Telegram) ничего не
  // подменяем: обычный Notification продолжает работать как раньше.
  if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return;
  if (window.__CRM_NATIVE_NOTIFICATIONS__) return;
  window.__CRM_NATIVE_NOTIFICATIONS__ = true;

  var invoke = window.__TAURI_INTERNALS__.invoke;
  var Original = window.Notification;
  // Считаем непрочитанные сами: надёжно спросить систему нельзя, а счётчик в
  // Dock должен переживать показ нескольких уведомлений подряд.
  var unread = 0;
  var seenTitles = Object.create(null);

  function updateBadge() {
    try {
      invoke('plugin:window|set_badge_label', {
        label: unread > 0 ? String(unread) : null,
      });
    } catch (e) {}
  }

  // Настоящее разрешение macOS спрашиваем сразу: без него система молча
  // проглотит все уведомления, а CRM будет считать, что всё в порядке.
  try {
    invoke('plugin:notification|request_permission').catch(function () {});
  } catch (e) {}

  function NativeNotification(title, options) {
    var opts = options || {};
    var text = String(title == null ? '' : title);
    var bodyText = opts.body ? String(opts.body) : '';

    // Одно и то же событие приходит и по SSE, и опросом-страховкой. Без этой
    // защиты пользователь получал бы два уведомления об одном заказе.
    var key = text + '|' + bodyText;
    var now = Date.now();
    if (seenTitles[key] && now - seenTitles[key] < 4000) return;
    seenTitles[key] = now;

    unread += 1;
    updateBadge();

    try {
      invoke('plugin:notification|notify', {
        options: {
          title: text,
          body: bodyText,
          // Звук помогает заметить заказ, когда на экран не смотрят.
          sound: 'default',
        },
      }).catch(function () {
        // Нативная доставка не удалась — не оставляем пользователя без сигнала.
        try {
          if (Original) new Original(text, opts);
        } catch (e) {}
      });
    } catch (e) {
      try {
        if (Original) new Original(text, opts);
      } catch (e2) {}
    }
  }

  NativeNotification.permission = 'granted';
  NativeNotification.maxActions = 0;
  NativeNotification.requestPermission = function (callback) {
    // Разрешение уже спрошено при старте окна. Здесь отвечаем CRM, что показ
    // разрешён: иначе она не станет слать уведомления вовсе.
    if (typeof callback === 'function') callback('granted');
    return Promise.resolve('granted');
  };
  NativeNotification.close = function () {};
  NativeNotification.prototype = Original ? Original.prototype : {};
  NativeNotification.prototype.close = function () {};

  window.Notification = NativeNotification;

  // Счётчик в Dock сбрасывается, когда окно вернулось на передний план:
  // пользователь смотрит в CRM, и число на иконке больше не нужно.
  function clearBadge() {
    unread = 0;
    updateBadge();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') clearBadge();
  });
  window.addEventListener('focus', clearBadge);

})();
"#;
