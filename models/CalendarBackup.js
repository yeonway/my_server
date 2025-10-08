const mongoose = require('mongoose');

const { Schema } = mongoose;

const BACKUP_REASONS = ['수정', '삭제', '관리자 조치'];

const calendarBackupSchema = new Schema(
  {
    originalId: {
      type: Schema.Types.ObjectId,
      ref: 'Calendar',
      required: true,
    },
    snapshot: {
      type: Schema.Types.Mixed,
      required: true,
    },
    reason: {
      type: String,
      enum: BACKUP_REASONS,
      required: true,
    },
    backedUpAt: {
      type: Date,
      default: Date.now,
    },
    backedUpBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: false,
  }
);

calendarBackupSchema.index({ originalId: 1, backedUpAt: -1 });
calendarBackupSchema.index({ reason: 1, backedUpAt: -1 });

calendarBackupSchema.statics.BACKUP_REASONS = BACKUP_REASONS;

module.exports = mongoose.model('CalendarBackup', calendarBackupSchema);
