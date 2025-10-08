const mongoose = require('mongoose');

const { Schema } = mongoose;

const adminActivitySchema = new Schema(
  {
    admin: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    targetType: {
      type: String,
      default: '',
      trim: true,
    },
    targetId: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
);

adminActivitySchema.index({ createdAt: -1 });
adminActivitySchema.index({ admin: 1, createdAt: -1 });
adminActivitySchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model('AdminActivity', adminActivitySchema);
