(() => {
  const CONTAINER_ID = 'profile-menu-floating';

  document.addEventListener('DOMContentLoaded', async () => {
    if (!document.body) return;
    if (document.getElementById(CONTAINER_ID)) return;

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'profile-menu-floating';
    container.innerHTML = [
      '<button class="profile-trigger" type="button" aria-haspopup="true" aria-expanded="false">',
      '  <span class="profile-avatar" aria-hidden="true">U</span>',
      '  <span class="profile-name">로그인</span>',
      '  <span class="profile-caret" aria-hidden="true"></span>',
      '</button>',
      '<div class="profile-dropdown" role="menu">',
      '  <div class="profile-account-section" data-role="account-section" style="display:none;">',
      '    <div class="profile-account-header">',
      '      <span class="profile-account-title">내 계정</span>',
      '      <button type="button" class="profile-account-manage" data-action="manage">관리</button>',
      '    </div>',
      '    <div class="profile-account-loading" hidden>계정 정보를 불러오는 중...</div>',
      '    <ul class="profile-account-list"></ul>',
      '    <div class="profile-account-empty" hidden>등록된 계정이 없습니다.</div>',
      '  </div>',
      '  <ul class="profile-dropdown-list"></ul>',
      '  <div class="profile-menu-divider" data-role="divider" style="display:none;"></div>',
      '  <ul class="profile-dropdown-actions"></ul>',
      '</div>'
    ].join('
');

    document.body.appendChild(container);

    const accountOverlay = document.createElement('div');
    accountOverlay.className = 'account-manager-overlay';
    accountOverlay.setAttribute('hidden', 'hidden');
    accountOverlay.innerHTML = [
      '<div class="account-manager-backdrop" data-action="close"></div>',
      '<div class="account-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="account-manager-title">',
      '  <header class="account-manager-header">',
      '    <h2 id="account-manager-title">계정 관리</h2>',
      '    <button type="button" class="account-manager-close" data-action="close" aria-label="닫기">&times;</button>',
      '  </header>',
      '  <div class="account-manager-body">',
      '    <div class="account-manager-feedback" data-role="feedback" hidden></div>',
      '    <div class="account-manager-list" data-role="manager-list"></div>',
      '    <div class="account-manager-empty" data-role="manager-empty" hidden>등록된 계정이 없습니다.</div>',
      '  </div>',
      '</div>'
    ].join('
');
    document.body.appendChild(accountOverlay);


    const trigger = container.querySelector('.profile-trigger');
    const dropdown = container.querySelector('.profile-dropdown');
    const nameEl = container.querySelector('.profile-name');
    const avatarEl = container.querySelector('.profile-avatar');
    const listEl = container.querySelector('.profile-dropdown-list');
    const actionsEl = container.querySelector('.profile-dropdown-actions');
    const dividerEl = container.querySelector('[data-role="divider"]');

    const accountSection = container.querySelector('[data-role="account-section"]');
    const accountListEl = accountSection.querySelector('.profile-account-list');
    const accountManageBtn = accountSection.querySelector('[data-action="manage"]');
    const accountLoadingEl = accountSection.querySelector('.profile-account-loading');
    const accountEmptyEl = accountSection.querySelector('.profile-account-empty');

    const accountFeedbackEl = accountOverlay.querySelector('[data-role="feedback"]');
    const accountManagerListEl = accountOverlay.querySelector('[data-role="manager-list"]');
    const accountManagerEmptyEl = accountOverlay.querySelector('[data-role="manager-empty"]');
    const accountCloseButtons = accountOverlay.querySelectorAll('[data-action="close"]');

    const state = {
      token: null,
      user: null
    };

    const accountState = {
      owner: null,
      accounts: [],
      loading: false,
      loaded: false,
      error: '',
      open: false,
      promise: null
    };

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

    async function authFetch(url, options = {}) {
      const token = await ensureToken();
      const init = { ...options };
      const headers = new Headers(init.headers || {});
      if (token) {
        headers.set('Authorization', );
      }
      if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      init.headers = headers;
      if (!init.credentials) {
        init.credentials = 'same-origin';
      }
      return fetch(url, init);
    }

    function setAccountFeedback(message, type = 'info') {
      if (!accountFeedbackEl) return;
      if (!message) {
        accountFeedbackEl.textContent = '';
        accountFeedbackEl.setAttribute('hidden', 'hidden');
        accountFeedbackEl.dataset.type = '';
        return;
      }
      accountFeedbackEl.textContent = message;
      accountFeedbackEl.dataset.type = type;
      accountFeedbackEl.removeAttribute('hidden');
    }

    function resetAccountState() {
      accountState.owner = null;
      accountState.accounts = [];
      accountState.loading = false;
      accountState.loaded = false;
      accountState.error = '';
      accountState.promise = null;
      renderAccountSection();
      if (accountState.open) {
        renderAccountManager();
      }
    }

    async function loadAccounts(force = false) {
      if (!state.user) {
        resetAccountState();
        return [];
      }

      if (!force && accountState.loaded && !accountState.error) {
        return accountState.accounts;
      }

      if (!force && accountState.loading && accountState.promise) {
        return accountState.promise;
      }

      accountState.loading = true;
      accountState.promise = (async () => {
        try {
          if (accountLoadingEl) accountLoadingEl.hidden = false;
          const response = await authFetch('/api/users/accounts');
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = data && data.error ? data.error : '계정 정보를 불러오지 못했습니다.';
            throw new Error(message);
          }
          accountState.owner = data.owner || null;
          accountState.accounts = Array.isArray(data.accounts) ? data.accounts : [];
          accountState.loaded = true;
          accountState.error = '';
        } catch (error) {
          accountState.accounts = [];
          accountState.loaded = false;
          accountState.error = error.message || '계정 정보를 불러오지 못했습니다.';
        } finally {
          accountState.loading = false;
          accountState.promise = null;
          renderAccountSection();
          if (accountState.open) {
            renderAccountManager();
          }
        }
        return accountState.accounts;
      })();

      return accountState.promise;
    }

    function renderAccountSection() {
      if (!accountSection) return;
      if (!state.user) {
        accountSection.style.display = 'none';
        return;
      }

      accountSection.style.display = 'block';

      if (accountState.loading && !accountState.loaded) {
        if (accountLoadingEl) accountLoadingEl.hidden = false;
        if (accountEmptyEl) accountEmptyEl.hidden = true;
        if (accountListEl) accountListEl.innerHTML = '';
        return;
      }

      if (accountLoadingEl) accountLoadingEl.hidden = true;

      if (accountState.error) {
        if (accountEmptyEl) {
          accountEmptyEl.textContent = accountState.error;
          accountEmptyEl.hidden = false;
        }
        if (accountListEl) accountListEl.innerHTML = '';
        return;
      }

      const accounts = accountState.accounts || [];
      if (!accounts.length) {
        if (accountEmptyEl) {
          accountEmptyEl.textContent = '등록된 계정이 없습니다.';
          accountEmptyEl.hidden = false;
        }
        if (accountListEl) accountListEl.innerHTML = '';
        return;
      }

      if (accountEmptyEl) accountEmptyEl.hidden = true;
      if (!accountListEl) return;

      accountListEl.innerHTML = '';
      const visible = accounts.slice(0, 4);
      visible.forEach((account) => {
        const item = document.createElement('li');
        item.className = 'profile-account-item';

        const name = document.createElement('span');
        name.className = 'profile-account-name';
        name.textContent = account.username;
        item.appendChild(name);

        if (account.isCurrent) {
          const badge = document.createElement('span');
          badge.className = 'profile-account-badge';
          badge.textContent = '현재';
          item.appendChild(badge);
        } else if (!account.suspended) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'profile-account-switch';
          button.textContent = '전환';
          button.addEventListener('click', (event) => {
            event.preventDefault();
            handleAccountSwitch(account.username);
          });
          item.appendChild(button);
        } else {
          const badge = document.createElement('span');
          badge.className = 'profile-account-badge is-blocked';
          badge.textContent = '정지됨';
          item.appendChild(badge);
        }

        accountListEl.appendChild(item);
      });

      if (accounts.length > visible.length) {
        const more = document.createElement('li');
        more.className = 'profile-account-item profile-account-more';
        more.textContent = ;
        accountListEl.appendChild(more);
      }
    }

    function renderAccountManager() {
      if (!accountState.open) return;
      if (!accountManagerListEl) return;

      if (accountState.loading && !accountState.loaded) {
        setAccountFeedback('계정 정보를 불러오는 중입니다...', 'info');
        accountManagerListEl.innerHTML = '<div class="account-manager-status">로딩 중...</div>';
        if (accountManagerEmptyEl) accountManagerEmptyEl.setAttribute('hidden', 'hidden');
        return;
      }

      if (accountState.error) {
        setAccountFeedback(accountState.error, 'error');
        accountManagerListEl.innerHTML = '';
        if (accountManagerEmptyEl) {
          accountManagerEmptyEl.textContent = accountState.error;
          accountManagerEmptyEl.removeAttribute('hidden');
        }
        return;
      }

      setAccountFeedback('', 'info');
      const accounts = accountState.accounts || [];
      if (!accounts.length) {
        accountManagerListEl.innerHTML = '';
        if (accountManagerEmptyEl) {
          accountManagerEmptyEl.textContent = '등록된 계정이 없습니다.';
          accountManagerEmptyEl.removeAttribute('hidden');
        }
        return;
      }

      if (accountManagerEmptyEl) accountManagerEmptyEl.setAttribute('hidden', 'hidden');
      accountManagerListEl.innerHTML = '';
      accounts.forEach((account) => {
        accountManagerListEl.appendChild(buildAccountCard(account));
      });
    }
    await resolveAuth();
    renderMenu();
    renderAccountSection();
    if (state.user) {
      loadAccounts().catch(() => {});
    }

    setInterval(async () => {
      await resolveAuth();
      renderMenu();
      if (state.user) {
        loadAccounts().catch(() => {});
      }
    }, 120000);
  });
})();
