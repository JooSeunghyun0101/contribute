import { useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { LoadingState } from '@/components/ui/state-views';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { type FeedbackForSummary } from '@/lib/gptOss';
import { aiContentService } from '@/lib/services';
import { AiContentText } from '@/components/ui/AiContentText';
import { AiSectionTitle } from '@/components/ui/AiSectionTitle';
import { AiKeywordChips } from '@/components/ui/AiKeywordChips';
import TaskFeedbackCard, {
  type TaskFeedbackCardProps,
} from '@/components/Feedback/TaskFeedbackCard';

type PastTaskCard = TaskFeedbackCardProps & { taskId: string };

const MyFeedbackPage = () => {
  const { user } = useAuth();
  const { evaluationData, isLoading } = useEvaluationDataDB(user?.employeeId || '', { readOnly: true });

  const tasks = evaluationData?.tasks ?? [];

  const taskCards = useMemo<PastTaskCard[]>(() => {
    // 발령자: 이전 평가 과업(isHistoricalEvaluation)도 병합되어 온다(S1) — T번호는 현재 평가
    // 과업에만 이어 붙이고, 이전 평가 과업은 '이전 평가 · 평가자명' 배지로 구분한다.
    let currentIndex = 0;
    return tasks.map((task) => {
      const isHistorical = Boolean(task.isHistoricalEvaluation);
      const entries = (task.feedbackHistory ?? [])
        .map((fb) => ({
          id: fb.id,
          content: fb.content,
          date: fb.date,
          evaluatorName: fb.evaluatorName ?? null,
        }))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return {
        taskId: task.id,
        taskIndex: isHistorical ? undefined : currentIndex++,
        taskTitle: task.title,
        isAiTask: task.isAiTask,
        contributionMethod: task.contributionMethod ?? null,
        contributionScope: task.contributionScope ?? null,
        score: task.score ?? null,
        historicalLabel: isHistorical
          ? `이전 평가${task.sourceEvaluatorName ? ` · ${task.sourceEvaluatorName}` : ''}`
          : null,
        entries,
      };
    });
  }, [tasks]);

  const totalFeedbacks = useMemo(
    () => taskCards.reduce((sum, card) => sum + card.entries.length, 0),
    [taskCards],
  );

  const cardsWithFeedback = useMemo(
    () => taskCards.filter((card) => card.entries.length > 0),
    [taskCards],
  );

  const latestEvaluator = useMemo(() => {
    for (const card of cardsWithFeedback) {
      if (card.entries[0]?.evaluatorName) return card.entries[0].evaluatorName;
    }
    return null;
  }, [cardsWithFeedback]);
  const latestEvaluatorInitial = latestEvaluator ? latestEvaluator.charAt(0) : '?';

  // AI 요약
  const feedbackInputs = useMemo<FeedbackForSummary[]>(
    () =>
      cardsWithFeedback.flatMap((card) =>
        card.entries.map((entry) => ({
          taskTitle: card.taskTitle,
          content: entry.content,
          score: card.score ?? null,
          evaluatorName: entry.evaluatorName ?? null,
        })),
      ),
    [cardsWithFeedback],
  );

  const { selectedPeriodId } = useEvaluationPeriod();
  const scopeId =
    user?.employeeId && selectedPeriodId ? `${user.employeeId}:${selectedPeriodId}` : null;

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);
  const [aiKeywords, setAiKeywords] = useState<string | null>(null);
  const [aiKeywordsAt, setAiKeywordsAt] = useState<string | null>(null);

  // 평가자 저장 시 자동 생성·영속된 요약/키워드를 불러오기만 한다(조회 시 AI 재호출 없음).
  useEffect(() => {
    if (!scopeId) {
      setAiSummary(null);
      setAiGeneratedAt(null);
      setAiKeywords(null);
      setAiKeywordsAt(null);
      return;
    }
    let cancelled = false;
    aiContentService.get('evaluatee_feedback_summary', scopeId).then((rec) => {
      if (cancelled) return;
      setAiSummary(rec?.content ?? null);
      setAiGeneratedAt(rec?.generated_at ?? null);
    });
    aiContentService.get('evaluatee_feedback_keywords', scopeId).then((rec) => {
      if (cancelled) return;
      setAiKeywords(rec?.content ?? null);
      setAiKeywordsAt(rec?.generated_at ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeId]);

  return (
    <>
      <PageHeader
        title="피드백 이력"
        subtitle={`평가자로부터 받은 코멘트 ${totalFeedbacks}건`}
      />

      <div style={{ padding: '28px 32px 32px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 20 }}>
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <LoadingState message="피드백을 불러오는 중입니다." />
          ) : taskCards.length === 0 ? (
            <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
              아직 등록된 과업이 없습니다.
            </div>
          ) : (
            taskCards.map((card) => (
              <TaskFeedbackCard
                key={card.taskId}
                taskIndex={card.taskIndex}
                taskTitle={card.taskTitle}
                isAiTask={card.isAiTask}
                contributionMethod={card.contributionMethod}
                contributionScope={card.contributionScope}
                score={card.score}
                tint
                historicalLabel={card.historicalLabel}
                entries={card.entries}
              />
            ))
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="sd-card ai-shine-border">
            <AiSectionTitle
              title="AI 요약"
              right={
                aiSummary && aiGeneratedAt
                  ? `${new Date(aiGeneratedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 생성`
                  : '평가자 저장 시 자동'
              }
            />
            <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--fg)', minHeight: 40 }}>
              {feedbackInputs.length === 0 ? (
                <span style={{ color: 'var(--fg-muted)' }}>
                  아직 받은 피드백이 없습니다. 평가자가 평가를 저장하면 요약이 표시됩니다.
                </span>
              ) : aiSummary ? (
                <AiContentText text={aiSummary} accent="var(--ai-accent)" />
              ) : (
                <span style={{ color: 'var(--fg-muted)' }}>
                  아직 생성된 요약이 없습니다. 평가자가 평가를 저장하면 자동으로 생성됩니다.
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
                  : '평가자 저장 시 자동'
              }
            />
            <div style={{ minHeight: 28 }}>
              {feedbackInputs.length === 0 ? (
                <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>아직 받은 피드백이 없습니다.</span>
              ) : aiKeywords ? (
                <AiKeywordChips text={aiKeywords} />
              ) : (
                <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                  아직 생성된 키워드가 없습니다. 평가자가 평가를 저장하면 자동으로 생성됩니다.
                </span>
              )}
            </div>
          </div>

          <div className="sd-card">
            <div className="sd-label-mini" style={{ marginBottom: 12 }}>평가자</div>
            {latestEvaluator ? (
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
                  {latestEvaluatorInitial}
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>{latestEvaluator}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>최근 평가자</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--fg-muted)' }}>평가자 정보 없음</div>
            )}
          </div>

          <div className="sd-card">
            <div className="sd-label-mini" style={{ marginBottom: 12 }}>과업별 피드백 수</div>
            <div className="flex flex-col gap-3">
              {taskCards.map((card) => (
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
                      {card.taskIndex != null
                        ? `T${String(card.taskIndex + 1).padStart(2, '0')} `
                        : '(이전 평가) '}
                      {card.taskTitle}
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

        </div>
      </div>
    </>
  );
};

export default MyFeedbackPage;
