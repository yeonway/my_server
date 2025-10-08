(() => {
  const CONTAINER_ID = 'notification-center';
  const MAX_ITEMS = 50;

  document.addEventListener('DOMContentLoaded', async () => {
    if (!document.body) return;
    if (document.getElementById(CONTAINER_ID)) return;

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'notification-center hidden';
    container.innerHTML = `
      <button class="notification-trigger" type="button" data-role="trigger" aria-haspopup="true" aria-expanded="false">
        <span class="notification-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-4-5.65V4a2 2 0 1 0-4 0v1.35A6 6 0 0 0 6 11v5l-1.55 1.55A1 1 0 0 0 5.41 19h13.18a1 1 0 0 0 .71-1.7L18 16z" fill="currentColor"></path>
          </svg>
        </span>
        <span class="notification-badge" data-role="badge" hidden>0</span>
      </button>
      <div class="notification-dropdown" role="dialog" aria-label="알림">
        <div class="notification-header">
          <span class="notification-header-title">알림</span>
          <button type="button" class="mark-all-button" data-role="mark-all">전체 읽음</button>
        </div>
        <div class="notification-content">
          <div class="notification-empty" data-role="empty">새 알림이 없습니다.</div>
          <div class="notification-error" data-role="error" hidden>알림을 불러오지 못했습니다.</div>
          <ul class="notification-list" data-role="list"></ul>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const trigger = container.querySelector('[data-role="trigger"]');
    const badge = container.querySelector('[data-role="badge"]');
    const dropdown = container.querySelector('.notification-dropdown');
    const listEl = container.querySelector('[data-role="list"]');
    const emptyEl = container.querySelector('[data-role="empty"]');
    const errorEl = container.querySelector('[data-role="error"]');
    const markAllBtn = container.querySelector('[data-role="mark-all"]');

    const state = {
      token: null,
      notifications: [],
      unreadCount: 0,
      socket: null,
      hasLoaded: false,
      loading: false,
    };

    async function resolveToken() {
      if (typeof window.ensureAuthToken === 'function') {
        state.token = await window.ensureAuthToken();
      } else {
        state.token = localStorage.getItem('token');
      }
      if (!state.token) {
        hideCenter();
        disconnectSocket();
      }
      return state.token;
    }

    function showCenter() {
      container.classList.remove('hidden');
    }

    function hideCenter() {
      container.classList.add('hidden');
      badge.hidden = true;
      markAllBtn.disabled = true;
    }

    function disconnectSocket() {
      if (!state.socket) return;
      try {
        state.socket.off('notification:new');
        state.socket.off('notification:updated');
        state.socket.off('notification:read-all');
        state.socket.disconnect();
      } catch (error) {
        console.warn('[notifications] socket disconnect', error);
      }
      state.socket = null;
    }

    function ensureSocket() {
      if (state.socket || typeof io !== 'function' || !state.token) return;
      try {
        state.socket = io({ auth: { token: state.token } });
        state.socket.on('notification:new', (notification) => {
          applyNotificationUpdate(notification, { toFront: true });
        });
        state.socket.on('notification:updated', (notification) => {
          applyNotificationUpdate(notification);
        });
        state.socket.on('notification:read-all', () => {
          state.notifications = state.notifications.map((item) => ({ ...item, read: true }));
          state.unreadCount = 0;
          renderList();
          updateBadge();
        });
      } catch (error) {
        console.warn('[notifications] socket init failed', error);
      }
    }

    function updateBadge() {
      const count = Number(state.unreadCount) || 0;
      if (count > 0) {
        badge.hidden = false;
        badge.textContent = count > 99 ? '99+' : String(count);
      } else {
        badge.hidden = true;
        badge.textContent = '0';
      }
      markAllBtn.disabled = count === 0;
    }

    function setError(message) {
      if (!errorEl) return;
      if (message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
      } else {
        errorEl.hidden = true;
      }
    }

    function trim알림() {
      if (state.notifications.length > MAX_ITEMS) {
        state.notifications.length = MAX_ITEMS;
      }
    }

    function adjustUnreadCount(previous, current) {
      if (!current) return;
      const prevUnread = previous ? !previous.read : false;
      const currUnread = !current.read;
      if (prevUnread && !currUnread) {
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      } else if (!prevUnread && currUnread) {
        state.unreadCount += 1;
      }
    }

    function applyNotificationUpdate(notification, { toFront = false, adjustCount = true } = {}) {
      if (!notification || !notification.id) return;
      const index = state.notifications.findIndex((item) => item.id === notification.id);
      const previous = index !== -1 ? state.notifications[index] : null;
      const current = previous ? { ...previous, ...notification } : notification;

      if (index !== -1) {
        state.notifications[index] = current;
        if (toFront && index !== 0) {
          state.notifications.splice(index, 1);
          state.notifications.unshift(current);
        }
      } else {
        if (toFront) {
          state.notifications.unshift(current);
        } else {
          state.notifications.push(current);
        }
      }

      trim알림();
      if (adjustCount) {
        adjustUnreadCount(previous, current);
      }
      renderList();
      updateBadge();
    }

    function renderList() {
      if (!listEl) return;
      listEl.innerHTML = '';
      if (!state.notifications.length) {
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      state.notifications.forEach((notification) => {
        const li = document.createElement('li');
        li.className = 'notification-item' + (notification.read ? '' : ' unread');
        li.dataset.id = notification.id;
        li.setAttribute('role', 'button');
        li.tabIndex = 0;

        const title = document.createElement('div');
        title.className = 'notification-item-title';
        title.textContent = notification.message || 'New notification';

        const meta = document.createElement('div');
        meta.className = 'notification-item-meta';
        const parts = [];
        if (notification.actor && notification.actor.username) {
          parts.push(notification.actor.username);
        } else if (notification.actor && notification.actor.name) {
          parts.push(notification.actor.name);
        }
        const timeLabel = formatTimestamp(notification.createdAt);
        if (timeLabel) parts.push(timeLabel);
        meta.textContent = parts.join(' • ');

        li.appendChild(title);
        li.appendChild(meta);
        listEl.appendChild(li);
      });
    }

    function formatTimestamp(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const diff = Date.now() - date.getTime();
      if (diff < 60_000) return 'just now';
      if (diff < 3_600_000) {
        const minutes = Math.floor(diff / 60_000);
        return `${minutes}m ago`;
      }
      if (diff < 86_400_000) {
        const hours = Math.floor(diff / 3_600_000);
        return `${hours}h ago`;
      }
      return date.toLocaleDateString();
    }

    async function fetch알림() {
      const token = await resolveToken();
      if (!token) return;
      if (state.loading) return;
      state.loading = true;
      setError('');
      try {
        const res = await fetch(`/api/notifications?limit=${MAX_ITEMS}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          hideCenter();
          disconnectSocket();
          state.notifications = [];
          state.unreadCount = 0;
          renderList();
          updateBadge();
          return;
        }
        if (!res.ok) throw new Error('요청이 실패했습니다');
        const data = await res.json();
        state.notifications = Array.isArray(data.notifications) ? data.notifications.slice(0, MAX_ITEMS) : [];
        state.unreadCount = typeof data.unreadCount === 'number'
          ? data.unreadCount
          : state.notifications.filter((item) => !item.read).length;
        state.hasLoaded = true;
        showCenter();
        renderList();
        updateBadge();
      } catch (error) {
        console.warn('[notifications] load failed', error);
        setError('알림을 불러오지 못했습니다.');
      } finally {
        state.loading = false;
      }
    }

    async function markNotificationAsRead(id) {
      if (!id) return null;
      const token = await resolveToken();
      if (!token) return null;
      try {
        const res = await fetch(`/api/notifications/${id}/read`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          hideCenter();
          disconnectSocket();
          return null;
        }
        if (!res.ok) throw new Error('처리에 실패했습니다');
        const data = await res.json();
        if (data && typeof data.unreadCount === 'number') {
          state.unreadCount = data.unreadCount;
          updateBadge();
        }
        return data?.notification || null;
      } catch (error) {
        console.warn('[notifications] mark read failed', error);
        return null;
      }
    }

    async function markAllAsRead() {
      if (!state.unreadCount) return;
      const token = await resolveToken();
      if (!token) return;
      markAllBtn.disabled = true;
      try {
        const res = await fetch('/api/notifications/read-all', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          hideCenter();
          disconnectSocket();
          return;
        }
        if (!res.ok) throw new Error('전체 읽음 처리에 실패했습니다');
        const data = await res.json();
        state.notifications = state.notifications.map((item) => ({ ...item, read: true }));
        if (typeof data.unreadCount === 'number') {
          state.unreadCount = data.unreadCount;
        } else {
          state.unreadCount = 0;
        }
        renderList();
        updateBadge();
      } catch (error) {
        console.warn('[notifications] mark all read failed', error);
      } finally {
        markAllBtn.disabled = state.unreadCount === 0;
      }
    }

    function openDropdown() {
      if (container.classList.contains('hidden')) return;
      container.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      if (!state.hasLoaded) {
        fetch알림();
      }
    }

    function closeDropdown() {
      container.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function toggleDropdown() {
      if (container.classList.contains('open')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    }

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDropdown();
    });

    document.addEventListener('click', (event) => {
      if (!container.contains(event.target)) {
        closeDropdown();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDropdown();
      }
    });

    markAllBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      await markAllAsRead();
    });

    listEl.addEventListener('click', async (event) => {
      const item = event.target.closest('.notification-item');
      if (!item) return;
      const { id } = item.dataset;
      let notification = state.notifications.find((entry) => entry.id === id);
      if (!notification) return;
      if (!notification.read) {
        const updated = await markNotificationAsRead(id);
        if (updated) {
          applyNotificationUpdate(updated, { toFront: false, adjustCount: false });
        }
      }
      notification = state.notifications.find((entry) => entry.id === id) || notification;
      closeDropdown();
      if (notification.link) {
        window.location.href = notification.link;
      }
    });

    listEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('.notification-item');
      if (!item) return;
      event.preventDefault();
      item.click();
    });

    await resolveToken();
    if (state.token) {
      showCenter();
      ensureSocket();
      fetch알림();
    } else {
      hideCenter();
    }

    setInterval(async () => {
      const previousToken = state.token;
      await resolveToken();
      if (state.token && !previousToken) {
        showCenter();
        ensureSocket();
        fetch알림();
      }
    }, 120000);
  });
})();

