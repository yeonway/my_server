// public/js/dashboard.js
// 중학생용 대시보드 데이터를 불러오고 위젯을 갱신하는 스크립트

(function () {
  const noticesList = document.querySelector('[data-dashboard-notices]');
  const chatsList = document.querySelector('[data-dashboard-chats]');
  const scheduleDateEl = document.querySelector('[data-schedule-date]');

  document.addEventListener('DOMContentLoaded', () => {
    initDashboard().catch((error) => {
      console.error('[dashboard] 초기화 실패', error);
    });
  });

  /**
   * 대시보드 초기 설정: 토큰 확보 후 각 영역 데이터를 불러옵니다.
   */
  async function initDashboard() {
    let token = localStorage.getItem('token');

    // 기존 인증 유틸이 있다면 활용해 토큰을 확보한다.
    if (!token && typeof window.ensureAuthToken === 'function') {
      try {
        token = await window.ensureAuthToken();
      } catch (authError) {
        console.warn('[dashboard] 토큰 확보 실패', authError);
      }
    }

    if (!token) {
      // 토큰이 없다면 로그인 페이지로 돌려보낸다.
      window.location.href = '/login.html';
      return;
    }

    updateScheduleDate();
    await Promise.allSettled([
      loadNotices(token),
      loadChatRooms(token)
    ]);
  }

  /**
   * 오늘 날짜를 보기 좋게 출력한다.
   */
  function updateScheduleDate() {
    if (!scheduleDateEl) return;
    const now = new Date();
    try {
      const formatted = new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'full'
      }).format(now);
      scheduleDateEl.textContent = formatted;
    } catch (err) {
      scheduleDateEl.textContent = now.toLocaleDateString();
    }
  }

  /**
   * 공지사항 3개를 불러와 카드에 표시한다.
   */
  async function loadNotices(token) {
    if (!noticesList) return;
    setListPlaceholder(noticesList, '공지사항을 불러오는 중이에요...');

    try {
      const response = await fetchWithToken('/api/posts?type=notice&limit=3', token);
      const payload = await safeJson(response);
      const notices = normalizeArray(payload, 'posts');

      if (!notices.length) {
        setListPlaceholder(noticesList, '아직 공지사항이 없어요. 새 소식을 기다려 주세요!');
        return;
      }

      noticesList.innerHTML = '';
      notices.slice(0, 3).forEach((notice) => {
        noticesList.appendChild(createNoticeItem(notice));
      });
    } catch (error) {
      console.error('[dashboard] 공지 로드 실패', error);
      setListPlaceholder(noticesList, '공지사항을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  /**
   * 채팅방 목록을 불러와 활동이 활발한 방을 보여준다.
   */
  async function loadChatRooms(token) {
    if (!chatsList) return;
    setListPlaceholder(chatsList, '채팅방 정보를 준비 중이에요...');

    try {
      const response = await fetchWithToken('/api/chat/rooms', token);
      const payload = await safeJson(response);
      const rooms = normalizeArray(payload, 'rooms');

      if (!rooms.length) {
        setListPlaceholder(chatsList, '아직 참여 중인 채팅방이 없어요. 친구들을 먼저 초대해 볼까요?');
        return;
      }

      // 읽지 않은 메시지가 많은 순으로 정렬
      rooms.sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0));

      chatsList.innerHTML = '';
      rooms.slice(0, 4).forEach((room) => {
        chatsList.appendChild(createChatRoomItem(room));
      });
    } catch (error) {
      console.error('[dashboard] 채팅방 로드 실패', error);
      setListPlaceholder(chatsList, '채팅방 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  /**
   * Fetch API 호출 헬퍼: 토큰을 헤더에 붙이고 401/403은 로그인으로 돌려보낸다.
   */
  async function fetchWithToken(url, token) {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401 || response.status === 403) {
      window.location.href = '/login.html';
      throw new Error('인증이 만료되었습니다.');
    }

    if (!response.ok) {
      throw new Error(`요청 실패: ${response.status}`);
    }

    return response;
  }

  /**
   * 응답 본문을 안전하게 JSON으로 파싱한다.
   */
  async function safeJson(response) {
    try {
      return await response.json();
    } catch (error) {
      console.warn('[dashboard] JSON 파싱 실패', error);
      return [];
    }
  }

  /**
   * API 응답이 배열이 아닐 때도 유연하게 처리한다.
   */
  function normalizeArray(payload, key) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload.data && Array.isArray(payload.data)) return payload.data;
    if (payload[key] && Array.isArray(payload[key])) return payload[key];
    return [];
  }

  /**
   * 공지사항 목록 아이템을 생성한다.
   */
  function createNoticeItem(notice) {
    const postId = notice?._id || notice?.id;
    const link = document.createElement('a');
    link.className = 'card-list-item';
    link.href = postId ? `/posts.html?post=${encodeURIComponent(postId)}` : '/posts.html?type=notice';
    link.setAttribute('aria-label', `${notice?.title || '제목 없는 공지'} 자세히 보기`);

    const top = document.createElement('div');
    top.className = 'card-list-item-top';

    const title = document.createElement('span');
    title.className = 'card-list-item-title';
    title.textContent = notice?.title || '제목 없는 공지';

    const date = document.createElement('span');
    date.className = 'card-list-item-meta';
    date.textContent = formatDate(notice?.createdAt || notice?.updatedAt || notice?.time);

    top.appendChild(title);
    top.appendChild(date);

    const preview = document.createElement('p');
    preview.className = 'card-list-item-meta';
    preview.textContent = extractSummary(notice?.content || notice?.summary || '');

    link.appendChild(top);
    link.appendChild(preview);

    return link;
  }

  /**
   * 채팅방 카드 아이템을 생성한다.
   */
  function createChatRoomItem(room) {
    const roomId = room?._id || room?.id || room?.roomId;
    const link = document.createElement('a');
    link.className = 'card-list-item';
    link.href = roomId ? `/chat.html?room=${encodeURIComponent(roomId)}` : '/chat.html';
    link.setAttribute('aria-label', `${room?.name || '채팅방'} 이동하기`);

    const top = document.createElement('div');
    top.className = 'card-list-item-top';

    const title = document.createElement('span');
    title.className = 'card-list-item-title';
    title.textContent = room?.name || room?.title || '이름 없는 채팅방';
    top.appendChild(title);

    const unread = Number(room?.unreadCount || 0);
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = unread > 99 ? '99+' : unread.toString();
      badge.setAttribute('aria-label', `읽지 않은 메시지 ${badge.textContent}개`);
      top.appendChild(badge);
    }

    const preview = document.createElement('p');
    preview.className = 'card-list-item-meta';
    const lastMessage = room?.lastMessage?.message || room?.lastMessage || '';
    preview.textContent = lastMessage
      ? shortenText(lastMessage, 80)
      : '아직 나눈 대화가 없어요. 먼저 인사를 건네보세요!';

    link.appendChild(top);
    link.appendChild(preview);

    return link;
  }

  /**
   * 비어 있는 목록에 안내 문구를 표시한다.
   */
  function setListPlaceholder(listElement, message) {
    if (!listElement) return;
    listElement.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'card-list-item empty-state';
    li.textContent = message;
    listElement.appendChild(li);
  }

  /**
   * 날짜를 보기 쉬운 문자열로 변환한다.
   */
  function formatDate(rawDate) {
    if (!rawDate) return '방금 전';
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return '방금 전';
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        month: 'short',
        day: 'numeric'
      }).format(date);
    } catch (err) {
      return date.toLocaleDateString();
    }
  }

  /**
   * 긴 내용을 간략히 요약한다.
   */
  function extractSummary(text) {
    if (!text) return '새로운 소식을 기대해 주세요!';
    return shortenText(text.replace(/\s+/g, ' ').trim(), 80);
  }

  function shortenText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
  }
})();
