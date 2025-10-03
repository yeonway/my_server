// routes/admin.js

const express = require("express");

const router = express.Router();

const fs = require('fs').promises;

const path = require('path');

const os = require('os');

const multer = require('multer');

const mongoose = require('mongoose');

const { randomUUID } = require('crypto');

const User = require("../models/user");

const Post = require("../models/post");

const Message = require("../models/message");

const Statistic = require("../models/statistic");

const Comment = require("../models/comment");

const Report = require("../models/report");

const ForbiddenWord = require("../models/forbiddenWord");

const Inquiry = require("../models/inquiry");

const { requirePermission } = require("../middleware/auth");

const { updateForbiddenWordsCache } = require("../middleware/contentFilter");

const logger = require('../config/logger');
const { analyzeLogs } = require('../utils/logSummary');

const CHAT_AUDIT_USER = process.env.CHAT_AUDIT_USER || 'admin';

const LOG_DIRECTORY = path.join(__dirname, '..', 'logs');

const ADMIN_PERMISSION_KEYS = [
  'user_management',
  'post_management',
  'report_management',
  'inquiry_management',
  'content_management',
  'log_view',
];



const ensureRequestId = (req) => {

  if (!req.requestId) {

    req.requestId = req.headers['x-request-id'] || randomUUID();

  }

  return req.requestId;

};



const buildLogMeta = (req, action, extra = {}) => {

  const username = (req.user && req.user.username) || 'anonymous';

  const userId = (req.user && req.user.id) || null;

  return {

    requestId: ensureRequestId(req),

    userId,

    username,

    path: req.originalUrl,

    action,

    ts: new Date().toISOString(),

    ...extra

  };

};



const logInfo = (req, action, message, extra = {}) => {

  logger.info(message, buildLogMeta(req, action, extra));

};



const logError = (req, action, message, error, extra = {}) => {

  const errorMeta = {

    error: error?.message || error,

  };

  if (error && error.stack) {

    errorMeta.stack = error.stack;

  }

  logger.error(message, buildLogMeta(req, action, { ...extra, ...errorMeta }));

};



router.use((req, res, next) => {

  ensureRequestId(req);

  next();

});



async function buildReportPayload(reportDoc) {

  if (!reportDoc) {

    return null;

  }

  const report = reportDoc.toObject({ virtuals: false });

  let content = null;

  let parentPostId = null;



  try {

    if (report.contentType === "post") {

      const post = await Post.findById(report.contentId).select("title deleted");

      if (post) {

        content = { _id: post._id, title: post.title, deleted: !!post.deleted };

        parentPostId = post._id;

      }

    } else if (report.contentType === "comment") {

      const comment = await Comment.findById(report.contentId).select("content postId");

      if (comment) {

        content = { _id: comment._id, content: comment.content };

        parentPostId = comment.postId || null;

      }

    } else if (report.contentType === "chat") {

      const message = await Message.findById(report.contentId).select("room message");

      if (message) {

        content = { room: message.room, message: message.message };

      }

    }

  } catch (fetchError) {

    logger.warn("Failed to enrich report content", { reportId: report._id, error: fetchError });

  }



  return {

    _id: report._id,

    contentType: report.contentType,

    contentOwner: report.contentOwner,

    reporter: report.reporter,

    reason: report.reason,

    status: report.status,

    createdAt: report.createdAt,

    resolvedAt: report.resolvedAt,

    resolver: report.resolver,

    content,

    parentPostId

  };

}

function sanitizeIdentifier(value = '') {

  return value.replace(/[^a-zA-Z0-9_\-]/g, '_');

}



function parseLogLine(line) {

  if (!line) {

    return null;

  }

  const trimmed = line.trim();

  if (!trimmed) {

    return null;

  }

  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?)\s+(\w+):\s*(.*)$/);

  if (!match) {

    return {

      timestamp: new Date().toISOString(),

      level: 'info',

      message: trimmed

    };

  }

  const rawTimestamp = match[1].includes('T') ? match[1] : match[1].replace(' ', 'T');

  let isoTimestamp;

  try {

    const normalized = rawTimestamp.endsWith('Z') ? rawTimestamp : `${rawTimestamp}Z`;

    isoTimestamp = new Date(normalized).toISOString();

  } catch (err) {

    isoTimestamp = new Date().toISOString();

  }

  return {

    timestamp: isoTimestamp,

    level: match[2].toLowerCase(),

    message: match[3]

  };

}







const storage = multer.diskStorage({

  destination: function (req, file, cb) {

    cb(null, 'public/uploads/');

  },

  filename: function (req, file, cb) {

    cb(null, Date.now() + '-' + file.originalname);

  }

});



const upload = multer({ storage: storage });



// 관리자 권한 확인

router.get("/check-permission", requirePermission("superadmin"), (req, res) => {

  res.status(200).json({ message: "Admin permission confirmed" });

});



// 대시보드 통계 (superadmin)

router.get('/dashboard-stats', requirePermission("superadmin"), async (req, res) => {

  try {

    const todayStart = new Date();

    todayStart.setHours(0, 0, 0, 0);



    const [

      totalUsers,

      totalPosts,

      totalComments,

      todayNewUsers,

      todayPosts,

      todayComments,

      pendingReports

    ] = await Promise.all([

      User.countDocuments(),

      Post.countDocuments({ deleted: { $ne: true } }),

      Comment.countDocuments(),

      User.countDocuments({ createdAt: { $gte: todayStart } }),

      Post.countDocuments({ deleted: { $ne: true }, time: { $gte: todayStart } }),

      Comment.countDocuments({ time: { $gte: todayStart } }),

      Report.countDocuments({ status: 'pending' })

    ]);



    const rangeStart = new Date(todayStart);

    rangeStart.setDate(rangeStart.getDate() - 6);



    const postActivity = await Post.aggregate([

      {

        $match: {

          deleted: { $ne: true },

          time: { $gte: rangeStart }

        }

      },

      {

        $group: {

          _id: {

            year: { $year: '$time' },

            month: { $month: '$time' },

            day: { $dayOfMonth: '$time' }

          },

          count: { $sum: 1 }

        }

      }

    ]);



    const activityMap = new Map();

    for (const entry of postActivity) {

      const { year, month, day } = entry._id;

      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      activityMap.set(key, entry.count);

    }



    const labels = [];

    const postsSeries = [];

    for (let i = 6; i >= 0; i--) {

      const date = new Date(todayStart);

      date.setDate(date.getDate() - i);

      const key = date.toISOString().slice(0, 10);

      labels.push(key);

      postsSeries.push(activityMap.get(key) || 0);

    }



    res.json({

      totalUsers,

      totalPosts,

      totalComments,

      todayNewUsers,

      todayPosts,

      todayComments,

      pendingReports,

      activityData: {

        labels,

        posts: postsSeries

      }

    });

  } catch (error) {

    logError(req, 'admin.dashboard.stats', 'Dashboard stats error', error);

    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });

  }

});


router.get('/system-health', requirePermission("log_view"), async (req, res) => {

  try {

    const hoursParam = parseInt(req.query.hours, 10);

    const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? hoursParam : 24;

    const analysis = await analyzeLogs({ logDir: LOG_DIRECTORY, hours });

    const logSummary = analysis.summary || {};

    const latestError = logSummary.latestError

      ? {

          timestamp: logSummary.latestError.timestamp,

          message: logSummary.latestError.message,

          file: logSummary.latestError.file

        }

      : null;

    const totalMB = analysis.totalBytes / (1024 * 1024);

    const largest = analysis.largestFile

      ? {

          name: analysis.largestFile.name,

          sizeMB: Number((analysis.largestFile.bytes / (1024 * 1024)).toFixed(2))

        }

      : null;

    const loadAverage = os.loadavg().map((value) => Number(value.toFixed(2)));

    const totalMemMB = os.totalmem() / (1024 * 1024);

    const freeMemMB = os.freemem() / (1024 * 1024);

    res.json({

      fetchedAt: new Date().toISOString(),

      logSummary: {

        windowHours: analysis.hours,

        total: logSummary.total || 0,

        info: logSummary.info || 0,

        warn: logSummary.warn || 0,

        error: logSummary.error || 0,

        latestError

      },

      logs: {

        totalMB: Number(totalMB.toFixed(2)),

        fileCount: analysis.files.length,

        scannedCount: analysis.files.filter((file) => file.scanned).length,

        largestFile: largest

      },

      system: {

        uptimeSeconds: Math.round(os.uptime()),

        loadAverage,

        memory: {

          totalMB: Number(totalMemMB.toFixed(2)),

          freeMB: Number(freeMemMB.toFixed(2)),

          usedMB: Number((totalMemMB - freeMemMB).toFixed(2))

        }

      }

    });

  } catch (error) {

    logError(req, 'admin.system.health', 'System health fetch failed', error);

    res.status(500).json({ error: '시스템 상태 정보를 가져오지 못했습니다.' });

  }

});



// 관리자 추가/삭제 (superadmin만)

router.post("/users/add-admin", requirePermission("superadmin"), async (req, res) => {

  try {

    const { userId, permissions = [], adminPermissions, role } = req.body;



    const desiredPermissions = Array.isArray(adminPermissions)

      ? adminPermissions

      : Array.isArray(permissions)

        ? permissions

        : [];

    const desiredRole = role === 'manager' ? 'manager' : 'admin';



    const normalizedPermissions = Array.from(new Set(desiredPermissions.map(String)));

    const invalidPermissions = normalizedPermissions.filter(p => !ADMIN_PERMISSION_KEYS.includes(p));

    if (invalidPermissions.length > 0) {

      return res.status(400).json({ error: 'Invalid permissions: ' + invalidPermissions.join(', ') });

    }



    const user = await User.findById(userId);

    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }

    if (user.role === 'superadmin') {

      return res.status(400).json({ error: 'Cannot modify superadmin permissions through this endpoint' });

    }

    user.adminPermissions = normalizedPermissions;

    if (!['manager', 'admin'].includes(user.role) || user.role !== desiredRole) {

      user.role = desiredRole;

    }

    await user.save();



    logInfo(req, 'admin.permissions.update', `Admin permissions updated for user ${userId}`, {

      targetUserId: userId,

      adminPermissions: normalizedPermissions,

      role: user.role

    });



    res.json({ message: 'Admin permissions updated successfully', adminPermissions: user.adminPermissions, role: user.role });

  } catch (error) {

    logError(req, 'admin.permissions.update', 'Add admin error', error);

    res.status(500).json({ error: 'Failed to update admin permissions' });

  }

});



router.delete("/users/remove-admin/:id", requirePermission("superadmin"), async (req, res) => {

  try {

    const { id } = req.params;

    

    const user = await User.findById(id);

    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    user.adminPermissions = [];

    if (user.role !== 'superadmin') {

      user.role = 'user';

    }

    await user.save();



    logInfo(req, 'admin.permissions.remove', `Admin permissions removed from user ${id}`, {

      targetUserId: id,

      role: user.role

    });



    res.json({ message: 'Admin permissions removed successfully', role: user.role });

  } catch (error) {

    logError(req, 'admin.permissions.remove', 'Remove admin error', error);

    res.status(500).json({ error: 'Failed to remove admin' });

  }

});



// 사용자 권한(관리자 권한) 수정 (superadmin만)

router.put("/users/:id/permissions", requirePermission("superadmin"), async (req, res) => {

  try {

    const { id } = req.params;

    const { adminPermissions, permissions = [] } = req.body;



    const desiredPermissions = Array.isArray(adminPermissions)

      ? adminPermissions

      : Array.isArray(permissions)

        ? permissions

        : [];



    if (!Array.isArray(desiredPermissions)) {

      return res.status(400).json({ error: 'Invalid permissions data' });

    }



    const invalidPermissions = desiredPermissions.filter(p => !ADMIN_PERMISSION_KEYS.includes(p));

    if (invalidPermissions.length > 0) {

      return res.status(400).json({ error: 'Invalid permissions: ' + invalidPermissions.join(', ') });

    }



    const user = await User.findByIdAndUpdate(

      id,

      { adminPermissions: desiredPermissions },

      { new: true }

    ).select('username role adminPermissions');



    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    logInfo(req, 'admin.permissions.update', `User permissions updated for ${id}`, {

      targetUserId: id,

      adminPermissions: desiredPermissions

    });



    res.json({

      message: 'Permissions updated successfully',

      user: {

        id: user._id,

        username: user.username,

        role: user.role,

        adminPermissions: user.adminPermissions

      }

    });

  } catch (error) {

    logError(req, 'admin.permissions.update', 'Update permissions error', error);

    res.status(500).json({ error: 'Failed to update permissions' });

  }

});



// 사용자 권한(등급) 변경 (superadmin만)

router.put("/users/:id/role", requirePermission("superadmin"), async (req, res) => {

  try {

    const { id } = req.params;

    const { role } = req.body;



    const validRoles = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

    

    if (!role || !validRoles.includes(role)) {

      return res.status(400).json({ 

        error: `Invalid role. Must be one of: ${validRoles.join(', ')}` 

      });

    }



    const user = await User.findByIdAndUpdate(

      id,

      { role },

      { new: true }

    );



    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    logInfo(req, 'admin.role.update', `User role updated for ${id}`, {

      targetUserId: id,

      newRole: role

    });



    res.json({ 

      message: 'Role updated successfully', 

      user: {

        id: user._id,

        username: user.username,

        role: user.role

      }

    });

  } catch (error) {

    logError(req, 'admin.role.update', 'Update role error', error);

    res.status(500).json({ error: 'Failed to update role' });

  }

});



// 로그 파일/사용자 로그 (log_view)

router.get('/chat-log-files', requirePermission("log_view"), async (req, res) => {

  try {

    const targetUser = (req.query.user || CHAT_AUDIT_USER || '').trim();

    const safeIdentifier = sanitizeIdentifier(targetUser);

    if (!safeIdentifier) {

      return res.json([]);

    }



    const baseDir = path.resolve(__dirname, '../logs/users');

    const userLogDir = path.resolve(baseDir, safeIdentifier);



    if (!userLogDir.startsWith(baseDir) || path.basename(userLogDir) !== safeIdentifier) {

      return res.json([]);

    }



    try {

      await fs.access(userLogDir);

    } catch (error) {

      return res.json([]);

    }



    const files = await fs.readdir(userLogDir);

    const logFiles = files.filter(file => file.endsWith('.log')).sort().reverse();



    res.json(logFiles);

  } catch (error) {

    logError(req, 'admin.chat.logs.files', 'Get chat log files error', error);

    res.status(500).json({ error: 'Failed to fetch chat log files' });

  }

});



router.get('/chat-logs', requirePermission("log_view"), async (req, res) => {

  try {

    let { file, limit = 400, user } = req.query;

    if (!file) {

      return res.status(400).json({ error: 'File parameter is required' });

    }



    const targetUser = (user || CHAT_AUDIT_USER || '').trim();

    const safeIdentifier = sanitizeIdentifier(targetUser);

    if (!safeIdentifier) {

      return res.json({ entries: [], total: 0 });

    }



    const baseDir = path.resolve(__dirname, '../logs/users');

    const userLogDir = path.resolve(baseDir, safeIdentifier);



    if (!userLogDir.startsWith(baseDir) || path.basename(userLogDir) !== safeIdentifier) {

      return res.status(400).json({ error: 'Invalid user log directory' });

    }



    const fileName = file.trim();

    if (!/^[A-Za-z0-9_.\-]+$/.test(fileName)) {

      return res.status(400).json({ error: 'Invalid file name' });

    }



    const logPath = path.resolve(userLogDir, fileName);

    if (!logPath.startsWith(userLogDir) || path.basename(logPath) !== path.basename(fileName)) {

      return res.status(400).json({ error: 'Invalid log file path' });

    }



    const content = await fs.readFile(logPath, 'utf-8');

    const lines = content.split(/\r?\n/);

    const chatEntries = [];

    const chatRegex = /^\[CHAT\]\[([^\]]+)\]\s+room=(\S+)\s+(?:messageId=(\S+)\s+)?from=(\S+)\s+type=(\S+)\s+message=(.*)$/;

    for (const line of lines) {

      const parsed = parseLogLine(line);

      if (!parsed) continue;

      const match = parsed.message.match(chatRegex);

      if (!match) continue;

      chatEntries.push({

        timestamp: parsed.timestamp,

        level: parsed.level,

        channel: match[1],

        room: match[2],

        messageId: match[3] || null,

        from: match[4],

        type: match[5],

        message: (match[6] || '').trim()

      });

    }

    const messageIds = Array.from(new Set(

      chatEntries

        .map((entry) => (entry.messageId || '').trim())

        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))

    ));

    if (messageIds.length > 0) {

      const dbMessages = await Message.find({ _id: { $in: messageIds } })

        .select('_id message messageType room editedAt lastEditedByName editHistory')

        .lean();



      const messageMap = new Map(

        dbMessages.map((doc) => [doc._id.toString(), doc])

      );



      chatEntries.forEach((entry) => {

        if (!entry.messageId) return;

        const matched = messageMap.get(entry.messageId);

        if (!matched) {

          entry.deleted = true;

          return;

        }

        entry.currentMessage = matched.message;

        entry.currentType = matched.messageType || entry.type;

        if (matched.room) {

          entry.currentRoom = matched.room.toString();

        }

        if (matched.editedAt) {

          entry.editedAt = matched.editedAt;

        }

        if (Array.isArray(matched.editHistory) && matched.editHistory.length) {

          entry.editHistory = matched.editHistory;

        }

        if (matched.lastEditedByName) {

          entry.lastEditedByName = matched.lastEditedByName;

        }

      });

    }



    const numericLimit = parseInt(limit, 10);

    const maxEntries = Number.isFinite(numericLimit) && numericLimit > 0 ? numericLimit : 400;

    const entries = chatEntries.slice(-maxEntries);



    res.json({ entries, total: chatEntries.length });

  } catch (error) {

    if (error.code === 'ENOENT') {

      return res.status(404).json({ error: 'Chat log file not found' });

    }

    logError(req, 'admin.chat.logs.read', 'Get chat log entries error', error);

    res.status(500).json({ error: 'Failed to fetch chat log entries' });

  }

});



router.get('/log-files', requirePermission("log_view"), async (req, res) => {

  try {

    const logsDir = path.join(__dirname, '../logs');



    try {

      await fs.access(logsDir);

    } catch (error) {

      return res.json([]);

    }



    const files = await fs.readdir(logsDir);

    const logFiles = [];

    for (const file of files) {

      if (!file.endsWith('.log')) continue;

      logFiles.push(file);

    }



    logFiles.sort().reverse();



    res.json(logFiles);

  } catch (error) {

    logError(req, 'admin.logs.list', 'Get log files error', error);

    res.status(500).json({ error: 'Failed to fetch log files' });

  }

});



router.get('/logs', requirePermission("log_view"), async (req, res) => {

  try {

    const { file } = req.query;

    if (!file) {

      return res.status(400).json({ error: 'File parameter is required' });

    }



    const logsDir = path.join(__dirname, '../logs');

    const logPath = path.join(logsDir, file);



    if (!logPath.startsWith(logsDir)) {

      return res.status(400).json({ error: 'Invalid file path' });

    }



    const content = await fs.readFile(logPath, 'utf-8');

    const logs = content.split(/\r?\n/).map(parseLogLine).filter(Boolean);



    res.json({ logs });

  } catch (error) {

    if (error.code === 'ENOENT') {

      return res.status(404).json({ error: 'Log file not found' });

    }

    logError(req, 'admin.logs.read', 'Get log file error', error);

    res.status(500).json({ error: 'Failed to read log file' });

  }

});

router.get('/user-logs/:identifier', requirePermission("log_view"), async (req, res) => {

  try {

    const safeIdentifier = sanitizeIdentifier(req.params.identifier);

    if (!safeIdentifier) {

      return res.json([]);

    }



    const baseDir = path.resolve(__dirname, '../logs/users');

    const userLogDir = path.resolve(baseDir, safeIdentifier);



    if (!userLogDir.startsWith(baseDir) || path.basename(userLogDir) !== safeIdentifier) {

      return res.json([]);

    }



    try {

      await fs.access(userLogDir);

    } catch (error) {

      return res.json([]);

    }



    const files = await fs.readdir(userLogDir);

    files.sort().reverse();



    const entries = [];

    for (const file of files) {

      if (!file.endsWith('.log')) continue;

      const filePath = path.resolve(userLogDir, file);

      if (!filePath.startsWith(userLogDir)) continue;

      const content = await fs.readFile(filePath, 'utf-8');

      const parsed = content.split(/\r?\n/).map(parseLogLine).filter(Boolean);

      entries.push(...parsed);

      if (entries.length >= 200) break;

    }



    entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));



    res.json(entries.slice(-200));

  } catch (error) {

    logError(req, 'admin.logs.user', 'Get user logs error', error);

    res.status(500).json({ error: 'Failed to fetch user logs' });

  }

});

router.get('/logs/:filename', requirePermission("log_view"), async (req, res) => {

  try {

    const { filename } = req.params;

    const logsDir = path.resolve(__dirname, '../logs');

    const logPath = path.resolve(logsDir, filename);

    

    // 보안: 상위 디렉토리 접근 방지

    if (!logPath.startsWith(logsDir) || path.basename(logPath) !== path.basename(filename)) {

      return res.status(400).json({ error: 'Invalid file path' });

    }

    const content = await fs.readFile(logPath, 'utf-8');

    res.json({ content });

  } catch (error) {

    if (error.code === 'ENOENT') {

      return res.status(404).json({ error: 'Log file not found' });

    }

    logError(req, 'admin.logs.read', 'Get log file error', error);

    res.status(500).json({ error: 'Failed to read log file' });

  }

});



// 사용자 관리 (user_management)

router.get("/users", requirePermission("user_management"), async (req, res) => {

  try {

    const { q = '', search = '', role = '', limit = 20, page = 1, sort = 'createdAt', order = 'desc' } = req.query;

    const keyword = (q || search || '').trim();

    const roleFilter = (role || '').trim();

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);



    const query = {};

    if (keyword) {

      query.$or = [

        { username: { $regex: keyword, $options: 'i' } },

        { email: { $regex: keyword, $options: 'i' } }

      ];

    }

    if (roleFilter && roleFilter !== 'all') {

      query.role = roleFilter;

    }



    const sortFieldMap = { createdAt: 'createdAt', role: 'role' };

    const sortField = sortFieldMap[sort] || 'createdAt';

    const sortOrder = order === 'asc' ? 1 : -1;

    const sortSpec = { [sortField]: sortOrder };

    if (sortField !== 'createdAt') {

      sortSpec.createdAt = -1;

    }



    const total = await User.countDocuments(query);

    const totalPages = Math.max(1, Math.ceil(total / limitNum));

    const safePage = Math.min(pageNum, totalPages);

    const skip = (safePage - 1) * limitNum;



    const users = await User.find(query)

      .select('username role memo adminPermissions createdAt suspended signupOwner signupOrder signupIp')

      .sort(sortSpec)

      .skip(skip)

      .limit(limitNum);



    const ownerKeys = [...new Set(users.map(user => user.signupOwner).filter(Boolean))];

    const ipKeys = [...new Set(users.map(user => user.signupIp).filter(ip => ip))];



    const ownerMap = new Map();

    if (ownerKeys.length > 0) {

      const ownerAggregation = await User.aggregate([

        { $match: { signupOwner: { $in: ownerKeys } } },

        { $group: { _id: '$signupOwner', count: { $sum: 1 }, usernames: { $push: '$username' } } }

      ]);

      ownerAggregation.forEach(item => {

        ownerMap.set(item._id, { count: item.count, usernames: item.usernames || [] });

      });

    }



    const ipMap = new Map();

    if (ipKeys.length > 0) {

      const ipAggregation = await User.aggregate([

        { $match: { signupIp: { $in: ipKeys } } },

        { $group: { _id: '$signupIp', count: { $sum: 1 }, usernames: { $push: '$username' } } }

      ]);

      ipAggregation.forEach(item => {

        ipMap.set(item._id, { count: item.count, usernames: item.usernames || [] });

      });

    }



    const formattedUsers = users.map(doc => {

      const plain = doc.toObject({ virtuals: false, getters: false });

      const ownerKey = plain.signupOwner || '';

      const ownerGroup = ownerKey ? ownerMap.get(ownerKey) : null;

      const browserUsernames = ownerGroup ? ownerGroup.usernames.filter(name => name !== plain.username).slice(0, 5) : [];

      const sameBrowserCount = ownerGroup ? ownerGroup.count : (ownerKey ? 1 : 0);



      const ipKey = plain.signupIp || '';

      const ipGroup = ipKey ? ipMap.get(ipKey) : null;

      const ipUsernames = ipGroup ? ipGroup.usernames.filter(name => name !== plain.username).slice(0, 5) : [];

      const sameIpCount = ipGroup ? ipGroup.count : (ipKey ? 1 : 0);



      return {

        ...plain,

        sameBrowserCount,

        sameBrowserUsers: browserUsernames,

        sameIpCount,

        sameIpUsers: ipUsernames

      };

    });



    res.json({

      users: formattedUsers,

      total,

      totalPages,

      currentPage: safePage

    });

  } catch (error) {

    logError(req, 'admin.users.list', 'Get users error', error);

    res.status(500).json({ error: 'Failed to fetch users' });

  }

});



router.get("/users/:id", requirePermission("user_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const user = await User.findById(id).select('-password');

    

    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    // 사용자 통계도 함께 반환

    const postCount = await Post.countDocuments({ author: id, deleted: { $ne: true } });

    const reportCount = await Report.countDocuments({ contentOwner: id });



    res.json({

      user,

      stats: {

        postCount,

        reportCount

      }

    });

  } catch (error) {

    logError(req, 'admin.users.detail', 'Get user error', error);

    res.status(500).json({ error: 'Failed to fetch user' });

  }

});



router.put("/users/:id", requirePermission("user_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const { email, bio, isActive } = req.body;



    const updateData = {};

    if (email !== undefined) updateData.email = email;

    if (bio !== undefined) updateData.bio = bio;

    if (isActive !== undefined) updateData.isActive = isActive;



    const user = await User.findByIdAndUpdate(

      id,

      updateData,

      { new: true, runValidators: true }

    ).select('-password');



    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    logInfo(req, 'admin.user.update', `User updated: ${id}`, {

      targetUserId: id,

      changes: updateData

    });



    res.json({ message: 'User updated successfully', user });

  } catch (error) {

    logError(req, 'admin.user.update', 'Update user error', error);

    res.status(500).json({ error: 'Failed to update user' });

  }

});



router.put("/users/:id/memo", requirePermission("user_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const { memo = '' } = req.body;



    const user = await User.findByIdAndUpdate(

      id,

      { memo },

      { new: true }

    ).select('username memo');



    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    logInfo(req, 'admin.user.memo', `User memo updated: ${id}`, { targetUserId: id });



    res.json({ message: 'Memo updated successfully', memo: user.memo });

  } catch (error) {

    logError(req, 'admin.user.memo', 'Update user memo error', error);

    res.status(500).json({ error: 'Failed to update memo' });

  }

});



router.delete("/users/:id", requirePermission("user_management"), async (req, res) => {

  try {

    const { id } = req.params;

    

    // 자기 자신은 삭제할 수 없음

    if (id === req.user.id) {

      return res.status(400).json({ error: 'Cannot delete your own account' });

    }



    const user = await User.findByIdAndDelete(id);

    

    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    // 관련 데이터 정리

    await Promise.all([

      Post.deleteMany({ author: id }),

      Message.deleteMany({ $or: [{ sender: id }, { recipient: id }] }),

      Report.deleteMany({ $or: [{ reporter: id }, { contentOwner: id }] })

    ]);



    logInfo(req, 'admin.user.delete', `User deleted: ${id}`, { targetUserId: id });



    res.json({ message: 'User deleted successfully' });

  } catch (error) {

    logError(req, 'admin.user.delete', 'Delete user error', error);

    res.status(500).json({ error: 'Failed to delete user' });

  }

});



// 게시글 관리 (post_management)

router.post("/posts/notice", requirePermission("post_management"), upload.array('files', 10), async (req, res) => {

  try {

    const { title, content } = req.body;



    const titleText = (title || '').trim();

    const contentText = (content || '').trim();



    if (!titleText || !contentText) {

      return res.status(400).json({ error: 'Title and content are required' });

    }



    const attachments = (req.files || []).map((file, index) => ({

      url: `/uploads/${file.filename}`,

      order: index

    }));



    const post = new Post({

      title: titleText,

      content: contentText,

      user: req.user.username,

      author: req.user.id,

      isNotice: true,

      images: attachments,

      deleted: false

    });



    await post.save();



    logInfo(req, 'admin.posts.notice.create', `Notice created: ${post._id}`, {

      postId: post._id,

      hasAttachments: attachments.length > 0

    });



    res.status(201).json({ message: 'Notice created successfully', post });

  } catch (error) {

    logError(req, 'admin.posts.notice.create', 'Create notice error', error);

    res.status(500).json({ error: 'Failed to create notice' });

  }

});



router.get("/posts", requirePermission("post_management"), async (req, res) => {

  try {

    const {

      page = 1,

      limit = 10,

      search = '',

      category = '',

      sort = '-createdAt',

      status = 'active',

      notice = 'all'

    } = req.query;



    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    const currentPage = Math.max(parseInt(page, 10) || 1, 1);

    const skip = (currentPage - 1) * limitNum;



    const query = {};



    if (search) {

      query.$or = [

        { title: { $regex: search, $options: 'i' } },

        { content: { $regex: search, $options: 'i' } }

      ];

    }



    if (category && category !== 'all') {

      query.category = category;

    }



    if (status === 'deleted') {

      query.deleted = true;

    } else if (status === 'all') {

      // no filter

    } else {

      query.deleted = { $ne: true };

    }



    if (notice === 'only') {

      query.isNotice = true;

    } else if (notice === 'exclude') {

      query.isNotice = { $ne: true };

    }



    const sortableFields = ['createdAt', 'title', 'isNotice'];

    let sortOption = { createdAt: -1 };

    if (typeof sort === 'string' && sort.length > 0) {

      const direction = sort.startsWith('-') ? -1 : 1;

      const field = sort.startsWith('-') ? sort.slice(1) : sort;

      if (sortableFields.includes(field)) {

        sortOption = { [field]: direction };

      }

    }



    const [posts, total] = await Promise.all([

      Post.find(query)

        .populate('author', 'username')

        .sort(sortOption)

        .skip(skip)

        .limit(limitNum)

        .lean(),

      Post.countDocuments(query)

    ]);



    const serializedPosts = posts.map((post) => {

      let authorDisplay;

      if (post.author && post.author.username) {

        authorDisplay = post.author.username;

      } else if (post.deleted) {

        authorDisplay = '탈퇴 사용자';

      } else if (!post.author && typeof post.user === 'string' && post.user.trim()) {

        authorDisplay = post.user.trim();

      } else {

        authorDisplay = '알 수 없음';

      }



      return {

        ...post,

        authorDisplay

      };

    });



    res.json({

      posts: serializedPosts,

      totalPages: Math.ceil(total / limitNum),

      currentPage,

      totalPosts: total

    });

  } catch (error) {

    logError(req, 'admin.posts.list', 'Get posts error', error);

    res.status(500).json({ error: 'Failed to fetch posts' });

  }

});



router.get("/posts/:id", requirePermission("post_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const post = await Post.findById(id).populate('author', 'username email');

    

    if (!post) {

      return res.status(404).json({ error: 'Post not found' });

    }



    res.json(post);

  } catch (error) {

    logError(req, 'admin.posts.detail', 'Get post error', error);

    res.status(500).json({ error: 'Failed to fetch post' });

  }

});



router.put("/posts/:id", requirePermission("post_management"), async (req, res) => {

  try {

    const { id } = req.params;

        const { title, content, category, isActive } = req.body;



    const updateData = {};

    if (title !== undefined) updateData.title = title;

    if (content !== undefined) updateData.content = content;

    if (category !== undefined) updateData.category = category;

    if (isActive !== undefined) updateData.isActive = isActive;



    const post = await Post.findByIdAndUpdate(

      id,

      updateData,

      { new: true }

    ).populate('author', 'username');



    if (!post) {

      return res.status(404).json({ error: 'Post not found' });

    }



    logInfo(req, 'admin.posts.update', `Post updated: ${id}`, {

      postId: id,

      changes: updateData

    });



    res.json({ message: 'Post updated successfully', post });

  } catch (error) {

    logError(req, 'admin.posts.update', 'Update post error', error);

    res.status(500).json({ error: 'Failed to update post' });

  }

});



router.delete("/posts/:id", requirePermission("post_management"), async (req, res) => {

  try {

    const { id } = req.params;



    const post = await Post.findById(id);



    if (!post) {

      return res.status(404).json({ error: 'Post not found' });

    }



    if (post.deleted) {

      return res.status(400).json({ error: 'Post is already deleted' });

    }



    post.deleted = true;

    post.deletedAt = new Date();

    await post.save();



    logInfo(req, 'admin.posts.delete', `Post soft-deleted: ${id}`, { postId: id });



    res.json({ message: 'Post deleted successfully', post });

  } catch (error) {

    logError(req, 'admin.posts.delete', 'Delete post error', error);

    res.status(500).json({ error: 'Failed to delete post' });

  }

});

router.put("/posts/restore/:id", requirePermission("post_management"), async (req, res) => {

  try {

    const { id } = req.params;



    const post = await Post.findById(id);



    if (!post) {

      return res.status(404).json({ error: 'Post not found' });

    }



    if (!post.deleted) {

      return res.status(400).json({ error: 'Post is not deleted' });

    }



    post.deleted = false;

    post.deletedAt = null;

    await post.save();

    logInfo(req, 'admin.posts.restore', `Post restored: ${id}`, { postId: id });



    res.json({ message: 'Post restored successfully', post });

  } catch (error) {

    logError(req, 'admin.posts.restore', 'Restore post error', error);

    res.status(500).json({ error: 'Failed to restore post' });

  }

});



router.put("/posts/toggle-notice/:id", requirePermission("post_management"), async (req, res) => {

  try {

    const { id } = req.params;



    const post = await Post.findById(id);



    if (!post) {

      return res.status(404).json({ error: 'Post not found' });

    }



    post.isNotice = !post.isNotice;

    post.lastEditedAt = new Date();

    await post.save();



    logInfo(req, 'admin.posts.notice.toggle', `Post notice toggled: ${id}`, {

      postId: id,

      isNotice: post.isNotice

    });



    res.json({

      message: post.isNotice ? 'Post marked as notice' : 'Post unmarked as notice',

      post

    });

  } catch (error) {

    logError(req, 'admin.posts.notice.toggle', 'Toggle notice error', error);

    res.status(500).json({ error: 'Failed to toggle notice' });

  }

});



// 신고 관리 (report_management)

router.get("/reports", requirePermission("report_management"), async (req, res) => {

  try {

    const { status = '' } = req.query;

    const query = {};



    if (status && status !== 'all') {

      query.status = status;

    }



    const reports = await Report.find(query)

      .sort({ createdAt: -1 })

      .limit(200)

      .populate('reporter', 'username')

      .populate('contentOwner', 'username');



    const enrichedReports = (await Promise.all(reports.map((report) => buildReportPayload(report)))).filter(Boolean);



    res.json(enrichedReports);

  } catch (error) {

    logError(req, 'admin.reports.list', 'Get reports error', error);

    res.status(500).json({ error: 'Failed to fetch reports' });

  }

});



router.get("/reports/:id", requirePermission("report_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const reportDoc = await Report.findById(id)

      .populate('reporter', 'username email')

      .populate('contentOwner', 'username email');



    if (!reportDoc) {

      return res.status(404).json({ error: 'Report not found' });

    }



    const report = await buildReportPayload(reportDoc);

    res.json(report);

  } catch (error) {

    logError(req, 'admin.reports.detail', 'Get report error', error);

    res.status(500).json({ error: 'Failed to fetch report' });

  }

});



router.put("/reports/:id", requirePermission("report_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const { status } = req.body;



    const allowedStatuses = ['pending', 'resolved', 'dismissed'];

    if (!allowedStatuses.includes(status)) {

      return res.status(400).json({ error: 'Invalid status value' });

    }



    const update = {

      status,

      resolver: req.user.id,

      resolvedAt: ['resolved', 'dismissed'].includes(status) ? new Date() : null

    };



    const reportDoc = await Report.findByIdAndUpdate(

      id,

      update,

      { new: true }

    ).populate('reporter', 'username').populate('contentOwner', 'username');



    if (!reportDoc) {

      return res.status(404).json({ error: 'Report not found' });

    }



    const report = await buildReportPayload(reportDoc);



    logInfo(req, 'admin.reports.update', `Report processed: ${id}`, {

      reportId: id,

      status

    });



    res.json({ message: 'Report updated successfully', report });

  } catch (error) {

    logError(req, 'admin.reports.update', 'Update report error', error);

    res.status(500).json({ error: 'Failed to update report' });

  }

});

router.post("/reports/:id/resolve", requirePermission("report_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const { action } = req.body;

    const actionMap = {

      resolved: 'resolved',

      dismissed: 'dismissed'

    };



    const nextStatus = actionMap[action];

    if (!nextStatus) {

      return res.status(400).json({ error: 'Invalid action' });

    }



    const reportDoc = await Report.findByIdAndUpdate(

      id,

      {

        status: nextStatus,

        resolver: req.user.id,

        resolvedAt: new Date()

      },

      { new: true }

    ).populate('reporter', 'username').populate('contentOwner', 'username');



    if (!reportDoc) {

      return res.status(404).json({ error: 'Report not found' });

    }



    const report = await buildReportPayload(reportDoc);



    logInfo(req, 'admin.reports.action', `Report action applied: ${id}`, {

      reportId: id,

      action: nextStatus

    });

    res.json({ message: 'Report updated successfully', report });

  } catch (error) {

    logError(req, 'admin.reports.action', 'Resolve report error', error);

    res.status(500).json({ error: 'Failed to process report' });

  }

});



// 컨텐츠 관리 (content_management)

router.get("/forbidden-words", requirePermission("content_management"), async (req, res) => {

  try {

    const { page = 1, limit = 20, search = '' } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);



    let query = {};

    if (search) {

      query.word = { $regex: search, $options: 'i' };

    }



    const words = await ForbiddenWord.find(query)
      .sort('word')
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'username')
      .lean();

    const total = await ForbiddenWord.countDocuments(query);

    const formatted = words.map(word => ({
      ...word,
      addedBy: word.createdBy && word.createdBy.username ? word.createdBy.username : null,
    }));

    res.json({
      words: formatted,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {

    logError(req, 'admin.forbiddenWords.list', 'Get forbidden words error', error);

    res.status(500).json({ error: 'Failed to fetch forbidden words' });

  }

});



router.post("/forbidden-words", requirePermission("content_management"), async (req, res) => {

  try {

    const { word, severity = 'medium' } = req.body;

    if (!word || word.trim().length === 0) {
      return res.status(400).json({ error: 'Word is required' });
    }

    const normalizedWord = word.trim().toLowerCase();
    const allowedSeverity = ['low', 'medium', 'high'];
    const normalizedSeverity = allowedSeverity.includes(String(severity).toLowerCase())
      ? String(severity).toLowerCase()
      : 'medium';

    const existingWord = await ForbiddenWord.findOne({
      word: normalizedWord
    });

    if (existingWord) {
      return res.status(400).json({ error: 'Word already exists' });
    }

    const forbiddenWord = new ForbiddenWord({
      word: normalizedWord,
      severity: normalizedSeverity,
      createdBy: req.user.id,
    });

    await forbiddenWord.save();
    await forbiddenWord.populate('createdBy', 'username');
    await updateForbiddenWordsCache();

    logInfo(req, 'admin.forbiddenWords.create', `Forbidden word added: ${normalizedWord}`, { word: normalizedWord, severity: normalizedSeverity });

    res.status(201).json({
      message: 'Forbidden word added successfully',
      word: {
        _id: forbiddenWord._id,
        word: forbiddenWord.word,
        severity: forbiddenWord.severity,
        createdAt: forbiddenWord.createdAt,
        addedBy: forbiddenWord.createdBy ? forbiddenWord.createdBy.username : null,
      }
    });

  } catch (error) {

    logError(req, 'admin.forbiddenWords.create', 'Add forbidden word error', error);

    res.status(500).json({ error: 'Failed to add forbidden word' });

  }

});



router.put("/forbidden-words/:id", requirePermission("content_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const updatePayload = {};
    if (typeof req.body?.word === 'string' && req.body.word.trim()) {
      updatePayload.word = req.body.word.trim().toLowerCase();
    }
    if (typeof req.body?.severity === 'string') {
      const allowedSeverity = ['low', 'medium', 'high'];
      const normalized = req.body.severity.toLowerCase();
      if (allowedSeverity.includes(normalized)) {
        updatePayload.severity = normalized;
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    const forbiddenWord = await ForbiddenWord.findByIdAndUpdate(
      id,
      updatePayload,
      { new: true }
    ).populate('createdBy', 'username');

    if (!forbiddenWord) {
      return res.status(404).json({ error: 'Forbidden word not found' });
    }

    await updateForbiddenWordsCache();

    logInfo(req, 'admin.forbiddenWords.update', `Forbidden word updated: ${id}`, { wordId: id });

    res.json({ 
      message: 'Forbidden word updated successfully', 
      word: forbiddenWord 
    });

  } catch (error) {

    logError(req, 'admin.forbiddenWords.update', 'Update forbidden word error', error);

    res.status(500).json({ error: 'Failed to update forbidden word' });

  }

});







router.delete("/forbidden-words/:id", requirePermission("content_management"), async (req, res) => {

  try {

    const { id } = req.params;

    

    const forbiddenWord = await ForbiddenWord.findByIdAndDelete(id);

    

    if (!forbiddenWord) {

      return res.status(404).json({ error: 'Forbidden word not found' });

    }



    await updateForbiddenWordsCache();



    logInfo(req, 'admin.forbiddenWords.delete', `Forbidden word deleted: ${id}`, { wordId: id });



    res.json({ message: 'Forbidden word deleted successfully' });

  } catch (error) {

    logError(req, 'admin.forbiddenWords.delete', 'Delete forbidden word error', error);

    res.status(500).json({ error: 'Failed to delete forbidden word' });

  }

});



// 문의사항 관리

router.get("/inquiries", requirePermission("user_management"), async (req, res) => {

  try {

    const { status = '', type = '', limit = 100 } = req.query;

    const query = {};



    if (status && status !== 'all') {

      query.status = status;

    }

    if (type && type !== 'all') {

      query.inquiryType = type;

    }



    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);



    const inquiries = await Inquiry.find(query)

      .populate('user', 'username email')

      .sort({ createdAt: -1 })

      .limit(limitNum);



    res.json(inquiries);

  } catch (error) {

    logError(req, 'admin.inquiries.list', 'Get inquiries error', error);

    res.status(500).json({ error: 'Failed to fetch inquiries' });

  }

});



router.get("/inquiries/:id", requirePermission("user_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const inquiry = await Inquiry.findById(id).populate('user', 'username email');

    

    if (!inquiry) {

      return res.status(404).json({ error: 'Inquiry not found' });

    }



    res.json(inquiry);

  } catch (error) {

    logError(req, 'admin.inquiries.detail', 'Get inquiry error', error);

    res.status(500).json({ error: 'Failed to fetch inquiry' });

  }

});



router.put("/inquiries/:id", requirePermission("user_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const { status } = req.body;



    const allowedStatuses = ['open', 'closed'];

    if (status && !allowedStatuses.includes(status)) {

      return res.status(400).json({ error: 'Invalid status value' });

    }



    const updateData = {};

    if (status) {

      updateData.status = status;

      updateData.resolver = req.user.id;

      updateData.resolvedAt = status === 'closed' ? new Date() : null;

    }



    const inquiry = await Inquiry.findByIdAndUpdate(

      id,

      updateData,

      { new: true }

    ).populate('user', 'username email');



    if (!inquiry) {

      return res.status(404).json({ error: 'Inquiry not found' });

    }



    logInfo(req, 'admin.inquiries.update', `Inquiry updated: ${id}`, {

      inquiryId: id,

      status: inquiry.status

    });



    res.json({ message: 'Inquiry updated successfully', inquiry });

  } catch (error) {

    logError(req, 'admin.inquiries.update', 'Update inquiry error', error);

    res.status(500).json({ error: 'Failed to update inquiry' });

  }

});



router.post("/inquiries/:id/resolve", requirePermission("user_management"), async (req, res) => {

  try {

    const { id } = req.params;

    const inquiry = await Inquiry.findByIdAndUpdate(

      id,

      {

        status: 'closed',

        resolver: req.user.id,

        resolvedAt: new Date()

      },

      { new: true }

    ).populate('user', 'username email');



    if (!inquiry) {

      return res.status(404).json({ error: 'Inquiry not found' });

    }



    logInfo(req, 'admin.inquiries.resolve', `Inquiry resolved: ${id}`, { inquiryId: id });



    res.json({ message: 'Inquiry resolved successfully', inquiry });

  } catch (error) {

    logError(req, 'admin.inquiries.resolve', 'Resolve inquiry error', error);

    res.status(500).json({ error: 'Failed to resolve inquiry' });

  }

});



// 통계 (statistics)

router.get("/statistics", requirePermission("statistics"), async (req, res) => {

  try {

    const { period = '30days' } = req.query;

    

    let dateRange = {};

    const now = new Date();

    

    switch(period) {

      case '7days':

        dateRange = {

          $gte: new Date(now.setDate(now.getDate() - 7))

        };

        break;

      case '30days':

        dateRange = {

          $gte: new Date(now.setDate(now.getDate() - 30))

        };

        break;

      case '90days':

        dateRange = {

          $gte: new Date(now.setDate(now.getDate() - 90))

        };

        break;

      default:

        dateRange = {

          $gte: new Date(now.setDate(now.getDate() - 30))

        };

    }



    const [userStats, postStats, reportStats] = await Promise.all([

      User.aggregate([

        {

          $match: { createdAt: dateRange }

        },

        {

          $group: {

            _id: {

              year: { $year: "$createdAt" },

              month: { $month: "$createdAt" },

              day: { $dayOfMonth: "$createdAt" }

            },

            count: { $sum: 1 }

          }

        },

        {

          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 }

        }

      ]),

      Post.aggregate([

        {

          $match: { createdAt: dateRange }

        },

        {

          $group: {

            _id: {

              year: { $year: "$createdAt" },

              month: { $month: "$createdAt" },

              day: { $dayOfMonth: "$createdAt" }

            },

            count: { $sum: 1 }

          }

        },

        {

          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 }

        }

      ]),

      Report.aggregate([

        {

          $group: {

            _id: "$status",

            count: { $sum: 1 }

          }

        }

      ])

    ]);



    res.json({

      userRegistrations: userStats,

      postCreations: postStats,

      reportStatus: reportStats

    });

  } catch (error) {

    logError(req, 'admin.statistics', 'Get statistics error', error);

    res.status(500).json({ error: 'Failed to fetch statistics' });

  }

});



// 파일 업로드 (superadmin)

router.post("/upload", requirePermission("superadmin"), upload.single('file'), async (req, res) => {

  try {

    if (!req.file) {

      return res.status(400).json({ error: 'No file uploaded' });

    }



    logInfo(req, 'admin.files.upload', `File uploaded: ${req.file.filename}`, {

      originalName: req.file.originalname,

      size: req.file.size

    });



    res.json({

      message: 'File uploaded successfully',

      file: {

        filename: req.file.filename,

        originalName: req.file.originalname,

        path: req.file.path,

        size: req.file.size

      }

    });

  } catch (error) {

    logError(req, 'admin.files.upload', 'File upload error', error);

    res.status(500).json({ error: 'Failed to upload file' });

  }

});



// 시스템 설정 (superadmin)

router.get("/system-settings", requirePermission("superadmin"), async (req, res) => {

  try {

    // 시스템 설정은 별도 모델이나 설정 파일에서 관리

    // 여기서는 기본 설정을 반환

    const settings = {

      siteName: process.env.SITE_NAME || 'Community Site',

      maxFileSize: process.env.MAX_FILE_SIZE || '10MB',

      allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx'],

      maintenanceMode: process.env.MAINTENANCE_MODE === 'true',

      registrationEnabled: process.env.REGISTRATION_ENABLED !== 'false',

      emailNotifications: process.env.EMAIL_NOTIFICATIONS === 'true'

    };



    res.json(settings);

  } catch (error) {

    logError(req, 'admin.system.settings.read', 'Get system settings error', error);

    res.status(500).json({ error: 'Failed to fetch system settings' });

  }

});



router.put("/system-settings", requirePermission("superadmin"), async (req, res) => {

  try {

    const {

      siteName,

      maxFileSize,

      allowedFileTypes,

      maintenanceMode,

      registrationEnabled,

      emailNotifications

    } = req.body;



    // 실제 환경에서는 데이터베이스나 설정 파일을 업데이트해야 함

    // 여기서는 로깅만 수행

    logInfo(req, 'admin.system.settings.update', 'System settings updated', { changes: req.body });



    res.json({ 

      message: 'System settings updated successfully',

      settings: req.body

    });

  } catch (error) {

    logError(req, 'admin.system.settings.update', 'Update system settings error', error);

    res.status(500).json({ error: 'Failed to update system settings' });

  }

});



// 백업 및 복원 (superadmin)

router.post("/backup/create", requirePermission("superadmin"), async (req, res) => {

  try {

    const backupName = `backup_${Date.now()}.json`;

    const backupPath = path.join(__dirname, '../backups', backupName);



    // 백업 디렉토리 생성

    const backupDir = path.dirname(backupPath);

    try {

      await fs.mkdir(backupDir, { recursive: true });

    } catch (error) {

      // 디렉토리가 이미 존재하는 경우 무시

    }



    // 데이터베이스 백업 (실제로는 mongodump 등을 사용해야 함)

    const collections = await mongoose.connection.db.listCollections().toArray();

    const backup = {};



    for (const collection of collections) {

      const collectionName = collection.name;

      const data = await mongoose.connection.db.collection(collectionName).find({}).toArray();

      backup[collectionName] = data;

    }



    await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));



    logInfo(req, 'admin.backup.create', `Backup created: ${backupName}`, { backupName });



    res.json({

      message: 'Backup created successfully',

      filename: backupName,

      path: backupPath,

      size: (await fs.stat(backupPath)).size

    });

  } catch (error) {

    logError(req, 'admin.backup.create', 'Create backup error', error);

    res.status(500).json({ error: 'Failed to create backup' });

  }

});



router.get("/backup/list", requirePermission("superadmin"), async (req, res) => {

  try {

    const backupDir = path.join(__dirname, '../backups');

    

    let files = [];

    try {

      const dirFiles = await fs.readdir(backupDir);

      files = await Promise.all(

        dirFiles

          .filter(file => file.endsWith('.json'))

          .map(async (file) => {

            const filePath = path.join(backupDir, file);

            const stats = await fs.stat(filePath);

            return {

              name: file,

              size: stats.size,

              created: stats.birthtime,

              modified: stats.mtime

            };

          })

      );

    } catch (error) {

      // 백업 디렉토리가 없는 경우

    }



    res.json({ backups: files });

  } catch (error) {

    logError(req, 'admin.backup.list', 'List backups error', error);

    res.status(500).json({ error: 'Failed to list backups' });

  }

});



router.post("/backup/restore/:filename", requirePermission("superadmin"), async (req, res) => {

  try {

    const { filename } = req.params;

    const backupPath = path.join(__dirname, '../backups', filename);



    // 보안: 상위 디렉토리 접근 방지

    if (!backupPath.startsWith(path.join(__dirname, '../backups'))) {

      return res.status(400).json({ error: 'Invalid backup file path' });

    }



    const backupData = JSON.parse(await fs.readFile(backupPath, 'utf-8'));



    // 데이터베이스 복원 (주의: 기존 데이터가 덮어씌워짐)

    for (const [collectionName, data] of Object.entries(backupData)) {

      if (data && Array.isArray(data) && data.length > 0) {

        await mongoose.connection.db.collection(collectionName).deleteMany({});

        await mongoose.connection.db.collection(collectionName).insertMany(data);

      }

    }



    logInfo(req, 'admin.backup.restore', `Database restored from backup: ${filename}`, { backupName: filename });



    res.json({ 

      message: 'Database restored successfully from backup',

      filename 

    });

  } catch (error) {

    logError(req, 'admin.backup.restore', 'Restore backup error', error);

    res.status(500).json({ error: 'Failed to restore backup' });

  }

});



// 캐시 관리 (superadmin)

router.post("/cache/clear", requirePermission("superadmin"), async (req, res) => {

  try {

    const { type } = req.body;



    switch (type) {

      case 'forbidden-words':

        await updateForbiddenWordsCache();

        logInfo(req, 'admin.cache.clear', 'Forbidden words cache cleared');

        break;

      case 'all':

        await updateForbiddenWordsCache();

        // 다른 캐시들도 여기서 클리어

        logInfo(req, 'admin.cache.clear', 'All caches cleared');

        break;

      default:

        return res.status(400).json({ error: 'Invalid cache type' });

    }



    res.json({ message: `${type} cache cleared successfully` });

  } catch (error) {

    logError(req, 'admin.cache.clear', 'Clear cache error', error);

    res.status(500).json({ error: 'Failed to clear cache' });

  }

});



// 데이터베이스 통계 (superadmin)

router.get("/database/stats", requirePermission("superadmin"), async (req, res) => {

  try {

    const db = mongoose.connection.db;

    const stats = await db.stats();

    

    const collections = await db.listCollections().toArray();

    const collectionStats = await Promise.all(

      collections.map(async (collection) => {

        const collStats = await db.collection(collection.name).stats();

        return {

          name: collection.name,

          count: collStats.count,

          size: collStats.size,

          avgObjSize: collStats.avgObjSize,

          indexes: collStats.nindexes

        };

      })

    );



    res.json({

      database: {

        name: stats.db,

        collections: stats.collections,

        objects: stats.objects,

        dataSize: stats.dataSize,

        storageSize: stats.storageSize,

        indexes: stats.indexes,

        indexSize: stats.indexSize

      },

      collections: collectionStats

    });

  } catch (error) {

    logError(req, 'admin.database.stats', 'Get database stats error', error);

    res.status(500).json({ error: 'Failed to fetch database statistics' });

  }

});



// 실시간 모니터링 (superadmin)

router.get("/monitoring/active-users", requirePermission("superadmin"), async (req, res) => {

  try {

    // 최근 5분 내 활동한 사용자 (실제로는 세션 관리 시스템이 필요)

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    

    const activeUsers = await User.countDocuments({

      lastActive: { $gte: fiveMinutesAgo }

    });



    // 오늘 가입한 사용자

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const newUsersToday = await User.countDocuments({

      createdAt: { $gte: today }

    });



    // 오늘 작성된 게시글

    const newPostsToday = await Post.countDocuments({

      createdAt: { $gte: today }

    });



    // 처리 대기 중인 신고

    const pendingReports = await Report.countDocuments({

      status: 'pending'

    });



    res.json({

      activeUsers,

      newUsersToday,

      newPostsToday,

      pendingReports,

      timestamp: new Date()

    });

  } catch (error) {

    logError(req, 'admin.monitoring.activeUsers', 'Get monitoring data error', error);

    res.status(500).json({ error: 'Failed to fetch monitoring data' });

  }

});



// 에러 로그 조회 (log_view)

router.get("/logs/errors", requirePermission("log_view"), async (req, res) => {

  try {

    const { page = 1, limit = 50, level = 'error' } = req.query;

    

    // 실제로는 로그 파일을 파싱하거나 로그 데이터베이스에서 조회해야 함

    // 여기서는 예시 데이터를 반환

    const errorLogs = [

      {

        timestamp: new Date(),

        level: 'error',

        message: 'Database connection failed',

        stack: 'Error: Connection timeout...',

        userId: null,

        ip: '192.168.1.1'

      }

      // 실제 로그 데이터...

    ];



    res.json({

      logs: errorLogs,

      totalPages: 1,

      currentPage: parseInt(page),

      total: errorLogs.length

    });

  } catch (error) {

    logError(req, 'admin.logs.errors', 'Get error logs error', error);

    res.status(500).json({ error: 'Failed to fetch error logs' });

  }

});



// API 사용량 통계 (statistics)

router.get("/api/usage-stats", requirePermission("statistics"), async (req, res) => {

  try {

    const { period = '24hours' } = req.query;

    

    // 실제로는 API 요청 로그를 분석해야 함

    // 여기서는 예시 데이터를 반환

    const usageStats = {

      totalRequests: 15420,

      successfulRequests: 14856,

      failedRequests: 564,

      averageResponseTime: 245,

      topEndpoints: [

        { endpoint: '/api/posts', requests: 3245 },

        { endpoint: '/api/users', requests: 2156 },

        { endpoint: '/api/auth/login', requests: 1987 }

      ],

      requestsByHour: [] // 시간별 요청 수 데이터

    };



    res.json(usageStats);

  } catch (error) {

    logError(req, 'admin.api.usage', 'Get API usage stats error', error);

    res.status(500).json({ error: 'Failed to fetch API usage statistics' });

  }

});



// 알림 관리 (superadmin)

router.post("/notifications/broadcast", requirePermission("superadmin"), async (req, res) => {

  try {

    const { title, message, type = 'info', targetUsers = 'all' } = req.body;



    if (!title || !message) {

      return res.status(400).json({ error: 'Title and message are required' });

    }



    // 실제로는 알림 시스템을 통해 전송해야 함

    // 여기서는 로깅만 수행

    logInfo(req, 'admin.notifications.broadcast', 'Broadcast notification sent', { title, message, type, targetUsers });



    res.json({ 

      message: 'Broadcast notification sent successfully',

      recipients: targetUsers === 'all' ? 'all users' : `${targetUsers.length} users`

    });

  } catch (error) {

    logError(req, 'admin.notifications.broadcast', 'Send broadcast notification error', error);

    res.status(500).json({ error: 'Failed to send broadcast notification' });

  }

});



module.exports = router;







































































































































