// routes/users.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/secrets");
const User = require("../models/user");
const Post = require("../models/post");
const { authMiddleware } = require("../middleware/auth");
const logger = require('../config/logger');
const { attachSessionCookie, clearSessionCookie } = require('../config/session');
const { recordLoginAttempt } = require('../services/accountSecurityService');

function ensureJwtSecret(res) {
  if (!JWT_SECRET) {
    logger.error('JWT secret is not configured.');
    res.status(500).json({ error: '서버 설정 오류로 요청을 처리할 수 없습니다.' });
    return false;
  }
  return true;
}

// IP별 최근 가입 기록을 저장할 간단한 캐시
const recentSignups = new Map();

const SIGNUP_LIMIT = Number(process.env.SIGNUP_LIMIT || 5);
const ENV_BYPASS_IPS = (process.env.SIGNUP_LIMIT_BYPASS_IPS || '')
  .split(',')
  .map(ip => ip.trim())
  .filter(Boolean);
const DEFAULT_BYPASS_IPS = ['127.0.0.1', '::1'];
const SIGNUP_BYPASS_SET = new Set([...DEFAULT_BYPASS_IPS, ...ENV_BYPASS_IPS]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeIp(ip = '') {
  return ip.replace(/^::ffff:/i, '');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return normalizeIp(first);
  }
  const direct = req.ip || req.connection?.remoteAddress || '';
  return normalizeIp(direct);
}

function isSignupLimitBypassed(req) {
  const ip = getClientIp(req);
  return ip ? SIGNUP_BYPASS_SET.has(ip) : false;
}

function resolveOwnerKey(userDoc) {
  if (!userDoc) return null;
  return userDoc.signupOwner || userDoc.username;
}

async function findRelatedAccounts(rootUser) {
  if (!rootUser) return [];

  const ownerKeys = new Set();
  const knownIps = new Set();
  const enqueue = (value) => {
    if (!value) return;
    const trimmed = String(value).trim();
    if (!trimmed || ownerKeys.has(trimmed)) return;
    ownerKeys.add(trimmed);
    pendingKeys.push(trimmed);
  };

  const pendingKeys = [];
  enqueue(resolveOwnerKey(rootUser));
  enqueue(rootUser.username);
  enqueue(rootUser.signupOwner);
  if (rootUser.signupIp) {
    knownIps.add(rootUser.signupIp);
  }

  const collected = new Map();

  async function drainQueue() {
    while (pendingKeys.length) {
      const currentKeys = Array.from(new Set(pendingKeys.splice(0, pendingKeys.length)));
      if (!currentKeys.length) break;

      const relatedUsers = await User.find({
        $or: [
          { signupOwner: { $in: currentKeys } },
          { username: { $in: currentKeys } }
        ]
      })
        .select('_id username name email signupOwner signupOrder signupIp suspended createdAt updatedAt role')
        .lean();

      for (const account of relatedUsers) {
        if (!account || !account.username) continue;
        if (!collected.has(account.username)) {
          collected.set(account.username, account);
          enqueue(account.signupOwner);
          enqueue(account.username);
          if (account.signupIp) knownIps.add(account.signupIp);
        }
      }
    }
  }

  await drainQueue();

  if (knownIps.size) {
    const extraUsers = await User.find({
      signupIp: { $in: Array.from(knownIps) },
      username: { $nin: Array.from(collected.keys()) }
    })
      .select('_id username name email signupOwner signupOrder signupIp suspended createdAt updatedAt role')
      .lean();

    for (const account of extraUsers) {
      if (!account || !account.username) continue;
      if (collected.has(account.username)) continue;
      collected.set(account.username, account);
      enqueue(account.signupOwner);
      enqueue(account.username);
      if (account.signupIp) knownIps.add(account.signupIp);
    }
  }

  await drainQueue();

  if (!collected.has(rootUser.username)) {
    collected.set(rootUser.username, {
      _id: rootUser._id,
      username: rootUser.username,
      name: rootUser.name,
      email: rootUser.email,
      signupOwner: rootUser.signupOwner,
      signupOrder: rootUser.signupOrder,
      signupIp: rootUser.signupIp,
      suspended: rootUser.suspended,
      createdAt: rootUser.createdAt,
      updatedAt: rootUser.updatedAt,
      role: rootUser.role
    });
  }

  return Array.from(collected.values());
}

router.get('/signup/config', (req, res) => {
  res.json({
    limit: SIGNUP_LIMIT,
    bypass: isSignupLimitBypassed(req)
  });
});

// 로그인
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      logger.warn(`Login failed - user not found: ${username}`);
      if (req.userLogger) req.userLogger('warn', `로그인 실패 - 사용자 없음: ${username}`);
      return res.status(400).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    if (user.accountStatus === 'pending_deletion') {
      await recordLoginAttempt({
        userId: user._id,
        username: user.username,
        ipAddress,
        userAgent,
        success: false,
      });
      return res.status(403).json({ error: "삭제가 예약된 계정입니다. 고객센터에 문의하세요." });
    }

    if (user.accountStatus === 'deactivated') {
      await recordLoginAttempt({
        userId: user._id,
        username: user.username,
        ipAddress,
        userAgent,
        success: false,
      });
      return res.status(403).json({ error: "비활성화된 계정입니다. 다시 활성화하려면 고객센터에 문의하세요." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn(`Login failed - wrong password: ${username}`);
      if (req.userLogger) req.userLogger('warn', `로그인 실패 - 잘못된 비밀번호: ${username}`);
      await recordLoginAttempt({
        userId: user._id,
        username: user.username,
        ipAddress,
        userAgent,
        success: false,
      });
      return res.status(400).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    if (!ensureJwtSecret(res)) {
      return;
    }
    const token = jwt.sign(
      { id: user._id, username: user.username, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
    logger.info(`Login success: ${username}`);
    if (req.userLogger) req.userLogger('info', `로그인 성공: ${username}`);
    await recordLoginAttempt({
      userId: user._id,
      username: user.username,
      ipAddress,
      userAgent,
      success: true,
    });
    res.json({ token });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    res.status(500).json({ error: "로그인 중 오류가 발생했습니다." });
  }
});

// 회원가입 (쿠키 기록 추가)
router.post("/signup", async (req, res) => {
  try {
    // 브라우저에서 전달된 가입 기록(최대 3개) 확인 - 헤더에서 받는 것이 아니라 body에서 받음
    let registeredAccounts = [];
    try {
      registeredAccounts = req.body.registeredAccounts || [];
    } catch {}
    if (!Array.isArray(registeredAccounts)) {
      registeredAccounts = [];
    } else {
      const unique = [];
      const seen = new Set();
      for (const raw of registeredAccounts) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        unique.push(trimmed);
      }
      registeredAccounts = unique;
    }
    const bypassLimit = isSignupLimitBypassed(req);
    if (!bypassLimit && registeredAccounts.length >= SIGNUP_LIMIT) {
      logger.warn(
        `Signup blocked - limit ${SIGNUP_LIMIT} reached from one browser: ${registeredAccounts.join(', ')} / 시도: ${req.body.username}`
      );
      return res.status(429).json({ error: `이 브라우저에서는 최대 ${SIGNUP_LIMIT}개 계정까지만 가입할 수 있습니다.` });
    }

    // 기존 로그인 상태 확인 로직...
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        if (!ensureJwtSecret(res)) {
          return;
        }
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded) {
          logger.warn(
            `Signup blocked - already logged in: ${decoded.username} tried to signup with ${req.body.username}`
          );
          return res.status(403).json({ error: "로그인 상태에서는 회원가입을 진행할 수 없습니다." });
        }
      } catch (tokenError) {}
    }

    const { username, password, name } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ error: "모든 필드를 입력해주세요." });
    }

    let user = await User.findOne({ username });
    if (user) {
      logger.warn(`Signup failed - user exists: ${username}`);
      return res.status(400).json({ error: "이미 존재하는 아이디입니다." });
    }

    const signupOwner = registeredAccounts[0] || username;
    const signupOrder = registeredAccounts.length + 1;
    const signupIp = getClientIp(req);

    // password는 평문으로 넘김 (pre-save에서 해싱됨)
    user = new User({
      username,
      password,
      name,
      signupOwner,
      signupOrder,
      signupIp
    });
    await user.save();

    logger.info(`Signup success: ${username} (${name}) owner=${signupOwner} order=${signupOrder} ip=${signupIp}`);
    res.status(201).json({ message: "회원가입이 완료되었습니다." });
  } catch (err) {
    logger.error(`Signup error: ${err.message}`);
    res.status(500).json({ error: "회원가입 처리 중 오류가 발생했습니다." });
  }
});

// 메모리 정리 (24시간마다 오래된 기록 삭제)
setInterval(() => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const [ip, time] of recentSignups.entries()) {
    if (time < oneDayAgo) {
      recentSignups.delete(ip);
    }
  }
}, 24 * 60 * 60 * 1000);

// 로그아웃 API 추가
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    logger.info(`Logout: ${req.user.username}`);
    if (req.userLogger) req.userLogger('info', `로그아웃: ${req.user.username}`);
    clearSessionCookie(res);
    res.json({ message: "로그아웃 되었습니다." });
  } catch (err) {
    logger.error(`Logout error: ${err.message}`);
    res.status(500).json({ error: "로그아웃 중 오류가 발생했습니다." });
  }
});

// --- 프로필 활동 내역 API ---

// 👤 현재 로그인한 사용자가 작성한 게시글 목록 조회
router.get("/profile/posts", authMiddleware, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user.id, deleted: { $ne: true } })
      .sort({ time: -1 })
      .select('title time')
      .lean();
    res.json(posts);
  } catch (err) {
    console.error("Error fetching user posts:", err);
    res.status(500).json({ error: "게시글을 불러오는 중 오류가 발생했습니다." });
  }
});

// 👤 현재 로그인한 사용자가 작성한 댓글 목록 조회
router.get("/profile/comments", authMiddleware, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const userId = new mongoose.Types.ObjectId(req.user.id);

    const myComments = await Post.aggregate([
      { $unwind: "$comments" },
      { $match: { "comments.author": userId, "deleted": { $ne: true } } },
      { $sort: { "comments.time": -1 } },
      {
        $project: {
          _id: "$comments._id",
          content: "$comments.content",
          time: "$comments.time",
          postId: "$_id",
          postTitle: "$title"
        }
      }
    ]);
    res.json(myComments);
  } catch (err) {
    console.error("Error fetching user comments:", err);
    res.status(500).json({ error: "댓글을 불러오는 중 오류가 발생했습니다." });
  }
});

router.get('/accounts', authMiddleware, async (req, res) => {
  try {
    const me = await User.findById(req.user.id)
      .select('_id username name email signupOwner signupOrder signupIp suspended createdAt updatedAt role');
    if (!me) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const accounts = await findRelatedAccounts(me);

    if (!accounts.length) {
      return res.json({
        owner: resolveOwnerKey(me) || me.username,
        current: me.username,
        accounts: [
          {
            username: me.username,
            name: me.name || '',
            email: me.email || '',
            signupOrder: me.signupOrder || 1,
            suspended: Boolean(me.suspended),
            isCurrent: true,
            isOwner: true,
            createdAt: me.createdAt,
            updatedAt: me.updatedAt
          }
        ]
      });
    }

    accounts.sort((a, b) => {
      const orderA = typeof a.signupOrder === 'number' ? a.signupOrder : 999;
      const orderB = typeof b.signupOrder === 'number' ? b.signupOrder : 999;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

    const formatted = accounts.map((account) => ({
      username: account.username,
      name: account.name || '',
      email: account.email || '',
      signupOrder: account.signupOrder || 1,
      suspended: Boolean(account.suspended),
      isCurrent: account.username === me.username,
      isOwner: resolveOwnerKey(account) === account.username,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    }));

    res.json({
      owner: resolveOwnerKey(me) || me.username,
      current: me.username,
      accounts: formatted
    });
  } catch (error) {
    logger.error(`Account list error: ${error.message}`);
    res.status(500).json({ error: '계정 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

router.post('/accounts/:username/switch', authMiddleware, async (req, res) => {
  try {
    const targetUsername = (req.params.username || '').trim();
    if (!targetUsername) {
      return res.status(400).json({ error: '전환할 계정을 지정해주세요.' });
    }

    const me = await User.findById(req.user.id)
      .select('_id username signupOwner signupIp role suspended adminPermissions name email createdAt updatedAt');
    if (!me) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const ownerKey = resolveOwnerKey(me);
    const target = await User.findOne({ username: targetUsername })
      .select('_id username signupOwner signupIp role suspended adminPermissions name email createdAt updatedAt');
    if (!target) {
      return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
    }

    const linkedAccounts = await findRelatedAccounts(me);
    const linkedUsernames = new Set(linkedAccounts.map((acc) => acc.username));
    if (!linkedUsernames.has(target.username)) {
      return res.status(403).json({ error: '같은 브라우저에서 연동된 계정만 전환할 수 있습니다.' });
    }

    if (target.suspended) {
      return res.status(403).json({ error: '정지된 계정은 전환할 수 없습니다.' });
    }

    if (!ensureJwtSecret(res)) {
      return;
    }
    const token = jwt.sign(
      {
        id: target._id,
        username: target.username,
        role: target.role || 'user'
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    attachSessionCookie(res, token);

    logger.info(`Account switch: ${me.username} -> ${target.username} (owner=${ownerKey})`);
    if (req.userLogger) req.userLogger('info', `계정 전환: ${me.username} -> ${target.username}`);

    res.json({
      token,
      username: target.username
    });
  } catch (error) {
    logger.error(`Account switch error: ${error.message}`);
    res.status(500).json({ error: '계정 전환 중 오류가 발생했습니다.' });
  }
});

router.delete('/accounts/:username', authMiddleware, async (req, res) => {
  try {
    const targetUsername = (req.params.username || '').trim();
    const { password } = req.body || {};

    if (!targetUsername) {
      return res.status(400).json({ error: '삭제할 계정을 지정해주세요.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: '계정 비밀번호를 입력해주세요.' });
    }

    const me = await User.findById(req.user.id)
      .select('_id username signupOwner signupIp name email createdAt updatedAt');
    if (!me) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const target = await User.findOne({ username: targetUsername });
    if (!target) {
      return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
    }

    const linkedAccounts = await findRelatedAccounts(me);
    const linkedUsernames = new Set(linkedAccounts.map((acc) => acc.username));
    if (!linkedUsernames.has(target.username)) {
      return res.status(403).json({ error: '같은 브라우저에서 연동된 계정만 삭제할 수 있습니다.' });
    }

    const passwordOk = await target.comparePassword(password);
    if (!passwordOk) {
      return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
    }

    await target.deleteOne();

    const deletedCurrent = target.username === me.username;

    logger.info(`Account deleted: ${target.username} by ${me.username} (owner=${ownerKey})`);
    if (req.userLogger) req.userLogger('warn', `계정 삭제: ${target.username}`);

    if (deletedCurrent) {
      clearSessionCookie(res);
    }

    res.json({
      message: '계정이 삭제되었습니다.',
      deletedCurrent
    });
  } catch (error) {
    logger.error(`Account delete error: ${error.message}`);
    res.status(500).json({ error: '계정 삭제 중 오류가 발생했습니다.' });
  }
});

router.post('/accounts/:username/email', authMiddleware, async (req, res) => {
  try {
    const targetUsername = (req.params.username || '').trim();
    const rawEmail = (req.body && req.body.email) || '';
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

    if (!targetUsername) {
      return res.status(400).json({ error: '이메일을 수정할 계정을 지정해주세요.' });
    }

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: '유효한 이메일 주소를 입력해주세요.' });
    }

    const me = await User.findById(req.user.id)
      .select('_id username signupOwner signupIp name email createdAt updatedAt');
    if (!me) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const target = await User.findOne({ username: targetUsername })
      .select('_id username signupOwner email');
    if (!target) {
      return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
    }

    const linkedAccounts = await findRelatedAccounts(me);
    const linkedUsernames = new Set(linkedAccounts.map((acc) => acc.username));
    if (!linkedUsernames.has(target.username)) {
      return res.status(403).json({ error: '같은 브라우저에서 연동된 계정만 수정할 수 있습니다.' });
    }

    target.email = email;
    await target.save();

    logger.info(`Account email update: ${target.username} by ${me.username} (owner=${ownerKey})`);
    if (req.userLogger) req.userLogger('info', `계정 이메일 수정: ${target.username}`);

    res.json({
      message: email ? '이메일이 등록되었습니다.' : '이메일이 삭제되었습니다.',
      email
    });
  } catch (error) {
    logger.error(`Account email error: ${error.message}`);
    res.status(500).json({ error: '이메일 저장 중 오류가 발생했습니다.' });
  }
});


router.get('/blocks', authMiddleware, async (req, res) => {
  try {
    const me = await User.findById(req.user.id)
      .populate('blockedUsers', 'username name photo profilePhoto')
      .lean();

    if (!me) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const blocks = Array.isArray(me.blockedUsers)
      ? me.blockedUsers.map((user) => ({
          id: user._id.toString(),
          username: user.username,
          name: user.name || '',
          photo: user.photo || user.profilePhoto || '',
        }))
      : [];

    res.json({ blocks });
  } catch (error) {
    logger.error(`Fetch blocks error: ${error.message}`);
    res.status(500).json({ error: '차단 목록을 불러오지 못했습니다.' });
  }
});

router.post('/blocks', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: '차단할 사용자를 선택해 주세요.' });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: '자기 자신은 차단할 수 없습니다.' });
    }

    const [me, target] = await Promise.all([
      User.findById(req.user.id).select('_id username blockedUsers'),
      User.findById(userId).select('_id username name photo profilePhoto'),
    ]);

    if (!me) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    if (!target) {
      return res.status(404).json({ error: '차단할 대상을 찾을 수 없습니다.' });
    }

    const alreadyBlocked = me.blockedUsers?.some(
      (value) => value.toString() === target._id.toString()
    );

    if (alreadyBlocked) {
      return res.status(200).json({
        blocked: {
          id: target._id.toString(),
          username: target.username,
          name: target.name || '',
          photo: target.photo || target.profilePhoto || '',
        },
        message: '이미 차단한 사용자입니다.',
      });
    }

    me.blockedUsers = Array.isArray(me.blockedUsers) ? me.blockedUsers : [];
    me.blockedUsers.push(target._id);
    await me.save();

    logger.info(`User block: ${me.username} -> ${target.username}`);
    if (req.userLogger) req.userLogger('info', `사용자 차단: ${target.username}`);

    res.status(201).json({
      blocked: {
        id: target._id.toString(),
        username: target.username,
        name: target.name || '',
        photo: target.photo || target.profilePhoto || '',
      },
    });
  } catch (error) {
    logger.error(`Create block error: ${error.message}`);
    res.status(500).json({ error: '사용자를 차단하지 못했습니다.' });
  }
});

router.delete('/blocks/:userId', authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (!targetId) {
      return res.status(400).json({ error: '차단 해제할 사용자를 지정해 주세요.' });
    }

    const me = await User.findById(req.user.id).select('_id username blockedUsers');
    if (!me) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const before = Array.isArray(me.blockedUsers) ? me.blockedUsers.length : 0;
    me.blockedUsers = (me.blockedUsers || []).filter(
      (value) => value.toString() !== targetId
    );

    if (me.blockedUsers.length === before) {
      return res.status(200).json({
        unblocked: targetId,
        message: '이미 차단 해제된 사용자입니다.',
      });
    }

    await me.save();

    logger.info(`User unblock: ${me.username} -> ${targetId}`);
    if (req.userLogger) req.userLogger('info', `사용자 차단 해제: ${targetId}`);

    res.json({ unblocked: targetId });
  } catch (error) {
    logger.error(`Delete block error: ${error.message}`);
    res.status(500).json({ error: '차단 해제 중 오류가 발생했습니다.' });
  }
});


module.exports = router;
