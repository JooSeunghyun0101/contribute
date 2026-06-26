import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { getScoreColor } from '@/lib/evaluationMatrix';

const monthLabels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const MONTH_SPAN = monthLabels.length; // 12

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date);
};

const toMonthFraction = (value?: string) => {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.min(MONTH_SPAN - 0.05, date.getMonth() + (date.getDate() - 1) / 31);
};

const MySchedulePage = () => {
  const { user } = useAuth();
  const { evaluationData, isLoading } = useEvaluationDataDB(user?.employeeId || '', { readOnly: true });
  const tasks = evaluationData?.tasks ?? [];

  const today = new Date();
  const todayFrac = Math.max(0, Math.min(1, (today.getMonth() + (today.getDate() - 1) / 31) / MONTH_SPAN));

  return (
    <>
      <PageHeader
        title="과업 일정"
        subtitle="연간 타임라인 · 오늘 기준 진행률"
      />

      <div className="flex flex-col gap-5" style={{ padding: '28px 32px 32px' }}>
        {/* Gantt timeline — main content */}
        <section className="sd-card sd-card-lg">
          <div className="sd-label-mini">Schedule</div>
          <h2 style={{ marginTop: 4 }}>과업 타임라인</h2>
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)', marginTop: 4 }}>
            연간 기준 시작일과 종료일을 월 단위로 정리했습니다.
          </p>

          {isLoading ? (
            <div style={{ marginTop: 18, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>일정 데이터를 불러오는 중입니다.</div>
          ) : (
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
              {/* Header row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '220px 22px 1fr 88px',
                  gap: 14,
                  alignItems: 'center',
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--border)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--fg-muted)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                }}
              >
                <div>과업</div>
                <div />
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${monthLabels.length}, 1fr)` }}>
                  {monthLabels.map((month) => (
                    <div key={month} style={{ textAlign: 'center' }}>
                      {month}
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: 'right' }}>점수</div>
              </div>

              {tasks.map((task, index) => {
                const start = toMonthFraction(task.startDate);
                const end = Math.max(start + 0.3, toMonthFraction(task.endDate));
                const left = (start / MONTH_SPAN) * 100;
                const width = ((end - start) / MONTH_SPAN) * 100;
                const color = getScoreColor(task.score);

                return (
                  <div
                    key={task.id}
                    style={{ display: 'grid', gridTemplateColumns: '220px 22px 1fr 88px', gap: 14, alignItems: 'center' }}
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
                          {formatDate(task.startDate)} – {formatDate(task.endDate)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      {task.isAiTask && (
                        <span
                          style={{
                            padding: '0 4px',
                            borderRadius: 999,
                            fontSize: 'var(--fs-2xs)',
                            fontWeight: 800,
                            color: 'var(--ai-accent)',
                            background: 'var(--ai-accent-bg)',
                          }}
                        >
                          AI
                        </span>
                      )}
                    </div>

                    <div style={{ position: 'relative', height: 28, background: 'var(--bg-muted)', borderRadius: 6 }}>
                      {/* Month gridlines */}
                      {monthLabels.map((_, monthIndex) => (
                        <div
                          key={monthIndex}
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: `${(monthIndex * 100) / MONTH_SPAN}%`,
                            width: 1,
                            background: 'var(--border)',
                          }}
                        />
                      ))}
                      {/* Today marker */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${todayFrac * 100}%`,
                          width: 2,
                          background: 'var(--ok-orange-brand)',
                          zIndex: 2,
                        }}
                      />
                      {/* Task bar */}
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
                      >
                        {task.contributionMethod || '미정'} · {task.contributionScope || '미정'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div className="sd-chip">{task.score ?? '-'}</div>
                    </div>
                  </div>
                );
              })}

              {!tasks.length && (
                <div style={{ padding: 18, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>일정이 있는 과업이 없습니다.</div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
};

export default MySchedulePage;
