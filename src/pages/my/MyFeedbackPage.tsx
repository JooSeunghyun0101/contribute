import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { IconSparkle } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { generateFeedbackSummaryForEvaluatee, type FeedbackForSummary } from '@/lib/gptOss';
import TaskFeedbackCard, {
  type TaskFeedbackCardProps,
} from '@/components/Feedback/TaskFeedbackCard';

type PastTaskCard = TaskFeedbackCardProps & { taskId: string };

const MyFeedbackPage = () => {
  const { user } = useAuth();
  const { evaluationData, isLoading } = useEvaluationDataDB(user?.employeeId || '');

  const tasks = evaluationData?.tasks ?? [];

  const taskCards = useMemo<PastTaskCard[]>(() => {
    return tasks.map((task, taskIndex) => {
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
        taskIndex,
        taskTitle: task.title,
        contributionMethod: task.contributionMethod ?? null,
        contributionScope: task.contributionScope ?? null,
        score: task.score ?? null,
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

  const feedbackSignature = useMemo(
    () => feedbackInputs.map((f) => `${f.taskTitle}|${f.content}`).join('\n'),
    [feedbackInputs],
  );

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRefreshKey, setAiRefreshKey] = useState(0);

  useEffect(() => {
    if (feedbackInputs.length === 0) {
      setAiSummary(null);
      setAiError(null);
      return;
    }
    let cancelled = false;
    setAiLoading(true);
    setAiError(null);
    generateFeedbackSummaryForEvaluatee(feedbackInputs)
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
  }, [feedbackSignature, aiRefreshKey]);

  const keywords = useMemo(() => {
    const seen = new Set<string>();
    const kws: string[] = [];
    for (const task of tasks) {
      if (task.contributionMethod && !seen.has(task.contributionMethod)) {
        seen.add(task.contributionMethod);
        kws.push(task.contributionMethod);
      }
      if (task.contributionScope && !seen.has(task.contributionScope)) {
        seen.add(task.contributionScope);
        kws.push(task.contributionScope);
      }
    }
    return kws;
  }, [tasks]);

  return (
    <>
      <PageHeader
        title="피드백 이력"
        subtitle={`평가자로부터 받은 코멘트 ${totalFeedbacks}건`}
      />

      <div style={{ padding: '28px 32px 32px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 20 }}>
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>피드백을 불러오는 중입니다.</div>
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
                contributionMethod={card.contributionMethod}
                contributionScope={card.contributionScope}
                score={card.score}
                entries={card.entries}
              />
            ))
          )}
        </div>

        <div className="flex flex-col gap-4">
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

          {keywords.length > 0 && (
            <div className="sd-card">
              <div className="sd-label-mini" style={{ marginBottom: 12 }}>키워드</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {keywords.map((kw) => (
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
                  {feedbackInputs.length > 0 && (
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
                  {feedbackInputs.length === 0
                    ? '아직 받은 피드백이 없습니다. 평가자가 작성하면 요약이 생성됩니다.'
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
    </>
  );
};

export default MyFeedbackPage;
