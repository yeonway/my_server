// public/js/auth-helper.js
(() => {
  let resolvingPromise = null;

  // JWT 만료 여부 체크 함수
  function isTokenExpired(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.exp) return false;
      // exp: 초 단위, 1분 미리 만료 처리
      return (Date.now() / 1000) > (payload.exp - 60);
    } catch (e) {
      return false;
    }
  }

  // refresh API로 토큰 갱신
  async function requestSessionToken(oldToken) {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': oldToken ? 'Bearer ' + oldToken : undefined
        },
        credentials: 'same-origin',
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.token) {
        localStorage.setItem('token', data.token);
        return data.token;
      }
      // refresh 실패 시 기존 토큰 삭제
      localStorage.removeItem('token');
      return null;
    } catch (error) {
      console.warn('[auth-helper] refresh failed', error);
      localStorage.removeItem('token');
      return null;
    }
  }

  async function ensureAuthToken() {
    let token = localStorage.getItem('token');
    if (!token) return null;
    if (!isTokenExpired(token)) return token;
    // 만료면 refresh
    token = await requestSessionToken(token);
    return token;
  }

  window.ensureAuthToken = ensureAuthToken;
  window.requireAuthToken = async function requireAuthToken() {
    if (!resolvingPromise) {
      resolvingPromise = ensureAuthToken().finally(() => {
        resolvingPromise = null;
      });
    }
    return resolvingPromise;
  };

  // 로그아웃 헬퍼 추가
  window.logout = function () {
    localStorage.removeItem('token');
    fetch('/api/users/logout', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      }
    }).finally(() => {
      window.location.href = '/login.html';
    });
  };
})();