const express = require('express');

const router = express.Router();

const path = require('path');

const multer = require("multer");

const fs = require("fs");

const mongoose = require('mongoose');

const { authMiddleware } = require('../middleware/auth');

const Message = require('../models/message');

const Chatroom = require('../models/chatroom');

const User = require('../models/user');

const Report = require('../models/report');

const logger = require('../config/logger');



const { resolveBlockSets, isInteractionBlocked } = require('../utils/blocking');



const uploadDir = path.join(__dirname, '..', 'uploads', 'chat');

const backupDir = path.join(__dirname, '..', 'uploads', 'archive', 'chat_backup');



if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });



const storage = multer.diskStorage({

  destination: (req, file, cb) => {

    cb(null, uploadDir);

  },

  filename: (req, file, cb) => {

    const ext = path.extname(file.originalname);

    const username = req.user.username || 'user';

    cb(null, `chat_${username}_${Date.now()}${ext}`);

  }

});



const upload = multer({

  storage,

  fileFilter: (_, file, cb) => {

    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype);

    cb(ok ? null : new Error('이미지 파일만 업로드 가능합니다'), ok);

  },

  limits: { fileSize: 10 * 1024 * 1024 }

});



const toObjectId = (value) => {

  if (!value) return null;

  if (value instanceof mongoose.Types.ObjectId) return value;

  if (mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(value);

  return null;

};



const buildDmKey = (userIdA, userIdB) => {

  const sorted = [userIdA.toString(), userIdB.toString()].sort();

  return `${sorted[0]}::${sorted[1]}`;

};



const mapChatroom = (room, currentUserId) => {

  const base = {

    id: room._id.toString(),

    type: room.type,

    name: room.name,

    lastMessageAt: room.lastMessageAt,

  };



  if (room.type === 'dm' && Array.isArray(room.participants)) {

    const other = room.participants.find((participant) => participant._id.toString() !== currentUserId);

    if (other) {

      base.displayName = other.username || other.name || '대화상대';

      base.otherParticipant = {

        id: other._id,

        username: other.username,

        name: other.name,

        profilePhoto: other.profilePhoto || other.photo || null,

      };

    } else {

      base.displayName = room.name || '개인 채팅';

    }

  } else {

    base.displayName = room.name || '채팅방';

  }



  return base;

};



router.get('/rooms', authMiddleware, async (req, res) => {

  try {

    const currentUserId = toObjectId(req.user.id);

    if (!currentUserId) {

      return res.json({ rooms: [] });

    }



    const blockInfo = await resolveBlockSets(req.user.id);

    const currentIdStr = currentUserId.toString();

    const rooms = await Chatroom.find({ participants: currentUserId })

      .sort({ lastMessageAt: -1, updatedAt: -1 })

      .populate('participants', 'username name photo profilePhoto')

      .lean();



    const filtered = rooms.filter((room) => {

      if (!Array.isArray(room.participants)) return true;

      return !room.participants.some((participant) => {

        const participantId = participant?._id?.toString() || participant?.toString();

        if (!participantId || participantId === currentIdStr) return false;

        return isInteractionBlocked(participantId, blockInfo);

      });

    });



    const mapped = filtered.map((room) => mapChatroom(room, currentIdStr));

    res.json({ rooms: mapped });

  } catch (error) {

    logger.error(`Fetch chat rooms error: ${error.message}`);

    res.status(500).json({ error: '채팅방을 불러오지 못했습니다.' });

  }

});



router.post('/rooms', authMiddleware, async (req, res) => {

  try {

    let { name, userIds = [], usernames = [] } = req.body || {};

    name = (name || '').trim();



    if (!name) {

      return res.status(400).json({ error: '채팅방 이름을 입력해 주세요.' });

    }



    const participantIds = new Set([req.user.id]);



    const blockInfo = await resolveBlockSets(req.user.id);



    if (!Array.isArray(userIds)) userIds = [];

    if (!Array.isArray(usernames)) usernames = [];



    const normalizedUserIds = userIds

      .map((value) => toObjectId(value))

      .filter(Boolean)

      .map((value) => value.toString());



    const normalizedUsernames = usernames

      .map((value) => (typeof value === 'string' ? value.trim() : ''))

      .filter(Boolean);



    if (normalizedUsernames.length) {

      const invitedUsers = await User.find({ username: { $in: normalizedUsernames } })

        .select('_id username')

        .lean();

      invitedUsers.forEach((user) => {

        participantIds.add(user._id.toString());

      });

    }



    if (normalizedUserIds.length) {

      const invitedById = await User.find({ _id: { $in: normalizedUserIds } })

        .select('_id username')

        .lean();

      invitedById.forEach((user) => {

        const id = user._id.toString();

        if (id !== req.user.id) {

          participantIds.add(id);

        }

      });

    }



    const MAX_MEMBERS = 20;

    if (participantIds.size > MAX_MEMBERS) {

      return res.status(400).json({ error: `채팅방은 최대 ${MAX_MEMBERS}명까지만 참여할 수 있습니다.` });

    }



    const participants = Array.from(participantIds)

      .map((id) => toObjectId(id))

      .filter(Boolean);



    const blockedMember = participants.find((participant) => {

      const id = participant.toString();

      if (id === req.user.id) return false;

      return isInteractionBlocked(id, blockInfo);

    });



    if (blockedMember) {

      return res.status(403).json({ error: '차단한 사용자와 함께 채팅방을 만들 수 없습니다.' });

    }



    const room = await Chatroom.create({

      type: 'group',

      name,

      participants,

      createdBy: req.user.id,

      lastMessageAt: new Date(),

    });



    const populated = await Chatroom.findById(room._id)

      .populate('participants', 'username name photo profilePhoto')

      .lean();



    const mapped = mapChatroom(populated, req.user.id);



    logger.info(`Chat room created: ${req.user.username} -> ${room._id}`);

    if (req.userLogger) req.userLogger('info', `채팅방 생성: ${name}`);



    res.status(201).json({ room: mapped });

  } catch (error) {

    logger.error(`Create chat room error: ${error.message}`);

    res.status(500).json({ error: '채팅방을 생성하지 못했어요.' });

  }

});

router.post('/rooms/personal', authMiddleware, async (req, res) => {

  try {

    const { userId, username } = req.body;

    const currentUserId = toObjectId(req.user.id);



    let targetUser = null;

    const blockInfo = await resolveBlockSets(req.user.id);

    if (userId) {

      targetUser = await User.findById(userId).lean();

    } else if (username) {

      targetUser = await User.findOne({ username }).lean();

    }



    if (!targetUser) {

      return res.status(404).json({ error: '대화할 사용자를 찾을 수 없습니다.' });

    }



    if (isInteractionBlocked(targetUser._id, blockInfo)) {

      return res.status(403).json({ error: '차단한 사용자와는 대화를 할 수 없습니다.' });

    }



    if (targetUser._id.toString() === currentUserId.toString()) {

      return res.status(400).json({ error: '자기 자신과의 개인 채팅은 만들 수 없습니다.' });

    }



    const dmKey = buildDmKey(currentUserId, targetUser._id);

    let room = await Chatroom.findOne({ type: 'dm', dmKey })

      .populate('participants', 'username name photo profilePhoto');



    if (!room) {

      room = await Chatroom.create({

        type: 'dm',

        participants: [currentUserId, targetUser._id],

        createdBy: currentUserId,

        dmKey,

        lastMessageAt: new Date(),

      });

      room = await room.populate('participants', 'username name photo profilePhoto');

    }



    logger.info(`Personal chat room ready: ${req.user.username} <-> ${targetUser.username}`);

    if (req.userLogger) req.userLogger('info', `개인 채팅 생성: ${targetUser.username}`);



    res.status(201).json({ room: mapChatroom(room, currentUserId.toString()) });

  } catch (error) {

    logger.error(`Create personal chat error: ${error.message}`);

    res.status(500).json({ error: '개인 채팅방을 생성하지 못했습니다.' });

  }

});



router.get('/users/search', authMiddleware, async (req, res) => {

  try {

    const { q = '' } = req.query;

    if (!q || q.trim().length < 1) {

      return res.json({ users: [] });

    }



    const regex = new RegExp(q.trim(), 'i');

    const blockInfo = await resolveBlockSets(req.user.id);

    const users = await User.find({

      _id: { $ne: req.user.id },

      $or: [{ username: regex }, { name: regex }]

    })

      .select('username name photo profilePhoto')

      .limit(10)

      .lean();



    const filtered = users.filter((user) => !isInteractionBlocked(user._id, blockInfo));



    res.json({ users: filtered });

  } catch (error) {

    logger.error(`Personal chat search error: ${error.message}`);

    res.status(500).json({ error: '사용자 검색 중 오류가 발생했습니다.' });

  }

});



router.post('/messages', authMiddleware, async (req, res) => {

  try {

    const { room, message, messageType = 'text' } = req.body;



    if (!room || !message) {

      return res.status(400).json({ error: '채팅방과 메시지를 입력해 주세요.' });

    }



    const blockInfo = await resolveBlockSets(req.user.id);



    let targetRoomId = room;

    const chatroom = await Chatroom.findById(room);



    if (chatroom) {

      const isMember = chatroom.participants.some((participant) => participant.toString() === req.user.id);

      if (!isMember) {

        return res.status(403).json({ error: '해당 채팅방에 참여하고 있지 않습니다.' });

      }

      targetRoomId = chatroom._id.toString();



      const hasBlockedParticipant = chatroom.participants.some((participant) => {

        const id = participant.toString();

        if (id === req.user.id) return false;

        return isInteractionBlocked(id, blockInfo);

      });



      if (hasBlockedParticipant) {

        return res.status(403).json({ error: '차단한 사용자와는 대화를 할 수 없습니다.' });

      }

    }



    const newMessage = new Message({

      room: targetRoomId,

      user: req.user.username,

      author: req.user.id,

      message,

      messageType,

      time: new Date()

    });



    await newMessage.save();

    try {
      const loggedId = newMessage._id ? newMessage._id.toString() : '';
      userLog('admin', 'info', `[CHAT][rest] room=${targetRoomId} messageId=${loggedId} from=${req.user.username} type=${messageType} message=${message}`);
    } catch (err) {
      // ignore logging issues
    }



    if (chatroom) {

      chatroom.lastMessageAt = new Date();

      await chatroom.save();

    }



    logger.info(`Chat message sent: ${req.user.username} -> room ${targetRoomId}`);

    if (req.userLogger) req.userLogger('info', `채팅 메시지 전송: "${targetRoomId}"`);



    res.status(201).json({ message: '메시지가 전송되었습니다.', data: newMessage });

  } catch (e) {

    logger.error(`Chat message send error: ${e.message}`);

    res.status(500).json({ error: '메시지 전송에 실패했습니다.' });

  }

});



router.post('/rooms/:room/join', authMiddleware, async (req, res) => {

  try {

    const { room } = req.params;

    const chatroom = await Chatroom.findById(room);



    if (chatroom) {

      const isMember = chatroom.participants.some((participant) => participant.toString() === req.user.id);

      if (!isMember) {

        return res.status(403).json({ error: '채팅방에 참여할 권한이 없습니다.' });

      }

    }



    logger.info(`User joined chat room: ${req.user.username} -> room ${room}`);

    if (req.userLogger) req.userLogger('info', `채팅방 입장: "${room}"`);



    res.json({ message: `채팅방 "${room}"에 입장했습니다.` });

  } catch (e) {

    logger.error(`Chat room join error: ${e.message}`);

    res.status(500).json({ error: '채팅방 입장에 실패했습니다.' });

  }

});



router.post('/rooms/:room/leave', authMiddleware, async (req, res) => {

  try {

    const { room } = req.params;

    logger.info(`User left chat room: ${req.user.username} -> room ${room}`);

    if (req.userLogger) req.userLogger('info', `채팅방 퇴장: "${room}"`);



    res.json({ message: `채팅방 "${room}"에서 퇴장했습니다.` });

  } catch (e) {

    logger.error(`Chat room leave error: ${e.message}`);

    res.status(500).json({ error: '채팅방 퇴장에 실패했습니다.' });

  }

});



router.post("/upload-image", authMiddleware, upload.single('image'), (req, res) => {

  if (!req.file) return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });



  const src = path.join(uploadDir, req.file.filename);

  const backupPath = path.join(backupDir, req.file.filename);

  try { fs.copyFileSync(src, backupPath); } catch (e) { console.warn('Chat Image Backup Failed', e.message); }



  logger.info(`Chat image uploaded: ${req.user.username} -> ${req.file.filename}`);

  if (req.userLogger) req.userLogger('info', `채팅 이미지 업로드 ${req.file.filename}`);



  res.json({ success: true, imagePath: `/uploads/chat/${req.file.filename}` });

});



router.get('/messages/:room', authMiddleware, async (req, res) => {

  try {

    const { room } = req.params;

    const chatroom = await Chatroom.findById(room);



    if (chatroom) {

      const isMember = chatroom.participants.some((participant) => participant.toString() === req.user.id);

      if (!isMember) {

        return res.status(403).json({ error: '채팅방에 참여할 권한이 없습니다.' });

      }

    }



    const blockInfo = await resolveBlockSets(req.user.id);

    const blockedIds = Array.from(new Set([

      ...blockInfo.blocked,

      ...blockInfo.blockedBy,

    ]))

      .filter((id) => mongoose.Types.ObjectId.isValid(id))

      .map((id) => new mongoose.Types.ObjectId(id));

    const query = { room };

    if (blockedIds.length) {

      query.author = { $nin: blockedIds };

    }

    const msgs = await Message.find(query).sort({ time: 1 }).limit(100).lean();

    res.json({ count: msgs.length, messages: msgs });

  } catch (e) {

    res.status(500).json({ error: e.message });

  }

});



router.get("/search", authMiddleware, async (req, res) => {

  try {

    const { q, room, page = 1, limit = 20 } = req.query;



    if (!q || q.trim().length < 2) {

      return res.status(400).json({ error: '검색어는 최소 2글자 이상 입력하세요.' });

    }



    const skip = (page - 1) * parseInt(limit);

    const blockInfo = await resolveBlockSets(req.user.id);

    const blockedIds = Array.from(new Set([

      ...blockInfo.blocked,

      ...blockInfo.blockedBy,

    ]))

      .filter((id) => mongoose.Types.ObjectId.isValid(id))

      .map((id) => new mongoose.Types.ObjectId(id));

    const query = { $text: { $search: q } };



    if (room) {

      query.room = room;

    }



    if (blockedIds.length) {

      query.author = { $nin: blockedIds };

    }



    const messages = await Message.find(

      query,

      { score: { $meta: 'textScore' } }

    )

      .sort({ score: { $meta: 'textScore' } })

      .skip(skip)

      .limit(parseInt(limit))

      .lean();



    const total = await Message.countDocuments(query);



    const searchTerms = q.split(/\s+/).filter((term) => term.length >= 2);

    const regex = new RegExp(`(${searchTerms.join('|')})`, 'gi');



    const highlightedMessages = messages.map((msg) => ({

      ...msg,

      message_highlighted: msg.message.replace(regex, '<span class="highlight">$1</span>')

    }));



    res.json({

      messages: highlightedMessages,

      total,

      pages: Math.ceil(total / limit),

      currentPage: parseInt(page)

    });

  } catch (error) {

    console.error('메시지 검색 오류:', error);

    res.status(500).json({ error: '검색 중 오류가 발생했습니다' });

  }

});



router.delete('/messages/:id', authMiddleware, async (req, res) => {

  try {

    const message = await Message.findById(req.params.id);

    if (!message) {

      return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });

    }



    const messageId = message._id.toString();

    const roomId = message.room ? message.room.toString() : null;

    const isOwner = message.author?.toString() === req.user.id;

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const adminOverrideHeader = req.get('x-admin-moderation');
    const allowAdminOverride = isAdmin && typeof adminOverrideHeader === 'string' && adminOverrideHeader.toLowerCase() === 'log';

    if (!isOwner && !allowAdminOverride) {

      return res.status(403).json({ error: '메시지를 삭제할 권한이 없습니다.' });

    }



    let chatroom = null;

    if (roomId && mongoose.Types.ObjectId.isValid(roomId)) {

      chatroom = await Chatroom.findById(roomId);

    }



    if (chatroom && !allowAdminOverride) {

      const isMember = chatroom.participants.some((participant) => participant.toString() === req.user.id);

      if (!isMember) {

        return res.status(403).json({ error: '채팅방에 참여하고 있지 않습니다.' });

      }

    }



    await message.deleteOne();



    if (chatroom) {

      const latest = await Message.findOne({ room: roomId })

        .sort({ time: -1 });

      chatroom.lastMessageAt = latest?.time || new Date();

      await chatroom.save();

    }



    const io = req.app.get('io');

    if (io && roomId) {

      io.to(roomId).emit('messageDeleted', {

        messageId,

        room: roomId,

      });

    }



    const moderationContext = allowAdminOverride ? ' (admin-log override)' : '';

    logger.info(`Chat message deleted: ${req.user.username} -> message ${messageId}${moderationContext}`);

    if (req.userLogger) req.userLogger('info', `채팅 메시지 삭제: ${messageId}`);



    res.json({ message: '메시지를 삭제했습니다.', messageId });

  } catch (error) {

    logger.error(`Delete chat message error: ${error.message}`);

    res.status(500).json({ error: '메시지를 삭제하지 못했습니다.' });

  }

});



router.post('/messages/:id/report', authMiddleware, async (req, res) => {

  try {

    const { reason } = req.body;

    if (!reason) {

      return res.status(400).json({ error: '신고 사유를 입력해야 합니다.' });

    }



    const message = await Message.findById(req.params.id);

    if (!message) {

      return res.status(404).json({ error: '신고할 메시지를 찾을 수 없습니다.' });

    }



    const existingReport = await Report.findOne({

      reporter: req.user.id,

      contentId: message._id,

      contentType: 'chat'

    });



    if (existingReport) {

      return res.status(409).json({ error: '이미 신고한 메시지입니다.' });

    }



    const report = new Report({

      contentType: 'chat',

      contentId: message._id,

      contentOwner: message.author,

      reporter: req.user.id,

      reason: reason,

    });



    await report.save();

    logger.info(`Chat Message Reported: reporter ${req.user.username}, message ${message._id}`);

    res.status(201).json({ message: '신고가 성공적으로 접수되었습니다.' });



  } catch (e) {

    logger.error(`Chat Message Report Error: ${e.message}`);

    res.status(500).json({ error: '신고 처리 중 오류가 발생했습니다.' });

  }

});



module.exports = router;







