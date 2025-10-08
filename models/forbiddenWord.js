const mongoose = require('mongoose');

const forbiddenWordSchema = new mongoose.Schema({
  word: {
    type: String,
    required: true,
    unique: true, // 중복된 단어는 저장되지 않음
    trim: true,
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // 어떤 관리자가 추가했는지 기록
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }
});

// 단어로 빠르게 검색할 수 있도록 인덱스 추가
forbiddenWordSchema.index({ word: 1 });

const ForbiddenWord = mongoose.model('ForbiddenWord', forbiddenWordSchema);

module.exports = ForbiddenWord;