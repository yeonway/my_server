(() => {
  const CONTAINER_ID = 'profile-menu-floating';

  document.addEventListener('DOMContentLoaded', async () => {
    if (!document.body) return;
    if (document.getElementById(CONTAINER_ID)) return;

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'profile-menu-floating';
    container.innerHTML = `
      <button class="profile-trigger" type="button" aria-haspopup="true" aria-expanded="false">
        <span class="profile-avatar" aria-hidden="true">U</span>
        <span class="profile-name">로그인</span>
        <span class="profile-caret" aria-hidden="true"></span>
      </button>
      <div class="profile-dropdown" role="menu">
        <ul class="profile-dropdown-list"></ul>
        <div class="profile-menu-divider" data-role="divider" style="display:none;"></div>
        <ul class="profile-dropdown-actions"></ul>
      </div>
    `;

    document.body.appendChild(container);

    const trigger = container.querySelector('.profile-trigger');
    const dropdown = container.querySelector('.profile-dropdown');
    const nameEl = container.querySelector('.profile-name');
    const avatarEl = container.querySelector('.profile-avatar');
    const listEl = container.querySelector('.profile-dropdown-list');
    const actionsEl = container.querySelector('.profile-dropdown-actions');
    const dividerEl = container.querySelector('[data-role="divider"]');

    const state = {
      token: null,
      user: null,
    };

    // 항상 최신 토큰을 확보해서 인증 요청
    async function resolveAuth() {
      try {
        state.token = await (window.ensureAuthToken ? window.ensureAuthToken() : localStorage.getItem('token'));
        if (!state.token) {
          state.user = null;
          return;
        }

        // 토큰이 있으면 사용자 정보 요청
        const res = await fetch('/api/auth/me', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${state.token}` },
          credentials: 'same-origin',
        });

        if (!res.ok) {
          if (res.status === 401) {
            // 토큰 만료/잘못됨
            localStorage.removeItem('token');
            state.token = null;
            state.user = null;
          }
          return;
        }

        state.user = await res.json();
      } catch (error) {
        console.warn('[profile-menu] 사용자 정보를 불러오지 못했습니다.', error);
        state.user = null;
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
        container.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    }

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleDropdown();
    });

    document.addEventListener('click', (event) => {
      if (!container.contains(event.target)) closeDropdown();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDropdown();
    });

    function clearMenu() {
      listEl.innerHTML = '';
      actionsEl.innerHTML = '';
      dividerEl.style.display = 'none';
    }

    function createLink(label, href) {
      const li = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = label;
      anchor.role = 'menuitem';
      li.appendChild(anchor);
      return li;
    }

    function createAction(label, handler) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        closeDropdown();
        await handler();
      });
      li.appendChild(button);
      return li;
    }

    // 로그아웃은 window.logout()을 무조건 활용
    async function handleLogout() {
      if (window.logout) {
        window.logout();
      } else {
        // Fallback (window.logout 없을 때)
        localStorage.removeItem('token');
        state.token = null;
        state.user = null;
        await resolveAuth();
        renderMenu();
        window.location.href = 'login.html';
      }
    }

    function renderMenu() {
      clearMenu();

      if (state.user) {
        const username = state.user.username || '사용자';
        nameEl.textContent = username;
        avatarEl.textContent = username.charAt(0).toUpperCase();

        const authenticatedLinks = [
          createLink('프로필', 'profile.html'),
          createLink('설정', 'setting.html'),
        ];

        if (
          ['admin', 'manager', 'superadmin'].includes(state.user.role) ||
          (Array.isArray(state.user.adminPermissions) && state.user.adminPermissions.length)
        ) {
          authenticatedLinks.push(createLink('관리자 페이지', 'admin.html'));
        }

        authenticatedLinks.forEach((node) => listEl.appendChild(node));

        dividerEl.style.display = 'block';
        actionsEl.appendChild(createAction('로그아웃', handleLogout));
      } else {
        nameEl.textContent = '로그인';
        avatarEl.textContent = 'L';
        listEl.appendChild(createLink('로그인', 'login.html'));
        listEl.appendChild(createLink('회원가입', 'signup.html'));
      }
    }

    await resolveAuth();
    renderMenu();

    // 토큰 만료 등으로 상태 변화시 재확인 & 재렌더링을 주기적으로(예: 2분) 체크할 수도 있음
    setInterval(async () => {
      await resolveAuth();
      renderMenu();
    }, 120000); // 2분마다 메뉴 최신화
  });
})();
