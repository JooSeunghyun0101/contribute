// 평가 인사이트 산점도용 집계 — 축(조직/직종/평가자)별 그룹을 한 점으로.
//  X = 또래 보정 편향(같은 성장레벨 또래의 전사 평균 갭 대비 초과분 — 팀 구성 효과 제거)
//  Y = 변별력(갭의 표준편차) · 점 크기 = 인원 · 보조 = 쏠림(최빈 갭버킷 집중도)
import { sampleStdDev, toValidSample, MIN_SAMPLE, BUCKET_LABEL, type ValidSample } from '@/lib/orgStats';
import { getOrgValue, orgFieldsFromEvaluation, ORG_LEVELS, type OrgLevel } from '@/lib/orgHierarchy';
import type { ScoreGapBucket } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

export type ScatterAxis = 'org' | 'job' | 'evaluator';

// 조직 축 그룹 레벨(본부/부/팀) — 산점도가 이 단위로 묶인다.
export type OrgScatterLevel = Extract<OrgLevel, 'division' | 'department' | 'team'>;

export type ScatterMember = { employeeId: string; name: string; score: number; gap: number };

export type ScatterPoint = {
  id: string;
  label: string;
  n: number;
  bias: number; // 또래 보정 편향(X) — 같은 성장레벨 또래 전사평균 대비 초과분(+후함/−박함, 0=또래동일)
  meanGap: number; // 참고: 원 평균 갭(점수 − 성장레벨 기대)
  meanScore: number;
  stdDev: number | null; // 변별력(Y) — 갭의 표준편차(낮을수록 쏠림/무변별)
  modeShare: number; // 쏠림 — 최빈 갭버킷 집중 비율(0~1)
  modeLabel: string; // 최빈 갭버킷 이름(초과/충족/근접/미달)
  isSmall: boolean; // n < MIN_SAMPLE
  members: ScatterMember[];
};

// 조직 축: 선택 레벨까지의 '법인 › 본부 › …' 전체 경로로 묶고, 그 경로를 라벨로 쓴다.
const orgPathTo = (r: EmployeeEvaluationRecord, level: OrgScatterLevel): string => {
  const fields = orgFieldsFromEvaluation(r.evaluation, r.employee);
  const lastIdx = ORG_LEVELS.indexOf(level);
  const parts: string[] = [];
  for (let i = 0; i <= lastIdx; i += 1) {
    const v = getOrgValue(fields, ORG_LEVELS[i]);
    if (v) parts.push(v);
  }
  return parts.join(' › ');
};

const groupKeyOf = (axis: ScatterAxis, r: EmployeeEvaluationRecord, orgLevel: OrgScatterLevel): string => {
  if (axis === 'evaluator') return r.evaluation?.evaluator_name?.trim() || '평가자 미배정';
  if (axis === 'job') return (r.employee.job_role ?? '').trim() || '직무 미지정';
  return orgPathTo(r, orgLevel) || '조직 미지정';
};

const growthLevelOf = (s: ValidSample): number => Math.round(Number(s.record.employee.growth_level) || 0);

// 같은 성장레벨 또래의 전사 평균 갭. 또래 보정 편향의 기준선.
const cohortMeanByLevel = (samples: ValidSample[]): Map<number, number> => {
  const acc = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const lv = growthLevelOf(s);
    const cur = acc.get(lv) ?? { sum: 0, n: 0 };
    cur.sum += s.gap;
    cur.n += 1;
    acc.set(lv, cur);
  }
  const out = new Map<number, number>();
  for (const [lv, { sum, n }] of acc) out.set(lv, n > 0 ? sum / n : 0);
  return out;
};

export const buildScatterPoints = (
  records: EmployeeEvaluationRecord[],
  axis: ScatterAxis,
  orgLevel: OrgScatterLevel = 'division',
  // 또래 기준선은 전사(필터 전) 모집단으로 잡아야 '또래 대비'가 안정적이다. 미지정 시 records 사용.
  cohortRecords?: EmployeeEvaluationRecord[],
): ScatterPoint[] => {
  const samples = records.map(toValidSample).filter((s): s is ValidSample => s !== null);
  const cohortSamples = (cohortRecords ?? records)
    .map(toValidSample)
    .filter((s): s is ValidSample => s !== null);
  const cohortMean = cohortMeanByLevel(cohortSamples);

  const groups = new Map<string, ValidSample[]>();
  for (const s of samples) {
    const key = groupKeyOf(axis, s.record, orgLevel);
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const points: ScatterPoint[] = [];
  for (const [label, list] of groups) {
    const n = list.length;
    const scores = list.map((s) => s.record.weightedScore);
    const gaps = list.map((s) => s.gap);
    const residuals = list.map((s) => s.gap - (cohortMean.get(growthLevelOf(s)) ?? 0));
    const bias = residuals.reduce((a, b) => a + b, 0) / n;
    const meanScore = scores.reduce((a, b) => a + b, 0) / n;
    const meanGap = gaps.reduce((a, b) => a + b, 0) / n;

    const bucketCounts = new Map<ScoreGapBucket, number>();
    for (const s of list) bucketCounts.set(s.bucket, (bucketCounts.get(s.bucket) ?? 0) + 1);
    let modeBucket: ScoreGapBucket = 'meet';
    let modeN = -1;
    for (const [b, c] of bucketCounts) {
      if (c > modeN) {
        modeN = c;
        modeBucket = b;
      }
    }

    const members: ScatterMember[] = list
      .map((s) => ({
        employeeId: s.record.employee.employee_id,
        name: s.record.employee.name,
        score: Math.round(s.record.weightedScore * 10) / 10,
        gap: s.gap,
      }))
      .sort((a, b) => b.gap - a.gap);

    points.push({
      id: label,
      label,
      n,
      bias: Math.round(bias * 100) / 100,
      meanGap: Math.round(meanGap * 100) / 100,
      meanScore: Math.round(meanScore * 100) / 100,
      stdDev: sampleStdDev(gaps),
      modeShare: n > 0 ? modeN / n : 0,
      modeLabel: BUCKET_LABEL[modeBucket],
      isSmall: n < MIN_SAMPLE,
      members,
    });
  }
  return points;
};

// 성장레벨별 평균 점수(전사 유효표본) — 산점도 상단에 '레벨평균이 몇 점인지' 표시용.
export const levelMeanScores = (
  records: EmployeeEvaluationRecord[],
): { level: number; mean: number; n: number }[] => {
  const samples = records.map(toValidSample).filter((s): s is ValidSample => s !== null);
  const m = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const lv = growthLevelOf(s);
    if (!lv) continue;
    const c = m.get(lv) ?? { sum: 0, n: 0 };
    c.sum += s.record.weightedScore;
    c.n += 1;
    m.set(lv, c);
  }
  return [...m.entries()]
    .map(([level, { sum, n }]) => ({ level, mean: Math.round((sum / n) * 100) / 100, n }))
    .sort((a, b) => a.level - b.level);
};

// 검토 권장 점수 — 표본 충분 그룹 중 편향(|레벨평균대비|)·쏠림(낮은 변별력·최빈 집중)이 클수록 높음.
export const reviewPriority = (p: ScatterPoint): number => {
  if (p.isSmall) return -1;
  const biasPart = Math.abs(p.bias);
  const lowVarPart = p.stdDev == null ? 0 : Math.max(0, 0.7 - p.stdDev);
  const concentration = Math.max(0, p.modeShare - 0.6); // 60%↑ 한 버킷 쏠림 가중
  return biasPart + lowVarPart * 1.5 + concentration * 1.5;
};
