/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { evaluationPeriodService } from '@/lib/services';
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

const readSavedPeriodId = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
};

const writeSavedPeriodId = (periodId: string | null) => {
  if (typeof window === 'undefined') return;
  if (periodId) {
    window.localStorage.setItem(STORAGE_KEY, periodId);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
};

export const EvaluationPeriodProvider = ({ children }: { children: ReactNode }) => {
  const [periods, setPeriods] = useState<EvaluationPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodIdState] = useState<string | null>(() => readSavedPeriodId());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadPeriods = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loadedPeriods = await evaluationPeriodService.getPeriods();
      setPeriods(loadedPeriods);

      setSelectedPeriodIdState((current) => {
        const saved = current ?? readSavedPeriodId();
        const savedExists = saved && loadedPeriods.some((period) => period.id === saved);
        if (savedExists) return saved;

        const next =
          loadedPeriods.find((period) => period.status === 'active' && period.is_default)?.id ??
          loadedPeriods.find((period) => period.status === 'active')?.id ??
          loadedPeriods[0]?.id ??
          null;
        writeSavedPeriodId(next);
        return next;
      });
    } catch (err) {
      setPeriods([]);
      setError(err instanceof Error ? err.message : '평가기간을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadPeriods();
  }, [reloadPeriods]);

  const setSelectedPeriodId = useCallback((periodId: string | null) => {
    setSelectedPeriodIdState(periodId);
    writeSavedPeriodId(periodId);
  }, []);

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
