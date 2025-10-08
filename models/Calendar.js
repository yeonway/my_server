const mongoose = require('mongoose');

const { Schema } = mongoose;

const CATEGORY_VALUES = ['시험', '숙제', '생일', '약속', '기타'];
const PRIORITY_VALUES = ['high', 'medium', 'low'];
const NOTIFY_VALUES = [null, '1d', '3d', '7d'];

const calendarSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    date: {
      type: Date,
      required: true,
    },
    time: {
      type: String,
      default: '',
      trim: true,
      validate: {
        validator: (value) => !value || /^\d{2}:\d{2}$/.test(value),
        message: '시간은 HH:mm 형식으로 입력해 주세요.',
      },
    },
    category: {
      type: String,
      enum: CATEGORY_VALUES,
      required: true,
    },
    priority: {
      type: String,
      enum: PRIORITY_VALUES,
      default: 'low',
    },
    notifyBefore: {
      type: String,
      enum: NOTIFY_VALUES,
      default: null,
    },
    reminderStatus: {
      type: Map,
      of: Date,
      default: () => ({}),
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// 날짜/카테고리/삭제 여부로 월별 조회 최적화
calendarSchema.index({ date: 1, category: 1, isDeleted: 1 });
// 작성자별 일정 정렬
calendarSchema.index({ createdBy: 1, date: 1 });
// 제목/설명 검색용 텍스트 인덱스
calendarSchema.index({ title: 'text', description: 'text' });

calendarSchema.statics.CATEGORY_VALUES = CATEGORY_VALUES;
calendarSchema.statics.PRIORITY_VALUES = PRIORITY_VALUES;
calendarSchema.statics.NOTIFY_VALUES = NOTIFY_VALUES;

module.exports = mongoose.model('Calendar', calendarSchema);
