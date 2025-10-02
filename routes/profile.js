const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Post = require("../models/post"); // Post 모델을 불러옵니다.
const { JWT_SECRET } = require("../config/secrets");

const photoDir = path.join(__dirname, "..", "uploads", "users");
const backupDir = path.join(__dirname, "..", "uploads", "archive", "profile_backup");
[photoDir, backupDir].forEach(d=>{ if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); });

function authSimple(req,res,next){
  const token = req.headers.authorization?.split(" ")[1];
  if(!token) return res.status(401).json({error:"토큰 없음"});
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({error:"유효하지 않은 토큰"}); }
}

// Multer 스토리지 설정 (파일 이름 생성 방식 수정)
const storage = multer.diskStorage({
  destination:(_,__,cb)=>cb(null, photoDir),
  filename: (req, file, cb) => {
    // 파일 이름이 겹치지 않도록 타임스탬프와 랜덤 문자열을 사용합니다.
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname).toLowerCase(); // 확장자를 소문자로 통일
    cb(null, `${req.user.username}-${uniqueSuffix}${extension}`);
  }
});

const upload = multer({
  storage,
  fileFilter:(_,file,cb)=>{
    const ex = path.extname(file.originalname).toLowerCase();
    cb(['.jpg','.jpeg','.png','.gif','.webp'].includes(ex)?null:new Error('이미지 파일만'), true);
  }
});

// 프로필 정보 조회 API
router.get("/", authSimple, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password'); // 비밀번호 제외
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 프로필 정보(이름, 자기소개) 수정 API (로그 추가)
router.put("/", authSimple, async (req, res) => {
  try {
    const { name, intro } = req.body;
    const oldUser = await User.findById(req.user.id).select('name intro');
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { name, intro } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }
    
    // 변경사항 로깅
    const changes = [];
    if (oldUser.name !== name) changes.push(`이름: ${oldUser.name} -> ${name}`);
    if (oldUser.intro !== intro) changes.push(`소개: ${oldUser.intro || '없음'} -> ${intro || '없음'}`);
    
    if (changes.length > 0) {
      const logger = require('../config/logger');
      logger.info(`Profile updated: ${req.user.username} -> ${changes.join(', ')}`);
      if (req.userLogger) req.userLogger('info', `프로필 정보 수정: ${changes.join(', ')}`);
    }
    
    res.json({ message: "프로필이 업데이트되었습니다.", user });
  } catch (err) {
    res.status(500).json({ error: "프로필 업데이트 중 오류가 발생했습니다." });
  }
});

// --- 내 활동 내역 API 추가 ---

// 현재 로그인한 사용자가 작성한 게시글 목록 조회
router.get("/posts", authSimple, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user.id, deleted: { $ne: true } })
      .sort({ time: -1 })
      // .select()에 '_id'를 추가하여 게시글 ID를 반드시 포함하도록 수정합니다.
      .select('_id title time category') 
      .lean();
    res.json(posts);
  } catch (err) {
    console.error("Error fetching user posts:", err);
    res.status(500).json({ error: "게시글을 불러오는 중 오류가 발생했습니다." });
  }
});

// 현재 로그인한 사용자가 작성한 댓글 목록 조회
router.get("/comments", authSimple, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const userId = new mongoose.Types.ObjectId(req.user.id);

    const myComments = await Post.aggregate([
      { $unwind: "$comments" },
      { $match: { "comments.author": userId, "deleted": { $ne: true } } },
      { $sort: { "comments.time": -1 } },
      {
        $project: {
          _id: "$comments._id",
          content: "$comments.content",
          time: "$comments.time",
          postId: "$_id",
          postTitle: "$title"
        }
      }
    ]);
    res.json(myComments);
  } catch (err) {
    console.error("Error fetching user comments:", err);
    res.status(500).json({ error: "댓글을 불러오는 중 오류가 발생했습니다." });
  }
});

// 사진 업로드 + 백업 (로그 추가)
router.post("/photo", authSimple, upload.single("photo"), async (req,res)=>{
  const me = await User.findById(req.user.id);
  if(!me) return res.status(404).json({error:"사용자 없음"});
  
  // 새 파일 경로를 DB에 저장합니다.
  me.photo = `/uploads/users/${req.file.filename}`;
  await me.save();

  // 백업 로직 (선택적)
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  try {
    fs.copyFileSync(
      path.join(photoDir, req.file.filename),
      path.join(backupDir, `${stamp}_${req.user.username}${path.extname(req.file.originalname)}`)
    );
  } catch{}
  
  const logger = require('../config/logger');
  logger.info(`Profile photo updated: ${req.user.username} -> ${req.file.filename}`);
  if (req.userLogger) req.userLogger('info', `프로필 사진 업로드: ${req.file.filename}`);
  
  res.json({ path: me.photo });
});

// 프로필 사진 삭제 API (로그 추가)
router.delete("/photo", authSimple, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }
    // DB에서 사진 경로 삭제
    user.photo = "";
    await user.save();
    
    const logger = require('../config/logger');
    logger.info(`Profile photo deleted: ${req.user.username}`);
    if (req.userLogger) req.userLogger('info', `프로필 사진 삭제`);
    
    res.json({ message: "프로필 사진이 삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: "사진 삭제 중 오류가 발생했습니다." });
  }
});


module.exports = router;
