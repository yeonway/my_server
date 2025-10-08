// models/post.js
const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const commentSchema = new mongoose.Schema({
  user: String,
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String,
  time: { type: Date, default: Date.now },
});

function normalizeImages(input) {
  if (!input) return [];
  // 단일 문자열
  if (typeof input === 'string') return [{ url: input, order: 0 }];
  // 단일 객체
  if (!Array.isArray(input)) {
    const url = input.url || input.path || String(input);
    return url ? [{ url, order: 0 }] : [];
  }
  // 배열 처리
  const arr = input
    .map((it, idx) => {
      if (typeof it === 'string') return { url: it, order: idx };
      const url = it?.url || it?.path || String(it);
      const order =
        typeof it?.order === 'number' && Number.isFinite(it.order) ? it.order : idx;
      return url ? { url, order } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((img, idx) => ({ url: img.url, order: idx }));
  return arr;
}

const postSchema = new mongoose.Schema({
  title: String,
  content: String,
  user: String, // 작성자 username
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  images: {
    type: [imageSchema],
    default: [],
    set: normalizeImages, // ✅ 검증 전에 통일
  },
  comments: [commentSchema],
  time: { type: Date, default: Date.now },
  lastEditedAt: Date,
  isNotice: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  deletedAt: Date,
});

module.exports = mongoose.model('Post', postSchema);
