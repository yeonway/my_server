const mongoose = require('mongoose');

const userActivitySnapshotSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: { type: Date, required: true },
    posts: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    chats: { type: Number, default: 0 },
    recommendationsReceived: { type: Number, default: 0 },
    mentionsReceived: { type: Number, default: 0 },
    notificationsReceived: { type: Number, default: 0 },
    unreadNotifications: { type: Number, default: 0 },
    unreadMessages: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userActivitySnapshotSchema.index({ user: 1, date: 1 }, { unique: true });
userActivitySnapshotSchema.index({ date: 1 });

module.exports = mongoose.model('UserActivitySnapshot', userActivitySnapshotSchema);
