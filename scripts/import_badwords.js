// .env 파일의 절대 경로를 지정하여 dotenv를 설정합니다.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const ForbiddenWord = require('../models/forbiddenWord');

// 금지어 목록 파일 경로 (scripts 폴더 내)
const badwordsFilePath = path.join(__dirname, 'badwords.ko.config.json');

async function importBadWords() {
  // 1. 데이터베이스 연결
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI 환경 변수가 설정되어 있지 않습니다. .env 파일을 확인하세요.');
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // useCreateIndex: true, // Deprecated
    });
    console.log('데이터베이스에 성공적으로 연결되었습니다.');
  } catch (err) {
    console.error('데이터베이스 연결 실패:', err);
    return;
  }

  try {
    // 2. 금지어 파일 읽기
    if (!fs.existsSync(badwordsFilePath)) {
      throw new Error(`'${badwordsFilePath}' 파일을 찾을 수 없습니다. 프로젝트 루트 폴더에 파일을 위치시켜주세요.`);
    }
    const badwordsFile = fs.readFileSync(badwordsFilePath, 'utf-8');
    const { badWords } = JSON.parse(badwordsFile);

    if (!badWords || !Array.isArray(badWords)) {
      throw new Error('JSON 파일 형식이 올바르지 않습니다. "badWords" 배열을 포함해야 합니다.');
    }
    console.log(`파일에서 ${badWords.length}개의 금지어를 읽었습니다.`);

    // 3. 데이터베이스에 금지어 추가 (중복 방지)
    const operations = badWords.map(word => ({
      updateOne: {
        filter: { word: word.trim() },
        update: { $setOnInsert: { word: word.trim(), addedBy: 'system-import' } },
        upsert: true
      }
    }));

    if (operations.length > 0) {
      console.log('금지어를 데이터베이스에 추가하는 중입니다...');
      const result = await ForbiddenWord.bulkWrite(operations);
      console.log('-----------------------------------------');
      console.log('금지어 추가 작업 완료!');
      console.log(`- 새로 추가된 단어: ${result.upsertedCount}개`);
      console.log(`- 이미 존재하던 단어: ${result.matchedCount}개`);
      console.log('-----------------------------------------');
    } else {
      console.log('추가할 새로운 금지어가 없습니다.');
    }

  } catch (error) {
    console.error('작업 중 오류가 발생했습니다:', error.message);
  } finally {
    // 4. 데이터베이스 연결 종료
    await mongoose.disconnect();
    console.log('데이터베이스 연결이 종료되었습니다.');
  }
}

// 스크립트 실행
importBadWords();