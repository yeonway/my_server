const express = require('express');
const Poll = require('../models/Poll');
const AdminActivity = require('../models/adminActivity');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

// 모든 투표 API는 로그인 사용자를 대상으로 동작한다.
router.use(authenticateToken);

function isAdminUser(user = {}) {
  return ['admin', 'superadmin', 'manager'].includes(user.role);
}

function canManagePoll(poll, user = {}) {
  if (!poll || !user) return false;
  if (isAdminUser(user)) return true;
  if (!poll.createdBy) return false;
  const creatorId = poll.createdBy._id
    ? poll.createdBy._id.toString()
    : poll.createdBy.toString();
  return creatorId === user.id;
}

async function recordAdminActivity(user, { action, targetId, description, metadata }) {
  try {
    if (!user || !isAdminUser(user)) return;
    await AdminActivity.create({
      admin: user.id,
      action,
      targetType: 'poll',
      targetId: targetId ? targetId.toString() : '',
      description: description || '',
      metadata: metadata || null,
    });
  } catch (error) {
    logger.warn(`[poll][adminActivity] 기록 실패: ${error.message}`);
  }
}

function sanitizeOptions(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        return { text: item.trim() };
      }
      if (item && typeof item.text === 'string') {
        return { text: item.text.trim() };
      }
      return null;
    })
    .filter((option) => option && option.text.length > 0)
    .map((option) => ({
      text: option.text,
      votesCount: 0,
    }));
}

function validatePollPayload(body = {}, { partial = false } = {}) {
  const errors = [];
  const payload = {};

  if (!partial || body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      errors.push('제목은 필수입니다.');
    } else if (title.length > 100) {
      errors.push('제목은 100자 이하여야 합니다.');
    } else {
      payload.title = title;
    }
  }

  if (!partial || body.description !== undefined) {
    payload.description = typeof body.description === 'string'
      ? body.description.trim()
      : '';
  }

  if (!partial || body.options !== undefined) {
    const options = sanitizeOptions(body.options);
    if (!options.length && !partial) {
      errors.push('옵션은 2개 이상 입력해 주세요.');
    } else if (options.length && options.length < 2) {
      errors.push('옵션은 최소 2개 이상이어야 합니다.');
    } else if (options.length) {
      payload.options = options;
    }
  }

  if (!partial || body.multiple !== undefined) {
    payload.multiple = Boolean(body.multiple);
  }

  if (!partial || body.anonymous !== undefined) {
    payload.anonymous = body.anonymous === false ? false : true;
  }

  if (!partial || body.deadline !== undefined) {
    if (!body.deadline) {
      payload.deadline = null;
    } else {
      const deadline = body.deadline instanceof Date ? body.deadline : new Date(body.deadline);
      if (Number.isNaN(deadline.getTime())) {
        errors.push('마감일을 올바르게 입력해 주세요.');
      } else {
        payload.deadline = deadline;
      }
    }
  }

  if (!partial || body.isClosed !== undefined) {
    payload.isClosed = Boolean(body.isClosed);
  }

  return { payload, errors };
}

function computeEffectiveClosed(poll) {
  if (!poll) return true;
  if (poll.isClosed) return true;
  if (poll.deadline) {
    const now = new Date();
    if (new Date(poll.deadline).getTime() < now.getTime()) {
      return true;
    }
  }
  return false;
}

function buildResults(poll) {
  if (!poll) return null;
  const totalVotes = poll.options.reduce((sum, option) => sum + (option.votesCount || 0), 0);
  return {
    totalVotes,
    options: poll.options.map((option, index) => ({
      index,
      text: option.text,
      votesCount: option.votesCount || 0,
      percentage: totalVotes === 0 ? 0 : Math.round((option.votesCount / totalVotes) * 1000) / 10,
    })),
  };
}

function formatPoll(poll, { user } = {}) {
  if (!poll) return null;
  const data = typeof poll.toObject === 'function' ? poll.toObject() : poll;
  const effectiveClosed = computeEffectiveClosed(data);
  const userId = user?.id;
  const hasVoted = userId ? data.voters?.some((entry) => entry.user?.toString() === userId) : false;
  const totalVotes = data.options?.reduce((sum, option) => sum + (option.votesCount || 0), 0) || 0;
  const createdBy = data.createdBy;

  return {
    id: data._id ? data._id.toString() : data.id,
    title: data.title,
    description: data.description || '',
    options: (data.options || []).map((option, index) => ({
      index,
      text: option.text,
      votesCount: option.votesCount || 0,
    })),
    multiple: Boolean(data.multiple),
    anonymous: Boolean(data.anonymous),
    deadline: data.deadline || null,
    isClosed: effectiveClosed,
    isDeleted: Boolean(data.isDeleted),
    totalVotes,
    hasVoted,
    canVote: !effectiveClosed && !hasVoted && !data.isDeleted,
    createdBy: createdBy && createdBy._id
      ? {
          id: createdBy._id.toString(),
          username: createdBy.username || null,
          name: createdBy.name || null,
        }
      : createdBy
        ? createdBy.toString()
        : null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

// 투표 생성
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { payload, errors } = validatePollPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join(' ') });
    }
    if (!payload.options || payload.options.length < 2) {
      return res.status(400).json({ error: '옵션은 최소 2개 이상 입력해 주세요.' });
    }

    const poll = await Poll.create({
      ...payload,
      createdBy: req.user.id,
    });
    await poll.populate('createdBy', 'username name');

    if (req.userLogger) {
      req.userLogger('info', `[poll] 투표 생성 ${poll._id}`);
    }

    return res.status(201).json({ poll: formatPoll(poll, { user: req.user }) });
  } catch (error) {
    logger.error(`[poll] create failed: ${error.message}`);
    return res.status(500).json({ error: '투표 생성 중 오류가 발생했습니다.' });
  }
});

// 투표 목록
router.get('/', async (req, res) => {
  try {
    const filter = { isDeleted: false };
    const status = req.query.status;
    const now = new Date();

    if (status === 'active') {
      filter.isClosed = false;
      filter.$or = [{ deadline: null }, { deadline: { $gte: now } }];
    } else if (status === 'closed') {
      filter.$or = [
        { isClosed: true },
        { deadline: { $lt: now } },
      ];
    }

    if (req.query.search) {
      filter.$text = { $search: req.query.search.trim() };
    }

    const polls = await Poll.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'username name')
      .lean({ virtuals: false });

    const formatted = polls.map((poll) =>
      formatPoll(poll, { user: req.user || null })
    );

    return res.json({ polls: formatted });
  } catch (error) {
    logger.error(`[poll] list failed: ${error.message}`);
    return res.status(500).json({ error: '투표 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

// 투표 상세
router.get('/:id', async (req, res) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, isDeleted: false })
      .populate('createdBy', 'username name');
    if (!poll) {
      return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    }

    return res.json({ poll: formatPoll(poll, { user: req.user || null }) });
  } catch (error) {
    logger.error(`[poll] detail failed: ${error.message}`);
    return res.status(500).json({ error: '투표 정보를 불러오는 중 오류가 발생했습니다.' });
  }
});

// 투표하기
router.post('/:id/vote', authenticateToken, async (req, res) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, isDeleted: false });
    if (!poll) {
      return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    }

    await poll.populate('createdBy', 'username name');

    if (computeEffectiveClosed(poll)) {
      poll.isClosed = true;
      await poll.save();
      return res.status(400).json({ error: '이미 종료된 투표입니다.' });
    }

    if (poll.hasUserVoted(req.user.id)) {
      return res.status(400).json({ error: '이미 투표에 참여했습니다.' });
    }

    let selections = req.body.selections ?? req.body.selectedOptionIndexes ?? req.body.optionIndexes;
    if (selections === undefined || selections === null) {
      return res.status(400).json({ error: '선택한 옵션이 없습니다.' });
    }

    if (!Array.isArray(selections)) {
      selections = [selections];
    }

    const normalized = Array.from(new Set(selections.map((value) => Number.parseInt(value, 10))))
      .filter((value) => Number.isInteger(value));

    if (!normalized.length) {
      return res.status(400).json({ error: '올바른 옵션을 선택해 주세요.' });
    }

    if (!poll.multiple && normalized.length !== 1) {
      return res.status(400).json({ error: '단일 선택 투표입니다. 하나만 선택해 주세요.' });
    }

    if (poll.multiple && normalized.some((idx) => idx < 0 || idx >= poll.options.length)) {
      return res.status(400).json({ error: '선택한 옵션이 존재하지 않습니다.' });
    }

    if (!poll.multiple && (normalized[0] < 0 || normalized[0] >= poll.options.length)) {
      return res.status(400).json({ error: '선택한 옵션이 존재하지 않습니다.' });
    }

    normalized.forEach((index) => {
      poll.options[index].votesCount = (poll.options[index].votesCount || 0) + 1;
    });

    poll.voters.push({
      user: req.user.id,
      selectedOptionIndexes: normalized,
      votedAt: new Date(),
    });

    await poll.save();

    if (req.userLogger) {
      req.userLogger('info', `[poll] 투표 참여 poll=${poll._id} selections=${normalized.join(',')}`);
    }

    const formatted = formatPoll(poll, { user: req.user });
    const results = buildResults(poll);
    return res.json({ poll: formatted, results });
  } catch (error) {
    logger.error(`[poll] vote failed: ${error.message}`);
    return res.status(500).json({ error: '투표 참여 중 오류가 발생했습니다.' });
  }
});

// 투표 수정
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, isDeleted: false })
      .populate('createdBy', 'username name');
    if (!poll) {
      return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    }

    if (!canManagePoll(poll, req.user)) {
      return res.status(403).json({ error: '수정 권한이 없습니다.' });
    }

    const { payload, errors } = validatePollPayload(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    if (payload.options) {
      const totalVotes = poll.totalVotes();
      if (totalVotes > 0) {
        return res.status(400).json({ error: '이미 투표가 진행된 이후에는 옵션을 수정할 수 없습니다.' });
      }
      if (payload.options.length < 2) {
        return res.status(400).json({ error: '옵션은 최소 2개 이상이어야 합니다.' });
      }
      poll.options = payload.options;
      poll.voters = [];
    }

    if (payload.title !== undefined) poll.title = payload.title;
    if (payload.description !== undefined) poll.description = payload.description;
    if (payload.multiple !== undefined) poll.multiple = payload.multiple;
    if (payload.anonymous !== undefined) poll.anonymous = payload.anonymous;
    if (payload.deadline !== undefined) poll.deadline = payload.deadline;
    if (payload.isClosed !== undefined) poll.isClosed = payload.isClosed;

    await poll.save();

    if (isAdminUser(req.user)) {
      await recordAdminActivity(req.user, {
        action: 'poll.update',
        targetId: poll._id,
        description: '투표 수정',
        metadata: { fields: Object.keys(payload) },
      });
    }

    return res.json({ poll: formatPoll(poll, { user: req.user }) });
  } catch (error) {
    logger.error(`[poll] update failed: ${error.message}`);
    return res.status(500).json({ error: '투표 수정 중 오류가 발생했습니다.' });
  }
});

// 투표 종료
router.post('/:id/close', authenticateToken, async (req, res) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, isDeleted: false })
      .populate('createdBy', 'username name');
    if (!poll) {
      return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    }

    if (!canManagePoll(poll, req.user)) {
      return res.status(403).json({ error: '종료 권한이 없습니다.' });
    }

    if (poll.isClosed) {
      return res.status(400).json({ error: '이미 종료된 투표입니다.' });
    }

    poll.isClosed = true;
    await poll.save();

    if (isAdminUser(req.user)) {
      await recordAdminActivity(req.user, {
        action: 'poll.close',
        targetId: poll._id,
        description: '투표 종료',
      });
    }

    return res.json({ poll: formatPoll(poll, { user: req.user }) });
  } catch (error) {
    logger.error(`[poll] close failed: ${error.message}`);
    return res.status(500).json({ error: '투표 종료 중 오류가 발생했습니다.' });
  }
});

// 투표 삭제 (소프트 삭제)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, isDeleted: false })
      .populate('createdBy', 'username name');
    if (!poll) {
      return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    }

    if (!canManagePoll(poll, req.user)) {
      return res.status(403).json({ error: '삭제 권한이 없습니다.' });
    }

    poll.isDeleted = true;
    poll.isClosed = true;
    await poll.save();

    if (isAdminUser(req.user)) {
      await recordAdminActivity(req.user, {
        action: 'poll.delete',
        targetId: poll._id,
        description: '투표 삭제',
      });
    }

    return res.json({ message: '투표가 삭제되었습니다.' });
  } catch (error) {
    logger.error(`[poll] delete failed: ${error.message}`);
    return res.status(500).json({ error: '투표 삭제 중 오류가 발생했습니다.' });
  }
});

// 투표 결과
router.get('/:id/results', async (req, res) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, isDeleted: false });
    if (!poll) {
      return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    }

    const results = buildResults(poll);
    return res.json({ results });
  } catch (error) {
    logger.error(`[poll] results failed: ${error.message}`);
    return res.status(500).json({ error: '투표 결과를 불러오는 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
