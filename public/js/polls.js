(function () {
  const API_BASE = '/api/polls';
  const ACTIVE = 'active';
  const CLOSED = 'closed';
  const ADMIN_ROLES = new Set(['admin', 'superadmin', 'manager']);

  const listElements = {
    [ACTIVE]: document.querySelector('[data-poll-list="active"]'),
    [CLOSED]: document.querySelector('[data-poll-list="closed"]'),
  };
  const tabButtons = Array.from(document.querySelectorAll('[data-poll-tab]'));
  const createPanel = document.querySelector('[data-create-panel]');
  const createToggle = document.querySelector('[data-toggle-create]');
  const cancelCreateButtons = Array.from(document.querySelectorAll('[data-cancel-create]'));
  const createForm = document.querySelector('[data-create-form]');
  const optionList = document.querySelector('[data-option-list]');
  const addOptionButton = document.querySelector('[data-add-option]');
  const toast = document.querySelector('[data-toast]');
  const spinner = document.querySelector('[data-spinner]');

  const state = {
    token: null,
    user: null,
    polls: {
      [ACTIVE]: [],
      [CLOSED]: [],
    },
    activeTab: ACTIVE,
  };

  let toastTimer = null;

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('[polls] init failed', error);
      showToast(error.message || '투표 기능을 불러오지 못했습니다.');
    });
  });

  async function init() {
    state.token = await getToken();
    if (!state.token) {
      redirectToLogin();
      return;
    }

    if (typeof window.ensureAuthUser === 'function') {
      state.user = await window.ensureAuthUser().catch(() => null);
    }

    bindEvents();
    resetCreateForm();
    await loadPolls({ silent: true });
  }

  function bindEvents() {
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => switchTab(button.getAttribute('data-poll-tab')));
    });

    if (createToggle) {
      createToggle.addEventListener('click', () => toggleCreatePanel(true));
    }

    cancelCreateButtons.forEach((button) => {
      button.addEventListener('click', () => toggleCreatePanel(false));
    });

    if (createForm) {
      createForm.addEventListener('submit', handleCreateSubmit);
    }

    if (addOptionButton) {
      addOptionButton.addEventListener('click', () => {
        addOptionField();
        syncOptionRemoveState();
      });
    }
  }

  async function loadPolls({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [activePayload, closedPayload] = await Promise.all([
        requestJSON(`${API_BASE}?status=active`),
        requestJSON(`${API_BASE}?status=closed`),
      ]);

      state.polls[ACTIVE] = normalizePolls(activePayload);
      state.polls[CLOSED] = normalizePolls(closedPayload);

      renderPollLists();
    } catch (error) {
      console.error('[polls] load error', error);
      showToast(error.message || '투표 목록을 불러오지 못했습니다.');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  function switchTab(tab) {
    if (!tab || !listElements[tab] || state.activeTab === tab) return;

    state.activeTab = tab;
    tabButtons.forEach((button) => {
      const isActive = button.getAttribute('data-poll-tab') === tab;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    Object.entries(listElements).forEach(([key, el]) => {
      if (!el) return;
      const isActive = key === tab;
      el.classList.toggle('is-active', isActive);
      el.hidden = !isActive;
    });
  }

  function renderPollLists() {
    [ACTIVE, CLOSED].forEach((status) => renderPollList(status));
  }

  function renderPollList(status) {
    const container = listElements[status];
    if (!container) return;
    container.innerHTML = '';

    const polls = state.polls[status] || [];
    if (!polls.length) {
      container.appendChild(createEmptyState(status));
      return;
    }

    polls.forEach((poll) => {
      container.appendChild(createPollCard(poll, status));
    });
  }

  function createPollCard(poll, status) {
    const card = document.createElement('article');
    card.className = 'poll-card';
    card.dataset.pollId = poll.id;

    const header = document.createElement('div');
    header.className = 'poll-card__header';

    const title = document.createElement('h3');
    title.className = 'poll-card__title';
    title.textContent = poll.title;
    header.appendChild(title);

    const pillRow = document.createElement('div');
    pillRow.className = 'poll-card__meta';

    const statusPill = document.createElement('span');
    statusPill.className = `pill ${poll.isClosed ? 'pill--danger' : 'pill--success'}`;
    statusPill.textContent = poll.isClosed ? '종료됨' : '진행 중';
    pillRow.appendChild(statusPill);

    if (poll.hasVoted) {
      const votedPill = document.createElement('span');
      votedPill.className = 'pill';
      votedPill.textContent = '내 투표 완료';
      pillRow.appendChild(votedPill);
    }

    if (poll.multiple) {
      const multiPill = document.createElement('span');
      multiPill.className = 'pill';
      multiPill.textContent = '복수 선택 가능';
      pillRow.appendChild(multiPill);
    } else {
      const singlePill = document.createElement('span');
      singlePill.className = 'pill';
      singlePill.textContent = '단일 선택';
      pillRow.appendChild(singlePill);
    }

    const anonymityPill = document.createElement('span');
    anonymityPill.className = 'pill';
    anonymityPill.textContent = poll.anonymous ? '익명 투표' : '기명 투표';
    pillRow.appendChild(anonymityPill);

    header.appendChild(pillRow);

    const metaRow = document.createElement('div');
    metaRow.className = 'poll-card__meta';
    metaRow.appendChild(createMetaItem(`총 ${poll.totalVotes || 0}표`));

    if (poll.deadline) {
      metaRow.appendChild(createMetaItem(`마감 ${formatDate(poll.deadline)}`));
    }

    const creatorName = getCreatorName(poll);
    if (creatorName) {
      metaRow.appendChild(createMetaItem(`작성자 ${creatorName}`));
    }

    header.appendChild(metaRow);
    card.appendChild(header);

    if (poll.description) {
      const description = document.createElement('p');
      description.className = 'poll-card__description';
      description.textContent = poll.description;
      card.appendChild(description);
    }

    const body = document.createElement('div');
    body.className = 'poll-card__body';
    body.appendChild(poll.canVote ? createVoteForm(poll, status) : createResultList(poll));
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'poll-card__actions';

    if (poll.canVote && poll.deadline) {
      const due = document.createElement('span');
      due.className = 'poll-card__meta';
      due.textContent = `마감까지 ${formatRelativeTime(poll.deadline)}`;
      actions.appendChild(due);
    }

    if (!poll.isClosed && canManagePoll(poll)) {
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'secondary-button';
      closeButton.textContent = '투표 종료';
      closeButton.addEventListener('click', () => handleClosePoll(poll.id));
      actions.appendChild(closeButton);
    }

    if (actions.children.length > 0) {
      card.appendChild(actions);
    }

    return card;
  }

  function createVoteForm(poll, status) {
    const form = document.createElement('form');
    form.className = 'poll-card__options';
    form.setAttribute('data-poll-vote-form', poll.id);

    poll.options.forEach((option, index) => {
      form.appendChild(createSelectableRow(poll, option, index));
    });

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary-button';
    submit.textContent = '투표하기';
    form.appendChild(submit);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      handleVote(poll, form, status);
    });

    return form;
  }

  function createSelectableRow(poll, option, index) {
    const row = document.createElement('label');
    row.className = 'poll-option-row';

    const input = document.createElement('input');
    input.type = poll.multiple ? 'checkbox' : 'radio';
    input.name = `poll-${poll.id}`;
    input.value = String(index);
    row.appendChild(input);

    const label = document.createElement('span');
    label.className = 'poll-option-label';
    label.textContent = option.text;
    row.appendChild(label);

    return row;
  }

  function createResultList(poll) {
    const container = document.createElement('div');
    container.className = 'poll-card__options';

    const totalVotes = poll.totalVotes || 0;
    poll.options.forEach((option) => {
      const percent = totalVotes ? Math.round((option.votesCount / totalVotes) * 1000) / 10 : 0;
      const row = document.createElement('div');
      row.className = 'poll-option-label';

      const title = document.createElement('div');
      title.textContent = option.text;
      row.appendChild(title);

      const progress = document.createElement('div');
      progress.className = 'poll-progress';
      const span = document.createElement('span');
      span.style.width = `${percent}%`;
      progress.appendChild(span);
      row.appendChild(progress);

      const stats = document.createElement('div');
      stats.className = 'poll-option-stats';
      stats.innerHTML = `<span>${option.votesCount || 0}표</span><span>${percent.toFixed(1)}%</span>`;
      row.appendChild(stats);

      container.appendChild(row);
    });

    if (!totalVotes) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '아직 참여한 사람이 없습니다. 가장 먼저 참여해 보세요!';
      container.appendChild(empty);
    }

    return container;
  }

  async function handleVote(poll, form, status) {
    try {
      setLoading(true);
      const selections = Array.from(form.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked'))
        .map((input) => Number.parseInt(input.value, 10))
        .filter((value) => Number.isInteger(value));

      if (!selections.length) {
        showToast('선택지를 하나 이상 선택하세요.');
        return;
      }

      if (!poll.multiple && selections.length !== 1) {
        showToast('하나의 선택지만 고를 수 있습니다.');
        return;
      }

      await requestJSON(`${API_BASE}/${poll.id}/vote`, {
        method: 'POST',
        body: { selections },
      });

      showToast('투표가 완료되었습니다.');
      await loadPolls({ silent: true });
      renderPollLists();
    } catch (error) {
      console.error('[polls] vote error', error);
      showToast(error.message || '투표 처리 중 문제가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleClosePoll(pollId) {
    if (!pollId) return;
    if (!confirm('이 투표를 종료하시겠습니까? 종료 후에는 다시 열 수 없습니다.')) return;

    try {
      setLoading(true);
      await requestJSON(`${API_BASE}/${pollId}/close`, { method: 'POST' });
      showToast('투표가 종료되었습니다.');
      await loadPolls({ silent: true });
      renderPollLists();
    } catch (error) {
      console.error('[polls] close error', error);
      showToast(error.message || '투표를 종료하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSubmit(event) {
    event.preventDefault();
    if (!createForm) return;

    const formData = new FormData(createForm);
    const title = String(formData.get('title') || '').trim();
    const description = String(formData.get('description') || '').trim();
    const deadlineRaw = String(formData.get('deadline') || '').trim();
    const multiple = formData.getAll('multiple').length > 0;
    const anonymous = formData.getAll('anonymous').length > 0;

    const options = Array.from(optionList.querySelectorAll('input[data-option-input]'))
      .map((input) => input.value.trim())
      .filter((value) => value.length > 0);

    if (!title) {
      showToast('제목을 입력해주세요.');
      return;
    }

    if (options.length < 2) {
      showToast('선택지는 최소 두 개 이상 필요합니다.');
      return;
    }

    const payload = {
      title,
      description,
      options,
      multiple,
      anonymous,
    };

    if (deadlineRaw) {
      const deadline = new Date(deadlineRaw);
      if (Number.isNaN(deadline.getTime())) {
        showToast('마감 일시 형식이 올바르지 않습니다.');
        return;
      }
      payload.deadline = deadline.toISOString();
    }

    try {
      setLoading(true);
      await requestJSON(API_BASE, {
        method: 'POST',
        body: payload,
      });
      showToast('새 투표가 생성되었습니다.');
      toggleCreatePanel(false);
      resetCreateForm();
      await loadPolls({ silent: true });
      renderPollLists();
    } catch (error) {
      console.error('[polls] create error', error);
      showToast(error.message || '투표를 생성하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function toggleCreatePanel(open) {
    if (!createPanel || !createToggle) return;
    const shouldOpen = open === undefined ? createPanel.hidden : open;
    createPanel.hidden = !shouldOpen;
    createToggle.hidden = shouldOpen;

    if (shouldOpen) {
      const titleInput = createForm?.querySelector('#pollTitle');
      if (titleInput) {
        requestAnimationFrame(() => titleInput.focus());
      }
    }
  }

  function resetCreateForm() {
    if (!createForm || !optionList) return;
    createForm.reset();
    optionList.innerHTML = '';
    addOptionField();
    addOptionField();
    syncOptionRemoveState();
  }

  function addOptionField(value = '') {
    if (!optionList) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'poll-option';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '선택지 내용을 입력하세요';
    input.maxLength = 200;
    input.required = true;
    input.value = value;
    input.dataset.optionInput = 'true';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'icon-button';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => {
      optionList.removeChild(wrapper);
      syncOptionRemoveState();
    });

    wrapper.appendChild(input);
    wrapper.appendChild(removeButton);
    optionList.appendChild(wrapper);
  }

  function syncOptionRemoveState() {
    if (!optionList) return;
    const rows = Array.from(optionList.querySelectorAll('.poll-option'));
    rows.forEach((row) => {
      const button = row.querySelector('button');
      if (!button) return;
      button.disabled = rows.length <= 2;
      button.style.visibility = rows.length <= 2 ? 'hidden' : 'visible';
    });
  }

  function createEmptyState(status) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.textContent = status === ACTIVE
      ? '진행 중인 투표가 없습니다. 가장 먼저 새로운 투표를 시작해보세요!'
      : '종료된 투표가 아직 없습니다.';
    return div;
  }

  function createMetaItem(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }

  function getCreatorName(poll) {
    if (!poll.createdBy) return '';
    if (typeof poll.createdBy === 'string') return poll.createdBy;
    return poll.createdBy.name || poll.createdBy.username || '';
  }

  function canManagePoll(poll) {
    if (!state.user) return false;
    if (ADMIN_ROLES.has(state.user.role)) return true;
    const ownerId = poll?.createdBy?.id || poll?.createdBy?._id;
    return ownerId && ownerId === state.user.id;
  }

  async function requestJSON(url, options = {}) {
    const token = await getToken();
    if (!token) {
      redirectToLogin();
      throw new Error('로그인이 필요합니다.');
    }

    const headers = new Headers(options.headers || {});
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body,
    });

    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      throw new Error('세션이 만료되어 다시 로그인해야 합니다.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = (payload && (payload.error || payload.message)) || response.statusText || '요청을 처리하지 못했습니다.';
      const error = new Error(message);
      error.payload = payload;
      error.response = response;
      throw error;
    }

    return payload;
  }

  function normalizePolls(payload) {
    if (!payload) return [];
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.polls)
        ? payload.polls
        : [];

    return list.map((poll) => ({
      id: poll.id || poll._id,
      title: poll.title,
      description: poll.description || '',
      options: Array.isArray(poll.options) ? poll.options.map((option) => ({
        text: option.text,
        votesCount: option.votesCount || 0,
      })) : [],
      multiple: Boolean(poll.multiple),
      anonymous: Boolean(poll.anonymous),
      deadline: poll.deadline || null,
      isClosed: Boolean(poll.isClosed),
      isDeleted: Boolean(poll.isDeleted),
      totalVotes: poll.totalVotes || 0,
      hasVoted: Boolean(poll.hasVoted),
      canVote: Boolean(poll.canVote),
      createdBy: poll.createdBy || null,
      createdAt: poll.createdAt || null,
      updatedAt: poll.updatedAt || null,
    }));
  }

  async function getToken() {
    if (typeof window.ensureAuthToken === 'function') {
      const refreshed = await window.ensureAuthToken();
      if (refreshed) {
        state.token = refreshed;
        return refreshed;
      }
    }

    const stored = localStorage.getItem('token');
    if (stored) {
      state.token = stored;
      return stored;
    }
    return null;
  }

  function redirectToLogin() {
    showToast('로그인이 필요합니다.');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 800);
  }

  function showToast(message) {
    if (!toast) {
      alert(message);
      return;
    }
    toast.textContent = message;
    toast.hidden = false;
    toast.dataset.state = 'visible';
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => hideToast(), 3200);
  }

  function hideToast() {
    if (!toast) return;
    toast.dataset.state = 'hidden';
    toast.hidden = true;
  }

  function setLoading(isLoading) {
    if (!spinner) return;
    spinner.hidden = !isLoading;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }

  function formatRelativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const minutes = Math.round(diff / (60 * 1000));

    if (minutes <= 0) return '곧 마감';
    if (minutes < 60) return `${minutes}분 남음`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}시간 남음`;
    const days = Math.round(hours / 24);
    return `${days}일 남음`;
  }
})();
