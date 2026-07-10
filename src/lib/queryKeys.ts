/**
 * React Query 키 팩토리 — 모든 queryKey 를 여기 모아 캐시 무효화(invalidateQueries)가
 * 흩어지지 않도록 한다. 읽기 경로를 useQuery 로 이관할 때마다 항목을 추가한다.
 *
 * 규칙:
 * - 최상위 세그먼트는 도메인명(kebab-case).
 * - 파라미터가 있으면 함수 인자로 받아 뒤에 붙인다(예: ['evaluations', 'employee', employeeId]).
 * - 부분 키로 묶음 무효화: queryClient.invalidateQueries({ queryKey: queryKeys.evaluationPeriods() }).
 */
export const queryKeys = {
  evaluationPeriods: () => ['evaluation-periods'] as const,
  evaluationMatrix: () => ['evaluation-matrix'] as const,
  expectations: () => ['expectations'] as const,
  // 대시보드/목록 레코드 — loaderKey(team:/former-team:/company/all)·기간·로딩옵션으로 구분.
  dashboardRecords: (
    loaderKey: string,
    periodId: string | null,
    opts: { includeFeedbackHistory: boolean; recordEvaluatorId: string | null; skipTasks: boolean; bulk: boolean },
  ) =>
    [
      'dashboard-records',
      loaderKey,
      periodId,
      opts.includeFeedbackHistory,
      opts.recordEvaluatorId,
      opts.skipTasks,
      opts.bulk,
    ] as const,
  priorYearRecords: (
    employeesKey: string,
    priorPeriodId: string | null,
    evaluatorId: string | null,
    bulk: boolean,
  ) => ['prior-year-records', employeesKey, priorPeriodId, evaluatorId, bulk] as const,
  // 배정이력 벌크(S5) — 보드 현재/이전 담당 분류용. idsKey = 정렬된 사번 목록 join(',').
  assignmentHistoryBulk: (idsKey: string) => ['assignment-history-bulk', idsKey] as const,
} as const;
