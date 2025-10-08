const express = require('express');
const Calendar = require('../models/Calendar');
const CalendarBackup = require('../models/CalendarBackup');
const AdminActivity = require('../models/adminActivity');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { createCalendarBackup } = require('../utils/calendarBackup');
const calendarNotifyService = require('../services/calendarNotifyService');
const logger = require('../config/logger');

const router = express.Router();

const CATEGORY_VALUES = Calendar.CATEGORY_VALUES;
const PRIORITY_VALUES = Calendar.PRIORITY_VALUES;
const NOTIFY_VALUES = Calendar.NOTIFY_VALUES;

// 모든 일정 관련 API는 로그인 후 사용
router.use(authenticateToken);

function serializeReminderStatus(value) {
  if (!value) return {};
  if (typeof value.entries === 'function') {
    return Array.from(value.entries()).reduce((acc, [key, dateValue]) => {
      acc[key] = dateValue instanceof Date ? dateValue : new Date(dateValue);
      return acc;
    }, {});
  }
  return value;
}

/**
 * 일정 정보를 응답용으로 가공
 */
function formatCalendar(doc) {
  if (!doc) return null;
  const data = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const createdBy = data.createdBy;
  return {
    id: data._id ? data._id.toString() : data.id,
    title: data.title,
    description: data.description || '',
    date: data.date,
    time: data.time || '',
    category: data.category,
    priority: data.priority,
    notifyBefore: data.notifyBefore,
    reminderStatus: serializeReminderStatus(data.reminderStatus),
    createdBy: createdBy && createdBy._id
      ? {
          id: createdBy._id.toString(),
          username: createdBy.username || null,
          name: createdBy.name || null,
        }
      : createdBy
        ? createdBy.toString()
        : null,
    isDeleted: Boolean(data.isDeleted),
    deletedAt: data.deletedAt || null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/**
 * 백업 이력을 응답용으로 가공
 */
function formatBackup(doc) {
  if (!doc) return null;
  const data = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: data._id ? data._id.toString() : data.id,
    originalId: data.originalId ? data.originalId.toString() : null,
    reason: data.reason,
    snapshot: data.snapshot,
    backedUpAt: data.backedUpAt,
    backedUpBy: data.backedUpBy ? data.backedUpBy.toString() : null,
  };
}

/**
 * 관리자 활동 로그 기록
 */
async function recordAdminActivity(req, { action, targetId, description, metadata }) {
  try {
    await AdminActivity.create({
      admin: req.user.id,
      action,
      targetType: 'calendar',
      targetId: targetId ? targetId.toString() : '',
      description: description || '',
      metadata: metadata || null,
    });
  } catch (error) {
    logger.warn(`[calendar][adminActivity] 기록 실패: ${error.message}`);
  }
}

/**
 * 일정 생성/수정 시 입력값 검증
 */
function validateCalendarPayload(body = {}, { partial = false } = {}) {
  const errors = [];
  const payload = {};

  if (!partial || body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      errors.push('제목은 필수입니다.');
    } else if (title.length < 1 || title.length > 100) {
      errors.push('제목은 1자 이상 100자 이하로 입력해 주세요.');
    } else {
      payload.title = title;
    }
  }

  if (!partial || body.description !== undefined) {
    payload.description = typeof body.description === 'string' ? body.description.trim() : '';
  }

  if (!partial || body.date !== undefined) {
    const rawDate = body.date instanceof Date ? body.date : new Date(body.date);
    if (Number.isNaN(rawDate.getTime())) {
      errors.push('유효한 날짜를 입력해 주세요.');
    } else {
      payload.date = rawDate;
    }
  }

  if (!partial || body.time !== undefined) {
    const time = typeof body.time === 'string' ? body.time.trim() : '';
    if (time && !/^\d{2}:\d{2}$/.test(time)) {
      errors.push('시간은 HH:mm 형식으로 입력해 주세요.');
    } else {
      payload.time = time;
    }
  }

  if (!partial || body.category !== undefined) {
    if (!CATEGORY_VALUES.includes(body.category)) {
      errors.push(`카테고리는 ${CATEGORY_VALUES.join(', ')} 중 하나여야 합니다.`);
    } else {
      payload.category = body.category;
    }
  }

  if (!partial || body.priority !== undefined) {
    const priority = body.priority || 'low';
    if (!PRIORITY_VALUES.includes(priority)) {
      errors.push(`중요도는 ${PRIORITY_VALUES.join(', ')} 중에서 선택해 주세요.`);
    } else {
      payload.priority = priority;
    }
  }

  if (!partial || body.notifyBefore !== undefined) {
    const notifyBefore = body.notifyBefore ?? null;
    if (!NOTIFY_VALUES.includes(notifyBefore)) {
      errors.push('알림 설정은 1d, 3d, 7d 또는 null만 허용됩니다.');
    } else {
      payload.notifyBefore = notifyBefore;
    }
  }

  return { payload, errors };
}

/**
 * 공통 검색 필터 구성 (텍스트 검색 포함)
 */
function buildCommonFilters(query = {}) {
  const filter = {};

  if (query.category && CATEGORY_VALUES.includes(query.category)) {
    filter.category = query.category;
  }

  if (query.priority && PRIORITY_VALUES.includes(query.priority)) {
    filter.priority = query.priority;
  }

  if (query.q && typeof query.q === 'string') {
    filter.$text = { $search: query.q.trim() };
  }

  return filter;
}

/**
 * 일정 생성
 */
router.post('/', async (req, res) => {
  try {
    const { payload, errors } = validateCalendarPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const calendar = await Calendar.create({
      ...payload,
      createdBy: req.user.id,
    });

    await calendar.populate('createdBy', 'username name');

    if (req.userLogger) {
      req.userLogger('info', `[calendar] 일정 생성 ${calendar._id}`);
    }

    await calendarNotifyService.sendCreationNotice(calendar, {
      actor: req.user,
      rawBody: req.body,
    });

    return res.status(201).json({ event: formatCalendar(calendar) });
  } catch (error) {
    logger.error(`[calendar] 일정 생성 실패: ${error.message}`);
    return res.status(500).json({ error: '일정 생성 중 오류가 발생했습니다.' });
  }
});

/**
 * 월별 일정 조회
 */
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const year = Number.parseInt(req.query.year || now.getFullYear(), 10);
    const month = Number.parseInt(req.query.month || now.getMonth() + 1, 10);
    if (Number.isNaN(year) || Number.isNaN(month)) {
      return res.status(400).json({ error: '연도와 월을 올바르게 입력해 주세요.' });
    }

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const filter = {
      date: { $gte: start, $lt: end },
      isDeleted: false,
      ...buildCommonFilters(req.query),
    };

    const events = await Calendar.find(filter)
      .sort({ date: 1, priority: -1, createdAt: -1 })
      .populate('createdBy', 'username name')
      .lean();

    return res.json({ events: events.map(formatCalendar) });
  } catch (error) {
    logger.error(`[calendar] 월별 일정 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '일정 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * 다가오는 7일(D-7) 일정 조회
 */
router.get('/upcoming', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const limit = new Date(today);
    limit.setDate(limit.getDate() + 7);

    const filter = {
      isDeleted: false,
      date: { $gte: today, $lte: limit },
      ...buildCommonFilters(req.query),
    };

    const events = await Calendar.find(filter)
      .sort({ date: 1, priority: -1 })
      .populate('createdBy', 'username name')
      .lean();

    return res.json({ events: events.map(formatCalendar) });
  } catch (error) {
    logger.error(`[calendar] 다가오는 일정 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '다가오는 일정을 불러오는 중 오류가 발생했습니다.' });
  }
});

/**
 * 오늘 일정 조회
 */
router.get('/today', async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const filter = {
      isDeleted: false,
      date: { $gte: start, $lt: end },
      ...buildCommonFilters(req.query),
    };

    const events = await Calendar.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .populate('createdBy', 'username name')
      .lean();

    return res.json({ events: events.map(formatCalendar) });
  } catch (error) {
    logger.error(`[calendar] 오늘 일정 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '오늘 일정을 불러오는 중 오류가 발생했습니다.' });
  }
});

/**
 * 일정 상세 조회
 */
router.get('/:id', async (req, res) => {
  try {
    const calendar = await Calendar.findById(req.params.id)
      .populate('createdBy', 'username name')
      .lean();

    if (!calendar || calendar.isDeleted) {
      return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    }

    return res.json({ event: formatCalendar(calendar) });
  } catch (error) {
    logger.error(`[calendar] 일정 상세 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '일정 상세 정보를 불러오는 중 오류가 발생했습니다.' });
  }
});

/**
 * 일정 수정 (작성자 전용)
 */
router.put('/:id', async (req, res) => {
  try {
    const calendar = await Calendar.findById(req.params.id).populate('createdBy', 'username name');
    if (!calendar || calendar.isDeleted) {
      return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    }

    const creatorId = calendar.createdBy
      ? calendar.createdBy._id
        ? calendar.createdBy._id.toString()
        : calendar.createdBy.toString()
      : null;
    if (creatorId && creatorId !== req.user.id) {
      return res.status(403).json({ error: '본인이 작성한 일정만 수정할 수 있습니다.' });
    }

    const { payload, errors } = validateCalendarPayload(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ error: errors.join(' ') });
    }
    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    }

    const previousSnapshot = calendar.toObject();

    await createCalendarBackup(calendar, { reason: '수정', actorId: req.user.id });

    const notifyBeforeChanged = Object.prototype.hasOwnProperty.call(payload, 'notifyBefore')
      && payload.notifyBefore !== previousSnapshot.notifyBefore;

    Object.assign(calendar, payload);

    if (notifyBeforeChanged) {
      calendar.reminderStatus = new Map();
      calendar.markModified('reminderStatus');
    }

    await calendar.save();

    if (req.userLogger) {
      req.userLogger('info', `[calendar] 일정 수정 ${calendar._id}`);
    }

    await calendarNotifyService.sendUpdateNotice(previousSnapshot, calendar, {
      actor: req.user,
      rawBody: req.body,
    });

    return res.json({ event: formatCalendar(calendar) });
  } catch (error) {
    logger.error(`[calendar] 일정 수정 실패: ${error.message}`);
    return res.status(500).json({ error: '일정 수정 중 오류가 발생했습니다.' });
  }
});

/**
 * 일정 삭제 (작성자 전용, 소프트 삭제)
 */
router.delete('/:id', async (req, res) => {
  try {
    const calendar = await Calendar.findById(req.params.id);
    if (!calendar || calendar.isDeleted) {
      return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    }

    if (calendar.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: '본인이 작성한 일정만 삭제할 수 있습니다.' });
    }

    await createCalendarBackup(calendar, { reason: '삭제', actorId: req.user.id });

    calendar.isDeleted = true;
    calendar.deletedAt = new Date();
    await calendar.save();

    if (req.userLogger) {
      req.userLogger('info', `[calendar] 일정 삭제 ${calendar._id}`);
    }

    return res.json({ message: '일정을 삭제했습니다.', event: formatCalendar(calendar) });
  } catch (error) {
    logger.error(`[calendar] 일정 삭제 실패: ${error.message}`);
    return res.status(500).json({ error: '일정 삭제 중 오류가 발생했습니다.' });
  }
});

// ------------------------------
// 관리자 전용 라우트
// ------------------------------

const adminRouter = express.Router();

/**
 * 전체 일정 조회 (삭제 포함)
 */
adminRouter.get('/all', async (req, res) => {
  try {
    const filter = {
      ...buildCommonFilters(req.query),
    };
    if (req.query.onlyDeleted === 'true') {
      filter.isDeleted = true;
    } else if (req.query.hideDeleted === 'true') {
      filter.isDeleted = { $in: [false, null] };
    }

    const events = await Calendar.find(filter)
      .sort({ date: -1 })
      .populate('createdBy', 'username name')
      .lean();

    return res.json({ events: events.map(formatCalendar) });
  } catch (error) {
    logger.error(`[calendar][admin] 전체 일정 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '전체 일정을 조회하는 중 오류가 발생했습니다.' });
  }
});

/**
 * 삭제된 일정만 조회
 */
adminRouter.get('/deleted', async (req, res) => {
  try {
    const events = await Calendar.find({
      isDeleted: true,
      ...buildCommonFilters(req.query),
    })
      .sort({ deletedAt: -1 })
      .populate('createdBy', 'username name')
      .lean();

    return res.json({ events: events.map(formatCalendar) });
  } catch (error) {
    logger.error(`[calendar][admin] 삭제 일정 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '삭제된 일정을 조회하는 중 오류가 발생했습니다.' });
  }
});

/**
 * 삭제된 일정 복원
 */
adminRouter.post('/restore/:id', async (req, res) => {
  try {
    const calendar = await Calendar.findById(req.params.id);
    if (!calendar) {
      return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    }
    if (!calendar.isDeleted) {
      return res.status(400).json({ error: '이미 활성 상태인 일정입니다.' });
    }

    await createCalendarBackup(calendar, { reason: '관리자 조치', actorId: req.user.id });

    calendar.isDeleted = false;
    calendar.deletedAt = null;
    await calendar.save();

    await recordAdminActivity(req, {
      action: 'calendar.restore',
      targetId: calendar._id,
      description: '관리자가 삭제된 일정을 복원했습니다.',
    });

    return res.json({ message: '일정을 복원했습니다.', event: formatCalendar(calendar) });
  } catch (error) {
    logger.error(`[calendar][admin] 일정 복원 실패: ${error.message}`);
    return res.status(500).json({ error: '일정 복원 중 오류가 발생했습니다.' });
  }
});

/**
 * 관리자 임의 수정
 */
adminRouter.put('/:id', async (req, res) => {
  try {
    const calendar = await Calendar.findById(req.params.id).populate('createdBy', 'username name');
    if (!calendar) {
      return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    }

    const { payload, errors } = validateCalendarPayload(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ error: errors.join(' ') });
    }
    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    }

    const previousSnapshot = calendar.toObject();

    await createCalendarBackup(calendar, { reason: '관리자 조치', actorId: req.user.id });

    const notifyBeforeChanged = Object.prototype.hasOwnProperty.call(payload, 'notifyBefore')
      && payload.notifyBefore !== previousSnapshot.notifyBefore;

    Object.assign(calendar, payload);

    if (notifyBeforeChanged) {
      calendar.reminderStatus = new Map();
      calendar.markModified('reminderStatus');
    }

    await calendar.save();

    await recordAdminActivity(req, {
      action: 'calendar.update',
      targetId: calendar._id,
      description: '관리자가 일정을 수정했습니다.',
      metadata: { fields: Object.keys(payload) },
    });

    await calendarNotifyService.sendUpdateNotice(previousSnapshot, calendar, {
      actor: req.user,
      rawBody: req.body,
    });

    return res.json({ event: formatCalendar(calendar) });
  } catch (error) {
    logger.error(`[calendar][admin] 일정 수정 실패: ${error.message}`);
    return res.status(500).json({ error: '관리자 일정 수정 중 오류가 발생했습니다.' });
  }
});

/**
 * 일정 영구 삭제 (하드 삭제)
 */
adminRouter.delete('/:id', async (req, res) => {
  try {
    const calendar = await Calendar.findById(req.params.id);
    if (!calendar) {
      return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    }

    await createCalendarBackup(calendar, { reason: '관리자 조치', actorId: req.user.id });
    await Calendar.deleteOne({ _id: calendar._id });

    await recordAdminActivity(req, {
      action: 'calendar.delete',
      targetId: calendar._id,
      description: '관리자가 일정을 영구 삭제했습니다.',
    });

    return res.json({ message: '일정을 영구 삭제했습니다.' });
  } catch (error) {
    logger.error(`[calendar][admin] 일정 영구 삭제 실패: ${error.message}`);
    return res.status(500).json({ error: '일정을 영구 삭제하는 중 오류가 발생했습니다.' });
  }
});

/**
 * 백업 히스토리 전체 조회
 */
adminRouter.get('/backups', async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit || 100, 10), 200);
    const backups = await CalendarBackup.find({})
      .sort({ backedUpAt: -1 })
      .limit(Number.isNaN(limit) ? 100 : limit)
      .lean();

    return res.json({ backups: backups.map(formatBackup) });
  } catch (error) {
    logger.error(`[calendar][admin] 백업 목록 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '백업 목록을 조회하는 중 오류가 발생했습니다.' });
  }
});

/**
 * 특정 일정의 백업 이력 조회
 */
adminRouter.get('/backups/:originalId', async (req, res) => {
  try {
    const backups = await CalendarBackup.find({ originalId: req.params.originalId })
      .sort({ backedUpAt: -1 })
      .lean();

    return res.json({ backups: backups.map(formatBackup) });
  } catch (error) {
    logger.error(`[calendar][admin] 일정 백업 이력 조회 실패: ${error.message}`);
    return res.status(500).json({ error: '백업 이력을 조회하는 중 오류가 발생했습니다.' });
  }
});

// 관리자 보호 라우터 등록
router.use('/admin', requireAdmin, adminRouter);

module.exports = router;
