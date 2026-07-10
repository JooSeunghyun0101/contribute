// 평가 '완료' 판정의 단일 출처(Single Source of Truth).
// 화면마다 완료 정의가 달라(예: submitted 포함 여부) HR 화면 간 완료율 숫자가
// 불일치하던 문제를 막는다 — 완료 판정은 반드시 이 헬퍼를 경유한다.

/**
 * 평가 상태가 '완료'인지 판정한다.
 *
 * 완료 = 평가자 저장 완료(completed/locked).
 * submitted 는 피평가자 제출 직후·평가 전 상태이므로 미완료로 본다.
 */
export const isFinalizedEvaluationStatus = (status: string | null | undefined): boolean =>
  status === 'completed' || status === 'locked';

// 평가 상태 → 화면 표시 라벨의 단일 출처. 화면마다 흩어져 있던 { submitted: '검토 대기', ... }
// 중복 정의를 수렴한다.
// ⚠ 평가 보드(team/Home)의 '검토 필요' 컬럼은 상태 라벨이 아니라 '지금 할 일' 액션 라벨이므로
//   여기서 다루지 않는다(submitted+evaluating 를 묶은 별개 개념).
const EVALUATION_STATUS_LABELS: Record<string, string> = {
  'not-started': '시작 전',
  draft: '작성 중',
  'in-progress': '작성 중',
  submitted: '검토 대기',
  evaluating: '평가 중',
  completed: '완료',
  locked: '잠금',
};

/** 평가 상태 코드를 화면 표시 라벨로. 미정의 상태는 코드 원문, null/undefined 는 빈 문자열. */
export const evaluationStatusLabel = (status: string | null | undefined): string =>
  status ? EVALUATION_STATUS_LABELS[status] ?? status : '';
