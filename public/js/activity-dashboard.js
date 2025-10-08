(function () {
  const filterForm = document.getElementById('dashboardFilterForm');
  const rangePreset = document.getElementById('rangePreset');
  const customRangeFields = document.querySelectorAll('[data-custom-range]');
  const metricValueElements = document.querySelectorAll('[data-metric-value]');
  const metricTrendElements = document.querySelectorAll('[data-metric-trend]');
  const unreadBadge = document.querySelector('[data-unread-count]');
  const unreadList = document.querySelector('[data-unread-list]');
  const unreadMessageBadge = document.querySelector('[data-unread-message-count]');
  const unreadMessageList = document.querySelector('[data-unread-message-list]');
  const activityTableBody = document.querySelector('[data-activity-table]');

  let token = null;
  let chartInstance = null;

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('[activity-dashboard] 초기화 실패', error);
    });
  });

  async function init() {
    token = await resolveToken();
    if (!token) {
      window.location.href = '/login.html';
      return;
    }

    setupPresetToggle();
    filterForm?.addEventListener('submit', onFilterSubmit);
    await refreshDashboard();
  }

  function setupPresetToggle() {
    if (!rangePreset) return;
    rangePreset.addEventListener('change', () => {
      if (rangePreset.value === 'custom') {
        customRangeFields.forEach((field) => field.removeAttribute('hidden'));
        const today = new Date();
        const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
        document.getElementById('startDate').value = toInputDate(start);
        document.getElementById('endDate').value = toInputDate(today);
      } else {
        customRangeFields.forEach((field) => field.setAttribute('hidden', ''));
      }
    });
  }

  async function onFilterSubmit(event) {
    event.preventDefault();
    await refreshDashboard();
  }

  async function refreshDashboard() {
    try {
      const params = buildQueryParams();
      const response = await fetch(`/api/dashboard/me${params}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }

      if (!response.ok) {
        throw new Error(`대시보드 데이터를 가져오지 못했습니다: ${response.status}`);
      }

      const data = await response.json();
      updateMetrics(data);
      updatePending(data?.pending);
      updateActivities(data?.recentActivities);
      updateChart(data?.dailyBreakdown);
    } catch (error) {
      console.error('[activity-dashboard] 데이터를 불러오지 못했습니다', error);
    }
  }

  function buildQueryParams() {
    const params = new URLSearchParams();
    const preset = rangePreset?.value || '30';

    if (preset !== 'custom') {
      const days = Number(preset);
      if (!Number.isNaN(days)) {
        const end = new Date();
        const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
        params.append('startDate', start.toISOString());
        params.append('endDate', end.toISOString());
      }
      return `?${params.toString()}`;
    }

    const startInput = document.getElementById('startDate')?.value;
    const endInput = document.getElementById('endDate')?.value;
    if (startInput) params.append('startDate', new Date(startInput).toISOString());
    if (endInput) params.append('endDate', new Date(endInput).toISOString());
    return params.toString() ? `?${params.toString()}` : '';
  }

  function updateMetrics(data) {
    if (!data?.metrics) return;
    const metrics = data.metrics;
    const dayCount = Math.max(data.dailyBreakdown?.length || 0, 1);

    metricValueElements.forEach((element) => {
      const key = element.dataset.metricValue;
      const value = metrics[key] || 0;
      element.textContent = value.toLocaleString('ko-KR');
    });

    metricTrendElements.forEach((element) => {
      const key = element.dataset.metricTrend;
      const value = metrics[key] || 0;
      const average = value / dayCount;
      element.textContent = `일 평균 ${average.toFixed(1)}`;
    });
  }

  function updatePending(pending) {
    if (!pending) return;

    const unreadNotifications = pending.unreadNotificationItems || [];
    if (unreadBadge) unreadBadge.textContent = pending.unreadNotifications || 0;
    updateCardList(unreadList, unreadNotifications, (item) => ({
      title: item.message || '알림 내용 없음',
      description: item.createdAt ? formatDateTime(item.createdAt) : '시간 정보 없음',
      href: item.link || '#',
    }));

    const unreadMessages = pending.unreadMessageItems || [];
    if (unreadMessageBadge) unreadMessageBadge.textContent = pending.unreadMessages || 0;
    updateCardList(unreadMessageList, unreadMessages, (item) => ({
      title: item.message || '새 메시지를 확인해 보세요.',
      description: item.createdAt ? formatDateTime(item.createdAt) : '시간 정보 없음',
      href: item.link || '/chat.html',
    }));
  }

  function updateCardList(listElement, items, mapper) {
    if (!listElement) return;
    listElement.innerHTML = '';

    if (!items.length) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'card-list-item empty-state';
      emptyLi.textContent = '새로운 항목이 없습니다.';
      listElement.appendChild(emptyLi);
      return;
    }

    items.slice(0, 5).forEach((item) => {
      const { title, description, href } = mapper(item);
      const link = document.createElement('a');
      link.className = 'card-list-item';
      link.href = href || '#';
      link.innerHTML = `
        <div class="card-list-item-top">
          <span class="card-list-item-title">${escapeHtml(title)}</span>
        </div>
        <p class="card-list-item-meta">${escapeHtml(description)}</p>
      `;
      listElement.appendChild(link);
    });
  }

  function updateActivities(activities) {
    if (!activityTableBody) return;
    activityTableBody.innerHTML = '';

    if (!activities || activities.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'empty-state';
      cell.textContent = '표시할 활동이 없습니다.';
      row.appendChild(cell);
      activityTableBody.appendChild(row);
      return;
    }

    activities.slice(0, 20).forEach((activity) => {
      const row = document.createElement('tr');
      const typeCell = document.createElement('td');
      typeCell.textContent = resolveActivityLabel(activity.type);
      const contentCell = document.createElement('td');
      contentCell.textContent = summarizeActivity(activity);
      const timeCell = document.createElement('td');
      timeCell.textContent = formatDateTime(activity.time);
      row.appendChild(typeCell);
      row.appendChild(contentCell);
      row.appendChild(timeCell);
      activityTableBody.appendChild(row);
    });
  }

  function updateChart(dailyBreakdown) {
    if (!window.Chart) return;
    const canvas = document.getElementById('activityChart');
    if (!canvas) return;

    const labels = (dailyBreakdown || []).map((item) => item.date);
    const posts = (dailyBreakdown || []).map((item) => item.posts || 0);
    const comments = (dailyBreakdown || []).map((item) => item.comments || 0);
    const chats = (dailyBreakdown || []).map((item) => item.chats || 0);
    const mentions = (dailyBreakdown || []).map((item) => item.mentions || 0);
    const notifications = (dailyBreakdown || []).map((item) => item.notifications || 0);

    const context = canvas.getContext('2d');
    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(context, {
      type: 'line',
      data: {
        labels,
        datasets: [
          createDataset('게시글', posts, '#6366f1'),
          createDataset('댓글', comments, '#10b981'),
          createDataset('채팅', chats, '#f59e0b'),
          createDataset('멘션', mentions, '#ec4899'),
          createDataset('알림', notifications, '#0ea5e9'),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${context.parsed.y.toLocaleString('ko-KR')}`;
              },
            },
          },
        },
      },
    });
  }

  function createDataset(label, data, color) {
    return {
      label,
      data,
      fill: false,
      borderColor: color,
      backgroundColor: color,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 6,
    };
  }

  function resolveActivityLabel(type) {
    if (!type) return '기타';
    if (type.startsWith('notification:')) {
      const [, sub] = type.split(':');
      switch (sub) {
        case 'mention':
          return '멘션 알림';
        case 'dm':
          return 'DM 알림';
        case 'comment':
          return '댓글 알림';
        case 'group_invite':
          return '그룹 초대 알림';
        default:
          return '알림';
      }
    }
    switch (type) {
      case 'post':
        return '게시글 작성';
      case 'comment':
        return '댓글 작성';
      case 'chat':
        return '채팅 참여';
      default:
        return '활동';
    }
  }

  function summarizeActivity(activity) {
    if (!activity) return '';
    if (activity.type === 'post') {
      return activity.title || '제목 없는 게시글';
    }
    if (activity.type === 'comment' || activity.type === 'chat') {
      return shorten(activity.content || '', 60);
    }
    return shorten(activity.content || '', 60);
  }

  function shorten(text, limit) {
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1)}…`;
  }

  function formatDateTime(value) {
    if (!value) return '방금 전';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '방금 전';
    try {
      const datePart = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
      const timePart = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date);
      return `${datePart} ${timePart}`;
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function toInputDate(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function escapeHtml(text) {
    const safe = text == null ? '' : String(text);
    return safe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function resolveToken() {
    let stored = localStorage.getItem('token');
    if (stored) return stored;
    if (typeof window.ensureAuthToken === 'function') {
      try {
        stored = await window.ensureAuthToken();
        if (stored) {
          localStorage.setItem('token', stored);
          return stored;
        }
      } catch (error) {
        console.warn('[activity-dashboard] 토큰 확보 실패', error);
      }
    }
    return null;
  }
})();
