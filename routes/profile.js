const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/user");
const Post = require("../models/post");
const Message = require("../models/message");
const { JWT_SECRET } = require("../config/secrets");
const logger = require("../config/logger");

const photoDir = path.join(__dirname, "..", "uploads", "users");
const backgroundDir = path.join(__dirname, "..", "uploads", "users", "backgrounds");
const backupDir = path.join(__dirname, "..", "uploads", "archive", "profile_backup");
[photoDir, backgroundDir, backupDir].forEach((dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const visibilityLevels = ["public", "followers", "private"];
const activityTypes = ["post", "comment", "chat", "achievement", "system", "custom"];
const visibilityKeys = ["posts", "comments", "chats", "badges", "activity"];

function authSimple(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "토큰 없음" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: "유효하지 않은 토큰" });
  }
}

function imageFilter(_, file, cb) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (allowedImageExtensions.has(extension)) {
    cb(null, true);
  } else {
    cb(new Error("이미지 파일만 업로드 가능합니다."));
  }
}

function uniqueFileName(username, originalName) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const extension = path.extname(originalName).toLowerCase();
  return `${username}-${uniqueSuffix}${extension}`;
}

const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, photoDir),
  filename: (req, file, cb) => cb(null, uniqueFileName(req.user.username, file.originalname))
});

const backgroundStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, backgroundDir),
  filename: (req, file, cb) => cb(null, uniqueFileName(req.user.username, file.originalname))
});

const uploadAvatar = multer({ storage: avatarStorage, fileFilter: imageFilter });
const uploadBackground = multer({ storage: backgroundStorage, fileFilter: imageFilter });

function sanitizeVisibilityScopes(scopes) {
  if (!scopes || typeof scopes !== "object") {
    return undefined;
  }

  const sanitized = {};
  for (const key of visibilityKeys) {
    const value = scopes[key];
    if (typeof value === "string" && visibilityLevels.includes(value)) {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function sanitizeBadges(badges) {
  if (!Array.isArray(badges)) {
    return null;
  }

  const sanitized = [];
  for (const badge of badges) {
    if (!badge || typeof badge.name !== "string") continue;
    const name = badge.name.trim();
    if (!name) continue;

    let earnedAt = new Date();
    if (badge.earnedAt) {
      const parsed = new Date(badge.earnedAt);
      if (!Number.isNaN(parsed.getTime())) {
        earnedAt = parsed;
      }
    }

    sanitized.push({
      name,
      description: typeof badge.description === "string" ? badge.description.trim() : "",
      icon: typeof badge.icon === "string" ? badge.icon.trim() : "",
      earnedAt
    });
  }

  return sanitized;
}

function buildActivityEntry(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return null;
  }

  const type = activityTypes.includes(body.type) ? body.type : "custom";
  const entry = {
    type,
    title,
    detail: typeof body.detail === "string" ? body.detail.trim() : "",
    link: typeof body.link === "string" ? body.link.trim() : "",
    metadata: typeof body.metadata === "object" && body.metadata !== null ? body.metadata : {}
  };

  if (body.occurredAt) {
    const occurredAt = new Date(body.occurredAt);
    if (!Number.isNaN(occurredAt.getTime())) {
      entry.occurredAt = occurredAt;
    }
  }

  if (!entry.occurredAt) {
    entry.occurredAt = new Date();
  }

  return entry;
}

function formatUserResponse(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id,
    username: user.username,
    name: user.name,
    intro: user.intro,
    photo: user.photo,
    backgroundImage: user.backgroundImage,
    statusMessage: user.statusMessage,
    badges: user.badges || [],
    activityHistory: user.activityHistory || [],
    profileVisibility: user.profileVisibility,
    visibilityScopes: user.visibilityScopes
  };
}

router.get("/", authSimple, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    res.json(formatUserResponse(user));
  } catch (error) {
    logger.error("Profile fetch failed", error);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.put("/", authSimple, async (req, res) => {
  try {
    const { name, intro, statusMessage, profileVisibility, visibilityScopes } = req.body;

    const oldUser = await User.findById(req.user.id).select(
      "name intro statusMessage profileVisibility visibilityScopes"
    );

    if (!oldUser) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    const updates = {};

    if (typeof name === "string") {
      updates.name = name.trim();
    }
    if (typeof intro === "string") {
      updates.intro = intro.trim();
    }
    if (typeof statusMessage === "string") {
      updates.statusMessage = statusMessage.trim();
    }
    if (typeof profileVisibility === "string" && ["public", "private"].includes(profileVisibility)) {
      updates.profileVisibility = profileVisibility;
    }

    const sanitizedScopes = sanitizeVisibilityScopes(visibilityScopes);
    if (sanitizedScopes) {
      const existingScopes = oldUser.visibilityScopes
        ? oldUser.visibilityScopes.toObject()
        : {};
      updates.visibilityScopes = { ...existingScopes, ...sanitizedScopes };
    }

    if (!Object.keys(updates).length) {
      return res.json({ message: "변경할 프로필 정보가 없습니다.", user: formatUserResponse(oldUser) });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password");

    const changes = [];
    if (updates.name !== undefined && oldUser.name !== updates.name) {
      changes.push(`이름: ${oldUser.name || "(없음)"} -> ${updates.name || "(없음)"}`);
    }
    if (updates.intro !== undefined && oldUser.intro !== updates.intro) {
      changes.push(`소개: ${oldUser.intro || "(없음)"} -> ${updates.intro || "(없음)"}`);
    }
    if (updates.statusMessage !== undefined && oldUser.statusMessage !== updates.statusMessage) {
      changes.push(`상태 메시지 변경`);
    }
    if (updates.profileVisibility && oldUser.profileVisibility !== updates.profileVisibility) {
      changes.push(`공개 범위: ${oldUser.profileVisibility} -> ${updates.profileVisibility}`);
    }
    if (updates.visibilityScopes) {
      changes.push("세부 공개 범위 조정");
    }

    if (changes.length) {
      logger.info(`Profile updated: ${req.user.username} -> ${changes.join(", ")}`);
      if (req.userLogger) {
        req.userLogger("info", `프로필 정보 수정: ${changes.join(", ")}`);
      }
    }

    res.json({ message: "프로필이 업데이트되었습니다.", user: formatUserResponse(user) });
  } catch (error) {
    logger.error("Profile update failed", error);
    res.status(500).json({ error: "프로필 업데이트 중 오류가 발생했습니다." });
  }
});

router.put("/badges", authSimple, async (req, res) => {
  try {
    const sanitized = sanitizeBadges(req.body.badges);
    if (!sanitized) {
      return res.status(400).json({ error: "배지를 배열 형태로 전달해주세요." });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { badges: sanitized } },
      { new: true, runValidators: true }
    ).select("badges");

    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    logger.info(`Profile badges updated: ${req.user.username} -> ${sanitized.length} badges`);
    if (req.userLogger) {
      req.userLogger("info", `배지 업데이트 (${sanitized.length}개)`);
    }

    res.json({ message: "배지가 업데이트되었습니다.", badges: user.badges });
  } catch (error) {
    logger.error("Badge update failed", error);
    res.status(500).json({ error: "배지를 업데이트하는 중 오류가 발생했습니다." });
  }
});

router.post("/activity", authSimple, async (req, res) => {
  try {
    const entry = buildActivityEntry(req.body);
    if (!entry) {
      return res.status(400).json({ error: "유효한 활동 정보를 입력해주세요." });
    }

    const user = await User.findById(req.user.id).select("activityHistory");
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    user.activityHistory.unshift(entry);
    if (user.activityHistory.length > 50) {
      user.activityHistory = user.activityHistory.slice(0, 50);
    }
    await user.save();

    logger.info(`Activity added for ${req.user.username}: ${entry.title}`);
    if (req.userLogger) {
      req.userLogger("info", `활동 기록 추가: ${entry.title}`);
    }

    res.json({ message: "활동이 추가되었습니다.", activityHistory: user.activityHistory });
  } catch (error) {
    logger.error("Activity append failed", error);
    res.status(500).json({ error: "활동을 추가하는 중 오류가 발생했습니다." });
  }
});

router.get("/activity", authSimple, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("activityHistory");
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    res.json(user.activityHistory || []);
  } catch (error) {
    logger.error("Activity fetch failed", error);
    res.status(500).json({ error: "활동 내역을 불러오는 중 오류가 발생했습니다." });
  }
});

router.get("/overview", authSimple, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: "유효하지 않은 사용자 ID입니다." });
    }
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const [user, posts, comments, chats] = await Promise.all([
      User.findById(req.user.id).select("-password").lean(),
      Post.find({ author: req.user.id, deleted: { $ne: true } })
        .sort({ time: -1 })
        .limit(5)
        .select("_id title time category")
        .lean(),
      Post.aggregate([
        { $match: { deleted: { $ne: true } } },
        { $unwind: "$comments" },
        {
          $match: {
            "comments.author": userObjectId
          }
        },
        { $sort: { "comments.time": -1 } },
        { $limit: 5 },
        {
          $project: {
            _id: "$comments._id",
            content: "$comments.content",
            time: "$comments.time",
            postId: "$_id",
            postTitle: "$title"
          }
        }
      ]),
      Message.find({ author: req.user.id })
        .sort({ time: -1 })
        .limit(10)
        .select("room message messageType time")
        .lean()
    ]);

    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    const activityHistory = Array.isArray(user.activityHistory)
      ? [...user.activityHistory].sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0)).slice(0, 20)
      : [];

    res.json({
      profile: formatUserResponse(user),
      recentPosts: posts,
      recentComments: comments,
      recentChats: chats,
      activityHistory
    });
  } catch (error) {
    logger.error("Profile overview failed", error);
    res.status(500).json({ error: "프로필 정보를 불러오는 중 오류가 발생했습니다." });
  }
});

router.get("/posts", authSimple, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user.id, deleted: { $ne: true } })
      .sort({ time: -1 })
      .select("_id title time category")
      .lean();

    res.json(posts);
  } catch (error) {
    logger.error("Profile posts fetch failed", error);
    res.status(500).json({ error: "게시글을 불러오는 중 오류가 발생했습니다." });
  }
});

router.get("/comments", authSimple, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: "유효하지 않은 사용자 ID입니다." });
    }
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const comments = await Post.aggregate([
      { $match: { deleted: { $ne: true } } },
      { $unwind: "$comments" },
      {
        $match: {
          "comments.author": userObjectId
        }
      },
      { $sort: { "comments.time": -1 } },
      { $limit: 20 },
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

    res.json(comments);
  } catch (error) {
    logger.error("Profile comments fetch failed", error);
    res.status(500).json({ error: "댓글을 불러오는 중 오류가 발생했습니다." });
  }
});

router.post("/photo", authSimple, uploadAvatar.single("photo"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    user.photo = `/uploads/users/${req.file.filename}`;
    await user.save();

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    try {
      fs.copyFileSync(
        path.join(photoDir, req.file.filename),
        path.join(backupDir, `${stamp}_${req.user.username}${path.extname(req.file.originalname)}`)
      );
    } catch (copyError) {
      logger.warn("Profile photo backup failed", copyError);
    }

    logger.info(`Profile photo updated: ${req.user.username} -> ${req.file.filename}`);
    if (req.userLogger) {
      req.userLogger("info", `프로필 사진 업로드: ${req.file.filename}`);
    }

    res.json({ path: user.photo });
  } catch (error) {
    logger.error("Profile photo upload failed", error);
    res.status(500).json({ error: "프로필 사진을 업데이트하는 중 오류가 발생했습니다." });
  }
});

router.delete("/photo", authSimple, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    user.photo = "";
    await user.save();

    logger.info(`Profile photo deleted: ${req.user.username}`);
    if (req.userLogger) {
      req.userLogger("info", "프로필 사진 삭제");
    }

    res.json({ message: "프로필 사진이 삭제되었습니다." });
  } catch (error) {
    logger.error("Profile photo delete failed", error);
    res.status(500).json({ error: "사진 삭제 중 오류가 발생했습니다." });
  }
});

router.post("/background", authSimple, uploadBackground.single("background"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    user.backgroundImage = `/uploads/users/backgrounds/${req.file.filename}`;
    await user.save();

    logger.info(`Profile background updated: ${req.user.username}`);
    if (req.userLogger) {
      req.userLogger("info", "프로필 배경 이미지 변경");
    }

    res.json({ path: user.backgroundImage });
  } catch (error) {
    logger.error("Profile background upload failed", error);
    res.status(500).json({ error: "배경 이미지를 업데이트하는 중 오류가 발생했습니다." });
  }
});

router.delete("/background", authSimple, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    user.backgroundImage = "";
    await user.save();

    logger.info(`Profile background deleted: ${req.user.username}`);
    if (req.userLogger) {
      req.userLogger("info", "프로필 배경 이미지 삭제");
    }

    res.json({ message: "배경 이미지가 삭제되었습니다." });
  } catch (error) {
    logger.error("Profile background delete failed", error);
    res.status(500).json({ error: "배경 이미지를 삭제하는 중 오류가 발생했습니다." });
  }
});

module.exports = router;
