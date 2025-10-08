const mongoose = require('mongoose');

const Notification = require('../models/notification');
const User = require('../models/user');
const Chatroom = require('../models/chatroom');
const Message = require('../models/message');
const { resolveBlockSets, isInteractionBlocked } = require('../utils/blocking');

const notificationTypes = Array.isArray(Notification.notificationTypes)
  ? Notification.notificationTypes
  : [];

const TYPE_LABELS = {
  comment: '댓글',
  mention: '멘션',
  dm: 'DM',
  group_invite: '그룹 초대',
  announcement: '공지',
};

let ioInstance = null;

function setSocketServer(io) {
  ioInstance = io;
}

function emitToUser(userId, event, payload) {
  if (!ioInstance || !userId) return;
  ioInstance.to(userId.toString()).emit(event, payload);
}

function toStringSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') {
    return value.toString();
  }
  try {
    return String(value);
  } catch (error) {
    return null;
  }
}

function toPlainObject(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object') return value;
  if (typeof value.toJSON === 'function') {
    try {
      return value.toJSON();
    } catch (error) {
      // fall through
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    const plain = Array.isArray(value) ? [] : {};
    Object.entries(value).forEach(([key, entry]) => {
      plain[key] = typeof entry === 'object' && entry !== null ? toPlainObject(entry) : entry;
    });
    return plain;
  }
}

function preparePayload(type, payload = {}) {
  const normalized = toPlainObject(payload) || {};

  if (normalized && typeof normalized === 'object') {
    if (normalized.messageId) {
      normalized.messageId = toStringSafe(normalized.messageId) || normalized.messageId;
    }
    if (normalized.postId) {
      normalized.postId = toStringSafe(normalized.postId) || normalized.postId;
    }
    if (normalized.commentId) {
      normalized.commentId = toStringSafe(normalized.commentId) || normalized.commentId;
    }
  }

  if (type === 'dm') {
    const roomIdRaw = normalized.roomId || normalized.chatroomId || normalized.room;
    const roomId = toStringSafe(roomIdRaw);
    if (roomId) {
      normalized.roomId = roomId;
      if (!normalized.chatroomId) {
        normalized.chatroomId = roomId;
      }
      if (normalized.quickReply && typeof normalized.quickReply === 'object') {
        normalized.quickReply = {
          type: normalized.quickReply.type || 'dm',
          roomId: toStringSafe(normalized.quickReply.roomId) || roomId,
        };
      } else {
        normalized.quickReply = { type: 'dm', roomId };
      }
    }
  }

  return normalized;
}

function createEmptySummary() {
  const summary = { all: { total: 0, unread: 0 } };
  notificationTypes.forEach((type) => {
    summary[type] = { total: 0, unread: 0 };
  });
  return summary;
}

function normalizeTypeFilters(types) {
  if (!types) return [];
  const candidates = Array.isArray(types)
    ? types
    : String(types)
        .split(',')
        .map((value) => value.trim());
  const unique = new Set();
  candidates
    .map((value) => value && value.toString && value.toString())
    .filter((value) => value && notificationTypes.includes(value))
    .forEach((value) => unique.add(value));
  return Array.from(unique);
}

function parseCursor(rawCursor) {
  if (!rawCursor) {
    return { createdBefore: null, idBefore: null };
  }

  const value = String(rawCursor);
  let timestampPart = null;
  let idPart = null;

  if (value.includes('|')) {
    [timestampPart, idPart] = value.split('|', 2);
  } else {
    idPart = value;
  }

  let createdBefore = null;
  if (timestampPart) {
    const date = new Date(timestampPart);
    if (!Number.isNaN(date.getTime())) {
      createdBefore = date;
    }
  }

  let idBefore = null;
  if (idPart && mongoose.Types.ObjectId.isValid(idPart.trim())) {
    idBefore = new mongoose.Types.ObjectId(idPart.trim());
  }

  return { createdBefore, idBefore };
}

function quickReplyError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sanitize(notification) {
  if (!notification) return null;
  const base = typeof notification.toObject === 'function' ? notification.toObject() : notification;
  const actor = base.actor || null;
  const payload = preparePayload(base.type, base.payload);
  return {
    id: base._id ? base._id.toString() : null,
    type: base.type,
    typeLabel: TYPE_LABELS[base.type] || '알림',
    message: base.message,
    link: base.link || null,
    payload,
    read: Boolean(base.read),
    readAt: base.readAt || null,
    createdAt: base.createdAt || null,
    actor: actor
      ? {
          id: actor._id ? actor._id.toString() : actor.toString(),
          username: actor.username || null,
          name: actor.name || null,
          photo: actor.photo || actor.profilePhoto || null,
        }
      : null,
  };
}

async function formatById(id) {
  if (!id) return null;
  const doc = await Notification.findById(id)
    .populate('actor', 'username name photo profilePhoto')
    .lean({ virtuals: false });
  if (!doc) return null;
  return sanitize(doc);
}

async function createNotification({ recipientId, actorId = null, type, message, link = null, payload = {} }) {
  if (!recipientId || !type || !message) return null;
  if (actorId && actorId.toString() === recipientId.toString()) return null;

  const payloadData = preparePayload(type, payload);

  const doc = await Notification.create({
    recipient: recipientId,
    actor: actorId || null,
    type,
    message,
    link,
    payload: payloadData,
  });

  const formatted = await formatById(doc._id);
  emitToUser(recipientId, 'notification:new', formatted);
  return formatted;
}

async function createNotifications(items = []) {
  const results = [];
  for (const item of items) {
    const created = await createNotification(item);
    if (created) results.push(created);
  }
  return results;
}

async function markAsRead(notificationId, userId) {
  if (!notificationId || !userId) return null;
  const doc = await Notification.findOne({ _id: notificationId, recipient: userId })
    .populate('actor', 'username name photo profilePhoto');
  if (!doc) return null;

  if (!doc.read) {
    doc.read = true;
    doc.readAt = new Date();
    await doc.save();
  }

  const formatted = sanitize(doc);
  emitToUser(userId, 'notification:updated', formatted);
  return formatted;
}

async function markAllAsRead(userId) {
  if (!userId) return { modifiedCount: 0 };
  const now = new Date();
  const result = await Notification.updateMany(
    { recipient: userId, read: false },
    { $set: { read: true, readAt: now } }
  );
  emitToUser(userId, 'notification:read-all', { readAt: now.toISOString() });
  return result;
}

async function listNotifications(
  userId,
  { unreadOnly = false, limit = 50, types = [], cursor = null } = {},
) {
  if (!userId) {
    return { notifications: [], unreadCount: 0, summary: createEmptySummary(), nextCursor: null };
  }

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const filter = { recipient: userId };
  if (unreadOnly) filter.read = false;

  const typeFilters = normalizeTypeFilters(types);
  if (typeFilters.length) {
    filter.type = { $in: typeFilters };
  }

  const { createdBefore, idBefore } = parseCursor(cursor);
  if (createdBefore || idBefore) {
    if (createdBefore) {
      filter.$or = [{ createdAt: { $lt: createdBefore } }];
      if (idBefore) {
        filter.$or.push({ createdAt: createdBefore, _id: { $lt: idBefore } });
      }
    } else if (idBefore) {
      filter._id = { $lt: idBefore };
    }
  }

  const docs = await Notification.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(normalizedLimit)
    .populate('actor', 'username name photo profilePhoto')
    .lean({ virtuals: false });

  const [unreadCount, summary] = await Promise.all([
    getUnreadCount(userId),
    getTypeSummary(userId),
  ]);

  let nextCursor = null;
  if (docs.length === normalizedLimit) {
    const last = docs[docs.length - 1];
    if (last) {
      const timestamp = last.createdAt instanceof Date ? last.createdAt.toISOString() : last.createdAt;
      const idPart = last._id ? last._id.toString() : null;
      if (timestamp && idPart) {
        nextCursor = `${timestamp}|${idPart}`;
      } else if (idPart) {
        nextCursor = idPart;
      }
    }
  }

  return {
    notifications: docs.map((doc) => sanitize(doc)),
    unreadCount,
    summary,
    nextCursor,
  };
}

async function getTypeSummary(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return createEmptySummary();
  }

  const summary = createEmptySummary();
  const results = await Notification.aggregate([
    { $match: { recipient: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$type',
        total: { $sum: 1 },
        unread: {
          $sum: {
            $cond: [{ $eq: ['$read', false] }, 1, 0],
          },
        },
      },
    },
  ]);

  results.forEach((entry) => {
    const key = entry._id;
    const total = entry.total || 0;
    const unread = entry.unread || 0;
    if (!summary[key]) {
      summary[key] = { total: 0, unread: 0 };
    }
    summary[key].total = total;
    summary[key].unread = unread;
    summary.all.total += total;
    summary.all.unread += unread;
  });

  return summary;
}

async function getNotificationDetail(notificationId, userId) {
  if (!notificationId || !userId) return null;
  const doc = await Notification.findOne({ _id: notificationId, recipient: userId })
    .populate('actor', 'username name photo profilePhoto')
    .lean({ virtuals: false });
  if (!doc) return null;
  return sanitize(doc);
}

async function sendQuickReply(notificationId, userId, message) {
  if (!notificationId || !userId) return null;
  if (typeof message !== 'string' || !message.trim()) {
    throw quickReplyError('답장 내용을 입력해 주세요.', 400);
  }

  const doc = await Notification.findOne({ _id: notificationId, recipient: userId })
    .populate('actor', 'username name photo profilePhoto');
  if (!doc) return null;

  const normalizedPayload = preparePayload(doc.type, doc.payload);
  doc.payload = normalizedPayload;
  doc.markModified('payload');

  const quickReply = normalizedPayload.quickReply;
  if (!quickReply || quickReply.type !== 'dm') {
    throw quickReplyError('이 알림에서는 빠른 답장을 지원하지 않습니다.', 400);
  }

  const roomId = quickReply.roomId || normalizedPayload.roomId || normalizedPayload.chatroomId;
  const trimmedMessage = message.trim();
  if (!roomId) {
    throw quickReplyError('대상 채팅방을 찾을 수 없습니다.', 404);
  }
  if (!trimmedMessage) {
    throw quickReplyError('답장 내용을 입력해 주세요.', 400);
  }

  const chatroom = await Chatroom.findById(roomId);
  if (!chatroom) {
    throw quickReplyError('대상 채팅방을 찾을 수 없습니다.', 404);
  }

  const userIdString = userId.toString();
  const isMember = (chatroom.participants || []).some(
    (participant) => participant && participant.toString() === userIdString,
  );
  if (!isMember) {
    throw quickReplyError('채팅방에 참여하고 있지 않습니다.', 403);
  }

  const blockInfo = await resolveBlockSets(userId);
  const hasBlockedParticipant = (chatroom.participants || []).some((participant) => {
    const id = participant && participant.toString();
    if (!id || id === userIdString) return false;
    return isInteractionBlocked(id, blockInfo);
  });
  if (hasBlockedParticipant) {
    throw quickReplyError('차단된 사용자와는 대화할 수 없습니다.', 403);
  }

  const user = await User.findById(userId).select('username');
  if (!user) {
    throw quickReplyError('사용자 정보를 찾을 수 없습니다.', 404);
  }

  const now = new Date();
  const chatroomId = chatroom._id.toString();
  const messageDoc = await Message.create({
    room: chatroomId,
    user: user.username || userIdString,
    author: user._id,
    message: trimmedMessage,
    messageType: 'text',
    time: now,
  });

  chatroom.lastMessageAt = now;
  await chatroom.save();

  if (!doc.read) {
    doc.read = true;
    doc.readAt = now;
  }
  await doc.save();

  const sanitizedNotification = sanitize(doc);
  emitToUser(userId, 'notification:updated', sanitizedNotification);

  if (ioInstance) {
    ioInstance.to(chatroomId).emit('chatMessage', {
      _id: messageDoc._id,
      room: messageDoc.room,
      user: messageDoc.user,
      author: messageDoc.author,
      message: messageDoc.message,
      messageType: messageDoc.messageType,
      time: messageDoc.time,
      editedAt: messageDoc.editedAt,
      editHistory: Array.isArray(messageDoc.editHistory) ? messageDoc.editHistory : [],
    });
  }

  const participants = (chatroom.participants || [])
    .map((participant) => participant && participant.toString && participant.toString())
    .filter((participantId) => participantId && participantId !== userIdString);

  if (participants.length) {
    const actorName = user.username || '사용자';
    await createNotifications(
      participants.map((recipientId) => ({
        recipientId,
        actorId: userId,
        type: 'dm',
        message: `${actorName} sent you a direct message.`,
        link: `/chat.html?room=${chatroomId}`,
        payload: {
          chatroomId,
          roomId: chatroomId,
          messageId: messageDoc._id ? messageDoc._id.toString() : null,
          quickReply: { type: 'dm', roomId: chatroomId },
        },
      })),
    );
  }

  const [unreadCount, summary] = await Promise.all([
    getUnreadCount(userId),
    getTypeSummary(userId),
  ]);

  return {
    notification: sanitizedNotification,
    message: {
      id: messageDoc._id ? messageDoc._id.toString() : null,
      room: messageDoc.room,
      message: messageDoc.message,
      messageType: messageDoc.messageType,
      time: messageDoc.time,
    },
    unreadCount,
    summary,
  };
}

function extractMentions(text) {
  if (typeof text !== 'string') return [];
  const regex = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{2,20})/g;
  const result = new Set();
  let match = regex.exec(text);
  while (match) {
    result.add(match[1]);
    match = regex.exec(text);
  }
  return Array.from(result);
}

async function findMentionedUsers(text, { excludeIds = [] } = {}) {
  const usernames = extractMentions(text);
  if (!usernames.length) return [];
  const users = await User.find({ username: { $in: usernames } })
    .select('_id username')
    .lean();
  const excluded = new Set((excludeIds || []).map((id) => id.toString()));
  return users.filter((user) => !excluded.has(user._id.toString()));
}

async function getUnreadCount(userId) {
  if (!userId) return 0;
  return Notification.countDocuments({ recipient: userId, read: false });
}

module.exports = {
  setSocketServer,
  createNotification,
  createNotifications,
  markAsRead,
  markAllAsRead,
  listNotifications,
  getTypeSummary,
  getNotificationDetail,
  sendQuickReply,
  extractMentions,
  findMentionedUsers,
  getUnreadCount,
};
