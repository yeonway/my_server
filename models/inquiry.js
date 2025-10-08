const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  // 문의 작성자
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // 문의 유형
  inquiryType: {
    type: String,
    required: true,
    enum: ['account', 'bug_report', 'suggestion', 'content_report', 'other'],
  },
  // 문의 제목
  title: {
    type: String,
    required: true,
    trim: true,
  },
  // 문의 내용
  content: {
    type: String,
    required: true,
  },
  // 첨부 파일 경로
  attachment: {
    type: String, // 파일 경로를 문자열로 저장
  },
  // 처리 상태
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
  },
  // 생성일
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // 처리자 (관리자)
  resolver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  // 처리일
  resolvedAt: {
    type: Date,
  },
});

const Inquiry = mongoose.model('Inquiry', inquirySchema);

module.exports = Inquiry;