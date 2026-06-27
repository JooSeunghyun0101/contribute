import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, X } from 'lucide-react';
import AggregateScoreTrendChart from '@/components/Evaluation/AggregateScoreTrendChart';
import PageHeader from '@/components/Layout/PageHeader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pill } from '@/components/brand';
import AiSummaryReportModal from '@/components/Dashboard/AiSummaryReportModal';
import { useCompanyDashboardRecords, usePriorYearRecords } from '@/hooks/useDashboardRecords';
import { useSharedOrgFilter } from '@/hooks/useSharedOrgFilter';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useToast } from '@/hooks/use-toast';
import {
  downloadFullEvaluationDataWorkbook,
  downloadDepartmentMembersWorkbook,
  type DepartmentExportMember,
} from '@/utils/hrDataExport';
import OrgChecklist from '@/components/hr/OrgChecklist';
import {
  Donut,
  ChartCard,
  LevelDistChart,
  ScoreDistChart,
  DeptHeadcountList,
  HR_COLOR,
  type DeptSort,
} from '@/components/Dashboard/HrDashboardCharts';
import { buildAggregateMonthlyTrend } from '@/lib/scoreTrend';
import {
  getOrgValue,
  matchesOrgNodes,
  ORG_LEVELS,
  orgCompactPath,
  orgFieldsFromEvaluation,
  orgNodeKey,
  orgNodeValues,
  type OrgLevel,
} from '@/lib/orgHierarchy';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

// 그룹핑·필터는 '그 평가 기간'의 조직 기준 — 평가에 기간별 org(evaluatee_org_*)가 있으면 그것을,
// 없으면 현재 employee.org_* 로 폴백한다. (전보자가 25년 화면에 26년 부서로 묶이지 않게 함)
const recordOrg = (r: EmployeeEvaluationRecord) => orgFieldsFromEvaluation(r.evaluation, r.employee);

// 부서별 그룹핑은 '실제 조직' 기준 — 동명 부서(예: OK 인사팀 vs OKH 인사팀)를
// 합치지 않도록 법인›…›선택레벨 경로로 정규화한다. 표시는 말단 이름.
type DeptLevel = 'division' | 'department' | 'team';
const DEPT_LEVEL_PATHS: Record<DeptLevel, readonly OrgLevel[]> = {
  division: ['corporation', 'division'],
  department: ['corporation', 'division', 'department'],
  team: ['corporation', 'division', 'department', 'team'],
};
const DEPT_LEVEL_LABEL: Record<DeptLevel, string> = { division: '본부', department: '부', team: '팀' };
const deptPathOf = (
  emp: { org_corporation?: string | null; org_division?: string | null; org_department?: string | null; org_team?: string | null },
  level: DeptLevel,
) => DEPT_LEVEL_PATHS[level].map((lv) => getOrgValue(emp, lv)).filter(Boolean);

const MONTH_LABELS = [
  '1월',
  '2월',
  '3월',
  '4월',
  '5월',
  '6월',
  '7월',
  '8월',
  '9월',
  '10월',
  '11월',
  '12월',
];

type MonthlyTrendPoint = { label: string; value: number | null };

const buildMonthlyTrend = (
  records: EmployeeEvaluationRecord[],
  year: number,
): MonthlyTrendPoint[] => {
  const total = records.length;

  const completedTimes = records
    .map((r) => {
      if (r.status !== 'completed') return null;
      const ts = r.evaluation?.last_modified;
      const parsed = ts ? new Date(ts).getTime() : NaN;
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((t): t is number => t !== null);

  const now = new Date();
  const nowMs = now.getTime();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  return MONTH_LABELS.map((label, monthIdx) => {
    const isFutureMonth =
      year > currentYear || (year === currentYear && monthIdx > currentMonth);
    if (isFutureMonth) {
      return { label, value: null };
    }
    if (total === 0) {
      return { label, value: 0 };
    }
    const monthEnd = new Date(year, monthIdx + 1, 1).getTime() - 1;
    const cutoff = Math.min(monthEnd, nowMs);
    const completedByThen = completedTimes.filter((t) => t <= cutoff).length;
    return { label, value: Math.round((completedByThen / total) * 100) };
  });
};

const HrHome = () => {
  const navigate = useNavigate();
  const { records, isLoading } = useCompanyDashboardRecords();
  const { selectedPeriod, selectedPeriodId, periods } = useEvaluationPeriod();
  const { toast } = useToast();
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [orgFilter, setOrgFilter] = useSharedOrgFilter(selectedPeriodId);
  const [deptSort, setDeptSort] = useState<DeptSort>('achievement');
  const [deptLevel, setDeptLevel] = useState<DeptLevel>('department'); // 부서 바 그룹핑 단위
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [memberModal, setMemberModal] = useState<{ title: string; records: EmployeeEvaluationRecord[] } | null>(null);
  const [showAiReport, setShowAiReport] = useState(false);

  // 선택 기간의 "평가 대상"만 — 그 기간에 평가(evaluation)가 있는 사람으로 한정.
  // (현재 부서가 같아도 그 기간에 평가가 없으면 대상 아님. 예: 26년 발령자가 25년 화면에
  //  현재 부서 기준으로 '미완료'로 잡히던 문제 해소.)
  const filteredRecords = useMemo(
    () => records.filter((r) => r.evaluation != null && matchesOrgNodes(recordOrg(r), orgFilter)),
    [records, orgFilter],
  );

  // AI 요약 보고서 대상 범위 라벨 — 필터된 인원을 모두 포함하는 가장 깊은 단일 조직명(없으면 '전사').
  const reportScopeLabel = useMemo(() => {
    if (orgFilter.length === 0 || filteredRecords.length === 0) return '전사';
    let label = '전사';
    for (const lv of ORG_LEVELS) {
      const vals = new Set(
        filteredRecords.map((r) => getOrgValue(recordOrg(r), lv)).filter(Boolean),
      );
      if (vals.size === 1) label = [...vals][0] as string;
      else if (vals.size > 1) break;
    }
    return label;
  }, [orgFilter, filteredRecords]);

  // 레벨 필터 적용 — 도넛·점수분포·부서·추이는 선택 레벨로 스코프. (성장레벨 분포 차트는 전체 유지)
  const scopedRecords = useMemo(
    () =>
      selectedLevel === 'all'
        ? filteredRecords
        : filteredRecords.filter((r) => (r.employee.growth_level ?? 1) === selectedLevel),
    [filteredRecords, selectedLevel],
  );

  const trendYear = useMemo(() => {
    if (selectedPeriod?.evaluation_year) return selectedPeriod.evaluation_year;
    if (selectedPeriod?.starts_on) {
      const y = new Date(selectedPeriod.starts_on).getFullYear();
      if (Number.isFinite(y)) return y;
    }
    return new Date().getFullYear();
  }, [selectedPeriod?.evaluation_year, selectedPeriod?.starts_on]);

  const summary = useMemo(() => {
    const records = scopedRecords;
    const totalMembers = records.length;
    const completedMembers = records.filter((r) => isFinalizedRec(r)).length;
    const achievedMembers = records.filter((r) => r.achieved).length;
    const inProgress = records.filter((r) => r.status !== 'completed').length;
    const completionRate =
      totalMembers > 0 ? Math.round((completedMembers / totalMembers) * 100) : 0;
    const achievementRate =
      totalMembers > 0 ? Math.round((achievedMembers / totalMembers) * 100) : 0;

    const monthlyTrend = buildMonthlyTrend(records, trendYear);
    const validPoints = monthlyTrend.filter(
      (p): p is { label: string; value: number } => p.value !== null,
    );
    const lastRate = validPoints.at(-1)?.value ?? 0;
    const prevRate = validPoints.at(-2)?.value ?? 0;
    const completionDelta = lastRate - prevRate;

    const rawDepts = Object.values(
      records.reduce<
        Record<
          string,
          {
            id: string;
            name: string;
            total: number;
            completed: number;
            achieved: number;
            totalProgress: number;
            navKeys: Set<string>;
          }
        >
      >((acc, r) => {
        const path = deptPathOf(recordOrg(r), deptLevel);
        const id = path.length ? orgNodeKey(path) : '미지정';
        const name = path.length ? path[path.length - 1] : r.evaluation?.evaluatee_department || r.employee.department || '미지정';
        if (!acc[id]) {
          acc[id] = { id, name, total: 0, completed: 0, achieved: 0, totalProgress: 0, navKeys: new Set([id]) };
        }
        acc[id].total += 1;
        if (isFinalizedRec(r)) {
          acc[id].completed += 1;
          if (r.achieved) acc[id].achieved += 1;
        }
        acc[id].totalProgress += r.progress;
        // 클릭 시 정확매칭 필터가 되도록 각 인원의 '말단 단위' 노드키도 모은다(부+하위 팀 모두).
        acc[id].navKeys.add(orgNodeKey(orgCompactPath(recordOrg(r))));
        return acc;
      }, {}),
    );
    // 동명 부서(여러 조직)는 상위 경로를 라벨에 붙여 구분. 유일하면 말단 이름만.
    const nameCounts = new Map<string, number>();
    for (const d of rawDepts) nameCounts.set(d.name, (nameCounts.get(d.name) ?? 0) + 1);
    const departments = rawDepts
      .map((d) => ({
        id: d.id,
        name: d.name,
        label: (nameCounts.get(d.name) ?? 0) > 1 ? orgNodeValues(d.id).join(' › ') : d.name,
        total: d.total,
        completed: d.completed,
        achieved: d.achieved,
        navKeys: [...d.navKeys],
        rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
        achievementRate: d.total > 0 ? Math.round((d.achieved / d.total) * 100) : 0,
        avgProgress: d.total > 0 ? Math.round(d.totalProgress / d.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // 상태 분포(완료/진행중/미시작)
    const statusCounts = {
      completed: completedMembers,
      inProgress: records.filter((r) => r.status !== 'not-started' && !isFinalizedRec(r)).length,
      notStarted: records.filter((r) => r.status === 'not-started').length,
    };
    // 달성 분포(완료자 기준): 달성 / 미달성 / 미평가
    const achievedCompleted = records.filter((r) => isFinalizedRec(r) && r.achieved).length;
    const achievement = {
      achieved: achievedCompleted,
      missed: Math.max(0, completedMembers - achievedCompleted),
      pending: Math.max(0, totalMembers - completedMembers),
      rate: totalMembers > 0 ? Math.round((achievedCompleted / totalMembers) * 100) : 0,
    };
    // 성장레벨별(Lv.1~4) 달성/미달성/미평가 — 레벨 필터와 무관하게 항상 전체 분포 표시
    const levelDist = [1, 2, 3, 4].map((level) => {
      const inLevel = filteredRecords.filter((r) => (r.employee.growth_level ?? 1) === level);
      const completed = inLevel.filter((r) => isFinalizedRec(r));
      const achieved = completed.filter((r) => r.achieved).length;
      return {
        label: `Lv.${level}`,
        level,
        achieved,
        missed: completed.length - achieved,
        pending: inLevel.length - completed.length,
      };
    });
    // 점수(1~4점) 분포 — 완료자 기준 반영점수 반올림
    const scoreDist = [1, 2, 3, 4].map((s) => ({
      label: `${s}점`,
      score: s,
      count: records.filter(
        (r) => isFinalizedRec(r) && Math.min(4, Math.max(1, Math.round(r.weightedScore))) === s,
      ).length,
    }));

    return {
      totalMembers,
      completedMembers,
      completionRate,
      achievementRate,
      inProgress,
      departments,
      statusCounts,
      achievement,
      levelDist,
      scoreDist,
      monthlyTrend,
      completionDelta,
    };
  }, [scopedRecords, filteredRecords, trendYear, deptLevel]);

  // 모수(분모)는 전체 대상자(미완료 포함). 점수/달성은 완료(또는 잠금)만 반영(미완료는 빈 과업).
  const hrTrendMembers = useMemo(
    () =>
      scopedRecords.map((r) => ({
        tasks:
          isFinalizedRec(r)
            ? r.tasks.map((t) => ({
                score: t.score,
                weight: t.weight,
                feedbackDate: t.feedback_date,
              }))
            : [],
        growthLevel: Math.max(1, r.employee.growth_level ?? 1),
      })),
    [scopedRecords],
  );

  // 직전연도 비교 — 직전 평가기간(연도-1)의 조직 평균 점수 추이.
  const priorYear = trendYear - 1;
  const priorPeriodId = useMemo(
    () => periods.find((p) => p.evaluation_year === priorYear)?.id ?? null,
    [periods, priorYear],
  );
  const priorEmployees = useMemo(() => records.map((r) => r.employee), [records]);
  const priorRecords = usePriorYearRecords(priorEmployees, priorPeriodId, null, true);
  const priorScoreTrend = useMemo(() => {
    const members = priorRecords
      .filter((r) => matchesOrgNodes(recordOrg(r), orgFilter))
      .filter((r) => selectedLevel === 'all' || (r.employee.growth_level ?? 1) === selectedLevel)
      .map((r) => ({
        tasks:
          isFinalizedRec(r)
            ? r.tasks.map((t) => ({ score: t.score, weight: t.weight, feedbackDate: t.feedback_date }))
            : [],
        growthLevel: Math.max(1, r.employee.growth_level ?? 1),
      }));
    return buildAggregateMonthlyTrend(members, { year: priorYear });
  }, [priorRecords, orgFilter, priorYear, selectedLevel]);

  const deadlineInfo = useMemo(() => {
    const endsOn = selectedPeriod?.ends_on;
    if (!endsOn) return { label: '마감일 미설정', emphasize: false };
    const end = new Date(endsOn);
    if (Number.isNaN(end.getTime())) return { label: '마감일 미설정', emphasize: false };
    const today = new Date();
    end.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays > 0) return { label: `마감 D-${diffDays}`, emphasize: diffDays <= 14 };
    if (diffDays === 0) return { label: '오늘 마감', emphasize: true };
    return { label: `마감 ${-diffDays}일 경과`, emphasize: true };
  }, [selectedPeriod?.ends_on]);

  const handleExportEvaluationData = async () => {
    setIsExportingReport(true);
    try {
      const result = await downloadFullEvaluationDataWorkbook({
        includePastEvaluations: true,
        periodLabel: selectedPeriod?.name ?? null,
      });
      toast({
        title: '평가데이터 다운로드가 완료되었습니다.',
        description: `평가 ${result.evaluationCount ?? 0}건 · 과업 ${result.taskCount ?? 0}건 · 피드백 ${result.feedbackCount ?? 0}건`,
      });
    } catch (error) {
      console.error('평가데이터 다운로드 실패:', error);
      toast({
        title: '평가데이터 다운로드 실패',
        description: '전체 평가 데이터 파일을 생성하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsExportingReport(false);
    }
  };

  return (
    <>
      <PageHeader
        title="전사 현황"
        subtitle={`HR 관리자 · ${trendYear}년 연간 기여도 평가`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {/* AI 요약 보고서 버튼은 임시 제거(나중에 추가개발). 모달·생성 로직은 아래에 보존. */}
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={handleExportEvaluationData}
              disabled={isExportingReport}
            >
              {isExportingReport ? '다운로드 중' : '평가데이터'}
            </button>
          </div>
        }
        filters={
          <>
            <OrgChecklist items={records.map((r) => recordOrg(r))} value={orgFilter} onChange={setOrgFilter} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['all', 1, 2, 3, 4] as const).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setSelectedLevel(lv)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: '1px solid',
                    borderColor: selectedLevel === lv ? 'var(--ok-orange)' : 'var(--border)',
                    background: selectedLevel === lv ? 'var(--ok-orange)' : 'transparent',
                    color: selectedLevel === lv ? '#fff' : 'var(--fg)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {lv === 'all' ? '전체' : `Lv.${lv}`}
                </button>
              ))}
            </div>
          </>
        }
      />

      <div className="flex flex-col gap-5" style={{ padding: '24px 32px 32px' }}>
        {/* 핵심 지표 — 큰 숫자 카드 나열 대신 슬림 스트립(상세 수치는 아래 그래프에서) */}
        <section
          className="sd-card"
          style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '14px 22px', flexWrap: 'wrap' }}
        >
          <KpiStat label="전체 직원" value={`${summary.totalMembers}명`} />
          <KpiDivider />
          <KpiStat label="평가 완료" value={`${summary.completedMembers}명`} accent />
          <KpiDivider />
          <KpiStat label="진행 중" value={`${summary.inProgress}명`} />
          <KpiDivider />
          <KpiStat label="마감" value={deadlineInfo.label} emphasize={deadlineInfo.emphasize} />
        </section>

        {isLoading ? (
          <div className="sd-card">전사 평가 데이터를 불러오는 중입니다.</div>
        ) : (
          <>
            {/* Row 1: 핵심 도넛 — 평가 진행(완료율) · 목표 달성 */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
              <ChartCard
                title="평가 진행"
                subtitle={
                  summary.completionDelta > 0
                    ? `완료율 ▲ +${summary.completionDelta}% vs 전월`
                    : summary.completionDelta < 0
                      ? `완료율 ▼ ${summary.completionDelta}% vs 전월`
                      : '완료율 · 전월 대비 변동 없음'
                }
              >
                <Donut
                  centerValue={`${summary.completionRate}%`}
                  centerLabel="완료율"
                  segments={[
                    { key: 'c', name: '완료', value: summary.statusCounts.completed, color: HR_COLOR.orange },
                    { key: 'i', name: '진행 중', value: summary.statusCounts.inProgress, color: HR_COLOR.amber },
                    { key: 'n', name: '미시작', value: summary.statusCounts.notStarted, color: HR_COLOR.pending },
                  ]}
                />
              </ChartCard>

              <ChartCard title="목표 달성" subtitle="완료자 기준 성장레벨 달성">
                <Donut
                  centerValue={`${summary.achievement.rate}%`}
                  centerLabel="달성률"
                  centerColor={HR_COLOR.achieved}
                  segments={[
                    { key: 'a', name: '달성', value: summary.achievement.achieved, color: HR_COLOR.achieved },
                    { key: 'm', name: '미달성', value: summary.achievement.missed, color: HR_COLOR.missed },
                    { key: 'p', name: '미평가', value: summary.achievement.pending, color: HR_COLOR.pending },
                  ]}
                />
              </ChartCard>
            </section>

            {/* Row 2: 성장레벨 분포 + 점수 분포 */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
              <ChartCard title="성장레벨별 인원 · 달성" subtitle="Lv.1~4 · 달성/미달성/미평가 · 막대 클릭 시 명단">
                <LevelDistChart
                  data={summary.levelDist}
                  onSelect={(level) =>
                    setMemberModal({
                      title: `Lv.${level}`,
                      records: filteredRecords.filter((r) => (r.employee.growth_level ?? 1) === level),
                    })
                  }
                />
              </ChartCard>
              <ChartCard title="점수 분포" subtitle="완료 평가 반영점수(1~4점) · 막대 클릭 시 명단">
                <ScoreDistChart
                  data={summary.scoreDist}
                  onSelect={(score) =>
                    setMemberModal({
                      title: `${score}점`,
                      records: scopedRecords.filter(
                        (r) =>
                          isFinalizedRec(r) &&
                          Math.min(4, Math.max(1, Math.round(r.weightedScore))) === score,
                      ),
                    })
                  }
                />
              </ChartCard>
            </section>

            {/* Row 3: 월별 추이 + 부서별 비교 */}
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
                gap: 20,
                alignItems: 'stretch',
              }}
            >
              <AggregateScoreTrendChart
                members={hrTrendMembers}
                year={trendYear}
                comparison={priorScoreTrend}
                comparisonLabel="전년도"
                title="월별 추이 (조직)"
                subtitle={`${trendYear}년`}
                fill
              />
              <ChartCard
                title="부서별 인원 구성"
                subtitle="달성/미달성/미완료 · 클릭 시 해당 부서로 이동"
                action={
                  <button
                    className="sd-btn sd-btn-ghost sd-btn-sm"
                    style={{ color: 'var(--ok-orange)' }}
                    onClick={() => navigate('/hr/departments')}
                  >
                    전체 보기 →
                  </button>
                }
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {(['division', 'department', 'team'] as DeptLevel[]).map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setDeptLevel(lv)}
                      style={{
                        padding: '3px 12px',
                        borderRadius: 7,
                        fontSize: 'var(--fs-xs)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: `1px solid ${deptLevel === lv ? 'var(--ok-orange)' : 'var(--border)'}`,
                        background: deptLevel === lv ? 'var(--ok-orange-50)' : 'transparent',
                        color: deptLevel === lv ? 'var(--ok-orange)' : 'var(--fg-muted)',
                      }}
                    >
                      {DEPT_LEVEL_LABEL[lv]}
                    </button>
                  ))}
                </div>
                <DeptHeadcountList
                  data={summary.departments.map((d) => ({
                    id: d.id,
                    name: d.label,
                    total: d.total,
                    achieved: d.achieved,
                    missed: Math.max(0, d.completed - d.achieved),
                    pending: Math.max(0, d.total - d.completed),
                    achievementRate: d.achievementRate,
                  }))}
                  sort={deptSort}
                  onSortChange={setDeptSort}
                  rowsVisible={5}
                  onSelect={(id) => {
                    const dept = summary.departments.find((d) => d.id === id);
                    // 필터는 그대로 두고(변경 없이), 선택한 카드만 열린 상태로 부서별 진행으로 이동.
                    const groupKey = dept ? orgNodeValues(dept.id).join(' › ') : '';
                    navigate(
                      `/hr/departments?open=${encodeURIComponent(groupKey)}&lvl=${encodeURIComponent(deptLevel)}`,
                    );
                  }}
                />
              </ChartCard>
            </section>
          </>
        )}
      </div>

      {memberModal && (
        <DashboardMemberModal
          title={memberModal.title}
          records={memberModal.records}
          onClose={() => setMemberModal(null)}
        />
      )}

      {showAiReport && (
        <AiSummaryReportModal
          records={filteredRecords}
          scopeLabel={reportScopeLabel}
          onClose={() => setShowAiReport(false)}
        />
      )}
    </>
  );
};

const KpiStat = ({
  label,
  value,
  accent,
  emphasize,
}: {
  label: string;
  value: string;
  accent?: boolean;
  emphasize?: boolean;
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)' }}>{label}</span>
    <span
      className="tnum"
      style={{
        fontSize: 'var(--fs-h3)',
        fontWeight: 900,
        lineHeight: 1,
        color: emphasize ? 'var(--ok-orange)' : accent ? 'var(--ok-orange)' : 'var(--fg)',
      }}
    >
      {value}
    </span>
  </div>
);

const KpiDivider = () => (
  <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', minHeight: 28 }} />
);

const DASH_STATUS_LABEL: Record<EmployeeEvaluationRecord['reviewStatus'], string> = {
  'not-started': '시작 전',
  draft: '작성 중',
  submitted: '검토 대기',
  evaluating: '평가 중',
  completed: '완료',
  locked: '잠금',
};
const DASH_STATUS_TONE: Record<
  EmployeeEvaluationRecord['reviewStatus'],
  'success' | 'orange' | 'warning' | 'info' | 'neutral'
> = {
  'not-started': 'warning',
  draft: 'warning',
  submitted: 'orange',
  evaluating: 'info',
  completed: 'success',
  locked: 'neutral',
};
// '완료/달성 집계·점수 표시' 대상 = 평가자가 확정(제출/완료/잠금)한 평가만.
// 점수만 들어간 draft(매트릭스 자동점수)는 미확정 → 미평가로 집계(차트·드릴다운·다운로드 공통 기준).
const FINALIZED_STATUSES = new Set(['submitted', 'completed', 'locked']);
const isFinalizedRec = (r: EmployeeEvaluationRecord) =>
  FINALIZED_STATUSES.has(r.reviewStatus);

// 성장레벨·점수 막대 클릭 시 뜨는 대상자 명단 모달(+엑셀 다운로드).
const DashboardMemberModal = ({
  title,
  records,
  onClose,
}: {
  title: string;
  records: EmployeeEvaluationRecord[];
  onClose: () => void;
}) => {
  const { toast } = useToast();
  const { selectedPeriod } = useEvaluationPeriod();
  const handleDownload = () => {
    try {
      const members: DepartmentExportMember[] = records.map((r) => ({
        employeeId: r.employee.employee_id,
        name: r.employee.name,
        position: r.employee.position,
        department: r.employee.department,
        jobRole: r.employee.job_role ?? null,
        growthLevel: r.employee.growth_level,
        evaluatorName: r.evaluation?.evaluator_name ?? r.employee.evaluator_id ?? null,
        reviewStatusLabel: DASH_STATUS_LABEL[r.reviewStatus],
        weightedScore: r.weightedScore,
        isFinalized: isFinalizedRec(r),
        achieved: r.achieved,
        progress: r.progress,
      }));
      const result = downloadDepartmentMembersWorkbook(title, members, selectedPeriod?.name ?? null);
      toast({ title: '명단 다운로드 완료', description: `${title} · ${result.memberCount}명` });
    } catch (error) {
      toast({
        title: '명단 다운로드 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sd-card sd-card-lg"
        style={{ width: 'min(1000px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div className="sd-label-mini">대상자 명단</div>
            <h2 style={{ marginTop: 2, fontSize: 'var(--fs-h3)', fontWeight: 900 }}>{title}</h2>
            <div style={{ marginTop: 6, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>{records.length}명</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={handleDownload} disabled={records.length === 0}>
              <Download size={14} />
              엑셀 다운로드
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose}>
              <X size={16} />
              닫기
            </button>
          </div>
        </div>

        <div style={{ overflow: 'auto', padding: '0 4px 4px' }}>
          {records.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-muted)' }}>해당하는 대상자가 없습니다.</div>
          ) : (
            <Table>
              <TableHeader style={{ background: 'var(--bg-muted)' }}>
                <TableRow>
                  <TableHead>사번</TableHead>
                  <TableHead>이름</TableHead>
                  <TableHead>직책</TableHead>
                  <TableHead>부서</TableHead>
                  <TableHead>레벨</TableHead>
                  <TableHead>평가자</TableHead>
                  <TableHead>점수</TableHead>
                  <TableHead>달성</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => {
                  const fin = isFinalizedRec(r);
                  return (
                    <TableRow key={r.employee.id}>
                      <TableCell style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {r.employee.employee_id}
                      </TableCell>
                      <TableCell style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{r.employee.name}</TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>{r.employee.position}</TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{r.employee.department || '-'}</TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>{r.employee.growth_level ? `Lv.${r.employee.growth_level}` : '-'}</TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {r.evaluation?.evaluator_name ?? r.employee.evaluator_id ?? '-'}
                      </TableCell>
                      <TableCell className="tnum">
                        {fin ? (
                          <span style={{ fontWeight: 800, color: r.achieved ? 'var(--ok-orange)' : 'var(--fg)' }}>
                            {r.weightedScore.toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--fg-muted)' }}>-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {fin ? (
                          r.achieved ? <Pill tone="success">달성</Pill> : <Pill tone="warning">미달성</Pill>
                        ) : (
                          <span style={{ color: 'var(--fg-muted)' }}>-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Pill tone={DASH_STATUS_TONE[r.reviewStatus]}>{DASH_STATUS_LABEL[r.reviewStatus]}</Pill>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
};

export default HrHome;
