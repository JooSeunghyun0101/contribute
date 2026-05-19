import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import PageHeader from '@/components/Layout/PageHeader';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useToast } from '@/hooks/use-toast';
import { downloadFullEvaluationDataWorkbook } from '@/utils/hrDataExport';

const weeklyData = [
  { label: '3월 1주', value: 28 },
  { label: '2주', value: 34 },
  { label: '3주', value: 38 },
  { label: '4주', value: 41 },
  { label: '4월 1주', value: 52 },
  { label: '2주', value: 60 },
  { label: '3주', value: 67 },
  { label: '현재', value: 72 },
];

const HrHome = () => {
  const { records, isLoading } = useCompanyDashboardRecords();
  const { toast } = useToast();
  const [isExportingReport, setIsExportingReport] = useState(false);

  const summary = useMemo(() => {
    const totalMembers = records.length;
    const completedMembers = records.filter((r) => r.status === 'completed').length;
    const achievedMembers = records.filter((r) => r.achieved).length;
    const inProgress = records.filter((r) => r.status !== 'completed').length;
    const completionRate =
      totalMembers > 0 ? Math.round((completedMembers / totalMembers) * 100) : 0;
    const achievementRate =
      totalMembers > 0 ? Math.round((achievedMembers / totalMembers) * 100) : 0;

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

    return { totalMembers, completedMembers, completionRate, achievementRate, inProgress, departments, recentActivities };
  }, [records]);

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
            <button className="sd-btn sd-btn-primary sd-btn-sm">평가 설정</button>
          </div>
        }
      />

      <div className="flex flex-col gap-5" style={{ padding: '24px 32px 32px' }}>
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
              ↑ +8%
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
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 6 }}>마감 D-7</div>
          </div>
        </section>

        {isLoading ? (
          <div className="sd-card">전사 평가 데이터를 불러오는 중입니다.</div>
        ) : (
          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) 320px', gap: 20 }}>
            {/* Left column */}
            <div className="flex flex-col gap-5">
              {/* Weekly completion trend chart */}
              <div className="sd-card sd-card-lg">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                  <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>주간 완료율 추이</h3>
                  <span
                    style={{
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 12,
                      background: 'var(--bg-muted)',
                      border: '1px solid var(--border)',
                      color: 'var(--fg-muted)',
                    }}
                  >
                    최근 8주
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={weeklyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F55000" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#F55000" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 'var(--fs-xs)', fill: 'var(--fg-muted)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 'var(--fs-xs)', fill: 'var(--fg-muted)' }}
                      domain={[0, 100]}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(v) => [`${v}%`, '완료율']}
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid var(--border)',
                        fontSize: 'var(--fs-body)',
                        background: 'var(--bg-card)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#F55000"
                      strokeWidth={2.5}
                      fill="url(#areaGrad)"
                      dot={{ r: 4, fill: '#F55000', strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: '#F55000', strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Recent activity */}
              <div className="sd-card sd-card-lg">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>최근 시스템 활동</h3>
                  <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ color: 'var(--ok-orange)' }}>
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
