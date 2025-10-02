/**
 * MongoDB 인덱스 생성 스크립트
 * - 검색 성능 향상을 위한 인덱스 생성
 * - 실행: node scripts/create_indexes.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Message = require('../models/message');
const Post = require('../models/post');
const User = require('../models/user');
const Comment = require('../models/comment');

// 로그 함수
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARNING] ${msg}`)
};

// MongoDB 연결
async function connectDB() {
  try {
    log.info('MongoDB 연결 중...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/my_server');
    log.success('MongoDB 연결 성공');
  } catch (error) {
    log.error(`MongoDB 연결 실패: ${error.message}`);
    process.exit(1);
  }
}

// 메시지 컬렉션 인덱스 생성
async function createMessageIndexes() {
  try {
    log.info('메시지 컬렉션 인덱스 생성 중...');
    
    // 1. 채팅방별 빠른 메시지 조회를 위한 복합 인덱스 (방 + 시간)
    await Message.collection.createIndex(
      { room: 1, time: 1 },
      { background: true, name: 'room_time_idx' }
    );
    
    // 2. 사용자별 메시지 조회를 위한 인덱스
    await Message.collection.createIndex(
      { user: 1, time: -1 },
      { background: true, name: 'user_time_idx' }
    );
    
    // 3. 전체 시간순 정렬을 위한 인덱스
    await Message.collection.createIndex(
      { time: -1 },
      { background: true, name: 'time_idx' }
    );

    // 4. 채팅 메시지 내용 텍스트 검색 인덱스
    await Message.collection.createIndex(
      { message: 'text' },
      { 
        background: true, 
        name: 'message_text_idx',
        weights: { message: 10 },
        default_language: 'none'  // 다국어 지원
      }
    );

    log.success('메시지 인덱스 생성 완료');
  } catch (error) {
    log.error(`메시지 인덱스 생성 실패: ${error.message}`);
  }
}

// 게시글 컬렉션 인덱스 생성
async function createPostIndexes() {
  try {
    log.info('게시글 컬렉션 인덱스 생성 중...');
    
    // 1. 작성자별 게시글 조회를 위한 인덱스
    await Post.collection.createIndex(
      { user: 1, time: -1 },
      { background: true, name: 'user_time_idx' }
    );
    
    // 2. 생성일자 기준 정렬 인덱스
    await Post.collection.createIndex(
      { time: -1 },
      { background: true, name: 'time_idx' }
    );
    
    // 3. 삭제 필터링 + 시간 정렬 복합 인덱스
    await Post.collection.createIndex(
      { deleted: 1, time: -1 },
      { background: true, name: 'deleted_time_idx' }
    );

    // 4. 제목 + 내용 텍스트 검색 인덱스
    await Post.collection.createIndex(
      { title: 'text', content: 'text' },
      { 
        background: true, 
        name: 'title_content_text_idx',
        weights: { title: 10, content: 5 },
        default_language: 'none'  // 다국어 지원
      }
    );

    log.success('게시글 인덱스 생성 완료');
  } catch (error) {
    log.error(`게시글 인덱스 생성 실패: ${error.message}`);
  }
}

// 댓글 컬렉션 인덱스 생성
async function createCommentIndexes() {
  try {
    log.info('댓글 컬렉션 인덱스 생성 중...');
    
    // 1. 게시글별 댓글 조회를 위한 인덱스
    await Comment.collection.createIndex(
      { postId: 1, time: 1 },
      { background: true, name: 'postId_time_idx' }
    );
    
    // 2. 사용자별 댓글 조회를 위한 인덱스
    await Comment.collection.createIndex(
      { user: 1, time: -1 },
      { background: true, name: 'user_time_idx' }
    );

    log.success('댓글 인덱스 생성 완료');
  } catch (error) {
    log.error(`댓글 인덱스 생성 실패: ${error.message}`);
  }
}

// 사용자 컬렉션 인덱스 생성
async function createUserIndexes() {
  try {
    log.info('사용자 컬렉션 인덱스 생성 중...');
    
    // 1. 사용자명 유니크 인덱스 (이미 있을 수 있음)
    await User.collection.createIndex(
      { username: 1 },
      { unique: true, background: true, name: 'username_unique_idx' }
    );
    
    // 2. 차단 여부 필터링 인덱스
    await User.collection.createIndex(
      { banned: 1 },
      { background: true, name: 'banned_idx' }
    );

    log.success('사용자 인덱스 생성 완료');
  } catch (error) {
    // 이미 존재하는 인덱스인 경우 무시
    if (error.code === 11000) {
      log.warn('일부 사용자 인덱스가 이미 존재합니다');
    } else {
      log.error(`사용자 인덱스 생성 실패: ${error.message}`);
    }
  }
}

// 인덱스 통계 출력
async function showIndexStats() {
  try {
    log.info('\n인덱스 통계:');
    
    const collections = [
      { name: 'messages', model: Message },
      { name: 'posts', model: Post },
      { name: 'comments', model: Comment },
      { name: 'users', model: User }
    ];
    
    for (const coll of collections) {
      const indexes = await coll.model.collection.indexes();
      console.log(`\n[${coll.name}] 총 ${indexes.length}개 인덱스:`);
      
      indexes.forEach((idx, i) => {
        const keys = Object.keys(idx.key).map(k => `${k}:${idx.key[k]}`).join(', ');
        console.log(`  ${i+1}. ${idx.name} (${keys})`);
      });
    }
  } catch (error) {
    log.error(`인덱스 통계 조회 실패: ${error.message}`);
  }
}

// 메인 함수
async function main() {
  try {
    await connectDB();
    
    // 각 컬렉션별 인덱스 생성
    await createMessageIndexes();
    await createPostIndexes();
    await createCommentIndexes();
    await createUserIndexes();
    
    // 인덱스 통계 출력
    await showIndexStats();
    
    log.success('\n모든 인덱스 생성 완료!');
    process.exit(0);
  } catch (error) {
    log.error(`오류 발생: ${error.message}`);
    process.exit(1);
  }
}

// 스크립트 실행
main();