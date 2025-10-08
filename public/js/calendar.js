// public/js/calendar.js
// 공유 달력 UI를 제어하는 스크립트 (바닐라 JS + Fetch API)

(function () {
  const API_BASE = '/api/calendar';
  const CATEGORY_EMOJI = {
    시험: '📚',
    숙제: '📝',
    생일: '🎂',
    약속: '📅',
    기타: '🫧',
  };
  const PRIORITY_EMOJI = {
    high: '🔥',
    medium: '⭐',
    low: '🫧',
  };

  let state = {
    year: null,
    month: null,
    events: [],
    selectedDate: null,
    category: 'all',
    search: '',
    token: null,
    isAdmin: false,
  };

  const gridEl = document.querySelector('[data-calendar-grid]');
  const titleEl = document.querySelector('[data-calendar-title]');
  const sidebarLabel = document.querySelector('[data-selected-date-label]');
  const sidebarList = document.querySelector('[data-sidebar-list]');
  const categorySelect = document.querySelector('[data-category-filter]');
  const searchInput = document.querySelector('[data-search-input]');
  const createButton = document.querySelector('[data-create-button]');
  const prevButton = document.querySelector('[data-prev-month]');
  const nextButton = document.querySelector('[data-next-month]');
  const todayButton = document.querySelector('[data-today]');
  const spinner = document.querySelector('[data-spinner]');
  const toast = document.querySelector('[data-toast]');
  const modalBackdrop = document.querySelector('[data-modal-backdrop]');
  const modalContent = document.querySelector('[data-modal-content]');
  const modalClose = document.querySelector('[data-modal-close]');

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    state.token = await resolveToken();
    await determineAdminRole();
    toggleCreateButton();

    const now = new Date();
    const urlParams = new URLSearchParams(window.location.search);
    const year = parseInt(urlParams.get('year') || now.getFullYear(), 10);
    const month = parseInt(urlParams.get('month') || now.getMonth() + 1, 10);

    state.year = Number.isNaN(year) ? now.getFullYear() : year;
    state.month = Number.isNaN(month) ? now.getMonth() + 1 : month;

    bindEvents();
    await loadEvents();
  }

  function bindEvents() {
    prevButton.addEventListener('click', () => changeMonth(-1));
    nextButton.addEventListener('click', () => changeMonth(1));
    todayButton.addEventListener('click', handleToday);
    categorySelect.addEventListener('change', handleFilterChange);
    searchInput.addEventListener('input', debounce(handleSearch, 300));
    createButton.addEventListener('click', openCreateModal);
    modalClose.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (event) => {
      if (event.target === modalBackdrop) {
        closeModal();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeModal();
      }
    });
  }

  async function resolveToken() {
    const stored = localStorage.getItem('token');
    if (stored) return stored;
    if (typeof window.ensureAuthToken === 'function') {
      try {
        return await window.ensureAuthToken();
      } catch {
        return null;
      }
    }
    return null;
  }

  async function determineAdminRole() {
    state.isAdmin = false;

    if (!state.token || typeof window.ensureAuthUser !== 'function') {
      return;
    }
    try {
      const user = await window.ensureAuthUser();
      if (!user) return;

      state.user = user;
      const adminRoles = ['admin', 'superadmin', 'manager'];
      state.isAdmin = adminRoles.includes(user.role);
    } catch (error) {
      console.warn('[calendar] 사용자 정보 확인 실패', error);
    }
  }

  function toggleCreateButton() {
    if (!createButton) return;
    if (state.token) {
      createButton.hidden = false;
    } else {
      createButton.hidden = true;
    }
  }

  async function loadEvents() {
    showSpinner();
    try {
      const params = new URLSearchParams();
      params.set('year', state.year);
      params.set('month', state.month);
      if (state.category && state.category !== 'all') {
        params.set('category', state.category);
      }
      if (state.search) {
        params.set('q', state.search);
      }

      const url = `${API_BASE}?${params.toString()}`;
      const response = await fetch(url, buildFetchOptions());
      if (!response.ok) {
        throw new Error('일정을 불러오지 못했어요.');
      }

      const data = await response.json();
      state.events = Array.isArray(data.events) ? data.events : [];
      updateURL();
      renderCalendar();
      renderSidebar();
    } catch (error) {
      console.error('[calendar] loadEvents', error);
      showToast(error.message || '일정 데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      hideSpinner();
    }
  }

  function buildFetchOptions(method = 'GET', body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    const options = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    return options;
  }

  function updateURL() {
    const params = new URLSearchParams(window.location.search);
    params.set('year', state.year);
    params.set('month', state.month);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({}, '', newUrl);
  }

  function changeMonth(delta) {
    state.month += delta;
    if (state.month < 1) {
      state.month = 12;
      state.year -= 1;
    } else if (state.month > 12) {
      state.month = 1;
      state.year += 1;
    }
    loadEvents();
  }

  function handleToday() {
    const today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth() + 1;
    state.selectedDate = formatDateKey(today);
    loadEvents();
  }

  function handleFilterChange(event) {
    state.category = event.target.value;
    loadEvents();
  }

  function handleSearch(event) {
    state.search = event.target.value.trim();
    loadEvents();
  }

  function renderCalendar() {
    if (!gridEl) return;

    const firstDay = new Date(state.year, state.month - 1, 1);
    const lastDay = new Date(state.year, state.month, 0);
    const startDayOfWeek = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const prevMonthLastDay = new Date(state.year, state.month - 1, 0).getDate();

    gridEl.innerHTML = '';
    titleEl.textContent = `${state.year}년 ${state.month}월`;

    const totalCells = Math.ceil((startDayOfWeek + totalDays) / 7) * 7;
    for (let index = 0; index < totalCells; index += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'calendar-day';

      let dateNumber;
      let monthOffset = 0;

      if (index < startDayOfWeek) {
        dateNumber = prevMonthLastDay - startDayOfWeek + index + 1;
        monthOffset = -1;
        cell.classList.add('calendar-day--other-month');
        cell.disabled = true;
      } else if (index >= startDayOfWeek + totalDays) {
        dateNumber = index - (startDayOfWeek + totalDays) + 1;
        monthOffset = 1;
        cell.classList.add('calendar-day--other-month');
        cell.disabled = true;
      } else {
        dateNumber = index - startDayOfWeek + 1;
      }

      const cellDate = new Date(state.year, state.month - 1 + monthOffset, dateNumber);
      const cellDateKey = formatDateKey(cellDate);

      const header = document.createElement('div');
      header.className = 'calendar-day__header';

      const numberEl = document.createElement('span');
      numberEl.className = 'calendar-day__number';
      numberEl.textContent = dateNumber;

      if (isToday(cellDate)) {
        cell.classList.add('calendar-day--today');
      }

      header.appendChild(numberEl);

      const events = groupEventsByDate()[cellDateKey] || [];
      if (events.length) {
        const badge = document.createElement('span');
        badge.className = 'calendar-day__badge';
        const highCount = events.filter((event) => event.priority === 'high').length;
        const mediumCount = events.filter((event) => event.priority === 'medium').length;
        const lowCount = events.filter((event) => event.priority === 'low').length;
        badge.textContent = `${highCount ? '🔥' : ''}${mediumCount ? '⭐' : ''}${lowCount ? '🫧' : ''}` || `${events.length}`;
        header.appendChild(badge);
      }

      cell.appendChild(header);

      const list = document.createElement('div');
      list.className = 'calendar-day__events';

      events.slice(0, 3).forEach((event) => {
        const chip = document.createElement('span');
        chip.className = 'calendar-event-chip';
        chip.dataset.priority = event.priority || 'low';
        chip.innerHTML = `<span class="emoji">${PRIORITY_EMOJI[event.priority] || '🫧'}</span>${escapeHTML(event.title)}`;
        chip.title = event.description || event.title;
        list.appendChild(chip);
      });

      if (events.length > 3) {
        const more = document.createElement('span');
        more.className = 'calendar-event-more';
        more.textContent = `+${events.length - 3} 더보기`;
        list.appendChild(more);
      }

      cell.appendChild(list);

      if (!cell.disabled) {
        cell.addEventListener('click', () => handleSelectDate(cellDateKey));
        cell.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleSelectDate(cellDateKey);
          }
        });
      }

      gridEl.appendChild(cell);
    }
  }

  function groupEventsByDate() {
    return state.events.reduce((acc, event) => {
      const key = event.date ? formatDateKey(new Date(event.date)) : null;
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(event);
      return acc;
    }, {});
  }

  function renderSidebar() {
    if (!sidebarList) return;
    const key = state.selectedDate;
    sidebarList.innerHTML = '';

    if (!key) {
      sidebarLabel.textContent = '날짜를 선택해 보세요';
      sidebarList.innerHTML = '<p class="empty-state">달력에서 날짜를 골라 일정을 확인하세요.</p>';
      return;
    }

    const dateObj = parseDateKey(key);
    sidebarLabel.textContent = `${dateObj.getFullYear()}년 ${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 일정`;

    const events = (groupEventsByDate()[key] || []).sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const priorityCompare = (priorityOrder[a.priority] || 9) - (priorityOrder[b.priority] || 9);
      if (priorityCompare !== 0) return priorityCompare;
      return new Date(a.date) - new Date(b.date);
    });

    if (!events.length) {
      sidebarList.innerHTML = '<p class="empty-state">아직 일정이 없어요 😊</p>';
      return;
    }

    events.forEach((event) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sidebar-event';
      item.innerHTML = `
        <span class="sidebar-event__title">${CATEGORY_EMOJI[event.category] || '🫧'} ${escapeHTML(event.title)}</span>
        <span class="sidebar-event__meta">
          <span>${event.category}</span>
          <span>${PRIORITY_EMOJI[event.priority] || '🫧'}</span>
          ${event.time ? `<span>${event.time}</span>` : ''}
        </span>
      `;
      item.addEventListener('click', () => openDetailModal(event.id));
      sidebarList.appendChild(item);
    });
  }

  async function handleSelectDate(dateKey) {
    state.selectedDate = dateKey;
    renderSidebar();
  }

  async function openDetailModal(eventId) {
    try {
      showSpinner();
      const response = await fetch(`${API_BASE}/${eventId}`, buildFetchOptions());
      if (!response.ok) {
        throw new Error('일정 정보를 불러오지 못했습니다.');
      }
      const data = await response.json();
      openModal(renderEventDetail(data.event));
    } catch (error) {
      console.error('[calendar] openDetailModal', error);
      showToast(error.message || '일정 상세 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
      hideSpinner();
    }
  }

  function openCreateModal() {
    if (!state.token) {
      showToast('로그인 후 이용해 주세요.');
      return;
    }
    openModal(renderEventForm());
  }

  function openEditModal(event) {
    openModal(renderEventForm(event));
  }

  function openModal(contentHTML) {
    modalContent.innerHTML = contentHTML;
    modalBackdrop.hidden = false;

    const form = modalContent.querySelector('form');
    if (form) {
      form.addEventListener('submit', handleSaveEvent);
      const deleteBtn = modalContent.querySelector('[data-delete-event]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteEvent);
      }
    }
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    modalContent.innerHTML = '';
  }

  function renderEventDetail(event) {
    if (!event) {
      return '<p>일정을 찾을 수 없습니다.</p>';
    }

    const canEdit = state.token && (state.isAdmin || (state.user && event.createdBy && event.createdBy.id === state.user.id));

    return `
      <h2 id="modalTitle">${CATEGORY_EMOJI[event.category] || '🫧'} ${escapeHTML(event.title)}</h2>
      <div class="modal-body">
        <p><strong>날짜</strong> ${formatDateLabel(event.date)} ${event.time ? `• ${event.time}` : ''}</p>
        <p><span class="badge">${event.category}</span>
           <span class="badge badge--secondary">${PRIORITY_EMOJI[event.priority] || '🫧'} 중요도</span></p>
        <p>${escapeHTML(event.description || '설명이 없습니다.')}</p>
        <p class="modal-meta">
          작성자: ${event.createdBy?.username || '알 수 없음'}
        </p>
      </div>
      ${canEdit ? `
        <div class="modal-actions">
          <button type="button" class="text-button" data-edit-event="${event.id}">수정</button>
          <button type="button" class="icon-button" data-delete-event="${event.id}">삭제</button>
        </div>
      ` : ''}
    `;
  }

  function renderEventForm(event) {
    const isEdit = Boolean(event);
    const initialDate = event ? event.date : (state.selectedDate ? parseDateKey(state.selectedDate) : new Date());
    const dateValue = initialDate ? new Date(initialDate).toISOString().split('T')[0] : '';

    return `
      <h2 id="modalTitle">${isEdit ? '일정 수정' : '새 일정 만들기'}</h2>
      <form data-event-form data-event-id="${event?.id || ''}">
        <label>
          제목
          <input type="text" name="title" required minlength="1" maxlength="100" value="${escapeAttr(event?.title || '')}">
        </label>
        <label>
          설명
          <textarea name="description" rows="3">${escapeHTML(event?.description || '')}</textarea>
        </label>
        <label>
          날짜
          <input type="date" name="date" required value="${dateValue}">
        </label>
        <label>
          시간 (HH:mm)
          <input type="time" name="time" value="${escapeAttr(event?.time || '')}">
        </label>
        <label>
          카테고리
          <select name="category" required>
            ${['시험', '숙제', '생일', '약속', '기타'].map((cat) => `
              <option value="${cat}" ${event?.category === cat ? 'selected' : ''}>${cat}</option>
            `).join('')}
          </select>
        </label>
        <label>
          중요도
          <select name="priority">
            ${['high', 'medium', 'low'].map((pri) => `
              <option value="${pri}" ${event?.priority === pri ? 'selected' : ''}>${pri}</option>
            `).join('')}
          </select>
        </label>
        <label>
          알림 설정
          <select name="notifyBefore">
            <option value="">알림 없음</option>
            <option value="1d" ${event?.notifyBefore === '1d' ? 'selected' : ''}>1일 전</option>
            <option value="3d" ${event?.notifyBefore === '3d' ? 'selected' : ''}>3일 전</option>
            <option value="7d" ${event?.notifyBefore === '7d' ? 'selected' : ''}>1주일 전</option>
          </select>
        </label>
        <div class="modal-actions">
          ${isEdit ? '<button type="button" class="text-button" data-delete-event>삭제</button>' : ''}
          <button type="submit" class="primary-button">${isEdit ? '수정 완료' : '일정 추가'}</button>
        </div>
      </form>
    `;
  }

  async function handleSaveEvent(event) {
    event.preventDefault();
    if (!state.token) {
      showToast('로그인 후 이용해 주세요.');
      return;
    }

    const form = event.target;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    const body = {
      title: (payload.title || '').trim(),
      description: (payload.description || '').trim(),
      date: payload.date,
      time: payload.time || '',
      category: payload.category,
      priority: payload.priority || 'low',
      notifyBefore: payload.notifyBefore || null,
    };

    if (!body.title || !body.date) {
      showToast('제목과 날짜는 필수입니다.');
      return;
    }

    showSpinner();
    try {
      const eventId = form.dataset.eventId;
      const method = eventId ? 'PUT' : 'POST';
      const endpoint = eventId ? `${API_BASE}/${eventId}` : API_BASE;

      const response = await fetch(endpoint, buildFetchOptions(method, body));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '일정을 저장하는 중 오류가 발생했습니다.');
      }

      showToast(eventId ? '일정을 수정했습니다.' : '새 일정을 등록했어요!');
      closeModal();
      await loadEvents();
    } catch (error) {
      console.error('[calendar] handleSaveEvent', error);
      showToast(error.message || '일정을 저장하는 중 오류가 발생했습니다.');
    } finally {
      hideSpinner();
    }
  }

  async function handleDeleteEvent(event) {
    event.preventDefault();
    if (!state.token) {
      showToast('로그인 후 이용해 주세요.');
      return;
    }
    const button = event.currentTarget;
    const form = button.closest('form');
    const eventId = form?.dataset.eventId || button.dataset.deleteEvent;
    if (!eventId) return;

    const confirmed = window.confirm('정말로 일정을 삭제할까요?');
    if (!confirmed) return;

    showSpinner();
    try {
      const response = await fetch(`${API_BASE}/${eventId}`, buildFetchOptions('DELETE'));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '일정을 삭제하는 중 오류가 발생했습니다.');
      }

      showToast('일정을 삭제했습니다.');
      closeModal();
      await loadEvents();
    } catch (error) {
      console.error('[calendar] handleDeleteEvent', error);
      showToast(error.message || '일정을 삭제하는 중 오류가 발생했습니다.');
    } finally {
      hideSpinner();
    }
  }

  function showSpinner() {
    if (spinner) spinner.hidden = false;
  }

  function hideSpinner() {
    if (spinner) spinner.hidden = true;
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    setTimeout(() => {
      toast.hidden = true;
    }, 2500);
  }

  function formatDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function parseDateKey(key) {
    const [year, month, day] = key.split('-').map((value) => parseInt(value, 10));
    return new Date(year, month - 1, day);
  }

  function isToday(date) {
    const today = new Date();
    return date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
  }

  function formatDateLabel(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  }

  function escapeHTML(text) {
    if (text == null) return '';
    return text
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(text) {
    return escapeHTML(text).replace(/`/g, '&#96;');
  }

  function debounce(fn, delay = 200) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }
})();
