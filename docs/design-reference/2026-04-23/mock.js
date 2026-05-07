// mock 데이터 — OK금융그룹 기여도평가시스템
// 코드베이스의 실제 mock 데이터 기반

window.OK_MOCK = (() => {
  const employees = [
    { id: 'H0807021', name: '박준형', position: '이사', dept: '인사부', level: null, role: 'hr' },
    { id: 'H0908033', name: '박판근', position: '부장', dept: '인사기획팀', level: 4, role: 'evaluator' },
    { id: 'H1310159', name: '김남엽', position: '차장', dept: '인사팀',    level: 3, role: 'evaluator' },
    { id: 'H1310172', name: '이수한', position: '차장', dept: '인사기획팀', level: 3, role: 'evaluatee' },
    { id: 'H1411231', name: '최은송', position: '차장', dept: '인사팀',    level: 3, role: 'evaluatee' },
    { id: 'H1411166', name: '주승현', position: '차장', dept: '인사기획팀', level: 3, role: 'evaluatee' },
    { id: 'H1911042', name: '김민선', position: '대리', dept: '인사기획팀', level: 2, role: 'evaluatee' },
    { id: 'H1205006', name: '황정원', position: '대리', dept: '인사팀',    level: 2, role: 'evaluatee' },
    { id: 'H1501077', name: '조혜인', position: '대리', dept: '인사팀',    level: 2, role: 'evaluatee' },
    { id: 'H2301040', name: '김민영', position: '사원', dept: '인사팀',    level: 1, role: 'evaluatee' },
  ];

  // 평가자-피평가자 매핑
  const evaluatorMap = {
    'H0908033': ['H1310172','H1411166','H1911042'],
    'H1310159': ['H1411231','H1205006','H2301040','H1501077'],
    'H0807021': ['H0908033','H1310159'],
  };

  // 피평가자별 과업 (현재 로그인: 김민선 H1911042 가정)
  const myTasks = [
    {
      id: 'T001',
      title: '2026년 상반기 인사평가 체계 개선',
      desc: '기존 연 1회 평가를 반기 기여도 평가로 전환. 평가 매트릭스 재설계 및 HR 정책 문서화.',
      weight: 35,
      start: '2026-01-10', end: '2026-04-30',
      method: '주도', scope: '전사',
      score: 4, scoreLabel: 'S',
      feedback: '체계 전환 과제를 주도적으로 이끌었고, 현업 인터뷰 20회 이상을 진행해 실행 가능한 정책으로 만들었습니다. 특히 매트릭스의 4x4 구조는 평가자들의 수용도가 높았음.',
      feedbackDate: '2026-04-20', evaluator: '박판근',
      history: [
        { id: 'F1', evaluator: '박판근', date: '2026-04-20', content: '체계 전환 과제를 주도적으로 이끌었고, 현업 인터뷰 20회 이상을 진행해 실행 가능한 정책으로 만들었습니다.' },
        { id: 'F2', evaluator: '박판근', date: '2026-03-12', content: '중간 점검 결과 일정 대비 20% 앞서 진행 중. 타 팀 협업에서도 주도적 태도가 인상적.' },
      ],
    },
    {
      id: 'T002',
      title: '기여도 평가 시스템 사용자 온보딩',
      desc: '신규 평가 시스템 도입에 따른 전사 교육 프로그램 설계 및 실행. 총 5회 워크샵, 300명 대상.',
      weight: 25,
      start: '2026-02-01', end: '2026-03-31',
      method: '주도', scope: '본부',
      score: 3, scoreLabel: 'A',
      feedback: '교육 프로그램의 구조는 좋았으나 평가자 그룹 대상 심화 세션이 부족했던 점 아쉬움. 다음 라운드에서 보완 기대.',
      feedbackDate: '2026-04-05', evaluator: '박판근',
      history: [
        { id: 'F3', evaluator: '박판근', date: '2026-04-05', content: '교육 프로그램의 구조는 좋았으나 평가자 그룹 대상 심화 세션이 부족했던 점 아쉬움.' },
      ],
    },
    {
      id: 'T003',
      title: 'HR 데이터 대시보드 구축 지원',
      desc: 'BI 팀과 협업하여 HR 핵심 지표 대시보드 요구사항 정의 및 검증.',
      weight: 20,
      start: '2026-03-01', end: '2026-05-15',
      method: '협업', scope: '팀',
      score: 3, scoreLabel: 'A',
      feedback: '요구사항 정리가 깔끔했음. BI팀 리드의 피드백도 긍정적.',
      feedbackDate: '2026-04-18', evaluator: '박판근',
      history: [
        { id: 'F4', evaluator: '박판근', date: '2026-04-18', content: '요구사항 정리가 깔끔했음. BI팀 리드의 피드백도 긍정적.' },
      ],
    },
    {
      id: 'T004',
      title: '신입사원 멘토링 프로그램',
      desc: '2026년 상반기 신입사원 8명 대상 1:1 멘토링. 월 2회 세션.',
      weight: 20,
      start: '2026-01-15', end: '2026-06-30',
      method: '지원', scope: '팀',
      score: null, scoreLabel: '-',
      feedback: null, feedbackDate: null, evaluator: null,
      history: [],
    },
  ];

  // 평가자 시점의 팀원 목록 (박판근 H0908033 관점)
  const myTeam = [
    {
      id: 'H1310172', name: '이수한', position: '차장', dept: '인사기획팀', level: 3,
      progress: 100, completed: 4, total: 4, score: 3.4, scoreFloor: 3,
      status: 'completed', lastActivity: '4월 18일', achieved: true,
    },
    {
      id: 'H1411166', name: '주승현', position: '차장', dept: '인사기획팀', level: 3,
      progress: 75, completed: 3, total: 4, score: 2.8, scoreFloor: 2,
      status: 'in-progress', lastActivity: '4월 21일', achieved: false,
    },
    {
      id: 'H1911042', name: '김민선', position: '대리', dept: '인사기획팀', level: 2,
      progress: 75, completed: 3, total: 4, score: 3.3, scoreFloor: 3,
      status: 'in-progress', lastActivity: '4월 22일', achieved: true,
    },
  ];

  // 알림
  const notifications = [
    { id: 'N1', type: 'feedback_added', title: '새로운 피드백이 도착했습니다',
      message: '박판근 부장님이 \'기여도 평가 시스템 사용자 온보딩\' 과업에 피드백을 남겼습니다.',
      from: '박판근', time: '방금 전', read: false, priority: 'high' },
    { id: 'N2', type: 'evaluation_completed', title: '평가가 완료되었습니다',
      message: '이수한 차장의 2026년 상반기 기여도 평가가 최종 확정되었습니다. 총점 3.4점/Lv.3.',
      from: '시스템', time: '2시간 전', read: false, priority: 'medium' },
    { id: 'N3', type: 'score_changed', title: '과업 점수가 변경되었습니다',
      message: '\'HR 데이터 대시보드 구축 지원\' 과업의 점수가 A(3점)으로 조정되었습니다.',
      from: '박판근', time: '오늘 오전 10:14', read: false, priority: 'medium' },
    { id: 'N4', type: 'task_content_changed', title: '과업 내용이 수정되었습니다',
      message: '\'신입사원 멘토링 프로그램\' 과업의 가중치가 15%에서 20%로 조정되었습니다.',
      from: '박판근', time: '어제', read: true, priority: 'low' },
    { id: 'N5', type: 'evaluation_updated', title: '평가 기간 안내',
      message: '2026년 상반기 기여도 평가 마감일이 4월 30일입니다. 미완료 과업 1건이 있습니다.',
      from: 'HR팀', time: '2일 전', read: true, priority: 'high' },
    { id: 'N6', type: 'feedback_added', title: '피드백 이력 업데이트',
      message: '\'2026년 상반기 인사평가 체계 개선\' 과업에 새로운 피드백이 추가되었습니다.',
      from: '박판근', time: '3일 전', read: true, priority: 'medium' },
  ];

  // HR 통계
  const hrStats = {
    totalEmployees: 342,
    activeEvaluators: 48,
    completionRate: 72,
    achievementRate: 68,
    inProgress: 96,
    completed: 246,
    byDept: [
      { name: '인사부', total: 42, completed: 36, rate: 86 },
      { name: '재무회계본부', total: 58, completed: 41, rate: 71 },
      { name: '리스크관리본부', total: 67, completed: 48, rate: 72 },
      { name: '디지털금융본부', total: 84, completed: 55, rate: 65 },
      { name: '영업지원본부', total: 52, completed: 38, rate: 73 },
      { name: '전략기획실', total: 39, completed: 28, rate: 72 },
    ],
    trend: [58, 62, 64, 65, 68, 70, 71, 72],
  };

  // 점수 매트릭스 (4 방식 × 4 범위)
  const methods = ['총괄/주도', '리딩', '실무', '지원'];
  const scopes  = ['전사/그룹', '본부', '팀', '개인'];
  // 점수 = row 가중 * col 가중 (높은 기여 방식 + 넓은 범위 = 4점)
  const scoreMatrix = [
    [4, 4, 3, 2],
    [4, 3, 3, 2],
    [3, 3, 2, 1],
    [2, 2, 1, 1],
  ];
  const scoreLabels = { 4: 'S', 3: 'A', 2: 'B', 1: 'C' };

  return {
    employees, evaluatorMap, myTasks, myTeam,
    notifications, hrStats,
    methods, scopes, scoreMatrix, scoreLabels,
    // 편의 접근
    currentUser: { id: 'H1911042', name: '김민선', position: '대리', dept: '인사기획팀', level: 2 },
    evaluatorUser: { id: 'H0908033', name: '박판근', position: '부장', dept: '인사기획팀', level: 4 },
    hrUser: { id: 'H0807021', name: '박준형', position: '이사', dept: '인사부', level: 5 },
  };
})();
