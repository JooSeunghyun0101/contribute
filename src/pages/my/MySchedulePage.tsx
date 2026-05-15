import PageHeader from '@/components/Layout/PageHeader';
import { IconCalendar, IconCheck, IconClock, IconTarget, StatCard } from '@/components/brand';
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

const remainingDays = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
};

const MySchedulePage = () => {
  const { user } = useAuth();
  const { evaluationData, isLoading } = useEvaluationDataDB(user?.employeeId || '');
  const tasks = evaluationData?.tasks ?? [];
  const completedTasks = tasks.filter((task) => task.score !== undefined).length;
  const activeTasks = tasks.filter((task) => task.score === undefined).length;
  const nearestDeadline = [...tasks]
    .filter((task) => task.endDate)
    .sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime())[0];
  const dDay = remainingDays(nearestDeadline?.endDate);

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
                  gridTemplateColumns: '220px 1fr 88px',
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
                    style={{ display: 'grid', gridTemplateColumns: '220px 1fr 88px', gap: 14, alignItems: 'center' }}
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
                          background: '#F55000',
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

        {/* Stat cards — moved to bottom */}
        <section
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
        >
          <StatCard icon={IconTarget} label="전체 과업" value={tasks.length} />
          <StatCard icon={IconCheck} label="평가 완료" value={completedTasks} />
          <StatCard icon={IconClock} label="진행 중" value={activeTasks} />
          <StatCard
            icon={IconCalendar}
            label="마감까지"
            value={
              dDay == null ? '-' : dDay > 0 ? `D-${dDay}` : dDay === 0 ? 'D-Day' : `D+${Math.abs(dDay)}`
            }
            sub={nearestDeadline?.title ?? '가까운 일정 없음'}
            accent
          />
        </section>
      </div>
    </>
  );
};

export default MySchedulePage;
