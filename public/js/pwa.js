(() => {
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/service-worker.js')
        .catch((error) => console.error('[pwa] service worker registration failed', error));
    });
  }

  function setupOnlineOfflineIndicators() {
    const indicator = document.querySelector('[data-network-indicator]');
    if (!indicator) return;
    function update() {
      if (navigator.onLine) {
        indicator.textContent = '온라인';
        indicator.classList.remove('offline');
      } else {
        indicator.textContent = '오프라인';
        indicator.classList.add('offline');
      }
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  registerServiceWorker();
  setupOnlineOfflineIndicators();
})();
