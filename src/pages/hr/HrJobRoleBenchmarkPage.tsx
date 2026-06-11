import { useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationPeriodSelector } from '@/components/Layout/EvaluationPeriodSelector';
import { IconSearch, Pill } from '@/components/brand';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import OrgChecklist from '@/components/hr/OrgChecklist';
import { matchesOrgNodes } from '@/lib/orgHierarchy';
import { getScoreGapBucket, formatScore, type ScoreGapBucket } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

// ────────────────────────────────────────────────────────────────────────────
// 직종(job_role) 벤치마크 — F-D1 스코프: 직종 단위 갭 분포·달성률 비교 (read-only).
//
// [설계원칙 — F-C2a(HrQualityPage) §2.1 그대로 차용, 절대 위반 금지]
//  1) 판정이 아니라 맥락. "이 직종이 후하다/문제다" 단정 금지. 통계는 검토 정황.
//  2) HR 전용. 라우트는 ProtectedRoute allowedRoles=['hr'] 로 차단.
//  3) 인원·구성 항상 병기. 평균갭/SD/달성률은 표본 n·갭 버킷 구성과 한 묶음으로만 노출.
//  4) 소표본 회색. 완료 n<5 직종 행은 회색·"표본 부족"·통계 "―"·정렬/비교 제외.
//  5) 색은 중립. 위험 단정색(빨강) 금지. 본 화면은 무결성 카드가 없어 danger 톤 사용처 0건.
//
// [갭의 의미] 모든 비교축은 gap = Math.round(flooredScore) − Math.round(growth_level)
//   즉 성장레벨 대비 절대평가 갭이다(getScoreGapBucket·toValidSample 재사용). 원점수
//   (flooredScore) 평균으로 직종을 줄세우지 않는다 — 정렬축은 갭 버킷/평균갭/달성률뿐.
//
// [요청 폭주 방지] useCompanyDashboardRecords() 1훅만 사용(커밋 8fc884c). 전사 레코드를
//   1배치로 로드한 뒤 job_role 로 메모리 내 groupBy 만 수행한다. per-employee 추가 조회 0건.
//   includeFeedbackHistory 는 기본값(false) 유지 — 켜면 task별 N+1 폭주이며 본 화면은
//   갭·버킷만 쓰므로 feedback history 가 불필요하다.
//
// [달성률 정의 — 절대평가 일관] achievedCount = 완료·유효 표본 중 gap>=0 인 수, 분모는 n.
//   record.achieved(미시작·진행중 레코드에도 계산되는 raw 값)는 분자에 섞지 않는다.
//   '배정 대비 완료율'(completedCount/assignedCount)은 의미가 다르므로 별도 컬럼으로 분리한다.
//
// [직종 미상 가드] '(직종 미상)' 버킷은 표본이 충분해도 벤치마크 비교(정렬)에서 제외하고
//   항상 하단의 회색 참고행으로만 표시한다. 직종 자체가 비교 단위이므로 미상 묶음을
//   정상 직종처럼 줄세우면 비교가 오염된다.
//
// [발령 다중평가자] job_role 은 employee 마스터 필드라 평가자 수와 독립이다. 한 피평가자의
//   record 는 대표 1건이므로 직종 표본 중복 카운트가 없고, 발령으로 인한 오탐도 없다.
// ────────────────────────────────────────────────────────────────────────────

const MIN_SAMPLE = 5; // 소표본 임계값. n<5 직종은 통계 회색 처리(HrQualityPage 와 동일).

const UNKNOWN_JOB_ROLE = '(직종 미상)'; // 결측 통합 라벨 (HrQualityPage expectationKeyOf 와 동일).

type GapBucketCounts = Record<ScoreGapBucket, number>;

const BUCKET_ORDER: ScoreGapBucket[] = ['exceed', 'meet', 'near', 'below'];
const BUCKET_LABEL: Record<ScoreGapBucket, string> = {
  exceed: '초과',
  meet: '충족',
  near: '근접',
  below: '미달',
};

type ValidSample = {
  record: EmployeeEvaluationRecord;
  gap: number; // Math.round(flooredScore) - Math.round(growthLevel)
  bucket: ScoreGapBucket;
};

const toNum = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

// 완료 판정 — task 점수 충족 기준(evaluation_status 와 별개, dashboardData status='completed' 일치).
const isCompletedRecord = (r: EmployeeEvaluationRecord): boolean =>
  r.totalTasks > 0 && r.completedTasks === r.totalTasks;

// 유효표본(갭 산출 가능) 여부 — HrQualityPage.toValidSample 과 동일.
const toValidSample = (r: EmployeeEvaluationRecord): ValidSample | null => {
  if (!isCompletedRecord(r)) return null;
  const score = r.flooredScore;
  const growth = toNum(r.employee.growth_level);
  if (!(score > 0) || !Number.isFinite(growth) || !(growth > 0)) return null;
  const gap = Math.round(score) - Math.round(growth);
  return { record: r, gap, bucket: getScoreGapBucket(score, growth) };
};

// 직종 파생 키 — employee 마스터 필드. 결측은 단일 버킷으로 통합.
const jobRoleOf = (r: EmployeeEvaluationRecord): string =>
  r.employee.job_role?.trim() || UNKNOWN_JOB_ROLE;

const emptyBuckets = (): GapBucketCounts => ({ exceed: 0, meet: 0, near: 0, below: 0 });

// 표본표준편차(베셀 보정, n-1). n<2 → null(정의 불가).
const sampleStdDev = (gaps: number[]): number | null => {
  const n = gaps.length;
  if (n < 2) return null;
  const m = gaps.reduce((s, g) => s + g, 0) / n;
  const variance = gaps.reduce((s, g) => s + (g - m) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
};

const mean = (gaps: number[]): number =>
  gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;

const formatGap = (gap: number): string => (gap > 0 ? `+${gap}` : String(gap));
const formatMean = (m: number): string => (m > 0 ? `+${m.toFixed(2)}` : m.toFixed(2));

// ── 직종 집계 행 ─────────────────────────────────────────────────────────────

type JobRoleRow = {
  key: string; // = jobRole 라벨
  jobRole: string;
  isUnknown: boolean; // '(직종 미상)' 묶음 — 벤치마크 비교에서 제외
  samples: ValidSample[]; // 완료·유효 표본
  buckets: GapBucketCounts;
  n: number; // 완료·유효 표본 수
  assignedCount: number; // 직종 소속 전 피평가자 수(완료율 분모)
  completedCount: number; // 완료 수
  achievedCount: number; // 완료·유효 표본 중 gap>=0 (달성률 분자)
  meanGap: number | null;
  variance: number | null;
  sd: number | null;
  isSmall: boolean; // n<MIN_SAMPLE
};

type SortKey = 'sample' | 'achievement' | 'absMeanGap';

const buildJobRoleRows = (records: EmployeeEvaluationRecord[]): JobRoleRow[] => {
  const byKey = new Map<string, EmployeeEvaluationRecord[]>();
  for (const r of records) {
    const key = jobRoleOf(r);
    const arr = byKey.get(key);
    if (arr) arr.push(r);
    else byKey.set(key, [r]);
  }

  const rows: JobRoleRow[] = [];
  for (const [jobRole, group] of byKey) {
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
    const achievedCount = samples.filter((s) => s.gap >= 0).length;
    const sd = sampleStdDev(gaps);
    rows.push({
      key: jobRole,
      jobRole,
      isUnknown: jobRole === UNKNOWN_JOB_ROLE,
      samples,
      buckets,
      n,
      assignedCount: group.length,
      completedCount,
      achievedCount,
      meanGap: n > 0 ? mean(gaps) : null,
      variance: sd != null ? sd * sd : null,
      sd,
      isSmall: n < MIN_SAMPLE,
    });
  }
  return rows;
};

// ── 페이지 ───────────────────────────────────────────────────────────────────

const HrJobRoleBenchmarkPage = () => {
  const { records, isLoading, error } = useCompanyDashboardRecords();
  const { selectedPeriod } = useEvaluationPeriod();

  const [searchQuery, setSearchQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('sample');
  const [hideSmall, setHideSmall] = useState(false);
  const [drilldown, setDrilldown] = useState<JobRoleRow | null>(null);

  // 점검 대상: 평가 대상자(evaluatee) 롤 + org 필터(완료 무관 전원).
  const targetRecords = useMemo(
    () =>
      records.filter(
        (r) => r.employee.available_roles?.includes('evaluatee') && matchesOrgNodes(r.employee, orgFilter),
      ),
    [records, orgFilter],
  );

  const jobRoleRows = useMemo(() => buildJobRoleRows(targetRecords), [targetRecords]);

  // 검색 + 정렬 적용. '(직종 미상)'·소표본 행은 항상 하단, 통계 정렬에서 제외.
  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = jobRoleRows.filter((row) => {
      if (hideSmall && row.isSmall) return false;
      if (!q) return true;
      return row.jobRole.toLowerCase().includes(q);
    });

    const achievementRate = (row: JobRoleRow): number => (row.n > 0 ? row.achievedCount / row.n : 0);

    rows = [...rows].sort((a, b) => {
      // '(직종 미상)' 묶음은 벤치마크 비교 대상이 아니므로 항상 하단.
      if (a.isUnknown !== b.isUnknown) return a.isUnknown ? 1 : -1;
      // 소표본은 항상 하단.
      if (a.isSmall !== b.isSmall) return a.isSmall ? 1 : -1;
      if ((a.isSmall && b.isSmall) || (a.isUnknown && b.isUnknown)) return b.n - a.n;
      if (sortKey === 'sample') return b.n - a.n;
      if (sortKey === 'achievement') return achievementRate(b) - achievementRate(a);
      // |평균갭| 큰 순
      const am = Math.abs(a.meanGap ?? 0);
      const bm = Math.abs(b.meanGap ?? 0);
      return bm - am;
    });
    return rows;
  }, [jobRoleRows, searchQuery, hideSmall, sortKey]);

  // 완료율(전체) 병기용.
  const completion = useMemo(() => {
    const total = targetRecords.length;
    const completed = targetRecords.filter(isCompletedRecord).length;
    return { total, completed, rate: total ? Math.round((completed / total) * 100) : 0 };
  }, [targetRecords]);

  const periodLabel = selectedPeriod
    ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}`
    : '평가기간 미선택';

  return (
    <>
      <PageHeader
        title="직종 벤치마크"
        subtitle="직종(job_role)별 점수–성장레벨 갭의 분포·달성률을 읽기 전용으로 비교합니다. 통계는 판정이 아닌 검토 정황이며, 소표본 직종은 표본이 적을 뿐 직종의 문제가 아닙니다."
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
                placeholder="직종 검색"
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
              <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>
                직종별 갭 분포 · 달성률
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <SortToggle
                  value={sortKey}
                  onChange={setSortKey}
                  options={[
                    { key: 'sample', label: '표본순' },
                    { key: 'achievement', label: '달성률 높은순' },
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
            </div>

            <JobRoleTable rows={visibleRows} onOpenDrilldown={setDrilldown} />
          </section>
        )}
      </div>

      {drilldown && (
        <DrilldownPanel row={drilldown} periodLabel={periodLabel} onClose={() => setDrilldown(null)} />
      )}
    </>
  );
};

// ── 상단 caveat 바 ───────────────────────────────────────────────────────────

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
      <li>
        모든 비교는 갭(점수 − 성장레벨, 절대평가) 기준입니다. 원점수 평균으로 직종을 줄 세우지 않으며, 통계는
        판정이 아닌 검토 정황입니다.
      </li>
      <li>
        달성률은 완료·유효 표본(n명) 중 갭이 0 이상인 비율입니다. 배정 대비 완료율(완료/배정)은 별도 컬럼으로
        병기하며, 미완료 평가는 통계에서 제외됩니다.
      </li>
      <li>
        완료 표본이 적은 직종(n&lt;{MIN_SAMPLE})은 회색·"표본 부족"으로 표시하고 비교·정렬에서 제외합니다. 이는
        데이터가 적다는 뜻이며 직종의 문제가 아닙니다. "(직종 미상)"도 비교에서 제외해 하단 참고행으로만 둡니다.
      </li>
      <li>
        발령(전보)으로 평가자가 여럿인 피평가자도 직종 귀속은 변하지 않으므로 직종 집계에 영향이 없습니다(대표
        평가 1건 기준). 이는 정상 케이스이며 이상이 아닙니다.
      </li>
    </ul>
  </div>
);

// ── 정렬 컨트롤 ──────────────────────────────────────────────────────────────

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

// ── 갭 버킷 구성 칩 (인원·구성 병기) ─────────────────────────────────────────

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

const SmallSamplePill = () => (
  <div style={{ marginTop: 2 }}>
    <Pill tone="neutral">표본 부족 (n&lt;{MIN_SAMPLE})</Pill>
  </div>
);

// ── 직종 테이블 ──────────────────────────────────────────────────────────────

const JobRoleTable = ({
  rows,
  onOpenDrilldown,
}: {
  rows: JobRoleRow[];
  onOpenDrilldown: (row: JobRoleRow) => void;
}) => {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
        집계할 직종이 없습니다.
      </div>
    );
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>직종</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>완료 표본</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>갭 구성</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>달성률</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>완료율</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>평균갭</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>SD</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            // 소표본 또는 '(직종 미상)' 묶음은 비교 통계를 회색·'―' 처리한다.
            const dim = row.isSmall || row.isUnknown;
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            const completionRate = row.assignedCount
              ? Math.round((row.completedCount / row.assignedCount) * 100)
              : 0;
            const showStats = !row.isSmall; // 통계 표시는 소표본만 차단('(직종 미상)'은 회색이되 값은 노출)
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 800, color: muted }}>{row.jobRole}</div>
                  {row.isUnknown && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                      비교 제외 · 참고
                    </div>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontWeight: 800, color: muted }}>
                    {row.n}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>명</span>
                  {row.isSmall && <SmallSamplePill />}
                </TableCell>
                <TableCell>
                  <BucketChips buckets={row.buckets} />
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {showStats && row.n > 0 ? (
                    <>
                      <span className="tnum" style={{ fontWeight: 700, color: muted }}>
                        {Math.round((row.achievedCount / row.n) * 100)}%
                      </span>
                      <div className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                        {row.achievedCount}/{row.n}명
                      </div>
                    </>
                  ) : (
                    <span style={{ color: 'var(--fg-subtle)' }}>―</span>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                    {completionRate}%
                  </span>
                  <div className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                    {row.completedCount}/{row.assignedCount}명
                  </div>
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {showStats && row.meanGap != null ? (
                    <span className="tnum" style={{ fontWeight: 700, color: muted }}>
                      {formatMean(row.meanGap)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--fg-subtle)' }}>―</span>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {showStats && row.sd != null ? (
                    <span className="tnum" style={{ fontWeight: 700, color: muted }}>
                      {row.sd.toFixed(2)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--fg-subtle)' }} title={row.n < 2 ? 'n<2 정의 불가' : undefined}>
                      ―
                    </span>
                  )}
                </TableCell>
                <TableCell style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button
                    type="button"
                    className="sd-btn sd-btn-ghost sd-btn-sm"
                    onClick={() => onOpenDrilldown(row)}
                    title="직종 내 피평가자별 갭 (읽기 전용)"
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

// ── 드릴다운 (우측 슬라이드 · 읽기 전용 · 쓰기 액션 없음) ──────────────────────

const DrilldownPanel = ({
  row,
  periodLabel,
  onClose,
}: {
  row: JobRoleRow;
  periodLabel: string;
  onClose: () => void;
}) => {
  // 이미 로드된 표본만 사용(추가 조회 없음). 갭 작은(미달) 순으로 정렬해 분포를 노출.
  const sorted = useMemo(() => [...row.samples].sort((a, b) => a.gap - b.gap), [row.samples]);
  const achievementPct = row.n > 0 ? Math.round((row.achievedCount / row.n) * 100) : null;

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
            <div className="sd-label-mini">직종 벤치마크 상세 · 읽기 전용</div>
            <h2 style={{ marginTop: 4, fontSize: 'var(--fs-h3)', fontWeight: 900 }}>{row.jobRole}</h2>
            <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              배정 {row.assignedCount}명 · 완료 {row.completedCount}명 · 유효 표본 {row.n}명
            </div>
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
            <div className="sd-label-mini">갭 분포 요약 · {periodLabel}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <SummaryStat label="완료 표본" value={`${row.n}명`} />
              <SummaryStat
                label="달성률"
                value={row.isSmall || achievementPct == null ? '―' : `${achievementPct}%`}
              />
              <SummaryStat
                label="평균갭"
                value={row.isSmall || row.meanGap == null ? '―' : formatMean(row.meanGap)}
              />
              <SummaryStat label="SD" value={row.isSmall || row.sd == null ? '―' : row.sd.toFixed(2)} />
            </div>
            <BucketChips buckets={row.buckets} />
            {row.isSmall ? (
              <Pill tone="neutral">표본 부족 (n&lt;{MIN_SAMPLE}) · 통계 비교 제외</Pill>
            ) : row.isUnknown ? (
              <Pill tone="neutral">직종 미상 · 벤치마크 비교 제외</Pill>
            ) : null}
          </div>

          {/* 피평가자별 갭 (읽기 전용 — 쓰기 액션 없음) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="sd-label-mini">피평가자별 갭</div>
            <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', lineHeight: 1.5 }}>
              아래는 직종 내 완료·유효 표본의 갭 분포입니다. 검토 정황이며 어떤 상태도 변경하지 않습니다.
            </p>
            {sorted.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-subtle)' }}>완료된 피평가자 표본이 없습니다.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sorted.map((sample) => {
                  const emp = sample.record.employee;
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

export default HrJobRoleBenchmarkPage;
