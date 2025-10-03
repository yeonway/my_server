// public/js/chat.js
window.performUserSearch = function(term) { console.warn('[chat] performUserSearch called before init', term); };

document.addEventListener('DOMContentLoaded', () => {
  const els = {
    chatBox: document.getElementById('chatBox'),
    roomList: document.getElementById('roomList'),
    roomTitle: document.getElementById('roomTitle'),
    roomMeta: document.getElementById('roomMeta'),
    msgInput: document.getElementById('msgInput'),
    sendBtn: document.getElementById('sendBtn'),
    createRoomBtn: document.getElementById('createRoomBtn'),
    refreshRooms: document.getElementById('refreshRooms'),
    uploadButton: document.getElementById('uploadButton'),
    imageInput: document.getElementById('imageInput'),
    imageModal: document.getElementById('imageModal'),
    modalImage: document.getElementById('modalImage'),
    dmSearchWrapper: document.getElementById('dmSearchWrapper'),
    dmSearchInput: document.getElementById('dmSearchInput'),
    dmSearchResults: document.getElementById('dmSearchResults'),
    reportModal: document.getElementById('reportModal'),
    reportReasonInput: document.getElementById('reportReasonInput'),
    submitReportBtn: document.getElementById('submitReportBtn'),
    cancelReportBtn: document.getElementById('cancelReportBtn'),
    reportBlockToggleBtn: document.getElementById('reportBlockToggleBtn'),
  };

function getAuthorId(message) {
  if (!message) return null;
  const { author } = message;
  if (!author) return null;
  if (typeof author === 'string') return author;
  if (typewㅈㅈㅈㅈㅈㅈㅈㅈㅈof author === 'object') {
    if (typeof author._id === 'string') return author._id;
    if (author._id) return author._id.toString();
    if (typeof author.id === 'string') return author.id;
    if (author.id) return author.id.toString();
  }
  return null;
}

function isMessageFromBlocked(message) {
  const authorId = getAuthorId(message);
  if (!authorId) return false;
  return state.blockedUserIds?.has(authorId) || false;
}

  const state = {
    token: null,
    socket: null,
    rooms: [],
    currentRoomId: null,
    currentRoom: null,
    myUsername: '',
    myUserId: null,
    myRole: 'user',
    searchTimer: null,
    reportTargetId: null,
    reportTargetAuthorId: null,
    reportTargetUsername: '',
    blockedUserIds: new Set(),
  };

  let detachBlockSubscription = null;

  function syncBlockedUsersFromClient() {
    if (!window.BlockingClient) {
      state.blockedUserIds = new Set();
      updateReportBlockButton();
      return;
    }

    const latest = window.BlockingClient.getBlockedSet();
    state.blockedUserIds = latest instanceof Set ? latest : new Set();
    updateReportBlockButton();
  }

  function subscribeToBlockUpdates() {
    if (!window.BlockingClient) {
      if (typeof detachBlockSubscription === 'function') {
        detachBlockSubscription();
        detachBlockSubscription = null;
      }
      return;
    }

    if (typeof detachBlockSubscription === 'function') {
      detachBlockSubscription();
    }

    detachBlockSubscription = window.BlockingClient.subscribe(() => {
      syncBlockedUsersFromClient();
    });
  }

  function updateReportBlockButton() {
    const button = els.reportBlockToggleBtn;
    if (!button) return;

    const authorId = state.reportTargetAuthorId;
    if (!authorId) {
      button.hidden = true;
      button.dataset.blocked = '0';
      return;
    }

    const isBlocked = state.blockedUserIds.has(authorId);
    button.textContent = isBlocked ? '차단 해제' : '차단';
    button.dataset.blocked = isBlocked ? '1' : '0';
    button.hidden = false;
  }

  init().catch((error) => {
    console.error('[chat] init failed', error);
    showNotification(error.message || '채팅 초기화에 실패했습니다.', 'error');
  });

  async function init() {
    await resolveToken();
    if (!state.token) {
      showNotification('로그인이 필요합니다.', 'error');
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1500);
      return;
    }

    subscribeToBlockUpdates();
    await loadBlockedUsers();
    bindEvents();
    connectSocket();
    await loadRooms();
  }

  async function resolveToken() {
    try {
      if (window.requireAuthToken) {
        state.token = await window.requireAuthToken();
      } else if (window.ensureAuthToken) {
        state.token = await window.ensureAuthToken();
      } else {
        state.token = localStorage.getItem('token');
      }
    } catch (error) {
      console.warn('[chat] token resolve failed', error);
      state.token = localStorage.getItem('token');
    }
  }

  async function loadBlockedUsers() {
    if (!state.token || !window.BlockingClient) {
      state.blockedUserIds = new Set();
      updateReportBlockButton();
      return;
    }

    try {
      await window.BlockingClient.refresh({ token: state.token, silent: true });
    } catch (error) {
      console.warn('[chat] loadBlockedUsers failed', error);
    } finally {
      syncBlockedUsersFromClient();
    }
  }

  function bindEvents() {
    els.sendBtn.addEventListener('click', handleSendMessage);
    els.msgInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
      }
    });

    els.createRoomBtn.addEventListener('click', handleCreateRoom);
    els.refreshRooms.addEventListener('click', () => {
      loadRooms(true);
    });

    els.uploadButton.addEventListener('click', () => {
      if (!state.currentRoomId) {
        showNotification('채팅방을 먼저 선택하세요.', 'warning');
        return;
      }
      els.imageInput.click();
    });

    els.imageInput.addEventListener('change', handleImageUpload);

    els.dmSearchInput.addEventListener('input', () => {
      const term = els.dmSearchInput.value.trim();
      if (state.searchTimer) {
        clearTimeout(state.searchTimer);
        state.searchTimer = null;
      }
      if (!term) {
        closeSearchResults();
        return;
      }
      state.searchTimer = setTimeout(() => performUserSearch(term), 250);
    });

    document.addEventListener('click', (event) => {
      if (!els.dmSearchWrapper.contains(event.target)) {
        closeSearchResults();
      }
    });

    els.cancelReportBtn.addEventListener('click', closeReportModal);
    els.submitReportBtn.addEventListener('click', submitReport);

    els.imageModal.addEventListener('click', (event) => {
      if (event.target === els.imageModal || event.target.classList.contains('image-modal-close')) {
        els.imageModal.style.display = 'none';
      }
    });
  }
  async function handleCreateRoom() {
    if (!state.token) {
      showNotification('로그인이 필요합니다.', 'warning');
      return;
    }

    const nameInput = prompt('새 채팅방 이름을 입력하세요.');
    if (nameInput === null) return;

    const roomName = nameInput.trim();
    if (!roomName) {
      showNotification('채팅방 이름을 입력해 주세요.', 'warning');
      return;
    }

    const inviteInput = prompt('함께할 사용자 아이디를 쉼표로 구분해 입력하세요. (선택 사항)', '');
    let usernames = [];
    if (inviteInput && typeof inviteInput === 'string') {
      usernames = inviteInput.split(',').map((value) => value.trim()).filter(Boolean);
    }

    try {
      const response = await fetch('/api/chat/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ name: roomName, usernames }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || '채팅방을 생성하지 못했어요.');
      }

      const room = normalizeRoom(payload.room);
      if (room) {
        const displayName = room.displayName || room.name || '채팅방';
        upsertRoom(room);
        selectRoom(room.id);
        showNotification(`"${displayName}" 채팅방을 만들었어요.`, 'success');
      }
    } catch (error) {
      console.error('[chat] create room error', error);
      showNotification(error.message || '채팅방을 생성하지 못했어요.', 'error');
    }
  }

  function connectSocket() {
    state.socket = io({ auth: { token: state.token } });

    state.socket.on('userInfo', ({ id, username, role }) => {
      state.myUserId = id;
      state.myUsername = username;
      state.myRole = role || 'user';
    });

    state.socket.on('previousMessages', (messages) => {
      if (!Array.isArray(messages) || messages.length === 0) {
        return;
      }
      const roomId = messages[0].room;
      if (roomId && roomId === state.currentRoomId) {
        renderMessages(messages);
      }
    });

    state.socket.on('chatMessage', (message) => {
      handleIncomingMessage(message);
    });

    state.socket.on('messageUpdated', (payload) => {
      handleMessageUpdated(payload);
    });

    state.socket.on('messageDeleted', (payload) => {
      handleMessageDeleted(payload);
    });

    state.socket.on('connect_error', (error) => {
      showNotification(error?.message || '채팅 서버 연결에 실패했습니다.', 'error');
    });
  }

  async function loadRooms(force = false) {
    try {
      const response = await fetch('/api/chat/rooms', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${state.token}` },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('채팅방을 불러오지 못했습니다.');
      }

      const data = await response.json();
      const normalized = Array.isArray(data.rooms) ? data.rooms.map(normalizeRoom) : [];
      state.rooms = normalized;
      sortRooms();
      renderRoomList();

      if (state.rooms.length === 0) {
        setMessageAreaEnabled(false);
        state.currentRoomId = null;
        state.currentRoom = null;
        els.chatBox.innerHTML = '<div class="empty-state">왼쪽에서 채팅방을 선택하거나 새 개인 채팅을 만들어 보세요.</div>';
        els.roomTitle.textContent = '채팅방을 선택하세요';
        els.roomMeta.textContent = '';
        return;
      }

      setMessageAreaEnabled(true);

      if (!state.currentRoomId || force || !state.rooms.some((room) => room.id === state.currentRoomId)) {
        selectRoom(state.rooms[0].id);
      } else {
        updateRoomHeader(state.rooms.find((room) => room.id === state.currentRoomId));
        highlightActiveRoom();
      }
    } catch (error) {
      console.error('[chat] loadRooms error', error);
      showNotification(error.message || '채팅방을 불러오지 못했습니다.', 'error');
    }
  }

  function normalizeRoom(room) {
    if (!room) return null;
    const id = room.id || room._id;
    return {
      id,
      type: room.type || 'group',
      name: room.name || '',
      displayName: room.displayName || room.name || '채팅',
      otherParticipant: room.otherParticipant || null,
      lastMessageAt: room.lastMessageAt || room.updatedAt || null,
      lastPreview: room.lastPreview || '',
    };
  }

  function sortRooms() {
    state.rooms.sort((a, b) => {
      const timeA = a?.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b?.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return timeB - timeA;
    });
  }

  function renderRoomList() {
    els.roomList.innerHTML = '';

    if (state.rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'room-empty-state';
      empty.textContent = '개인 채팅을 검색하거나 방 초대장을 기다려 보세요.';
      els.roomList.appendChild(empty);
      return;
    }

    state.rooms.forEach((room) => {
      const item = document.createElement('li');
      item.className = 'room-item';
      if (room.id === state.currentRoomId) {
        item.classList.add('active');
      }

      const nameRow = document.createElement('div');
      nameRow.className = 'room-name';
      nameRow.textContent = room.displayName || room.name || '채팅';

      const detailRow = document.createElement('div');
      detailRow.className = 'room-detail';
      detailRow.innerHTML = `
        <span>${room.type === 'dm' ? '개인 채팅' : '그룹 채팅'}</span>
        <span>${formatTimestamp(room.lastMessageAt)}</span>
      `;

      item.appendChild(nameRow);
      item.appendChild(detailRow);
      item.dataset.roomId = room.id;

      item.addEventListener('click', () => {
        if (room.id !== state.currentRoomId) {
          selectRoom(room.id);
        }
      });

      els.roomList.appendChild(item);
    });
  }

  async function selectRoom(roomId) {
    const room = state.rooms.find((target) => target.id === roomId);
    state.currentRoomId = roomId;
    state.currentRoom = room || null;
    updateRoomHeader(room);
    highlightActiveRoom();

    if (!roomId) {
      return;
    }

    await loadRoomMessages(roomId);
    if (state.socket) {
      state.socket.emit('joinRoom', roomId);
    }
  }

  function updateRoomHeader(room) {
    if (!room) {
      els.roomTitle.textContent = '채팅방을 선택하세요';
      els.roomMeta.textContent = '';
      return;
    }

    els.roomTitle.textContent = room.displayName || room.name || '채팅';
    if (room.type === 'dm' && room.otherParticipant) {
      const label = room.otherParticipant.username || room.otherParticipant.name || '사용자';
      els.roomMeta.textContent = `상대방: ${label}`;
    } else {
      els.roomMeta.textContent = room.name ? `방 이름: ${room.name}` : '';
    }
  }

  function highlightActiveRoom() {
    const items = els.roomList.querySelectorAll('.room-item');
    items.forEach((item) => {
      if (item.dataset.roomId === state.currentRoomId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  async function loadRoomMessages(roomId) {
    if (!roomId) return;
    els.chatBox.innerHTML = '<div class="empty-state">메시지를 불러오는 중...</div>';

    try {
      const response = await fetch(`/api/chat/messages/${roomId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${state.token}` },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('채팅방에 접근할 수 없습니다.');
        }
        throw new Error('메시지를 불러오지 못했습니다.');
      }

      const data = await response.json();
      const messages = Array.isArray(data.messages) ? data.messages : [];
      renderMessages(messages);
    } catch (error) {
      console.error('[chat] loadRoomMessages error', error);
      els.chatBox.innerHTML = `<div class="empty-state">${error.message}</div>`;
    }
  }

  function renderMessages(messages) {
    els.chatBox.innerHTML = '';
    const list = Array.isArray(messages) ? messages : [];
    const filtered = list.filter((message) => !isMessageFromBlocked(message));
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '아직 메시지가 없습니다. 첫 메시지를 보내보세요.';
      els.chatBox.appendChild(empty);
      return;
    }

    filtered.forEach((message) => appendMessage(message));
  }

  function appendMessage(message) {
    if (!message) return;

    const messageId = message._id || message.id || message.messageId || null;
    const authorId = getAuthorId(message);
    if (authorId && state.blockedUserIds.has(authorId)) {
      return;
    }

    const rawContent = typeof message.message === 'string' ? message.message : '';
    const inferredType = (message.messageType || (rawContent.startsWith('[IMAGE]') ? 'image' : 'text')).toString().toLowerCase();
    const isImageMessage = inferredType === 'image';

    const container = document.createElement('div');
    container.className = 'chat-message-container';
    const isMine = message.user === state.myUsername || (authorId && authorId === state.myUserId);
    const canDelete = messageId && isMine;
    const canEdit = canDelete && !isImageMessage;
    if (isMine) {
      container.classList.add('my-message');
    }
    if (messageId) container.dataset.messageId = messageId;
    if (authorId) container.dataset.authorId = authorId;
    container.dataset.messageType = inferredType;
    container.dataset.messageText = rawContent;

    const bubble = document.createElement('div');
    bubble.className = 'chat-message-bubble';

    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';
    meta.textContent = `${message.user || '알 수 없음'} · ${formatMessageTime(message.time)}`;
    bubble.appendChild(meta);

    if (isImageMessage) {
      const imagePath = rawContent.replace('[IMAGE]', '');
      const img = document.createElement('img');
      img.src = imagePath;
      img.alt = '채팅 이미지';
      img.className = 'chat-image';
      img.addEventListener('click', () => showImageModal(imagePath));
      bubble.appendChild(img);
    } else {
      const text = document.createElement('div');
      text.className = 'chat-message-text';
      text.textContent = rawContent || '';
      bubble.appendChild(text);
    }

    container.appendChild(bubble);

    setMessageEditedState(container, message.editedAt);

    const actions = document.createElement('div');
    actions.className = 'chat-actions';
    let hasActions = false;

    if (canEdit) {
      const editBtn = document.createElement('button');
      editBtn.className = 'chat-action-btn btn-edit-msg';
      editBtn.type = 'button';
      editBtn.textContent = '수정';
      editBtn.setAttribute('aria-label', '메시지 수정');
      editBtn.title = '이 메시지를 수정합니다.';
      editBtn.addEventListener('click', () => promptEditMessage(messageId));
      actions.appendChild(editBtn);
      hasActions = true;
    }

    if (canDelete) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'chat-action-btn btn-delete-msg';
      deleteBtn.type = 'button';
      deleteBtn.textContent = '삭제';
      deleteBtn.setAttribute('aria-label', '메시지 삭제');
      deleteBtn.title = '이 메시지를 삭제합니다.';
      deleteBtn.addEventListener('click', () => confirmDeleteMessage(messageId));
      actions.appendChild(deleteBtn);
      hasActions = true;
    }

    if (authorId && !isMine) {
      const isBlocked = state.blockedUserIds.has(authorId);
      const blockBtn = document.createElement('button');
      blockBtn.className = 'chat-action-btn btn-block-msg';
      blockBtn.type = 'button';
      blockBtn.textContent = isBlocked ? '차단 해제' : '차단';
      const blockLabel = isBlocked ? '사용자 차단 해제' : '사용자 차단';
      blockBtn.setAttribute('aria-label', blockLabel);
      blockBtn.title = blockLabel;
      blockBtn.addEventListener('click', () => toggleBlockUser(authorId, message.user, !isBlocked));
      actions.appendChild(blockBtn);
      hasActions = true;

      if (messageId) {
        const reportBtn = document.createElement('button');
        reportBtn.className = 'chat-action-btn btn-report-msg';
        reportBtn.type = 'button';
        reportBtn.textContent = '신고';
        reportBtn.setAttribute('aria-label', '메시지 신고');
        reportBtn.title = '이 메시지를 신고합니다.';
        reportBtn.addEventListener('click', () => showReportModal(messageId, authorId, message.user));
        actions.appendChild(reportBtn);
        hasActions = true;
      }
    } else if (messageId && message.user !== state.myUsername) {
      const reportBtn = document.createElement('button');
      reportBtn.className = 'chat-action-btn btn-report-msg';
      reportBtn.type = 'button';
      reportBtn.textContent = '신고';
      reportBtn.setAttribute('aria-label', '메시지 신고');
      reportBtn.title = '이 메시지를 신고합니다.';
      reportBtn.addEventListener('click', () => showReportModal(messageId, authorId, message.user));
      actions.appendChild(reportBtn);
      hasActions = true;
    }

    if (hasActions) {
      container.appendChild(actions);
    }

    els.chatBox.appendChild(container);
    els.chatBox.scrollTop = els.chatBox.scrollHeight;
  }

  function setMessageEditedState(container, editedAt) {
    if (!container) return;

    const meta = container.querySelector('.chat-message-meta');
    let badge = meta ? meta.querySelector('.chat-message-edited') : null;

    if (editedAt) {
      container.dataset.editedAt = editedAt;
      container.classList.add('message-edited');
      if (meta && !badge) {
        badge = document.createElement('span');
        badge.className = 'chat-message-edited';
        badge.textContent = '수정됨';
        meta.appendChild(badge);
      }
      if (badge) {
        const tooltip = formatEditedTooltip(editedAt);
        if (tooltip) {
          badge.title = `${tooltip}에 수정됨`;
        } else {
          badge.removeAttribute('title');
        }
      }
    } else {
      container.classList.remove('message-edited');
      delete container.dataset.editedAt;
      if (badge) {
        badge.remove();
      }
    }
  }

  async function promptEditMessage(messageId) {
    if (!messageId) return;

    const element = els.chatBox.querySelector(`[data-message-id="${messageId}"]`);
    if (!element) return;

    const type = element.dataset.messageType;
    if (type === 'image') {
      showNotification('이미지는 수정할 수 없습니다.', 'warning');
      return;
    }

    const current = element.dataset.messageText || '';
    const next = window.prompt('수정할 메시지를 입력해 주세요.', current);
    if (next === null) return;

    const trimmed = next.trim();
    if (!trimmed) {
      window.alert('메시지는 비워둘 수 없습니다.');
      return;
    }

    if (trimmed === current.trim()) {
      showNotification('변경된 내용이 없습니다.', 'info');
      return;
    }

    await updateMessage(messageId, trimmed);
  }

  async function updateMessage(messageId, newMessage) {
    try {
      const response = await fetch(`/api/chat/messages/${messageId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ message: newMessage }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || '메시지를 수정하지 못했어요.');
      }

      handleMessageUpdated({ ...payload, room: payload.room || state.currentRoomId });
      showNotification('메시지를 수정했습니다.', 'success');
    } catch (error) {
      console.error('[chat] update message error', error);
      showNotification(error.message || '메시지를 수정하지 못했어요.', 'error');
    }
  }

  async function confirmDeleteMessage(messageId) {
    if (!messageId) return;
    const ok = window.confirm('이 메시지를 삭제하시겠습니까?');
    if (!ok) return;
    await deleteMessage(messageId);
  }

  async function deleteMessage(messageId) {
    try {
      const response = await fetch(`/api/chat/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.token}` },
        credentials: 'same-origin',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || '메시지를 삭제하지 못했어요.');
      }

      handleMessageDeleted({ messageId, room: state.currentRoomId });
      showNotification('메시지를 삭제했습니다.', 'success');
    } catch (error) {
      console.error('[chat] delete message error', error);
      showNotification(error.message || '메시지를 삭제하지 못했어요.', 'error');
    }
  }

  function handleMessageUpdated(payload = {}) {
    const { messageId, room, message, editedAt, editHistory } = payload || {};
    if (!messageId) return;

    if (room && state.currentRoomId && room !== state.currentRoomId) {
      updateRoomPreviewForEdit(room, message, editHistory);
      return;
    }

    const element = els.chatBox.querySelector(`[data-message-id="${messageId}"]`);
    if (!element) {
      updateRoomPreviewForEdit(room, message, editHistory);
      return;
    }

    const textEl = element.querySelector('.chat-message-text');
    if (textEl) {
      textEl.textContent = message || '';
    }

    element.dataset.messageText = message || '';
    if (Array.isArray(editHistory)) {
      element.dataset.editHistoryCount = String(editHistory.length);
    } else {
      delete element.dataset.editHistoryCount;
    }

    setMessageEditedState(element, editedAt);
    updateRoomPreviewForEdit(room || state.currentRoomId, message, editHistory);
  }

  function handleMessageDeleted(payload = {}) {
    const { messageId, room } = payload || {};
    if (!messageId) return;
    if (room && state.currentRoomId && room !== state.currentRoomId) {
      return;
    }

    const selector = `[data-message-id="${messageId}"]`;
    const element = els.chatBox.querySelector(selector);
    if (!element) return;

    element.classList.add('message-removed');
    const bubble = element.querySelector('.chat-message-bubble');
    if (bubble) {
      bubble.innerHTML = '';
      const placeholder = document.createElement('div');
      placeholder.className = 'chat-message-text deleted';
      placeholder.textContent = '삭제된 메시지입니다.';
      bubble.appendChild(placeholder);
    }

    const actions = element.querySelector('.chat-actions');
    if (actions) actions.remove();
  }

  function updateRoomPreviewForEdit(roomId, content, history) {
    if (!roomId) return;
    const index = state.rooms.findIndex((room) => room.id === roomId);
    if (index === -1) return;

    const room = state.rooms[index];
    if (!Array.isArray(history) || history.length === 0) {
      return;
    }

    const latestHistory = history[history.length - 1];
    const previousText = latestHistory && typeof latestHistory.previousMessage === 'string' ? latestHistory.previousMessage : '';
    const normalizedPrevious = previousText.startsWith('[IMAGE]') ? '이미지' : previousText;

    if (room.lastPreview && normalizedPrevious && room.lastPreview !== normalizedPrevious) {
      return;
    }

    if (typeof content === 'string' && content.length) {
      room.lastPreview = content.startsWith('[IMAGE]') ? '이미지' : content;
      renderRoomList();
    }
  }

  async function toggleBlockUser(userId, username = '', shouldBlock) {
    if (!userId || !state.token) return;

    const targetId = String(userId);
    const currentlyBlocked = state.blockedUserIds.has(targetId);
    const desiredBlock = typeof shouldBlock === 'boolean' ? shouldBlock : !currentlyBlocked;

    try {
      if (!window.BlockingClient) {
        throw new Error('차단 도구를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }

      if (desiredBlock) {
        await window.BlockingClient.block(targetId, { token: state.token });
      } else {
        await window.BlockingClient.unblock(targetId, { token: state.token });
      }

      syncBlockedUsersFromClient();
      await loadRooms(true);
      if (state.currentRoomId) {
        await loadRoomMessages(state.currentRoomId);
      }

      const label = username ? `${username}님을 ` : '';
      showNotification(`${label}${desiredBlock ? '차단했습니다.' : '차단을 해제했습니다.'}`, 'success');
    } catch (error) {
      console.error('[chat] toggle block error', error);
      showNotification(error.message || '요청을 처리하지 못했습니다.', 'error');
    }
  }

  function handleIncomingMessage(message) {
    if (!message || !message.room) return;
    if (isMessageFromBlocked(message)) {
      return;
    }

    touchRoom(message.room, message.time, message.message);

    if (message.room === state.currentRoomId) {
      appendMessage(message);
    }
  }


  async function sendMessageToRoom(message, messageType = 'text') {
    if (!state.currentRoomId) {
      showNotification('채팅방을 선택해 주세요.', 'warning');
      return false;
    }

    const content = typeof message === 'string' ? message : '';
    if (!content) {
      return false;
    }

    const now = new Date().toISOString();

    if (state.socket && state.socket.connected) {
      state.socket.emit('chatMessage', {
        room: state.currentRoomId,
        message: content,
        messageType,
      });
      touchRoom(state.currentRoomId, now, content);
      return true;
    }

    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      credentials: 'same-origin',
      body: JSON.stringify({ room: state.currentRoomId, message: content, messageType }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messageText = payload?.error || '메시지를 보내지 못했어요.';
      throw new Error(messageText);
    }

    const saved = payload?.data || {
      room: state.currentRoomId,
      message: content,
      messageType,
      user: state.myUsername,
      time: now,
    };

    saved.user = saved.user || state.myUsername;
    saved.time = saved.time || now;

    appendMessage(saved);
    touchRoom(saved.room, saved.time, saved.message);
    return true;
  }

  async function handleSendMessage() {
    const raw = els.msgInput.value || '';
    const trimmed = raw.trim();
    if (!trimmed) {
      els.msgInput.focus();
      return;
    }

    els.msgInput.value = '';

    try {
      await sendMessageToRoom(trimmed, 'text');
    } catch (error) {
      console.error('[chat] send message error', error);
      showNotification(error.message || '메시지를 보내지 못했어요.', 'error');
      els.msgInput.value = raw;
    } finally {
      els.msgInput.focus();
    }
  }

  async function handleImageUpload(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file) return;

    if (!state.currentRoomId) {
      showNotification('채팅방을 선택해 주세요.', 'warning');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showNotification('이미지는 10MB 이하만 전송할 수 있습니다.', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('/api/chat/upload-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.token}`
        },
        credentials: 'same-origin',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.imagePath) {
        const messageText = payload?.error || '이미지를 업로드하지 못했어요.';
        throw new Error(messageText);
      }

      await sendMessageToRoom(`[IMAGE]${payload.imagePath}`, 'image');
    } catch (error) {
      console.error('[chat] image upload error', error);
      showNotification(error.message || '이미지를 업로드하지 못했어요.', 'error');
    }
  }

function touchRoom(roomId, time, content) {
    const index = state.rooms.findIndex((room) => room.id === roomId);
    if (index === -1) {
      loadRooms(true);
      return;
    }

    const room = state.rooms[index];
    room.lastMessageAt = time || new Date().toISOString();
    if (typeof content === 'string') {
      room.lastPreview = content.startsWith('[IMAGE]') ? '이미지' : content;
    }

    state.rooms.splice(index, 1);
    state.rooms.unshift(room);
    renderRoomList();
  }
  async function performUserSearch(term) {
    const raw = term === undefined || term === null ? '' : String(term);
    const query = raw.trim();
    if (!query) {
      closeSearchResults();
      return;
    }

    if (!state.token) {
      showNotification('로그인이 필요합니다.', 'warning');
      return;
    }

    if (!els.dmSearchResults) {
      console.warn('[chat] dmSearchResults element missing');
      return;
    }

    console.debug('[chat] user search start', query);
    els.dmSearchResults.innerHTML = '<div class="empty-result">검색 중...</div>';
    els.dmSearchResults.classList.add('show');

    try {
      const response = await fetch(`/api/chat/users/search?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${state.token}`
        },
        credentials: 'same-origin'
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error || '사용자를 찾지 못했어요.';
        throw new Error(message);
      }

      const users = Array.isArray(payload.users) ? payload.users : [];
      renderSearchResults(users);
    } catch (error) {
      console.error('[chat] user search error', error);
      els.dmSearchResults.innerHTML = '<div class="empty-result">검색 결과를 불러오지 못했어요.</div>';
      els.dmSearchResults.classList.add('show');
      showNotification(error.message || '사용자를 찾지 못했어요.', 'warning');
    }
  }

  state.performUserSearch = performUserSearch;
  window.performUserSearch = performUserSearch;

  function renderSearchResults(users) {
    els.dmSearchResults.innerHTML = '';
    if (!users.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-result';
      empty.textContent = '검색 결과가 없습니다.';
      els.dmSearchResults.appendChild(empty);
      els.dmSearchResults.classList.add('show');
      return;
    }

    users.forEach((user) => {
      const button = document.createElement('button');
      button.type = 'button';
      const label = user.username || user.name || '사용자';
      const name = user.name && user.name !== user.username ? ` (${user.name})` : '';
      button.textContent = `${label}${name}`;
      button.addEventListener('click', () => openPersonalChat(user));
      els.dmSearchResults.appendChild(button);
    });

    els.dmSearchResults.classList.add('show');
  }

  function closeSearchResults() {
    els.dmSearchResults.classList.remove('show');
    els.dmSearchResults.innerHTML = '';
  }

  async function openPersonalChat(user) {
    try {
      const response = await fetch('/api/chat/rooms/personal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ userId: user._id || user.id }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || '개인 채팅방을 생성하지 못했습니다.');
      }

      const room = normalizeRoom(payload.room);
      if (room) {
        upsertRoom(room);
        selectRoom(room.id);
        showNotification(`${room.displayName}님과의 개인 채팅이 준비되었습니다.`, 'success');
      }
    } catch (error) {
      console.error('[chat] openPersonalChat error', error);
      showNotification(error.message || '개인 채팅방을 생성하지 못했습니다.', 'error');
    } finally {
      closeSearchResults();
      els.dmSearchInput.value = '';
    }
  }

  function upsertRoom(room) {
    if (!room) return;
    const index = state.rooms.findIndex((item) => item.id === room.id);
    if (index >= 0) {
      state.rooms[index] = room;
    } else {
      state.rooms.unshift(room);
    }
    sortRooms();
    renderRoomList();
  }

  function setMessageAreaEnabled(enabled) {
    els.msgInput.disabled = !enabled;
    els.sendBtn.disabled = !enabled;
    els.uploadButton.disabled = !enabled;
  }

  function showImageModal(imagePath) {
    els.modalImage.src = imagePath;
    els.imageModal.style.display = 'flex';
  }

  function showReportModal(messageId, authorId = null, username = '') {
    state.reportTargetId = messageId;
    state.reportTargetAuthorId = authorId ? String(authorId) : null;
    state.reportTargetUsername = username || '';
    els.reportReasonInput.value = '';
    updateReportBlockButton();
    els.reportModal.classList.add('show');
  }

  function closeReportModal() {
    state.reportTargetId = null;
    state.reportTargetAuthorId = null;
    state.reportTargetUsername = '';
    els.reportModal.classList.remove('show');
    updateReportBlockButton();
  }

  async function submitReport() {
    const reason = els.reportReasonInput.value.trim();
    if (!reason) {
      showNotification('신고 사유를 입력해주세요.', 'warning');
      return;
    }

    if (!state.reportTargetId) {
      closeReportModal();
      return;
    }

    try {
      const response = await fetch(`/api/chat/messages/${state.reportTargetId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ reason }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || '신고 처리 중 오류가 발생했습니다.');
      }

      showNotification('신고가 접수되었습니다.', 'success');
      closeReportModal();
    } catch (error) {
      console.error('[chat] report error', error);
      showNotification(error.message || '신고 처리 중 오류가 발생했습니다.', 'error');
    }
  }

  if (els.reportBlockToggleBtn) {
    els.reportBlockToggleBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      const authorId = state.reportTargetAuthorId;
      if (!authorId) {
        return;
      }
      const isBlocked = state.blockedUserIds.has(authorId);
      await toggleBlockUser(authorId, state.reportTargetUsername, !isBlocked);
      updateReportBlockButton();
    });
  }

  function showNotification(message, type = 'error', duration = 4000) {
    const existing = document.querySelectorAll('.notification-popup');
    existing.forEach((node) => node.remove());

    const popup = document.createElement('div');
    popup.className = `notification-popup ${type}`;
    popup.textContent = message;
    document.body.appendChild(popup);

    setTimeout(() => {
      popup.classList.add('fade-out');
      popup.addEventListener('transitionend', () => popup.remove(), { once: true });
    }, duration);
  }

  function formatTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const yyyy = date.getFullYear();
    const mm = `${date.getMonth() + 1}`.padStart(2, '0');
    const dd = `${date.getDate()}`.padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
  }

  function formatEditedTooltip(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  function formatMessageTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const hh = `${date.getHours()}`.padStart(2, '0');
    const mm = `${date.getMinutes()}`.padStart(2, '0');
    return `${hh}:${mm}`;
  }
});
