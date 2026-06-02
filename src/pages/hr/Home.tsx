import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AggregateScoreTrendChart from '@/components/Evaluation/AggregateScoreTrendChart';
import PageHeader from '@/components/Layout/PageHeader';
import { useCompanyDashboardRecords, usePriorYearRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useToast } from '@/hooks/use-toast';
import { downloadFullEvaluationDataWorkbook } from '@/utils/hrDataExport';
import OrgFilterBar from '@/components/hr/OrgFilterBar';
import { buildAggregateMonthlyTrend } from '@/lib/scoreTrend';
import { matchesOrgFilter, type OrgFilterState } from '@/lib/orgHierarchy';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

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
  const { selectedPeriod, periods } = useEvaluationPeriod();
  const { toast } = useToast();
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({});

  const filteredRecords = useMemo(
    () => records.filter((r) => matchesOrgFilter(r.employee, orgFilter)),
    [records, orgFilter],
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
    const records = filteredRecords;
    const totalMembers = records.length;
    const completedMembers = records.filter((r) => r.status === 'completed').length;
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

    const departments = Object.values(
      records.reduce<
        Record<string, { name: string; total: number; completed: number; totalProgress: number }>
      >((acc, r) => {
        const key = r.employee.department || '미지정';
        if (!acc[key]) acc[key] = { name: key, total: 0, completed: 0, totalProgress: 0 };
        acc[key].total += 1;
        acc[key].completed += r.status === 'completed' ? 1 : 0;
        acc[key].totalProgress += r.progress;
        return acc;
      }, {}),
    )
      .map((d) => ({
        ...d,
        rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
        avgProgress: d.total > 0 ? Math.round(d.totalProgress / d.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const recentActivities = records
      .flatMap((r) =>
        r.tasks.flatMap((t) =>
          (t.feedbackHistory ?? []).map((fb) => ({
            text: `${fb.evaluatorName ?? '평가자'}이(가) ${r.employee.name}의 평가를 완료했습니다.`,
            date: fb.date ?? fb.created_at ?? '',
          })),
        ),
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);

    return {
      totalMembers,
      completedMembers,
      completionRate,
      achievementRate,
      inProgress,
      departments,
      recentActivities,
      monthlyTrend,
      completionDelta,
    };
  }, [filteredRecords, trendYear]);

  // 모수(분모)는 전체 대상자(미완료 포함). 점수/달성은 완료(또는 잠금)만 반영(미완료는 빈 과업).
  const hrTrendMembers = useMemo(
    () =>
      filteredRecords.map((r) => ({
        tasks:
          r.reviewStatus === 'completed' || r.reviewStatus === 'locked'
            ? r.tasks.map((t) => ({
                score: t.score,
                weight: t.weight,
                feedbackDate: t.feedback_date,
              }))
            : [],
        growthLevel: Math.max(1, r.employee.growth_level ?? 1),
      })),
    [filteredRecords],
  );

  // 직전연도 비교 — 직전 평가기간(연도-1)의 조직 평균 점수 추이.
  const priorYear = trendYear - 1;
  const priorPeriodId = useMemo(
    () => periods.find((p) => p.evaluation_year === priorYear)?.id ?? null,
    [periods, priorYear],
  );
  const priorEmployees = useMemo(() => records.map((r) => r.employee), [records]);
  const priorRecords = usePriorYearRecords(priorEmployees, priorPeriodId);
  const priorScoreTrend = useMemo(() => {
    const members = priorRecords
      .filter((r) => matchesOrgFilter(r.employee, orgFilter))
      .map((r) => ({
        tasks:
          r.reviewStatus === 'completed' || r.reviewStatus === 'locked'
            ? r.tasks.map((t) => ({ score: t.score, weight: t.weight, feedbackDate: t.feedback_date }))
            : [],
        growthLevel: Math.max(1, r.employee.growth_level ?? 1),
      }));
    return buildAggregateMonthlyTrend(members, { year: priorYear });
  }, [priorRecords, orgFilter, priorYear]);

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

  const formatRelativeTime = (dateStr: string) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.round(hours / 24)}일 전`;
  };

  const handleExportEvaluationData = async () => {
    setIsExportingReport(true);
    try {
      const result = await downloadFullEvaluationDataWorkbook({ includePastEvaluations: true });
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
        title="HR 관리자 대시보드"
        subtitle="2026 연간 기여도 평가 · 전사 현황"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={handleExportEvaluationData}
              disabled={isExportingReport}
            >
              {isExportingReport ? '다운로드 중' : '평가데이터'}
            </button>
          </div>
        }
      />

      <div className="flex flex-col gap-5" style={{ padding: '24px 32px 32px' }}>
        <OrgFilterBar
          items={records.map((r) => r.employee)}
          value={orgFilter}
          onChange={setOrgFilter}
        />
        {/* Stat cards */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          {/* Total */}
          <div className="sd-card" style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)', marginBottom: 10 }}>
              전체 직원
            </div>
            <div style={{ fontSize: 'var(--fs-display)', fontWeight: 900, lineHeight: 1 }}>{summary.totalMembers}</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 6 }}>
              완성 평가자 {summary.completedMembers}
            </div>
          </div>

          {/* Completion rate — highlighted */}
          <div
            className="sd-card"
            style={{
              padding: '20px 22px',
              background: 'var(--ok-orange)',
              border: 'none',
            }}
          >
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>
              완료율
            </div>
            <div style={{ fontSize: 'var(--fs-display)', fontWeight: 900, color: '#fff', lineHeight: 1 }}>
              {summary.completionRate}%
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,0.75)', marginTop: 6 }}>
              {summary.completedMembers} / {summary.totalMembers}
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: '#FFD4B8', marginTop: 4, fontWeight: 700 }}>
              {summary.completionDelta > 0
                ? `↑ +${summary.completionDelta}%`
                : summary.completionDelta < 0
                ? `↓ ${summary.completionDelta}%`
                : '변동 없음'}{' '}
              <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>vs 전월</span>
            </div>
          </div>

          {/* Achievement rate */}
          <div className="sd-card" style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)', marginBottom: 10 }}>
              달성률
            </div>
            <div style={{ fontSize: 'var(--fs-display)', fontWeight: 900, lineHeight: 1 }}>
              {summary.achievementRate}%
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 6 }}>목표 Lv. 이상</div>
          </div>

          {/* In progress */}
          <div className="sd-card" style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)', marginBottom: 10 }}>
              진행 중
            </div>
            <div style={{ fontSize: 'var(--fs-display)', fontWeight: 900, lineHeight: 1 }}>{summary.inProgress}</div>
            <div
              style={{
                fontSize: 'var(--fs-sm)',
                color: deadlineInfo.emphasize ? 'var(--ok-orange)' : 'var(--fg-muted)',
                marginTop: 6,
                fontWeight: deadlineInfo.emphasize ? 700 : 500,
              }}
            >
              {deadlineInfo.label}
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="sd-card">전사 평가 데이터를 불러오는 중입니다.</div>
        ) : (
          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) 320px', gap: 20 }}>
            {/* Left column */}
            <div className="flex flex-col gap-5">
              {/* Weekly completion trend chart */}
              <AggregateScoreTrendChart
                members={hrTrendMembers}
                year={trendYear}
                comparison={priorScoreTrend}
                comparisonLabel="전년도"
                title="월별 추이 (조직)"
                subtitle={`${trendYear}년`}
              />

              {/* Recent activity */}
              <div className="sd-card sd-card-lg">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>최근 시스템 활동</h3>
                  <button
                    className="sd-btn sd-btn-ghost sd-btn-sm"
                    style={{ color: 'var(--ok-orange)' }}
                    onClick={() => navigate('/notifications')}
                  >
                    전체 보기 →
                  </button>
                </div>
                <div className="flex flex-col gap-0">
                  {summary.recentActivities.length > 0 ? (
                    summary.recentActivities.map((act, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          padding: '10px 0',
                          borderBottom: i < summary.recentActivities.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: i === 0 ? '#F55000' : 'var(--fg-muted)',
                            marginTop: 5,
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 'var(--fs-body)', color: 'var(--fg)' }}>{act.text}</span>
                        </div>
                        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                          {formatRelativeTime(act.date)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 'var(--fs-body)', color: 'var(--fg-muted)' }}>최근 활동이 없습니다.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: department bar list */}
            <div className="sd-card sd-card-lg">
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 18 }}>부서별 진행률</h3>
              <div className="flex flex-col gap-4">
                {summary.departments.map((dept) => {
                  const barColor =
                    dept.rate >= 80 ? '#16A34A' : dept.rate >= 60 ? '#F55000' : '#FFAA00';
                  return (
                    <div key={dept.name}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>{dept.name}</span>
                        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                          {dept.completed}/{dept.total} · {dept.rate}%
                        </span>
                      </div>
                      <div
                        style={{
                          height: 8,
                          background: 'var(--bg-muted)',
                          borderRadius: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${dept.rate}%`,
                            background: barColor,
                            borderRadius: 4,
                            transition: 'width 0.4s',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}

                {!summary.departments.length && (
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--fg-muted)' }}>부서 데이터가 없습니다.</div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
};

export default HrHome;
