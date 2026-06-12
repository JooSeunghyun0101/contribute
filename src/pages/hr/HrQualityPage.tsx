import { useMemo, useState, type ReactNode } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationPeriodSelector } from '@/components/Layout/EvaluationPeriodSelector';
import { IconSearch, Pill, type PillTone } from '@/components/brand';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCompanyDashboardRecords, usePriorYearRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useReason } from '@/components/ui/confirm-dialog';
import { evaluationService } from '@/lib/services';
import OrgChecklist from '@/components/hr/OrgChecklist';
import { getOrgValue, matchesOrgNodes } from '@/lib/orgHierarchy';
import { getScoreGapBucket, formatScore, type ScoreGapBucket } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

// ────────────────────────────────────────────────────────────────────────────
// 평가 품질 점검 (횡단) — F-C2a 스코프: 변별력·분포 건전성 + 무결성만.
//
// [설계원칙 §2.1 — 절대 위반 금지]
//  1) 판정이 아니라 맥락. 시스템은 "후하다/이상이다"라고 단정하지 않는다.
//     모든 통계는 "~정황" 칩, 종착점은 evaluationService.requestReturn(origin:'hr')
//     (상태 무변경·알림만)이다. 단정 카피 금지.
//  2) HR 전용. 라우트는 ProtectedRoute allowedRoles=['hr'] 로 차단.
//  3) 인원·구성 항상 병기. SD/평균갭은 표본 n·갭 버킷 구성 칩과 한 묶음으로만 노출.
//  4) 소표본 회색. 완료 n<5 평가자 행은 회색·"표본 부족"·통계 "―"·정렬/비교 제외.
//  5) 색은 중립. 위험 단정색(빨강) 금지. var(--danger) 는 무결성 오류(가중치≠100)에만 절제.
//
// [요청 폭주 방지] useCompanyDashboardRecords() 1훅만 사용. 평가자 1인씩 추가 조회 없음.
//   그룹핑·무결성·드릴다운 모두 이미 로드된 record / record.tasks(Task)만으로 판정.
//
// [P1] 무결성 '전원 동일 점수'·'의견 미작성'은 record.tasks[].score / .feedback
//   (Task 테이블, types/index.ts:188-189)만 사용한다. TaskEvaluationEntry 는
//   company 훅이 로드하지 않으므로 entry.* 참조 금지.
//
// [P2] getEvaluationByEmployeeId 는 피평가자당 단일 evaluation 만 반환한다.
//   발령(다중 평가자) 피평가자는 "현재 평가자" 갭만 집계된다 — 이상이 아니다.
//   상단 caveat 로 명시하고 절대 이상 플래그하지 않는다(메모리: 다중 평가자=정상).
//
// [종단 보조 패널 — F-C2b] 화면 하단(변별력 ↔ 무결성 사이)에 종단 4신호를 보조로 덧붙인다.
//   전보 코호트·전년 드리프트·코호트-잔차·기질 vs 급변. 모두 §2.1 원칙을 그대로 따른다:
//   판정 아님('~정황/참고' 톤)·인원 병기·소표본 회색·중립색·종착은 기존 requestReturn 단일.
//
//   [무폭주 — 정확한 정의] 2025·2026 두 기간을 각각 '한 번의 회사 단위 배치'로만 로드한다.
//     - 2026(또는 선택 기간): useCompanyDashboardRecords() 1훅
//     - 2025(직전연도): usePriorYearRecords(priorEmployees, priorPeriodId) 1훅
//     ⚠ 각 훅 내부의 loadEmployeeEvaluationRecords 는 직원당 getEvaluationByEmployeeId 를 1회씩
//       동시성 6 배치(mapWithConcurrency)로 호출한다. 즉 '1인씩 순차 폭주'가 아니라
//       '양 기간 각 1배치'다(커밋 8fc884c 준수). 종단은 횡단(F-C2a)이 이미 지불하는 비용에
//       prior-year 배치 1패스만 더한다. getEvaluatorAssignmentHistory 등 1인씩 조회는 0건.
//     코호트 식별·전환 판정·잔차·드리프트는 모두 이미 로드된 records/priorRecords 의
//       메모리 내 join + useMemo 파생으로 완결한다. 추가 lazy 조회 없음.
//
//   [P3 — by-employee LIMIT 1 한계] 서버 by-employee 엔드포인트는 기간당 evaluation 을
//     '현재/최신 평가자' 우선 ORDER BY + LIMIT 1 로 단 1건만 반환한다(server.js). 따라서
//     한 기간 안에서 평가자가 A→B 로 바뀐(기내 전보) 피평가자는 그 기간 record 가
//     '대표 평가자 1인'으로만 잡힌다. 전보 코호트의 '2025 평가자'가 gap2025 를 실제로
//     형성한 평가자와 다를 수 있다 — 이는 '이상'이 아니라 '평가자 효과 근사의 한계'이며
//     caveat 로 명시한다. 절대 개인 단위로 플래그/삭제/취소하지 않는다(메모리: 다중 평가자=정상).
// ────────────────────────────────────────────────────────────────────────────

const MIN_SAMPLE = 5; // 소표본 임계값. n<5 평가자는 통계 회색 처리.

// 분포 신호 임계값 — 실데이터(평가기간 1개·비교 데이터 부재) 보정 전까지 휴리스틱.
// 모든 신호는 '정황' 톤으로만 표시하고 단정 카피를 쓰지 않는다.
const SD_FLAT_THRESHOLD = 0.3; // SD ≈ 0 (평행이동 정황 판단)
const MODE_CONCENTRATION = 0.8; // 최빈 버킷 80% 이상 (갭 집중 정황)
const MODE_FLAT_RATIO = 0.9; // 최빈 버킷 90% 이상 (평행이동 정황 보조)

type GapBucketCounts = Record<ScoreGapBucket, number>;

const BUCKET_ORDER: ScoreGapBucket[] = ['exceed', 'meet', 'near', 'below'];
const BUCKET_LABEL: Record<ScoreGapBucket, string> = {
  exceed: '초과',
  meet: '충족',
  near: '근접',
  below: '미달',
};

// 완료 피평가자 1명 = 1 유효표본. 갭 산출에 쓸 record 검증.
// (AiReviewMonitoring.tsx:192-196 일치) score>0 && Number.isFinite(growthLevel) && growthLevel>0.
type ValidSample = {
  record: EmployeeEvaluationRecord;
  gap: number; // Math.round(flooredScore) - Math.round(growthLevel)
  bucket: ScoreGapBucket;
};

const toNum = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

// 완료 판정 — task 점수 충족 기준으로 일관 적용(evaluation_status 와 별개).
// totalTasks>0 && completedTasks===totalTasks (dashboardData.ts status='completed' 와 동일).
const isCompletedRecord = (r: EmployeeEvaluationRecord): boolean =>
  r.totalTasks > 0 && r.completedTasks === r.totalTasks;

// 유효표본(갭 산출 가능) 여부.
const toValidSample = (r: EmployeeEvaluationRecord): ValidSample | null => {
  if (!isCompletedRecord(r)) return null;
  const score = r.flooredScore;
  const growth = toNum(r.employee.growth_level);
  if (!(score > 0) || !Number.isFinite(growth) || !(growth > 0)) return null;
  const gap = Math.round(score) - Math.round(growth);
  return { record: r, gap, bucket: getScoreGapBucket(score, growth) };
};

// 평가자 파생 키 — evaluation.evaluator_id 우선, 폴백 evaluator_name / employee.evaluator_id.
// (HrMatchingPage 패턴) 추가 조회 없이 메모리 내 groupBy.
const evaluatorKeyOf = (r: EmployeeEvaluationRecord): string => {
  const id = r.evaluation?.evaluator_id?.trim();
  if (id) return id;
  const name = r.evaluation?.evaluator_name?.trim();
  if (name) return `name:${name}`;
  const masterId = r.employee.evaluator_id?.trim();
  if (masterId) return masterId;
  return '__unassigned__';
};

const evaluatorNameOf = (r: EmployeeEvaluationRecord): string =>
  r.evaluation?.evaluator_name?.trim() ||
  r.employee.evaluator_id?.trim() ||
  '(평가자 미상)';

const emptyBuckets = (): GapBucketCounts => ({ exceed: 0, meet: 0, near: 0, below: 0 });

// 표본표준편차(베셀 보정, n-1). n<2 → null(정의 불가).
const sampleStdDev = (gaps: number[]): number | null => {
  const n = gaps.length;
  if (n < 2) return null;
  const mean = gaps.reduce((s, g) => s + g, 0) / n;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
};

const mean = (gaps: number[]): number =>
  gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;

type DistributionSignal = {
  key: 'down-discrimination' | 'gap-concentration' | 'parallel-shift';
  label: string;
};

// 분포 건전성 신호(모두 '정황' 톤, n>=MIN_SAMPLE 에서만 산출).
const distributionSignals = (samples: ValidSample[], buckets: GapBucketCounts): DistributionSignal[] => {
  const n = samples.length;
  if (n < MIN_SAMPLE) return [];
  const signals: DistributionSignal[] = [];
  const gaps = samples.map((s) => s.gap);
  const avg = mean(gaps);
  const sd = sampleStdDev(gaps) ?? 0;
  const maxBucket = Math.max(...BUCKET_ORDER.map((b) => buckets[b]));
  const modeRatio = n > 0 ? maxBucket / n : 0;

  // ① 미달 0건 & 평균갭>=0 → 하향 변별 부재 정황
  if (buckets.below === 0 && avg >= 0) {
    signals.push({ key: 'down-discrimination', label: '하향 변별 부재 정황' });
  }
  // ② 최빈 버킷 >=80% → 갭 집중 정황
  if (modeRatio >= MODE_CONCENTRATION) {
    signals.push({ key: 'gap-concentration', label: '갭 집중 정황' });
  }
  // ③ SD≈0 & 갭 최빈≈100% → 성장레벨 평행이동 정황(점수≈성장레벨+c)
  if (sd < SD_FLAT_THRESHOLD && modeRatio >= MODE_FLAT_RATIO) {
    signals.push({ key: 'parallel-shift', label: '평행이동 정황' });
  }
  return signals;
};

// ── 무결성 4종 (이미 로드된 record/record.tasks 만으로 판정) ─────────────────

type IntegrityKey =
  | 'no-evaluation' // (a) 빈 평가/미배정
  | 'all-same-score' // (b) 전원 동일 점수
  | 'weight-mismatch' // (c) 가중치 합 ≠ 100
  | 'missing-feedback'; // (d) 완료 task 의견 미작성

type IntegrityDef = {
  key: IntegrityKey;
  name: string;
  /** 가중치≠100 만 danger(절제), 나머지는 중립/경고 톤. */
  tone: PillTone;
  description: string;
};

const INTEGRITY_DEFS: IntegrityDef[] = [
  {
    key: 'no-evaluation',
    name: '빈 평가 · 평가자 미배정',
    tone: 'warning',
    description:
      '선택 기간에 평가 레코드가 없거나(record.evaluation=null) 직원 마스터 평가자(employee.evaluator_id)가 비어 있는 행입니다. ' +
      '평가자 배정 자체는 "매칭 정합성 점검"에서 다루며, 여기서는 점수 분포 산출이 불가능한 행으로만 표시합니다.',
  },
  {
    key: 'all-same-score',
    name: '전원 동일 점수',
    tone: 'neutral',
    description:
      '과업이 2개 이상이고 점수가 매겨진 과업의 점수(Task.score)가 모두 같은 행입니다. 일괄 입력일 수도, 실제로 균질한 평가일 수도 있어 정황으로만 표시합니다.',
  },
  {
    key: 'weight-mismatch',
    name: '가중치 합 ≠ 100',
    tone: 'danger',
    description:
      '과업 가중치 합(record.totalWeight)이 정확히 100% 가 아닌 행입니다. 점수 집계에 직접 영향을 주는 입력 오류일 수 있어 무결성 오류로 표시합니다.',
  },
  {
    key: 'missing-feedback',
    name: '의견 미작성 (완료 과업)',
    tone: 'warning',
    description:
      '점수는 매겼으나 평가의견(Task.feedback)이 비어 있는 완료 과업이 있는 행입니다. 평가자별 미작성 과업 수를 함께 표기합니다.',
  },
];

type IntegrityFlags = {
  record: EmployeeEvaluationRecord;
  keys: Set<IntegrityKey>;
  /** 의견 미작성 과업 수 / 완료(점수 있는) 과업 수 */
  missingFeedback: { missing: number; scored: number };
};

// 한 record 의 무결성 4종 판정 — record.tasks(Task) 만 사용, entry.* 미참조.
const integrityOf = (r: EmployeeEvaluationRecord): IntegrityFlags => {
  const keys = new Set<IntegrityKey>();

  // (a) 빈 평가/미배정.
  const masterEvaluator = r.employee.evaluator_id?.trim();
  if (r.evaluation == null || !masterEvaluator) {
    keys.add('no-evaluation');
  }

  // (b) 전원 동일 점수 — 점수 있는 task(>=2개)가 모두 동일.
  const scored = r.tasks.filter((t) => t.score !== null && t.score !== undefined);
  if (scored.length >= 2) {
    const uniqueScores = new Set(scored.map((t) => Number(t.score)));
    if (uniqueScores.size === 1) keys.add('all-same-score');
  }

  // (c) 가중치 합 ≠ 100 (과업이 있는 경우만).
  // 부동소수 오차(33.33×3=99.99…)는 무결성 오탐이 아니므로 epsilon 허용 — 실제 위반은 보통 정수 단위로 어긋남.
  if (r.totalTasks > 0 && Math.abs(r.totalWeight - 100) > 0.5) {
    keys.add('weight-mismatch');
  }

  // (d) 의견 미작성 — 점수 있는 task 인데 feedback 공백.
  const missingFeedbackCount = scored.filter((t) => !(t.feedback ?? '').trim()).length;
  if (missingFeedbackCount > 0) {
    keys.add('missing-feedback');
  }

  return {
    record: r,
    keys,
    missingFeedback: { missing: missingFeedbackCount, scored: scored.length },
  };
};

// ── 평가자 집계 행 ───────────────────────────────────────────────────────────

type EvaluatorRow = {
  key: string;
  name: string;
  org: string;
  samples: ValidSample[]; // 완료·유효 표본
  buckets: GapBucketCounts;
  n: number; // 완료 표본 수
  assignedCount: number; // 배정(필터된) 전체 피평가자 수
  completedCount: number; // 완료 수 (완료율 계산용)
  meanGap: number | null;
  variance: number | null;
  sd: number | null;
  signals: DistributionSignal[];
  isSmall: boolean; // n<MIN_SAMPLE
};

type SortKey = 'sample' | 'sd' | 'absMeanGap';

const buildEvaluatorRows = (records: EmployeeEvaluationRecord[]): EvaluatorRow[] => {
  const byKey = new Map<string, EmployeeEvaluationRecord[]>();
  for (const r of records) {
    const key = evaluatorKeyOf(r);
    const arr = byKey.get(key);
    if (arr) arr.push(r);
    else byKey.set(key, [r]);
  }

  const rows: EvaluatorRow[] = [];
  for (const [key, group] of byKey) {
    if (key === '__unassigned__') continue; // 미배정 묶음은 변별력 행에서 제외(무결성에서 다룸).
    const samples: ValidSample[] = [];
    let completedCount = 0;
    for (const r of group) {
      if (isCompletedRecord(r)) completedCount += 1;
      const s = toValidSample(r);
      if (s) samples.push(s);
    }
    const buckets = emptyBuckets();
    for (const s of samples) buckets[s.bucket] += 1;
    const gaps = samples.map((s) => s.gap);
    const n = samples.length;
    const isSmall = n < MIN_SAMPLE;
    const sd = sampleStdDev(gaps);
    rows.push({
      key,
      name: evaluatorNameOf(group[0]),
      org: orgLabelOf(group[0]),
      samples,
      buckets,
      n,
      assignedCount: group.length,
      completedCount,
      meanGap: n > 0 ? mean(gaps) : null,
      variance: sd != null ? sd * sd : null,
      sd,
      signals: distributionSignals(samples, buckets),
      isSmall,
    });
  }
  return rows;
};

const orgLabelOf = (r: EmployeeEvaluationRecord): string => {
  const parts = [
    getOrgValue(r.employee, 'division'),
    getOrgValue(r.employee, 'department'),
    getOrgValue(r.employee, 'team'),
  ].filter(Boolean);
  return parts.join(' › ') || r.employee.department || '-';
};

const formatGap = (gap: number): string => (gap > 0 ? `+${gap}` : String(gap));
const formatMean = (m: number): string => (m > 0 ? `+${m.toFixed(2)}` : m.toFixed(2));
const formatDelta = (d: number): string => (d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2));

// ════════════════════════════════════════════════════════════════════════════
// 종단 보조 패널 (F-C2b) — 2025(직전연도) vs 2026(선택 기간) 두 기간 비교.
//
// [핵심 원칙 — 횡단과 동일하게 §2.1 엄수]
//  · 어떤 신호도 '판정'이 아니다. Δ·잔차·드리프트·'급변'은 모두 '정황/참고'이며
//    tone='neutral' 고정, 위험색(var(--danger))은 무결성 전용으로 남긴다.
//  · 양 기간 중 하나라도 완료 표본 n<MIN_SAMPLE 이면 회색·'표본 부족'·통계 '―'.
//  · 인원·구성을 항상 병기한다(Δ·잔차 옆 n명, 가능하면 갭 버킷).
//  · 종착점은 신설 액션 없이 기존 DrilldownPanel→requestReturn 하나로만 수렴.
//
// [임계 상수 — 휴리스틱] 드리프트 안정/급변 경계는 실데이터(평가기간 다년치) 보정
//   전까지 SD_FLAT_THRESHOLD 와 같은 잠정 휴리스틱이다. 단정 카피 금지.
// ════════════════════════════════════════════════════════════════════════════

const DRIFT_STABLE = 0.3; // |Δ평균갭| 이 이 값 이하 → '기질(안정)' 정황
const DRIFT_SHOCK = 0.6; // |Δ평균갭| 이 이 값 이상 → '급변' 정황(상단 우선 배치 대상)

// 같은 평가자를 양 기간에서 잇는 키. evaluatorKeyOf 재사용.
// 피평가자를 양 기간에서 잇는 키는 employee.employee_id (문자열 고유키).

type CohortStats = {
  /** 완료·유효 표본의 평균갭. null = 표본 0 */
  meanGap: number | null;
  /** 완료 표본 수 */
  n: number;
  buckets: GapBucketCounts;
};

const cohortStatsOf = (samples: ValidSample[]): CohortStats => {
  const buckets = emptyBuckets();
  for (const s of samples) buckets[s.bucket] += 1;
  const gaps = samples.map((s) => s.gap);
  return { meanGap: gaps.length ? mean(gaps) : null, n: gaps.length, buckets };
};

// 한 기간 records → employee_id 별 ValidSample 1건(완료·유효만). 미완료/무효는 제외.
const sampleByEmployee = (records: EmployeeEvaluationRecord[]): Map<string, ValidSample> => {
  const map = new Map<string, ValidSample>();
  for (const r of records) {
    const s = toValidSample(r);
    if (s) map.set(r.employee.employee_id, s);
  }
  return map;
};

// ── (1) 전보 코호트 — 2025 평가자 A → 2026 평가자 B 로 옮긴 피평가자들의 갭 이동 ──
//   본인 성장·직무변화 노이즈가 섞이므로 **개인이 아니라 코호트 단위**로만 본다.
//   A 기준(2025) 평균갭 vs B 기준(2026) 평균갭의 차이 Δ를 '평가자 효과 근사'로 제시.
//   ⚠ by-employee LIMIT 1 한계(P3)로 양 기간 각 1건의 대표 평가만 비교한다.

type TransferCohortRow = {
  key: string; // `${prevEvaluatorKey}→${nextEvaluatorKey}`
  prevName: string;
  nextName: string;
  members: string[]; // employee_id 목록
  prior: CohortStats; // 2025 (A 평가자 기준)
  current: CohortStats; // 2026 (B 평가자 기준)
  /** current.meanGap - prior.meanGap. 양쪽 표본 있을 때만 */
  delta: number | null;
  isSmall: boolean; // 양 기간 중 하나라도 n<MIN_SAMPLE
};

const buildTransferCohorts = (
  currentSamples: Map<string, ValidSample>,
  priorSamples: Map<string, ValidSample>,
  priorRecordByEmp: Map<string, EmployeeEvaluationRecord>,
  currentRecordByEmp: Map<string, EmployeeEvaluationRecord>,
): TransferCohortRow[] => {
  // (A→B) 묶음별로 양 기간 표본을 적재.
  const groups = new Map<
    string,
    { prevKey: string; nextKey: string; prevName: string; nextName: string; members: Set<string>; prior: ValidSample[]; current: ValidSample[] }
  >();

  // 양 기간 모두에 record 가 존재하는 피평가자만 전환 후보(평가자 비교 가능).
  for (const [empId, currentRecord] of currentRecordByEmp) {
    const priorRecord = priorRecordByEmp.get(empId);
    if (!priorRecord) continue;
    const prevKey = evaluatorKeyOf(priorRecord);
    const nextKey = evaluatorKeyOf(currentRecord);
    if (prevKey === '__unassigned__' || nextKey === '__unassigned__') continue;
    if (prevKey === nextKey) continue; // 전보 아님(같은 평가자)
    const groupKey = `${prevKey}→${nextKey}`;
    let g = groups.get(groupKey);
    if (!g) {
      g = {
        prevKey,
        nextKey,
        prevName: evaluatorNameOf(priorRecord),
        nextName: evaluatorNameOf(currentRecord),
        members: new Set(),
        prior: [],
        current: [],
      };
      groups.set(groupKey, g);
    }
    g.members.add(empId);
    const cs = currentSamples.get(empId);
    const ps = priorSamples.get(empId);
    if (cs) g.current.push(cs);
    if (ps) g.prior.push(ps);
  }

  const rows: TransferCohortRow[] = [];
  for (const [groupKey, g] of groups) {
    const prior = cohortStatsOf(g.prior);
    const current = cohortStatsOf(g.current);
    const isSmall = prior.n < MIN_SAMPLE || current.n < MIN_SAMPLE;
    const delta =
      prior.meanGap != null && current.meanGap != null ? current.meanGap - prior.meanGap : null;
    rows.push({
      key: groupKey,
      prevName: g.prevName,
      nextName: g.nextName,
      members: [...g.members],
      prior,
      current,
      delta,
      isSmall,
    });
  }
  // 표본 충분한 코호트 우선, 그 안에서 |Δ| 큰 순.
  return rows.sort((a, b) => {
    if (a.isSmall !== b.isSmall) return a.isSmall ? 1 : -1;
    return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
  });
};

// ── (2) 전년 드리프트 — 같은 평가자의 2025 평균갭 vs 2026 평균갭 변화(관대도 이동) ──
//   같은 evaluatorKey 의 양 기간 교집합. Δ는 중립색, 완료율 병기. driftDelta 는 신호4 입력으로 재사용.

type DriftRow = {
  key: string; // evaluatorKey
  name: string;
  org: string;
  prior: CohortStats; // 2025
  current: CohortStats; // 2026
  delta: number | null; // current - prior
  isSmall: boolean;
};

const buildDriftRows = (
  currentRows: EvaluatorRow[],
  priorSamplesByEvaluator: Map<string, ValidSample[]>,
  priorNameByEvaluator: Map<string, string>,
): DriftRow[] => {
  const rows: DriftRow[] = [];
  for (const cur of currentRows) {
    const priorSamplesArr = priorSamplesByEvaluator.get(cur.key);
    if (!priorSamplesArr) continue; // 양 기간 교집합만(같은 평가자가 작년에도 있어야)
    const prior = cohortStatsOf(priorSamplesArr);
    const current: CohortStats = { meanGap: cur.meanGap, n: cur.n, buckets: cur.buckets };
    const isSmall = prior.n < MIN_SAMPLE || current.n < MIN_SAMPLE;
    const delta =
      prior.meanGap != null && current.meanGap != null ? current.meanGap - prior.meanGap : null;
    rows.push({
      key: cur.key,
      name: cur.name || priorNameByEvaluator.get(cur.key) || cur.key,
      org: cur.org,
      prior,
      current,
      delta,
      isSmall,
    });
  }
  return rows.sort((a, b) => {
    if (a.isSmall !== b.isSmall) return a.isSmall ? 1 : -1;
    return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
  });
};

// ── (3) 코호트-잔차 — 기대값=전사 동일 `${growth_level}|${job_role}` 평균갭, 실제−기대 잔차 ──
//   **대화용 맥락 only. 잔차로 절대 줄세우거나 플래그하지 않는다(§2.1 판정금지 직접 위반).**
//   그룹 n<MIN_SAMPLE 인 기대값은 'expectation-thin' 으로 제외(부정확한 기대값 차단).
//   2026 단일 기준 우선(현재 기간), 2025 는 보조.

const EXPECTATION_GROUP_MIN = MIN_SAMPLE; // 기대값 그룹 표본 하한.

const expectationKeyOf = (r: EmployeeEvaluationRecord): string => {
  const growth = toNum(r.employee.growth_level);
  const level = Number.isFinite(growth) && growth > 0 ? String(Math.round(growth)) : '?';
  const role = r.employee.job_role?.trim() || '(직종 미상)';
  return `${level}|${role}`;
};

type ExpectationTable = {
  /** 기대값 그룹키 → { 평균갭, n }. n<EXPECTATION_GROUP_MIN 그룹은 thin 으로 제외됨 */
  byGroup: Map<string, { meanGap: number; n: number }>;
};

const buildExpectationTable = (records: EmployeeEvaluationRecord[]): ExpectationTable => {
  const acc = new Map<string, number[]>();
  for (const r of records) {
    const s = toValidSample(r);
    if (!s) continue;
    const k = expectationKeyOf(r);
    const arr = acc.get(k);
    if (arr) arr.push(s.gap);
    else acc.set(k, [s.gap]);
  }
  const byGroup = new Map<string, { meanGap: number; n: number }>();
  for (const [k, gaps] of acc) {
    if (gaps.length < EXPECTATION_GROUP_MIN) continue; // expectation-thin 제외
    byGroup.set(k, { meanGap: mean(gaps), n: gaps.length });
  }
  return { byGroup };
};

type ResidualRow = {
  key: string; // evaluatorKey
  name: string;
  org: string;
  /** 평균 잔차(실제갭 − 기대갭). 기대값 있는 표본만 평균. null=계산 불가 */
  meanResidual: number | null;
  /** 잔차 계산에 쓰인 표본 수(기대값 있는 표본만) */
  scoredN: number;
  /** 평가자의 전체 완료 표본 수 */
  totalN: number;
  isSmall: boolean;
};

const buildResidualRows = (
  currentRows: EvaluatorRow[],
  expectation: ExpectationTable,
): ResidualRow[] => {
  const rows: ResidualRow[] = [];
  for (const row of currentRows) {
    const residuals: number[] = [];
    for (const s of row.samples) {
      const k = expectationKeyOf(s.record);
      const exp = expectation.byGroup.get(k);
      if (!exp) continue; // expectation-thin 표본은 잔차 산출 제외
      residuals.push(s.gap - exp.meanGap);
    }
    const isSmall = row.n < MIN_SAMPLE;
    rows.push({
      key: row.key,
      name: row.name,
      org: row.org,
      meanResidual: residuals.length ? mean(residuals) : null,
      scoredN: residuals.length,
      totalN: row.n,
      isSmall,
    });
  }
  // 표본순(정렬은 표본 충분/부족만 가른다). **잔차로 정렬하지 않는다**(판정 금지).
  return rows.sort((a, b) => {
    if (a.isSmall !== b.isSmall) return a.isSmall ? 1 : -1;
    return b.totalN - a.totalN;
  });
};

// ── (4) 기질 vs 급변 — 드리프트 |Δ| 로 평가자를 분류, '급변' 후보를 상단 우선 배치 ──
//   양 기간 n>=MIN_SAMPLE 만 판정 대상, 한쪽 소표본='판정 보류'(회색).
//   '급변'은 actionable 후보일 뿐 이상 판정이 아니다 → 칩은 중립색(주황 accent 금지).

type TemperamentClass = 'stable' | 'drifting' | 'shock' | 'hold';

const classifyDrift = (row: DriftRow): TemperamentClass => {
  if (row.isSmall || row.delta == null) return 'hold';
  const abs = Math.abs(row.delta);
  if (abs >= DRIFT_SHOCK) return 'shock';
  if (abs <= DRIFT_STABLE) return 'stable';
  return 'drifting';
};

const TEMPERAMENT_LABEL: Record<TemperamentClass, string> = {
  stable: '기질(안정)',
  drifting: '소폭 변동',
  shock: '급변(우선 검토 후보)',
  hold: '판정 보류',
};

// 급변 > 소폭 변동 > 안정 > 보류 순으로 상단 우선(급변이 actionable 이라 맨 위).
const TEMPERAMENT_RANK: Record<TemperamentClass, number> = {
  shock: 0,
  drifting: 1,
  stable: 2,
  hold: 3,
};

type LongitudinalTab = 'temperament' | 'transfer' | 'drift' | 'residual';

// ── 페이지 ───────────────────────────────────────────────────────────────────

type TabKey = 'evaluator' | 'org';

const HrQualityPage = () => {
  const { records, isLoading, error } = useCompanyDashboardRecords();
  const { selectedPeriod, periods } = useEvaluationPeriod();

  const [tab, setTab] = useState<TabKey>('evaluator');
  const [searchQuery, setSearchQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('sample');
  const [hideSmall, setHideSmall] = useState(false);
  const [drilldown, setDrilldown] = useState<EvaluatorRow | null>(null);
  // 종단 보조 패널 — 기본 탭은 '기질 vs 급변'(급변 후보 상단 우선이 가장 actionable).
  const [longTab, setLongTab] = useState<LongitudinalTab>('temperament');

  // 점검 대상: 평가 대상자(evaluatee) 롤 + org 필터.
  const targetRecords = useMemo(
    () =>
      records.filter(
        (r) => r.employee.available_roles?.includes('evaluatee') && matchesOrgNodes(r.employee, orgFilter),
      ),
    [records, orgFilter],
  );

  const evaluatorRows = useMemo(() => buildEvaluatorRows(targetRecords), [targetRecords]);

  // 검색 + 정렬 적용. 소표본 행은 항상 아래로, 통계 정렬에서 제외.
  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = evaluatorRows.filter((row) => {
      if (hideSmall && row.isSmall) return false;
      if (!q) return true;
      return [row.name, row.org, row.key].join(' ').toLowerCase().includes(q);
    });

    rows = [...rows].sort((a, b) => {
      // 소표본은 항상 하단.
      if (a.isSmall !== b.isSmall) return a.isSmall ? 1 : -1;
      if (a.isSmall && b.isSmall) return b.n - a.n;
      if (sortKey === 'sample') return b.n - a.n;
      if (sortKey === 'sd') {
        const av = a.sd ?? Number.POSITIVE_INFINITY;
        const bv = b.sd ?? Number.POSITIVE_INFINITY;
        return av - bv; // SD 낮은 순(변별 약한 정황 상단)
      }
      // |평균갭| 큰 순
      const am = Math.abs(a.meanGap ?? 0);
      const bm = Math.abs(b.meanGap ?? 0);
      return bm - am;
    });
    return rows;
  }, [evaluatorRows, searchQuery, hideSmall, sortKey]);

  // 무결성 — record.tasks(Task)만으로 판정.
  const integrityRows = useMemo(
    () => targetRecords.map(integrityOf).filter((f) => f.keys.size > 0),
    [targetRecords],
  );
  const integrityCounts = useMemo(() => {
    const counts = new Map<IntegrityKey, number>();
    for (const def of INTEGRITY_DEFS) counts.set(def.key, 0);
    for (const f of integrityRows) {
      for (const k of f.keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [integrityRows]);

  // 완료율(전체) 병기용.
  const completion = useMemo(() => {
    const total = targetRecords.length;
    const completed = targetRecords.filter(isCompletedRecord).length;
    return { total, completed, rate: total ? Math.round((completed / total) * 100) : 0 };
  }, [targetRecords]);

  // 조직 집계 탭 표시 여부 — org 데이터가 전부 비면 자동 숨김(OrgFilterBar 준용).
  const hasOrgData = useMemo(
    () =>
      targetRecords.some(
        (r) => getOrgValue(r.employee, 'division') || getOrgValue(r.employee, 'department'),
      ),
    [targetRecords],
  );

  // ── 종단 보조 패널 데이터 (F-C2b) ──────────────────────────────────────────
  // 직전연도(선택 기간의 evaluation_year − 1) 기간을 양 기간 일괄 로드(무폭주, hr/Home.tsx 패턴).
  const priorYear = selectedPeriod?.evaluation_year != null ? selectedPeriod.evaluation_year - 1 : null;
  const priorPeriodId = useMemo(
    () => (priorYear == null ? null : periods.find((p) => p.evaluation_year === priorYear)?.id ?? null),
    [periods, priorYear],
  );
  // 현재 기간 점검 대상 직원들의 직전연도 평가만 1배치로 로드(추가 1인 조회 없음).
  const priorEmployees = useMemo(() => records.map((r) => r.employee), [records]);
  const priorRecords = usePriorYearRecords(priorEmployees, priorPeriodId, null, true);

  // 직전연도도 동일 evaluatee 롤 + 같은 org 필터를 적용해 비교 모집단을 맞춘다.
  const priorTargetRecords = useMemo(
    () =>
      priorRecords.filter(
        (r) => r.employee.available_roles?.includes('evaluatee') && matchesOrgNodes(r.employee, orgFilter),
      ),
    [priorRecords, orgFilter],
  );

  // 패널 표시 여부 — 직전 기간이 없거나(현 환경: 평가기간 1개) 직전 표본 0건이면 전체 숨김.
  const showLongitudinal = priorPeriodId != null && priorTargetRecords.length > 0;

  const longitudinal = useMemo(() => {
    if (!showLongitudinal) return null;

    const currentByEmp = sampleByEmployee(targetRecords);
    const priorByEmp = sampleByEmployee(priorTargetRecords);
    const currentRecordByEmp = new Map(targetRecords.map((r) => [r.employee.employee_id, r] as const));
    const priorRecordByEmp = new Map(priorTargetRecords.map((r) => [r.employee.employee_id, r] as const));

    // (1) 전보 코호트.
    const transfer = buildTransferCohorts(currentByEmp, priorByEmp, priorRecordByEmp, currentRecordByEmp);

    // (2) 전년 드리프트 — 직전연도 평가자별 ValidSample 묶음을 만들어 같은 평가자 교집합 비교.
    const priorSamplesByEvaluator = new Map<string, ValidSample[]>();
    const priorNameByEvaluator = new Map<string, string>();
    for (const r of priorTargetRecords) {
      const key = evaluatorKeyOf(r);
      if (key === '__unassigned__') continue;
      const s = toValidSample(r);
      if (!priorNameByEvaluator.has(key)) priorNameByEvaluator.set(key, evaluatorNameOf(r));
      if (!s) continue;
      const arr = priorSamplesByEvaluator.get(key);
      if (arr) arr.push(s);
      else priorSamplesByEvaluator.set(key, [s]);
    }
    const drift = buildDriftRows(evaluatorRows, priorSamplesByEvaluator, priorNameByEvaluator);

    // (3) 코호트-잔차 — 2026(현재 기간) 단일 기준 기대값 테이블로 평가자별 평균잔차(대화용 only).
    const expectation = buildExpectationTable(targetRecords);
    const residual = buildResidualRows(evaluatorRows, expectation);
    const expectationGroupCount = expectation.byGroup.size;

    // (4) 기질 vs 급변 — 드리프트를 분류해 급변 후보를 상단 우선 배치.
    const temperament = [...drift]
      .map((row) => ({ row, cls: classifyDrift(row) }))
      .sort((a, b) => {
        const rd = TEMPERAMENT_RANK[a.cls] - TEMPERAMENT_RANK[b.cls];
        if (rd !== 0) return rd;
        return Math.abs(b.row.delta ?? 0) - Math.abs(a.row.delta ?? 0);
      });

    return { transfer, drift, residual, temperament, expectationGroupCount };
  }, [showLongitudinal, targetRecords, priorTargetRecords, evaluatorRows]);

  const priorPeriodLabel = useMemo(() => {
    if (priorPeriodId == null) return null;
    const p = periods.find((period) => period.id === priorPeriodId);
    return p ? `${p.name} · ${p.evaluation_year}` : (priorYear != null ? `${priorYear}` : null);
  }, [periods, priorPeriodId, priorYear]);

  const periodLabel = selectedPeriod
    ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}`
    : '평가기간 미선택';

  const effectiveTab: TabKey = tab === 'org' && !hasOrgData ? 'evaluator' : tab;

  return (
    <>
      <PageHeader
        title="평가 품질 점검"
        subtitle="평가자별 점수–성장레벨 갭의 변별력·분포와 입력 무결성을 읽기 전용으로 점검합니다. 통계는 판정이 아닌 검토 정황이며, 종착점은 평가자 재검토 요청입니다."
        actions={<Pill tone="neutral">{periodLabel}</Pill>}
        filters={
          <>
            <EvaluationPeriodSelector />
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
              <span
                style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-subtle)', pointerEvents: 'none' }}
              >
                <IconSearch width={16} height={16} />
              </span>
              <input
                className="sd-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="평가자·소속 검색"
                style={{ paddingLeft: 36, width: '100%' }}
              />
            </div>
            <OrgChecklist
              items={targetRecords.map((r) => r.employee)}
              value={orgFilter}
              onChange={setOrgFilter}
            />
            <div style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              완료 {completion.completed}/{completion.total}명 · 완료율{' '}
              <b className="tnum" style={{ color: 'var(--fg)' }}>
                {completion.rate}%
              </b>
            </div>
          </>
        }
      />

      <div className="flex flex-col gap-6" style={{ padding: '24px 32px 32px' }}>
        <CaveatBar />

        {isLoading ? (
          <div className="sd-card">평가 데이터를 불러오는 중입니다.</div>
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <>
            {/* 변별력 × 분포 (주력) */}
            <section className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>
                    변별력 · 분포 건전성
                  </h2>
                  {hasOrgData && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        padding: 3,
                        borderRadius: 8,
                        background: 'var(--bg-muted)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <TabButton active={effectiveTab === 'evaluator'} onClick={() => setTab('evaluator')}>
                        평가자별
                      </TabButton>
                      <TabButton active={effectiveTab === 'org'} onClick={() => setTab('org')}>
                        조직별
                      </TabButton>
                    </div>
                  )}
                </div>

                {effectiveTab === 'evaluator' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <SortToggle
                      value={sortKey}
                      onChange={setSortKey}
                      options={[
                        { key: 'sample', label: '표본순' },
                        { key: 'sd', label: 'SD 낮은순' },
                        { key: 'absMeanGap', label: '|평균갭| 큰순' },
                      ]}
                    />
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 'var(--fs-sm)',
                        color: 'var(--fg-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={hideSmall}
                        onChange={(e) => setHideSmall(e.target.checked)}
                      />
                      소표본(n&lt;{MIN_SAMPLE}) 숨김
                    </label>
                  </div>
                )}
              </div>

              {effectiveTab === 'evaluator' ? (
                <EvaluatorTable rows={visibleRows} onOpenDrilldown={setDrilldown} />
              ) : (
                <OrgTable records={targetRecords} />
              )}
            </section>

            {/* 종단 보조 패널 (F-C2b) — 직전연도가 있을 때만 노출 */}
            {showLongitudinal && longitudinal && (
              <LongitudinalPanel
                tab={longTab}
                onTabChange={setLongTab}
                data={longitudinal}
                periodLabel={periodLabel}
                priorPeriodLabel={priorPeriodLabel}
              />
            )}

            {/* 무결성 자동 플래그 (분리 카드) */}
            <IntegritySection
              defs={INTEGRITY_DEFS}
              counts={integrityCounts}
              rows={integrityRows}
              periodLabel={periodLabel}
            />
          </>
        )}
      </div>

      {drilldown && (
        <DrilldownPanel row={drilldown} periodLabel={periodLabel} onClose={() => setDrilldown(null)} />
      )}
    </>
  );
};

// ── 상단 caveat 바 (§2.2 ⚠ 준수) ────────────────────────────────────────────

const CaveatBar = () => (
  <div
    className="sd-card"
    style={{
      background: 'var(--bg-muted)',
      borderColor: 'var(--border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}
  >
    <div className="sd-label-mini">읽어두기</div>
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
      <li>표시 수치는 선택한 평가기간 데이터 기준입니다.</li>
      <li>완료된 평가만 집계합니다. 상단에 완료율을 병기하며, 미완료 평가는 통계에서 제외됩니다.</li>
      <li>
        발령(전보)으로 평가자가 여럿인 피평가자는 현재 평가자 기준으로만 집계됩니다. 이는 정상 케이스이며 이상이
        아닙니다.
      </li>
      <li>모든 통계는 판정이 아닌 검토 정황입니다. 조치가 필요하면 행을 열어 평가자에게 재검토를 요청하세요.</li>
    </ul>
  </div>
);

// ── 종단 보조 패널 (F-C2b) ───────────────────────────────────────────────────
// 화면 하단 보조 카드 1장 + 탭 4개(기본=기질 vs 급변). 모든 셀은 §2.1 톤을 따른다.
// 종착점은 신설하지 않는다 — 자세히 검토가 필요하면 위 변별력 표의 '자세히'(재검토 요청)로 간다.

type LongitudinalData = {
  transfer: TransferCohortRow[];
  drift: DriftRow[];
  residual: ResidualRow[];
  temperament: { row: DriftRow; cls: TemperamentClass }[];
  expectationGroupCount: number;
};

const LONG_TAB_LABEL: Record<LongitudinalTab, string> = {
  temperament: '기질 vs 급변',
  transfer: '전보 코호트',
  drift: '전년 드리프트',
  residual: '코호트-잔차',
};

const LONG_TAB_ORDER: LongitudinalTab[] = ['temperament', 'transfer', 'drift', 'residual'];

const LongitudinalPanel = ({
  tab,
  onTabChange,
  data,
  periodLabel,
  priorPeriodLabel,
}: {
  tab: LongitudinalTab;
  onTabChange: (t: LongitudinalTab) => void;
  data: LongitudinalData;
  periodLabel: string;
  priorPeriodLabel: string | null;
}) => {
  const compareLabel = `${priorPeriodLabel ?? '직전연도'} → ${periodLabel}`;
  return (
    <section className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="sd-label-mini">보조 · 종단 패턴 (참고)</div>
          <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>
            두 기간 비교 · 평가자 효과 정황
          </h2>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }} className="tnum">
            {compareLabel}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 3,
            borderRadius: 8,
            background: 'var(--bg-muted)',
            border: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}
        >
          {LONG_TAB_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--fs-sm)',
                fontWeight: tab === key ? 800 : 600,
                color: tab === key ? 'var(--ok-orange)' : 'var(--fg-muted)',
                background: tab === key ? 'var(--bg-card)' : 'transparent',
                boxShadow: tab === key ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {LONG_TAB_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <LongitudinalCaveat tab={tab} expectationGroupCount={data.expectationGroupCount} />

      {tab === 'temperament' && <TemperamentTable rows={data.temperament} />}
      {tab === 'transfer' && <TransferTable rows={data.transfer} />}
      {tab === 'drift' && <DriftTable rows={data.drift} />}
      {tab === 'residual' && <ResidualTable rows={data.residual} />}
    </section>
  );
};

// 탭별 caveat — 정황·근사·미플래그 기조를 못박는다(§2.1).
const LongitudinalCaveat = ({
  tab,
  expectationGroupCount,
}: {
  tab: LongitudinalTab;
  expectationGroupCount: number;
}) => {
  const lines: string[] = (() => {
    switch (tab) {
      case 'transfer':
        return [
          '발령으로 평가자가 바뀐 것은 정상입니다. 아래 Δ는 평가자 효과의 근사일 뿐 이상 판정이 아니며, 본인 성장·직무 변화가 함께 섞여 있어 코호트 단위로만 봅니다.',
          '양 기간 각 1건의 대표 평가만 비교하므로 기간 내 다중 평가자가 있던 경우 평가자 효과 근사에 한계가 있습니다. 전환자 코호트는 본질적으로 소표본이라 대부분 회색(표본 부족)으로 비어 보이는 것이 정상입니다.',
        ];
      case 'drift':
        return [
          '같은 평가자의 두 기간 평균갭 변화입니다. Δ는 관대도 이동의 정황일 뿐 "관대해졌다/엄격해졌다"는 단정이 아닙니다.',
          '양 기간 중 한쪽이라도 완료 표본이 적으면(n<' + MIN_SAMPLE + ') 회색 처리하고 비교에서 제외합니다.',
        ];
      case 'residual':
        return [
          '대화용 맥락 전용입니다. 잔차로 평가자를 줄 세우거나 플래그하지 않습니다.',
          `기대값은 전사 "성장레벨 × 직종" 평균갭이며, 표본이 적은 그룹(n<${MIN_SAMPLE})은 제외합니다(현재 유효 기대값 그룹 ${expectationGroupCount}개). 직종 미상 버킷이 크면 기대값이 부정확할 수 있습니다.`,
        ];
      case 'temperament':
      default:
        return [
          '두 기간 모두 표본이 충분한 평가자만 분류하며, 한쪽이라도 소표본이면 "판정 보류"(회색)입니다.',
          '"급변"은 주의해서 들여다볼 후보일 뿐 이상 판정이 아닙니다. 임계값(±' +
            DRIFT_STABLE +
            '/±' +
            DRIFT_SHOCK +
            ')은 실데이터 보정 전의 잠정 휴리스틱입니다.',
        ];
    }
  })();
  return (
    <div
      style={{
        padding: '12px 20px',
        background: 'var(--bg-muted)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
        {lines.map((line, idx) => (
          <li key={idx}>{line}</li>
        ))}
      </ul>
    </div>
  );
};

// 두 기간 평균갭 + n 을 한 칸에 묶어 노출(인원·구성 병기, §2.1-3).
const PeriodStatCell = ({ stats, dim }: { stats: CohortStats; dim: boolean }) => {
  const color = dim ? 'var(--fg-subtle)' : 'var(--fg)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap' }}>
      <span className="tnum" style={{ fontWeight: 700, color }}>
        {stats.meanGap == null ? '―' : formatMean(stats.meanGap)}
      </span>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }} className="tnum">
        n={stats.n}
      </span>
    </div>
  );
};

// Δ 칩 — 항상 중립색. tnum. dim 이면 '―'.
const DeltaCell = ({ delta, dim }: { delta: number | null; dim: boolean }) => {
  if (dim || delta == null) {
    return <span style={{ color: 'var(--fg-subtle)' }}>―</span>;
  }
  return (
    <span
      className="tnum"
      style={{ fontWeight: 800, color: 'var(--fg-muted)' }}
      title="두 기간 평균갭 차이(정황·중립)"
    >
      {formatDelta(delta)}
    </span>
  );
};

const SmallSamplePill = () => (
  <div style={{ marginTop: 2 }}>
    <Pill tone="neutral">표본 부족 (n&lt;{MIN_SAMPLE})</Pill>
  </div>
);

const LongEmpty = ({ message }: { message: string }) => (
  <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
    {message}
  </div>
);

// ── (4) 기질 vs 급변 테이블 (기본 탭, 급변 상단 우선) ─────────────────────────
const TemperamentTable = ({ rows }: { rows: { row: DriftRow; cls: TemperamentClass }[] }) => {
  if (rows.length === 0) {
    return <LongEmpty message="두 기간에 모두 존재하는 평가자가 없습니다." />;
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>평가자 · 소속</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>분류 (참고)</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>직전</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>현재</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>Δ평균갭</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ row, cls }) => {
            const dim = cls === 'hold';
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 800, color: muted }}>{row.name}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{row.org}</div>
                </TableCell>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  {/* 급변 칩도 중립색 — 위험색은 무결성 전용. */}
                  <Pill tone="neutral">{TEMPERAMENT_LABEL[cls]}</Pill>
                  {dim && <SmallSamplePill />}
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <PeriodStatCell stats={row.prior} dim={dim} />
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <PeriodStatCell stats={row.current} dim={dim} />
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <DeltaCell delta={row.delta} dim={dim} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

// ── (1) 전보 코호트 테이블 ───────────────────────────────────────────────────
const TransferTable = ({ rows }: { rows: TransferCohortRow[] }) => {
  if (rows.length === 0) {
    return <LongEmpty message="두 기간 사이 평가자가 바뀐 피평가자 코호트가 없습니다." />;
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>전 평가자 → 현 평가자</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>코호트</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>직전(전 평가자)</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>현재(현 평가자)</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>Δ평균갭</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>현재 갭 구성</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const dim = row.isSmall;
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 800, color: muted }}>{row.prevName}</span>
                  <span style={{ color: 'var(--fg-subtle)' }}> → </span>
                  <span style={{ fontWeight: 800, color: muted }}>{row.nextName}</span>
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontWeight: 800, color: muted }}>
                    {row.members.length}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>명</span>
                  {dim && <SmallSamplePill />}
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <PeriodStatCell stats={row.prior} dim={dim} />
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <PeriodStatCell stats={row.current} dim={dim} />
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <DeltaCell delta={row.delta} dim={dim} />
                </TableCell>
                <TableCell>
                  <BucketChips buckets={row.current.buckets} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

// ── (2) 전년 드리프트 테이블 ─────────────────────────────────────────────────
const DriftTable = ({ rows }: { rows: DriftRow[] }) => {
  if (rows.length === 0) {
    return <LongEmpty message="두 기간에 모두 존재하는 평가자가 없습니다." />;
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>평가자 · 소속</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>직전</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>현재</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>Δ평균갭</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>현재 갭 구성</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const dim = row.isSmall;
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 800, color: muted }}>{row.name}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{row.org}</div>
                  {dim && <SmallSamplePill />}
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <PeriodStatCell stats={row.prior} dim={dim} />
                </TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <PeriodStatCell stats={row.current} dim={dim} />
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <DeltaCell delta={row.delta} dim={dim} />
                </TableCell>
                <TableCell>
                  <BucketChips buckets={row.current.buckets} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

// ── (3) 코호트-잔차 테이블 (대화용 only · 정렬/플래그 금지) ───────────────────
const ResidualTable = ({ rows }: { rows: ResidualRow[] }) => {
  if (rows.length === 0) {
    return <LongEmpty message="잔차를 계산할 평가자 표본이 없습니다." />;
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>평가자 · 소속</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>완료 표본</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>기대값 적용 표본</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>평균 잔차 (참고)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const dim = row.isSmall;
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            const showResidual = !dim && row.meanResidual != null && row.scoredN > 0;
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 800, color: muted }}>{row.name}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{row.org}</div>
                  {dim && <SmallSamplePill />}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontWeight: 700, color: muted }}>
                    {row.totalN}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>명</span>
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                    {row.scoredN}
                  </span>
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {showResidual ? (
                    <span
                      className="tnum"
                      style={{ fontWeight: 800, color: 'var(--fg-muted)' }}
                      title="평균(실제갭 − 전사 성장레벨×직종 기대갭). 대화용 맥락 · 정렬/판정 아님."
                    >
                      {formatDelta(row.meanResidual!)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--fg-subtle)' }}>―</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

// ── 탭/정렬 컨트롤 ───────────────────────────────────────────────────────────

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '6px 14px',
      borderRadius: 6,
      border: 'none',
      cursor: 'pointer',
      fontSize: 'var(--fs-sm)',
      fontWeight: active ? 800 : 600,
      color: active ? 'var(--ok-orange)' : 'var(--fg-muted)',
      background: active ? 'var(--bg-card)' : 'transparent',
      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
    }}
  >
    {children}
  </button>
);

const SortToggle = ({
  value,
  onChange,
  options,
}: {
  value: SortKey;
  onChange: (key: SortKey) => void;
  options: { key: SortKey; label: string }[];
}) => (
  <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 8, background: 'var(--bg-muted)', border: '1px solid var(--border)' }}>
    {options.map((opt) => (
      <button
        key={opt.key}
        type="button"
        onClick={() => onChange(opt.key)}
        style={{
          padding: '5px 10px',
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          fontSize: 'var(--fs-xs)',
          fontWeight: value === opt.key ? 800 : 600,
          color: value === opt.key ? 'var(--ok-orange)' : 'var(--fg-muted)',
          background: value === opt.key ? 'var(--bg-card)' : 'transparent',
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

// ── 갭 버킷 구성 칩 (인원·구성 병기, §2.1-3) ─────────────────────────────────

const BucketChips = ({ buckets }: { buckets: GapBucketCounts }) => {
  const active = BUCKET_ORDER.filter((b) => buckets[b] > 0);
  if (active.length === 0) {
    return <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>표본 없음</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {active.map((b) => (
        <span
          key={b}
          className="tnum"
          style={{
            fontSize: 'var(--fs-xs)',
            fontWeight: 700,
            color: 'var(--fg-muted)',
            background: 'var(--bg-muted)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '2px 7px',
            whiteSpace: 'nowrap',
          }}
          title={`${BUCKET_LABEL[b]} ${buckets[b]}명`}
        >
          {BUCKET_LABEL[b]} {buckets[b]}
        </span>
      ))}
    </div>
  );
};

const SignalChips = ({ signals }: { signals: DistributionSignal[] }) => {
  if (signals.length === 0) {
    return <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>특이 정황 없음</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {signals.map((s) => (
        <Pill key={s.key} tone="neutral">
          {s.label}
        </Pill>
      ))}
    </div>
  );
};

// ── 변별력 × 분포 테이블 ─────────────────────────────────────────────────────

const EvaluatorTable = ({
  rows,
  onOpenDrilldown,
}: {
  rows: EvaluatorRow[];
  onOpenDrilldown: (row: EvaluatorRow) => void;
}) => {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
        집계할 평가자가 없습니다.
      </div>
    );
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>평가자 · 소속</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>완료 표본</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>갭 구성</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>평균갭</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>SD</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>분포 정황</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>완료율</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const completionRate = row.assignedCount
              ? Math.round((row.completedCount / row.assignedCount) * 100)
              : 0;
            const dim = row.isSmall;
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 800, color: muted }}>{row.name}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{row.org}</div>
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontWeight: 800, color: muted }}>
                    {row.n}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>명</span>
                  {dim && (
                    <div style={{ marginTop: 2 }}>
                      <Pill tone="neutral">표본 부족 (n&lt;{MIN_SAMPLE})</Pill>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <BucketChips buckets={row.buckets} />
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {dim || row.meanGap == null ? (
                    <span style={{ color: 'var(--fg-subtle)' }}>―</span>
                  ) : (
                    <span className="tnum" style={{ fontWeight: 700 }}>
                      {formatMean(row.meanGap)}
                    </span>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {dim || row.sd == null ? (
                    <span style={{ color: 'var(--fg-subtle)' }} title={row.n < 2 ? 'n=1 정의 불가' : undefined}>
                      ―
                    </span>
                  ) : (
                    <span className="tnum" style={{ fontWeight: 700 }}>
                      {row.sd.toFixed(2)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {dim ? (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>표본 부족</span>
                  ) : (
                    <SignalChips signals={row.signals} />
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                    {completionRate}%
                  </span>
                </TableCell>
                <TableCell style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button
                    type="button"
                    className="sd-btn sd-btn-ghost sd-btn-sm"
                    onClick={() => onOpenDrilldown(row)}
                    title="피평가자별 갭·재검토 요청 (읽기 전용)"
                  >
                    자세히
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

// ── 조직 집계 테이블 (org_division/org_department 재groupBy) ──────────────────

type OrgAggRow = {
  key: string;
  label: string;
  samples: ValidSample[];
  buckets: GapBucketCounts;
  n: number;
  meanGap: number | null;
  sd: number | null;
  signals: DistributionSignal[];
  isSmall: boolean;
};

const buildOrgRows = (records: EmployeeEvaluationRecord[]): OrgAggRow[] => {
  const byKey = new Map<string, EmployeeEvaluationRecord[]>();
  for (const r of records) {
    const division = getOrgValue(r.employee, 'division');
    const department = getOrgValue(r.employee, 'department');
    const label = [division, department].filter(Boolean).join(' › ') || '(소속 미상)';
    const arr = byKey.get(label);
    if (arr) arr.push(r);
    else byKey.set(label, [r]);
  }
  const rows: OrgAggRow[] = [];
  for (const [label, group] of byKey) {
    const samples = group.map(toValidSample).filter((s): s is ValidSample => s != null);
    const buckets = emptyBuckets();
    for (const s of samples) buckets[s.bucket] += 1;
    const gaps = samples.map((s) => s.gap);
    const n = samples.length;
    const sd = sampleStdDev(gaps);
    rows.push({
      key: label,
      label,
      samples,
      buckets,
      n,
      meanGap: n > 0 ? mean(gaps) : null,
      sd,
      signals: distributionSignals(samples, buckets),
      isSmall: n < MIN_SAMPLE,
    });
  }
  return rows.sort((a, b) => {
    if (a.isSmall !== b.isSmall) return a.isSmall ? 1 : -1;
    return b.n - a.n;
  });
};

const OrgTable = ({ records }: { records: EmployeeEvaluationRecord[] }) => {
  const rows = useMemo(() => buildOrgRows(records), [records]);
  if (rows.length === 0) {
    return (
      <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
        집계할 조직 표본이 없습니다.
      </div>
    );
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>본부 › 부</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>완료 표본</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>갭 구성</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>평균갭</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>SD</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>분포 정황</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const dim = row.isSmall;
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ fontWeight: 800, color: muted, whiteSpace: 'nowrap' }}>{row.label}</TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontWeight: 800, color: muted }}>
                    {row.n}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>명</span>
                  {dim && (
                    <div style={{ marginTop: 2 }}>
                      <Pill tone="neutral">표본 부족 (n&lt;{MIN_SAMPLE})</Pill>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <BucketChips buckets={row.buckets} />
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {dim || row.meanGap == null ? (
                    <span style={{ color: 'var(--fg-subtle)' }}>―</span>
                  ) : (
                    <span className="tnum" style={{ fontWeight: 700 }}>
                      {formatMean(row.meanGap)}
                    </span>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {dim || row.sd == null ? (
                    <span style={{ color: 'var(--fg-subtle)' }}>―</span>
                  ) : (
                    <span className="tnum" style={{ fontWeight: 700 }}>
                      {row.sd.toFixed(2)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {dim ? (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>표본 부족</span>
                  ) : (
                    <SignalChips signals={row.signals} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

// ── 무결성 섹션 ──────────────────────────────────────────────────────────────

const IntegritySection = ({
  defs,
  counts,
  rows,
  periodLabel,
}: {
  defs: IntegrityDef[];
  counts: Map<IntegrityKey, number>;
  rows: IntegrityFlags[];
  periodLabel: string;
}) => {
  const [openKey, setOpenKey] = useState<IntegrityKey | null>(null);

  return (
    <section className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>입력 무결성 점검</h2>
        <p style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
          이미 로드된 평가·과업 데이터로만 판정합니다. 평가자 배정 정합성은 별도 "매칭 정합성 점검" 화면에서
          다룹니다.
        </p>
      </div>

      <div
        style={{
          padding: 16,
          display: 'grid',
          gridTemplateColumns: `repeat(${defs.length}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {defs.map((def) => {
          const n = counts.get(def.key) ?? 0;
          const isEmpty = n === 0;
          const isOpen = openKey === def.key;
          const accent = def.key === 'weight-mismatch' ? 'var(--danger)' : 'var(--ok-orange)';
          return (
            <button
              key={def.key}
              type="button"
              onClick={() => setOpenKey(isOpen ? null : def.key)}
              aria-expanded={isOpen}
              style={{
                textAlign: 'left',
                padding: '14px 16px',
                borderRadius: 10,
                background: isOpen ? 'var(--bg-card)' : 'var(--bg-muted)',
                border: isOpen ? '1px solid var(--ok-orange)' : '1px solid var(--border)',
                cursor: 'pointer',
                opacity: isEmpty ? 0.62 : 1,
              }}
            >
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)', minHeight: 34, lineHeight: 1.3 }}>
                {def.name}
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                {isEmpty ? (
                  <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg-subtle)' }}>없음</span>
                ) : (
                  <>
                    <span className="tnum" style={{ fontSize: 'var(--fs-h2)', fontWeight: 900, color: accent, lineHeight: 1 }}>
                      {n}
                    </span>
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>건</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {openKey && <IntegrityDetail def={defs.find((d) => d.key === openKey)!} rows={rows} periodLabel={periodLabel} />}
    </section>
  );
};

const IntegrityDetail = ({
  def,
  rows,
  periodLabel,
}: {
  def: IntegrityDef;
  rows: IntegrityFlags[];
  periodLabel: string;
}) => {
  const matched = rows.filter((r) => r.keys.has(def.key));
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ padding: '14px 20px', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
        {def.description}
      </div>
      {matched.length === 0 ? (
        <div style={{ padding: '4px 20px 20px', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
          해당하는 행이 없습니다.
        </div>
      ) : (
        <div style={{ overflow: 'auto', paddingBottom: 8 }}>
          <Table>
            <TableHeader style={{ background: 'var(--bg-muted)' }}>
              <TableRow>
                <TableHead style={{ whiteSpace: 'nowrap' }}>사번</TableHead>
                <TableHead style={{ whiteSpace: 'nowrap' }}>피평가자</TableHead>
                <TableHead style={{ whiteSpace: 'nowrap' }}>평가자</TableHead>
                <TableHead style={{ whiteSpace: 'nowrap' }}>소속</TableHead>
                <TableHead style={{ whiteSpace: 'nowrap' }}>세부</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matched.map((r) => (
                <TableRow key={`${def.key}-${r.record.employee.id}`}>
                  <TableCell style={{ fontFamily: 'monospace', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                    {r.record.employee.employee_id}
                  </TableCell>
                  <TableCell style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{r.record.employee.name}</TableCell>
                  <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                    {evaluatorNameOf(r.record)}
                  </TableCell>
                  <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap', fontSize: 'var(--fs-sm)' }}>
                    {orgLabelOf(r.record)}
                  </TableCell>
                  <TableCell style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                    <IntegrityDetailCell def={def} flags={r} periodLabel={periodLabel} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

const IntegrityDetailCell = ({
  def,
  flags,
  periodLabel,
}: {
  def: IntegrityDef;
  flags: IntegrityFlags;
  periodLabel: string;
}) => {
  const r = flags.record;
  if (def.key === 'no-evaluation') {
    const noEval = r.evaluation == null;
    const noEvaluator = !r.employee.evaluator_id?.trim();
    return (
      <span>
        {noEval ? `평가 레코드 없음 (${periodLabel})` : ''}
        {noEval && noEvaluator ? ' · ' : ''}
        {noEvaluator ? '평가자 미배정' : ''}
      </span>
    );
  }
  if (def.key === 'all-same-score') {
    const scored = r.tasks.filter((t) => t.score !== null && t.score !== undefined);
    const value = scored[0]?.score;
    return (
      <span className="tnum">
        과업 {scored.length}개 모두 {value}점
      </span>
    );
  }
  if (def.key === 'weight-mismatch') {
    return (
      <span className="tnum" style={{ color: 'var(--danger)', fontWeight: 700 }}>
        실제 합 {r.totalWeight}% (기준 100%)
      </span>
    );
  }
  // missing-feedback
  return (
    <span className="tnum">
      미작성 {flags.missingFeedback.missing} / 완료 {flags.missingFeedback.scored}과업
    </span>
  );
};

// ── 드릴다운 + 재검토 요청 ───────────────────────────────────────────────────

const DrilldownPanel = ({
  row,
  periodLabel,
  onClose,
}: {
  row: EvaluatorRow;
  periodLabel: string;
  onClose: () => void;
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const askReason = useReason();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // 이미 로드된 표본만 사용(추가 조회 없음). 갭 큰(미달) 순으로 정렬해 점검 우선순위 노출.
  const sorted = useMemo(
    () => [...row.samples].sort((a, b) => a.gap - b.gap),
    [row.samples],
  );

  const handleRequestReturn = async (sample: ValidSample) => {
    const evaluationId = sample.record.evaluation?.id;
    if (!evaluationId) {
      toast({ title: '재검토 요청 불가', description: '이 평가에는 연결된 평가 레코드가 없습니다.', variant: 'destructive' });
      return;
    }
    if (!user?.id) {
      toast({ title: '재검토 요청 불가', description: '요청자 정보를 확인할 수 없습니다.', variant: 'destructive' });
      return;
    }
    const reason = await askReason({
      title: `${sample.record.employee.name} 평가 재검토 요청`,
      description:
        '평가자에게 전달할 재검토 사유를 입력해 주세요. (선택) ※ 평가 상태는 변경되지 않으며 알림만 발송됩니다.',
      placeholder: '재검토 사유 (선택)',
      confirmText: '재검토 요청',
    });
    if (reason === null) return; // 취소
    setPendingId(evaluationId);
    try {
      await evaluationService.requestReturn(evaluationId, {
        requestedBy: user.id,
        reason: reason.trim() || undefined,
        origin: 'hr',
      });
      toast({
        title: '재검토를 요청했습니다.',
        description: `${row.name}에게 HR 재검토 요청 알림이 전달되었습니다. (상태 변경 없음)`,
      });
    } catch (err) {
      console.error('재검토 요청 실패:', err);
      toast({ title: '재검토 요청 실패', description: '잠시 후 다시 시도해 주세요.', variant: 'destructive' });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sd-card"
        style={{
          width: 'min(560px, 100%)',
          height: '100%',
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="sd-label-mini">평가 품질 상세 · 읽기 전용</div>
            <h2 style={{ marginTop: 4, fontSize: 'var(--fs-h3)', fontWeight: 900 }}>{row.name}</h2>
            <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>{row.org}</div>
          </div>
          <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose}>
            닫기
          </button>
        </div>

        <div style={{ overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* 요약 */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="sd-label-mini">변별력 요약 · {periodLabel}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <SummaryStat label="완료 표본" value={`${row.n}명`} />
              <SummaryStat
                label="평균갭"
                value={row.isSmall || row.meanGap == null ? '―' : formatMean(row.meanGap)}
              />
              <SummaryStat label="SD" value={row.isSmall || row.sd == null ? '―' : row.sd.toFixed(2)} />
              <SummaryStat
                label="분산"
                value={row.isSmall || row.variance == null ? '―' : row.variance.toFixed(2)}
              />
            </div>
            <BucketChips buckets={row.buckets} />
            {row.isSmall ? (
              <Pill tone="neutral">표본 부족 (n&lt;{MIN_SAMPLE}) · 통계 비교 제외</Pill>
            ) : (
              <SignalChips signals={row.signals} />
            )}
          </div>

          {/* 피평가자별 갭 + 재검토 요청 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="sd-label-mini">피평가자별 갭 · 재검토 요청</div>
            <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', lineHeight: 1.5 }}>
              아래는 검토 정황입니다. 재검토 요청은 평가 상태를 바꾸지 않고 담당 평가자에게 HR 알림만 보냅니다. 자동
              발송은 없습니다.
            </p>
            {sorted.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-subtle)' }}>완료된 피평가자 표본이 없습니다.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sorted.map((sample) => {
                  const emp = sample.record.employee;
                  const evaluationId = sample.record.evaluation?.id;
                  const isPending = pendingId != null && pendingId === evaluationId;
                  return (
                    <li
                      key={emp.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{emp.name}</div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                          성장레벨 Lv.{emp.growth_level ?? '-'} · 점수 {sample.record.flooredScore}
                          <span style={{ color: 'var(--fg-subtle)' }}> (가중 {formatScore(sample.record.weightedScore)})</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span
                          className="tnum"
                          style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg-muted)' }}
                          title={`갭 ${formatGap(sample.gap)} (${BUCKET_LABEL[sample.bucket]})`}
                        >
                          갭 {formatGap(sample.gap)}
                        </span>
                        <Pill tone="neutral">{BUCKET_LABEL[sample.bucket]}</Pill>
                        <button
                          type="button"
                          className="sd-btn sd-btn-outline sd-btn-sm"
                          disabled={isPending || !evaluationId}
                          onClick={() => handleRequestReturn(sample)}
                          title="평가자에게 HR 재검토 요청 (상태 변경 없음·알림만)"
                        >
                          {isPending ? '요청 중…' : '재검토 요청'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryStat = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{label}</span>
    <span className="tnum" style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>
      {value}
    </span>
  </div>
);

export default HrQualityPage;
