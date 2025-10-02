const jwt = require("jsonwebtoken");
const User = require("../models/user");
const { JWT_SECRET } = require("../config/secrets");
const { readSessionToken } = require("../config/session");
const { userLog } = require('../config/userLogger');

const PERMISSION_GROUPS = {
  user_management: ['user_management', 'user_manage'],
  post_management: ['post_management', 'post_manage'],
  report_management: ['report_management', 'report_manage'],
  inquiry_management: ['inquiry_management', 'inquiry_manage'],
  content_management: ['content_management', 'word_management', 'word_manage', 'content_manage'],
  log_view: ['log_view', 'logs_view', 'view_logs']
};

const PERMISSION_LOOKUP = new Map();
for (const [canonical, aliases] of Object.entries(PERMISSION_GROUPS)) {
  aliases.forEach(alias => {
    PERMISSION_LOOKUP.set(alias, canonical);
    PERMISSION_LOOKUP.set(canonical, canonical);
  });
}

function normalizePermission(value) {
  return PERMISSION_LOOKUP.get(value) || value;
}

function resolveToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  return readSessionToken(req);
}

function verifyToken(req, res, next) {
  const token = resolveToken(req);
  if (!token) return res.status(401).json({ error: "토큰 없음" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "토큰이 유효하지 않습니다." });
  }
}

async function authMiddleware(req, res, next) {
  try {
    const token = resolveToken(req);
    if (!token) return res.status(401).json({ error: "토큰 없음" });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).lean();
    if (!user) return res.status(401).json({ error: "유저 없음" });
    req.user = {
      id: user._id.toString(),
      username: user.username,
      role: user.role || "user",
      adminPermissions: Array.isArray(user.adminPermissions) ? user.adminPermissions : [],
    };
    req.userLogger = (level, msg) => userLog(req.user.username, level, msg);
    next();
  } catch {
    return res.status(401).json({ error: "유효하지 않은 토큰" });
  }
}

function requirePermission(permission) {
  const required = normalizePermission(permission);
  return async function (req, res, next) {
    await authMiddleware(req, res, async () => {
      if (req.user.role === "superadmin") return next();
      const userPerms = (req.user.adminPermissions || []).map(normalizePermission);
      if (userPerms.includes(required)) return next();
      return res.status(403).json({ error: `권한 부족: ${permission}` });
    });
  };
}

module.exports = { authMiddleware, requirePermission, verifyToken };
