const Notification = require('../models/notification');
const User = require('../models/user');

let ioInstance = null;

function setSocketServer(io) {
  ioInstance = io;
}

function emitToUser(userId, event, payload) {
  if (!ioInstance || !userId) return;
  ioInstance.to(userId.toString()).emit(event, payload);
}

function sanitize(notification) {
  if (!notification) return null;
  const base = typeof notification.toObject === 'function' ? notification.toObject() : notification;
  const actor = base.actor || null;
  return {
    id: base._id ? base._id.toString() : null,
    type: base.type,
    message: base.message,
    link: base.link || null,
    payload: base.payload || {},
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

  const doc = await Notification.create({
    recipient: recipientId,
    actor: actorId || null,
    type,
    message,
    link,
    payload,
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

async function listNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
  if (!userId) return { notifications: [], unreadCount: 0 };
  const filter = { recipient: userId };
  if (unreadOnly) filter.read = false;

  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('actor', 'username name photo profilePhoto')
    .lean({ virtuals: false });

  const unreadCount = await Notification.countDocuments({ recipient: userId, read: false });
  return {
    notifications: notifications.map((doc) => sanitize(doc)),
    unreadCount,
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
  extractMentions,
  findMentionedUsers,
  getUnreadCount,
};
