// 서버 전체 코드 복구본
require("dotenv").config();
const http = require("http");
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const socketIo = require("socket.io");
const os = require('os');

const connectDB = require('./config/db');

// 라우터 및 미들웨어
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const { JWT_SECRET } = require("./config/secrets");
const Message = require("./models/message");
const Chatroom = require("./models/chatroom");
const User = require("./models/user");
const adminRouter = require("./routes/admin");
const postsRouter = require("./routes/posts");
const profileRouter = require("./routes/profile");
const usersRouter = require("./routes/users"); // 추가
const authRouter = require("./routes/auth"); // 추가
const chatRouter = require("./routes/chat"); // 추가
const inquiryRouter = require("./routes/inquiry"); // 추가
const settingRouter = require("./routes/setting"); // 설정 라우터 추가

// 미들웨어 설정
const { authSimple } = require("./middleware/auth");
const logger = require('./config/logger');
const { userLog } = require('./config/userLogger');
const { resolveBlockSets, isInteractionBlocked } = require('./utils/blocking');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.set('io', io);

// 데이터베이스 연결 실행
connectDB();

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API 라우터 (contentFilter 제거)
app.use("/api/users", usersRouter); // 추가
app.use("/api/auth", authRouter); // 추가
app.use("/api/admin", adminRouter);
app.use("/api/posts", postsRouter); // contentFilter 제거
app.use("/api/profile", profileRouter);
app.use("/api/chat", chatRouter); // 추가
app.use("/api/inquiry", inquiryRouter); // 추가
app.use("/api/settings", settingRouter); // 설정 라우터 추가

// 404 처리 미들웨어
app.use((req, res, next) => {
  res.status(404).json({ message: "찾을 수 없는 경로입니다." });
});

// Socket.IO 인증
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("토큰 없음"));
  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch (error) {
    next(new Error("유효하지 않은 토큰"));
  }
});

// Socket.IO 이벤트
io.on("connection", async (socket) => {
  const token = socket.handshake.auth.token;
  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user;
    logger.info(`Socket connected: ${user.username}`);

    socket.emit('userInfo', { id: user.id, username: user.username, role: user.role || 'user' });
  } catch (e) {
    logger.warn(`Socket connection failed: Invalid token`);
    socket.emit('connect_error', { message: '인증 실패. 다시 로그인해 주세요.' });
    socket.disconnect();
    return;
  }

  socket.on("joinRoom", async (room) => {
    if (!room) return;

    let roomId = room;
    let chatroom = null;
    try {
      chatroom = await Chatroom.findById(room);
    } catch (error) {
      chatroom = null;
    }

    const blockInfo = await resolveBlockSets(socket.user.id);

    if (chatroom) {
      const isParticipant = chatroom.participants.some((participant) => participant.toString() === socket.user.id);
      if (!isParticipant) {
        return;
      }

      const hasBlockedParticipant = chatroom.participants.some((participant) => {
        const id = participant.toString();
        if (id === socket.user.id) return false;
        return isInteractionBlocked(id, blockInfo);
      });

      if (hasBlockedParticipant) {
        return;
      }

      roomId = chatroom._id.toString();
    }

    socket.join(roomId);
    const messages = await Message.find({ room: roomId })
      .sort({ time: 1 })
      .limit(100)
      .lean();
    const filteredMessages = messages.filter((msg) => !isInteractionBlocked(msg.author, blockInfo));
    socket.emit("previousMessages", filteredMessages);
  });

  socket.on("chatMessage", async ({ room, message, messageType = 'text' }) => {
    if (!room || !message) return;

    let roomId = room;
    let chatroom = null;
    try {
      chatroom = await Chatroom.findById(room);
    } catch (error) {
      chatroom = null;
    }

    const blockInfo = await resolveBlockSets(socket.user.id);

    if (chatroom) {
      const isParticipant = chatroom.participants.some((participant) => participant.toString() === socket.user.id);
      if (!isParticipant) {
        return;
      }

      const hasBlockedParticipant = chatroom.participants.some((participant) => {
        const id = participant.toString();
        if (id === socket.user.id) return false;
        return isInteractionBlocked(id, blockInfo);
      });

      if (hasBlockedParticipant) {
        return;
      }

      roomId = chatroom._id.toString();
    }

    const doc = await Message.create({
      room: roomId,
      user: socket.user.username,
      author: socket.user.id,
      message,
      messageType
    });

    if (chatroom) {
      chatroom.lastMessageAt = new Date();
      await chatroom.save();
    }

    try {
      const loggedId = doc._id ? doc._id.toString() : '';
      userLog('admin', 'info', `[CHAT][socket] room=${roomId} messageId=${loggedId} from=${socket.user.username} type=${messageType} message=${message}`);
    } catch (err) {
      // ignore logging issues
    }

    io.to(roomId).emit("chatMessage", {
      _id: doc._id,
      room: doc.room,
      user: doc.user,
      author: doc.author,
      message: doc.message,
      messageType: doc.messageType,
      time: doc.time,
      editedAt: doc.editedAt,
      editHistory: Array.isArray(doc.editHistory) ? doc.editHistory : [],
    });
  });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // 접속 URL 출력
  const nets = os.networkInterfaces();
  const rows = [{ 타입: '로컬', 주소: `http://localhost:${PORT}` }];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        rows.push({ 타입: '네트워크', 주소: `http://${net.address}:${PORT}` });
      }
    }
  }
  console.table(rows);
});
