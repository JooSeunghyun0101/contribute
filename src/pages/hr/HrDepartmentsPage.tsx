import { useMemo } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { Pill } from '@/components/brand';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { getScoreColor } from '@/lib/evaluationMatrix';

const scoreBands = [4, 3, 2, 1] as const;

const HrDepartmentsPage = () => {
  const { records, isLoading, error } = useCompanyDashboardRecords();

  const departments = useMemo(
    () =>
      Object.values(
        records.reduce<
          Record<
            string,
            {
              name: string;
              totalMembers: number;
              completedMembers: number;
              achievedMembers: number;
              totalProgress: number;
              totalScore: number;
              scoreCounts: Record<1 | 2 | 3 | 4, number>;
            }
          >
        >((acc, record) => {
          const key = record.employee.department || '미지정';

          if (!acc[key]) {
            acc[key] = {
              name: key,
              totalMembers: 0,
              completedMembers: 0,
              achievedMembers: 0,
              totalProgress: 0,
              totalScore: 0,
              scoreCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
            };
          }

          acc[key].totalMembers += 1;
          acc[key].completedMembers += record.status === 'completed' ? 1 : 0;
          acc[key].achievedMembers += record.achieved ? 1 : 0;
          acc[key].totalProgress += record.progress;
          acc[key].totalScore += record.weightedScore;

          const rounded = Math.round(record.weightedScore);
          if (rounded >= 1 && rounded <= 4) {
            acc[key].scoreCounts[rounded as 1 | 2 | 3 | 4] += 1;
          }

          return acc;
        }, {}),
      )
        .map((department) => {
          const completionRate =
            department.totalMembers > 0
              ? Math.round((department.completedMembers / department.totalMembers) * 100)
              : 0;
          const achievementRate =
            department.totalMembers > 0
              ? Math.round((department.achievedMembers / department.totalMembers) * 100)
              : 0;
          const averageProgress =
            department.totalMembers > 0
              ? Math.round(department.totalProgress / department.totalMembers)
              : 0;
          const averageScore =
            department.totalMembers > 0
              ? (department.totalScore / department.totalMembers).toFixed(1)
              : '0.0';

          return {
            ...department,
            completionRate,
            achievementRate,
            averageProgress,
            averageScore,
          };
        })
        .sort((a, b) => b.totalMembers - a.totalMembers),
    [records],
  );

  const averageCompletion =
    departments.length > 0
      ? Math.round(departments.reduce((sum, department) => sum + department.completionRate, 0) / departments.length)
      : 0;

  return (
    <>
      <PageHeader
        title="부서별 진행 현황"
        subtitle="부서 단위 완료율, 목표 달성률, 점수 분포를 한 화면에서 확인합니다."
        actions={<Pill tone="orange">{departments.length}개 부서</Pill>}
      />

      <div className="flex flex-col gap-5" style={{ padding: '24px 32px 32px' }}>
        {isLoading ? (
          <div className="sd-card">부서 데이터를 불러오는 중입니다.</div>
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <section
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
          >
            {departments.map((department) => (
              <div key={department.name} className="sd-card sd-card-lg">
                <div className="flex items-center justify-between gap-3">
                  <h3>{department.name}</h3>
                  <Pill
                    tone={
                      department.completionRate >= 80
                        ? 'success'
                        : department.completionRate >= 60
                        ? 'orange'
                        : 'warning'
                    }
                  >
                    {department.completionRate}%
                  </Pill>
                </div>

                <div style={{ marginTop: 16, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span
                    className="tnum"
                    style={{ fontSize: 'var(--fs-display)', fontWeight: 900, color: 'var(--ok-orange)', lineHeight: 1 }}
                  >
                    {department.completedMembers}
                  </span>
                  <span className="tnum" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-h4)' }}>
                    / {department.totalMembers}
                  </span>
                </div>
                <div style={{ marginTop: 4, color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>평가 완료 인원</div>

                <div className="sd-bar" style={{ marginTop: 12, height: 8 }}>
                  <div className="sd-bar-fill" style={{ width: `${department.averageProgress}%` }} />
                </div>

                <div
                  style={{
                    marginTop: 14,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 8,
                  }}
                >
                  {[
                    { label: '평균 진행률', value: `${department.averageProgress}%` },
                    { label: '목표 달성', value: `${department.achievementRate}%` },
                    { label: '평균 점수', value: department.averageScore },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{ padding: 12, borderRadius: 10, background: 'var(--bg-muted)' }}
                    >
                      <div className="sd-label-mini">{item.label}</div>
                      <div style={{ marginTop: 4, fontWeight: 800 }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: 16,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 8,
                    alignItems: 'end',
                  }}
                >
                  {scoreBands.map((score) => {
                    const count = department.scoreCounts[score];
                    const ratio =
                      department.totalMembers > 0
                        ? Math.round((count / department.totalMembers) * 100)
                        : 0;

                    return (
                      <div key={score} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <div
                          style={{
                            width: '100%',
                            height: 44,
                            display: 'flex',
                            alignItems: 'flex-end',
                          }}
                        >
                          <div
                            style={{
                              width: '100%',
                              height: `${Math.max(6, Math.round(ratio * 0.44))}px`,
                              borderRadius: 4,
                              background: getScoreColor(score),
                            }}
                          />
                        </div>
                        <div className="sd-label-mini">{score}점</div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>{ratio}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {!departments.length && <div className="sd-card">표시할 부서 데이터가 없습니다.</div>}
          </section>
        )}
      </div>
    </>
  );
};

export default HrDepartmentsPage;
