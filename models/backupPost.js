const mongoose = require("mongoose");

const BackupPostSchema = new mongoose.Schema({
  originalId: mongoose.Schema.Types.ObjectId, // 원본 Post _id
  title: String,
  content: String,
  user: String,
  time: Date,          // 원본 작성 시간
  comments: [{
    user: String,
    content: String,
    time: Date
  }],
  images: [String], // 이미지 경로들을 저장하는 배열 추가
  deletedAt: { type: Date, default: Date.now },
  deletedBy: String
});

module.exports = mongoose.model("BackupPost", BackupPostSchema);
