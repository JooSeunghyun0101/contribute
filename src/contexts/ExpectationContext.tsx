/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { queryKeys } from '@/lib/queryKeys';
import { settingService } from '@/lib/services/settingService';
import {
  COMPANY_MATRIX_SETTING_USER_ID,
  GROWTH_LEVEL_EXPECTATIONS_SETTING_TYPE,
  SCORE_EXPECTATIONS_SETTING_TYPE,
  SCORE_GAP_EXPECTATIONS_SETTING_TYPE,
  MATRIX_GUIDE_SETTING_TYPE,
  cloneDefaultGrowthLevelExpectations,
  cloneDefaultScoreExpectations,
  cloneDefaultScoreGapExpectations,
  cloneDefaultMatrixGuide,
  normalizeGrowthLevelExpectations,
  normalizeScoreExpectations,
  normalizeScoreGapExpectations,
  normalizeMatrixGuide,
  type ContributionScoreLevel,
  type GrowthLevel,
  type GrowthLevelExpectation,
  type ScoreExpectation,
  type ScoreGapBucket,
  type ScoreGapExpectation,
  type MatrixGuide,
} from '@/lib/evaluationMatrix';

type ScoreMap = Record<ContributionScoreLevel, ScoreExpectation>;
type GrowthMap = Record<GrowthLevel, GrowthLevelExpectation>;
type GapMap = Record<ScoreGapBucket, ScoreGapExpectation>;

type ExpectationData = {
  score: ScoreMap;
  growth: GrowthMap;
  gap: GapMap;
  guide: MatrixGuide;
};

type ExpectationContextType = {
  scoreExpectations: ScoreMap;
  growthLevelExpectations: GrowthMap;
  scoreGapExpectations: GapMap;
  matrixGuide: MatrixGuide;
  isLoading: boolean;
  refresh: () => Promise<void>;
  saveScoreExpectations: (next: ScoreMap) => Promise<void>;
  saveGrowthLevelExpectations: (next: GrowthMap) => Promise<void>;
  saveScoreGapExpectations: (next: GapMap) => Promise<void>;
  saveMatrixGuide: (next: MatrixGuide) => Promise<void>;
};

const SCORE_CACHE_KEY = 'companyScoreExpectations';
const LEVEL_CACHE_KEY = 'companyGrowthLevelExpectations';
const GAP_CACHE_KEY = 'companyScoreGapExpectations';
const GUIDE_CACHE_KEY = 'companyMatrixGuide';

const ExpectationContext = createContext<ExpectationContextType | undefined>(undefined);

const readCache = <T,>(key: string, normalize: (v: unknown) => T | null): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeCache = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

// localStorage 캐시(없으면 기본값)로 4종 기대수준을 즉시 구성 — placeholderData·폴백용.
const readAllCache = (): ExpectationData => ({
  score: readCache(SCORE_CACHE_KEY, normalizeScoreExpectations) ?? cloneDefaultScoreExpectations(),
  growth:
    readCache(LEVEL_CACHE_KEY, normalizeGrowthLevelExpectations) ??
    cloneDefaultGrowthLevelExpectations(),
  gap: readCache(GAP_CACHE_KEY, normalizeScoreGapExpectations) ?? cloneDefaultScoreGapExpectations(),
  guide: readCache(GUIDE_CACHE_KEY, normalizeMatrixGuide) ?? cloneDefaultMatrixGuide(),
});

export const ExpectationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // 회사 기대수준(점수·성장레벨·갭·가이드)은 React Query 가 보관. 참조 데이터라 staleTime=Infinity,
  // placeholderData(=캐시/기본값)로 첫 조회 동안에도 즉시 표시. 저장/명시적 새로고침 때만 갱신.
  const query = useQuery({
    queryKey: queryKeys.expectations(),
    enabled: Boolean(user),
    staleTime: Infinity,
    placeholderData: readAllCache,
    queryFn: async (): Promise<ExpectationData> => {
      const [scoreSetting, levelSetting, gapSetting, guideSetting] = await Promise.all([
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, SCORE_EXPECTATIONS_SETTING_TYPE)
          .catch((): null => null),
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, GROWTH_LEVEL_EXPECTATIONS_SETTING_TYPE)
          .catch((): null => null),
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, SCORE_GAP_EXPECTATIONS_SETTING_TYPE)
          .catch((): null => null),
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, MATRIX_GUIDE_SETTING_TYPE)
          .catch((): null => null),
      ]);
      const data: ExpectationData = {
        score: normalizeScoreExpectations(scoreSetting?.setting_data) ?? cloneDefaultScoreExpectations(),
        growth:
          normalizeGrowthLevelExpectations(levelSetting?.setting_data) ??
          cloneDefaultGrowthLevelExpectations(),
        gap:
          normalizeScoreGapExpectations(gapSetting?.setting_data) ?? cloneDefaultScoreGapExpectations(),
        guide: normalizeMatrixGuide(guideSetting?.setting_data) ?? cloneDefaultMatrixGuide(),
      };
      writeCache(SCORE_CACHE_KEY, data.score);
      writeCache(LEVEL_CACHE_KEY, data.growth);
      writeCache(GAP_CACHE_KEY, data.gap);
      writeCache(GUIDE_CACHE_KEY, data.guide);
      return data;
    },
  });

  const data = useMemo(() => query.data ?? readAllCache(), [query.data]);
  const isLoading = query.isFetching;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.expectations() });
  }, [queryClient]);

  // 저장: 낙관적으로 쿼리 캐시의 해당 필드만 갱신 + localStorage 기록 후 서버 저장.
  const patchCache = useCallback(
    (patch: Partial<ExpectationData>) => {
      queryClient.setQueryData<ExpectationData>(queryKeys.expectations(), (prev) => ({
        ...(prev ?? readAllCache()),
        ...patch,
      }));
    },
    [queryClient],
  );

  const saveScoreExpectations = useCallback(
    async (next: ScoreMap) => {
      const normalized = normalizeScoreExpectations(next);
      if (!normalized) throw new Error('점수 기대수준 형식이 유효하지 않습니다.');
      patchCache({ score: normalized });
      writeCache(SCORE_CACHE_KEY, normalized);
      await settingService.saveSetting(
        COMPANY_MATRIX_SETTING_USER_ID,
        SCORE_EXPECTATIONS_SETTING_TYPE,
        normalized,
      );
    },
    [patchCache],
  );

  const saveGrowthLevelExpectations = useCallback(
    async (next: GrowthMap) => {
      const normalized = normalizeGrowthLevelExpectations(next);
      if (!normalized) throw new Error('성장레벨 기대수준 형식이 유효하지 않습니다.');
      patchCache({ growth: normalized });
      writeCache(LEVEL_CACHE_KEY, normalized);
      await settingService.saveSetting(
        COMPANY_MATRIX_SETTING_USER_ID,
        GROWTH_LEVEL_EXPECTATIONS_SETTING_TYPE,
        normalized,
      );
    },
    [patchCache],
  );

  const saveScoreGapExpectations = useCallback(
    async (next: GapMap) => {
      const normalized = normalizeScoreGapExpectations(next);
      if (!normalized) throw new Error('점수-성장레벨 갭 기대수준 형식이 유효하지 않습니다.');
      patchCache({ gap: normalized });
      writeCache(GAP_CACHE_KEY, normalized);
      await settingService.saveSetting(
        COMPANY_MATRIX_SETTING_USER_ID,
        SCORE_GAP_EXPECTATIONS_SETTING_TYPE,
        normalized,
      );
    },
    [patchCache],
  );

  const saveMatrixGuide = useCallback(
    async (next: MatrixGuide) => {
      const normalized = normalizeMatrixGuide(next);
      if (!normalized) throw new Error('매트릭스 가이드 형식이 유효하지 않습니다.');
      patchCache({ guide: normalized });
      writeCache(GUIDE_CACHE_KEY, normalized);
      await settingService.saveSetting(
        COMPANY_MATRIX_SETTING_USER_ID,
        MATRIX_GUIDE_SETTING_TYPE,
        normalized,
      );
    },
    [patchCache],
  );

  const value = useMemo<ExpectationContextType>(
    () => ({
      scoreExpectations: data.score,
      growthLevelExpectations: data.growth,
      scoreGapExpectations: data.gap,
      matrixGuide: data.guide,
      isLoading,
      refresh,
      saveScoreExpectations,
      saveGrowthLevelExpectations,
      saveScoreGapExpectations,
      saveMatrixGuide,
    }),
    [
      data,
      isLoading,
      refresh,
      saveScoreExpectations,
      saveGrowthLevelExpectations,
      saveScoreGapExpectations,
      saveMatrixGuide,
    ],
  );

  return <ExpectationContext.Provider value={value}>{children}</ExpectationContext.Provider>;
};

export const useExpectations = (): ExpectationContextType => {
  const ctx = useContext(ExpectationContext);
  if (!ctx) {
    throw new Error('useExpectations must be used within ExpectationProvider');
  }
  return ctx;
};
