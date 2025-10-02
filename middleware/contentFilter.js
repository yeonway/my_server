const ForbiddenWord = require('../models/forbiddenWord');
const logger = require('../config/logger');

// 금지어 목록을 메모리에 캐싱하여 DB 조회를 최소화합니다.
let forbiddenWordsCache = [];
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5분

/**
 * 금지어 목록을 DB에서 불러와 캐시를 업데이트하는 함수
 */
async function updateForbiddenWordsCache() {
  try {
    const words = await ForbiddenWord.find().lean();
    forbiddenWordsCache = words.map(item => item.word);
    lastCacheTime = Date.now();
    logger.info('Forbidden words cache has been updated.');
  } catch (error) {
    logger.error('Error updating forbidden words cache:', error);
  }
}

// 서버 시작 시 한 번 호출
updateForbiddenWordsCache();

/**
 * 요청 본문(body)의 title, content, message 필드에 금지어가 포함되어 있는지 확인하는 미들웨어
 */
const contentFilter = async (req, res, next) => {
  // 캐시가 만료되었으면 업데이트
  if (Date.now() - lastCacheTime > CACHE_DURATION) {
    await updateForbiddenWordsCache();
  }

  const fieldsToCensor = ['title', 'content', 'message'];
  
  for (const field of fieldsToCensor) {
    if (req.body[field] && typeof req.body[field] === 'string') {
      for (const word of forbiddenWordsCache) {
        if (req.body[field].includes(word)) {
          // 금지어가 발견되면 에러 응답
          return res.status(400).json({ 
            error: `부적절한 단어("${word}")가 포함되어 있어 요청을 처리할 수 없습니다.` 
          });
        }
      }
    }
  }
  
  // 금지어가 없으면 다음 미들웨어로 진행
  next();
};

// 관리자가 금지어를 변경했을 때 즉시 캐시를 갱신할 수 있도록 함수를 export 합니다.
module.exports = {
  contentFilter,
  updateForbiddenWordsCache
};