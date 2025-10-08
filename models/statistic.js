const mongoose = require('mongoose');

const statisticSchema = new mongoose.Schema({
  date: { type: Date, required: true, unique: true, index: true }, // 통계 날짜
  visits: { type: Number, default: 0 }, // 총 방문 수 (페이지 뷰)
  newUsers: { type: Number, default: 0 }, // 신규 가입자 수
  activeUsers: { type: Number, default: 0 }, // 활성 사용자 수 (로그인 기준)
  posts: { type: Number, default: 0 }, // 새 게시글 수
  comments: { type: Number, default: 0 }, // 새 댓글 수
});

// 날짜를 'YYYY-MM-DD' 형식으로 비교하기 위한 인덱스
statisticSchema.index({ date: 1 });

const Statistic = mongoose.model('Statistic', statisticSchema);

module.exports = Statistic;