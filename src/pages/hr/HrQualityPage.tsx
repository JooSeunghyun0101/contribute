import { useMemo, useState, type ReactNode } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationPeriodSelector } from '@/components/Layout/EvaluationPeriodSelector';
import { IconSearch, Pill, type PillTone } from '@/components/brand';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { evaluationService } from '@/lib/services';
import OrgFilterBar from '@/components/hr/OrgFilterBar';
import { getOrgValue, matchesOrgFilter, type OrgFilterState } from '@/lib/orgHierarchy';
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
// [종단 미포함] 전보 코호트·전년 드리프트·잔차·관대도 사분면은 F-C2b 로 분리.
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

// ── 페이지 ───────────────────────────────────────────────────────────────────

type TabKey = 'evaluator' | 'org';

const HrQualityPage = () => {
  const { records, isLoading, error } = useCompanyDashboardRecords();
  const { selectedPeriod } = useEvaluationPeriod();

  const [tab, setTab] = useState<TabKey>('evaluator');
  const [searchQuery, setSearchQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({});
  const [sortKey, setSortKey] = useState<SortKey>('sample');
  const [hideSmall, setHideSmall] = useState(false);
  const [drilldown, setDrilldown] = useState<EvaluatorRow | null>(null);

  // 점검 대상: 평가 대상자(evaluatee) 롤 + org 필터.
  const targetRecords = useMemo(
    () =>
      records.filter(
        (r) => r.employee.available_roles?.includes('evaluatee') && matchesOrgFilter(r.employee, orgFilter),
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
            <OrgFilterBar
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
      <li>표시 수치는 현재 평가 데이터 기준입니다(데모/합성 데이터 GEN25-·GEN26- 포함 가능).</li>
      <li>완료된 평가만 집계합니다. 상단에 완료율을 병기하며, 미완료 평가는 통계에서 제외됩니다.</li>
      <li>
        발령(전보)으로 평가자가 여럿인 피평가자는 현재 평가자 기준으로만 집계됩니다. 이는 정상 케이스이며 이상이
        아닙니다.
      </li>
      <li>모든 통계는 판정이 아닌 검토 정황입니다. 조치가 필요하면 행을 열어 평가자에게 재검토를 요청하세요.</li>
    </ul>
  </div>
);

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
    const reason = window.prompt(
      `${sample.record.employee.name} 평가에 대해 평가자에게 전달할 재검토 사유를 입력해 주세요. (선택)\n\n※ 평가 상태는 변경되지 않으며 알림만 발송됩니다.`,
    );
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
