import { useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamDashboardRecords } from '@/hooks/useDashboardRecords';
import { getScoreColor } from '@/lib/evaluationMatrix';
import { FilterChip } from '@/components/brand';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const monthLabels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const MONTH_SPAN = monthLabels.length; // 12

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date);
};

// 날짜를 연간(1~12월) 축에서의 위치(0~1)로 변환한다.
// 월 내 위치는 해당 월의 실제 일수로 나눠 일(day) 단위까지 정확히 맞춘다.
// 누락/파싱 실패 시 null을 반환해, 호출부에서 "기간 미정"으로 처리할 수 있게 한다.
const toYearFraction = (value?: string | null): number | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const frac = (date.getMonth() + (date.getDate() - 1) / daysInMonth) / MONTH_SPAN;
  return Math.min(0.999, Math.max(0, frac));
};

const GRID_COLUMNS = '220px 1fr 88px';

type StatusFilter = 'all' | 'incomplete' | 'achieved' | 'missed';

const isMemberEvaluated = (record: EmployeeEvaluationRecord) =>
  record.completedTasks > 0 && record.completedTasks === record.totalTasks;

const EvaluatorSchedulePage = () => {
  const { user } = useAuth();
  const { records, isLoading, error } = useTeamDashboardRecords(user?.employeeId || '');

  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const today = new Date();
  const todayDaysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const todayFrac = Math.max(
    0,
    Math.min(1, (today.getMonth() + (today.getDate() - 1) / todayDaysInMonth) / MONTH_SPAN),
  );

  const visibleRecords = useMemo(
    () =>
      records.filter((record) => {
        if (memberFilter !== 'all' && record.employee.employee_id !== memberFilter) return false;
        if (statusFilter !== 'all') {
          const evaluated = isMemberEvaluated(record);
          if (statusFilter === 'incomplete') return !evaluated;
          if (statusFilter === 'achieved') return evaluated && record.achieved;
          if (statusFilter === 'missed') return evaluated && !record.achieved;
        }
        return true;
      }),
    [records, memberFilter, statusFilter],
  );

  const statusOptions: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'incomplete', label: '미완료' },
    { key: 'achieved', label: '달성' },
    { key: 'missed', label: '미달성' },
  ];

  return (
    <>
      <PageHeader
        title="전체 일정"
        subtitle="팀원별 평가 데드라인 · 2026 연간"
        filters={
          !isLoading && !error && records.length > 0 ? (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 'var(--fs-xs)',
                    fontWeight: 800,
                    color: 'var(--fg-subtle)',
                    letterSpacing: '0.06em',
                    marginRight: 2,
                  }}
                >
                  팀원
                </span>
                <FilterChip active={memberFilter === 'all'} onClick={() => setMemberFilter('all')}>
                  전체 {records.length}명
                </FilterChip>
                {records.map((record) => (
                  <FilterChip
                    key={record.employee.employee_id}
                    active={memberFilter === record.employee.employee_id}
                    onClick={() => setMemberFilter(record.employee.employee_id)}
                  >
                    {record.employee.name}
                  </FilterChip>
                ))}
              </div>

              <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', minHeight: 24 }} />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 'var(--fs-xs)',
                    fontWeight: 800,
                    color: 'var(--fg-subtle)',
                    letterSpacing: '0.06em',
                    marginRight: 2,
                  }}
                >
                  상태
                </span>
                {statusOptions.map((option) => (
                  <FilterChip
                    key={option.key}
                    active={statusFilter === option.key}
                    onClick={() => setStatusFilter(option.key)}
                  >
                    {option.label}
                  </FilterChip>
                ))}
              </div>
            </>
          ) : undefined
        }
      />

      <div style={{ padding: '24px 32px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {isLoading ? (
          <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
            팀 일정 데이터를 불러오는 중입니다.
          </div>
        ) : error ? (
          <div className="sd-card sd-card-lg" style={{ color: 'var(--danger)', fontSize: 'var(--fs-body)' }}>
            {error}
          </div>
        ) : !records.length ? (
          <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
            표시할 팀 일정이 없습니다.
          </div>
        ) : !visibleRecords.length ? (
          <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
            선택한 조건에 맞는 팀원이 없습니다.
          </div>
        ) : (
          // 피평가자별로 독립된 카드로 분리해 구분이 명확하게 보이도록 한다.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {visibleRecords.map((record) => {
              const evaluated = isMemberEvaluated(record);
              return (
                <section
                  key={record.employee.employee_id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'var(--bg-card)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  {/* 팀원 헤더 밴드 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 18px',
                      background: 'var(--ok-orange-50)',
                      borderBottom: '1px solid var(--ok-orange-100)',
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--ok-orange)',
                        color: '#fff',
                        fontSize: 'var(--fs-h4)',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {record.employee.name.charAt(0)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--ok-brown)' }}>
                          {record.employee.name}
                        </span>
                        {evaluated ? (
                          <span
                            style={{
                              padding: '2px 10px',
                              borderRadius: 12,
                              background: record.achieved ? 'var(--ok-orange)' : 'var(--bg-card)',
                              color: record.achieved ? '#fff' : 'var(--ok-orange-700)',
                              border: '1px solid var(--ok-orange-100)',
                              fontSize: 'var(--fs-xs)',
                              fontWeight: 800,
                            }}
                          >
                            {record.achieved ? '달성' : '미달성'}
                          </span>
                        ) : (
                          <span
                            style={{
                              padding: '2px 10px',
                              borderRadius: 12,
                              background: 'var(--bg-muted)',
                              color: 'var(--fg-muted)',
                              border: '1px solid var(--border)',
                              fontSize: 'var(--fs-xs)',
                              fontWeight: 800,
                            }}
                          >
                            미완료
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>
                        {record.employee.position} · Lv.{record.employee.growth_level ?? 1} ·{' '}
                        {record.employee.department} · 과업 {record.tasks.length}건
                      </div>
                    </div>
                  </div>

                  {/* 본문: 월 축 헤더 + 과업 타임라인 (카드 내부에서 자체 정렬) */}
                  <div style={{ padding: '14px 18px' }}>
                    {/* 월 축 헤더 */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: GRID_COLUMNS,
                        gap: 14,
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid var(--border)',
                        fontSize: 'var(--fs-xs)',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        color: 'var(--fg-muted)',
                      }}
                    >
                      <div>과업</div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `repeat(${monthLabels.length}, 1fr)`,
                        }}
                      >
                        {monthLabels.map((m) => (
                          <div key={m} style={{ textAlign: 'center' }}>
                            {m}
                          </div>
                        ))}
                      </div>
                      <div style={{ textAlign: 'right' }}>점수</div>
                    </div>

                    {/* 과업 행 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                      {record.tasks.map((task, index) => {
                        const startF = toYearFraction(task.start_date);
                        const endF = toYearFraction(task.end_date);
                        // 시작·종료 중 한쪽만 있으면 그 값을 양끝으로 사용. 둘 다 없으면 기간 미정.
                        const hasSchedule = startF != null || endF != null;
                        const s = startF ?? endF ?? 0;
                        const e = endF ?? startF ?? 0;
                        const left = Math.min(s, e) * 100;
                        const width = Math.abs(e - s) * 100;
                        const color = getScoreColor(task.score);

                        return (
                          <div
                            key={task.task_id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: GRID_COLUMNS,
                              gap: 14,
                              alignItems: 'center',
                            }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <div
                                className="sd-chip"
                                style={{ background: color, color: '#fff', borderColor: color }}
                              >
                                T{String(index + 1).padStart(2, '0')}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 'var(--fs-body)',
                                    fontWeight: 700,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {task.title}
                                </div>
                                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 3 }}>
                                  {formatDate(task.start_date)} – {formatDate(task.end_date)}
                                </div>
                              </div>
                            </div>

                            <div
                              style={{
                                position: 'relative',
                                height: 28,
                                background: 'var(--bg-muted)',
                                borderRadius: 6,
                              }}
                            >
                              {/* 월 구분선 */}
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
                              {/* 오늘 표시 */}
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  left: `${todayFrac * 100}%`,
                                  width: 2,
                                  background: '#F55000',
                                  zIndex: 2,
                                }}
                              />
                              {/* 과업 막대 — 날짜가 있을 때만. 없으면 기간 미정 */}
                              {hasSchedule ? (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: 3,
                                    bottom: 3,
                                    left: `${left}%`,
                                    width: `${Math.max(4, width)}%`,
                                    background: color,
                                    borderRadius: 4,
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 8px',
                                    color: '#fff',
                                    fontSize: 'var(--fs-xs)',
                                    fontWeight: 700,
                                    overflow: 'hidden',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={`${task.start_date ?? '미정'} ~ ${task.end_date ?? '미정'}`}
                                >
                                  {task.contribution_method || '미정'} · {task.contribution_scope || '미정'}
                                </div>
                              ) : (
                                <span
                                  style={{
                                    position: 'absolute',
                                    left: 8,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    fontSize: 'var(--fs-xs)',
                                    color: 'var(--fg-subtle)',
                                    fontWeight: 600,
                                  }}
                                >
                                  기간 미정
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <div className="sd-chip">{task.score ?? '-'}</div>
                            </div>
                          </div>
                        );
                      })}

                      {!record.tasks.length && (
                        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                          등록된 과업이 없습니다.
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

export default EvaluatorSchedulePage;
