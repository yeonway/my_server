const express = require('express');
const router = express.Router();
const Inquiry = require('../models/inquiry');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../config/logger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 파일 업로드 디렉토리 설정
const uploadDir = path.join(__dirname, '..', 'uploads', 'inquiries');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 스토리지 설정 (파일 저장 위치 및 이름 지정)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 파일 이름 중복을 피하기 위해 타임스탬프 추가
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// 새 문의 제출 API (로그 추가)
router.post('/', authMiddleware, upload.single('attachment'), async (req, res) => {
  try {
    const { inquiryType, title, content } = req.body;

    // 유효성 검사
    if (!inquiryType || !title || !content) {
      return res.status(400).json({ error: '문의 유형, 제목, 내용을 모두 입력해주세요.' });
    }

    const inquiryData = {
      user: req.user.id,
      inquiryType,
      title,
      content,
    };

    // 파일이 첨부된 경우, 파일 경로를 데이터에 추가
    if (req.file) {
      inquiryData.attachment = req.file.path;
    }

    const newInquiry = new Inquiry(inquiryData);
    await newInquiry.save();

    logger.info(`New inquiry submitted: ${req.user.username} -> ${inquiryType}: "${title}" ${req.file ? '(with attachment)' : ''}`);
    if (req.userLogger) req.userLogger('info', `문의 제출: ${inquiryType} - "${title}" ${req.file ? '(첨부파일 포함)' : ''}`);
    
    res.status(201).json({ message: '문의가 성공적으로 접수되었습니다. 빠른 시일 내에 확인 후 처리하겠습니다.' });

  } catch (err) {
    logger.error(`Inquiry submission error: ${err.message}`);
    res.status(500).json({ error: '문의 제출 중 서버 오류가 발생했습니다.' });
  }
});

module.exports = router;