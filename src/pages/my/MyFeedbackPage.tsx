import { useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { IconSparkle } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import TaskFeedbackCard, {
  type TaskFeedbackCardProps,
  type TaskFeedbackEntry,
} from '@/components/Feedback/TaskFeedbackCard';
import { evaluationService, taskService, feedbackService } from '@/lib/services';
import type { Evaluation } from '@/types';

type PastTaskCard = TaskFeedbackCardProps & { taskId: string };

type PastEvaluationBundle = {
  evaluation: Evaluation;
  cards: PastTaskCard[];
};

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .replace(/\. /g, '-')
    .replace('.', '');
};

const PastEvaluationAccordion = ({ bundle }: { bundle: PastEvaluationBundle }) => {
  const [open, setOpen] = useState(false);
  const { evaluation, cards } = bundle;
  const evaluatorName = evaluation.evaluator_name ?? '이전 평가자';
  const assignedAt = formatDate(evaluation.evaluator_assigned_at);
  const taskCount = cards.length;
  const feedbackCount = cards.reduce((sum, c) => sum + c.entries.length, 0);

  return (
    <div
      className="sd-card"
      style={{
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--bg-muted)',
              color: 'var(--fg-muted)',
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {evaluatorName.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{evaluatorName}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>
              {assignedAt ? `${assignedAt} 시작` : '기간 정보 없음'}
              {taskCount > 0 && ` · 과업 ${taskCount}개 · 피드백 ${feedbackCount}건`}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            padding: '0 18px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            borderTop: '1px solid var(--border)',
            paddingTop: 14,
          }}
        >
          {cards.length === 0 ? (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--fg-muted)',
                padding: '14px 0',
                textAlign: 'center',
              }}
            >
              이 기간에는 등록된 과업이 없습니다.
            </div>
          ) : (
            cards.map((card) => (
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
      )}
    </div>
  );
};

const MyFeedbackPage = () => {
  const { user } = useAuth();
  const { evaluationData, isLoading } = useEvaluationDataDB(user?.employeeId || '');
  const [pastBundles, setPastBundles] = useState<PastEvaluationBundle[]>([]);
  const [isLoadingPast, setIsLoadingPast] = useState(false);

  useEffect(() => {
    if (!user?.employeeId) return;
    let cancelled = false;
    (async () => {
      setIsLoadingPast(true);
      try {
        const all = await evaluationService.getEvaluationsByEmployeeId(user.employeeId);
        const currentId = evaluationData?.id;
        const past = all.filter(
          (ev) => ev.evaluation_status === 'completed' && ev.id !== currentId,
        );
        const enriched: PastEvaluationBundle[] = await Promise.all(
          past.map(async (ev) => {
            let cards: PastTaskCard[] = [];
            try {
              const tasks = (await taskService.getTasksByEvaluationId(ev.id)).filter(
                (t: any) => !t.deleted_at,
              );
              cards = await Promise.all(
                tasks.map(async (task: any, idx: number) => {
                  let entries: TaskFeedbackEntry[] = [];
                  try {
                    const fbs = await feedbackService.getFeedbackHistoryByTaskId(task.task_id);
                    entries = fbs
                      .map((fb: any) => ({
                        id: fb.id,
                        content: fb.content,
                        date: fb.created_at,
                        evaluatorName: fb.evaluator_name ?? null,
                      }))
                      .sort(
                        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
                      );
                  } catch {
                    entries = [];
                  }
                  return {
                    taskId: task.task_id,
                    taskIndex: idx,
                    taskTitle: task.title,
                    contributionMethod: task.contribution_method,
                    contributionScope: task.contribution_scope,
                    score: task.score ?? null,
                    entries,
                  };
                }),
              );
            } catch {
              cards = [];
            }
            return { evaluation: ev, cards };
          }),
        );
        if (!cancelled) setPastBundles(enriched);
      } catch (error) {
        console.warn('과거 평가 로드 실패:', error);
        if (!cancelled) setPastBundles([]);
      } finally {
        if (!cancelled) setIsLoadingPast(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.employeeId, evaluationData?.id]);

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
        subtitle={`평가자로부터 받은 코멘트 ${totalFeedbacks}건 · 과거 평가자 ${pastBundles.length}건`}
      />

      <div style={{ padding: '28px 32px 32px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 20 }}>
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>피드백을 불러오는 중입니다.</div>
          ) : taskCards.length === 0 ? (
            <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
              아직 등록된 과업이 없습니다.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg-muted)', letterSpacing: 0.4 }}>
                현재 평가
              </div>
              {taskCards.map((card) => (
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
            </>
          )}

          {(pastBundles.length > 0 || isLoadingPast) && (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg-muted)', letterSpacing: 0.4, marginTop: 8 }}>
                과거 평가자별 이력
              </div>
              {isLoadingPast && pastBundles.length === 0 ? (
                <div style={{ color: 'var(--fg-muted)', fontSize: 12.5 }}>과거 이력 로딩 중…</div>
              ) : (
                pastBundles.map((bundle) => (
                  <PastEvaluationAccordion key={bundle.evaluation.id} bundle={bundle} />
                ))
              )}
            </>
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
                    fontSize: 16,
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
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{latestEvaluator}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>최근 평가자</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>평가자 정보 없음</div>
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
                      fontSize: 12,
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
                        fontSize: 13,
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
                      fontSize: 11,
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
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ok-brown)' }}>AI 요약</div>
                <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--ok-brown)', marginTop: 4 }}>
                  최근 피드백을 기준으로 주도성과 실행력이 강점으로 평가되고 있습니다. 다음 라운드에서 협업과 공유 관점의 활동을 추가하면 더 높은 점수에 근접할 수 있습니다.
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
