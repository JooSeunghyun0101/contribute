import type { TourDefinition } from './tourTypes';

/**
 * 역할·화면별 안내 시나리오 정의.
 * - my-tasks: 피평가자 내 과업 — 과업 추가부터 최종제출까지 입력 순서대로 안내.
 * - team-board: 평가자 평가 보드 — 기간 확인 → 검토 필요 컬럼 → 검토 시작.
 * - evaluation-review: 평가자 성과 평가 화면 — 과업 확인 → 채점 → 피드백 → 저장.
 * 앵커(data-tour)는 현재 평가 카드(isCurrent)·본인 평가 그룹(isOwnedByCurrentUser)에만
 * 붙어 있어 이전 평가/HR 열람 화면에서는 중복 매칭되지 않는다.
 * 문체는 앱 공통 보이스(합니다/하세요체)를 따른다.
 */
export type TourId = 'my-tasks' | 'team-board' | 'evaluation-review';

export const TOURS: Record<TourId, TourDefinition> = {
  'my-tasks': {
    id: 'my-tasks',
    steps: [
      {
        target: 'mytasks-card-header',
        title: '현재 평가 카드',
        body: '이번 평가기간에 배정된 평가입니다. 담당 평가자와 진행 상태(작성 중 · 제출 완료 등)를 이 헤더에서 확인할 수 있습니다.',
      },
      {
        target: 'mytasks-weight-summary',
        title: '가중치 현황',
        body: '모든 과업의 가중치 합이 정확히 100%가 되어야 최종제출할 수 있습니다. AI 과업 비중 규칙(대상자는 50% 이상)도 여기에서 함께 확인합니다.',
      },
      {
        target: 'mytasks-add-task',
        title: '과업 추가',
        body: '이 버튼을 눌러 첫 과업을 만들어 보세요. 오른쪽에 새 과업 입력 화면이 열립니다.',
        advanceOn: 'click',
      },
      {
        target: 'mytasks-title',
        title: '① 과업 제목',
        body: '어떤 일을 하는지 한눈에 알 수 있는 제목을 입력하세요. 제목이 있어야 저장할 수 있습니다.',
        interactive: true,
        waitForMs: 4000,
      },
      {
        target: 'mytasks-ai-check',
        title: '② AI 과업 표시',
        body: 'AI를 활용하는 과업이면 체크하세요. 최종제출 대상자는 AI 과업의 가중치 합이 50% 이상이어야 합니다(HR 지정 면제자는 예외).',
        interactive: true,
      },
      {
        target: 'mytasks-desc',
        title: '③ 과업 설명',
        body: '과업의 목적·범위·기대 결과를 구체적으로 입력하세요. 오른쪽 위 AI 버튼을 누르면 성과보고 초안을 받아볼 수 있습니다.',
        interactive: true,
      },
      {
        target: 'mytasks-weight',
        title: '④ 가중치 (%)',
        body: '이 과업이 전체 업무에서 차지하는 비중입니다. 모든 과업의 합이 100%가 되도록 배분하세요.',
        interactive: true,
      },
      {
        target: 'mytasks-period',
        title: '⑤ 수행 기간',
        body: '과업을 수행하는 기간을 지정하세요. 달력 아이콘을 누르거나 날짜를 직접 입력할 수 있습니다.',
        interactive: true,
      },
      {
        target: 'mytasks-save-draft',
        title: '⑥ 임시저장',
        body: '작성 중인 내용은 임시저장으로 보관하세요. 저장한 뒤에도 최종제출 전까지는 언제든 다시 수정할 수 있습니다.',
      },
      {
        target: 'mytasks-submit',
        title: '⑦ 최종제출',
        body: '과업을 모두 등록하고 가중치 합이 100%가 되면 최종제출하세요. 제출하면 평가자 검토가 시작되며, 평가자가 돌려보내기 전까지 수정할 수 없습니다.\n안내는 여기까지입니다. 이제 직접 작성해 보세요!',
      },
    ],
  },
  'team-board': {
    id: 'team-board',
    steps: [
      {
        target: 'period-selector',
        title: '평가기간 확인',
        body: '지금 보고 있는 평가기간입니다. 다른 기간을 선택하면 그 기간의 평가가 표시되고, 마감된 기간은 읽기 전용이 됩니다.',
        waitForMs: 2500,
      },
      {
        target: 'board-review-column',
        title: "'검토 필요' 컬럼",
        body: '피평가자가 성과보고를 최종제출하면 카드가 이 컬럼으로 이동합니다. 여기 있는 카드가 지금 평가해야 할 대상입니다.',
      },
      {
        target: 'board-remind',
        title: '제출 리마인드',
        body: '아직 제출하지 않은 팀원 전원에게 제출 리마인드 알림을 한 번에 보낼 수 있습니다.',
        waitForMs: 2000,
      },
      {
        target: 'board-start-review',
        title: '검토 시작',
        body: "'검토 시작'을 누르면 첫 번째 검토 대상의 평가 화면이 바로 열립니다. 보드의 카드를 직접 눌러 이동할 수도 있습니다.",
        advanceOn: 'click',
      },
    ],
  },
  'evaluation-review': {
    id: 'evaluation-review',
    steps: [
      {
        target: 'eval-task-tabs',
        title: '과업 목록 · 진행 현황',
        body: '피평가자가 제출한 과업 목록입니다. 맨 위에서 채점·피드백 진행 현황을 확인하고, 과업을 눌러 하나씩 검토하세요. 선택한 과업의 내용은 오른쪽에 표시됩니다.',
        interactive: true,
      },
      {
        target: 'eval-score-matrix',
        title: '점수 선택',
        body: '기여방식(행) × 기여범위(열) 매트릭스에서 셀을 누르면 채점됩니다. 셀에 마우스를 올리면 기준 설명이 표시되며, 기여가 미흡하면 위의 기여미흡(0점)을 선택하세요.',
        interactive: true,
      },
      {
        target: 'eval-feedback',
        title: '피드백 작성',
        body: '점수의 근거를 피드백으로 남겨주세요. 모든 과업에 피드백이 있어야 평가를 완료로 저장할 수 있습니다. AI 버튼으로 의견 초안을 받아볼 수 있습니다.',
        interactive: true,
      },
      {
        target: 'eval-weighted-score',
        title: '가중치 반영 점수',
        body: '선택한 점수에 과업 가중치를 곱한 값입니다. 셀을 누르는 즉시 여기와 카드 헤더의 반영 점수가 갱신됩니다.',
      },
      {
        target: 'eval-temp-save',
        title: '임시저장',
        body: '검토를 중간에 멈출 때는 임시저장으로 보관하세요. 점수나 피드백을 입력하면 버튼이 활성화됩니다.',
      },
      {
        target: 'eval-save',
        title: '평가 저장',
        body: "모든 과업을 채점하고 피드백까지 작성한 뒤 저장하면 평가가 완료됩니다. 일부만 채점한 상태로 저장하면 '평가 중'으로 보관됩니다.\n안내는 여기까지입니다. 이제 직접 검토해 보세요!",
      },
    ],
  },
};
