const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');
const { notificationTypes } = require('../models/notification');

function parseTypeFilters(raw) {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  const normalized = new Set();
  values
    .map((value) => String(value).trim())
    .filter((value) => value && notificationTypes.includes(value))
    .forEach((value) => normalized.add(value));
  return Array.from(normalized);
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const statusParam = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : '';
    const unreadOnly = req.query.unread === 'true' || statusParam === 'unread';
    const limitParam = parseInt(req.query.limit, 10);
    const limit = Math.max(1, Math.min(Number.isNaN(limitParam) ? 50 : limitParam, 200));
    const types = parseTypeFilters(req.query.types || req.query.type);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

    const result = await NotificationService.listNotifications(req.user.id, {
      unreadOnly,
      limit,
      types,
      cursor,
    });
    res.json(result);
  } catch (error) {
    console.error('[notifications] list error', error);
    res.status(500).json({ error: '알림을 불러오지 못했습니다.' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const notification = await NotificationService.getNotificationDetail(req.params.id, req.user.id);
    if (!notification) {
      return res.status(404).json({ error: '존재하지 않는 알림입니다.' });
    }
    res.json({ notification });
  } catch (error) {
    console.error('[notifications] detail error', error);
    res.status(500).json({ error: '알림을 불러오지 못했습니다.' });
  }
});

router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await NotificationService.markAsRead(req.params.id, req.user.id);
    if (!notification) {
      return res.status(404).json({ error: '존재하지 않는 알림입니다.' });
    }
    const [unreadCount, summary] = await Promise.all([
      NotificationService.getUnreadCount(req.user.id),
      NotificationService.getTypeSummary(req.user.id),
    ]);
    res.json({ notification, unreadCount, summary });
  } catch (error) {
    console.error('[notifications] mark read error', error);
    res.status(500).json({ error: '알림 읽음 처리에 실패했습니다.' });
  }
});

router.post('/:id/reply', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: '답장 내용을 입력해 주세요.' });
    }

    const result = await NotificationService.sendQuickReply(req.params.id, req.user.id, message);
    if (!result) {
      return res.status(404).json({ error: '존재하지 않는 알림입니다.' });
    }
    res.status(201).json(result);
  } catch (error) {
    console.error('[notifications] quick reply error', error);
    const status = Number(error.status || error.statusCode);
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ error: error.message });
    }
    res.status(500).json({ error: '빠른 답장 전송에 실패했습니다.' });
  }
});

router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    const result = await NotificationService.markAllAsRead(req.user.id);
    const [unreadCount, summary] = await Promise.all([
      NotificationService.getUnreadCount(req.user.id),
      NotificationService.getTypeSummary(req.user.id),
    ]);
    const modified = typeof result.modifiedCount === 'number'
      ? result.modifiedCount
      : typeof result.nModified === 'number'
        ? result.nModified
        : 0;
    res.json({ success: true, updated: modified, unreadCount, summary });
  } catch (error) {
    console.error('[notifications] mark all read error', error);
    res.status(500).json({ error: '전체 읽음 처리에 실패했습니다.' });
  }
});

module.exports = router;
