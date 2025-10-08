(() => {
  const TARGET_IDS = ['notification-center', 'profile-menu-floating'];

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

  function moveFloatingNodes() {
    const dock = ensureDock();
    if (!dock) return;
    TARGET_IDS.forEach((id) => {
      const node = document.getElementById(id);
      if (node && node.parentElement !== dock) {
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
