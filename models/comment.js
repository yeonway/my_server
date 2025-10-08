// models/comment.js
const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  user: { type: String },
  content: { type: String },
  time: { type: Date, default: Date.now }
});

const Comment = mongoose.model('Comment', commentSchema);
module.exports = Comment;