const mongoose = require('mongoose');

const { Schema } = mongoose;

const loginActivitySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    usernameSnapshot: {
      type: String,
      trim: true,
      default: '',
    },
    ipAddress: {
      type: String,
      required: true,
      trim: true,
    },
    userAgent: {
      type: String,
      default: '',
      trim: true,
    },
    location: {
      type: Schema.Types.Mixed,
      default: null,
    },
    success: {
      type: Boolean,
      default: false,
      index: true,
    },
    suspicious: {
      type: Boolean,
      default: false,
      index: true,
    },
    suspicionReasons: {
      type: [String],
      default: [],
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

loginActivitySchema.index({ user: 1, createdAt: -1 });
loginActivitySchema.index({ user: 1, ipAddress: 1, success: 1 });
loginActivitySchema.index({ createdAt: -1 });

module.exports = mongoose.model('LoginActivity', loginActivitySchema);
