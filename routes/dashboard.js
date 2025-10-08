const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { JWT_SECRET } = require('../config/secrets');
const User = require('../models/user');
const Post = require('../models/post');
const Message = require('../models/message');
const Notification = require('../models/notification');
const UserActivitySnapshot = require('../models/userActivitySnapshot');

const router = express.Router();

function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

function normalizeDateToStart(date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function normalizeDateToEnd(date) {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

router.get('/me', authRequired, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: '유효한 날짜 형식이 아닙니다.' });
    }

    const rangeStart = normalizeDateToStart(start);
    const rangeEnd = normalizeDateToEnd(end);
    if (rangeStart > rangeEnd) {
      return res.status(400).json({ error: '시작 날짜가 종료 날짜보다 늦을 수 없습니다.' });
    }

    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [user, posts, commentAgg, messages, notifications, unreadNotifications, unreadDmNotifications, snapshots] =
      await Promise.all([
        User.findById(userId).select('username name').lean(),
        Post.find({
          author: userId,
          time: { $gte: rangeStart, $lte: rangeEnd },
          deleted: { $ne: true },
        })
          .sort({ time: -1 })
          .lean(),
        Post.aggregate([
          { $unwind: '$comments' },
          {
            $match: {
              'comments.author': userObjectId,
              'comments.time': { $gte: rangeStart, $lte: rangeEnd },
              deleted: { $ne: true },
            },
          },
          {
            $group: {
              _id: null,
              comments: { $push: '$comments' },
              count: { $sum: 1 },
            },
          },
        ]),
        Message.find({
          author: userId,
          time: { $gte: rangeStart, $lte: rangeEnd },
        })
          .sort({ time: -1 })
          .lean(),
        Notification.find({
          recipient: userId,
          createdAt: { $gte: rangeStart, $lte: rangeEnd },
        })
          .sort({ createdAt: -1 })
          .lean(),
        Notification.find({ recipient: userId, read: false })
          .sort({ createdAt: -1 })
          .lean(),
        Notification.find({ recipient: userId, read: false, type: 'dm' })
          .sort({ createdAt: -1 })
          .lean(),
        UserActivitySnapshot.find({
          user: userId,
          date: { $gte: rangeStart, $lte: rangeEnd },
        })
          .sort({ date: 1 })
          .lean(),
      ]);

    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const comments = commentAgg.length > 0 ? commentAgg[0].comments : [];
    const commentCount = commentAgg.length > 0 ? commentAgg[0].count : 0;

    const totalNotifications = notifications.length;
    const mentionCount = notifications.filter((notification) => notification.type === 'mention').length;
    const recommendationCount = notifications.filter((notification) => notification.type === 'comment').length;

    const dailyBreakdownMap = new Map();
    snapshots.forEach((snapshot) => {
      const key = new Date(snapshot.date).toISOString().slice(0, 10);
      dailyBreakdownMap.set(key, {
        date: key,
        posts: snapshot.posts,
        comments: snapshot.comments,
        chats: snapshot.chats,
        recommendations: snapshot.recommendationsReceived,
        mentions: snapshot.mentionsReceived,
        notifications: snapshot.notificationsReceived,
      });
    });

    const aggregateIntoMap = (items, accessor) => {
      items.forEach((item) => {
        const dateValue = accessor(item);
        if (!dateValue) return;
        const dateKey = new Date(dateValue).toISOString().slice(0, 10);
        if (!dailyBreakdownMap.has(dateKey)) {
          dailyBreakdownMap.set(dateKey, {
            date: dateKey,
            posts: 0,
            comments: 0,
            chats: 0,
            recommendations: 0,
            mentions: 0,
            notifications: 0,
          });
        }
      });
    };

    aggregateIntoMap(posts, (post) => post.time);
    aggregateIntoMap(comments, (comment) => comment.time);
    aggregateIntoMap(messages, (message) => message.time);
    aggregateIntoMap(notifications, (notification) => notification.createdAt);

    posts.forEach((post) => {
      const key = new Date(post.time).toISOString().slice(0, 10);
      const record = dailyBreakdownMap.get(key);
      record.posts += 1;
    });

    comments.forEach((comment) => {
      const key = new Date(comment.time).toISOString().slice(0, 10);
      const record = dailyBreakdownMap.get(key);
      record.comments += 1;
    });

    messages.forEach((message) => {
      const key = new Date(message.time).toISOString().slice(0, 10);
      const record = dailyBreakdownMap.get(key);
      record.chats += 1;
    });

    notifications.forEach((notification) => {
      const key = new Date(notification.createdAt).toISOString().slice(0, 10);
      const record = dailyBreakdownMap.get(key);
      record.notifications += 1;
      if (notification.type === 'mention') {
        record.mentions += 1;
      }
      if (notification.type === 'comment') {
        record.recommendations += 1;
      }
    });

    const dailyBreakdown = Array.from(dailyBreakdownMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const recentActivities = [
      ...posts.map((post) => ({
        type: 'post',
        title: post.title,
        time: post.time,
        meta: { postId: post._id },
      })),
      ...comments.map((comment) => ({
        type: 'comment',
        content: comment.content,
        time: comment.time,
        meta: { commentId: comment._id },
      })),
      ...messages.map((message) => ({
        type: 'chat',
        content: message.message,
        time: message.time,
        meta: { room: message.room },
      })),
      ...notifications.map((notification) => ({
        type: `notification:${notification.type}`,
        content: notification.message,
        time: notification.createdAt,
        meta: { id: notification._id, link: notification.link },
      })),
    ]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 20);

    return res.json({
      range: {
        start: rangeStart,
        end: rangeEnd,
      },
      metrics: {
        posts: posts.length,
        comments: commentCount,
        chats: messages.length,
        recommendationsReceived: recommendationCount,
        mentionsReceived: mentionCount,
        notificationsReceived: totalNotifications,
      },
      pending: {
        unreadNotifications: unreadNotifications.length,
        unreadMessages: unreadDmNotifications.length,
        unreadNotificationItems: unreadNotifications.slice(0, 10),
        unreadMessageItems: unreadDmNotifications.slice(0, 10),
      },
      recentActivities,
      dailyBreakdown,
    });
  } catch (error) {
    console.error('Failed to build dashboard summary', error);
    return res.status(500).json({ error: '대시보드 데이터를 불러오는데 실패했습니다.' });
  }
});

module.exports = router;
