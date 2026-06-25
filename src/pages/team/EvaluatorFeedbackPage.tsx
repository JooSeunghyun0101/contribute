import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import { FilterChip } from '@/components/brand';
import { AiSectionTitle } from '@/components/ui/AiSectionTitle';
import { AiKeywordChips } from '@/components/ui/AiKeywordChips';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluatorPeriodRoster } from '@/hooks/useEvaluatorPeriodRoster';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { type FeedbackForSummary } from '@/lib/gptOss';
import { aiContentService } from '@/lib/services';
import { AiContentText } from '@/components/ui/AiContentText';
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

  return {
    employeeId: record.employee.employee_id,
    employeeName: record.employee.name,
    employeeDepartment: record.employee.department,
    employeePosition: record.employee.position,
    totalFeedbacks: cards.reduce((sum, c) => sum + c.entries.length, 0),
    cards,
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

  const summaryScopeId =
    user?.employeeId && focusedBundle && selectedPeriod?.id
      ? `${user.employeeId}:${focusedBundle.employeeId}:${selectedPeriod.id}`
      : null;

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);
  const [aiKeywords, setAiKeywords] = useState<string | null>(null);
  const [aiKeywordsAt, setAiKeywordsAt] = useState<string | null>(null);

  // 평가 저장 시 자동 생성·영속된 요약/키워드를 불러오기만 한다(조회 시 AI 재호출 없음).
  useEffect(() => {
    if (!summaryScopeId) {
      setAiSummary(null);
      setAiGeneratedAt(null);
      setAiKeywords(null);
      setAiKeywordsAt(null);
      return;
    }
    let cancelled = false;
    aiContentService.get('evaluator_feedback_summary', summaryScopeId).then((rec) => {
      if (cancelled) return;
      setAiSummary(rec?.content ?? null);
      setAiGeneratedAt(rec?.generated_at ?? null);
    });
    aiContentService.get('evaluator_feedback_keywords', summaryScopeId).then((rec) => {
      if (cancelled) return;
      setAiKeywords(rec?.content ?? null);
      setAiKeywordsAt(rec?.generated_at ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [summaryScopeId]);

  return (
    <>
      <PageHeader
        title="피드백 내역"
        subtitle={`내가 작성한 피드백 ${totalFeedbacks}건 · 과업별 정리`}
        filters={
          !isLoading && !error && employeeOptions.length > 0 ? (
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
          ) : undefined
        }
      />

      <div style={{ padding: '24px 32px 32px' }}>
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
              <div className="sd-card ai-shine-border">
                <AiSectionTitle
                  title="AI 요약"
                  right={
                    aiSummary && aiGeneratedAt
                      ? `${new Date(aiGeneratedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 생성`
                      : focusedBundle
                        ? '저장 시 자동'
                        : undefined
                  }
                />
                <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--fg)', minHeight: 40 }}>
                  {!focusedBundle ? (
                    <span style={{ color: 'var(--fg-muted)' }}>
                      담당 피평가자를 한 명 선택하면 저장된 AI 요약이 표시됩니다.
                    </span>
                  ) : aiFeedbackInputs.length === 0 ? (
                    <span style={{ color: 'var(--fg-muted)' }}>
                      {focusedBundle.employeeName}님에게 작성한 피드백이 아직 없습니다.
                    </span>
                  ) : aiSummary ? (
                    <AiContentText text={aiSummary} accent="var(--ai-accent)" />
                  ) : (
                    <span style={{ color: 'var(--fg-muted)' }}>
                      아직 생성된 요약이 없습니다. 이 피평가자의 평가를 저장하면 자동으로 생성됩니다.
                    </span>
                  )}
                </div>
              </div>

              <div className="sd-card ai-shine-border">
                <AiSectionTitle
                  title="AI 키워드"
                  right={
                    aiKeywords && aiKeywordsAt
                      ? `${new Date(aiKeywordsAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 생성`
                      : focusedBundle
                        ? '저장 시 자동'
                        : undefined
                  }
                />
                <div style={{ minHeight: 28 }}>
                  {!focusedBundle ? (
                    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                      담당 피평가자를 한 명 선택하면 키워드가 표시됩니다.
                    </span>
                  ) : aiFeedbackInputs.length === 0 ? (
                    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                      작성한 피드백이 아직 없습니다.
                    </span>
                  ) : aiKeywords ? (
                    <AiKeywordChips text={aiKeywords} />
                  ) : (
                    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                      아직 생성된 키워드가 없습니다. 이 피평가자의 평가를 저장하면 자동으로 생성됩니다.
                    </span>
                  )}
                </div>
              </div>

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

            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default EvaluatorFeedbackPage;
