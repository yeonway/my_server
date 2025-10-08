const SEPARATOR_REGEX = /[\s0-9`~!@#$%^&*()\-=+_[\]{}\\|;:'",.<>/?\u200B\u200C\u200D\u2060\uFEFF]/g;

const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ',
  'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];

const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ',
  'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const CHOSEONG_MAP = Object.fromEntries(CHOSEONG.map((char, idx) => [char, idx]));
const JUNGSEONG_MAP = Object.fromEntries(JUNGSEONG.map((char, idx) => [char, idx]));
const JONGSEONG_MAP = Object.fromEntries(JONGSEONG.map((char, idx) => [char, idx]).filter(([, idx]) => idx > 0));

const FULLWIDTH_START = 0xff01;
const FULLWIDTH_END = 0xff5e;
const FULLWIDTH_OFFSET = 0xfee0;

const LOOKALIKE_MAP = {
  '1': 'ㅣ',
  '!': 'ㅣ',
  '¡': 'ㅣ',
  '|': 'ㅣ',
  '‖': 'ㅣ',
  'l': 'ㅣ',
  'I': 'ㅣ',
  'i': 'ㅣ',
  'í': 'ㅣ',
  'ì': 'ㅣ',
  'ɩ': 'ㅣ',
  '0': 'ㅇ',
  'O': 'ㅇ',
  'o': 'ㅇ',
  '○': 'ㅇ',
  '●': 'ㅇ',
  '◎': 'ㅇ',
  '@': 'ㅇ',
  '$': 'ㅅ',
  '5': 'ㅅ',
  'S': 'ㅅ',
  's': 'ㅅ',
  'B': 'ㅂ',
  'b': 'ㅂ',
  '8': 'ㅂ',
  'P': 'ㅍ',
  'p': 'ㅍ',
  '7': 'ㄱ',
  'Λ': 'ㅅ',
};

const KOREAN_KEYBOARD_MAP = {
  q: 'ㅂ',
  w: 'ㅈ',
  e: 'ㄷ',
  r: 'ㄱ',
  t: 'ㅅ',
  y: 'ㅛ',
  u: 'ㅕ',
  i: 'ㅑ',
  o: 'ㅐ',
  p: 'ㅔ',
  a: 'ㅁ',
  s: 'ㄴ',
  d: 'ㅇ',
  f: 'ㄹ',
  g: 'ㅎ',
  h: 'ㅗ',
  j: 'ㅓ',
  k: 'ㅏ',
  l: 'ㅣ',
  z: 'ㅋ',
  x: 'ㅌ',
  c: 'ㅊ',
  v: 'ㅍ',
  b: 'ㅠ',
  n: 'ㅜ',
  m: 'ㅡ',
};

const stripSeparators = (value = '') => value.replace(SEPARATOR_REGEX, '');

const normalizeWidth = (value = '') =>
  Array.from(value)
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code === 0x3000) return ' ';
      if (code >= FULLWIDTH_START && code <= FULLWIDTH_END) {
        return String.fromCharCode(code - FULLWIDTH_OFFSET);
      }
      return char;
    })
    .join('');

const replaceLookAlikeCharacters = (value = '') => {
  let changed = false;
  const converted = Array.from(value)
    .map((char) => {
      if (LOOKALIKE_MAP[char]) {
        changed = true;
        return LOOKALIKE_MAP[char];
      }
      const lower = char.toLowerCase();
      if (LOOKALIKE_MAP[lower]) {
        changed = true;
        return LOOKALIKE_MAP[lower];
      }
      return char;
    })
    .join('');
  return changed ? converted : value;
};

const applyKeyboardMapping = (value = '') => {
  let changed = false;
  const converted = Array.from(value)
    .map((char) => {
      const lower = char.toLowerCase();
      if (KOREAN_KEYBOARD_MAP[lower]) {
        changed = true;
        return KOREAN_KEYBOARD_MAP[lower];
      }
      return char;
    })
    .join('');
  return changed ? converted : value;
};

const composeHangulFromCompat = (value = '') => {
  const chars = Array.from(value);
  if (!chars.length) return '';

  const S_BASE = 0xac00;
  const V_COUNT = JUNGSEONG.length;
  const T_COUNT = JONGSEONG.length;

  let result = '';
  let bufferL = null;
  let bufferV = null;
  let bufferT = null;

  const flushBuffer = () => {
    if (bufferL !== null) {
      if (bufferV !== null) {
        const tIndex = bufferT ?? 0;
        const codePoint = S_BASE + (bufferL * V_COUNT + bufferV) * T_COUNT + tIndex;
        result += String.fromCharCode(codePoint);
      } else {
        result += CHOSEONG[bufferL];
      }
    } else if (bufferV !== null) {
      result += JUNGSEONG[bufferV];
    }
    bufferL = null;
    bufferV = null;
    bufferT = null;
  };

  for (const char of chars) {
    if (char in CHOSEONG_MAP) {
      flushBuffer();
      bufferL = CHOSEONG_MAP[char];
      continue;
    }

    if (char in JUNGSEONG_MAP) {
      if (bufferL === null) {
        flushBuffer();
        result += char;
        continue;
      }
      bufferV = JUNGSEONG_MAP[char];
      continue;
    }

    if (char in JONGSEONG_MAP) {
      if (bufferL !== null && bufferV !== null) {
        bufferT = JONGSEONG_MAP[char];
        flushBuffer();
        continue;
      }
      flushBuffer();
      result += char;
      continue;
    }

    flushBuffer();
    result += char;
  }

  flushBuffer();
  return result;
};

const decomposeHangulToCompat = (value = '') => {
  const S_BASE = 0xac00;
  const S_END = 0xd7a3;
  const V_COUNT = JUNGSEONG.length;
  const T_COUNT = JONGSEONG.length;

  let result = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code >= S_BASE && code <= S_END) {
      const syllableIndex = code - S_BASE;
      const lIndex = Math.floor(syllableIndex / (V_COUNT * T_COUNT));
      const vIndex = Math.floor((syllableIndex % (V_COUNT * T_COUNT)) / T_COUNT);
      const tIndex = syllableIndex % T_COUNT;

      result += CHOSEONG[lIndex];
      result += JUNGSEONG[vIndex];
      if (tIndex > 0) result += JONGSEONG[tIndex];
    } else {
      result += char;
    }
  }
  return result;
};

const generateContentVariants = (value) => {
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  const variants = new Set();
  const queue = [trimmed];

  while (queue.length) {
    const current = queue.shift();
    if (!current || variants.has(current)) continue;
    variants.add(current);

    const lower = current.toLowerCase();
    if (lower !== current) queue.push(lower);

    const normalizedWidth = normalizeWidth(current);
    if (normalizedWidth !== current) queue.push(normalizedWidth);

    const lookAlike = replaceLookAlikeCharacters(current);
    if (lookAlike !== current) queue.push(lookAlike);

    const keyboard = applyKeyboardMapping(current);
    if (keyboard !== current) queue.push(keyboard);

    const stripped = stripSeparators(current);
    if (stripped && stripped !== current) queue.push(stripped);

    const composedCurrent = composeHangulFromCompat(current);
    if (composedCurrent && composedCurrent !== current) queue.push(composedCurrent);

    if (stripped) {
      const composedStripped = composeHangulFromCompat(stripped);
      if (composedStripped && composedStripped !== current) queue.push(composedStripped);
    }

    const decomposed = decomposeHangulToCompat(current);
    if (decomposed && decomposed !== current) queue.push(decomposed);
  }

  return Array.from(variants).filter(Boolean);
};

module.exports = {
  stripSeparators,
  normalizeWidth,
  replaceLookAlikeCharacters,
  applyKeyboardMapping,
  composeHangulFromCompat,
  decomposeHangulToCompat,
  generateContentVariants,
};
