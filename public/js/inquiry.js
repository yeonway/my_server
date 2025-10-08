(function () {
  const form = document.getElementById('inquiryForm');
  const inquiryTypeSelect = document.getElementById('inquiryType');
  const titleInput = document.getElementById('title');
  const contentInput = document.getElementById('content');
  const statusMessage = document.querySelector('[data-submit-status]');
  const quickActionsContainer = document.querySelector('[data-quick-actions]');
  const faqContainer = document.querySelector('[data-faq-list]');
  const helpContainer = document.querySelector('[data-help-list]');
  const historyContainer = document.querySelector('[data-inquiry-history]');
  const slaElement = document.querySelector('[data-sla-hours]');

  const token = localStorage.getItem('token');

  if (!token) {
    alert('로그인이 필요합니다.');
    window.location.href = '/login.html';
    return;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error.error || error.message || '요청을 처리할 수 없습니다.';
      throw new Error(message);
    }
    return response.json();
  }

  function renderQuickActions(actions) {
    quickActionsContainer.innerHTML = '';

    if (!actions.length) {
      quickActionsContainer.innerHTML = '<p class="empty-state">사용 가능한 빠른 액션이 없습니다.</p>';
      return;
    }

    actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-action-button';
      button.setAttribute('data-action-id', action.id);
      button.innerHTML = `
        <span aria-hidden="true">${action.icon || '📝'}</span>
        <div>
          <strong>${action.label}</strong>
          <span>${action.description}</span>
        </div>
      `;

      button.addEventListener('click', () => {
        inquiryTypeSelect.value = action.type;
        if (action.template?.title) {
          titleInput.value = action.template.title;
        }
        if (action.template?.content) {
          contentInput.value = action.template.content;
        }
        contentInput.focus();
        statusMessage.textContent = `${action.label} 템플릿이 적용되었습니다. 필요한 정보를 작성한 뒤 제출해주세요.`;
      });

      quickActionsContainer.appendChild(button);
    });
  }

  function renderFaqList(faqs) {
    faqContainer.innerHTML = '';

    if (!faqs.length) {
      faqContainer.innerHTML = '<p class="empty-state">등록된 FAQ가 없습니다.</p>';
      return;
    }

    faqs.forEach((faq) => {
      const details = document.createElement('details');
      details.className = 'faq-item';

      const summary = document.createElement('summary');
      summary.textContent = faq.question;
      details.appendChild(summary);

      const paragraph = document.createElement('p');
      paragraph.textContent = faq.answer;
      details.appendChild(paragraph);

      faqContainer.appendChild(details);
    });
  }

  function renderHelpTopics(topics) {
    helpContainer.innerHTML = '';

    if (!topics.length) {
      helpContainer.innerHTML = '<p class="empty-state">도움말이 없습니다.</p>';
      return;
    }

    topics.forEach((topic) => {
      const wrapper = document.createElement('article');
      wrapper.className = 'help-topic';

      const title = document.createElement('h4');
      title.textContent = topic.title;
      wrapper.appendChild(title);

      if (topic.description) {
        const description = document.createElement('p');
        description.textContent = topic.description;
        wrapper.appendChild(description);
      }

      if (Array.isArray(topic.steps) && topic.steps.length) {
        const list = document.createElement('ol');
        topic.steps.forEach((step) => {
          const item = document.createElement('li');
          item.textContent = step;
          list.appendChild(item);
        });
        wrapper.appendChild(list);
      }

      helpContainer.appendChild(wrapper);
    });
  }

  function renderInquiryHistory(history) {
    historyContainer.innerHTML = '';

    if (!history.inquiries?.length) {
      historyContainer.innerHTML = '<p class="empty-state">접수한 문의가 아직 없습니다.</p>';
      return;
    }

    history.inquiries.forEach((item) => {
      const entry = document.createElement('article');
      entry.className = 'history-item';

      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = item.title;
      header.appendChild(title);

      const statusBadge = document.createElement('span');
      statusBadge.textContent = item.status === 'closed' ? '답변 완료' : '처리 중';
      statusBadge.dataset.status = item.status;
      header.appendChild(statusBadge);

      entry.appendChild(header);

      const description = document.createElement('p');
      description.textContent = item.content;
      entry.appendChild(description);

      if (item.attachmentUrl) {
        const link = document.createElement('a');
        link.href = item.attachmentUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.innerHTML = '첨부파일 보기 <span aria-hidden="true">↗</span>';
        entry.appendChild(link);
      }

      const createdAt = document.createElement('time');
      createdAt.dateTime = item.createdAt;
      const createdDate = new Date(item.createdAt);
      const resolvedDate = item.resolvedAt ? new Date(item.resolvedAt) : null;
      createdAt.textContent = `접수: ${createdDate.toLocaleString('ko-KR')}`;
      entry.appendChild(createdAt);

      if (resolvedDate) {
        const resolved = document.createElement('time');
        resolved.dateTime = item.resolvedAt;
        resolved.textContent = `완료: ${resolvedDate.toLocaleString('ko-KR')}`;
        entry.appendChild(resolved);
      }

      historyContainer.appendChild(entry);
    });
  }

  async function bootstrap() {
    try {
      const meta = await fetchJson('/api/inquiry/meta');
      if (slaElement && typeof meta.slaHours === 'number') {
        slaElement.textContent = meta.slaHours;
      }
      renderQuickActions(meta.quickActions || []);
      renderFaqList(meta.faqs || []);
      renderHelpTopics(meta.helpTopics || []);
    } catch (error) {
      console.error(error);
      const message = error.message || '지원 정보를 불러오는 중 문제가 발생했습니다.';
      quickActionsContainer.innerHTML = `<p class="empty-state">${message}</p>`;
      faqContainer.innerHTML = `<p class="empty-state">${message}</p>`;
      helpContainer.innerHTML = `<p class="empty-state">${message}</p>`;
    }

    try {
      const history = await fetchJson('/api/inquiry/history', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      renderInquiryHistory(history);
    } catch (error) {
      console.error(error);
      historyContainer.innerHTML = `<p class="empty-state">${error.message}</p>`;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!inquiryTypeSelect.value) {
      statusMessage.textContent = '문의 유형을 선택해주세요.';
      inquiryTypeSelect.focus();
      return;
    }

    if (!titleInput.value.trim()) {
      statusMessage.textContent = '제목을 입력해주세요.';
      titleInput.focus();
      return;
    }

    if (!contentInput.value.trim()) {
      statusMessage.textContent = '상세 내용을 작성해주세요.';
      contentInput.focus();
      return;
    }

    const formData = new FormData(form);
    statusMessage.textContent = '문의 접수 중입니다...';

    try {
      const result = await fetchJson('/api/inquiry', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      statusMessage.textContent = result.message || '문의가 접수되었습니다.';
      form.reset();
      await bootstrap();
    } catch (error) {
      statusMessage.textContent = error.message;
    }
  });

  bootstrap();
})();
