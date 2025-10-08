const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// 권한별 기능 매핑 (참고)
// 관리자 추가/삭제    superadmin       다른 관리자 관리(최고관리자만)
// 사용자 삭제/정지/메모 user_manage     일반 사용자 계정 관리
// 게시글 삭제/복구/공지 post_manage     게시글/공지사항 관리
// 금지어 추가/삭제    word_manage      금지어 관리
// 신고 처리          report_manage    신고 내역 처리
// 문의 처리/파일 다운로드 inquiry_manage 문의 내역 처리
// 로그 파일/사용자 로그 log_view        로그 조회

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true }, // 공백 제거
    password: { type: String, required: true }, // 해싱 처리됨
    role: { type: String, enum: ["user", "manager", "admin", "superadmin"], default: "user" }, // 권한

    // 기능별 관리자 권한 (관리자/매니저 등급만 사용)
    // 예시: ["user_manage", "post_manage", "report_manage", ...]
    adminPermissions: { type: [String], default: [] },

    suspended: { type: Boolean, default: false }, // 정지 여부
    suspensionReason: { type: String, default: "" }, // 정지 사유
    suspendedAt: { type: Date, default: null }, // 정지된 날짜
    suspendedBy: { type: String, default: "" }, // 정지 처리한 관리자 username

    memo: { type: String, default: "" }, // 관리자용 메모 필드

    name: { type: String, default: "" },      // 이름
    intro: { type: String, default: "" },     // 자기소개
    photo: { type: String, default: "" },      // 프로필 사진 경로 (없으면 빈 문자열)
    email: { type: String, trim: true, lowercase: true, default: "" }, // 계정 연락용 이메일

    blockedUsers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },

    signupOwner: { type: String, default: "" }, // 최초 가입 계정
    signupOrder: { type: Number, default: 1 },    // 동일 브라우저에서 몇 번째 계정인지
    signupIp: { type: String, default: "" },     // 가입 시도 IP 기록

    accountStatus: {
      type: String,
      enum: ["active", "deactivated", "pending_deletion"],
      default: "active",
    },
    deactivatedAt: { type: Date, default: null },
    deletionRequestedAt: { type: Date, default: null },
    deletionScheduledFor: { type: Date, default: null },
    deletionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

// 저장 전에 비밀번호 해싱
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 비밀번호 비교 메서드 추가
userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
