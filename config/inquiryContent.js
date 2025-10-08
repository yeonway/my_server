const QUICK_ACTIONS = [
  {
    id: 'qa-account',
    label: '계정/보안 문의',
    type: 'account',
    icon: '🔐',
    description: '로그인, 비밀번호, 보안 문제 관련 문의를 빠르게 작성합니다.',
    template: {
      title: '[계정] 문의 제목을 입력해주세요',
      content: `아래 정보를 작성해주세요:\n- 문제가 발생한 계정 또는 이메일:\n- 발생 일시:\n- 상세 내용:\n- 이미 시도한 해결 방법:`,
    },
  },
  {
    id: 'qa-bug',
    label: '버그 신고',
    type: 'bug_report',
    icon: '🐞',
    description: '서비스 이용 중 발생한 오류나 버그를 제보합니다.',
    template: {
      title: '[버그] 어떤 문제가 발생했나요?',
      content: `다음 항목을 포함해 주세요:\n- 발생 위치 (페이지/기능):\n- 재현 절차:\n1. \n2. \n3. \n- 기대한 결과:\n- 실제 결과:\n- 추가 스크린샷 또는 파일:`,
    },
  },
  {
    id: 'qa-feedback',
    label: '서비스 피드백',
    type: 'suggestion',
    icon: '💡',
    description: '개선 아이디어나 칭찬/불편사항을 전달합니다.',
    template: {
      title: '[피드백] 개선 제안 제목을 입력해주세요',
      content: `다음 항목을 알려주세요:\n- 어떤 기능에 대한 제안인가요?\n- 문제 상황 또는 개선 포인트:\n- 기대하는 효과:\n- 추가 참고사항:`,
    },
  },
  {
    id: 'qa-report',
    label: '콘텐츠 신고',
    type: 'content_report',
    icon: '🚨',
    description: '부적절한 콘텐츠나 커뮤니티 위반 사례를 신고합니다.',
    template: {
      title: '[신고] 신고 대상 또는 게시글을 입력해주세요',
      content: `신고 시 아래 항목을 포함해주세요:\n- 신고 대상 URL 또는 ID:\n- 위반 유형:\n- 상세 설명:\n- 증빙 자료:`,
    },
  },
];

const FAQ_ITEMS = [
  {
    question: '답변까지 얼마나 걸리나요?',
    answer:
      '평균적으로 영업일 기준 24시간 이내에 1차 응답을 드립니다. 문의가 많은 경우 최대 3일이 소요될 수 있습니다.',
  },
  {
    question: '첨부 가능한 파일 형식은 무엇인가요?',
    answer:
      'PNG, JPG, PDF, ZIP 등 대부분의 문서 및 이미지 파일을 지원합니다. 최대 10MB까지 업로드할 수 있습니다.',
  },
  {
    question: '문의 후 진행 상황을 확인할 수 있나요?',
    answer:
      '문의 내역 확인 섹션에서 최근 문의의 상태와 답변 여부를 실시간으로 확인할 수 있습니다.',
  },
  {
    question: '긴급 신고는 어떻게 하나요?',
    answer:
      '즉시 조치가 필요한 경우 "콘텐츠 신고" 빠른 버튼을 사용하고, 연락 가능한 전화번호를 함께 적어주시면 우선 처리됩니다.',
  },
];

const HELP_TOPICS = [
  {
    title: '문의 처리 흐름',
    description:
      '문의가 접수되면 담당자가 분류 후 필요한 경우 추가 정보를 요청합니다. 이후 해결 담당자가 배정되고 처리 결과를 알림으로 전달합니다.',
    steps: ['문의 접수 및 분류', '담당자 배정 및 조사', '처리 결과 회신 및 종료'],
  },
  {
    title: '신고 시 유의사항',
    description:
      '허위 신고는 제재 대상이 될 수 있습니다. 사실 확인을 위해 스크린샷, 링크 등 증빙 자료를 함께 제공해주세요.',
  },
  {
    title: '버그 제보 가이드',
    description:
      '버그를 재현할 수 있도록 발생 환경(브라우저, OS), 재현 단계, 예상과 실제 결과를 상세하게 작성해주세요.',
  },
];

module.exports = {
  QUICK_ACTIONS,
  FAQ_ITEMS,
  HELP_TOPICS,
};
