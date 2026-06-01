import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { settingService } from '@/lib/services/settingService';
import {
  COMPANY_MATRIX_SETTING_USER_ID,
  GROWTH_LEVEL_EXPECTATIONS_SETTING_TYPE,
  SCORE_EXPECTATIONS_SETTING_TYPE,
  SCORE_GAP_EXPECTATIONS_SETTING_TYPE,
  cloneDefaultGrowthLevelExpectations,
  cloneDefaultScoreExpectations,
  cloneDefaultScoreGapExpectations,
  normalizeGrowthLevelExpectations,
  normalizeScoreExpectations,
  normalizeScoreGapExpectations,
  type ContributionScoreLevel,
  type GrowthLevel,
  type GrowthLevelExpectation,
  type ScoreExpectation,
  type ScoreGapBucket,
  type ScoreGapExpectation,
} from '@/lib/evaluationMatrix';

type ScoreMap = Record<ContributionScoreLevel, ScoreExpectation>;
type GrowthMap = Record<GrowthLevel, GrowthLevelExpectation>;
type GapMap = Record<ScoreGapBucket, ScoreGapExpectation>;

type ExpectationContextType = {
  scoreExpectations: ScoreMap;
  growthLevelExpectations: GrowthMap;
  scoreGapExpectations: GapMap;
  isLoading: boolean;
  refresh: () => Promise<void>;
  saveScoreExpectations: (next: ScoreMap) => Promise<void>;
  saveGrowthLevelExpectations: (next: GrowthMap) => Promise<void>;
  saveScoreGapExpectations: (next: GapMap) => Promise<void>;
};

const SCORE_CACHE_KEY = 'companyScoreExpectations';
const LEVEL_CACHE_KEY = 'companyGrowthLevelExpectations';
const GAP_CACHE_KEY = 'companyScoreGapExpectations';

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

export const ExpectationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialScore = useMemo(
    () => readCache(SCORE_CACHE_KEY, normalizeScoreExpectations) ?? cloneDefaultScoreExpectations(),
    [],
  );
  const initialGrowth = useMemo(
    () =>
      readCache(LEVEL_CACHE_KEY, normalizeGrowthLevelExpectations) ??
      cloneDefaultGrowthLevelExpectations(),
    [],
  );
  const initialGap = useMemo(
    () =>
      readCache(GAP_CACHE_KEY, normalizeScoreGapExpectations) ??
      cloneDefaultScoreGapExpectations(),
    [],
  );
  const [scoreMap, setScoreMap] = useState<ScoreMap>(initialScore);
  const [growthMap, setGrowthMap] = useState<GrowthMap>(initialGrowth);
  const [gapMap, setGapMap] = useState<GapMap>(initialGap);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [scoreSetting, levelSetting, gapSetting] = await Promise.all([
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, SCORE_EXPECTATIONS_SETTING_TYPE)
          .catch(() => null),
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, GROWTH_LEVEL_EXPECTATIONS_SETTING_TYPE)
          .catch(() => null),
        settingService
          .getUserSetting(COMPANY_MATRIX_SETTING_USER_ID, SCORE_GAP_EXPECTATIONS_SETTING_TYPE)
          .catch(() => null),
      ]);
      const nextScore =
        normalizeScoreExpectations(scoreSetting?.setting_data) ?? cloneDefaultScoreExpectations();
      const nextGrowth =
        normalizeGrowthLevelExpectations(levelSetting?.setting_data) ??
        cloneDefaultGrowthLevelExpectations();
      const nextGap =
        normalizeScoreGapExpectations(gapSetting?.setting_data) ??
        cloneDefaultScoreGapExpectations();
      setScoreMap(nextScore);
      setGrowthMap(nextGrowth);
      setGapMap(nextGap);
      writeCache(SCORE_CACHE_KEY, nextScore);
      writeCache(LEVEL_CACHE_KEY, nextGrowth);
      writeCache(GAP_CACHE_KEY, nextGap);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveScoreExpectations = useCallback(async (next: ScoreMap) => {
    const normalized = normalizeScoreExpectations(next);
    if (!normalized) throw new Error('점수 기대수준 형식이 유효하지 않습니다.');
    setScoreMap(normalized);
    writeCache(SCORE_CACHE_KEY, normalized);
    await settingService.saveSetting(
      COMPANY_MATRIX_SETTING_USER_ID,
      SCORE_EXPECTATIONS_SETTING_TYPE,
      normalized,
    );
  }, []);

  const saveGrowthLevelExpectations = useCallback(async (next: GrowthMap) => {
    const normalized = normalizeGrowthLevelExpectations(next);
    if (!normalized) throw new Error('성장레벨 기대수준 형식이 유효하지 않습니다.');
    setGrowthMap(normalized);
    writeCache(LEVEL_CACHE_KEY, normalized);
    await settingService.saveSetting(
      COMPANY_MATRIX_SETTING_USER_ID,
      GROWTH_LEVEL_EXPECTATIONS_SETTING_TYPE,
      normalized,
    );
  }, []);

  const saveScoreGapExpectations = useCallback(async (next: GapMap) => {
    const normalized = normalizeScoreGapExpectations(next);
    if (!normalized) throw new Error('점수-성장레벨 갭 기대수준 형식이 유효하지 않습니다.');
    setGapMap(normalized);
    writeCache(GAP_CACHE_KEY, normalized);
    await settingService.saveSetting(
      COMPANY_MATRIX_SETTING_USER_ID,
      SCORE_GAP_EXPECTATIONS_SETTING_TYPE,
      normalized,
    );
  }, []);

  const value = useMemo<ExpectationContextType>(
    () => ({
      scoreExpectations: scoreMap,
      growthLevelExpectations: growthMap,
      scoreGapExpectations: gapMap,
      isLoading,
      refresh,
      saveScoreExpectations,
      saveGrowthLevelExpectations,
      saveScoreGapExpectations,
    }),
    [
      scoreMap,
      growthMap,
      gapMap,
      isLoading,
      refresh,
      saveScoreExpectations,
      saveGrowthLevelExpectations,
      saveScoreGapExpectations,
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
