const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Inquiry = require('../models/inquiry');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../config/logger');
const { QUICK_ACTIONS, FAQ_ITEMS, HELP_TOPICS } = require('../config/inquiryContent');

const uploadDir = path.join(__dirname, '..', 'uploads', 'inquiries');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function filename(req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ storage });

function toPublicAttachmentPath(storedPath) {
  const normalized = storedPath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

router.get('/meta', (req, res) => {
  res.json({
    quickActions: QUICK_ACTIONS,
    faqs: FAQ_ITEMS,
    helpTopics: HELP_TOPICS,
    slaHours: 24,
  });
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    const history = await Inquiry.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const normalized = history.map((inquiry) => ({
      id: inquiry._id,
      inquiryType: inquiry.inquiryType,
      title: inquiry.title,
      content: inquiry.content,
      status: inquiry.status,
      attachmentUrl: inquiry.attachment ? toPublicAttachmentPath(inquiry.attachment) : null,
      createdAt: inquiry.createdAt,
      resolvedAt: inquiry.resolvedAt || null,
    }));

    const openCount = normalized.filter((item) => item.status !== 'closed').length;

    res.json({
      inquiries: normalized,
      summary: {
        total: normalized.length,
        open: openCount,
        lastUpdated: new Date(),
      },
    });
  } catch (error) {
    logger.error(`Inquiry history fetch error: ${error.message}`);
    res.status(500).json({ error: '문의 내역을 불러오는 중 오류가 발생했습니다.' });
  }
});

router.post('/', authMiddleware, upload.single('attachment'), async (req, res) => {
  try {
    const { inquiryType, title, content } = req.body;

    if (!inquiryType || !title || !content) {
      return res.status(400).json({ error: '문의 유형, 제목, 내용을 모두 입력해주세요.' });
    }

    const inquiryData = {
      user: req.user.id,
      inquiryType,
      title: title.trim(),
      content: content.trim(),
    };

    if (req.file) {
      const relativePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
      inquiryData.attachment = relativePath;
    }

    const newInquiry = new Inquiry(inquiryData);
    await newInquiry.save();

    logger.info(
      `New inquiry submitted: ${req.user.username} -> ${inquiryType}: "${title}" ${req.file ? '(with attachment)' : ''}`,
    );

    if (req.userLogger) {
      req.userLogger(
        'info',
        `문의 제출: ${inquiryType} - "${title}" ${req.file ? '(첨부파일 포함)' : ''}`,
      );
    }

    res.status(201).json({
      message: '문의가 성공적으로 접수되었습니다. 빠른 시일 내에 확인 후 처리하겠습니다.',
      inquiryId: newInquiry._id,
    });
  } catch (err) {
    logger.error(`Inquiry submission error: ${err.message}`);

    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        logger.warn(`Failed to cleanup inquiry attachment: ${unlinkError.message}`);
      }
    }

    res.status(500).json({ error: '문의 제출 중 서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
