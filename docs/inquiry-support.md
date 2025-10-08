# 고객 지원 센터(문의/신고) 구성 안내

## 개요
- **목표**: FAQ·도움말·빠른 신고/문의 버튼·문의 내역 확인 기능을 갖춘 통합 고객 지원 경험 제공
- **범위**: `/public/inquiry.html` UI, `/public/js/inquiry.js` UX 로직, `/routes/inquiry.js` REST API, `/config/inquiryContent.js` 정적 지원 데이터, `Inquiry` 모델 활용

## 프론트엔드 구조
| 영역 | 설명 |
| --- | --- |
| `public/inquiry.html` | 1:1 문의/신고 페이지의 레이아웃. 빠른 액션, FAQ, 도움말, 문의 폼과 최근 문의 내역으로 구성 |
| `public/css/inquiry.css` | 반응형 2단 레이아웃, 카드형 섹션, 뱃지 및 비어있음 상태 스타일 정의 |
| `public/js/inquiry.js` | 메타 정보(`quickActions`, `faqs`, `helpTopics`)와 문의 내역 API 호출, 빠른 액션 템플릿 적용, 폼 유효성 검사 및 제출 처리 |

### UX 흐름
1. 토큰 확인 → 미로그인 사용자는 `/login.html`로 리다이렉션
2. `/api/inquiry/meta` 호출 → SLA, 빠른 액션, FAQ, 도움말 렌더링
3. `/api/inquiry/history` 호출 → 최근 20건 문의 상태 및 첨부 링크 표시
4. 빠른 액션 버튼 → 문의 유형/템플릿 자동 채움, 상태 메시지 안내
5. 폼 제출 → 필드 검증 → `FormData`로 `/api/inquiry` POST → 성공 후 폼 리셋 & 내역 재조회

## 백엔드 구조
| 모듈 | 설명 |
| --- | --- |
| `routes/inquiry.js` | `/api/inquiry/meta`, `/api/inquiry/history`, `/api/inquiry`(POST) 라우트. 첨부 파일 업로드 및 경로 정규화, 로깅 포함 |
| `config/inquiryContent.js` | 빠른 액션, FAQ, 도움말을 정적 배열로 관리하여 라우트와 프론트가 공유 |
| `models/inquiry.js` | 문의 스키마 정의 (유형, 제목, 내용, 첨부, 상태 등) |

### 예외 처리 & 검증
- **입력 검증**: 유형/제목/내용 필수, 제목 길이 제한, 폼 제출 전 클라이언트 검증 및 서버 측 400 응답 처리
- **인증**: `authMiddleware`를 통해 문의 제출과 내역 조회 시 JWT 검증
- **파일 업로드**: `multer` 사용, 업로드 실패/DB 오류 시 `fs.unlinkSync`로 첨부 정리, 경로를 정규화하여 `/uploads/...`로 접근 가능
- **에러 로깅**: 문의 조회/제출 실패 시 `logger`로 상세 로그 남기고 500 응답 메시지 제공
- **빈 상태 처리**: FAQ/도움말/내역이 비어있을 때 사용자에게 안내 문구 표시

## API 명세 요약
| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/api/inquiry/meta` | FAQ/도움말/빠른 액션, SLA 정보 제공 |
| `GET` | `/api/inquiry/history` | 인증된 사용자의 최근 문의 20건 반환 (상태, 첨부 경로 포함) |
| `POST` | `/api/inquiry` | 인증된 사용자가 신규 문의 작성, 파일 첨부 지원 |

## 확장 포인트
- FAQ/도움말을 CMS 또는 DB로 이동하여 운영자가 실시간 수정 가능하도록 확장
- `history.summary` 값 활용해 대시보드형 통계 구성
- `status` 필드 기반으로 실시간 알림(SSE/Socket.IO) 연동 가능
