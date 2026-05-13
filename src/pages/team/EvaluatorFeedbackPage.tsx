import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import { IconSparkle } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamDashboardRecords } from '@/hooks/useDashboardRecords';
import TaskFeedbackCard, {
  type TaskFeedbackCardProps,
} from '@/components/Feedback/TaskFeedbackCard';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

type EmployeeTaskCards = {
  employeeId: string;
  employeeName: string;
  employeeDepartment: string;
  employeePosition: string;
  totalFeedbacks: number;
  cards: (TaskFeedbackCardProps & { taskId: string })[];
  keywords: string[];
};

const buildEmployeeTaskCards = (
  record: EmployeeEvaluationRecord,
  authorName: string | null,
): EmployeeTaskCards => {
  const cards = record.tasks.map((task, idx) => {
    const historyEntries =
      task.feedbackHistory?.map((item) => ({
        id: item.id,
        content: item.content,
        date: item.created_at,
        evaluatorName: item.evaluator_name,
      })) ?? [];

    const fallbackEntries =
      historyEntries.length === 0 && task.feedback && task.feedback_date
        ? [
            {
              id: `${task.task_id}-legacy`,
              content: task.feedback,
              date: task.feedback_date,
              evaluatorName: task.evaluator_name,
            },
          ]
        : [];

    const allEntries = historyEntries.length > 0 ? historyEntries : fallbackEntries;
    const authoredEntries = authorName
      ? allEntries.filter((entry) => entry.evaluatorName === authorName)
      : allEntries;
    const visible = authoredEntries.length > 0 ? authoredEntries : allEntries;
    const sorted = [...visible].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return {
      taskId: task.task_id,
      taskIndex: idx,
      taskTitle: task.title,
      contributionMethod: task.contribution_method,
      contributionScope: task.contribution_scope,
      score: task.score,
      entries: sorted,
    };
  });

  const keywordsSet = new Set<string>();
  const keywords: string[] = [];
  for (const task of record.tasks) {
    if (task.contribution_method && !keywordsSet.has(task.contribution_method)) {
      keywordsSet.add(task.contribution_method);
      keywords.push(task.contribution_method);
    }
    if (task.contribution_scope && !keywordsSet.has(task.contribution_scope)) {
      keywordsSet.add(task.contribution_scope);
      keywords.push(task.contribution_scope);
    }
  }

  return {
    employeeId: record.employee.employee_id,
    employeeName: record.employee.name,
    employeeDepartment: record.employee.department,
    employeePosition: record.employee.position,
    totalFeedbacks: cards.reduce((sum, c) => sum + c.entries.length, 0),
    cards,
    keywords,
  };
};

const EvaluatorFeedbackPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<'all' | string>('all');
  const { records, isLoading, error } = useTeamDashboardRecords(user?.employeeId || '', true);

  const employeeBundles = useMemo(
    () => records.map((record) => buildEmployeeTaskCards(record, user?.name ?? null)),
    [records, user?.name],
  );

  const employeeOptions = useMemo(
    () => employeeBundles.map((b) => ({ id: b.employeeId, name: b.employeeName })),
    [employeeBundles],
  );

  const visibleBundles = useMemo(
    () =>
      employeeBundles.filter((b) =>
        selectedEmployeeId === 'all' ? b.totalFeedbacks > 0 : b.employeeId === selectedEmployeeId,
      ),
    [employeeBundles, selectedEmployeeId],
  );

  const focusedBundle = selectedEmployeeId === 'all' ? null : visibleBundles[0] ?? null;

  const aggregateStats = useMemo(() => {
    const employeesWithFeedback = employeeBundles.filter((b) => b.totalFeedbacks > 0);
    return {
      employees: employeesWithFeedback.length,
      tasks: employeesWithFeedback.reduce(
        (sum, b) => sum + b.cards.filter((c) => c.entries.length > 0).length,
        0,
      ),
      feedbacks: employeesWithFeedback.reduce((sum, b) => sum + b.totalFeedbacks, 0),
    };
  }, [employeeBundles]);

  const totalFeedbacks = focusedBundle?.totalFeedbacks ?? aggregateStats.feedbacks;

  return (
    <>
      <PageHeader
        title="피드백 내역"
        subtitle={`내가 작성한 피드백 ${totalFeedbacks}건 · 과업별 정리`}
      />

      <div style={{ padding: '24px 32px 32px' }}>
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
          {[{ id: 'all' as const, name: '전체' }, ...employeeOptions].map((opt) => (
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
                fontSize: 'var(--fs-body)',
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
          <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>피드백 이력을 불러오는 중입니다.</div>
        ) : error ? (
          <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-body)' }}>{error}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 20 }}>
            {/* ── Left: task-grouped cards (per employee section) ── */}
            <div className="flex flex-col gap-5">
              {visibleBundles.length === 0 ? (
                <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                  표시할 피드백 이력이 없습니다.
                </div>
              ) : (
                visibleBundles.map((bundle) => (
                  <section key={bundle.employeeId} className="flex flex-col gap-3">
                    {selectedEmployeeId === 'all' && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 16,
                          padding: '0 4px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                            {bundle.employeeName.charAt(0)}
                          </div>
                          <div>
                            <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 900, margin: 0 }}>
                              {bundle.employeeName}{' '}
                              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                                {bundle.employeePosition}
                              </span>
                            </h2>
                            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>
                              {bundle.employeeDepartment}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
                            과업 {bundle.cards.filter((c) => c.entries.length > 0).length}개 · 피드백{' '}
                            {bundle.totalFeedbacks}건
                          </span>
                          <button
                            className="sd-btn sd-btn-outline sd-btn-sm"
                            onClick={() => navigate(`/evaluation/${bundle.employeeId}`)}
                          >
                            평가 열기
                          </button>
                        </div>
                      </div>
                    )}

                    {bundle.cards
                      .filter((card) => card.entries.length > 0)
                      .map((card) => (
                        <TaskFeedbackCard
                          key={card.taskId}
                          taskIndex={card.taskIndex}
                          taskTitle={card.taskTitle}
                          contributionMethod={card.contributionMethod}
                          contributionScope={card.contributionScope}
                          score={card.score}
                          entries={card.entries}
                        />
                      ))}
                  </section>
                ))
              )}
            </div>

            {/* ── Right sidebar ── */}
            <div className="flex flex-col gap-4">
              <div className="sd-card">
                <div className="sd-label-mini" style={{ marginBottom: 12 }}>피평가자</div>
                {focusedBundle ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
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
                      {focusedBundle.employeeName.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>{focusedBundle.employeeName}</div>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>
                        {focusedBundle.employeePosition} · {focusedBundle.employeeDepartment}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--fg-muted)', lineHeight: 1.7 }}>
                    팀 {aggregateStats.employees}명 · 과업 {aggregateStats.tasks}개 · 피드백{' '}
                    {aggregateStats.feedbacks}건
                  </div>
                )}
              </div>

              {focusedBundle && focusedBundle.keywords.length > 0 && (
                <div className="sd-card">
                  <div className="sd-label-mini" style={{ marginBottom: 12 }}>키워드</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {focusedBundle.keywords.map((kw) => (
                      <span
                        key={kw}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 20,
                          background: 'var(--bg-muted)',
                          border: '1px solid var(--border)',
                          fontSize: 'var(--fs-sm)',
                          fontWeight: 600,
                          color: 'var(--fg)',
                        }}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {focusedBundle && focusedBundle.cards.length > 0 && (
                <div className="sd-card">
                  <div className="sd-label-mini" style={{ marginBottom: 12 }}>과업별 피드백 수</div>
                  <div className="flex flex-col gap-3">
                    {focusedBundle.cards.map((card) => (
                      <div
                        key={card.taskId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          paddingBottom: 10,
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 'var(--fs-body)',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            T{String((card.taskIndex ?? 0) + 1).padStart(2, '0')} {card.taskTitle}
                          </div>
                        </div>
                        <span
                          style={{
                            marginLeft: 8,
                            padding: '2px 8px',
                            borderRadius: 12,
                            background:
                              card.entries.length > 0 ? 'var(--ok-orange-50)' : 'var(--bg-muted)',
                            color:
                              card.entries.length > 0 ? 'var(--ok-orange)' : 'var(--fg-muted)',
                            fontSize: 'var(--fs-xs)',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {card.entries.length}건
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div
                className="sd-card"
                style={{
                  background: 'linear-gradient(135deg, var(--ok-orange-50) 0%, var(--bg-card) 100%)',
                  border: '1px solid var(--ok-orange-100)',
                }}
              >
                <div className="flex items-start gap-3">
                  <div style={{ color: 'var(--ok-orange)', marginTop: 2 }}>
                    <IconSparkle width={16} height={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--ok-brown)' }}>AI 요약</div>
                    <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--ok-brown)', marginTop: 4 }}>
                      {focusedBundle
                        ? `${focusedBundle.employeeName}님은 최근 작성된 피드백을 기준으로 핵심 과업 수행에서 일관된 강점을 보입니다.`
                        : '담당 피평가자별 피드백을 한눈에 확인하고 다음 평가에 활용하세요.'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default EvaluatorFeedbackPage;
