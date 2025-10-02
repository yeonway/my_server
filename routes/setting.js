const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const User = require("../models/user");
const { authMiddleware } = require("../middleware/auth");
const logger = require('../config/logger');

// 비밀번호 변경
router.put("/password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword = '', newPassword = '' } = req.body || {};
    const current = String(currentPassword).trim();
    const next = String(newPassword).trim();

    if (!current || !next) {
      return res.status(400).json({ error: "현재 비밀번호와 새 비밀번호를 모두 입력해주세요." });
    }
    if (next.length < 6) {
      return res.status(400).json({ error: "새 비밀번호는 6자 이상이어야 합니다." });
    }
    if (current === next) {
      return res.status(400).json({ error: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    // 현재 비밀번호 확인
    const isMatch = await bcrypt.compare(current, user.password);
    if (!isMatch) {
      logger.warn(`Password change failed - wrong current password: ${user.username}`);
      if (req.userLogger) req.userLogger('warn', `비밀번호 변경 실패 - 현재 비밀번호 틀림`);
      return res.status(400).json({ error: "현재 비밀번호가 올바르지 않습니다." });
    }

    user.password = next; // pre-save hook hashes the password automatically
    await user.save();

    logger.info(`Password changed: ${user.username}`);
    if (req.userLogger) req.userLogger('info', `비밀번호 변경 성공`);

    res.json({ message: "비밀번호가 성공적으로 변경되었습니다." });
  } catch (err) {
    logger.error(`Password change error: ${err.message}`);
    console.error("Password change error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 회원 탈퇴
router.delete("/", authMiddleware, async (req, res) => {
  try {
    const { password = '' } = req.body || {};
    const trimmed = String(password).trim();
    if (!trimmed) {
      return res.status(400).json({ error: "비밀번호가 필요합니다." });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    // 비밀번호 확인
    const isMatch = await bcrypt.compare(trimmed, user.password);
    if (!isMatch) {
      logger.warn(`Account deletion failed - wrong password: ${user.username}`);
      if (req.userLogger) req.userLogger('warn', `회원탈퇴 실패 - 비밀번호 틀림`);
      return res.status(400).json({ error: "비밀번호가 올바르지 않습니다." });
    }

    const deletedUsername = user.username;
    
    // 사용자 삭제
    await User.findByIdAndDelete(req.user.id);

    logger.info(`Account deleted: ${deletedUsername}`);
    if (req.userLogger) req.userLogger('info', `회원탈퇴 성공`);

    res.json({ message: "회원 탈퇴가 성공적으로 처리되었습니다." });
  } catch (err) {
    logger.error(`Account deletion error: ${err.message}`);
    console.error("Account deletion error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
