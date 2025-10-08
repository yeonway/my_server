const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

const { authMiddleware } = require('../middleware/auth');
const User = require('../models/user');
const Post = require('../models/post');
const { listLoginActivities } = require('../services/accountSecurityService');
const logger = require('../config/logger');

function formatCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

async function ensurePassword(user, password) {
  if (!password) {
    throw new Error('비밀번호를 입력해주세요.');
  }
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new Error('비밀번호가 일치하지 않습니다.');
  }
}

router.use(authMiddleware);

router.get('/security/logins', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const activities = await listLoginActivities(req.user.id, { limit });
    res.json({ items: activities, limit });
  } catch (error) {
    logger.error(`Failed to fetch login activities: ${error.message}`);
    res.status(500).json({ error: '로그인 기록을 불러오지 못했습니다.' });
  }
});

router.post('/deactivate', async (req, res) => {
  try {
    const { password, reason = '' } = req.body || {};
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    await ensurePassword(user, password);

    user.accountStatus = 'deactivated';
    user.deactivatedAt = new Date();
    user.deletionReason = reason || '';
    await user.save();

    res.json({ message: '계정이 비활성화되었습니다.', status: user.accountStatus });
  } catch (error) {
    if (error.message.includes('비밀번호')) {
      return res.status(400).json({ error: error.message });
    }
    logger.error(`Failed to deactivate account: ${error.message}`);
    res.status(500).json({ error: '계정을 비활성화하지 못했습니다.' });
  }
});

router.post('/reactivate', async (req, res) => {
  try {
    const { password } = req.body || {};
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    if (user.accountStatus === 'pending_deletion') {
      return res.status(400).json({ error: '삭제가 예약된 계정은 복구할 수 없습니다.' });
    }
    await ensurePassword(user, password);
    user.accountStatus = 'active';
    user.deactivatedAt = null;
    user.deletionReason = '';
    await user.save();
    res.json({ message: '계정이 다시 활성화되었습니다.', status: user.accountStatus });
  } catch (error) {
    if (error.message.includes('비밀번호')) {
      return res.status(400).json({ error: error.message });
    }
    logger.error(`Failed to reactivate account: ${error.message}`);
    res.status(500).json({ error: '계정을 활성화하지 못했습니다.' });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { password, reason = '' } = req.body || {};
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    await ensurePassword(user, password);

    const graceDays = Math.max(Number(process.env.ACCOUNT_DELETION_GRACE_DAYS) || 7, 1);
    const scheduledFor = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000);

    user.accountStatus = 'pending_deletion';
    user.deletionRequestedAt = new Date();
    user.deletionScheduledFor = scheduledFor;
    user.deletionReason = reason || '';
    await user.save();

    res.json({
      message: '계정 삭제가 예약되었습니다.',
      status: user.accountStatus,
      scheduledFor,
      graceDays,
    });
  } catch (error) {
    if (error.message.includes('비밀번호')) {
      return res.status(400).json({ error: error.message });
    }
    logger.error(`Failed to schedule account deletion: ${error.message}`);
    res.status(500).json({ error: '계정 삭제를 예약하지 못했습니다.' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.loginLimit) || 50, 1), 500);
    const user = await User.findById(req.user.id)
      .select('username name email intro photo createdAt updatedAt accountStatus deactivatedAt deletionRequestedAt deletionScheduledFor deletionReason')
      .lean();
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const posts = await Post.find({ author: req.user.id })
      .select('title content time lastEditedAt isNotice deleted')
      .sort({ time: -1 })
      .limit(200)
      .lean();

    const loginHistory = await listLoginActivities(req.user.id, { limit });

    const payload = {
      profile: user,
      posts,
      loginHistory,
      generatedAt: new Date(),
    };

    if (format === 'csv') {
      const lines = [];
      lines.push('# Profile');
      lines.push('field,value');
      Object.entries(user).forEach(([key, value]) => {
        lines.push(`${formatCsvValue(key)},${formatCsvValue(value)}`);
      });
      lines.push('');
      lines.push('# LoginHistory');
      lines.push('createdAt,ipAddress,country,city,userAgent,success,suspicious,reasons');
      loginHistory.forEach((item) => {
        const location = item.location || {};
        lines.push([
          formatCsvValue(item.createdAt),
          formatCsvValue(item.ipAddress),
          formatCsvValue(location.country || ''),
          formatCsvValue(location.city || ''),
          formatCsvValue(item.userAgent || ''),
          formatCsvValue(item.success),
          formatCsvValue(item.suspicious),
          formatCsvValue((item.suspicionReasons || []).join('|')),
        ].join(','));
      });
      lines.push('');
      lines.push('# Posts');
      lines.push('title,time,lastEditedAt,isNotice,deleted');
      posts.forEach((post) => {
        lines.push([
          formatCsvValue(post.title),
          formatCsvValue(post.time),
          formatCsvValue(post.lastEditedAt),
          formatCsvValue(post.isNotice),
          formatCsvValue(post.deleted),
        ].join(','));
      });

      const filename = `account-export-${user.username}-${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(lines.join('\n'));
    }

    res.json(payload);
  } catch (error) {
    logger.error(`Failed to export user data: ${error.message}`);
    res.status(500).json({ error: '데이터를 내보내지 못했습니다.' });
  }
});

module.exports = router;
