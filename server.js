require('dotenv').config();

const http = require('http');
const express = require('express');
const path = require('path');
const os = require('os');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const connectDB = require('./config/db');
const { JWT_SECRET } = require('./config/secrets');

const Message = require('./models/message');
const Chatroom = require('./models/chatroom');
const User = require('./models/user');

const adminRouter = require('./routes/admin');
const postsRouter = require('./routes/posts');
const profileRouter = require('./routes/profile');
const usersRouter = require('./routes/users');
const authRouter = require('./routes/auth');
const chatRouter = require('./routes/chat');
const inquiryRouter = require('./routes/inquiry');
const settingRouter = require('./routes/setting');
const moderationRouter = require('./routes/moderation');
const notificationsRouter = require('./routes/notifications');
const calendarRouter = require('./routes/calendar');
const pollsRouter = require('./routes/polls');
const accountRouter = require('./routes/account');

const logger = require('./config/logger');
const { userLog } = require('./config/userLogger');
const { resolveBlockSets, isInteractionBlocked } = require('./utils/blocking');
const NotificationService = require('./services/notificationService');
const korcenProcessManager = require('./services/korcenProcessManager');

// ---------------------------------------------------------------------------
// Express & Socket.IO bootstrap
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('io', io);
NotificationService.setSocketServer(io);
korcenProcessManager.ensureStarted();

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

connectDB();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------------------------------------------------------------------------
// REST routes
// ---------------------------------------------------------------------------

app.use('/api/users', usersRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/posts', postsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/chat', chatRouter);
app.use('/api/inquiry', inquiryRouter);
app.use('/api/settings', settingRouter);
app.use('/api/moderation', moderationRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/account', accountRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

// ---------------------------------------------------------------------------
// Socket.IO authentication
// ---------------------------------------------------------------------------

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication token missing'));

  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    next(new Error('Invalid authentication token'));
  }
});

// ---------------------------------------------------------------------------
// Socket.IO handlers
// ---------------------------------------------------------------------------

io.on('connection', async (socket) => {
  let user;

  try {
    user = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    socket.user = user;

    if (user?.id) {
      socket.join(user.id.toString());
    }

    logger.info(`Socket connected: ${user.username}`);
    socket.emit('userInfo', {
      id: user.id,
      username: user.username,
      role: user.role || 'user',
    });
  } catch (error) {
    logger.warn('Socket connection failed: invalid token');
    socket.emit('connect_error', { message: 'Authentication failed. Please log in again.' });
    socket.disconnect();
    return;
  }

  socket.on('joinRoom', async (room) => {
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
      const isParticipant = chatroom.participants.some(
        (participant) => participant.toString() === socket.user.id,
      );
      if (!isParticipant) return;

      const hasBlockedParticipant = chatroom.participants.some((participant) => {
        const id = participant.toString();
        if (id === socket.user.id) return false;
        return isInteractionBlocked(id, blockInfo);
      });
      if (hasBlockedParticipant) return;

      roomId = chatroom._id.toString();
    }

    socket.join(roomId);

    const messages = await Message.find({ room: roomId })
      .sort({ time: 1 })
      .limit(100)
      .lean();
    const filteredMessages = messages.filter(
      (msg) => !isInteractionBlocked(msg.author, blockInfo),
    );

    socket.emit('previousMessages', filteredMessages);
  });

  socket.on('chatMessage', async ({ room, message, messageType = 'text' }) => {
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
      const isParticipant = chatroom.participants.some(
        (participant) => participant.toString() === socket.user.id,
      );
      if (!isParticipant) return;

      const hasBlockedParticipant = chatroom.participants.some((participant) => {
        const id = participant.toString();
        if (id === socket.user.id) return false;
        return isInteractionBlocked(id, blockInfo);
      });
      if (hasBlockedParticipant) return;

      roomId = chatroom._id.toString();
    }

    const doc = await Message.create({
      room: roomId,
      user: socket.user.username,
      author: socket.user.id,
      message,
      messageType,
    });

    if (chatroom) {
      chatroom.lastMessageAt = new Date();
      await chatroom.save();
    }

    try {
      const loggedId = doc._id ? doc._id.toString() : '';
      userLog(
        'admin',
        'info',
        `[CHAT][socket] room=${roomId} messageId=${loggedId} from=${socket.user.username} type=${messageType} message=${message}`,
      );
    } catch (error) {
      // ignore logging failures
    }

    io.to(roomId).emit('chatMessage', {
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

    try {
      const messageId = doc._id ? doc._id.toString() : null;
      const chatroomId = chatroom?._id ? chatroom._id.toString() : roomId;

      if (chatroom && chatroom.type === 'dm' && messageType !== 'system') {
        const recipients = (chatroom.participants || [])
          .map((participant) => participant?.toString())
          .filter((participantId) => participantId && participantId !== socket.user.id);

        if (recipients.length) {
          await NotificationService.createNotifications(
            recipients.map((recipientId) => ({
              recipientId,
              actorId: socket.user.id,
              type: 'dm',
              message: `${socket.user.username} sent you a direct message.`,
              link: `/chat.html?room=${chatroomId}`,
              payload: { chatroomId, messageId, roomId },
            })),
          );
        }
      }

      if (chatroom && chatroom.type === 'group' && typeof message === 'string' && messageType !== 'system') {
        const mentionedUsers = await NotificationService.findMentionedUsers(message, {
          excludeIds: [socket.user.id],
        });

        if (mentionedUsers.length) {
          const participantSet = new Set(
            (chatroom.participants || []).map((participant) => participant.toString()),
          );
          const targets = mentionedUsers.filter((userDoc) => participantSet.has(userDoc._id.toString()));

          if (targets.length) {
            await NotificationService.createNotifications(
              targets.map((target) => ({
                recipientId: target._id,
                actorId: socket.user.id,
                type: 'mention',
                message: `${socket.user.username} mentioned you in the chat.`,
                link: `/chat.html?room=${chatroomId}`,
                payload: { chatroomId, messageId, mentioned: target.username },
              })),
            );
          }
        }
      }
    } catch (notificationError) {
      logger.error(`[notifications] chat message error: ${notificationError.message}`);
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  const nets = os.networkInterfaces();
  const rows = [{ label: 'local', url: `http://localhost:${PORT}` }];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        rows.push({ label: 'network', url: `http://${net.address}:${PORT}` });
      }
    }
  }

  console.table(rows);
});
