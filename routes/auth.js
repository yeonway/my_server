// routes/auth.js
const express = require("express");
const router = express.Router();
const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { JWT_SECRET } = require('../config/secrets');
const { attachSessionCookie, readSessionToken, clearSessionCookie } = require('../config/session');
const { isLocked, registerFail, clearRecord, getStatus, MAX_FAIL, LOCK_MINUTES } = require('../config/loginLock');

function normalizeUsername(u) {
  return (u || "").trim();
}

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

function sanitizeRegisteredAccounts(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  const unique = [];
  const seen = new Set();
  raw.forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    unique.push(trimmed);
  });
  return unique;
}

function validateCred(username, password) {
  if (!username || !password) return "아이디와 비밀번호를 입력해주세요.";
  if (password.length < 4) return "비밀번호는 4자 이상이어야 합니다.";
  return null;
}

function signUserToken(user) {
  return jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
}

async function ensureSuperAdmin(user) {
  if (user.username === "admin" && user.role !== "superadmin") {
    user.role = "superadmin";
    await user.save();
  }
}

/** 회원가입: 비밀번호는 pre-save 훅에서 해싱됩니다. */
router.post("/register", async (req, res) => {
  try {
    let { username, password } = req.body || {};
    username = normalizeUsername(username);

    const errMsg = validateCred(username, password);
    if (errMsg) return res.status(400).json({ error: errMsg });

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "이미 존재하는 사용자입니다." });
    }

    const user = new User({
      username,
      password,
      role: "user",
    });
    await user.save();

    res.status(201).json({ message: "회원가입이 완료되었습니다." });
  } catch (err) {
    logger.error("register error: " + err.message);
    res.status(500).json({ error: "회원가입 처리 중 오류가 발생했습니다." });
  }
});

// 로그인
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  try {
    logger.info(`[LOGIN][REQ] username=${username}`);

    if (!username || !password)
      return res.status(400).json({ error: "아이디와 비밀번호가 필요합니다." });

    if (isLocked(username)) {
      const st = getStatus(username);
      return res.status(423).json({
        error: `계정이 잠겨 있습니다. ${Math.ceil(st.remainMs / 60000)}분 후 다시 시도해주세요.`,
        locked: true
      });
    }

    const user = await User.findOne({ username });
    if (!user) {
      const rec = registerFail(username);
      const left = Math.max(0, MAX_FAIL - rec.fails);
      return res.status(400).json({
        error: "아이디 또는 비밀번호가 올바르지 않습니다.",
        attemptsLeft: left > 0 ? left : 0,
        locked: rec.lockedUntil > Date.now()
      });
    }

    if (!user.password)
      return res.status(500).json({ error: "서버 오류" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const rec = registerFail(username);
      const left = Math.max(0, MAX_FAIL - rec.fails);
      if (rec.lockedUntil > Date.now()) {
        return res.status(423).json({
          error: `연속 실패로 잠금되었습니다. ${LOCK_MINUTES}분 후 다시 시도해주세요.`,
          locked: true
        });
      }
      return res.status(400).json({
        error: "아이디 또는 비밀번호가 올바르지 않습니다.",
        attemptsLeft: left,
        locked: false
      });
    }

    clearRecord(username);
    await ensureSuperAdmin(user);

    try {
      const sanitizedAccounts = sanitizeRegisteredAccounts(req.body?.registeredAccounts);
      const clientIp = getClientIp(req);
      let shouldSave = false;

      if (sanitizedAccounts.length) {
        const ownerKey = sanitizedAccounts[0] || user.username;
        if (!user.signupOwner || user.signupOwner !== ownerKey) {
          user.signupOwner = ownerKey;
          shouldSave = true;
        }
        let orderIndex = sanitizedAccounts.findIndex((value) => value === user.username);
        if (orderIndex === -1) {
          sanitizedAccounts.push(user.username);
          orderIndex = sanitizedAccounts.length - 1;
        }
        const desiredOrder = orderIndex + 1;
        if (!user.signupOrder || user.signupOrder !== desiredOrder) {
          user.signupOrder = desiredOrder;
          shouldSave = true;
        }
      } else {
        if (!user.signupOwner) {
          user.signupOwner = user.username;
          shouldSave = true;
        }
        if (!user.signupOrder) {
          user.signupOrder = 1;
          shouldSave = true;
        }
      }

      if (clientIp && user.signupIp !== clientIp) {
        user.signupIp = clientIp;
        shouldSave = true;
      }

      if (shouldSave) {
        await user.save();
      }
    } catch (linkError) {
      logger.warn(`[LOGIN][LINK_FAIL] ${username}: ${linkError.message}`);
    }

    const token = signUserToken(user);
    attachSessionCookie(res, token);

    logger.info(`[LOGIN][OK] ${username}`);
    res.json({ token });
  } catch (err) {
    logger.error(`[LOGIN][ERROR] ${err.message}`);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 세션 토큰 갱신
router.post("/refresh", async (req, res) => {
  try {
    const headerToken = req.headers.authorization?.split(" ")[1];
    const sessionToken = headerToken || readSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: "세션이 만료되었습니다." });
    }
    let decoded;
    try {
      decoded = jwt.verify(sessionToken, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        decoded = jwt.verify(sessionToken, JWT_SECRET, { ignoreExpiration: true });
      } else {
        throw err;
      }
    }
    const user = await User.findById(decoded.id);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "사용자를 찾을 수 없습니다." });
    }
    await ensureSuperAdmin(user);
    const token = signUserToken(user);
    attachSessionCookie(res, token);
    res.json({ token, user: { id: user._id, username: user.username, role: user.role, permissions: user.adminPermissions || [] } });
  } catch (err) {
    logger.warn(`[REFRESH][FAIL] ${err.message}`);
    clearSessionCookie(res);
    res.status(401).json({ error: "세션 갱신에 실패했습니다." });
  }
});

// 현재 사용자 정보 확인 (토큰 기반)
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    res.json(user);
  } catch (err) {
    logger.error(`Error fetching user /me: ${err.message}`);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 비밀번호 변경
router.post("/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });

    let ok = false;
    if (user.password?.startsWith("$2")) {
      ok = await bcrypt.compare(currentPassword, user.password);
    } else {
      ok = currentPassword === user.password; // (예외) 기존 평문 비밀번호 지원
    }
    if (!ok) return res.status(400).json({ error: "현재 비밀번호가 일치하지 않습니다." });

    user.password = newPassword; // pre-save 훅에서 해싱
    await user.save();

    res.json({ message: "비밀번호가 변경되었습니다." });
  } catch (err) {
    logger.error("change-password error: " + err.message);
    res.status(500).json({ error: "비밀번호 변경에 실패했습니다." });
  }
});

module.exports = router;
