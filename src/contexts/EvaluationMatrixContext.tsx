import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { queryKeys } from '@/lib/queryKeys';
import { settingService } from '@/lib/services/settingService';
import {
  COMPANY_MATRIX_SETTING_USER_ID,
  EVALUATION_MATRIX_SETTING_TYPE,
  EvaluationMatrixScores,
  cloneDefaultMatrix,
  normalizeEvaluationMatrix,
} from '@/lib/evaluationMatrix';

type EvaluationMatrixContextType = {
  matrix: EvaluationMatrixScores;
  isLoading: boolean;
  refreshMatrix: () => Promise<void>;
  previewMatrix: (nextMatrix: EvaluationMatrixScores) => void;
  saveMatrix: (nextMatrix: EvaluationMatrixScores) => Promise<void>;
};

const MATRIX_CACHE_KEY = 'companyEvaluationMatrix';

const EvaluationMatrixContext = createContext<EvaluationMatrixContextType | undefined>(undefined);

const readCachedMatrix = () => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(MATRIX_CACHE_KEY);
    return raw ? normalizeEvaluationMatrix(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeCachedMatrix = (matrix: EvaluationMatrixScores) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MATRIX_CACHE_KEY, JSON.stringify(matrix));
};

export const EvaluationMatrixProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // 서버 상태(회사 매트릭스)는 React Query 가 보관. 참조 데이터라 staleTime=Infinity 로 두어
  // 백그라운드 재조회가 편집 중 preview 를 덮지 않게 하고, 저장/명시적 새로고침 때만 갱신한다.
  // placeholderData(=캐시/기본값)로 첫 조회 동안에도 즉시 매트릭스를 보여준다.
  const matrixQuery = useQuery({
    queryKey: queryKeys.evaluationMatrix(),
    enabled: Boolean(user),
    staleTime: Infinity,
    placeholderData: () => readCachedMatrix() ?? cloneDefaultMatrix(),
    queryFn: async () => {
      const companySetting = await settingService
        .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, EVALUATION_MATRIX_SETTING_TYPE)
        .catch((): null => null);
      const nextMatrix =
        normalizeEvaluationMatrix(companySetting?.setting_data) ??
        readCachedMatrix() ??
        cloneDefaultMatrix();
      writeCachedMatrix(nextMatrix);
      return nextMatrix;
    },
  });

  const matrix = matrixQuery.data ?? cloneDefaultMatrix();
  const isLoading = matrixQuery.isFetching;

  // 다른 탭에서 캐시가 바뀌면 현재 탭 매트릭스도 동기화(쿼리 캐시에 반영).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== MATRIX_CACHE_KEY || !event.newValue) return;

      try {
        const nextMatrix = normalizeEvaluationMatrix(JSON.parse(event.newValue));
        if (nextMatrix) queryClient.setQueryData(queryKeys.evaluationMatrix(), nextMatrix);
      } catch {
        // Ignore malformed cache values from other tabs.
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [queryClient]);

  const refreshMatrix = useCallback(async () => {
    if (!user) {
      queryClient.setQueryData(queryKeys.evaluationMatrix(), readCachedMatrix() ?? cloneDefaultMatrix());
      return;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.evaluationMatrix() });
  }, [user, queryClient]);

  // 편집 중 미저장 미리보기 — 캐시에 즉시 반영(모든 소비자에 전파), 서버 저장은 안 함.
  const previewMatrix = useCallback(
    (nextMatrix: EvaluationMatrixScores) => {
      const normalized = normalizeEvaluationMatrix(nextMatrix);
      if (normalized) queryClient.setQueryData(queryKeys.evaluationMatrix(), normalized);
    },
    [queryClient],
  );

  const saveMatrix = useCallback(
    async (nextMatrix: EvaluationMatrixScores) => {
      const normalized = normalizeEvaluationMatrix(nextMatrix);
      if (!normalized) {
        throw new Error('유효하지 않은 매트릭스 형식입니다.');
      }

      // 낙관적 반영 + 캐시 기록 후 서버 저장.
      queryClient.setQueryData(queryKeys.evaluationMatrix(), normalized);
      writeCachedMatrix(normalized);

      await settingService.saveSetting(
        COMPANY_MATRIX_SETTING_USER_ID,
        EVALUATION_MATRIX_SETTING_TYPE,
        normalized,
      );
    },
    [queryClient],
  );

  const value = useMemo(
    () => ({
      matrix,
      isLoading,
      refreshMatrix,
      previewMatrix,
      saveMatrix,
    }),
    [isLoading, matrix, previewMatrix, refreshMatrix, saveMatrix],
  );

  return (
    <EvaluationMatrixContext.Provider value={value}>
      {children}
    </EvaluationMatrixContext.Provider>
  );
};

export const useEvaluationMatrix = () => {
  const context = useContext(EvaluationMatrixContext);
  if (!context) {
    throw new Error('useEvaluationMatrix must be used within EvaluationMatrixProvider');
  }
  return context;
};
