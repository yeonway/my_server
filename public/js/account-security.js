/*
 * 간단한 계정 보안 페이지 예시 스크립트
 * - 최근 로그인 기록 조회
 * - 데이터 다운로드 요청
 * - 계정 비활성화/삭제 요청
 */

async function apiRequest(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
  }
  return response.headers.get('content-type')?.includes('application/json')
    ? response.json()
    : response.text();
}

async function loadLoginHistory() {
  try {
    const container = document.querySelector('#login-history');
    if (!container) return;
    container.textContent = '불러오는 중...';
    const data = await apiRequest('/api/account/security/logins');
    if (!data.items || !data.items.length) {
      container.textContent = '로그인 기록이 없습니다.';
      return;
    }
    const rows = data.items
      .map((item) => {
        const location = item.location || {};
        const place = [location.country, location.city].filter(Boolean).join(' / ') || '위치 정보 없음';
        return `\n- ${new Date(item.createdAt).toLocaleString()} · ${item.ipAddress} · ${place}` +
          (item.suspicious ? ' ⚠️ 의심되는 로그인' : '');
      })
      .join('');
    container.textContent = rows.trim();
  } catch (error) {
    console.error(error);
    const container = document.querySelector('#login-history');
    if (container) container.textContent = error.message;
  }
}

async function requestDataExport(format = 'json') {
  try {
    const result = await apiRequest(`/api/account/export?format=${format}`);
    if (typeof result === 'string') {
      const blob = new Blob([result], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `account-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'account-export.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    alert(error.message);
  }
}

async function deactivateAccount() {
  const password = prompt('비활성화를 위해 현재 비밀번호를 입력하세요.');
  if (!password) return;
  try {
    await apiRequest('/api/account/deactivate', { method: 'POST', body: { password } });
    alert('계정이 비활성화되었습니다. 다시 로그인하려면 복구해야 합니다.');
  } catch (error) {
    alert(error.message);
  }
}

async function scheduleDeletion() {
  const password = prompt('삭제 예약을 위해 현재 비밀번호를 입력하세요.');
  if (!password) return;
  try {
    const result = await apiRequest('/api/account', { method: 'DELETE', body: { password } });
    alert(`계정 삭제가 예약되었습니다. 예정일: ${new Date(result.scheduledFor).toLocaleString()}`);
  } catch (error) {
    alert(error.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadLoginHistory();
  const exportJsonBtn = document.querySelector('#export-json');
  const exportCsvBtn = document.querySelector('#export-csv');
  const deactivateBtn = document.querySelector('#deactivate-account');
  const deleteBtn = document.querySelector('#delete-account');

  exportJsonBtn?.addEventListener('click', () => requestDataExport('json'));
  exportCsvBtn?.addEventListener('click', () => requestDataExport('csv'));
  deactivateBtn?.addEventListener('click', deactivateAccount);
  deleteBtn?.addEventListener('click', scheduleDeletion);
});
