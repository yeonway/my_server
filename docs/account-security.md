# 계정 보안 & 개인정보 관리 기능

본 문서는 계정 보안 관련 신규 기능(로그인 기록, 비정상 접근 탐지, 계정 비활성화/삭제, 데이터 다운로드)의 개요와 API 사양, 데이터 모델, UI 예시, 예외 처리 및 보안 고려 사항을 정리합니다.

## 데이터 모델

### `LoginActivity`
| 필드 | 타입 | 설명 |
|------|------|------|
| `user` | ObjectId(`User`) | 로그인 시도 사용자 참조 |
| `usernameSnapshot` | String | 시도 당시 사용자명 스냅샷 |
| `ipAddress` | String | 클라이언트 IP 주소 |
| `userAgent` | String | HTTP User-Agent 정보 |
| `location` | Mixed | IP 위치 조회 결과 (국가, 도시, 좌표 등) |
| `success` | Boolean | 로그인 성공 여부 |
| `suspicious` | Boolean | 의심 로그인으로 판정 여부 |
| `suspicionReasons` | [String] | 판정 사유(`new_ip_address`, `country_changed` 등) |
| `notifiedAt` | Date | 보안 알림 전송 시간 |
| `createdAt` | Date | 로그인 시도 시각 |

### `User`
기존 스키마에 다음 필드가 추가되었습니다.

- `accountStatus`: `active` \| `deactivated` \| `pending_deletion`
- `deactivatedAt`: 마지막 비활성화 시각
- `deletionRequestedAt`: 삭제 예약 요청 시각
- `deletionScheduledFor`: 실제 삭제 예정 시각(유예 기간 포함)
- `deletionReason`: 사용자가 남긴 메모/사유

### 알림(Notification) 타입
기존 알림 타입에 `security_alert`가 추가되어 보안 경고 전송에 사용됩니다.

## API

### 로그인 기록 & 의심 로그인 알림
- **POST** `/api/users/login`
  - 성공/실패 시 `LoginActivity` 문서가 생성됩니다.
  - 새로운 위치·IP 탐지 시 `security_alert` 알림이 발송됩니다.
- **GET** `/api/account/security/logins?limit=20`
  - 최근 로그인 기록 조회(기본 20건, 최대 200건)
  - 응답 예시:
    ```json
    {
      "items": [
        {
          "id": "...",
          "ipAddress": "203.0.113.1",
          "location": {"country": "Korea", "city": "Seoul"},
          "success": true,
          "suspicious": true,
          "suspicionReasons": ["new_ip_address"],
          "createdAt": "2025-01-01T00:00:00.000Z"
        }
      ],
      "limit": 20
    }
    ```

### 계정 상태 관리
- **POST** `/api/account/deactivate`
  - Body: `{ "password": "...", "reason": "선택" }`
  - 현재 비밀번호 검증 후 계정 상태를 `deactivated`로 설정
- **POST** `/api/account/reactivate`
  - Body: `{ "password": "..." }`
  - 비활성화된 계정을 다시 `active`로 변경 (삭제 예약 상태일 경우 거부)
- **DELETE** `/api/account`
  - Body: `{ "password": "...", "reason": "선택" }`
  - 유예 기간(`ACCOUNT_DELETION_GRACE_DAYS`, 기본 7일) 이후 삭제 예약
  - 응답: 예정 시각(`scheduledFor`)과 상태 반환

### 개인정보 다운로드
- **GET** `/api/account/export?format=json&loginLimit=50`
  - `format=csv` 지원
  - `profile`(사용자 기본 정보), `posts`(최대 200건), `loginHistory` 데이터를 포함
  - CSV 응답은 `# Profile`, `# LoginHistory`, `# Posts` 섹션으로 구성된 텍스트 파일을 첨부 다운로드 형식으로 제공

## UI 예시

- `public/account-security.html`: 보안 설정 샘플 페이지
- `public/js/account-security.js`: 로그인 기록 표시, 데이터 다운로드, 계정 비활성화/삭제 요청 처리 예시

페이지는 JWT 토큰(`localStorage.authToken`)을 사용해 API를 호출하며, 주요 버튼과 결과 영역을 제공합니다.

## 보안 & 예외 처리

- 로그인 시도 시 IP, User-Agent, 위치 정보가 기록되며 오류가 발생해도 로그인 흐름을 방해하지 않도록 예외 처리합니다.
- `lookupIpLocation`은 사설망/localhost 접근 시 위치 조회를 건너뛰고, 외부 API 실패 시 캐시된 `lookup_failed` 상태를 저장합니다.
- 의심 로그인 판정:
  - 새로운 공인 IP 또는 국가/도시/기기(User-Agent) 변경이 감지되면 경고
  - `SUSPICIOUS_IP_THRESHOLD` 환경변수로 민감도 조정 가능
- 민감 작업(비활성화/삭제/재활성화, 데이터 다운로드)은 `authMiddleware`를 사용하고 비밀번호 검증을 수행합니다.
- 계정 삭제는 즉시 제거 대신 `pending_deletion` 상태로 두어 유예 기간 동안 복구 가능하도록 했습니다.
- CSV 응답은 필드 값을 안전하게 이스케이프하여 CSV 주입을 방지합니다.
- 보안 알림은 Socket.IO를 통해 실시간으로 전달되며, 실패 시 서버 로그에만 기록됩니다.
- 예외 발생 시 4xx/5xx 상태 코드와 명확한 오류 메시지를 반환합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `IP_GEO_ENDPOINT` | `https://ipapi.co` | IP 위치 조회 API 엔드포인트 |
| `IP_GEO_TIMEOUT` | `1500` | 위치 조회 타임아웃(ms) |
| `IP_GEO_CACHE_TTL` | `3600000` | 위치 캐시 TTL(ms) |
| `IP_GEO_DISABLED` | `false` | 위치 조회 비활성화 여부 |
| `LOGIN_HISTORY_LIMIT` | `50` | 로그인 기록 API 기본 제한 |
| `SUSPICIOUS_IP_THRESHOLD` | `1` | 의심 로그인 판단 최소 사유 개수 |
| `ACCOUNT_DELETION_GRACE_DAYS` | `7` | 계정 삭제 유예 기간(일) |

## 추가 고려 사항

- 실제 삭제 작업은 별도 Cron Job에서 `pending_deletion` 상태와 예정일을 확인하여 처리하는 것을 권장합니다.
- 알 수 없는 로그인 알림 이메일/SMS 통합 시 NotificationService 확장 가능
- 감사 추적을 위해 `LoginActivity` 컬렉션에 대한 주기적 백업을 권장합니다.
