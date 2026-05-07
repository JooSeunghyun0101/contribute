import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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
  const initialMatrix = useMemo(() => readCachedMatrix() ?? cloneDefaultMatrix(), []);
  const [matrix, setMatrix] = useState<EvaluationMatrixScores>(initialMatrix);
  const [isLoading, setIsLoading] = useState(false);

  const refreshMatrix = useCallback(async () => {
    if (!user) {
      setMatrix(readCachedMatrix() ?? cloneDefaultMatrix());
      return;
    }

    setIsLoading(true);
    try {
      const [companySetting, userSetting] = await Promise.all([
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, EVALUATION_MATRIX_SETTING_TYPE)
          .catch(() => null),
        settingService
          .getUserSetting(user.employeeId, EVALUATION_MATRIX_SETTING_TYPE)
          .catch(() => null),
      ]);

      const nextMatrix =
        normalizeEvaluationMatrix(companySetting?.setting_data) ??
        normalizeEvaluationMatrix(userSetting?.setting_data) ??
        readCachedMatrix() ??
        cloneDefaultMatrix();

      setMatrix(nextMatrix);
      writeCachedMatrix(nextMatrix);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshMatrix();
  }, [refreshMatrix]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== MATRIX_CACHE_KEY || !event.newValue) return;

      try {
        const nextMatrix = normalizeEvaluationMatrix(JSON.parse(event.newValue));
        if (nextMatrix) setMatrix(nextMatrix);
      } catch {
        // Ignore malformed cache values from other tabs.
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const previewMatrix = useCallback((nextMatrix: EvaluationMatrixScores) => {
    const normalized = normalizeEvaluationMatrix(nextMatrix);
    if (normalized) {
      setMatrix(normalized);
    }
  }, []);

  const saveMatrix = useCallback(
    async (nextMatrix: EvaluationMatrixScores) => {
      const normalized = normalizeEvaluationMatrix(nextMatrix);
      if (!normalized) {
        throw new Error('유효하지 않은 매트릭스 형식입니다.');
      }

      setMatrix(normalized);
      writeCachedMatrix(normalized);

      await settingService.saveSetting(
        COMPANY_MATRIX_SETTING_USER_ID,
        EVALUATION_MATRIX_SETTING_TYPE,
        normalized,
      );

      if (user?.employeeId && user.employeeId !== COMPANY_MATRIX_SETTING_USER_ID) {
        await settingService.saveSetting(user.employeeId, EVALUATION_MATRIX_SETTING_TYPE, normalized);
      }
    },
    [user?.employeeId],
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
