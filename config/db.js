// config/db.js
const mongoose = require('mongoose');
require('dotenv').config(); // .env 파일 로드

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('.env 파일에 MONGO_URI가 설정되지 않았습니다.');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected...');
  } catch (err) {
    console.error(err.message);
    // 연결 실패 시 프로세스 종료
    process.exit(1);
  }
};

module.exports = connectDB;