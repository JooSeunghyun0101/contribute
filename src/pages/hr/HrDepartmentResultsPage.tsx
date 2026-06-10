import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationPeriodSelector } from '@/components/Layout/EvaluationPeriodSelector';
import { Pill } from '@/components/brand';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import OrgFilterBar from '@/components/hr/OrgFilterBar';
import {
  getOrgValue,
  matchesOrgFilter,
  ORG_LEVELS,
  ORG_LEVEL_LABELS,
  type OrgFilterState,
  type OrgLevel,
} from '@/lib/orgHierarchy';
import { getScoreGapBucket, floorScoreTenths, type ScoreGapBucket } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';
import { downloadOrgResultWorkbook, type OrgResultRow } from '@/utils/hrDataExport';

// ────────────────────────────────────────────────────────────────────────────
// 부서·본부 결과 리포트 — F-D2 스코프: 조직 계층(법인-본부-부-팀) 단위 결과 요약(임원 보고용, read-only).
//
// [설계원칙 — F-C2a(HrQualityPage)·F-D1(직종 벤치마크) 그대로 차용]
//  1) 판정이 아니라 맥락. "이 조직이 후하다/문제다" 단정 금지. 통계는 검토 정황.
//  2) HR 전용. 라우트는 ProtectedRoute allowedRoles=['hr'] 로 차단.
//  3) 인원·구성 항상 병기. 완료율·달성률·평균갭은 배정/완료/표본 n 과 한 묶음으로만 노출.
//  4) 소표본 회색. 완료 n<5 조직 행은 회색·"표본 부족"·통계 "―"·정렬/비교 하단 고정.
//  5) 색은 중립. 위험 단정색(빨강/danger) 금지. 막대는 완료=ok-orange / 미완료=warning(중립 토큰)뿐.
//
// [갭의 의미] 모든 비교축은 gap = Math.round(flooredScore) − Math.round(growth_level)
//   즉 성장레벨 대비 절대평가 갭이다(getScoreGapBucket 재사용). 원점수 평균으로 조직을 줄세우지 않는다.
//   주의: 갭은 flooredScore(정수 내림, 2.99→2) 기준이고 표시 평균점수는 floorScoreTenths(2.99→2.9)라
//   산출 출처가 달라 한 행 내에서 직관적으로 안 맞아 보일 수 있다(기존 벤치마크 페이지와 동일 동작).
//
// [요청 폭주 방지] useCompanyDashboardRecords() 1훅만 사용(커밋 8fc884c). 전사 레코드를 1배치로 로드한
//   뒤 org_* 컬럼으로 메모리 내 groupBy 만 수행한다. per-employee 추가 조회 0건. 다운로드도 화면 rows
//   직렬화만 하므로 추가 조회가 없다.
//
// [발령 다중평가자] org_* 는 employee 마스터 필드라 평가자 수와 독립이다. 한 피평가자의 record 는 대표 1건
//   이므로 발령(전보)으로 평가자가 여럿이어도 조직 표본 중복/오탐이 없다(정상 케이스).
// ────────────────────────────────────────────────────────────────────────────

const MIN_SAMPLE = 5; // 소표본 임계값. n<5 조직은 통계 회색 처리.

const UNASSIGNED_KEY = '미지정'; // 조직 계층·레거시 department 둘 다 없을 때의 폴백 키.

const GROUP_LEVELS: OrgLevel[] = ['corporation', 'division', 'department', 'team'];

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

// 완료 판정 — task 점수 충족 기준(dashboardData status='completed' 일치).
const isCompletedRecord = (r: EmployeeEvaluationRecord): boolean =>
  r.totalTasks > 0 && r.completedTasks === r.totalTasks;

// 유효표본(갭 산출 가능) 여부 — HrJobRoleBenchmarkPage.toValidSample 과 동일.
const toValidSample = (r: EmployeeEvaluationRecord): ValidSample | null => {
  if (!isCompletedRecord(r)) return null;
  const score = r.flooredScore;
  const growth = toNum(r.employee.growth_level);
  if (!(score > 0) || !Number.isFinite(growth) || !(growth > 0)) return null;
  const gap = Math.round(score) - Math.round(growth);
  return { record: r, gap, bucket: getScoreGapBucket(score, growth) };
};

const emptyBuckets = (): GapBucketCounts => ({ exceed: 0, meet: 0, near: 0, below: 0 });

// 표본표준편차(베셀 보정, n-1). n<2 → null(정의 불가).
const sampleStdDev = (gaps: number[]): number | null => {
  const n = gaps.length;
  if (n < 2) return null;
  const m = gaps.reduce((s, g) => s + g, 0) / n;
  const variance = gaps.reduce((s, g) => s + (g - m) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
};

const mean = (values: number[]): number =>
  values.length ? values.reduce((s, g) => s + g, 0) / values.length : 0;

const formatGap = (gap: number): string => (gap > 0 ? `+${gap.toFixed(2)}` : gap.toFixed(2));

// ── 조직 집계 행 ─────────────────────────────────────────────────────────────

type OrgRow = {
  key: string; // 그룹 키(조직명)
  org: string;
  levelLabel: string; // 실제 귀속 레벨 라벨(법인/본부/부/팀) 또는 '미지정'
  parentPath: string; // 상위 경로 문자열
  isUnassigned: boolean; // '미지정' 묶음 — 비교에서 제외
  samples: ValidSample[]; // 완료·유효 표본
  buckets: GapBucketCounts;
  n: number; // 완료·유효 표본 수
  assignedCount: number; // 조직 소속 전 피평가자 수(완료율 분모)
  completedCount: number; // 완료 수
  achievedCount: number; // 완료·유효 표본 중 gap>=0 (달성률 분자)
  meanGap: number | null;
  sd: number | null;
  meanScore: number | null; // 가중점수 평균(보조 표시값, 정렬축 아님)
  isSmall: boolean; // n<MIN_SAMPLE
};

type SortKey = 'sample' | 'completion' | 'achievement' | 'absMeanGap';

const HrDepartmentResultsPage = () => {
  const { records, isLoading, error } = useCompanyDashboardRecords();
  const { selectedPeriod } = useEvaluationPeriod();
  const { toast } = useToast();

  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({});
  const [groupLevel, setGroupLevel] = useState<OrgLevel>('division');
  const [sortKey, setSortKey] = useState<SortKey>('sample');
  const [hideSmall, setHideSmall] = useState(false);

  // 점검 대상: 평가 대상자(evaluatee) 롤 + org 필터(완료 무관 전원).
  const targetRecords = useMemo(
    () =>
      records.filter(
        (r) => r.employee.available_roles?.includes('evaluatee') && matchesOrgFilter(r.employee, orgFilter),
      ),
    [records, orgFilter],
  );

  // 선택한 집계 단위의 조직 값으로 그룹 키 + 실제 귀속 레벨을 만든다.
  // 선택 레벨이 비어 있으면 더 하위 레벨로 내려가며 폴백, 그래도 없으면 레거시 department → '미지정'.
  const groupStartIdx = ORG_LEVELS.indexOf(groupLevel);
  const orgRows = useMemo(() => {
    const resolveGroup = (
      record: EmployeeEvaluationRecord,
    ): { key: string; level: OrgLevel | null } => {
      for (let i = groupStartIdx; i < ORG_LEVELS.length; i += 1) {
        const value = getOrgValue(record.employee, ORG_LEVELS[i]);
        if (value) return { key: value, level: ORG_LEVELS[i] };
      }
      if (record.employee.department) return { key: record.employee.department, level: 'team' };
      return { key: UNASSIGNED_KEY, level: null };
    };

    const parentLevels = ORG_LEVELS.slice(0, groupStartIdx);
    const parentPathOf = (record: EmployeeEvaluationRecord) =>
      parentLevels
        .map((level) => getOrgValue(record.employee, level))
        .filter(Boolean)
        .join(' › ');

    const byKey = new Map<
      string,
      { records: EmployeeEvaluationRecord[]; level: OrgLevel | null; parentPath: string }
    >();
    for (const record of targetRecords) {
      const { key, level } = resolveGroup(record);
      const existing = byKey.get(key);
      if (existing) {
        existing.records.push(record);
        if (!existing.parentPath) existing.parentPath = parentPathOf(record);
      } else {
        byKey.set(key, { records: [record], level, parentPath: parentPathOf(record) });
      }
    }

    const rows: OrgRow[] = [];
    for (const [key, group] of byKey) {
      const samples: ValidSample[] = [];
      let completedCount = 0;
      let scoreSum = 0;
      let scoreCount = 0;
      for (const r of group.records) {
        if (isCompletedRecord(r)) {
          completedCount += 1;
          scoreSum += r.weightedScore;
          scoreCount += 1;
        }
        const s = toValidSample(r);
        if (s) samples.push(s);
      }
      const buckets = emptyBuckets();
      for (const s of samples) buckets[s.bucket] += 1;
      const gaps = samples.map((s) => s.gap);
      const n = samples.length;
      const isUnassigned = key === UNASSIGNED_KEY;
      rows.push({
        key,
        org: key,
        levelLabel: group.level ? ORG_LEVEL_LABELS[group.level] : '미지정',
        parentPath: group.parentPath,
        isUnassigned,
        samples,
        buckets,
        n,
        assignedCount: group.records.length,
        completedCount,
        achievedCount: samples.filter((s) => s.gap >= 0).length,
        meanGap: n > 0 ? mean(gaps) : null,
        sd: sampleStdDev(gaps),
        meanScore: scoreCount > 0 ? floorScoreTenths(scoreSum / scoreCount) : null,
        isSmall: n < MIN_SAMPLE,
      });
    }
    return rows;
  }, [targetRecords, groupStartIdx]);

  // 정렬 적용. '미지정'·소표본 행은 항상 하단, 통계 정렬에서 제외.
  const visibleRows = useMemo(() => {
    let rows = orgRows.filter((row) => !(hideSmall && row.isSmall));
    const completionRate = (row: OrgRow): number =>
      row.assignedCount > 0 ? row.completedCount / row.assignedCount : 0;
    const achievementRate = (row: OrgRow): number => (row.n > 0 ? row.achievedCount / row.n : 0);

    rows = [...rows].sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (a.isSmall !== b.isSmall) return a.isSmall ? 1 : -1;
      if ((a.isSmall && b.isSmall) || (a.isUnassigned && b.isUnassigned)) return b.n - a.n;
      if (sortKey === 'sample') return b.n - a.n;
      if (sortKey === 'completion') return completionRate(b) - completionRate(a);
      if (sortKey === 'achievement') return achievementRate(b) - achievementRate(a);
      const am = Math.abs(a.meanGap ?? 0);
      const bm = Math.abs(b.meanGap ?? 0);
      return bm - am;
    });
    return rows;
  }, [orgRows, hideSmall, sortKey]);

  // 완료율(전체) 병기용.
  const totals = useMemo(() => {
    const assigned = targetRecords.length;
    const completed = targetRecords.filter(isCompletedRecord).length;
    return { assigned, completed, rate: assigned ? Math.round((completed / assigned) * 100) : 0 };
  }, [targetRecords]);

  const periodLabel = selectedPeriod
    ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}`
    : '평가기간 미선택';

  const levelLabel = ORG_LEVEL_LABELS[groupLevel];

  const handleExport = () => {
    const exportRows: OrgResultRow[] = visibleRows.map((row) => ({
      levelLabel: row.levelLabel,
      org: row.org,
      parentPath: row.parentPath,
      assignedCount: row.assignedCount,
      completedCount: row.completedCount,
      n: row.n,
      achievedCount: row.achievedCount,
      meanGap: row.meanGap,
      sd: row.sd,
      meanScore: row.meanScore,
      buckets: row.buckets,
      isSmall: row.isSmall,
      isUnassigned: row.isUnassigned,
    }));
    try {
      const { rowCount } = downloadOrgResultWorkbook(exportRows, { levelLabel, periodLabel });
      toast({ title: '엑셀 내려받기 완료', description: `${levelLabel} 단위 ${rowCount}개 조직 결과를 내려받았습니다.` });
    } catch {
      toast({ title: '내려받기 실패', description: '엑셀 생성 중 문제가 발생했습니다.', variant: 'destructive' });
    }
  };

  return (
    <>
      <PageHeader
        title="부서·본부 결과"
        subtitle="조직 계층(법인·본부·부·팀) 단위로 평가 결과를 읽기 전용으로 요약합니다. 통계는 판정이 아닌 검토 정황이며, 소표본 조직은 표본이 적을 뿐 조직의 문제가 아닙니다."
        actions={
          <>
            <Pill tone="neutral">{periodLabel}</Pill>
            <button
              type="button"
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={handleExport}
              disabled={isLoading || visibleRows.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Download size={15} />
              엑셀 내려받기
            </button>
          </>
        }
        filters={
          <>
            <EvaluationPeriodSelector />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              집계 단위
              <Select value={groupLevel} onValueChange={(v) => setGroupLevel(v as OrgLevel)}>
                <SelectTrigger style={{ width: 130, height: 36 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {ORG_LEVEL_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <OrgFilterBar
              items={targetRecords.map((r) => r.employee)}
              value={orgFilter}
              onChange={setOrgFilter}
            />
            <div style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              완료 {totals.completed}/{totals.assigned}명 · 완료율{' '}
              <b className="tnum" style={{ color: 'var(--fg)' }}>
                {totals.rate}%
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
                {levelLabel}별 완료·달성·갭 요약
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <SortToggle
                  value={sortKey}
                  onChange={setSortKey}
                  options={[
                    { key: 'sample', label: '표본순' },
                    { key: 'completion', label: '완료율 높은순' },
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
                  <input type="checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} />
                  소표본(n&lt;{MIN_SAMPLE}) 숨김
                </label>
              </div>
            </div>

            {orgRows.length === 0 && !hasOrgHierarchy(targetRecords) ? (
              <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                조직 계층(법인·본부·부·팀) 데이터가 아직 적재되지 않아 단일 그룹으로 집계됩니다. 계층 컬럼이 채워진 명단을
                업로드하면 본부·부 단위로 분리됩니다.
              </div>
            ) : null}

            <OrgResultTable rows={visibleRows} />
          </section>
        )}
      </div>
    </>
  );
};

// 조직 계층 컬럼이 하나라도 채워졌는지(빈 화면 안내용).
const hasOrgHierarchy = (records: EmployeeEvaluationRecord[]): boolean =>
  records.some((r) => ORG_LEVELS.some((level) => Boolean(getOrgValue(r.employee, level))));

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
        모든 비교는 갭(점수 − 성장레벨, 절대평가) 기준입니다. 갭은 정수 내림 점수 기준이며, 원점수 평균으로 조직을
        줄 세우지 않습니다. 통계는 판정이 아닌 검토 정황입니다.
      </li>
      <li>
        달성률은 완료·유효 표본(n명) 중 갭이 0 이상인 비율입니다. 배정 대비 완료율(완료/배정)은 별도 컬럼으로
        병기하며, 미완료 평가는 통계(달성률·평균갭·SD)에서 제외됩니다.
      </li>
      <li>
        완료 표본이 적은 조직(n&lt;{MIN_SAMPLE})은 회색·"표본 부족"으로 표시하고 비교·정렬에서 제외합니다. 이는
        데이터가 적다는 뜻이며 조직의 문제가 아닙니다. "미지정"도 비교에서 제외해 하단 참고행으로만 둡니다.
      </li>
      <li>
        발령(전보)으로 평가자가 여럿인 피평가자도 조직 귀속은 변하지 않으므로 조직 집계에 영향이 없습니다(대표
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

// ── 완료율 막대 (중립 토큰만: 완료=ok-orange / 미완료=warning) ──────────────────

const CompletionBar = ({ completed, assigned }: { completed: number; assigned: number }) => {
  const pct = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
  return (
    <div
      style={{ width: 96, height: 8, borderRadius: 999, background: 'var(--warning-bg)', overflow: 'hidden' }}
      title={`완료 ${completed}/${assigned}명`}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ok-orange)' }} />
    </div>
  );
};

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

// ── 조직 결과 테이블 ─────────────────────────────────────────────────────────

const OrgResultTable = ({ rows }: { rows: OrgRow[] }) => {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
        집계할 조직이 없습니다.
      </div>
    );
  }
  return (
    <div style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader style={{ background: 'var(--bg-muted)' }}>
          <TableRow>
            <TableHead style={{ whiteSpace: 'nowrap' }}>조직</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>완료율</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>완료 표본</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap' }}>갭 구성</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>달성률</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>평균점수</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>평균갭</TableHead>
            <TableHead style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>SD</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            // 소표본 또는 '미지정' 묶음은 회색 처리. 통계 표시(달성률·평균갭·SD)는 소표본만 차단.
            const dim = row.isSmall || row.isUnassigned;
            const muted = dim ? 'var(--fg-subtle)' : 'var(--fg)';
            const completionRate = row.assignedCount
              ? Math.round((row.completedCount / row.assignedCount) * 100)
              : 0;
            const showStats = !row.isSmall;
            return (
              <TableRow key={row.key} style={{ opacity: dim ? 0.62 : 1 }}>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 800, color: muted }}>{row.org}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                    {row.levelLabel}
                    {row.parentPath ? ` · ${row.parentPath}` : ''}
                    {row.isUnassigned ? ' · 비교 제외 · 참고' : ''}
                  </div>
                </TableCell>
                <TableCell style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CompletionBar completed={row.completedCount} assigned={row.assignedCount} />
                    <span className="tnum" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                      {completionRate}%
                    </span>
                  </div>
                  <div className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                    {row.completedCount}/{row.assignedCount}명
                  </div>
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span className="tnum" style={{ fontWeight: 800, color: muted }}>
                    {row.n}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>명</span>
                  {row.isSmall && (
                    <div style={{ marginTop: 2 }}>
                      <Pill tone="neutral">표본 부족 (n&lt;{MIN_SAMPLE})</Pill>
                    </div>
                  )}
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
                  {showStats && row.meanScore != null ? (
                    <span className="tnum" style={{ fontWeight: 700, color: muted }} title="가중점수 평균(소수 절사) · 보조 표시값">
                      {row.meanScore.toFixed(1)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--fg-subtle)' }}>―</span>
                  )}
                </TableCell>
                <TableCell style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {showStats && row.meanGap != null ? (
                    <span className="tnum" style={{ fontWeight: 700, color: muted }} title="갭은 정수 내림 점수 기준">
                      {formatGap(row.meanGap)}
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default HrDepartmentResultsPage;
