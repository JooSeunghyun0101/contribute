import { useMemo } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { IconSparkle } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .replace(/\. /g, '-')
    .replace('.', '');
};

const MyFeedbackPage = () => {
  const { user } = useAuth();
  const { evaluationData, isLoading } = useEvaluationDataDB(user?.employeeId || '');

  const taskMap = useMemo(() => {
    const tasks = evaluationData?.tasks ?? [];
    return Object.fromEntries(tasks.map((t, i) => [t.id, { ...t, index: i }]));
  }, [evaluationData]);

  const allFeedbacks = useMemo(() => {
    const tasks = evaluationData?.tasks ?? [];
    return tasks
      .flatMap((task, taskIndex) =>
        (task.feedbackHistory ?? []).map((fb) => ({
          ...fb,
          taskId: task.id,
          taskTitle: task.title,
          taskIndex,
          taskScore: task.score,
          taskMethod: task.contributionMethod,
          taskScope: task.contributionScope,
        })),
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [evaluationData]);

  const latestEvaluator = allFeedbacks[0]?.evaluatorName ?? null;
  const latestEvaluatorInitial = latestEvaluator ? latestEvaluator.charAt(0) : '?';

  const keywords = useMemo(() => {
    const seen = new Set<string>();
    const kws: string[] = [];
    for (const task of evaluationData?.tasks ?? []) {
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
  }, [evaluationData]);

  const scoreColors: Record<number, string> = { 4: '#F55000', 3: '#D94400', 2: '#FFAA00', 1: '#C2BAB0' };

  return (
    <>
      <PageHeader
        title="피드백 이력"
        subtitle={`평가자로부터 받은 코멘트 ${allFeedbacks.length}건 · 시간순`}
      />

      <div style={{ padding: '28px 32px 32px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 20 }}>
        {/* ── Left: flat timeline ── */}
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>피드백을 불러오는 중입니다.</div>
          ) : allFeedbacks.length === 0 ? (
            <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
              아직 등록된 피드백이 없습니다.
            </div>
          ) : (
            allFeedbacks.map((fb) => {
              const score = fb.taskScore;
              const scoreBg = score != null ? (scoreColors[score] ?? '#C2BAB0') : '#C2BAB0';

              return (
                <div
                  key={fb.id}
                  className="sd-card"
                  style={{ padding: '20px 22px', position: 'relative' }}
                >
                  {/* Score badge top-right */}
                  {score != null && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 18,
                        right: 20,
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: scoreBg,
                        color: '#fff',
                        fontSize: 13,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {score}
                    </div>
                  )}

                  {/* Evaluator row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--ok-orange)',
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {fb.evaluatorName ? fb.evaluatorName.charAt(0) : '?'}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{fb.evaluatorName}</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>{formatDate(fb.date)}</div>
                    </div>
                  </div>

                  {/* Task row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      background: 'var(--bg-muted)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      marginBottom: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: '#fff',
                        background: 'var(--ok-brown)',
                        borderRadius: 4,
                        padding: '2px 7px',
                      }}
                    >
                      T{String(fb.taskIndex + 1).padStart(2, '0')}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{fb.taskTitle}</span>
                    {(fb.taskMethod || fb.taskScope) && (
                      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        · {[fb.taskMethod, fb.taskScope].filter(Boolean).join(' / ')}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--fg)' }}>{fb.content}</p>
                </div>
              );
            })
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div className="flex flex-col gap-4">
          {/* Evaluator info */}
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

          {/* Keywords */}
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

          {/* Task summary */}
          <div className="sd-card">
            <div className="sd-label-mini" style={{ marginBottom: 12 }}>과업별 피드백 수</div>
            <div className="flex flex-col gap-3">
              {Object.values(taskMap).map((task) => {
                const count = task.feedbackHistory?.length ?? 0;
                return (
                  <div
                    key={task.id}
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
                        T{String(task.index + 1).padStart(2, '0')} {task.title}
                      </div>
                    </div>
                    <span
                      style={{
                        marginLeft: 8,
                        padding: '2px 8px',
                        borderRadius: 12,
                        background: count > 0 ? 'var(--ok-orange-50)' : 'var(--bg-muted)',
                        color: count > 0 ? 'var(--ok-orange)' : 'var(--fg-muted)',
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {count}건
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tip */}
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
