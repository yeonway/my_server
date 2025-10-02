const cron = require('node-cron');
const Statistic = require('../models/statistic');
const User = require('../models/user');
const Post = require('../models/post');
const logger = require('../config/logger');

// 매일 자정에 실행되는 스케줄
const dailyStatsJob = cron.schedule('0 0 * * *', async () => {
  logger.info('일일 통계 집계 작업을 시작합니다.');
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // 댓글 수를 Post 모델에서 직접 집계하도록 수정합니다.
    const commentsAggregation = await Post.aggregate([
        { $match: { "comments.time": { $gte: today, $lt: tomorrow } } },
        { $unwind: "$comments" },
        { $match: { "comments.time": { $gte: today, $lt: tomorrow } } },
        { $count: "total" }
    ]);
    const commentsToday = commentsAggregation.length > 0 ? commentsAggregation[0].total : 0;

    const [usersToday, postsToday] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } }),
      Post.countDocuments({ time: { $gte: today, $lt: tomorrow } }),
    ]);

    await Statistic.findOneAndUpdate(
      { date: today },
      {
        newUsers: usersToday,
        posts: postsToday,
        comments: commentsToday, // 올바르게 집계된 댓글 수를 저장합니다.
      },
      { upsert: true, new: true }
    );

    logger.info('일일 통계 집계 작업이 성공적으로 완료되었습니다.');
  } catch (error) {
    logger.error('일일 통계 집계 작업 중 오류 발생:', error);
  }
}, {
  scheduled: false, // 서버 시작 시 바로 실행되지 않도록 설정
  timezone: "Asia/Seoul"
});

function startScheduler() {
  dailyStatsJob.start();
  logger.info('일일 통계 스케줄러가 시작되었습니다.');
}

module.exports = { startScheduler };