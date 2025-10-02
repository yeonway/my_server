let token = null;

const dashboardStatusEl = document.getElementById('dashboardStatus');
const dashboardLastUpdatedEl = document.getElementById('dashboardLastUpdated');
const dashboardRefreshBtn = document.getElementById('dashboardRefreshBtn');
const healthWindowLabel = document.getElementById('healthWindowLabel');
const healthMessageEl = document.getElementById('systemHealthMessage');
const healthTotalEl = document.getElementById('healthTotal');
const healthInfoEl = document.getElementById('healthInfo');
const healthWarnEl = document.getElementById('healthWarn');
const healthErrorsEl = document.getElementById('healthErrors');
const healthLatestErrorEl = document.getElementById('healthLatestError');
const healthLogSizeEl = document.getElementById('healthLogSize');
const healthLogLargestEl = document.getElementById('healthLogLargest');
const healthLoadEl = document.getElementById('healthLoad');
const healthMemoryEl = document.getElementById('healthMemory');
const healthUptimeEl = document.getElementById('healthUptime');
const pendingReportsListEl = document.getElementById('pendingReportsList');
const viewAllReportsBtn = document.getElementById('viewAllReportsBtn');
const permissionModal = document.getElementById('permissionModal');
const permissionModalUserEl = document.getElementById('permissionModalUser');
const permissionModalOptionsEl = document.getElementById('permissionModalOptions');
const permissionModalMessageEl = document.getElementById('permissionModalMessage');
const permissionModalToolbar = document.getElementById('permissionModalToolbar');
const permissionModalSaveBtn = document.getElementById('permissionModalSaveBtn');

let dashboardLoading = false;
const userCache = new Map();
let currentAdminInfo = null;
let userRoleFilterValue = 'all';
const permissionModalState = { userId: null, username: '', readOnly: false, loading: false };

async function fetchCurrentAdminProfile() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) {
      currentAdminInfo = null;
      return;
    }
    const data = await res.json();
    if (data) {
      if (data._id && !data.id) {
        data.id = String(data._id);
      }
      currentAdminInfo = data;
    } else {
      currentAdminInfo = null;
    }
  } catch (error) {
    console.warn('[admin] failed to fetch admin profile', error);
    currentAdminInfo = null;
  }
}

function isSuperAdmin() {
  return !!(currentAdminInfo && currentAdminInfo.role === 'superadmin');
}

document.addEventListener("DOMContentLoaded", async () => {
  if (window.requireAuthToken) {
    token = await window.requireAuthToken();
  } else if (window.ensureAuthToken) {
    token = await window.ensureAuthToken();
  } else {
    token = localStorage.getItem("token");
  }
  if (!token) {
    alert("관리자 로그인이 필요합니다.");
    window.location.href = "login.html";
    return;
  }

  await fetchCurrentAdminProfile();

  // 파일 선택 UI 이벤트 리스너
  const noticeFileInput = document.getElementById('noticeFiles');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  noticeFileInput.addEventListener('change', () => {
    if (noticeFileInput.files.length > 0) {
      if (noticeFileInput.files.length === 1) {
        fileNameDisplay.textContent = noticeFileInput.files[0].name;
      } else {
        fileNameDisplay.textContent = `${noticeFileInput.files.length}개의 파일 선택됨`;
      }
    } else {
      fileNameDisplay.textContent = '선택된 파일 없음';
    }
  });
  const reportFilter = document.getElementById('reportStatusFilter');
  if (reportFilter) {
    reportFilter.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        document.querySelectorAll('#reportStatusFilter .filter-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        loadReports(e.target.dataset.status);
      }
    });
  }
  const inquiryFilter = document.getElementById('inquiryStatusFilter');
  if (inquiryFilter) {
    inquiryFilter.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        document.querySelectorAll('#inquiryStatusFilter .filter-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        loadInquiries(e.target.dataset.status);
      }
    });
  }

  const userSortFieldSelect = document.getElementById('userSortField');
  if (userSortFieldSelect) {
    userSortFieldSelect.addEventListener('change', (e) => {
      userSortField = e.target.value;
      loadUsers(1);
    });
  }

  const userSortOrderBtn = document.getElementById('userSortOrderBtn');
  if (userSortOrderBtn) {
    userSortOrderBtn.addEventListener('click', () => {
      userSortOrder = userSortOrder === 'asc' ? 'desc' : 'asc';
      updateUserSortControls();
      loadUsers(1);
    });
  }

  updateUserSortControls();

  if (dashboardRefreshBtn) {
    dashboardRefreshBtn.addEventListener('click', () => loadDashboardData(true));
  }

  if (viewAllReportsBtn) {
    viewAllReportsBtn.addEventListener('click', () => {
      const reportsTabBtn = document.querySelector(".tab-button[onclick*='reports']");
      if (reportsTabBtn) {
        reportsTabBtn.click();
      }
    });
  }

});

function openTab(evt, tabName) {
  const tabContents = document.querySelectorAll(".tab-content");
  tabContents.forEach(tab => tab.classList.remove("active"));
  const tabButtons = document.querySelectorAll(".tab-button");
  tabButtons.forEach(btn => btn.classList.remove("active"));
  document.getElementById(tabName).classList.add("active");
  evt.currentTarget.classList.add("active");
  history.replaceState(null, null, '#' + tabName);

  if (tabName === 'dashboard') loadDashboardData();
  if (tabName === 'users') loadUsers();
  if (tabName === 'posts') loadPosts();
  if (tabName === 'reports') loadReports('pending');
  if (tabName === 'inquiries') loadInquiries('open');
  if (tabName === 'forbiddenWords') loadForbiddenWords();
  if (tabName === 'chatLogs') initChatLogs();
  if (tabName === 'logs') initLogs();
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function formatChatLogMessage(log) {
  const rawMessage = log && log.message ? String(log.message) : '';
  const type = log && log.type ? String(log.type).toLowerCase() : '';
  if (type === 'image' || type === 'file') {
    const cleaned = rawMessage.replace(/^\[(?:IMAGE|FILE)\]/i, '').trim();
    if (cleaned) {
      const safeUrl = escapeHtml(cleaned);
      return `<a href="${safeUrl}" target="_blank" rel="noopener">${safeUrl}</a>`;
    }
  }
  return escapeHtml(rawMessage);
}

function getSignupOrderLabel(order) {
  if (!order || order < 1) return '';
  return order + '\uBC88\uC9F8 \uACC4\uC815';
}

function renderSignupOwnerInfo(user) {
  if (!user || !user.signupOwner) return '';
  const ownerLabel = `${escapeHtml(user.signupOwner)}(${getSignupOrderLabel(1)})`;
  if (user.signupOrder && user.signupOrder > 1) {
    const orderLabel = getSignupOrderLabel(user.signupOrder);
    if (orderLabel) {
      return `${ownerLabel} (${orderLabel})`;
    }
  }
  return ownerLabel;
}



function getRoleLabel(role) {
  if (!role) return '\uC77C\uBC18 \uD68C\uC6D0';
  const option = ROLE_OPTIONS.find(opt => opt.value === role);
  if (option) return option.label;
  if (role === 'superadmin') return '\uC288\uD37C \uAD00\uB9AC\uC790';
  if (role === 'manager') return '\uB9E4\uB2C8\uC800';
  return role;
}

function formatAdminPermissions(perms) {
  if (!Array.isArray(perms) || perms.length === 0) return '';
  const labelMap = new Map(ADMIN_PERMISSION_OPTIONS.map(opt => [opt.key, opt.label]));
  const labels = perms.map(key => labelMap.get(key) || key);
  return labels.join(', ');
}


function escapeGroupSelector(value) {
  const stringValue = value === undefined || value === null ? '' : String(value);
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(stringValue);
  }
  return stringValue.replace(/[^a-zA-Z0-9_-]/g, '\$&');
}

function renderSubAccountTable(children) {
  if (!Array.isArray(children) || children.length === 0) {
    return '<div class="sub-account-empty">부계정이 없습니다.</div>';
  }
  const rows = children.map(child => {
    const username = escapeHtml(child && child.username ? child.username : '-');
    const orderLabel = child && child.signupOrder ? `${child.signupOrder}번째 계정` : '';
    const orderSpan = orderLabel ? `<span class="sub-order">${orderLabel}</span>` : '';
    const roleLabel = escapeHtml(getRoleLabel(child && child.role));
    const createdAt = child && child.createdAt ? new Date(child.createdAt).toLocaleString() : '-';
    const memoText = escapeHtml(child && child.memo ? child.memo : '메모 없음');
    const suspendedBadge = child && child.suspended ? '<span class="sub-account-badge suspended">정지</span>' : '';
    const userId = child && child._id ? String(child._id) : '';
    const permissionButton = (isSuperAdmin() && userId)
      ? `<button type="button" class="action-btn btn-secondary" onclick="openPermissionModal('${userId}')">권한</button>`
      : '';
    const deleteButton = userId
      ? `<button type="button" class="action-btn btn-delete" onclick="deleteUser('${userId}')">삭제</button>`
      : '';
    const actionButtons = [permissionButton, deleteButton].filter(Boolean).join(' ');
    return `
      <tr>
        <td>${username} ${orderSpan} ${suspendedBadge}</td>
        <td>${roleLabel}</td>
        <td>${createdAt}</td>
        <td>${memoText}</td>
        <td class="sub-account-actions">${actionButtons || '-'}</td>
      </tr>
    `;
  }).join('');
  return `
    <div class="sub-account-wrapper">
      <div class="sub-account-title">부계정 목록 (${children.length}개)</div>
      <table class="sub-account-table">
        <thead>
          <tr>
            <th>아이디</th>
            <th>권한</th>
            <th>가입일</th>
            <th>메모</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderUserGroupRows(tableBody, groupKey, groupUsers = []) {
  const sortedUsers = [...groupUsers].sort((a, b) => {
    const orderA = (a && typeof a.signupOrder === 'number') ? a.signupOrder : (a && a.signupOwner ? 99 : 1);
    const orderB = (b && typeof b.signupOrder === 'number') ? b.signupOrder : (b && b.signupOwner ? 99 : 1);
    if (orderA !== orderB) return orderA - orderB;
    const timeA = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });
  const ownerMatch = sortedUsers.find(user => user && user.username === groupKey);
  const mainUser = ownerMatch || sortedUsers.find(user => (user && user.signupOrder === 1)) || sortedUsers[0];
  const children = sortedUsers.filter(user => user && user !== mainUser);
  buildUserRow(tableBody, mainUser, children, groupKey);
  if (children.length) {
    buildUserGroupDetailRow(tableBody, groupKey, children);
  }
}

function buildUserRow(tableBody, mainUser = {}, children = [], groupKey = '') {
  const row = tableBody.insertRow();
  if (mainUser && mainUser.suspended) {
    row.classList.add('user-suspended-row');
  }
  row.dataset.group = groupKey;

  const userIdValue = mainUser && mainUser._id ? String(mainUser._id) : '';
  const usernameValue = mainUser && mainUser.username ? mainUser.username : '알 수 없음';
  const ownerLabel = mainUser && (mainUser.signupOwner || mainUser.username) ? (mainUser.signupOwner || mainUser.username) : '-';
  const memoValue = mainUser && mainUser.memo ? mainUser.memo : '메모 없음';
  const createdAtValue = mainUser && mainUser.createdAt ? new Date(mainUser.createdAt).toLocaleString() : '-';
  const roleLabel = getRoleLabel(mainUser && mainUser.role);
  const permissionSummary = formatAdminPermissions(mainUser && mainUser.adminPermissions);
  const sameBrowserCount = Number(mainUser && mainUser.sameBrowserCount ? mainUser.sameBrowserCount : (children.length ? children.length + 1 : 0));
  const sameBrowserOthers = Array.isArray(mainUser && mainUser.sameBrowserUsers)
    ? mainUser.sameBrowserUsers.filter(Boolean).filter(name => name !== usernameValue).slice(0, 5)
    : [];
  const sameIpCount = Number(mainUser && mainUser.sameIpCount ? mainUser.sameIpCount : 0);
  const sameIpOthers = Array.isArray(mainUser && mainUser.sameIpUsers)
    ? mainUser.sameIpUsers.filter(Boolean).filter(name => name !== usernameValue).slice(0, 5)
    : [];

  const idCell = row.insertCell();
  idCell.textContent = userIdValue;

  const nameCell = row.insertCell();
  const nameHeader = document.createElement('div');
  nameHeader.className = 'user-name-header';
  if (children.length) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'user-group-toggle';
    toggleBtn.dataset.group = groupKey;
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.innerHTML = `<span class="toggle-icon">▶</span><span class="toggle-label">부계 ${children.length}개</span>`;
    toggleBtn.addEventListener('click', () => toggleUserGroup(groupKey));
    nameHeader.appendChild(toggleBtn);
  }
  const nameWrap = document.createElement('div');
  nameWrap.className = 'user-name';
  nameWrap.textContent = usernameValue;
  nameHeader.appendChild(nameWrap);
  nameCell.appendChild(nameHeader);

  const badges = [];
  if (Array.isArray(mainUser && mainUser.adminPermissions) && mainUser.adminPermissions.length) {
    const adminBadge = document.createElement('span');
    adminBadge.className = 'user-badge badge-admin';
    adminBadge.textContent = '관리 권한';
    badges.push(adminBadge);
  }
  if (mainUser && mainUser.suspended) {
    const suspendedBadge = document.createElement('span');
    suspendedBadge.className = 'user-badge badge-suspended';
    suspendedBadge.textContent = '정지';
    badges.push(suspendedBadge);
  }
  if (badges.length) {
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'user-badges';
    badges.forEach(badge => badgeWrap.appendChild(badge));
    nameCell.appendChild(badgeWrap);
  }

  const ownerCell = row.insertCell();
  ownerCell.className = 'user-owner';
  const ownerMain = document.createElement('div');
  ownerMain.className = 'user-owner-main';
  if (children.length) {
    ownerMain.textContent = `${ownerLabel} · 총 ${children.length + 1}개`;
  } else {
    ownerMain.textContent = renderSignupOwnerInfo(mainUser) || ownerLabel || '-';
  }
  ownerCell.appendChild(ownerMain);

  const duplicateBadges = [];
  if (sameBrowserCount > 1) {
    const browserBadge = document.createElement('span');
    browserBadge.className = 'dup-badge dup-browser';
    browserBadge.textContent = `브라우저 ${sameBrowserCount}`;
    browserBadge.title = sameBrowserOthers.length
      ? `같은 브라우저: ${sameBrowserOthers.join(', ')}`
      : '같은 브라우저에서 생성된 다른 계정이 있습니다.';
    duplicateBadges.push(browserBadge);
  }
  if (sameIpCount > 1) {
    const ipBadge = document.createElement('span');
    ipBadge.className = 'dup-badge dup-ip';
    ipBadge.textContent = `IP ${sameIpCount}`;
    ipBadge.title = sameIpOthers.length
      ? `같은 IP: ${sameIpOthers.join(', ')}`
      : '같은 IP에서 생성된 다른 계정이 있습니다.';
    duplicateBadges.push(ipBadge);
  }
  if (duplicateBadges.length) {
    const dupWrap = document.createElement('div');
    dupWrap.className = 'user-duplicates';
    duplicateBadges.forEach(badge => dupWrap.appendChild(badge));
    ownerCell.appendChild(dupWrap);
    row.classList.add('user-duplicate-row');
  }

  const roleCell = row.insertCell();
  const roleWrap = document.createElement('div');
  roleWrap.textContent = roleLabel;
  roleCell.appendChild(roleWrap);
  if (permissionSummary) {
    const perm = document.createElement('div');
    perm.className = 'user-permissions';
    perm.textContent = permissionSummary;
    roleCell.appendChild(perm);
  }

  const memoCell = row.insertCell();
  memoCell.className = 'user-memo';
  memoCell.textContent = memoValue;
  memoCell.addEventListener('click', function () {
    editMemo(this, userIdValue);
  });

  const createdCell = row.insertCell();
  createdCell.textContent = createdAtValue;

  const actionsCell = row.insertCell();
  actionsCell.className = 'user-actions';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn btn-delete';
  deleteBtn.textContent = '삭제';
  deleteBtn.addEventListener('click', function () {
    deleteUser(userIdValue);
  });
  actionsCell.appendChild(deleteBtn);
}

function buildUserGroupDetailRow(tableBody, groupKey, children) {
  const detailRow = tableBody.insertRow();
  detailRow.className = 'user-sub-row';
  detailRow.dataset.group = groupKey;
  detailRow.style.display = 'none';
  const cell = detailRow.insertCell();
  cell.colSpan = 7;
  cell.innerHTML = renderSubAccountTable(children);
}

function toggleUserGroup(groupKey) {
  const selector = escapeGroupSelector(groupKey);
  const detailRow = document.querySelector(`tr.user-sub-row[data-group="${selector}"]`);
  const toggleBtn = document.querySelector(`button.user-group-toggle[data-group="${selector}"]`);
  if (!detailRow || !toggleBtn) return;
  const isHidden = detailRow.style.display === 'none' || detailRow.style.display === '';
  if (isHidden) {
    detailRow.style.display = 'table-row';
    toggleBtn.setAttribute('aria-expanded', 'true');
    const icon = toggleBtn.querySelector('.toggle-icon');
    if (icon) icon.textContent = '▼';
  } else {
    detailRow.style.display = 'none';
    toggleBtn.setAttribute('aria-expanded', 'false');
    const icon = toggleBtn.querySelector('.toggle-icon');
    if (icon) icon.textContent = '▶';
  }
}


async function loadUsers(page = 1) {
  const userList = document.getElementById('userList');
  if (!userList) return;

  const paginationContainer = document.getElementById('userPagination');
  if (paginationContainer) {
    paginationContainer.innerHTML = '';
  }

  const searchInput = document.getElementById('userSearchInput');
  const query = searchInput ? searchInput.value.trim() : '';

  const safePage = Math.max(1, Number(page) || 1);
  currentUserPage = safePage;
  updateUserSortControls();

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('limit', String(USERS_PER_PAGE));
  params.set('page', String(safePage));
  params.set('sort', userSortField);
  params.set('order', userSortOrder);
  if (userRoleFilterValue && userRoleFilterValue !== 'all') {
    params.set('role', userRoleFilterValue);
  }

  userList.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 18px; color:#6b7280;">사용자 목록을 불러오는 중입니다...</td></tr>';

  try {
    const res = await fetch('/api/admin/users?' + params.toString(), {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '사용자 목록을 불러오지 못했습니다.');
    }

    const users = Array.isArray(data && data.users) ? data.users : (Array.isArray(data) ? data : []);
    userCache.clear();
    users.forEach(user => {
      if (user && user._id) {
        userCache.set(String(user._id), user);
      }
    });
    const totalPages = Math.max(1, data && typeof data.totalPages === 'number' ? data.totalPages : 1);
    const currentPage = Math.min(data && typeof data.currentPage === 'number' ? data.currentPage : safePage, totalPages);
    currentUserPage = currentPage;

    const totalCount = data && typeof data.total === 'number' ? data.total : users.length;
    const meta = document.getElementById('userMeta');
    if (meta) {
      const parts = [`총 ${totalCount.toLocaleString()}명`];
      if (totalPages > 1) {
        parts.push(`${currentPage}/${totalPages} 페이지`);
      }
      meta.textContent = parts.join(' · ');
    }

    if (users.length === 0) {
      userList.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 18px; color:#6b7280;">표시할 사용자가 없습니다.</td></tr>';
      return;
    }

    userList.innerHTML = '';

    const groupMap = new Map();
    users.forEach(user => {
      const key = user && (user.signupOwner || user.username);
      if (!key) {
        const uniqueKey = user && user._id ? String(user._id) : Math.random().toString(36).slice(2);
        groupMap.set(uniqueKey, [user]);
        return;
      }
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key).push(user);
    });

    for (const [groupKey, groupUsers] of groupMap.entries()) {
      renderUserGroupRows(userList, groupKey, groupUsers);
    }

    renderPagination('userPagination', currentPage, totalPages, loadUsers);
  } catch (error) {
    console.error('[admin] loadUsers error', error);
    const message = escapeHtml(error.message || '사용자 목록을 불러오지 못했습니다.');
    userList.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 18px; color:#dc2626;">' + message + '</td></tr>';
    const meta = document.getElementById('userMeta');
    if (meta) {
      meta.textContent = '';
    }
    if (paginationContainer) {
      paginationContainer.innerHTML = '';
    }
  }
}


let currentPostPage = 1;
const ADMIN_PERMISSION_OPTIONS = [
  { key: 'user_management', label: '사용자 관리' },
  { key: 'post_management', label: '게시글 관리' },
  { key: 'report_management', label: '신고 처리' },
  { key: 'inquiry_management', label: '문의 처리' },
  { key: 'content_management', label: '콘텐츠 관리' },
  { key: 'log_view', label: '로그 조회' }
];

const ROLE_OPTIONS = [
  { value: 'user', label: '일반 회원' },
  { value: 'admin', label: '관리자' }
];

let currentUserPage = 1;
let userSortField = 'createdAt';
let userSortOrder = 'desc';
const USERS_PER_PAGE = 20;

function updateUserSortControls() {
  const fieldSelect = document.getElementById('userSortField');
  if (fieldSelect && fieldSelect.value !== userSortField) {
    fieldSelect.value = userSortField;
  }
  const orderBtn = document.getElementById('userSortOrderBtn');
  if (orderBtn) {
    orderBtn.dataset.order = userSortOrder;
    orderBtn.textContent = userSortOrder === 'asc' ? '오름차순' : '내림차순';
  }
}

// --- 대시보드 데이터 ---
async function loadDashboardData(force = false) {
  if (dashboardLoading && !force) {
    return;
  }
  dashboardLoading = true;
  if (dashboardRefreshBtn) {
    dashboardRefreshBtn.disabled = true;
  }
  setDashboardStatus('대시보드 데이터를 불러오는 중입니다...', 'info');

  try {
    const statsRes = await fetch('/api/admin/dashboard-stats', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const statsData = await statsRes.json().catch(() => null);
    if (!statsRes.ok || !statsData) {
      const errMsg = (statsData && statsData.error) || `대시보드 데이터를 불러오는 데 실패했습니다. (${statsRes.status})`;
      throw new Error(errMsg);
    }

    applyDashboardStats(statsData);

    let reports = [];
    let reportsError = null;
    try {
      const reportsRes = await fetch('/api/admin/reports?status=pending', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const reportsData = await reportsRes.json().catch(() => null);
      if (!reportsRes.ok || !Array.isArray(reportsData)) {
        const errMsg = (reportsData && reportsData.error) || `신고 데이터를 불러오는 데 실패했습니다. (${reportsRes.status})`;
        throw new Error(errMsg);
      }
      reports = reportsData;
    } catch (error) {
      reportsError = error;
    }

    const pendingReportsLabel = document.getElementById('pendingReports');
    if (pendingReportsLabel) {
      pendingReportsLabel.textContent = reportsError ? '-' : formatNumber(reports.length);
    }
    renderPendingReports(reports, reportsError);

    await refreshSystemHealth();

    setDashboardStatus('');
    if (dashboardLastUpdatedEl) {
      const stamp = new Date();
      dashboardLastUpdatedEl.textContent = `마지막 업데이트: ${stamp.toLocaleString()}`;
      dashboardLastUpdatedEl.dataset.timestamp = stamp.toISOString();
    }
  } catch (err) {
    console.error(err);
    setDashboardStatus(err.message || '대시보드 데이터를 불러오는 데 실패했습니다.', 'error');
  } finally {
    dashboardLoading = false;
    if (dashboardRefreshBtn) {
      dashboardRefreshBtn.disabled = false;
    }
  }
}

// --- 게시글 목록 ---
async function loadPosts(page = 1) {
  const postList = document.getElementById('postList');
  if (!postList) return;

  const searchInput = document.getElementById('postSearchInput');
  const searchTerm = searchInput ? searchInput.value.trim() : '';

  try {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (searchTerm) {
      params.set('search', searchTerm);
    }

    const res = await fetch(`/api/admin/posts?${params.toString()}`, {
      headers: { "Authorization": "Bearer " + token }
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '게시글 목록을 불러오지 못했습니다.');
    }

    postList.innerHTML = '';
    const posts = Array.isArray(data.posts) ? data.posts : [];

    if (posts.length === 0) {
      const emptyRow = postList.insertRow();
      emptyRow.innerHTML = `<td colspan="6" style="text-align:center; padding: 20px;">표시할 게시글이 없습니다.</td>`;
      currentPostPage = data.currentPage || 1;
      ensurePostPagination(currentPostPage, data.totalPages || 1);
      return;
    }

    posts.forEach(post => {
      const row = postList.insertRow();
      if (post.isNotice) row.classList.add('notice-row'); // 공지글이면 row에 클래스 추가
      const createdAt = post.createdAt ? new Date(post.createdAt).toLocaleString() : '-';
      const authorName = post.authorDisplay || (post.author && post.author.username) || '알 수 없음';
      const author = escapeHtml(authorName);
      const statusLabel = post.deleted ? '삭제됨' : '정상';
      const noticeLabel = post.isNotice ? '<span class="notice-badge">공지</span>' : '-';

      const actionButtons = [
        `<button class="action-btn btn-view" onclick="viewPost('${post._id}')">보기</button>`
      ];

      if (post.deleted) {
        actionButtons.push(`<button class="action-btn btn-resolve" onclick="restorePost('${post._id}')">복구</button>`);
      } else {
        const noticeButtonClass = post.isNotice ? 'btn-notice-unset' : 'btn-notice-set';
        actionButtons.push(`<button class="action-btn ${noticeButtonClass}" onclick="toggleNotice('${post._id}')">${post.isNotice ? '공지 해제' : '공지 지정'}</button>`);
        actionButtons.push(`<button class="action-btn btn-delete" onclick="deletePost('${post._id}')">삭제</button>`);
      }

      row.innerHTML = `
        <td class="${post.isNotice ? 'notice-title' : ''}">${post.isNotice ? '<strong>[공지]</strong> ' : ''}${escapeHtml(post.title || '(제목 없음)')}</td>
        <td>${author}</td>
        <td>${createdAt}</td>
        <td>${statusLabel}</td>
        <td>${noticeLabel}</td>
        <td class="post-actions">${actionButtons.join(' ')}</td>
      `;
    });

    currentPostPage = data.currentPage || page;
    ensurePostPagination(currentPostPage, data.totalPages || 1);
  } catch (err) {
    alert(err.message || '게시글 목록을 불러오지 못했습니다.');
  }
}

function ensurePostPagination(currentPage, totalPages) {
  let container = document.getElementById('postPagination');
  if (!container) {
    const postsCard = document.querySelector('#posts .card');
    container = document.createElement('div');
    container.id = 'postPagination';
    container.className = 'pagination';
    if (postsCard) {
      postsCard.appendChild(container);
    }
  }

  if (typeof renderPagination === 'function') {
    renderPagination('postPagination', currentPage || 1, totalPages || 1, loadPosts);
  }
}

function applyDashboardStats(stats) {
  if (!stats) return;
  const totalUsersEl = document.getElementById('totalUsers');
  if (totalUsersEl) totalUsersEl.textContent = formatNumber(stats.totalUsers);
  const todayNewUsersEl = document.getElementById('todayNewUsers');
  if (todayNewUsersEl) todayNewUsersEl.textContent = formatDelta(stats.todayNewUsers) + ' 오늘';
  const totalPostsEl = document.getElementById('totalPosts');
  if (totalPostsEl) totalPostsEl.textContent = formatNumber(stats.totalPosts);
  const todayPostsEl = document.getElementById('todayPosts');
  if (todayPostsEl) todayPostsEl.textContent = formatDelta(stats.todayPosts) + ' 오늘';
  const totalCommentsEl = document.getElementById('totalComments');
  if (totalCommentsEl) totalCommentsEl.textContent = formatNumber(stats.totalComments);
  const todayCommentsEl = document.getElementById('todayComments');
  if (todayCommentsEl) todayCommentsEl.textContent = formatDelta(stats.todayComments) + ' 오늘';

  if (stats.activityData && Array.isArray(stats.activityData.labels) && Array.isArray(stats.activityData.posts)) {
    renderActivityChart(stats.activityData.labels, stats.activityData.posts);
  } else {
    renderActivityChart([], []);
  }
}

async function refreshSystemHealth() {
  if (!healthMessageEl && !healthTotalEl) return;
  try {
    const res = await fetch('/api/admin/system-health', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const errMsg = (data && data.error) || '시스템 상태를 불러오는 데 실패했습니다. (' + res.status + ')';
      throw new Error(errMsg);
    }
    updateHealthCard(data);
  } catch (error) {
    updateHealthCard(null, error.message || '시스템 상태를 불러오는 데 실패했습니다.');
  }
}

function renderPendingReports(reports, error) {
  if (!pendingReportsListEl) return;
  pendingReportsListEl.innerHTML = '';

  if (error) {
    const item = document.createElement('li');
    item.className = 'empty error';
    item.textContent = error.message || String(error);
    pendingReportsListEl.appendChild(item);
    return;
  }

  if (!Array.isArray(reports) || reports.length === 0) {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = '처리할 신고가 없습니다.';
    pendingReportsListEl.appendChild(item);
    return;
  }

  reports.slice(0, 5).forEach((report) => {
    const item = document.createElement('li');

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = truncateText(formatReportDescription(report));

    const meta = document.createElement('div');
    meta.className = 'meta';
    const reporter = (report && report.reporter && report.reporter.username) || '익명';
    const createdAt = report && report.createdAt ? new Date(report.createdAt).toLocaleString() : '-';
    meta.textContent = reporter + ' · ' + createdAt;

    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(info);

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = formatReportType(report && report.contentType);
    item.appendChild(tag);

    pendingReportsListEl.appendChild(item);
  });
}

function setDashboardStatus(message = '', type = 'info') {
  if (!dashboardStatusEl) return;
  dashboardStatusEl.textContent = message || '';
  dashboardStatusEl.classList.remove('error', 'info');
  if (message) {
    dashboardStatusEl.classList.add(type === 'error' ? 'error' : 'info');
  }
}

function updateHealthCard(data, errorMessage) {
  if (healthMessageEl) {
    if (errorMessage) {
      healthMessageEl.textContent = errorMessage;
      healthMessageEl.classList.add('error');
    } else {
      healthMessageEl.textContent = '';
      healthMessageEl.classList.remove('error');
    }
  }

  if (!data || errorMessage) {
    if (healthWindowLabel) healthWindowLabel.textContent = '';
    if (healthTotalEl) healthTotalEl.textContent = '-';
    if (healthInfoEl) healthInfoEl.textContent = '-';
    if (healthWarnEl) healthWarnEl.textContent = '-';
    if (healthErrorsEl) healthErrorsEl.textContent = '-';
    if (healthLogSizeEl) healthLogSizeEl.textContent = '-';
    if (healthLogLargestEl) healthLogLargestEl.textContent = '-';
    if (healthLoadEl) healthLoadEl.textContent = '-';
    if (healthMemoryEl) healthMemoryEl.textContent = '-';
    if (healthUptimeEl) healthUptimeEl.textContent = '-';
    if (healthLatestErrorEl) {
      healthLatestErrorEl.textContent = errorMessage ? '' : '최근 24시간 오류가 없습니다.';
      healthLatestErrorEl.classList.add('empty');
    }
    return;
  }

  const summary = data.logSummary || {};
  if (healthWindowLabel) {
    const hours = summary.windowHours || 24;
    healthWindowLabel.textContent = '최근 ' + hours + '시간 기준';
  }
  if (healthTotalEl) healthTotalEl.textContent = formatNumber(summary.total);
  if (healthInfoEl) healthInfoEl.textContent = formatNumber(summary.info);
  if (healthWarnEl) healthWarnEl.textContent = formatNumber(summary.warn);
  if (healthErrorsEl) healthErrorsEl.textContent = formatNumber(summary.error);

  if (healthLatestErrorEl) {
    const latestError = summary.latestError;
    if (latestError && latestError.message) {
      const timestamp = latestError.timestamp ? new Date(latestError.timestamp).toLocaleString() : '';
      let text = timestamp ? timestamp + ' - ' : '';
      if (latestError.file) {
        text += '[' + latestError.file + '] ';
      }
      text += latestError.message;
      healthLatestErrorEl.textContent = text;
      healthLatestErrorEl.classList.remove('empty');
    } else {
      healthLatestErrorEl.textContent = '최근 24시간 오류가 없습니다.';
      healthLatestErrorEl.classList.add('empty');
    }
  }

  const logs = data.logs || {};
  if (healthLogSizeEl) healthLogSizeEl.textContent = Number.isFinite(logs.totalMB) ? formatNumber(logs.totalMB, 2) + ' MB' : '-';
  if (healthLogLargestEl) {
    if (logs.largestFile && logs.largestFile.name) {
      healthLogLargestEl.textContent = logs.largestFile.name + ' (' + formatNumber(logs.largestFile.sizeMB, 2) + ' MB)';
    } else {
      healthLogLargestEl.textContent = '-';
    }
  }

  const system = data.system || {};
  if (healthUptimeEl) healthUptimeEl.textContent = formatDuration(system.uptimeSeconds);
  if (healthLoadEl) {
    const loads = Array.isArray(system.loadAverage) && system.loadAverage.length
      ? system.loadAverage.map((value) => Number(value).toFixed(2)).join(', ')
      : '-';
    healthLoadEl.textContent = loads;
  }
  if (healthMemoryEl) {
    const memory = system.memory || {};
    if (Number.isFinite(memory.usedMB) && Number.isFinite(memory.totalMB)) {
      healthMemoryEl.textContent = formatNumber(memory.usedMB, 2) + ' MB / ' + formatNumber(memory.totalMB, 2) + ' MB';
    } else {
      healthMemoryEl.textContent = '-';
    }
  }
}

function formatNumber(value, fractionDigits = 0) {
  if (!Number.isFinite(value)) return '-';
  if (fractionDigits > 0) {
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    });
  }
  return Number(value).toLocaleString();
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return '+0';
  const sign = value >= 0 ? '+' : '';
  return sign + Number(value).toLocaleString();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const parts = [];
  const days = Math.floor(seconds / 86400);
  if (days) parts.push(days + '일');
  const hours = Math.floor((seconds % 86400) / 3600);
  if (hours) parts.push(hours + '시간');
  const minutes = Math.floor((seconds % 3600) / 60);
  if (minutes) parts.push(minutes + '분');
  if (parts.length === 0) return '1분 미만';
  return parts.join(' ');
}

function truncateText(text, maxLength = 80) {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
}

function formatReportDescription(report) {
  if (!report) return '신고';
  if (typeof report.reason === 'string' && report.reason.trim()) return report.reason;
  if (report.content) {
    if (typeof report.content.title === 'string' && report.content.title.trim()) return report.content.title;
    if (typeof report.content.content === 'string' && report.content.content.trim()) return report.content.content;
    if (typeof report.content.message === 'string' && report.content.message.trim()) return report.content.message;
  }
  return formatReportType(report && report.contentType) + ' 신고';
}

function formatReportType(type) {
  switch (type) {
    case 'post':
      return '게시글';
    case 'comment':
      return '댓글';
    case 'chat':
      return '채팅';
    default:
      return '기타';
  }
}

function viewPost(postId) {
  if (!postId) return;
  window.open(`/board.html?id=${postId}`, '_blank');
}
async function loadReports(status = 'pending') {
  try {
    const res = await fetch(`/api/admin/reports?status=${status}`, { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) throw new Error('신고 목록 로드 실패');
    const reports = await res.json();
    const reportList = document.getElementById("reportList");
    reportList.innerHTML = "";
    if (reports.length === 0) {
      reportList.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">해당 상태의 신고 내역이 없습니다.</td></tr>`;
      return;
    }
    reports.forEach(report => {
      let contentHtml = '<span style="color:#999;">콘텐츠 없음</span>';
      if (report.content) {
        if (report.contentType === 'post') {
          contentHtml = `
            <div class="report-content-preview">
              <strong>게시글:</strong> ${report.content.title}<br>
              <a href="/board.html?id=${report.content._id}" target="_blank">게시글로 이동 &rarr;</a>
            </div>`;
        } else if (report.contentType === 'comment' && report.parentPostId) {
          contentHtml = `
            <div class="report-content-preview">
              <strong>댓글:</strong> ${report.content.content}<br>
              <a href="/board.html?id=${report.parentPostId}" target="_blank">게시글로 이동 &rarr;</a>
            </div>`;
        } else if (report.contentType === 'chat') {
          contentHtml = `
            <div class="report-content-preview">
              <strong>채팅:</strong> ${report.content.message}<br>
              <small>(채팅방: ${report.content.room})</small>
            </div>`;
        }
      }
      let actionHtml = '';
      if (report.status === 'pending') {
        actionHtml = `
          <button class="action-btn btn-resolve" onclick="handleReport('${report._id}', 'resolved')">해결</button>
          <button class="action-btn btn-dismiss" onclick="handleReport('${report._id}', 'dismissed')">기각</button>
        `;
      } else {
        actionHtml = `<span>${report.status === 'resolved' ? '해결됨' : '기각됨'}</span>`;
      }
      const row = reportList.insertRow();
      row.innerHTML = `
        <td>${new Date(report.createdAt).toLocaleString()}</td>
        <td>${report.reporter?.username || '알수없음'}</td>
        <td>${report.contentOwner?.username || '알수없음'}</td>
        <td>${contentHtml}</td>
        <td class="report-reason" title="${report.reason}">${report.reason}</td>
        <td>${actionHtml}</td>
      `;
    });
  } catch (err) {
    alert("신고 목록을 불러오는 데 실패했습니다.");
  }
}

// --- 문의 목록 ---
async function loadInquiries(status = 'open') {
  try {
    const res = await fetch(`/api/admin/inquiries?status=${status}`, { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) throw new Error('문의 목록 로드 실패');
    const inquiries = await res.json();
    const inquiryList = document.getElementById("inquiryList");
    inquiryList.innerHTML = "";
    if (inquiries.length === 0) {
      inquiryList.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">해당 상태의 문의 내역이 없습니다.</td></tr>`;
      return;
    }
    const inquiryTypeMap = {
      'account': '계정 관련',
      'bug_report': '오류 신고',
      'suggestion': '개선 제안',
      'content_report': '콘텐츠 신고',
      'other': '기타'
    };
    inquiries.forEach(inquiry => {
      const actionBtn = inquiry.status === 'open'
        ? `<button class="action-btn btn-resolve" onclick="handleInquiry('${inquiry._id}')">처리 완료</button>`
        : `<span>처리됨</span>`;
      const attachmentLink = inquiry.attachment
        ? `<a href="/api/admin/inquiries/download/${inquiry._id}" class="attachment-link" target="_blank">파일 보기</a>`
        : '<span>없음</span>';
      const row = inquiryList.insertRow();
      row.innerHTML = `
        <td>${new Date(inquiry.createdAt).toLocaleString()}</td>
        <td>${inquiry.user?.username || '알수없음'}</td>
        <td>${inquiryTypeMap[inquiry.inquiryType] || inquiry.inquiryType}</td>
        <td>
          <strong>${inquiry.title}</strong>
          <div class="inquiry-content">${inquiry.content}</div>
        </td>
        <td>
          ${actionBtn}
          <div style="margin-top: 5px;"><strong>첨부:</strong> ${attachmentLink}</div>
        </td>
      `;
    });
  } catch (err) {
    alert("문의 목록을 불러오는 데 실패했습니다.");
  }
}

// --- 금지어 목록 + 페이지네이션 ---
async function loadForbiddenWords(page = 1) {
  try {
    const res = await fetch(`/api/admin/forbidden-words?page=${page}`, { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) throw new Error('금지어 목록을 불러오는 데 실패했습니다.');
    const data = await res.json();
    const wordList = document.getElementById("forbiddenWordList");
    wordList.innerHTML = "";
    data.words.forEach(word => {
      const row = wordList.insertRow();
      row.innerHTML = `
        <td><strong>${word.word}</strong></td>
        <td>${word.addedBy || '알 수 없음'}</td>
        <td>${new Date(word.createdAt).toLocaleString()}</td>
        <td><button class="action-btn btn-delete" onclick="deleteForbiddenWord('${word._id}', ${data.currentPage})">삭제</button></td>
      `;
    });
    renderPagination('forbiddenWordPagination', data.currentPage, data.totalPages, loadForbiddenWords);
  } catch (err) {
    document.getElementById("forbiddenWordList").innerHTML = `<tr><td colspan="4" style="color:red;">${err.message}</td></tr>`;
  }
}

// --- 시스템 로그 ---
let allLogs = [];
const LOGS_PER_PAGE = 30;
let currentLogPage = 1;
const logFileSelect = document.getElementById('logFileSelect');
const logLevelFilter = document.getElementById('logLevelFilter');
const logSearchInput = document.getElementById('logSearchInput');
let allChatLogs = [];
const chatLogFileSelect = document.getElementById('chatLogFileSelect');
const chatLogSearchInput = document.getElementById('chatLogSearchInput');
const chatLogRoomFilter = document.getElementById('chatLogRoomFilter');
const chatLogUserFilter = document.getElementById('chatLogUserFilter');
const chatLogTypeFilter = document.getElementById('chatLogTypeFilter');
const chatLogList = document.getElementById('chatLogList');
async function initLogs() {
  try {
    const res = await fetch("/api/admin/log-files", { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) throw new Error('로그 파일 목록 로드 실패');
    const files = await res.json();
    logFileSelect.innerHTML = '';
    if (files.length > 0) {
      files.forEach(file => {
        const option = new Option(file, file);
        logFileSelect.add(option);
      });
      loadLogs(files[0]);
    } else {
      logFileSelect.innerHTML = '<option>로그 파일 없음</option>';
      const logList = document.getElementById("logList");
      if (logList) {
        logList.innerHTML = `<tr><td colspan="3" style="text-align:center;">표시할 로그가 없습니다.</td></tr>`;
      }
      const pagination = document.getElementById('systemLogPagination');
      if (pagination) pagination.innerHTML = '';
    }
  } catch (err) {
    alert(err.message);
  }
}
async function loadLogs(fileName) {
  if (!fileName) return;
  try {
    const res = await fetch(`/api/admin/logs?file=${fileName}`, { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) throw new Error('로그 로드 실패');
    const data = await res.json();
    allLogs = data.logs;
    renderLogs(1);
  } catch (err) {
    const logList = document.getElementById("logList");
    if (logList) {
      logList.innerHTML = `<tr><td colspan="3" style="text-align:center; color:red;">로그를 불러오는 데 실패했습니다.</td></tr>`;
    }
    const pagination = document.getElementById('systemLogPagination');
    if (pagination) pagination.innerHTML = '';
  }
}
function renderLogs(page = 1) {
  const levelButton = logLevelFilter.querySelector('.active');
  const level = levelButton ? levelButton.dataset.level : 'all';
  const query = logSearchInput.value.toLowerCase();
  const filteredLogs = allLogs.filter(log => {
    const levelMatch = (level === 'all' || log.level === level);
    const queryMatch = (!query || (log.message && log.message.toLowerCase().includes(query)));
    return levelMatch && queryMatch;
  });
  const logList = document.getElementById("logList");
  if (!logList) return;
  const pagination = document.getElementById('systemLogPagination');
  logList.innerHTML = "";
  if (filteredLogs.length === 0) {
    logList.innerHTML = `<tr><td colspan="3" style="text-align:center;">필터 조건에 맞는 로그가 없습니다.</td></tr>`;
    if (pagination) pagination.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  currentLogPage = safePage;
  const startIndex = (safePage - 1) * LOGS_PER_PAGE;
  const pageLogs = filteredLogs.slice(startIndex, startIndex + LOGS_PER_PAGE);
  pageLogs.forEach(log => {
    const row = logList.insertRow();
    const safeLevel = escapeHtml(log.level || '');
    const safeMessage = escapeHtml(log.message || '');
    row.innerHTML = `
      <td>${new Date(log.timestamp).toLocaleString()}</td>
      <td><span class="log-level ${safeLevel}">${safeLevel}</span></td>
      <td class="log-message">${safeMessage}</td>
    `;
  });
  if (pagination) {
    renderPagination('systemLogPagination', safePage, totalPages, renderLogs);
  }
}

logFileSelect.addEventListener('change', (e) => loadLogs(e.target.value));
logLevelFilter.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') {
    logLevelFilter.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    renderLogs(1);
  }
});
logSearchInput.addEventListener('input', () => renderLogs(1));

// ... (생략)

async function initChatLogs() {
  if (!chatLogFileSelect || !chatLogList) {
    return;
  }
  chatLogList.innerHTML = '<tr><td colspan="6">채팅 로그를 불러오는 중...</td></tr>';
  try {
    const res = await fetch('/api/admin/chat-log-files', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json().catch(() => []);
    if (!res.ok) {
      const message = (data && data.error) || '채팅 로그 파일을 불러오지 못했습니다.';
      throw new Error(message);
    }
    const files = Array.isArray(data) ? data : [];
    chatLogFileSelect.innerHTML = '';
    if (files.length === 0) {
      chatLogFileSelect.innerHTML = '<option value="">채팅 로그 파일이 없습니다.</option>';
      chatLogList.innerHTML = '<tr><td colspan="6" style="text-align:center;">채팅 로그 파일이 없습니다.</td></tr>';
      allChatLogs = [];
      return;
    }
    files.forEach(file => {
      const option = new Option(file, file);
      chatLogFileSelect.add(option);
    });
    const firstFile = chatLogFileSelect.value || files[0];
    await loadChatLogs(firstFile);
  } catch (error) {
    allChatLogs = [];
    chatLogFileSelect.innerHTML = '<option value="">채팅 로그 파일이 없습니다.</option>';
    chatLogList.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">${escapeHtml(error.message || '채팅 로그 파일을 불러오지 못했습니다.')}</td></tr>`;
  }
}

async function loadChatLogs(fileName) {
  if (!chatLogList) {
    return;
  }
  if (!fileName) {
    chatLogList.innerHTML = '<tr><td colspan="6" style="text-align:center;">채팅 로그 파일이 없습니다.</td></tr>';
    allChatLogs = [];
    return;
  }
  chatLogList.innerHTML = '<tr><td colspan="6">채팅 로그를 불러오는 중...</td></tr>';
  try {
    const res = await fetch(`/api/admin/chat-logs?file=${encodeURIComponent(fileName)}`, { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '채팅 로그를 불러오지 못했습니다.');
    }
    allChatLogs = Array.isArray(data.entries) ? data.entries : [];
    renderChatLogs();
  } catch (error) {
    allChatLogs = [];
    chatLogList.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">${escapeHtml(error.message || '채팅 로그를 불러오지 못했습니다.')}</td></tr>`;
  }
}

function renderChatLogs() {
  if (!chatLogList) {
    return;
  }
  const searchValue = chatLogSearchInput ? chatLogSearchInput.value.trim().toLowerCase() : '';
  const roomValue = chatLogRoomFilter ? chatLogRoomFilter.value.trim().toLowerCase() : '';
  const userValue = chatLogUserFilter ? chatLogUserFilter.value.trim().toLowerCase() : '';
  const typeValue = chatLogTypeFilter ? chatLogTypeFilter.value.toLowerCase() : 'all';

  const filtered = allChatLogs.filter(log => {
    const message = (log.message || '').toLowerCase();
    const room = (log.room || '').toLowerCase();
    const sender = (log.from || '').toLowerCase();
    const type = (log.type || '').toLowerCase();
    const channel = (log.channel || '').toLowerCase();

    const matchesSearch = !searchValue || message.includes(searchValue) || room.includes(searchValue) || sender.includes(searchValue) || channel.includes(searchValue);
    const matchesRoom = !roomValue || room.includes(roomValue);
    const matchesUser = !userValue || sender.includes(userValue);
    const matchesType = typeValue === 'all' || type === typeValue;

    return matchesSearch && matchesRoom && matchesUser && matchesType;
  });

  chatLogList.innerHTML = '';
  if (filtered.length === 0) {
    chatLogList.innerHTML = '<tr><td colspan="6" style="text-align:center;">필터 조건에 맞는 채팅 로그가 없습니다.</td></tr>';
    return;
  }

  filtered.forEach(log => {
    const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : '-';
    const row = chatLogList.insertRow();
    row.innerHTML = `
      <td>${time}</td>
      <td>${escapeHtml(log.channel || '-')}</td>
      <td>${escapeHtml(log.room || '-')}</td>
      <td>${escapeHtml(log.from || '-')}</td>
      <td>${escapeHtml((log.type || '-').toString())}</td>
      <td class="log-message">${formatChatLogMessage(log)}</td>
    `;
  });
}

if (chatLogFileSelect) {
  chatLogFileSelect.addEventListener('change', (e) => loadChatLogs(e.target.value));
}
if (chatLogSearchInput) {
  chatLogSearchInput.addEventListener('input', renderChatLogs);
}
if (chatLogRoomFilter) {
  chatLogRoomFilter.addEventListener('input', renderChatLogs);
}
if (chatLogUserFilter) {
  chatLogUserFilter.addEventListener('input', renderChatLogs);
}
if (chatLogTypeFilter) {
  chatLogTypeFilter.addEventListener('change', renderChatLogs);
}



// --- 사용자 로그 모달 ---
const userLogModal = document.getElementById('userLogModal');
const USER_LOGS_PER_PAGE = 30;
let currentUserLogs = [];
let currentUserLogPage = 1;
function searchUserLogs() {
  const identifier = document.getElementById('userLogSearchInput').value.trim();
  if (!identifier) {
    alert('사용자 ID 또는 이름을 입력해주세요.');
    return;
  }
  showUserLogs(identifier);
}
async function showUserLogs(identifier) {
  document.getElementById('userLogModalTitle').textContent = `'${identifier}' 사용자 로그`;
  const logList = document.getElementById('userLogList');
  const pagination = document.getElementById('userLogPagination');
  logList.innerHTML = '<tr><td colspan="3">로그를 불러오는 중...</td></tr>';
  if (pagination) pagination.innerHTML = '';
  currentUserLogs = [];
  currentUserLogPage = 1;
  userLogModal.classList.add('show');
  try {
    const res = await fetch(`/api/admin/user-logs/${identifier}`, { headers: { "Authorization": "Bearer " + token } });
    if (!res.ok) throw new Error((await res.json()).error || '로그를 가져오지 못했습니다.');
    const logs = await res.json();
    currentUserLogs = Array.isArray(logs) ? logs : [];
    if (currentUserLogs.length === 0) {
      logList.innerHTML = '<tr><td colspan="3">표시할 로그가 없습니다.</td></tr>';
      if (pagination) pagination.innerHTML = '';
      return;
    }
    renderUserLogs(1);
  } catch (err) {
    currentUserLogs = [];
    logList.innerHTML = `<tr><td colspan="3" style="color:red;">${err.message || '로그를 불러오는 중 오류가 발생했습니다.'}</td></tr>`;
    if (pagination) pagination.innerHTML = '';
  }
}

function renderUserLogs(page = 1) {
  const logList = document.getElementById('userLogList');
  const pagination = document.getElementById('userLogPagination');
  if (!logList) return;
  if (!Array.isArray(currentUserLogs) || currentUserLogs.length === 0) {
    logList.innerHTML = '<tr><td colspan="3">표시할 로그가 없습니다.</td></tr>';
    if (pagination) pagination.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(currentUserLogs.length / USER_LOGS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  currentUserLogPage = safePage;
  const startIndex = (safePage - 1) * USER_LOGS_PER_PAGE;
  const pageLogs = currentUserLogs.slice(startIndex, startIndex + USER_LOGS_PER_PAGE);
  logList.innerHTML = '';
  pageLogs.forEach(log => {
    const row = logList.insertRow();
    const safeLevel = escapeHtml(log.level || '');
    const safeMessage = escapeHtml(log.message || '');
    row.innerHTML = `
      <td>${new Date(log.timestamp).toLocaleString()}</td>
      <td><span class="log-level ${safeLevel}">${safeLevel}</span></td>
      <td class="log-message">${safeMessage}</td>
    `;
  });
  if (pagination) {
    renderPagination('userLogPagination', safePage, totalPages, renderUserLogs);
  }
}
function closeUserLogModal() {
  userLogModal.classList.remove('show');
}

// --- 공지 작성 모달 ---
const noticeModal = document.getElementById('noticeModal');
function openNoticeModal() {
  document.getElementById('noticeTitle').value = '';
  document.getElementById('noticeContent').value = '';
  document.getElementById('noticeFiles').value = '';
  document.getElementById('fileNameDisplay').textContent = '선택된 파일 없음';
  noticeModal.classList.add('show');
}
function closeNoticeModal() {
  noticeModal.classList.remove('show');
}
async function createNotice() {
  const title = document.getElementById('noticeTitle').value.trim();
  const content = document.getElementById('noticeContent').value.trim();
  const files = document.getElementById('noticeFiles').files;
  if (!title || !content) {
    alert('제목과 내용을 모두 입력해주세요.');
    return;
  }
  const formData = new FormData();
  formData.append('title', title);
  formData.append('content', content);
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  try {
    const res = await fetch('/api/admin/posts/notice', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    alert('공지사항이 등록되었습니다.');
    closeNoticeModal();
    loadPosts();
  } catch (err) {
    alert(err.message || "공지 작성에 실패했습니다.");
  }
}

// --- 페이지네이션 ---
function renderPagination(containerId, currentPage, totalPages, loadFunction) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (totalPages <= 1) return;
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '이전';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => loadFunction(currentPage - 1);
  container.appendChild(prevBtn);
  const pageRange = 2;
  let startPage = Math.max(1, currentPage - pageRange);
  let endPage = Math.min(totalPages, currentPage + pageRange);
  if (startPage > 1) {
    const firstBtn = document.createElement('button');
    firstBtn.textContent = '1';
    firstBtn.onclick = () => loadFunction(1);
    container.appendChild(firstBtn);
    if (startPage > 2) container.insertAdjacentHTML('beforeend', `<span>...</span>`);
  }
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.textContent = i;
    if (i === currentPage) pageBtn.classList.add('active');
    pageBtn.onclick = () => loadFunction(i);
    container.appendChild(pageBtn);
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) container.insertAdjacentHTML('beforeend', `<span>...</span>`);
    const lastBtn = document.createElement('button');
    lastBtn.textContent = totalPages;
    lastBtn.onclick = () => loadFunction(totalPages);
    container.appendChild(lastBtn);
  }
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '다음';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => loadFunction(currentPage + 1);
  container.appendChild(nextBtn);
}

// --- 사용자 메모 수정 ---
function editMemo(cell, userId) {
  if (cell.querySelector('input')) return;
  const currentMemo = cell.textContent === '메모 없음' ? '' : cell.textContent;
  cell.innerHTML = `<input type="text" class="memo-input" value="${currentMemo}" onblur="saveMemo(this, '${userId}')" onkeypress="if(event.key==='Enter') this.blur()">`;
  cell.querySelector('input').focus();
}
async function saveMemo(input, userId) {
  const newMemo = input.value.trim();
  const cell = input.parentElement;
  try {
    const res = await fetch(`/api/admin/users/${userId}/memo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ memo: newMemo })
    });
    if (!res.ok) throw new Error('메모 저장 실패');
    cell.textContent = newMemo || '메모 없음';
  } catch (err) {
    cell.textContent = cell.querySelector('input').defaultValue || '메모 없음';
  }
}

// --- 사용자 삭제 ---
async function deleteUser(userId) {
  if (!confirm("정말로 이 사용자를 삭제하시겠습니까?")) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + token }
    });
    if (!res.ok) throw new Error('삭제 실패');
    alert("사용자가 삭제되었습니다.");
    loadUsers(currentUserPage);
  } catch (err) {
    alert("사용자 삭제에 실패했습니다.");
  }
}

// --- 금지어 추가/삭제 ---
async function addForbiddenWord() {
  const input = document.getElementById('forbiddenWordInput');
  const word = input.value.trim();
  if (!word) {
    alert("추가할 금지어를 입력해주세요.");
    return;
  }
  try {
    const res = await fetch('/api/admin/forbidden-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ word })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    alert(`'${word}'가 금지어로 추가되었습니다.`);
    input.value = '';
    loadForbiddenWords(1);
  } catch (err) {
    alert(err.message || "금지어 추가에 실패했습니다.");
  }
}
async function deleteForbiddenWord(wordId, currentPage) {
  if (!confirm("정말로 이 금지어를 삭제하시겠습니까?")) return;
  try {
    const res = await fetch(`/api/admin/forbidden-words/${wordId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('삭제 실패');
    alert("금지어가 삭제되었습니다.");
    loadForbiddenWords(currentPage);
  } catch (err) {
    alert("금지어 삭제에 실패했습니다.");
  }
}

// --- 게시글 삭제/복구 ---
async function deletePost(postId) {
  if (!confirm("이 게시글을 삭제하시겠습니까? (soft delete)")) return;
  try {
    const res = await fetch(`/api/admin/posts/${postId}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + token }
    });
    if (!res.ok) throw new Error('삭제 실패');
    alert("게시글이 삭제 처리되었습니다.");
    loadPosts();
  } catch (err) {
    alert("게시글 삭제에 실패했습니다.");
  }
}
async function restorePost(postId) {
  if (!confirm("이 게시글을 복구하시겠습니까?")) return;
  try {
    const res = await fetch(`/api/admin/posts/restore/${postId}`, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token }
    });
    if (!res.ok) throw new Error('복구 실패');
    alert("게시글이 복구되었습니다.");
    loadPosts();
  } catch (err) {
    alert("게시글 복구에 실패했습니다.");
  }
}

// --- 공지 토글 ---
async function toggleNotice(postId) {
  try {
    const res = await fetch(`/api/admin/posts/toggle-notice/${postId}`, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token }
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    alert(result.message);
    loadPosts();
  } catch (err) {
    alert(err.message || "상태 변경에 실패했습니다.");
  }
}

// --- 신고/문의 처리 ---
async function handleReport(reportId, action) {
  const actionText = action === 'resolved' ? '해결' : '기각';
  if (!confirm(`이 신고를 '${actionText}' 처리하시겠습니까?`)) return;
  try {
    const res = await fetch(`/api/admin/reports/${reportId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ action })
    });
    if (!res.ok) throw new Error('처리 실패');
    alert("신고가 처리되었습니다.");
    const activeStatus = document.querySelector('#reportStatusFilter .filter-btn.active').dataset.status;
    loadReports(activeStatus);
    loadDashboardData();
  } catch (err) {
    alert("신고 처리에 실패했습니다.");
  }
}
async function handleInquiry(inquiryId) {
  if (!confirm("이 문의를 '처리 완료' 상태로 변경하시겠습니까?")) return;
  try {
    const res = await fetch(`/api/admin/inquiries/${inquiryId}/resolve`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + token }
    });
    if (!res.ok) throw new Error('처리 실패');
    alert("문의가 처리되었습니다.");
    const activeStatus = document.querySelector('#inquiryStatusFilter .filter-btn.active').dataset.status;
    loadInquiries(activeStatus);
  } catch (err) {
    alert("문의 처리에 실패했습니다.");
  }
}

// --- 관리자 알림 ---
function showAdminAlert(msg, ms=5000) {
  const alertBox = document.getElementById('admin-alert');
  document.getElementById('admin-alert-msg').textContent = msg;
  alertBox.style.display = 'block';
  alertBox.style.opacity = '1';
  if (ms > 0) {
    setTimeout(() => { hideAdminAlert(); }, ms);
  }
}
function hideAdminAlert() {
  const alertBox = document.getElementById('admin-alert');
  alertBox.style.opacity = '0';
  setTimeout(() => { alertBox.style.display = 'none'; }, 300);
}

// --- 활동 차트 ---
function renderActivityChart(labels, data) {
  if (window.activityChart && typeof window.activityChart.destroy === 'function') {
    window.activityChart.destroy();
  }
  const ctx = document.getElementById('activityChart').getContext('2d');
  window.activityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '활동량',
        data: data,
        borderColor: '#007bff',
        backgroundColor: 'rgba(0,123,255,0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { display: true },
        y: { display: true, beginAtZero: true }
      }
    }
  });
}





