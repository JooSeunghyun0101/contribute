import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { FilterChip, IconSparkle } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluatorPeriodRoster } from '@/hooks/useEvaluatorPeriodRoster';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import {
  generateFeedbackSummaryForEvaluator,
  type FeedbackForSummary,
} from '@/lib/gptOss';
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
    // 본인이 매긴 피드백과 이전 평가자가 매긴 피드백을 모두 노출한다.
    // (authorName 인자는 이제 정렬·라벨링용으로만 활용되고, 필터링에는 사용하지 않는다.)
    void authorName;
    const sorted = [...allEntries].sort(
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
  // 선택한 평가기간에 이 평가자가 담당했던 피평가자만 노출 — 발령 인원 정합성.
  const { selectedPeriod } = useEvaluationPeriod();
  const {
    current: combinedRecords,
    isLoading,
    error,
  } = useEvaluatorPeriodRoster(user?.employeeId || '', selectedPeriod?.id ?? null, true);

  const employeeBundles = useMemo(
    () => combinedRecords.map((record) => buildEmployeeTaskCards(record, user?.name ?? null)),
    [combinedRecords, user?.name],
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

  // AI 요약 — 한 명 선택 시 그 피평가자에 작성한 피드백을 요약
  const aiFeedbackInputs = useMemo<FeedbackForSummary[]>(() => {
    if (!focusedBundle) return [];
    return focusedBundle.cards.flatMap((card) =>
      card.entries.map((entry) => ({
        taskTitle: card.taskTitle,
        content: entry.content,
        score: card.score ?? null,
        evaluatorName: entry.evaluatorName ?? null,
      })),
    );
  }, [focusedBundle]);

  const aiFeedbackSignature = useMemo(
    () => `${focusedBundle?.employeeId ?? ''}|${aiFeedbackInputs.map((f) => f.content).join('|')}`,
    [focusedBundle?.employeeId, aiFeedbackInputs],
  );

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRefreshKey, setAiRefreshKey] = useState(0);

  useEffect(() => {
    if (!focusedBundle || aiFeedbackInputs.length === 0) {
      setAiSummary(null);
      setAiError(null);
      return;
    }
    let cancelled = false;
    setAiLoading(true);
    setAiError(null);
    generateFeedbackSummaryForEvaluator(focusedBundle.employeeName, aiFeedbackInputs)
      .then((text) => {
        if (!cancelled) setAiSummary(text);
      })
      .catch((err) => {
        if (!cancelled) setAiError(err instanceof Error ? err.message : 'AI 요약 호출 실패');
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiFeedbackSignature, aiRefreshKey]);

  return (
    <>
      <PageHeader
        title="피드백 내역"
        subtitle={`내가 작성한 피드백 ${totalFeedbacks}건 · 과업별 정리`}
      />

      <div style={{ padding: '24px 32px 32px' }}>
        {!isLoading && !error && employeeOptions.length > 0 && (
          <div
            className="sd-card"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 16 }}
          >
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
              <FilterChip
                active={selectedEmployeeId === 'all'}
                onClick={() => setSelectedEmployeeId('all')}
              >
                전체 {employeeOptions.length}명
              </FilterChip>
              {employeeOptions.map((opt) => (
                <FilterChip
                  key={opt.id}
                  active={selectedEmployeeId === opt.id}
                  onClick={() => setSelectedEmployeeId(opt.id)}
                >
                  {opt.name}
                </FilterChip>
              ))}
            </div>
          </div>
        )}

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
                visibleBundles.map((bundle) => {
                  const visibleCards = bundle.cards.filter((card) => card.entries.length > 0);
                  return (
                    // 피평가자별로 독립된 카드로 분리해 구분이 명확하게 보이도록 한다.
                    <section
                      key={bundle.employeeId}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: 'var(--bg-card)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      }}
                    >
                      {/* 피평가자 헤더 밴드 */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 16,
                          padding: '14px 18px',
                          background: 'var(--ok-orange-50)',
                          borderBottom: '1px solid var(--ok-orange-100)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
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
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--ok-brown)' }}>
                                {bundle.employeeName}
                              </span>
                              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                                {bundle.employeePosition}
                              </span>
                            </div>
                            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>
                              {bundle.employeeDepartment} · 과업 {visibleCards.length}개 · 피드백{' '}
                              {bundle.totalFeedbacks}건
                            </div>
                          </div>
                        </div>
                        <button
                          className="sd-btn sd-btn-outline sd-btn-sm"
                          onClick={() => navigate(`/evaluation/${bundle.employeeId}`)}
                        >
                          평가 열기
                        </button>
                      </div>

                      {/* 본문: 과업별 피드백 카드 */}
                      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {visibleCards.length === 0 ? (
                          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                            작성된 피드백이 없습니다.
                          </div>
                        ) : (
                          visibleCards.map((card) => (
                            <TaskFeedbackCard
                              key={card.taskId}
                              taskIndex={card.taskIndex}
                              taskTitle={card.taskTitle}
                              contributionMethod={card.contributionMethod}
                              contributionScope={card.contributionScope}
                              score={card.score}
                              entries={card.entries}
                            />
                          ))
                        )}
                      </div>
                    </section>
                  );
                })
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--ok-brown)' }}>
                        AI 요약
                      </span>
                      {focusedBundle && aiFeedbackInputs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setAiRefreshKey((k) => k + 1)}
                          disabled={aiLoading}
                          title="다시 생성"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--ok-orange-100)',
                            background: 'transparent',
                            color: 'var(--ok-orange-700)',
                            fontSize: 'var(--fs-xs)',
                            fontWeight: 700,
                            cursor: aiLoading ? 'wait' : 'pointer',
                            opacity: aiLoading ? 0.6 : 1,
                          }}
                        >
                          <RefreshCw
                            size={12}
                            style={{ animation: aiLoading ? 'spin 1s linear infinite' : 'none' }}
                          />
                          다시 생성
                        </button>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--fs-sm)',
                        lineHeight: 1.7,
                        color: 'var(--ok-brown)',
                        marginTop: 6,
                        minHeight: 40,
                      }}
                    >
                      {!focusedBundle
                        ? '담당 피평가자별 피드백을 한눈에 확인하고 다음 평가에 활용하세요. 한 명을 선택하면 AI 요약이 생성됩니다.'
                        : aiFeedbackInputs.length === 0
                          ? `${focusedBundle.employeeName}님에게 작성한 피드백이 아직 없습니다.`
                          : aiLoading && aiSummary == null
                            ? 'AI가 피드백을 분석 중입니다…'
                            : aiError
                              ? `${aiError} (다시 생성 버튼으로 재시도)`
                              : aiSummary ?? '요약을 준비하고 있습니다…'}
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
