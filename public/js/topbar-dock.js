(() => {
  const TARGETS = [
    {
      id: 'notification-center',
      placeholderSelector: '[data-open-notifications]',
    },
    {
      id: 'profile-menu-floating',
      placeholderSelector: '[data-profile-menu]',
    },
  ];

  function ensureDock() {
    const header = document.querySelector('.site-topbar');
    if (!header) return null;
    let dock = header.querySelector('.topbar-actions');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'topbar-actions';
      header.appendChild(dock);
    }
    return dock;
  }

  function attachToPlaceholder(node, placeholder) {
    if (!placeholder) return false;
    if (placeholder === node || placeholder.contains(node)) return true;

    if (placeholder.parentElement) {
      placeholder.replaceWith(node);
      return true;
    }

    return false;
  }

  function moveFloatingNodes() {
    const dock = ensureDock();
    if (!dock) return;

    TARGETS.forEach(({ id, placeholderSelector }) => {
      const node = document.getElementById(id);
      if (!node) return;

      const placeholder = placeholderSelector
        ? document.querySelector(placeholderSelector)
        : null;

      if (placeholder) {
        if (attachToPlaceholder(node, placeholder)) {
          return;
        }
      }

      if (node.parentElement !== dock) {
        dock.appendChild(node);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    moveFloatingNodes();
    const observer = new MutationObserver(moveFloatingNodes);
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
