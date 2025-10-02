// config/logger.js
const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const logDir = 'logs'; // 로그 파일을 저장할 폴더

// 로그 폴더가 없으면 생성
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// 로그 형식 정의
const logFormat = winston.format.printf(({ timestamp, level, message }) => {
  return `${timestamp} ${level}: ${message}`;
});

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // 'info' 레벨 이상의 로그를 파일에 기록
    new winston.transports.DailyRotateFile({
      level: 'info',
      datePattern: 'YYYY-MM-DD',
      dirname: logDir,
      filename: `app-%DATE%.log`,
      maxFiles: '14d', // 14일치 로그 보관
      zippedArchive: true, // 오래된 로그는 압축
    }),
    // 개발 중에는 콘솔에도 로그를 출력
    new winston.transports.Console({
      level: 'info',
    }),
  ],
});

module.exports = logger;