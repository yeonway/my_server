const ForbiddenWord = require('../models/forbiddenWord');
const logger = require('../config/logger');
const korcenClassifier = require('../services/korcenClassifier');
const { generateContentVariants } = require('../utils/contentNormalization');

let forbiddenWordsCache = [];
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

const buildPattern = (word = '') => {
  const trimmed = word.trim();
  if (!trimmed) return null;

  // Treat hyphen as a wildcard so "병-신" matches "병신", "병  신", etc.
  const segments = trimmed
    .split('-')
    .map((segment) => segment.replace(REGEX_SPECIAL_CHARS, '\\$&'));

  const pattern = segments.join('[\\s\\S]*');
  return new RegExp(pattern, 'i');
};

const createCacheEntry = (wordDoc) => {
  const word = typeof wordDoc?.word === 'string' ? wordDoc.word : '';
  const regex = buildPattern(word);
  if (!regex) return null;

  return { word, regex };
};

/**
 * Refresh forbidden words cache from the database.
 */
async function updateForbiddenWordsCache() {
  try {
    const words = await ForbiddenWord.find().lean();
    forbiddenWordsCache = words.map(createCacheEntry).filter(Boolean);
    lastCacheTime = Date.now();
    logger.info('Forbidden words cache has been updated.');
  } catch (error) {
    logger.error('Error updating forbidden words cache: %s', error.message);
  }
}

// Prime the cache on startup.
updateForbiddenWordsCache();

/**
 * Check if request body contains any forbidden words or abusive language.
 */
const contentFilter = async (req, res, next) => {
  if (Date.now() - lastCacheTime > CACHE_DURATION) {
    await updateForbiddenWordsCache();
  }

  const fieldsToCensor = ['title', 'content', 'message'];
  const mlCandidates = new Set();

  for (const field of fieldsToCensor) {
    const value = req.body[field];

    if (typeof value !== 'string' || !value.trim()) continue;

    const variants = generateContentVariants(value);
    if (!variants.length) continue;

    variants.forEach((variant) => mlCandidates.add(variant));

    for (const entry of forbiddenWordsCache) {
      const matched = variants.some((variant) => entry.regex.test(variant));
      if (!matched) continue;

      return res.status(400).json({
        error: `부적절한 단어("${entry.word}")가 포함되어 있어 요청을 처리할 수 없습니다.`,
      });
    }
  }

  const mlPayload = Array.from(mlCandidates);

  if (mlPayload.length && korcenClassifier.isEnabled()) {
    try {
      const shouldBlock = await korcenClassifier.containsAbuse(mlPayload);
      if (shouldBlock) {
        logger.info('[korcen] Request blocked by ML classifier', {
          path: req.originalUrl,
          userId: req?.user?.id ?? null,
        });
        return res.status(400).json({
          error: 'AI 필터가 부적절한 표현을 감지하여 요청을 차단했습니다.',
        });
      }
    } catch (error) {
      logger.warn('[korcen] Unexpected error while classifying content: %s', error.message);
    }
  }

  next();
};

module.exports = {
  contentFilter,
  updateForbiddenWordsCache,
};
