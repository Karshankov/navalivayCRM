// Очистка кэшей - агрессивная для админки, щадящая для пользователей
(function() {
  const isAdmin = window.location.pathname.startsWith('/admin');
  
  if (!isAdmin && sessionStorage.getItem('cache_cleared')) {
    return;
  }
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
  }
  
  if ('caches' in window) {
    caches.keys().then(function(names) {
      for (const name of names) {
        caches.delete(name);
      }
    });
  }
  
  if (isAdmin) {
    try {
      localStorage.clear();
    } catch (e) {}
  }
  
  if (isAdmin) {
    try {
      sessionStorage.clear();
    } catch (e) {}
  }
  
  sessionStorage.setItem('cache_cleared', String(Date.now()));
})();
