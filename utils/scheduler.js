const cron = require('node-cron');
const Statistic = require('../models/statistic');
const User = require('../models/user');
const Post = require('../models/post');
const Calendar = require('../models/Calendar');
const { sendPreReminder } = require('../services/calendarNotifyService');
const logger = require('../config/logger');

// Daily statistics aggregation (midnight)
const dailyStatsJob = cron.schedule(
  '0 0 * * *',
  async () => {
    logger.info('[scheduler] Daily statistics job started');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const commentsAggregation = await Post.aggregate([
        { $match: { 'comments.time': { $gte: today, $lt: tomorrow } } },
        { $unwind: '$comments' },
        { $match: { 'comments.time': { $gte: today, $lt: tomorrow } } },
        { $count: 'total' },
      ]);
      const commentsToday = commentsAggregation.length > 0 ? commentsAggregation[0].total : 0;

      const [usersToday, postsToday] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } }),
        Post.countDocuments({ time: { $gte: today, $lt: tomorrow } }),
      ]);

      await Statistic.findOneAndUpdate(
        { date: today },
        {
          newUsers: usersToday,
          posts: postsToday,
          comments: commentsToday,
        },
        { upsert: true, new: true }
      );

      logger.info('[scheduler] Daily statistics job finished successfully');
    } catch (error) {
      logger.error(`[scheduler] Daily statistics job failed: ${error.message}`);
    }
  },
  {
    scheduled: false,
    timezone: 'Asia/Seoul',
  }
);

const CALENDAR_NOTIFY_MAP = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
};

function hasReminderBeenSent(eventDoc, key) {
  if (!eventDoc) return false;
  const status = eventDoc.reminderStatus;
  if (!status) return false;
  if (typeof status.get === 'function') {
    return Boolean(status.get(key));
  }
  return Boolean(status[key]);
}

function markReminderSent(eventDoc, key) {
  const now = new Date();
  if (!eventDoc.reminderStatus || typeof eventDoc.reminderStatus.set !== 'function') {
    const map = new Map();
    map.set(key, now);
    eventDoc.reminderStatus = map;
  } else {
    eventDoc.reminderStatus.set(key, now);
  }
}

// Calendar reminder scheduler (every 15 minutes)
const calendarReminderJob = cron.schedule(
  '*/15 * * * *',
  async () => {
    logger.info('[scheduler] Calendar reminder job started');
    try {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + 7);

      const events = await Calendar.find({
        isDeleted: false,
        notifyBefore: { $in: Object.keys(CALENDAR_NOTIFY_MAP) },
        date: { $gte: today, $lte: horizon },
      }).populate('createdBy', 'username');

      if (!events.length) {
        logger.info('[scheduler] No calendar reminders to send');
        return;
      }

      const MS_PER_DAY = 1000 * 60 * 60 * 24;
      for (const event of events) {
        const eventDate = new Date(event.date);
        eventDate.setHours(0, 0, 0, 0);
        const diffDays = Math.round((eventDate - today) / MS_PER_DAY);
        const targetDays = CALENDAR_NOTIFY_MAP[event.notifyBefore];

        if (diffDays !== targetDays) continue;
        if (hasReminderBeenSent(event, event.notifyBefore)) continue;

        try {
          await sendPreReminder(event);
          markReminderSent(event, event.notifyBefore);
          event.markModified?.('reminderStatus');
          await event.save();
        } catch (error) {
          logger.error(`[calendar][scheduler] reminder send failed event=${event._id || event.id}: ${error.message}`);
        }
      }

      logger.info('[scheduler] Calendar reminder job finished successfully');
    } catch (error) {
      logger.error(`[scheduler] Calendar reminder job failed: ${error.message}`);
    }
  },
  {
    scheduled: false,
    timezone: 'Asia/Seoul',
  }
);

function startScheduler() {
  dailyStatsJob.start();
  calendarReminderJob.start();
  logger.info('[scheduler] Scheduler started (daily stats + calendar reminders)');
}

module.exports = { startScheduler };
