# Korcen-kogpt2 연동 가이드

이 프로젝트는 기본 금칙어 필터에 더해, `korcen-kogpt2` 모델을 이용한 머신러닝 기반 욕설 감지를 선택적으로 사용합니다. 아래 절차대로 설정하면 HTTP 요청 본문의 `title`, `content`, `message` 필드에 대해 AI 필터가 함께 동작합니다.

## 1. Python 서비스 준비

1. (선택) 가상환경 생성  
   `python -m venv .venv && .\.venv\Scripts\activate`
2. 의존성 설치  
   `pip install -r ml/requirements.txt`
3. 모델 파일 배치  
   `vdcnn_model.h5`, `tokenizer.pickle`을 `ml/models/` 폴더에 저장합니다.
4. AI 서비스 실행  
   `python ml/korcen_service.py`
   - 기본 포트: `5001`
   - 헬스체크: `GET /health`
   - 분류 엔드포인트: `POST /classify`

## 2. Node.js 서버 설정

`.env` 또는 실행 환경에 아래 값을 추가합니다.

```
KORCEN_SERVICE_URL=http://127.0.0.1:5001
KORCEN_ENABLED=true          # 생략 시 기본값 true
KORCEN_THRESHOLD=0.5         # 선택: 분류 임계값
KORCEN_TIMEOUT_MS=1500       # 선택: HTTP 요청 타임아웃(ms)
KORCEN_AUTOSTART=true        # 선택: 서버 시작 시 Python 서비스 자동 실행
KORCEN_PYTHON=python         # 선택: 다른 파이썬 바이너리 사용시 지정
```

서버를 재시작하면 `middleware/contentFilter.js`가 AI 서비스와 연동되어, 금칙어 캐시 필터 후에도 욕설 여부를 한 번 더 검사합니다.

## 3. 동작 방식

- 금칙어 목록에 하이픈(`-`)이 포함된 항목은 사이에 다른 문자가 들어가도 정규식으로 차단됩니다.  
  예: `병-신` → `병신`, `병__신`, `병...신`
- AI 필터가 활성화되어 있고 모델이 욕설로 판단하면, 요청은 400 응답과 함께 차단됩니다.
- AI 서비스가 중단되었거나 오류가 발생하면, 로그 경고만 남기고 기존 금칙어 필터만 적용됩니다.

## 4. 트러블슈팅

- **모델 파일 누락**: `ml/korcen_service.py`가 시작되기 전에 `ml/models/` 아래에 파일이 있는지 확인합니다.
- **ImportError**: `pip install -r ml/requirements.txt`를 다시 실행해 TensorFlow/Flask/transformers를 설치합니다.
- **타임아웃**: `KORCEN_TIMEOUT_MS` 값을 늘리거나, Python 서비스 로그로 응답 시간을 확인합니다.
- **임계값 조정**: 욕설이 지나치게 차단되거나 누락되는 경우 `KORCEN_THRESHOLD`를 조절합니다.
- **자동 실행 실패**: `KORCEN_AUTOSTART=true` 상태에서도 실행되지 않으면 콘솔 로그의 `[korcen]` 메시지로 경로/파이썬 바이너리 문제를 확인하세요.
