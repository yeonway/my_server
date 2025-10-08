
(function () {
  var MENU_ID = 'profile-menu-floating';
  var ACCOUNT_SECTION_ATTR = 'data-account-enhanced';
  var QUICK_LIST_MAX = 4;
  var REFRESH_INTERVAL = 120000;
  var OVERLAY_REFRESH_INTERVAL = 45000;

  var state = {
    token: null,
    user: null,
    accounts: [],
    loading: false,
    error: '',
    lastFetched: 0
  };

  var overlayState = {
    open: false,
    elements: null
  };

  var container = null;
  var dropdown = null;
  var actionsList = null;
  var accountSection = null;
  var accountListEl = null;
  var accountStatusEl = null;
  var manageButton = null;
  var manageActionItem = null;
  var actionsObserver = null;
  var refreshTimer = null;
  var overlayRefreshTimer = null;

  function init() {
    waitForMenu().then(function (menu) {
      setup(menu);
    }).catch(function () {
      /* no menu found */
    });
  }

  function waitForMenu() {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      function check() {
        var menu = document.getElementById(MENU_ID);
        if (menu) {
          resolve(menu);
          return;
        }
        if (Date.now() - start > 10000) {
          reject(new Error('profile menu not found'));
          return;
        }
        setTimeout(check, 200);
      }
      check();
    });
  }

  function setup(menu) {
    container = menu;
    dropdown = container.querySelector('.profile-dropdown');
    actionsList = container.querySelector('.profile-dropdown-actions');
    if (!dropdown || !actionsList) {
      return;
    }

    buildAccountSection();
    buildOverlay();
    observeActions();
    addGlobalListeners();
    refreshState(true);
    refreshTimer = setInterval(function () {
      refreshState(false);
    }, REFRESH_INTERVAL);
    overlayRefreshTimer = setInterval(function () {
      if (overlayState.open) {
        refreshState(true);
      }
    }, OVERLAY_REFRESH_INTERVAL);
  }

  function buildAccountSection() {
    accountSection = document.createElement('div');
    accountSection.className = 'profile-account-section profile-account-section-enhanced';
    accountSection.setAttribute(ACCOUNT_SECTION_ATTR, 'true');
    accountSection.style.display = 'none';

    var header = document.createElement('div');
    header.className = 'profile-account-header';

    var title = document.createElement('span');
    title.className = 'profile-account-title';
    title.textContent = '내 계정';
    header.appendChild(title);

    manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'profile-account-manage';
    manageButton.textContent = '관리';
    manageButton.addEventListener('click', function (event) {
      event.preventDefault();
      openOverlay();
    });
    header.appendChild(manageButton);

    accountStatusEl = document.createElement('div');
    accountStatusEl.className = 'profile-account-status';
    accountStatusEl.textContent = '계정을 불러오는 중...';
    accountStatusEl.style.display = 'none';

    accountListEl = document.createElement('ul');
    accountListEl.className = 'profile-account-list';

    accountSection.appendChild(header);
    accountSection.appendChild(accountStatusEl);
    accountSection.appendChild(accountListEl);

    dropdown.insertBefore(accountSection, dropdown.firstChild);
  }

  function buildOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'account-manager-overlay';
    overlay.setAttribute('hidden', 'hidden');

    var backdrop = document.createElement('div');
    backdrop.className = 'account-manager-backdrop';
    backdrop.setAttribute('data-action', 'close');
    overlay.appendChild(backdrop);

    var dialog = document.createElement('div');
    dialog.className = 'account-manager-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'account-manager-title');

    var header = document.createElement('header');
    header.className = 'account-manager-header';

    var heading = document.createElement('h2');
    heading.id = 'account-manager-title';
    heading.textContent = '계정 관리';
    header.appendChild(heading);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'account-manager-close';
    closeBtn.setAttribute('data-action', 'close');
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.textContent = '×';
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'account-manager-body';

    var feedback = document.createElement('div');
    feedback.className = 'account-manager-feedback';
    feedback.setAttribute('data-role', 'feedback');
    feedback.setAttribute('hidden', 'hidden');
    body.appendChild(feedback);

    var list = document.createElement('div');
    list.className = 'account-manager-list';
    list.setAttribute('data-role', 'manager-list');
    body.appendChild(list);

    var empty = document.createElement('div');
    empty.className = 'account-manager-empty';
    empty.setAttribute('data-role', 'manager-empty');
    empty.setAttribute('hidden', 'hidden');
    empty.textContent = '등록된 계정이 없습니다.';
    body.appendChild(empty);

    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (event) {
      var action = event.target && event.target.getAttribute('data-action');
      if (action === 'close') {
        closeOverlay();
      }
    });

    overlayState.elements = {
      container: overlay,
      feedback: feedback,
      list: list,
      empty: empty,
      closeButton: closeBtn
    };
  }

  function observeActions() {
    ensureManageAction();
    actionsObserver = new MutationObserver(function () {
      ensureManageAction();
    });
    actionsObserver.observe(actionsList, { childList: true });
  }

  function addGlobalListeners() {
    window.addEventListener('storage', function (event) {
      if (event.key === 'token') {
        refreshState(true);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        if (overlayState.open) {
          closeOverlay();
        }
      }
    });
  }

  function ensureManageAction() {
    if (!state.user) {
      removeManageAction();
      return;
    }
    if (manageActionItem && manageActionItem.parentNode === actionsList) {
      return;
    }
    manageActionItem = document.createElement('li');
    manageActionItem.className = 'profile-account-manage-action';
    manageActionItem.setAttribute('data-account-action', 'manage');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '내 계정 관리';
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      openOverlay();
    });
    manageActionItem.appendChild(btn);
    actionsList.appendChild(manageActionItem);
    var divider = dropdown.querySelector('[data-role="divider"]');
    if (divider) {
      divider.style.display = 'block';
    }
  }

  function removeManageAction() {
    if (manageActionItem && manageActionItem.parentNode) {
      manageActionItem.parentNode.removeChild(manageActionItem);
    }
    manageActionItem = null;
  }

  function setAccountSectionVisible(visible) {
    if (!accountSection) return;
    accountSection.style.display = visible ? 'block' : 'none';
  }

  function renderAccountSection() {
    if (!accountSection) return;
    if (!state.user) {
      setAccountSectionVisible(false);
      accountListEl.innerHTML = '';
      accountStatusEl.style.display = 'none';
      removeManageAction();
      return;
    }

    setAccountSectionVisible(true);

    if (state.loading) {
      accountStatusEl.textContent = '계정을 불러오는 중...';
      accountStatusEl.style.display = 'block';
      accountListEl.innerHTML = '';
      return;
    }

    if (state.error) {
      accountStatusEl.textContent = state.error;
      accountStatusEl.style.display = 'block';
      accountListEl.innerHTML = '';
      return;
    }

    if (!state.accounts.length) {
      accountStatusEl.textContent = '등록된 계정이 없습니다.';
      accountStatusEl.style.display = 'block';
      accountListEl.innerHTML = '';
      return;
    }

    accountStatusEl.style.display = 'none';
    accountListEl.innerHTML = '';
    var visible = state.accounts.slice(0, QUICK_LIST_MAX);
    for (var i = 0; i < visible.length; i += 1) {
      var account = visible[i];
      var item = document.createElement('li');
      item.className = 'profile-account-item';

      var label = document.createElement('span');
      label.className = 'profile-account-name';
      label.textContent = account.username;
      item.appendChild(label);

      if (account.isCurrent) {
        var currentBadge = document.createElement('span');
        currentBadge.className = 'profile-account-badge';
        currentBadge.textContent = '현재';
        item.appendChild(currentBadge);
      } else if (account.suspended) {
        var blockedBadge = document.createElement('span');
        blockedBadge.className = 'profile-account-badge is-blocked';
        blockedBadge.textContent = '정지됨';
        item.appendChild(blockedBadge);
      } else {
        var switchBtn = document.createElement('button');
        switchBtn.type = 'button';
        switchBtn.className = 'profile-account-switch';
        switchBtn.textContent = '전환';
        (function (username) {
          switchBtn.addEventListener('click', function (event) {
            event.preventDefault();
            handleAccountSwitch(username);
          });
        })(account.username);
        item.appendChild(switchBtn);
      }

      accountListEl.appendChild(item);
    }

    if (state.accounts.length > visible.length) {
      var moreItem = document.createElement('li');
      moreItem.className = 'profile-account-item profile-account-more';
      var remaining = state.accounts.length - visible.length;
      moreItem.textContent = '+ ' + remaining + '개의 계정';
      accountListEl.appendChild(moreItem);
    }
  }

  function renderOverlay() {
    if (!overlayState.elements) return;
    var container = overlayState.elements;

    if (state.error) {
      setOverlayFeedback(state.error, 'error');
    } else {
      setOverlayFeedback('', 'info');
    }

    if (state.loading) {
      container.list.innerHTML = '<div class="account-manager-status">로딩 중...</div>';
      container.empty.setAttribute('hidden', 'hidden');
      return;
    }

    if (!state.accounts.length) {
      container.list.innerHTML = '';
      container.empty.textContent = state.error ? state.error : '등록된 계정이 없습니다.';
      container.empty.removeAttribute('hidden');
      return;
    }

    container.empty.setAttribute('hidden', 'hidden');
    container.list.innerHTML = '';

    for (var i = 0; i < state.accounts.length; i += 1) {
      container.list.appendChild(buildAccountCard(state.accounts[i]));
    }
  }

  function buildAccountCard(account) {
    var card = document.createElement('section');
    card.className = 'account-manager-card';
    card.setAttribute('data-username', account.username);

    var header = document.createElement('div');
    header.className = 'account-card-header';

    var titleGroup = document.createElement('div');
    titleGroup.className = 'account-card-title-group';

    var usernameEl = document.createElement('div');
    usernameEl.className = 'account-card-username';
    usernameEl.textContent = account.username;
    titleGroup.appendChild(usernameEl);

    if (account.name) {
      var nameEl = document.createElement('div');
      nameEl.className = 'account-card-name';
      nameEl.textContent = account.name;
      titleGroup.appendChild(nameEl);
    }

    var metaParts = [];
    if (account.signupOrder) metaParts.push('#' + account.signupOrder);
    if (account.isCurrent) metaParts.push('현재');
    if (account.suspended) metaParts.push('정지됨');
    if (metaParts.length) {
      var meta = document.createElement('div');
      meta.className = 'account-card-meta';
      meta.textContent = metaParts.join(' · ');
      titleGroup.appendChild(meta);
    }

    header.appendChild(titleGroup);

    var switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'account-card-switch';
    if (account.isCurrent) {
      switchBtn.textContent = '현재 계정';
      switchBtn.disabled = true;
    } else if (account.suspended) {
      switchBtn.textContent = '정지됨';
      switchBtn.disabled = true;
      switchBtn.classList.add('is-blocked');
    } else {
      switchBtn.textContent = '전환';
      (function (username) {
        switchBtn.addEventListener('click', function (event) {
          event.preventDefault();
          handleAccountSwitch(username);
        });
      })(account.username);
    }
    header.appendChild(switchBtn);
    card.appendChild(header);

    var body = document.createElement('div');
    body.className = 'account-card-body';

    var emailLabel = document.createElement('label');
    emailLabel.className = 'account-card-field-label';
    emailLabel.textContent = '이메일';
    body.appendChild(emailLabel);

    var emailRow = document.createElement('div');
    emailRow.className = 'account-card-email-row';

    var emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.placeholder = 'example@domain.com';
    emailInput.value = account.email || '';
    emailRow.appendChild(emailInput);

    var emailSave = document.createElement('button');
    emailSave.type = 'button';
    emailSave.className = 'account-card-email-save';
    emailSave.textContent = '저장';
    emailSave.addEventListener('click', function (event) {
      event.preventDefault();
      handleAccountEmail(account.username, emailInput.value, emailSave);
    });
    emailRow.appendChild(emailSave);

    var emailClear = document.createElement('button');
    emailClear.type = 'button';
    emailClear.className = 'account-card-email-clear';
    emailClear.textContent = '삭제';
    emailClear.addEventListener('click', function (event) {
      event.preventDefault();
      emailInput.value = '';
      handleAccountEmail(account.username, '', emailClear);
    });
    emailRow.appendChild(emailClear);

    body.appendChild(emailRow);

    var deleteToggle = document.createElement('button');
    deleteToggle.type = 'button';
    deleteToggle.className = 'account-card-delete-toggle';
    deleteToggle.textContent = '계정 삭제';
    body.appendChild(deleteToggle);

    var deleteForm = document.createElement('form');
    deleteForm.className = 'account-card-delete-form';
    deleteForm.setAttribute('hidden', 'hidden');

    var deleteInfo = document.createElement('p');
    deleteInfo.className = 'account-card-delete-info';
    deleteInfo.textContent = '삭제하려면 비밀번호를 입력하세요.';
    deleteForm.appendChild(deleteInfo);

    var passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.placeholder = '비밀번호';
    passwordInput.required = true;
    deleteForm.appendChild(passwordInput);

    var deleteActions = document.createElement('div');
    deleteActions.className = 'account-card-delete-actions';

    var deleteCancel = document.createElement('button');
    deleteCancel.type = 'button';
    deleteCancel.className = 'account-card-delete-cancel';
    deleteCancel.textContent = '취소';
    deleteCancel.addEventListener('click', function (event) {
      event.preventDefault();
      deleteForm.setAttribute('hidden', 'hidden');
      passwordInput.value = '';
    });
    deleteActions.appendChild(deleteCancel);

    var deleteConfirm = document.createElement('button');
    deleteConfirm.type = 'submit';
    deleteConfirm.className = 'account-card-delete-confirm';
    deleteConfirm.textContent = '삭제';
    deleteActions.appendChild(deleteConfirm);

    deleteForm.appendChild(deleteActions);
    body.appendChild(deleteForm);
    card.appendChild(body);

    deleteToggle.addEventListener('click', function (event) {
      event.preventDefault();
      if (deleteForm.hasAttribute('hidden')) {
        deleteForm.removeAttribute('hidden');
        passwordInput.focus();
      } else {
        deleteForm.setAttribute('hidden', 'hidden');
        passwordInput.value = '';
      }
    });

    deleteForm.addEventListener('submit', function (event) {
      event.preventDefault();
      handleAccountDelete(account.username, passwordInput.value, deleteConfirm, deleteForm);
    });

    return card;
  }

  function openOverlay() {
    if (!overlayState.elements) return;
    overlayState.open = true;
    overlayState.elements.container.removeAttribute('hidden');
    document.body.classList.add('account-manager-open');
    if (overlayState.elements.closeButton) {
      overlayState.elements.closeButton.focus();
    }
    renderOverlay();
  }

  function closeOverlay() {
    if (!overlayState.open || !overlayState.elements) return;
    overlayState.open = false;
    overlayState.elements.container.setAttribute('hidden', 'hidden');
    document.body.classList.remove('account-manager-open');
  }

  function setOverlayFeedback(message, type) {
    if (!overlayState.elements) return;
    var feedback = overlayState.elements.feedback;
    if (!feedback) return;
    if (!message) {
      feedback.textContent = '';
      feedback.setAttribute('hidden', 'hidden');
      feedback.setAttribute('data-type', '');
      return;
    }
    feedback.textContent = message;
    feedback.setAttribute('data-type', type || 'info');
    feedback.removeAttribute('hidden');
  }

  async function ensureToken() {
    if (state.token) return state.token;
    try {
      if (window.ensureAuthToken) {
        state.token = await window.ensureAuthToken();
      } else {
        state.token = localStorage.getItem('token');
      }
    } catch (error) {
      state.token = localStorage.getItem('token');
    }
    return state.token;
  }

  async function fetchCurrentUser() {
    var token = await ensureToken();
    if (!token) {
      state.user = null;
      return null;
    }
    try {
      var response = await fetch('/api/auth/me', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
        credentials: 'same-origin'
      });
      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('token');
          state.token = null;
        }
        state.user = null;
        return null;
      }
      state.user = await response.json();
      return state.user;
    } catch (error) {
      state.user = null;
      return null;
    }
  }

  async function authFetch(url, options) {
    var token = await ensureToken();
    if (!token) {
      throw new Error('인증이 필요합니다.');
    }
    var init = options ? Object.assign({}, options) : {};
    var headers = new Headers(init.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    init.headers = headers;
    if (!init.credentials) {
      init.credentials = 'same-origin';
    }
    return fetch(url, init);
  }

  async function refreshState(force) {
    try {
      await fetchCurrentUser();
      if (!state.user) {
        state.accounts = [];
        state.error = '';
        state.loading = false;
        state.lastFetched = 0;
        renderAccountSection();
        if (overlayState.open) {
          renderOverlay();
        }
        return;
      }

      ensureManageAction();
      var shouldFetch = force || !state.lastFetched || (Date.now() - state.lastFetched) > REFRESH_INTERVAL || !state.accounts.length;
      if (!shouldFetch) {
        renderAccountSection();
        if (overlayState.open) renderOverlay();
        return;
      }

      state.loading = true;
      renderAccountSection();

      var response = await authFetch('/api/users/accounts', { method: 'GET' });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var message = data && data.error ? data.error : '계정 정보를 불러오지 못했습니다.';
        throw new Error(message);
      }
      state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      state.error = '';
      state.lastFetched = Date.now();
    } catch (error) {
      state.accounts = [];
      state.error = error && error.message ? error.message : '계정 정보를 불러오지 못했습니다.';
    } finally {
      state.loading = false;
      renderAccountSection();
      if (overlayState.open) {
        renderOverlay();
      }
    }
  }

  async function handleAccountSwitch(username) {
    if (!username) return;
    try {
      setOverlayFeedback('계정을 전환하는 중입니다...', 'info');
      var response = await authFetch('/api/users/accounts/' + encodeURIComponent(username) + '/switch', {
        method: 'POST'
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || !data.token) {
        var message = data && data.error ? data.error : '계정 전환에 실패했습니다.';
        setOverlayFeedback(message, 'error');
        alert(message);
        return;
      }
      localStorage.setItem('token', data.token);
      state.token = data.token;
      closeOverlay();
      window.location.reload();
    } catch (error) {
      var msg = error && error.message ? error.message : '계정 전환 중 오류가 발생했습니다.';
      setOverlayFeedback(msg, 'error');
      alert(msg);
    }
  }

  async function handleAccountDelete(username, password, submitButton, form) {
    if (!username) return;
    if (!password) {
      setOverlayFeedback('비밀번호를 입력해주세요.', 'error');
      return;
    }
    if (submitButton) submitButton.disabled = true;
    try {
      setOverlayFeedback('계정을 삭제하는 중입니다...', 'info');
      var response = await authFetch('/api/users/accounts/' + encodeURIComponent(username), {
        method: 'DELETE',
        body: JSON.stringify({ password: password }),
        headers: { 'Content-Type': 'application/json' }
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var message = data && data.error ? data.error : '계정을 삭제할 수 없습니다.';
        setOverlayFeedback(message, 'error');
        return;
      }
      setOverlayFeedback(data.message || '계정이 삭제되었습니다.', 'success');
      if (form) {
        form.setAttribute('hidden', 'hidden');
        var pwd = form.querySelector('input[type="password"]');
        if (pwd) pwd.value = '';
      }
      if (data.deletedCurrent) {
        localStorage.removeItem('token');
        state.token = null;
        state.user = null;
        closeOverlay();
        window.location.href = '/login.html';
        return;
      }
      await refreshState(true);
    } catch (error) {
      setOverlayFeedback('계정 삭제 중 오류가 발생했습니다.', 'error');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function handleAccountEmail(username, emailValue, button) {
    if (!username) return;
    var normalized = (typeof emailValue === 'string') ? emailValue.trim() : '';
    if (button) button.disabled = true;
    try {
      setOverlayFeedback('이메일을 저장하는 중입니다...', 'info');
      var response = await authFetch('/api/users/accounts/' + encodeURIComponent(username) + '/email', {
        method: 'POST',
        body: JSON.stringify({ email: normalized }),
        headers: { 'Content-Type': 'application/json' }
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var message = data && data.error ? data.error : '이메일을 저장할 수 없습니다.';
        setOverlayFeedback(message, 'error');
        return;
      }
      setOverlayFeedback(data.message || '이메일이 저장되었습니다.', 'success');
      await refreshState(true);
    } catch (error) {
      setOverlayFeedback('이메일 저장 중 오류가 발생했습니다.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
