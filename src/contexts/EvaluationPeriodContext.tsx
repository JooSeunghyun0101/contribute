/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { evaluationPeriodService } from '@/lib/services';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/contexts/AuthContext';
import type { EvaluationPeriod } from '@/types';

type EvaluationPeriodContextValue = {
  periods: EvaluationPeriod[];
  selectedPeriodId: string | null;
  selectedPeriod: EvaluationPeriod | null;
  selectedPeriodStatus: EvaluationPeriod['status'] | null;
  isSelectedPeriodEditable: boolean;
  selectedPeriodEditMessage: string | null;
  isLoading: boolean;
  error: string | null;
  setSelectedPeriodId: (periodId: string | null) => void;
  reloadPeriods: () => Promise<void>;
};

const STORAGE_KEY = 'selectedEvaluationPeriodId';

const EvaluationPeriodContext = createContext<EvaluationPeriodContextValue | null>(null);

// P3-2: 공용 PC에서 이전 사용자가 보던 평가기간이 다음 로그인 계정에 승계되지 않도록
// 저장 키를 계정별로 분리한다. 구 전역 키('selectedEvaluationPeriodId')는 더 이상 읽지 않는다.
const storageKeyFor = (employeeId: string | null | undefined) =>
  employeeId ? `${STORAGE_KEY}:${employeeId}` : null;

const readSavedPeriodId = (key: string | null) => {
  if (!key || typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
};

const writeSavedPeriodId = (key: string | null, periodId: string | null) => {
  if (!key || typeof window === 'undefined') return;
  if (periodId) {
    window.localStorage.setItem(key, periodId);
  } else {
    window.localStorage.removeItem(key);
  }
};

export const EvaluationPeriodProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // 로그인 계정 기준 키 — 이 프로바이더는 ProtectedRoute 안에서만 마운트되므로 초기값부터 계정 키로 읽는다.
  const storageKey = storageKeyFor(user?.employeeId);
  const [selectedPeriodId, setSelectedPeriodIdState] = useState<string | null>(() =>
    readSavedPeriodId(storageKeyFor(user?.employeeId)),
  );

  // 서버 상태(평가기간 목록)는 React Query 가 캐시·중복제거·재조회를 담당(마운트마다 재조회 제거).
  const periodsQuery = useQuery({
    queryKey: queryKeys.evaluationPeriods(),
    queryFn: () => evaluationPeriodService.getPeriods(),
  });
  const periods = useMemo<EvaluationPeriod[]>(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const isLoading = periodsQuery.isLoading;
  const error = periodsQuery.error
    ? periodsQuery.error instanceof Error
      ? periodsQuery.error.message
      : '평가기간을 불러오지 못했습니다.'
    : null;

  // 목록이 (재)조회되면 선택 평가기간 정합화: 저장값이 유효하면 유지, 아니면 active+default → active → 첫 번째.
  useEffect(() => {
    if (!periodsQuery.isSuccess) return;
    const loadedPeriods = periodsQuery.data;
    setSelectedPeriodIdState((current) => {
      const saved = current ?? readSavedPeriodId(storageKey);
      const savedExists = saved && loadedPeriods.some((period) => period.id === saved);
      if (savedExists) return saved;

      const next =
        loadedPeriods.find((period) => period.status === 'active' && period.is_default)?.id ??
        loadedPeriods.find((period) => period.status === 'active')?.id ??
        loadedPeriods[0]?.id ??
        null;
      writeSavedPeriodId(storageKey, next);
      return next;
    });
  }, [periodsQuery.isSuccess, periodsQuery.data, storageKey]);

  // 외부에서 강제 새로고침 시 공유 캐시를 무효화 → 모든 소비자 동기 재조회.
  const reloadPeriods = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.evaluationPeriods() });
  }, [queryClient]);

  const setSelectedPeriodId = useCallback(
    (periodId: string | null) => {
      setSelectedPeriodIdState(periodId);
      writeSavedPeriodId(storageKey, periodId);
    },
    [storageKey],
  );

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );
  const selectedPeriodStatus = selectedPeriod?.status ?? null;
  const isSelectedPeriodEditable = !selectedPeriod || selectedPeriodStatus === 'active';
  const selectedPeriodEditMessage = isSelectedPeriodEditable
    ? null
    : `선택한 평가기간이 ${selectedPeriodStatus === 'closed' ? '마감' : selectedPeriodStatus === 'locked' ? '잠금' : '작성 전'} 상태라 수정할 수 없습니다.`;

  const value = useMemo(
    () => ({
      periods,
      selectedPeriodId,
      selectedPeriod,
      selectedPeriodStatus,
      isSelectedPeriodEditable,
      selectedPeriodEditMessage,
      isLoading,
      error,
      setSelectedPeriodId,
      reloadPeriods,
    }),
    [
      error,
      isLoading,
      isSelectedPeriodEditable,
      periods,
      reloadPeriods,
      selectedPeriod,
      selectedPeriodEditMessage,
      selectedPeriodId,
      selectedPeriodStatus,
      setSelectedPeriodId,
    ],
  );

  return (
    <EvaluationPeriodContext.Provider value={value}>
      {children}
    </EvaluationPeriodContext.Provider>
  );
};

export const useEvaluationPeriod = () => {
  const context = useContext(EvaluationPeriodContext);
  if (!context) {
    throw new Error('useEvaluationPeriod must be used within EvaluationPeriodProvider');
  }
  return context;
};
