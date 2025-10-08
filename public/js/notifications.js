(() => {
  const CONTAINER_ID = 'notification-center';
  const MAX_ITEMS = 50;
  const FILTERS = [
    { id: 'all', label: '전체', types: [] },
    { id: 'mention', label: '멘션', types: ['mention'] },
    { id: 'dm', label: 'DM', types: ['dm'] },
    { id: 'comment', label: '댓글', types: ['comment'] },
    { id: 'announcement', label: '공지', types: ['announcement'] },
  ];
  const TYPE_LABELS = {
    mention: '멘션',
    dm: 'DM',
    comment: '댓글',
    announcement: '공지',
    group_invite: '그룹 초대',
  };

  function createEmptySummary() {
    const summary = { all: { total: 0, unread: 0 } };
    FILTERS.filter((filter) => filter.id !== 'all').forEach((filter) => {
      summary[filter.id] = { total: 0, unread: 0 };
    });
    return summary;
  }

  function getFilterDefinition(filterId) {
    return FILTERS.find((filter) => filter.id === filterId) || FILTERS[0];
  }

  function getFilterIdsForNotification(notification) {
    const ids = new Set(['all']);
    if (notification && notification.type) {
      FILTERS.filter((filter) => filter.id !== 'all').forEach((filter) => {
        if (filter.types.includes(notification.type)) {
          ids.add(filter.id);
        }
      });
    }
    return Array.from(ids);
  }

  function cloneNotification(notification) {
    if (!notification) return null;
    const payload = notification.payload && typeof notification.payload === 'object'
      ? {
          ...notification.payload,
          quickReply:
            notification.payload.quickReply && typeof notification.payload.quickReply === 'object'
              ? { ...notification.payload.quickReply }
              : notification.payload.quickReply,
        }
      : notification.payload;
    return {
      ...notification,
      actor: notification.actor ? { ...notification.actor } : null,
      payload,
    };
  }

  function formatRelativeTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return '방금 전';
    if (diff < 3_600_000) {
      const minutes = Math.floor(diff / 60_000);
      return `${minutes}분 전`;
    }
    if (diff < 86_400_000) {
      const hours = Math.floor(diff / 3_600_000);
      return `${hours}시간 전`;
    }
    return date.toLocaleDateString();
  }

  function formatAbsoluteTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  function createModal() {
    const modal = document.createElement('div');
    modal.className = 'notification-modal hidden';
    modal.setAttribute('data-role', 'modal-root');
    modal.innerHTML = `
      <div class="notification-modal-backdrop" data-role="modal-backdrop"></div>
      <div class="notification-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-modal-title" tabindex="-1" data-role="modal-dialog">
        <button type="button" class="notification-modal-close" data-role="modal-close" aria-label="닫기">&times;</button>
        <div class="notification-modal-header">
          <span class="notification-modal-type" data-role="modal-type"></span>
          <button type="button" class="notification-modal-link" data-role="modal-link" hidden>원문 이동</button>
        </div>
        <div class="notification-modal-loading" data-role="modal-loading" hidden>불러오는 중...</div>
        <div class="notification-modal-error" data-role="modal-error" hidden>알림을 불러오지 못했습니다.</div>
        <div class="notification-modal-body">
          <h2 class="notification-modal-title" id="notification-modal-title" data-role="modal-title"></h2>
          <div class="notification-modal-meta" data-role="modal-meta"></div>
          <p class="notification-modal-message" data-role="modal-message"></p>
          <div class="notification-modal-payload" data-role="modal-payload" hidden>
            <h3>관련 정보</h3>
            <dl data-role="modal-payload-list"></dl>
          </div>
        </div>
        <div class="notification-modal-feedback" data-role="modal-feedback" hidden></div>
        <form class="notification-quick-reply" data-role="quick-reply" hidden>
          <label class="notification-quick-reply-label" for="notification-quick-reply-input">빠른 답장</label>
          <textarea id="notification-quick-reply-input" data-role="quick-reply-input" rows="3" maxlength="1000" placeholder="메시지를 입력하세요"></textarea>
          <div class="notification-quick-reply-footer">
            <span class="notification-quick-reply-error" data-role="quick-reply-error"></span>
            <button type="submit" class="notification-quick-reply-submit" data-role="quick-reply-submit">보내기</button>
          </div>
        </form>
      </div>
    `;

    return {
      root: modal,
      backdrop: modal.querySelector('[data-role="modal-backdrop"]'),
      dialog: modal.querySelector('[data-role="modal-dialog"]'),
      close: modal.querySelector('[data-role="modal-close"]'),
      type: modal.querySelector('[data-role="modal-type"]'),
      title: modal.querySelector('[data-role="modal-title"]'),
      message: modal.querySelector('[data-role="modal-message"]'),
      meta: modal.querySelector('[data-role="modal-meta"]'),
      link: modal.querySelector('[data-role="modal-link"]'),
      payloadSection: modal.querySelector('[data-role="modal-payload"]'),
      payloadList: modal.querySelector('[data-role="modal-payload-list"]'),
      loading: modal.querySelector('[data-role="modal-loading"]'),
      error: modal.querySelector('[data-role="modal-error"]'),
      quickReply: modal.querySelector('[data-role="quick-reply"]'),
      quickReplyInput: modal.querySelector('[data-role="quick-reply-input"]'),
      quickReplyError: modal.querySelector('[data-role="quick-reply-error"]'),
      quickReplySubmit: modal.querySelector('[data-role="quick-reply-submit"]'),
      feedback: modal.querySelector('[data-role="modal-feedback"]'),
    };
  }

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
        <div class="notification-filters" data-role="filters"></div>
        <div class="notification-content">
          <div class="notification-loading" data-role="loading" hidden>불러오는 중...</div>
          <div class="notification-empty" data-role="empty">새 알림이 없습니다.</div>
          <div class="notification-error" data-role="error" hidden>알림을 불러오지 못했습니다.</div>
          <ul class="notification-list" data-role="list"></ul>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const modal = createModal();
    document.body.appendChild(modal.root);

    const trigger = container.querySelector('[data-role="trigger"]');
    const badge = container.querySelector('[data-role="badge"]');
    const dropdown = container.querySelector('.notification-dropdown');
    const filtersEl = container.querySelector('[data-role="filters"]');
    const listEl = container.querySelector('[data-role="list"]');
    const emptyEl = container.querySelector('[data-role="empty"]');
    const errorEl = container.querySelector('[data-role="error"]');
    const loadingEl = container.querySelector('[data-role="loading"]');
    const markAllBtn = container.querySelector('[data-role="mark-all"]');

    const collections = {};
    FILTERS.forEach((filter) => {
      collections[filter.id] = [];
    });

    const state = {
      token: null,
      socket: null,
      filter: 'all',
      unreadCount: 0,
      collections,
      summary: createEmptySummary(),
      detailCache: new Map(),
      loading: {},
      errors: {},
      loadedFilters: new Set(),
      selectedId: null,
      hasLoaded: false,
      quickReplyFeedbackTimer: null,
    };

    function showCenter() {
      container.classList.remove('hidden');
    }

    function hideCenter() {
      container.classList.add('hidden');
      closeDropdown();
    }

    function closeModal() {
      if (modal.root.classList.contains('hidden')) return;
      modal.root.classList.add('hidden');
      document.body.classList.remove('notification-modal-open');
      state.selectedId = null;
      modal.quickReplyInput.value = '';
      modal.quickReplyError.textContent = '';
      modal.feedback.hidden = true;
      if (state.quickReplyFeedbackTimer) {
        clearTimeout(state.quickReplyFeedbackTimer);
        state.quickReplyFeedbackTimer = null;
      }
    }

    function openModal(id) {
      state.selectedId = id;
      modal.root.classList.remove('hidden');
      document.body.classList.add('notification-modal-open');
      setModalError('');
      setModalLoading(false);
      modal.feedback.hidden = true;
      modal.quickReplyError.textContent = '';
      requestAnimationFrame(() => {
        modal.dialog.focus();
      });
    }

    function setModalLoading(loading) {
      if (!modal.loading) return;
      modal.loading.hidden = !loading;
    }

    function setModalError(message) {
      if (!modal.error) return;
      if (message) {
        modal.error.hidden = false;
        modal.error.textContent = message;
      } else {
        modal.error.hidden = true;
      }
    }

    function setQuickReplyError(message) {
      if (!modal.quickReplyError) return;
      modal.quickReplyError.textContent = message || '';
    }

    function showQuickReplyFeedback(message) {
      if (!modal.feedback) return;
      modal.feedback.hidden = false;
      modal.feedback.textContent = message;
      if (state.quickReplyFeedbackTimer) {
        clearTimeout(state.quickReplyFeedbackTimer);
      }
      state.quickReplyFeedbackTimer = setTimeout(() => {
        modal.feedback.hidden = true;
        state.quickReplyFeedbackTimer = null;
      }, 4000);
    }

    function resetCollections() {
      FILTERS.forEach((filter) => {
        state.collections[filter.id] = [];
      });
    }

    function handleUnauthorized() {
      state.token = null;
      state.unreadCount = 0;
      state.summary = createEmptySummary();
      state.detailCache.clear();
      state.errors = {};
      state.loading = {};
      state.loadedFilters.clear();
      state.hasLoaded = false;
      state.selectedId = null;
      resetCollections();
      renderFilters();
      renderList();
      updateBadge();
      closeModal();
      hideCenter();
      disconnectSocket();
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
          applyNotificationUpdate(notification, { toFront: true, adjustCount: true });
        });
        state.socket.on('notification:updated', (notification) => {
          applyNotificationUpdate(notification, { toFront: false, adjustCount: true });
        });
        state.socket.on('notification:read-all', () => {
          markAllLocalAsRead({ adjustSummary: true });
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

    function setSummaryFromServer(summary) {
      const merged = createEmptySummary();
      if (summary && typeof summary === 'object') {
        Object.entries(summary).forEach(([key, value]) => {
          if (!merged[key]) {
            merged[key] = { total: 0, unread: 0 };
          }
          if (value && typeof value === 'object') {
            if (typeof value.total === 'number') merged[key].total = value.total;
            if (typeof value.unread === 'number') merged[key].unread = value.unread;
          }
        });
      }
      state.summary = merged;
      renderFilters();
    }

    function setCollection(filterId, notifications) {
      const list = Array.isArray(notifications) ? notifications.slice(0, MAX_ITEMS) : [];
      state.collections[filterId] = list.map((item) => cloneNotification(item));
    }

    function getCollection(filterId) {
      return state.collections[filterId] || [];
    }

    function removeFromCollection(filterId, id) {
      const list = state.collections[filterId];
      if (!Array.isArray(list)) return;
      state.collections[filterId] = list.filter((item) => item.id !== id);
    }

    function upsertCollection(filterId, notification, { toFront = false } = {}) {
      const list = Array.isArray(state.collections[filterId])
        ? state.collections[filterId].slice()
        : [];
      const index = list.findIndex((item) => item.id === notification.id);
      const entry = cloneNotification(notification);
      if (index !== -1) {
        list[index] = entry;
        if (toFront && index !== 0) {
          list.splice(index, 1);
          list.unshift(entry);
        }
      } else if (toFront) {
        list.unshift(entry);
      } else {
        list.push(entry);
      }
      if (list.length > MAX_ITEMS) {
        list.length = MAX_ITEMS;
      }
      state.collections[filterId] = list;
    }

    function adjustUnreadCount(previous, current) {
      const prevUnread = previous ? !previous.read : false;
      const currUnread = !current.read;
      if (prevUnread && !currUnread) {
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      } else if (!prevUnread && currUnread) {
        state.unreadCount += 1;
      }
    }

    function adjustSummaryCounts(previous, current) {
      if (!state.summary) {
        state.summary = createEmptySummary();
      }
      const ensureKey = (key) => {
        if (!state.summary[key]) {
          state.summary[key] = { total: 0, unread: 0 };
        }
      };
      ensureKey('all');
      const currentType = current.type || 'other';
      ensureKey(currentType);

      if (!previous) {
        state.summary.all.total += 1;
        state.summary[currentType].total += 1;
        if (!current.read) {
          state.summary.all.unread += 1;
          state.summary[currentType].unread += 1;
        }
        return;
      }

      const previousType = previous.type || currentType;
      ensureKey(previousType);
      if (previousType !== currentType) {
        state.summary[previousType].total = Math.max(0, (state.summary[previousType].total || 1) - 1);
        state.summary[currentType].total += 1;
      }

      const prevUnread = !previous.read;
      const currUnread = !current.read;
      if (prevUnread && !currUnread) {
        state.summary.all.unread = Math.max(0, state.summary.all.unread - 1);
        state.summary[previousType].unread = Math.max(0, state.summary[previousType].unread - 1);
      } else if (!prevUnread && currUnread) {
        state.summary.all.unread += 1;
        state.summary[currentType].unread += 1;
      }
    }

    function renderFilters() {
      if (!filtersEl) return;
      filtersEl.innerHTML = '';
      FILTERS.forEach((filter) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'notification-filter-button' + (state.filter === filter.id ? ' active' : '');
        button.dataset.filter = filter.id;
        button.setAttribute('aria-pressed', state.filter === filter.id ? 'true' : 'false');

        const label = document.createElement('span');
        label.textContent = filter.label;
        button.appendChild(label);

        const summary = state.summary[filter.id] || { total: 0, unread: 0 };
        if (summary.unread > 0) {
          const badgeEl = document.createElement('span');
          badgeEl.className = 'notification-filter-badge';
          badgeEl.textContent = summary.unread > 99 ? '99+' : String(summary.unread);
          button.appendChild(badgeEl);
        }

        filtersEl.appendChild(button);
      });
    }

    function updateEmptyMessage(filterId) {
      const filter = getFilterDefinition(filterId);
      if (!emptyEl) return;
      if (filter.id === 'all') {
        emptyEl.textContent = '새 알림이 없습니다.';
      } else {
        emptyEl.textContent = `${filter.label} 알림이 없습니다.`;
      }
    }

    function renderList() {
      if (!listEl) return;
      const filterId = state.filter;
      const notifications = getCollection(filterId);
      const loading = Boolean(state.loading[filterId]);
      const error = state.errors[filterId] || '';

      updateEmptyMessage(filterId);

      if (loadingEl) {
        loadingEl.hidden = !loading;
      }

      if (errorEl) {
        if (error) {
          errorEl.hidden = false;
          errorEl.textContent = error;
        } else {
          errorEl.hidden = true;
        }
      }

      if (emptyEl) {
        emptyEl.hidden = loading || !!error || notifications.length > 0;
      }

      listEl.innerHTML = '';
      if (loading || error || !notifications.length) {
        return;
      }

      notifications.forEach((notification) => {
        const li = document.createElement('li');
        li.className = 'notification-item' + (notification.read ? '' : ' unread');
        if (state.selectedId === notification.id) {
          li.classList.add('active');
        }
        li.dataset.id = notification.id;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'notification-item-button';

        const header = document.createElement('div');
        header.className = 'notification-item-header';

        const typeBadge = document.createElement('span');
        typeBadge.className = `notification-item-type notification-type-${notification.type || 'default'}`;
        typeBadge.textContent = TYPE_LABELS[notification.type] || '알림';
        header.appendChild(typeBadge);

        const timeEl = document.createElement('time');
        timeEl.className = 'notification-item-time';
        timeEl.dateTime = notification.createdAt || '';
        timeEl.textContent = formatRelativeTime(notification.createdAt);
        header.appendChild(timeEl);

        button.appendChild(header);

        const title = document.createElement('div');
        title.className = 'notification-item-title';
        title.textContent = notification.message || '새 알림';
        button.appendChild(title);

        if (notification.actor && (notification.actor.username || notification.actor.name)) {
          const meta = document.createElement('div');
          meta.className = 'notification-item-meta';
          meta.textContent = notification.actor.username || notification.actor.name;
          button.appendChild(meta);
        }

        li.appendChild(button);
        listEl.appendChild(li);
      });
    }

    function closeDropdown() {
      container.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function openDropdown() {
      if (container.classList.contains('hidden')) return;
      container.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      if (!state.loadedFilters.has(state.filter)) {
        fetchNotifications({ filterId: state.filter });
      }
    }

    function toggleDropdown() {
      if (container.classList.contains('open')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    }

    function markAllLocalAsRead({ adjustSummary = true } = {}) {
      const now = new Date().toISOString();
      Object.keys(state.collections).forEach((filterId) => {
        const list = state.collections[filterId];
        if (!Array.isArray(list)) return;
        state.collections[filterId] = list.map((item) => ({
          ...item,
          read: true,
          readAt: item.readAt || now,
        }));
      });
      state.detailCache.forEach((value, key) => {
        state.detailCache.set(key, {
          ...value,
          read: true,
          readAt: value.readAt || now,
        });
      });
      if (adjustSummary) {
        const summary = createEmptySummary();
        Object.entries(state.summary || {}).forEach(([key, value]) => {
          if (!summary[key]) {
            summary[key] = { total: 0, unread: 0 };
          }
          summary[key].total = value?.total || 0;
          summary[key].unread = 0;
        });
        state.summary = summary;
        renderFilters();
      }
      state.unreadCount = 0;
      updateBadge();
      renderList();
    }

    function findNotification(id) {
      if (!id) return null;
      if (state.detailCache.has(id)) {
        return state.detailCache.get(id);
      }
      const allList = state.collections.all || [];
      const found = allList.find((item) => item.id === id);
      return found ? cloneNotification(found) : null;
    }

    function applyNotificationUpdate(notification, { toFront = false, adjustCount = true } = {}) {
      if (!notification || !notification.id) return;
      const previous = findNotification(notification.id);
      const merged = previous ? { ...previous, ...notification } : notification;
      const current = cloneNotification(merged);

      const previousFilters = previous ? getFilterIdsForNotification(previous) : [];
      const nextFilters = getFilterIdsForNotification(current);

      previousFilters
        .filter((filterId) => !nextFilters.includes(filterId))
        .forEach((filterId) => removeFromCollection(filterId, current.id));

      nextFilters.forEach((filterId) => {
        upsertCollection(filterId, current, { toFront });
      });

      state.detailCache.set(current.id, current);

      if (adjustCount) {
        adjustUnreadCount(previous, current);
        adjustSummaryCounts(previous, current);
        updateBadge();
        renderFilters();
      }

      renderList();
    }

    function renderModal(notification) {
      if (!notification) return;
      const entry = cloneNotification(notification);
      state.detailCache.set(entry.id, entry);

      modal.type.textContent = entry.typeLabel || TYPE_LABELS[entry.type] || '알림';

      if (entry.link) {
        modal.link.hidden = false;
        modal.link.dataset.href = entry.link;
      } else {
        modal.link.hidden = true;
        delete modal.link.dataset.href;
      }

      modal.title.textContent = entry.message || '알림 상세';

      if (entry.payload && typeof entry.payload === 'object') {
        const preview = entry.payload.preview || entry.payload.body || entry.payload.message;
        if (preview) {
          modal.message.hidden = false;
          modal.message.textContent = preview;
        } else {
          modal.message.hidden = true;
          modal.message.textContent = '';
        }
      } else {
        modal.message.hidden = true;
        modal.message.textContent = '';
      }

      const metaParts = [];
      if (entry.actor && (entry.actor.username || entry.actor.name)) {
        metaParts.push(entry.actor.username || entry.actor.name);
      }
      const created = formatAbsoluteTime(entry.createdAt);
      if (created) metaParts.push(created);
      if (!entry.read) {
        metaParts.push('읽지 않음');
      }
      modal.meta.textContent = metaParts.join(' • ');

      if (entry.payload && typeof entry.payload === 'object') {
        const payloadEntries = Object.entries(entry.payload).filter(([key, value]) => {
          if (key === 'quickReply') return false;
          if (value === null || value === undefined) return false;
          if (typeof value === 'string' && value.trim() === '') return false;
          return true;
        });
        if (payloadEntries.length) {
          modal.payloadSection.hidden = false;
          modal.payloadList.innerHTML = '';
          payloadEntries.forEach(([key, value]) => {
            const dt = document.createElement('dt');
            dt.textContent = key;
            const dd = document.createElement('dd');
            dd.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
            modal.payloadList.appendChild(dt);
            modal.payloadList.appendChild(dd);
          });
        } else {
          modal.payloadSection.hidden = true;
          modal.payloadList.innerHTML = '';
        }
      } else {
        modal.payloadSection.hidden = true;
        modal.payloadList.innerHTML = '';
      }

      if (
        entry.payload &&
        entry.payload.quickReply &&
        entry.payload.quickReply.type === 'dm' &&
        entry.payload.quickReply.roomId
      ) {
        modal.quickReply.hidden = false;
        modal.quickReplyInput.disabled = false;
        modal.quickReplySubmit.disabled = false;
      } else {
        modal.quickReply.hidden = true;
      }

      modal.feedback.hidden = true;
      setQuickReplyError('');
      setModalError('');
      setModalLoading(false);
    }

    async function resolveToken() {
      if (typeof window.ensureAuthToken === 'function') {
        state.token = await window.ensureAuthToken();
      } else {
        state.token = localStorage.getItem('token');
      }
      if (!state.token) {
        handleUnauthorized();
      }
      return state.token;
    }

    async function fetchNotifications({ filterId = state.filter } = {}) {
      if (!state.token) return;
      if (state.loading[filterId]) return;
      state.loading[filterId] = true;
      state.errors[filterId] = '';
      renderList();
      try {
        const filter = getFilterDefinition(filterId);
        const params = new URLSearchParams({ limit: String(MAX_ITEMS) });
        if (filter.id !== 'all' && filter.types.length) {
          params.set('types', filter.types.join(','));
        }
        const res = await fetch(`/api/notifications?${params.toString()}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${state.token}` },
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!res.ok) {
          throw new Error('요청이 실패했습니다');
        }
        const data = await res.json();
        const notifications = Array.isArray(data.notifications) ? data.notifications : [];
        setCollection(filter.id, notifications);
        if (filter.id === 'all') {
          FILTERS.filter((entry) => entry.id !== 'all' && entry.types.length).forEach((entry) => {
            const filtered = notifications.filter((item) => entry.types.includes(item.type));
            setCollection(entry.id, filtered);
          });
        }
        if (typeof data.unreadCount === 'number') {
          state.unreadCount = data.unreadCount;
        } else if (filter.id === 'all') {
          state.unreadCount = notifications.filter((item) => !item.read).length;
        }
        if (data.summary) {
          setSummaryFromServer(data.summary);
        }
        state.loadedFilters.add(filter.id);
        state.hasLoaded = true;
        renderList();
        updateBadge();
      } catch (error) {
        console.warn('[notifications] load failed', error);
        state.errors[filterId] = '알림을 불러오지 못했습니다.';
        renderList();
      } finally {
        state.loading[filterId] = false;
      }
    }

    async function markNotificationAsRead(id) {
      if (!id) return null;
      if (!state.token) return null;
      try {
        const res = await fetch(`/api/notifications/${id}/read`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`,
          },
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          handleUnauthorized();
          return null;
        }
        if (res.status === 404) {
          state.detailCache.delete(id);
          FILTERS.forEach((filter) => removeFromCollection(filter.id, id));
          renderList();
          renderFilters();
          return null;
        }
        if (!res.ok) {
          throw new Error('처리에 실패했습니다');
        }
        const data = await res.json();
        if (typeof data.unreadCount === 'number') {
          state.unreadCount = data.unreadCount;
        }
        if (data.summary) {
          setSummaryFromServer(data.summary);
        }
        updateBadge();
        if (data.notification) {
          applyNotificationUpdate(data.notification, { toFront: false, adjustCount: false });
          return data.notification;
        }
        return null;
      } catch (error) {
        console.warn('[notifications] mark read failed', error);
        return null;
      }
    }

    async function markAllAsRead() {
      if (!state.unreadCount) return;
      if (!state.token) return;
      markAllBtn.disabled = true;
      try {
        const res = await fetch('/api/notifications/read-all', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`,
          },
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || '전체 읽음 처리에 실패했습니다');
        }
        markAllLocalAsRead({ adjustSummary: false });
        if (typeof data.unreadCount === 'number') {
          state.unreadCount = data.unreadCount;
        } else {
          state.unreadCount = 0;
        }
        if (data.summary) {
          setSummaryFromServer(data.summary);
        } else {
          renderFilters();
        }
        updateBadge();
      } catch (error) {
        console.warn('[notifications] mark all read failed', error);
      } finally {
        markAllBtn.disabled = state.unreadCount === 0;
      }
    }

    async function fetchNotificationDetail(id) {
      if (!id || !state.token) return null;
      try {
        const res = await fetch(`/api/notifications/${id}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${state.token}`,
          },
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          handleUnauthorized();
          return null;
        }
        if (res.status === 404) {
          return null;
        }
        if (!res.ok) {
          throw new Error('알림을 불러오지 못했습니다.');
        }
        const data = await res.json();
        if (data.notification) {
          applyNotificationUpdate(data.notification, { toFront: false, adjustCount: false });
          return data.notification;
        }
        return null;
      } catch (error) {
        console.warn('[notifications] detail fetch failed', error);
        return null;
      }
    }

    async function sendQuickReply(id, message) {
      if (!id || !state.token) return null;
      try {
        const res = await fetch(`/api/notifications/${id}/reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`,
          },
          credentials: 'same-origin',
          body: JSON.stringify({ message }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return null;
        }
        if (res.status === 404) {
          setQuickReplyError(data?.error || '알림을 찾을 수 없습니다.');
          return null;
        }
        if (!res.ok) {
          setQuickReplyError(data?.error || '빠른 답장 전송에 실패했습니다.');
          return null;
        }
        if (typeof data.unreadCount === 'number') {
          state.unreadCount = data.unreadCount;
        }
        if (data.summary) {
          setSummaryFromServer(data.summary);
        }
        updateBadge();
        if (data.notification) {
          applyNotificationUpdate(data.notification, { toFront: false, adjustCount: false });
          renderModal(data.notification);
        }
        return data;
      } catch (error) {
        console.warn('[notifications] quick reply failed', error);
        setQuickReplyError('빠른 답장 전송에 실패했습니다.');
        return null;
      }
    }

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDropdown();
    });

    document.addEventListener('click', (event) => {
      if (!container.contains(event.target) && !modal.root.contains(event.target)) {
        closeDropdown();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!modal.root.classList.contains('hidden')) {
          closeModal();
        } else {
          closeDropdown();
        }
      }
    });

    filtersEl.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      event.preventDefault();
      const filterId = button.dataset.filter;
      if (!filterId || state.filter === filterId) return;
      state.filter = filterId;
      renderFilters();
      renderList();
      if (!state.loadedFilters.has(filterId)) {
        await fetchNotifications({ filterId });
      }
    });

    listEl.addEventListener('click', async (event) => {
      const item = event.target.closest('.notification-item');
      if (!item) return;
      const { id } = item.dataset;
      if (!id) return;
      let notification = findNotification(id);
      if (notification && !notification.read) {
        const updated = await markNotificationAsRead(id);
        if (updated) {
          notification = updated;
        }
      }
      closeDropdown();
      openModal(id);
      setModalLoading(true);
      if (notification) {
        renderModal(notification);
        setModalLoading(false);
      }
      const detail = await fetchNotificationDetail(id);
      if (detail) {
        renderModal(detail);
      } else if (!notification) {
        setModalError('알림을 불러오지 못했습니다.');
      }
      setModalLoading(false);
    });

    listEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('.notification-item');
      if (!item) return;
      event.preventDefault();
      item.click();
    });

    markAllBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      await markAllAsRead();
    });

    modal.backdrop.addEventListener('click', () => {
      closeModal();
    });

    modal.root.addEventListener('click', (event) => {
      if (event.target === modal.root) {
        closeModal();
      }
    });

    modal.close.addEventListener('click', (event) => {
      event.preventDefault();
      closeModal();
    });

    modal.link.addEventListener('click', (event) => {
      const href = modal.link.dataset.href;
      if (href) {
        window.location.href = href;
      }
    });

    modal.quickReply.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.selectedId) return;
      const value = modal.quickReplyInput.value.trim();
      if (!value) {
        setQuickReplyError('답장 내용을 입력해 주세요.');
        modal.quickReplyInput.focus();
        return;
      }
      setQuickReplyError('');
      const originalLabel = modal.quickReplySubmit.textContent;
      modal.quickReplySubmit.disabled = true;
      modal.quickReplySubmit.textContent = '전송 중...';
      const result = await sendQuickReply(state.selectedId, value);
      modal.quickReplySubmit.disabled = false;
      modal.quickReplySubmit.textContent = originalLabel;
      if (result) {
        modal.quickReplyInput.value = '';
        showQuickReplyFeedback('메시지를 전송했습니다.');
      }
    });

    await resolveToken();
    renderFilters();
    renderList();
    updateBadge();

    if (state.token) {
      showCenter();
      ensureSocket();
      fetchNotifications({ filterId: 'all' });
    } else {
      hideCenter();
    }

    setInterval(async () => {
      const previousToken = state.token;
      await resolveToken();
      if (state.token && !previousToken) {
        showCenter();
        ensureSocket();
        fetchNotifications({ filterId: 'all' });
      }
    }, 120000);
  });
})();
