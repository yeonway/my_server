const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  // 신고된 콘텐츠 정보
  contentType: {
    type: String,
    required: true,
    enum: ['post', 'comment', 'chat'], // 신고된 콘텐츠 종류 (게시글, 댓글, 채팅)
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'contentType', // contentType에 따라 참조 모델이 동적으로 결정됨
  },
  contentOwner: { // 콘텐츠 작성자
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // 신고자 정보
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // 신고 내용
  reason: {
    type: String,
    required: true,
    trim: true,
  },

  // 처리 상태
  status: {
    type: String,
    enum: ['pending', 'resolved', 'dismissed'], // 대기, 해결, 기각
    default: 'pending',
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
  resolvedAt: { // 처리 완료 일시
    type: Date,
  },
  resolver: { // 처리한 관리자
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }
});

reportSchema.index({ status: 1, createdAt: -1 });

const Report = mongoose.model('Report', reportSchema);

module.exports = Report;