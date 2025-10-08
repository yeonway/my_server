const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { notifications, unreadCount } = await NotificationService.listNotifications(req.user.id, {
      unreadOnly,
      limit,
    });
    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('[notifications] list error', error);
    res.status(500).json({ error: '알림을 불러오지 못했습니다.' });
  }
});

router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await NotificationService.markAsRead(req.params.id, req.user.id);
    if (!notification) {
      return res.status(404).json({ error: '존재하지 않는 알림입니다.' });
    }
    const unreadCount = await NotificationService.getUnreadCount(req.user.id);
    res.json({ notification, unreadCount });
  } catch (error) {
    console.error('[notifications] mark read error', error);
    res.status(500).json({ error: '알림 읽음 처리에 실패했습니다.' });
  }
});

router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    const result = await NotificationService.markAllAsRead(req.user.id);
    const unreadCount = await NotificationService.getUnreadCount(req.user.id);
    const modified = typeof result.modifiedCount === 'number'
      ? result.modifiedCount
      : typeof result.nModified === 'number'
        ? result.nModified
        : 0;
    res.json({ success: true, updated: modified, unreadCount });
  } catch (error) {
    console.error('[notifications] mark all read error', error);
    res.status(500).json({ error: '전체 읽음 처리에 실패했습니다.' });
  }
});

module.exports = router;
