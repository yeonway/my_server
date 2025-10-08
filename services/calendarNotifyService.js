const NotificationService = require('./notificationService');
const User = require('../models/user');
const logger = require('../config/logger');

const CATEGORY_EMOJI = {
  시험: '📚',
  숙제: '📝',
  생일: '🎂',
  약속: '📅',
  기타: '🫧',
};

const PRIORITY_LABEL = {
  high: '🔥 긴급',
  medium: '⭐ 중요',
  low: '🫧 일반',
};

const REMINDER_LABEL = {
  '1d': 'D-1',
  '3d': 'D-3',
  '7d': 'D-7',
};

function buildLink(event) {
  if (!event?.date) return '/calendar.html';
  const date = new Date(event.date);
  const params = new URLSearchParams({
    year: date.getFullYear().toString(),
    month: (date.getMonth() + 1).toString(),
    date: date.getDate().toString(),
  });
  return `/calendar.html?${params.toString()}`;
}

function buildMessage(event, prefix = '') {
  const date = event?.date ? new Date(event.date) : null;
  const dateLabel = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : '날짜 미정';

  const timeLabel = event?.time ? ` ${event.time}` : '';
  const category = event?.category || '기타';
  const priority = PRIORITY_LABEL[event?.priority] || PRIORITY_LABEL.low;
  const creator = event?.createdBy?.username || event?.createdBy?.name || '익명';

  const emoji = CATEGORY_EMOJI[category] || '🗓️';

  return `${prefix}${emoji} ${event?.title || '제목 없음'}\n📅 ${dateLabel}${timeLabel}\n📂 ${category} • ${priority}\n👤 작성자: ${creator}`;
}

function sanitizeIds(values = []) {
  const set = new Set();
  (values || []).forEach((value) => {
    if (!value) return;
    const id = value.toString().trim();
    if (id) set.add(id);
  });
  return Array.from(set);
}

async function resolveExtraRecipients({ rawBody = {}, actorId }) {
  try {
    const extra = new Set();
    const candidateLists = [
      rawBody.notifyUserIds,
      rawBody.notifyUsers,
      rawBody.participants,
    ];
    candidateLists.forEach((list) => {
      if (!Array.isArray(list)) return;
      list.forEach((value) => {
        if (!value) return;
        const id = value.toString().trim();
        if (id && id !== actorId) extra.add(id);
      });
    });

    if (!extra.size && typeof rawBody.notifyUsername === 'string') {
      const user = await User.findOne({ username: rawBody.notifyUsername.trim() }).select('_id').lean();
      if (user && user._id && user._id.toString() !== actorId) {
        extra.add(user._id.toString());
      }
    }

    return Array.from(extra);
  } catch (error) {
    logger.warn(`[calendar][notify] 추가 대상 확인 실패: ${error.message}`);
    return [];
  }
}

function collectRecipientIds(event, { actorId, extraRecipients = [], includeCreator = true } = {}) {
  const recipients = new Set();

  sanitizeIds(extraRecipients).forEach((id) => recipients.add(id));

  if (includeCreator && event?.createdBy) {
    const creatorId = event.createdBy._id ? event.createdBy._id.toString() : event.createdBy.toString();
    if (creatorId && creatorId !== actorId) {
      recipients.add(creatorId);
    }
  }

  if (actorId) {
    recipients.delete(actorId);
  }

  return Array.from(recipients);
}

async function dispatchNotifications({ recipients, actorId = null, message, link, type, payload }) {
  const results = [];
  for (const recipientId of recipients) {
    try {
      const created = await NotificationService.createNotification({
        recipientId,
        actorId,
        type,
        message,
        link,
        payload,
      });
      if (created) {
        results.push(created);
      }
    } catch (error) {
      logger.warn(`[calendar][notify] 알림 전송 실패 recipient=${recipientId}: ${error.message}`);
    }
  }
  return results;
}

async function sendCreationNotice(event, { actor, rawBody } = {}) {
  if (!event) return [];
  try {
    const actorId = actor?.id || actor?._id?.toString() || null;
    const extraRecipients = await resolveExtraRecipients({ rawBody, actorId });
    const recipients = collectRecipientIds(event, { actorId, extraRecipients, includeCreator: true });
    if (!recipients.length) return [];

    const message = buildMessage(event, '🆕 새 일정이 등록됐어요!\n');
    const link = buildLink(event);
    const payload = {
      calendarId: event._id || event.id,
      notifyBefore: event.notifyBefore || null,
      eventDate: event.date || null,
    };

    return await dispatchNotifications({
      recipients,
      actorId,
      message,
      link,
      type: 'calendar-create',
      payload,
    });
  } catch (error) {
    logger.error(`[calendar][notify] 생성 알림 실패: ${error.message}`);
    return [];
  }
}

async function sendUpdateNotice(prevEvent, nextEvent, { actor, rawBody } = {}) {
  if (!prevEvent || !nextEvent) return [];
  try {
    const actorId = actor?.id || actor?._id?.toString() || null;
    const extraRecipients = await resolveExtraRecipients({ rawBody, actorId });
    const recipients = collectRecipientIds(nextEvent, { actorId, extraRecipients, includeCreator: true });
    if (!recipients.length) return [];

    const message = buildMessage(nextEvent, '🔄 일정이 수정됐어요!\n');
    const link = buildLink(nextEvent);
    const payload = {
      calendarId: nextEvent._id || nextEvent.id,
      notifyBefore: nextEvent.notifyBefore || null,
      previousDate: prevEvent.date || null,
      eventDate: nextEvent.date || null,
    };

    return await dispatchNotifications({
      recipients,
      actorId,
      message,
      link,
      type: 'calendar-update',
      payload,
    });
  } catch (error) {
    logger.error(`[calendar][notify] 수정 알림 실패: ${error.message}`);
    return [];
  }
}

async function sendPreReminder(event) {
  if (!event || !event.notifyBefore) return [];
  try {
    const recipients = collectRecipientIds(event, { includeCreator: true });
    if (!recipients.length) return [];

    const badge = REMINDER_LABEL[event.notifyBefore] || 'D-알림';
    const prefix = `⏰ ${badge} - 곧 예정된 일정이에요!\n`;
    const message = buildMessage(event, prefix);
    const link = buildLink(event);

    return await dispatchNotifications({
      recipients,
      actorId: null,
      message,
      link,
      type: 'calendar-reminder',
      payload: {
        calendarId: event._id || event.id,
        notifyBefore: event.notifyBefore,
        eventDate: event.date || null,
      },
    });
  } catch (error) {
    logger.error(`[calendar][notify] 사전 알림 실패: ${error.message}`);
    return [];
  }
}

module.exports = {
  sendCreationNotice,
  sendUpdateNotice,
  sendPreReminder,
};
