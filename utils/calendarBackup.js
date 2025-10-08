const Calendar = require('../models/Calendar');
const CalendarBackup = require('../models/CalendarBackup');
const logger = require('../config/logger');

/**
 * 일정 변경 전 상태를 백업 테이블에 저장합니다.
 * @param {string|import('mongoose').Document} calendarDocOrId 백업할 일정 문서 또는 ID
 * @param {{ reason: '수정'|'삭제'|'관리자 조치', actorId?: string }} options 백업 사유 및 실행자
 */
async function createCalendarBackup(calendarDocOrId, { reason, actorId } = {}) {
  const ALLOWED_REASONS = CalendarBackup.BACKUP_REASONS || ['수정', '삭제', '관리자 조치'];
  try {
    if (!reason || !ALLOWED_REASONS.includes(reason)) {
      throw new Error('유효한 백업 사유가 필요합니다.');
    }

    let calendarDoc = calendarDocOrId;
    if (!calendarDoc) {
      throw new Error('백업 대상 일정이 없습니다.');
    }

    if (typeof calendarDoc === 'string') {
      calendarDoc = await Calendar.findById(calendarDoc).lean();
    } else if (typeof calendarDoc.toObject === 'function') {
      calendarDoc = calendarDoc.toObject();
    }

    if (!calendarDoc) {
      throw new Error('일정을 찾을 수 없습니다.');
    }

    const snapshot = { ...calendarDoc };
    const originalId = snapshot._id || snapshot.id;
    if (!originalId) {
      throw new Error('원본 일정 ID가 존재하지 않습니다.');
    }

    return await CalendarBackup.create({
      originalId,
      snapshot,
      reason,
      backedUpBy: actorId || null,
    });
  } catch (error) {
    logger.error(`[calendar][backup] 백업 실패: ${error.message}`);
    throw error;
  }
}

module.exports = { createCalendarBackup };
