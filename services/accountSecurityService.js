const LoginActivity = require('../models/loginActivity');
const NotificationService = require('./notificationService');
const logger = require('../config/logger');
const { lookupIpLocation, isPrivateIp } = require('../utils/ipLocation');

const LOGIN_HISTORY_LIMIT = Number(process.env.LOGIN_HISTORY_LIMIT || 50);
const SUSPICIOUS_THRESHOLD = Number(process.env.SUSPICIOUS_IP_THRESHOLD || 1);

function sanitizeActivity(doc) {
  if (!doc) return null;
  const base = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: base._id ? base._id.toString() : null,
    user: base.user ? base.user.toString?.() || base.user : null,
    usernameSnapshot: base.usernameSnapshot || null,
    ipAddress: base.ipAddress,
    userAgent: base.userAgent || null,
    location: base.location || null,
    success: Boolean(base.success),
    suspicious: Boolean(base.suspicious),
    suspicionReasons: Array.isArray(base.suspicionReasons) ? base.suspicionReasons : [],
    notifiedAt: base.notifiedAt || null,
    createdAt: base.createdAt || null,
  };
}

async function detectSuspiciousLogin({ userId, ipAddress, userAgent, location }) {
  if (!userId) return { suspicious: false, reasons: [] };

  const reasons = [];
  if (!ipAddress) {
    return { suspicious: true, reasons: ['ip_missing'] };
  }

  const existingSameIp = await LoginActivity.exists({ user: userId, success: true, ipAddress });
  if (!existingSameIp) {
    if (!isPrivateIp(ipAddress)) {
      reasons.push('new_ip_address');
    }
  }

  const lastSuccess = await LoginActivity.findOne({ user: userId, success: true })
    .sort({ createdAt: -1 })
    .lean();

  if (lastSuccess) {
    if (lastSuccess.ipAddress !== ipAddress && !isPrivateIp(ipAddress)) {
      reasons.push('ip_changed');
    }

    const lastLocation = lastSuccess.location || {};
    if (location && lastLocation) {
      if (location.country && lastLocation.country && location.country !== lastLocation.country) {
        reasons.push('country_changed');
      } else if (location.city && lastLocation.city && location.city !== lastLocation.city) {
        reasons.push('city_changed');
      }
    }

    if (userAgent && lastSuccess.userAgent && userAgent !== lastSuccess.userAgent) {
      reasons.push('device_changed');
    }
  }

  return { suspicious: reasons.length >= SUSPICIOUS_THRESHOLD, reasons };
}

async function recordLoginAttempt({
  userId,
  username,
  ipAddress,
  userAgent,
  success,
}) {
  if (!userId || !ipAddress) {
    return null;
  }

  try {
    const location = await lookupIpLocation(ipAddress);
    let suspicious = false;
    let reasons = [];

    if (success) {
      const detection = await detectSuspiciousLogin({ userId, ipAddress, userAgent, location });
      suspicious = detection.suspicious;
      reasons = detection.reasons;
    }

    const activity = await LoginActivity.create({
      user: userId,
      usernameSnapshot: username || '',
      ipAddress,
      userAgent: userAgent || '',
      location,
      success,
      suspicious,
      suspicionReasons: reasons,
    });

    if (success && suspicious) {
      try {
        const where = location?.city || location?.region || location?.country || '알 수 없는 위치';
        const message = `새로운 위치(${where})에서 로그인되었습니다.`;
        const payload = {
          ipAddress,
          location,
          at: activity.createdAt,
          reasons,
        };
        await NotificationService.createNotification({
          recipientId: userId,
          type: 'security_alert',
          message,
          payload,
        });
        activity.notifiedAt = new Date();
        await activity.save();
      } catch (notificationError) {
        logger.warn(`Failed to send security notification: ${notificationError.message}`);
      }
    }

    return sanitizeActivity(activity);
  } catch (error) {
    logger.error(`recordLoginAttempt error: ${error.message}`);
    return null;
  }
}

async function listLoginActivities(userId, { limit = LOGIN_HISTORY_LIMIT } = {}) {
  if (!userId) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || LOGIN_HISTORY_LIMIT, 1), 200);
  const activities = await LoginActivity.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  return activities.map((doc) => sanitizeActivity(doc));
}

module.exports = {
  recordLoginAttempt,
  listLoginActivities,
};
