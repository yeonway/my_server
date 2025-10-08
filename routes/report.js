const express = require('express');
const router = express.Router();
const Report = require('../models/report');
const Post = require('../models/post');
const Message = require('../models/message');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../config/logger');

// 새 신고 제출 API (로그 추가)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { contentType, contentId, reason } = req.body;
    const reporterId = req.user.id;

    if (!contentType || !contentId || !reason) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    // 이미 동일한 콘텐츠를 신고했는지 확인
    const existingReport = await Report.findOne({ reporter: reporterId, contentId });
    if (existingReport) {
      return res.status(409).json({ error: '이미 신고한 콘텐츠입니다.' });
    }

    let contentOwnerId = null;
    // 콘텐츠 종류에 따라 원본 작성자를 찾음
    if (contentType === 'post') {
      const post = await Post.findById(contentId).select('user');
      if (post) contentOwnerId = post.user;
    } else if (contentType === 'comment') {
      const post = await Post.findOne({ 'comments._id': contentId }).select('comments.user');
      if (post) {
        const comment = post.comments.id(contentId);
        if(comment) contentOwnerId = comment.user;
      }
    } else if (contentType === 'chat') {
      const message = await Message.findById(contentId).select('user');
      if (message) contentOwnerId = message.user;
    }
    
    // 자기 자신의 콘텐츠는 신고 불가
    if (contentOwnerId && contentOwnerId.toString() === reporterId) {
        return res.status(403).json({ error: '자신의 콘텐츠는 신고할 수 없습니다.' });
    }

    const newReport = new Report({
      contentType,
      contentId,
      contentOwner: contentOwnerId,
      reporter: reporterId,
      reason,
    });

    await newReport.save();

    logger.info(`New report submitted: ${req.user.username} -> ${contentType} (${contentId}) reason: ${reason}`);
    if (req.userLogger) req.userLogger('info', `신고 제출: ${contentType} 콘텐츠 신고 (사유: ${reason})`);
    
    res.status(201).json({ message: '신고가 정상적으로 접수되었습니다.' });

  } catch (err) {
    logger.error(`Report submission error: ${err.message}`);
    res.status(500).json({ error: '신고 처리 중 서버 오류가 발생했습니다.' });
  }
});

module.exports = router;