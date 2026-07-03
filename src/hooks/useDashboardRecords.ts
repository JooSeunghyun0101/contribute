import { useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { employeeService } from '@/lib/services';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { queryKeys } from '@/lib/queryKeys';
import {
  getActiveEvaluatees,
  loadEmployeeEvaluationRecords,
  type EmployeeEvaluationRecord,
} from '@/lib/dashboardData';
import type { Employee } from '@/types';

type DashboardState = {
  employees: Employee[];
  records: EmployeeEvaluationRecord[];
  isLoading: boolean;
  // 캐시/placeholder 데이터가 아직 없는 최초 로드에서만 true(재조회 땐 false). 스켈레톤/전체 교체용.
  isInitialLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

// `loaderKey` is a stable string that identifies the current loader's inputs
// (e.g. `team:${evaluatorId}`). React Query 가 이 키로 캐시·중복제거·요청취소를 담당하므로
// 기존 loaderRef/취소플래그/수동 useEffect 가 모두 불필요해진다.
const useRecordsLoader = (
  loaderFn: () => Promise<Employee[]>,
  loaderKey: string,
  includeFeedbackHistory = false,
  recordEvaluatorId: string | null = null,
  skipTasks = false,
  bulk = false,
): DashboardState => {
  const { selectedPeriodId } = useEvaluationPeriod();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.dashboardRecords(loaderKey, selectedPeriodId, {
      includeFeedbackHistory,
      recordEvaluatorId,
      skipTasks,
      bulk,
    }),
    // loaderFn 클로저는 렌더마다 새로 생기지만 queryKey 가 안정적이라 재조회를 유발하지 않고,
    // 실제 조회 시점엔 최신 loaderFn(최신 evaluatorId 등)을 사용한다.
    queryFn: async () => {
      const employees = await loaderFn();
      const records = await loadEmployeeEvaluationRecords(employees, {
        includeFeedbackHistory,
        periodId: selectedPeriodId,
        evaluatorId: recordEvaluatorId,
        skipTasks,
        bulk,
      });
      return { employees, records };
    },
    // 기간 전환 등 키 변경 시 이전 데이터를 유지해 빈 화면 깜빡임을 막는다(기존 "재조회 중 기존 목록 유지" 동작과 일치).
    placeholderData: keepPreviousData,
    // 화면 복귀 시 항상 백그라운드 재조회 — 평가 저장·되돌리기 후 보드/목록으로 돌아오면
    // 캐시(이전 상태)가 그대로 보여 F5를 눌러야 반영되던 문제. 캐시를 먼저 그리고 뒤에서
    // 갱신하므로 스피너 없이 최신화된다(staleTime 30s 안에 돌아온 경우 포함). 창 포커스
    // 복귀 시에도 동일하게 갱신한다.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.dashboardRecords(loaderKey, selectedPeriodId, {
        includeFeedbackHistory,
        recordEvaluatorId,
        skipTasks,
        bulk,
      }),
    });
  }, [queryClient, loaderKey, selectedPeriodId, includeFeedbackHistory, recordEvaluatorId, skipTasks, bulk]);

  return {
    employees: query.data?.employees ?? [],
    records: query.data?.records ?? [],
    // 초기 로딩·재조회(기간 전환·reload) 동안 true — 기존 동작 유지(소비처 호환).
    isLoading: query.isFetching,
    // 데이터가 아직 없을 때만 true. 기간 전환 등 재조회 땐 keepPreviousData 로 이전 목록을 유지하므로 false.
    isInitialLoading: query.isLoading,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : '데이터를 불러오지 못했습니다.'
      : null,
    reload,
  };
};

export const useTeamDashboardRecords = (
  evaluatorId: string,
  includeFeedbackHistory = false,
): DashboardState =>
  useRecordsLoader(
    () => (evaluatorId ? employeeService.getEvaluateesByEvaluator(evaluatorId) : Promise.resolve([])),
    `team:${evaluatorId}`,
    includeFeedbackHistory,
  );

// 평가 라인 하위 열람(#1): 본인의 '선택 평가기간' 평가 라인 재귀 하위(직접 담당 제외) 레코드를 읽기 전용 로드.
// 그 기간 체인 기준이라, 다른 기간에만 배정된 사람은 섞이지 않는다.
export const useEvaluationLineRecords = (evaluatorId: string): DashboardState => {
  const { selectedPeriodId } = useEvaluationPeriod();
  return useRecordsLoader(
    () =>
      evaluatorId
        ? employeeService.getEvaluationLineDescendants(evaluatorId, selectedPeriodId)
        : Promise.resolve([]),
    `eval-line:${evaluatorId}:${selectedPeriodId ?? ''}`,
    false,
  );
};

export const useFormerTeamDashboardRecords = (
  evaluatorId: string,
  includeFeedbackHistory = false,
): DashboardState => {
  // '이전 담당 피평가자'는 선택한 평가기간 내 이동만 — 직전연도(타 기간) 이력이 섞이지 않게.
  const { selectedPeriodId } = useEvaluationPeriod();
  // 과거 평가자 화면에서는 evaluation 을 evaluator 필터 없이 조회한다.
  // (본인이 직접 매긴 entry 가 없어도 정정으로 ownership 이 옮겨졌거나
  //  다른 평가자가 매긴 점수도 그대로 보여야 한다. "평가이력 없음"으로 표시되는 문제 해소.)
  return useRecordsLoader(
    () =>
      evaluatorId
        ? employeeService.getFormerEvaluateesByEvaluator(evaluatorId, selectedPeriodId)
        : Promise.resolve([]),
    `former-team:${evaluatorId}:${selectedPeriodId ?? ''}`,
    includeFeedbackHistory,
    null,
  );
};

// 직전연도(또는 임의 기간) 비교용 레코드 로딩. 주어진 직원들의 특정 기간 평가를 불러온다.
// bulk: HR 전사 화면(직원 ~수백 명)에서만 true — 직전연도 레코드도 벌크 2회로 모아 N+1·429 제거.
// 벌크 엔드포인트는 requireHr이므로 평가자/피평가자 화면(소수 인원)은 false로 두면 개별 경로로 안전 폴백.
export const usePriorYearRecords = (
  employees: Employee[],
  priorPeriodId: string | null,
  evaluatorId: string | null = null,
  bulk = false,
): EmployeeEvaluationRecord[] => {
  const key = employees.map((e) => e.employee_id).sort().join(',');
  const query = useQuery({
    queryKey: queryKeys.priorYearRecords(key, priorPeriodId, evaluatorId, bulk),
    queryFn: () =>
      loadEmployeeEvaluationRecords(employees, { periodId: priorPeriodId, evaluatorId, bulk }),
    enabled: Boolean(priorPeriodId) && employees.length > 0,
    placeholderData: keepPreviousData,
  });
  return query.data ?? [];
};

export const useCompanyDashboardRecords = (includeFeedbackHistory = false) =>
  useRecordsLoader(
    async () => {
      const employees = await employeeService.getAllEmployees();
      return getActiveEvaluatees(employees);
    },
    'company',
    includeFeedbackHistory,
    null,
    false,
    true, // HR 전체 대시보드 — 벌크 로드로 N+1·429 완화
  );

export const useAllEmployees = (): DashboardState =>
  // 직원관리 목록은 평가 "존재/상태"(record.evaluation)만 사용하고 과업 점수는 쓰지 않는다.
  // per-employee 과업 조회를 생략해 대규모 직원 로드 시 요청 폭주(포트 고갈)를 막는다.
  // bulk=true: 평가 존재/상태도 벌크 1회로 모아 직원 수만큼의 개별 호출 제거.
  useRecordsLoader(() => employeeService.getAllEmployees(), 'all', false, null, true, true);
