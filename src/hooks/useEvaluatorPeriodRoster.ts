import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { employeeService } from '@/lib/services';
import { queryKeys } from '@/lib/queryKeys';
import { buildEvaluatorPeriods, type EvaluatorPeriod } from '@/lib/evaluatorHistory';
import type { EvaluatorAssignmentHistory } from '@/types';
import {
  useFormerTeamDashboardRecords,
  useTeamDashboardRecords,
} from '@/hooks/useDashboardRecords';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

export interface EvaluatorPeriodRoster {
  /** 선택한 평가기간에 이 평가자가 "마지막(현재) 평가자"인 피평가자. */
  current: EmployeeEvaluationRecord[];
  /** 그 기간에 담당했으나 도중에 다른 평가자에게 넘긴 피평가자. */
  former: EmployeeEvaluationRecord[];
  isLoading: boolean;
  error: string | null;
  isFormerLoading: boolean;
  formerError: string | null;
}

/**
 * 평가자 화면의 "현재/이전 담당"을 현재 마스터 평가자가 아니라 **선택한 평가기간(period) 기준**으로 분류한다.
 * 배정 이력을 해당 평가기간(evaluation_period_id) 단위로만 계산하고:
 *   - 그 기간의 마지막 평가자(구간 end=null)  → 현재
 *   - 그 기간에 담당했으나 도중에 넘긴 평가자(end≠null) → 이전
 *   - 그 기간에 담당한 적 없음               → 미표시
 *   예) 평가자X·2025 → 피평가자A 현재(2025 내내 담당), 피평가자B 미표시(2025엔 타 평가자).
 *       평가자X·2026 → 피평가자A·피평가자C 이전(연중 타 평가자에게 이동), 피평가자B 현재.
 */
export const useEvaluatorPeriodRoster = (
  evaluatorId: string,
  periodId: string | null | undefined,
  includeFeedbackHistory = false,
): EvaluatorPeriodRoster => {
  const cur = useTeamDashboardRecords(evaluatorId, includeFeedbackHistory);
  const former = useFormerTeamDashboardRecords(evaluatorId, includeFeedbackHistory);

  const combined = useMemo(() => {
    const map = new Map<string, EmployeeEvaluationRecord>();
    for (const r of cur.records) map.set(r.employee.employee_id, r);
    for (const r of former.records) {
      if (!map.has(r.employee.employee_id)) map.set(r.employee.employee_id, r);
    }
    return [...map.values()];
  }, [cur.records, former.records]);

  const idsKey = useMemo(
    () => combined.map((r) => r.employee.employee_id).sort().join(','),
    [combined],
  );

  // S5: 배정이력을 벌크 1회로 조회(기존: 피평가자당 개별 요청 N+1). React Query 캐시라
  // 보드 복귀 시 이전 분류를 먼저 그리고 백그라운드로 재조회한다(복귀 시 전체 스피너 제거).
  // 벌크 엔드포인트 실패 시 기존 개별 조회 경로로 폴백해 구서버에서도 동작한다.
  const historyQuery = useQuery({
    queryKey: queryKeys.assignmentHistoryBulk(idsKey),
    enabled: Boolean(evaluatorId) && idsKey.length > 0,
    queryFn: async (): Promise<Record<string, EvaluatorAssignmentHistory[]>> => {
      const ids = idsKey.split(',');
      try {
        return await employeeService.getEvaluatorAssignmentHistoryBulk(ids);
      } catch {
        const entries = await Promise.all(
          ids.map(async (id) => {
            try {
              return [id, await employeeService.getEvaluatorAssignmentHistory(id)] as const;
            } catch {
              return [id, [] as EvaluatorAssignmentHistory[]] as const;
            }
          }),
        );
        return Object.fromEntries(entries);
      }
    },
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const historyById = historyQuery.data ?? null;

  return useMemo(() => {
    const current: EmployeeEvaluationRecord[] = [];
    const formerList: EmployeeEvaluationRecord[] = [];
    for (const r of combined) {
      const history = historyById?.[r.employee.employee_id] ?? [];
      // 이력이 없으면(배정 변경 없음) 현재 마스터 평가자가 줄곧 담당 → 현재로 본다.
      const period: EvaluatorPeriod | null | undefined = history.length
        ? buildEvaluatorPeriods(history, { periodId: periodId ?? null }).get(evaluatorId)
        : { start: null, end: null };
      if (!period) continue; // 그 기간에 이 평가자 담당분 없음 → 미표시
      if (period.end === null) current.push(r);
      else formerList.push(r);
    }
    // 분류 대기 = 이력 데이터가 아직 한 번도 없을 때만(캐시가 있으면 즉시 분류 → 스피너 없음).
    const classifying = Boolean(evaluatorId) && idsKey.length > 0 && historyById === null;
    return {
      current,
      former: formerList,
      isLoading: cur.isLoading || classifying,
      error: cur.error,
      isFormerLoading: former.isLoading || classifying,
      formerError: former.error,
    };
  }, [combined, historyById, idsKey, periodId, evaluatorId, cur.isLoading, cur.error, former.isLoading, former.error]);
};
