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
