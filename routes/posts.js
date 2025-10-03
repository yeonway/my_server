const express = require("express");
const router = express.Router();
const mongoose = require('mongoose');
const Post = require("../models/post");
const BackupPost = require("../models/backupPost");
const Report = require("../models/report");
const { authMiddleware, authAdmin } = require("../middleware/auth");
const { contentFilter } = require("../middleware/contentFilter");
const logger = require('../config/logger');
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { resolveBlockSets, isInteractionBlocked } = require('../utils/blocking');

// --- Multer 설정 (파일 업로드) ---
const uploadDir = path.join(__dirname, "..", "public", "uploads", "posts");
const postsBackupDir = path.join(__dirname, "..", "public", "uploads", "archive", "posts_backup");
[uploadDir, postsBackupDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${req.user.username}_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// --- 게시글 목록 조회 (GET /) ---
router.get("/", authMiddleware, async (req, res) => {
  try {
    const page = +(req.query.page || 1);
    const limit = +(req.query.limit || 10);
    const q = req.query.searchQuery || '';
    const t = req.query.searchType || 'all';

    const blockInfo = await resolveBlockSets(req.user.id);
    const blockedAuthorIds = new Set([
      ...blockInfo.blocked,
      ...blockInfo.blockedBy,
    ]);
    const blockedObjectIds = Array.from(blockedAuthorIds)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const authorFilter = blockedObjectIds.length
      ? { author: { $nin: blockedObjectIds } }
      : {};

    const baseQuery = { deleted: { $ne: true }, ...authorFilter };
    if (q) {
      const r = { $regex: q, $options: 'i' };
      if (t === 'title') baseQuery.title = r;
      else if (t === 'content') baseQuery.content = r;
      else if (t === 'user') baseQuery.user = r;
      else baseQuery.$or = [{ title: r }, { content: r }, { user: r }];
    }

    // 공지사항 조회
    const notices = await Post.find({
      isNotice: true,
      deleted: { $ne: true },
      ...authorFilter,
    })
    .populate('author', 'photo name intro')
    .sort({ time: -1 })
    .lean();

    // 일반 게시글 조회
    const regularPostQuery = {
      ...baseQuery,
      $or: [
        { isNotice: { $exists: false } },
        { isNotice: false },
        { isNotice: null }
      ]
    };

    const total = await Post.countDocuments(regularPostQuery);
    const posts = await Post.find(regularPostQuery)
      .populate('author', 'photo name intro')
      .sort({ time: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      notices,
      posts,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalPosts: total
    });
  } catch (e) {
    console.error("게시글 조회 오류:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- 단일 게시글 조회 (GET /:id) ---.populate('author', 'photo name intro')
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const [post, blockInfo] = await Promise.all([
      Post.findById(req.params.id)
        .populate('author', 'photo name intro')
        .populate('comments.author', 'photo name intro'),
      resolveBlockSets(req.user.id),
    ]);

    if (!post || post.deleted) {
      return res.status(404).json({ error: "글을 찾을 수 없습니다." });
    }

    const blockedSet = new Set([
      ...blockInfo.blocked,
      ...blockInfo.blockedBy,
    ]);

    const authorId = post.author?.id || post.author?._id?.toString() || post.author?.toString();
    if (authorId && blockedSet.has(authorId.toString())) {
      return res.status(403).json({ error: '차단된 사용자의 게시글입니다.' });
    }

    const payload = post.toObject({ virtuals: true });
    if (Array.isArray(payload.comments)) {
      payload.comments = payload.comments.filter((comment) => {
        const commentAuthorId = comment.author?.id
          || comment.author?._id?.toString()
          || comment.author?.toString();
        return commentAuthorId ? !blockedSet.has(commentAuthorId.toString()) : true;
      });
    }

    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 이미지 업로드 (POST /upload-image) ---
router.post("/upload-image", authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 업로드되지 않았습니다." });
  const imagePath = `/uploads/posts/${req.file.filename}`;
  // 백업 로직
  try {
    fs.copyFileSync(path.join(uploadDir, req.file.filename), path.join(postsBackupDir, req.file.filename));
  } catch (e) {
    logger.warn(`Post Image Backup Fail: ${e.message}`);
  }
  if (req.userLogger) req.userLogger('info', `게시글 이미지 업로드: ${req.file.filename}`);
  res.json({ imagePath });
});

// --- 게시글 작성 (POST /) ---
// contentFilter를 여기에만 적용합니다.
router.post("/", authMiddleware, contentFilter, async (req, res) => {
  try {
    const { title, content, images } = req.body;
    const post = new Post({
      title,
      content,
      images: images || [],
      user: req.user.username,
      author: req.user.id,
    });
    await post.save();
    if (req.userLogger) req.userLogger('info', `게시글 작성: ${post._id}`);
    logger.info(`Post Created: ${req.user.username} -> ${post._id}`);
    res.status(201).json(post);
  } catch (e) {
    logger.error(`Post Create Error: ${e.message}`);
    res.status(400).json({ error: e.message });
  }
});

// --- 게시글 수정 (PUT /:id) ---
// contentFilter를 여기에만 적용합니다.
router.put("/:id", authMiddleware, contentFilter, async (req, res) => {
  try {
    const { title, content } = req.body;
    const [post, blockInfo] = await Promise.all([
      Post.findById(req.params.id),
      resolveBlockSets(req.user.id),
    ]);
    if (!post) return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
    if (post.user !== req.user.username && !req.user.isAdmin)
      return res.status(403).json({ error: "수정 권한이 없습니다." });
    const authorId = post.author?.toString();
    if (authorId && isInteractionBlocked(authorId, blockInfo)) {
      return res.status(403).json({ error: '차단된 사용자와 상호작용할 수 없습니다.' });
    }
    post.title = title;
    post.content = content;
    post.lastEditedAt = new Date();
    await post.save();
    logger.info(`Post Updated: ${req.user.username} -> ${post._id}`);
    res.json(post);
  } catch (e) {
    logger.error(`Post Update Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// --- 댓글 작성 (POST /:id/comment) ---
router.post("/:id/comment", authMiddleware, contentFilter, async (req, res) => {
  try {
    const [post, blockInfo] = await Promise.all([
      Post.findById(req.params.id),
      resolveBlockSets(req.user.id),
    ]);
    if (!post) return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });

    const authorId = post.author?.toString();
    if (authorId && isInteractionBlocked(authorId, blockInfo)) {
      return res.status(403).json({ error: '차단된 사용자와 상호작용할 수 없습니다.' });
    }

    const newComment = {
      user: req.user.username,
      author: req.user.id,
      content: req.body.content,
      time: new Date()
    };
    
    post.comments.push(newComment);
    await post.save();
    
    logger.info(`Comment created: ${req.user.username} -> post ${req.params.id}`);
    if (req.userLogger) req.userLogger('info', `댓글 작성: 게시글 "${post.title}" (${req.params.id})`);
    
    res.json({ message: "댓글이 작성되었습니다." });
  } catch (e) {
    logger.error(`Comment create error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// 댓글 삭제
router.delete("/:postId/comment/:commentId", authMiddleware, async (req,res)=>{
  try{
    const post = await Post.findById(req.params.postId);
    if(!post || post.deleted) return res.status(404).json({error:"글을 찾을 수 없습니다."});
    const c = post.comments.id(req.params.commentId);
    if(!c) return res.status(404).json({error:"댓글을 찾을 수 없습니다."});
    if(c.user !== req.user.username && !req.user.isAdmin)
      return res.status(403).json({error:"삭제 권한이 없습니다."});
    
    post.comments.pull({_id:req.params.commentId});
    await post.save();
    
    logger.info(`Comment deleted: ${req.user.username} -> comment ${req.params.commentId} in post ${req.params.postId}`);
    if (req.userLogger) req.userLogger('info', `댓글 삭제: 게시글 "${post.title}" (${req.params.postId})`);
    
    res.json({message:"댓글이 삭제되었습니다."});
  }catch(e){ 
    logger.error(`Comment delete error: ${e.message}`);
    res.status(500).json({error:e.message}); 
  }
});

// 댓글 수정 API 추가
router.put("/:postId/comment/:commentId", authMiddleware, contentFilter, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post || post.deleted) return res.status(404).json({ error: "글을 찾을 수 없습니다." });
    
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });
    
    if (comment.user !== req.user.username && !req.user.isAdmin)
      return res.status(403).json({ error: "수정 권한이 없습니다." });
    
    const oldContent = comment.content;
    comment.content = req.body.content;
    comment.editedAt = new Date();
    await post.save();
    
    logger.info(`Comment updated: ${req.user.username} -> comment ${req.params.commentId} in post ${req.params.postId}`);
    if (req.userLogger) req.userLogger('info', `댓글 수정: 게시글 "${post.title}" (${req.params.postId})`);
    
    res.json({ message: "댓글이 수정되었습니다." });
  } catch (e) {
    logger.error(`Comment update error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// --- 나머지 라우트 (삭제, 신고 등)는 기존과 동일하게 유지 ---
// (기존 파일에 있던 댓글 삭제, 신고, 관리자 기능 등 나머지 코드는 여기에 그대로 이어집니다)

// 삭제 (soft delete)
router.delete("/:id", authMiddleware, async (req,res)=>{
  try{
    const post = await Post.findById(req.params.id);
    if(!post) return res.status(404).json({error:"글을 찾을 수 없습니다."});
    if(post.user !== req.user.username && !req.user.isAdmin)
      return res.status(403).json({error:"삭제 권한이 없습니다."});

    // Soft delete 처리
    post.deleted = true;
    post.deletedAt = new Date();
    await post.save();
    
    if (req.userLogger) req.userLogger('info', `게시글 삭제: ${post._id}`);
    logger.info(`Post Deleted: ${req.user.username} -> ${post._id}`);
    res.json({message:"글이 삭제되었습니다."});
  }catch(e){
    logger.error(`Post Delete Error: ${e.message}`);
    res.status(500).json({error:e.message});
  }
});

// 댓글 신고
router.post("/:postId/comment/:commentId/report", authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: "신고 사유를 입력해야 합니다." });
    }
    const post = await Post.findById(req.params.postId);
    if (!post || post.deleted) {
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
    }
    const comment = post.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ error: "신고할 댓글을 찾을 수 없습니다." });
    }
    const existingReport = await Report.findOne({
      reporter: req.user.id,
      contentId: comment._id,
      contentType: 'comment'
    });
    if (existingReport) {
      return res.status(409).json({ error: "이미 신고한 댓글입니다." });
    }
    const report = new Report({
      contentType: 'comment',
      contentId: comment._id,
      contentOwner: comment.author,
      reporter: req.user.id,
      reason: reason,
    });
    await report.save();
    logger.info(`Comment Reported: reporter ${req.user.username}, comment ${comment._id}`);
    res.status(201).json({ message: "신고가 성공적으로 접수되었습니다." });
  } catch (e) {
    logger.error(`Comment Report Error: ${e.message}`);
    res.status(500).json({ error: "신고 처리 중 오류가 발생했습니다." });
  }
});


module.exports = router;
