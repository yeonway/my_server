const mongoose = require('mongoose');
const User = require('../models/user');

function toIdString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value.toHexString === 'function') return value.toHexString();
  return String(value);
}

async function resolveBlockSets(userId) {
  const id = toIdString(userId);
  if (!id) {
    return { blocked: new Set(), blockedBy: new Set() };
  }

  const [currentUser, blockedByDocs] = await Promise.all([
    User.findById(id).select('blockedUsers').lean(),
    User.find({ blockedUsers: id }).select('_id').lean(),
  ]);

  const blocked = new Set();
  if (currentUser?.blockedUsers?.length) {
    currentUser.blockedUsers.forEach((value) => {
      const asString = toIdString(value);
      if (asString) blocked.add(asString);
    });
  }

  const blockedBy = new Set();
  blockedByDocs.forEach((doc) => {
    const asString = toIdString(doc?._id);
    if (asString) blockedBy.add(asString);
  });

  return { blocked, blockedBy };
}

function isInteractionBlocked(targetId, blockInfo) {
  if (!blockInfo) return false;
  const id = toIdString(targetId);
  if (!id) return false;
  return blockInfo.blocked.has(id) || blockInfo.blockedBy.has(id);
}

module.exports = {
  resolveBlockSets,
  isInteractionBlocked,
};
