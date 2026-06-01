import { useMemo } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamDashboardRecords } from '@/hooks/useDashboardRecords';
import { getScoreColor } from '@/lib/evaluationMatrix';

const monthLabels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const MONTH_SPAN = monthLabels.length; // 12

const toMonthFraction = (value?: string | null) => {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.min(MONTH_SPAN - 0.05, Math.max(0, date.getMonth() + (date.getDate() - 1) / 31));
};

const EvaluatorSchedulePage = () => {
  const { user } = useAuth();
  const { records, isLoading, error } = useTeamDashboardRecords(user?.employeeId || '');

  const today = new Date();
  const todayFrac = Math.max(0, Math.min(1, (today.getMonth() + (today.getDate() - 1) / 31) / MONTH_SPAN));

  const totalMembers = records.length;

  return (
    <>
      <PageHeader
        title="전체 일정"
        subtitle="팀원별 평가 데드라인 · 2026 연간"
      />

      <div style={{ padding: '24px 32px 32px' }}>
        <div className="sd-card sd-card-lg">
          {isLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>팀 일정 데이터를 불러오는 중입니다.</div>
          ) : error ? (
            <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-body)' }}>{error}</div>
          ) : (
            <div>
              {/* Column headers */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '260px 1fr',
                  gap: 0,
                  paddingBottom: 12,
                  borderBottom: '1px solid var(--border)',
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  color: 'var(--fg-muted)',
                }}
              >
                <div>팀원 / 과업</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${monthLabels.length}, 1fr)`,
                  }}
                >
                  {monthLabels.map((m) => (
                    <div key={m} style={{ textAlign: 'center' }}>{m}</div>
                  ))}
                </div>
              </div>

              {/* Members */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 20 }}>
                {records.map((record) => (
                  <div key={record.employee.employee_id}>
                    {/* Member row header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: 'var(--ok-orange)',
                          color: '#fff',
                          fontSize: 'var(--fs-body)',
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {record.employee.name.charAt(0)}
                      </div>
                      <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{record.employee.name}</span>
                      <span style={{ fontSize: 'var(--fs-body)', color: 'var(--fg-muted)' }}>
                        {record.employee.position} · Lv.{record.employee.growth_level ?? 1} · {record.employee.department}
                      </span>
                      {(() => {
                        const evaluated = record.completedTasks > 0 && record.completedTasks === record.totalTasks;
                        if (!evaluated) {
                          return (
                            <span
                              style={{
                                padding: '2px 10px',
                                borderRadius: 12,
                                background: 'var(--bg-muted)',
                                color: 'var(--fg-muted)',
                                border: '1px solid var(--border)',
                                fontSize: 'var(--fs-sm)',
                                fontWeight: 700,
                              }}
                            >
                              미완료
                            </span>
                          );
                        }
                        return (
                          <span
                            style={{
                              padding: '2px 10px',
                              borderRadius: 12,
                              background: record.achieved ? 'var(--ok-orange-50)' : 'var(--warning-bg)',
                              color: record.achieved ? 'var(--ok-orange)' : 'var(--ok-orange-700)',
                              border: '1px solid var(--ok-orange-100)',
                              fontSize: 'var(--fs-sm)',
                              fontWeight: 700,
                            }}
                          >
                            {record.achieved ? '달성' : '미달성'}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Task rows */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {record.tasks.map((task, index) => {
                        const start = toMonthFraction(task.start_date);
                        const end = Math.max(start + 0.25, toMonthFraction(task.end_date));
                        const left = (start / MONTH_SPAN) * 100;
                        const width = ((end - start) / MONTH_SPAN) * 100;
                        const color = getScoreColor(task.score);

                        return (
                          <div
                            key={task.task_id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '260px 1fr',
                              gap: 0,
                              alignItems: 'center',
                            }}
                          >
                            <div
                              style={{
                                paddingLeft: 42,
                                fontSize: 'var(--fs-sm)',
                                color: 'var(--fg-muted)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                paddingRight: 12,
                              }}
                            >
                              <span style={{ fontWeight: 700, color: 'var(--fg)' }}>
                                T{String(index + 1).padStart(2, '0')}
                              </span>{' '}
                              · {task.title}
                            </div>

                            <div
                              style={{
                                position: 'relative',
                                height: 22,
                                background: 'var(--bg-muted)',
                                borderRadius: 4,
                                overflow: 'visible',
                              }}
                            >
                              {/* Month gridlines */}
                              {monthLabels.map((_, mi) => (
                                <div
                                  key={mi}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    left: `${(mi * 100) / MONTH_SPAN}%`,
                                    width: 1,
                                    background: 'var(--border)',
                                  }}
                                />
                              ))}
                              {/* Today marker */}
                              <div
                                style={{
                                  position: 'absolute',
                                  top: -4,
                                  bottom: -4,
                                  left: `${todayFrac * 100}%`,
                                  width: 2,
                                  background: '#F55000',
                                  zIndex: 2,
                                  borderRadius: 1,
                                }}
                              />
                              {/* Task bar */}
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 2,
                                  bottom: 2,
                                  left: `${left}%`,
                                  width: `${Math.max(2, width)}%`,
                                  background: color,
                                  borderRadius: 3,
                                  opacity: 0.9,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {!record.tasks.length && (
                        <div style={{ paddingLeft: 42, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                          등록된 과업이 없습니다.
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {!totalMembers && (
                  <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>표시할 팀 일정이 없습니다.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default EvaluatorSchedulePage;
