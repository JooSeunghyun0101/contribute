// HR 통계 페이지(부서 결과·직종 벤치마크·평가 품질) 공통 표본/갭 헬퍼.
// 기존에 HrDepartmentResultsPage·HrJobRoleBenchmarkPage·HrQualityPage 세 곳에
// 동일하게 복붙돼 있던 정의를 단일 출처로 통합한다(거동 동일 — 코드 byte 일치).
import { getScoreGapBucket, type ScoreGapBucket } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

// 소표본 임계값 — n<MIN_SAMPLE 그룹은 통계 회색 처리·비교/정렬에서 제외.
export const MIN_SAMPLE = 5;

export type GapBucketCounts = Record<ScoreGapBucket, number>;

export const BUCKET_ORDER: ScoreGapBucket[] = ['exceed', 'meet', 'near', 'below'];
export const BUCKET_LABEL: Record<ScoreGapBucket, string> = {
  exceed: '초과',
  meet: '충족',
  near: '근접',
  below: '미달',
};

export const emptyBuckets = (): GapBucketCounts => ({ exceed: 0, meet: 0, near: 0, below: 0 });

export type ValidSample = {
  record: EmployeeEvaluationRecord;
  gap: number; // Math.round(flooredScore) - Math.round(growthLevel)
  bucket: ScoreGapBucket;
};

const toNum = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

// 완료 판정 — task 점수 충족 기준(dashboardData status='completed' 와 동일).
export const isCompletedRecord = (r: EmployeeEvaluationRecord): boolean =>
  r.totalTasks > 0 && r.completedTasks === r.totalTasks;

// 유효표본(갭 산출 가능) 여부 — 완료 + score>0 + growthLevel>0 일 때만.
export const toValidSample = (r: EmployeeEvaluationRecord): ValidSample | null => {
  if (!isCompletedRecord(r)) return null;
  const score = r.flooredScore;
  const growth = toNum(r.employee.growth_level);
  if (!(score > 0) || !Number.isFinite(growth) || !(growth > 0)) return null;
  const gap = Math.round(score) - Math.round(growth);
  return { record: r, gap, bucket: getScoreGapBucket(score, growth) };
};

// 표본표준편차(베셀 보정, n-1). n<2 → null(정의 불가).
export const sampleStdDev = (gaps: number[]): number | null => {
  const n = gaps.length;
  if (n < 2) return null;
  const m = gaps.reduce((s, g) => s + g, 0) / n;
  const variance = gaps.reduce((s, g) => s + (g - m) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
};
