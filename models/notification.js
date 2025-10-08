const mongoose = require('mongoose');

const notificationTypes = ['comment', 'mention', 'dm', 'group_invite', 'announcement'];

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: notificationTypes, required: true },
    message: { type: String, required: true },
    link: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.notificationTypes = notificationTypes;
