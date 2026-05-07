import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamDashboardRecords } from '@/hooks/useDashboardRecords';

type FeedbackEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string;
  employeePosition: string;
  taskId: string;
  taskTitle: string;
  score: number | null;
  content: string;
  date: string;
  evaluatorName: string | null;
};

type TaskFeedbackGroup = {
  taskId: string;
  taskTitle: string;
  score: number | null;
  latestDate: string;
  entries: FeedbackEntry[];
};

type EmployeeFeedbackGroup = {
  employeeId: string;
  employeeName: string;
  employeeDepartment: string;
  employeePosition: string;
  totalFeedbacks: number;
  tasks: TaskFeedbackGroup[];
};

const formatShortDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(date);
};

const SCORE_BG: Record<number, string> = { 4: '#F55000', 3: '#D94400', 2: '#FFAA00', 1: '#C2BAB0' };
const SCORE_TEXT: Record<number, string> = { 4: '#fff', 3: '#fff', 2: '#4A1A00', 1: '#fff' };

const EvaluatorFeedbackPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const { records, isLoading, error } = useTeamDashboardRecords(user?.employeeId || '', true);

  const employeeOptions = useMemo(
    () => records.map((record) => ({ id: record.employee.employee_id, name: record.employee.name })),
    [records],
  );

  const groupedFeedbacks = useMemo<EmployeeFeedbackGroup[]>(() => {
    return records
      .map((record) => {
        const taskGroups = record.tasks
          .map((task) => {
            const historyEntries =
              task.feedbackHistory?.map((item) => ({
                id: item.id,
                employeeId: record.employee.employee_id,
                employeeName: record.employee.name,
                employeeDepartment: record.employee.department,
                employeePosition: record.employee.position,
                taskId: task.task_id,
                taskTitle: task.title,
                score: task.score,
                content: item.content,
                date: item.created_at,
                evaluatorName: item.evaluator_name,
              })) ?? [];

            const entries =
              historyEntries.length > 0
                ? historyEntries
                : task.feedback && task.feedback_date
                  ? [
                      {
                        id: `${task.task_id}-legacy`,
                        employeeId: record.employee.employee_id,
                        employeeName: record.employee.name,
                        employeeDepartment: record.employee.department,
                        employeePosition: record.employee.position,
                        taskId: task.task_id,
                        taskTitle: task.title,
                        score: task.score,
                        content: task.feedback,
                        date: task.feedback_date,
                        evaluatorName: task.evaluator_name,
                      },
                    ]
                  : [];

            const authoredEntries = user?.name
              ? entries.filter((entry) => entry.evaluatorName === user.name)
              : entries;
            const visibleEntries = authoredEntries.length > 0 ? authoredEntries : entries;
            const sortedEntries = [...visibleEntries].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            );

            return sortedEntries.length > 0
              ? {
                  taskId: task.task_id,
                  taskTitle: task.title,
                  score: task.score,
                  latestDate: sortedEntries[0].date,
                  entries: sortedEntries,
                }
              : null;
          })
          .filter((group): group is TaskFeedbackGroup => Boolean(group))
          .sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());

        return {
          employeeId: record.employee.employee_id,
          employeeName: record.employee.name,
          employeeDepartment: record.employee.department,
          employeePosition: record.employee.position,
          totalFeedbacks: taskGroups.reduce((sum, task) => sum + task.entries.length, 0),
          tasks: taskGroups,
        };
      })
      .filter((group) => group.tasks.length > 0)
      .sort((a, b) => {
        const aDate = a.tasks[0]?.latestDate ?? '';
        const bDate = b.tasks[0]?.latestDate ?? '';
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
  }, [records, user?.name]);

  const visibleGroups = useMemo(
    () =>
      groupedFeedbacks.filter((group) =>
        selectedEmployeeId === 'all' ? true : group.employeeId === selectedEmployeeId,
      ),
    [groupedFeedbacks, selectedEmployeeId],
  );

  return (
    <>
      <PageHeader
        title="피드백 내역"
        subtitle="내가 작성한 피드백 · 최근 3개월"
      />

      <div style={{ padding: '24px 32px 32px' }}>
        {/* Filter tabs + count */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 6,
            marginBottom: 18,
            flexWrap: 'wrap',
          }}
        >
          {[{ id: 'all', name: '전체' }, ...employeeOptions].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelectedEmployeeId(opt.id)}
              style={{
                padding: '5px 14px',
                borderRadius: 8,
                border: '1px solid',
                borderColor: selectedEmployeeId === opt.id ? 'var(--ok-orange)' : 'var(--border)',
                background: selectedEmployeeId === opt.id ? 'var(--ok-orange)' : 'transparent',
                color: selectedEmployeeId === opt.id ? '#fff' : 'var(--fg)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {opt.name}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>피드백 이력을 불러오는 중입니다.</div>
        ) : error ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleGroups.map((group) => (
              <section key={group.employeeId} className="sd-card sd-card-lg">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                    marginBottom: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: '50%',
                        background: 'var(--ok-orange)',
                        color: '#fff',
                        fontSize: 15,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {group.employeeName.charAt(0)}
                    </div>
                    <div>
                      <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>
                        {group.employeeName}{' '}
                        <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>
                          {group.employeePosition}
                        </span>
                      </h2>
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                        {group.employeeDepartment}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 700 }}>
                      과업 {group.tasks.length}개 · 피드백 {group.totalFeedbacks}건
                    </span>
                    <button
                      className="sd-btn sd-btn-outline sd-btn-sm"
                      onClick={() => navigate(`/evaluation/${group.employeeId}`)}
                    >
                      평가 열기
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {group.tasks.map((task) => (
                    <TaskFeedbackCard key={task.taskId} task={task} />
                  ))}
                </div>
              </section>
            ))}

            {!visibleGroups.length && (
              <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
                표시할 피드백 이력이 없습니다.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

const TaskFeedbackCard = ({ task }: { task: TaskFeedbackGroup }) => {
  const score = task.score;
  const scoreBg = score != null ? (SCORE_BG[score] ?? '#C2BAB0') : 'var(--bg-muted)';
  const scoreFg = score != null ? (SCORE_TEXT[score] ?? '#fff') : 'var(--fg-muted)';

  const [latestEntry, ...olderEntries] = task.entries;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        background: 'var(--bg-muted)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="sd-label-mini">과업</div>
          <h3 style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{task.taskTitle}</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            최근 {formatShortDate(task.latestDate)}
          </span>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: scoreBg,
              color: scoreFg,
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {score ?? '–'}
          </div>
        </div>
      </div>

      {latestEntry && (
        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 5 }}>
            {formatShortDate(latestEntry.date)} · {latestEntry.evaluatorName ?? '평가자'}{' '}
            <span style={{ color: 'var(--ok-orange)', fontWeight: 700 }}>· 최신</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--fg)', margin: 0 }}>
            {latestEntry.content}
          </p>
        </div>
      )}

      {olderEntries.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            style={{
              marginTop: 10,
              padding: '4px 10px',
              borderRadius: 14,
              border: '1px solid var(--border)',
              background: 'var(--bg-muted)',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isExpanded ? '이전 피드백 접기' : `이전 피드백 ${olderEntries.length}건 펼치기`}
            <span style={{ fontSize: 9 }}>{isExpanded ? '▲' : '▼'}</span>
          </button>

          {isExpanded && (
            <div className="flex flex-col gap-2" style={{ marginTop: 10 }}>
              {olderEntries.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    paddingTop: 10,
                    borderTop: '1px dashed var(--border)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 5 }}>
                    {formatShortDate(entry.date)} · {entry.evaluatorName ?? '평가자'}
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      lineHeight: 1.7,
                      color: 'var(--fg-muted)',
                      margin: 0,
                    }}
                  >
                    {entry.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EvaluatorFeedbackPage;
