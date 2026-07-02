import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import PageHeader from '@/components/Layout/PageHeader';
import { LoadingState } from '@/components/ui/state-views';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import { NumBadge } from '@/components/brand';
import { CelebrationOverlay, type CelebrationTrigger } from '@/components/ui/lottie-celebration-overlay';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { aiContentService } from '@/lib/services';
import { AiContentText } from '@/components/ui/AiContentText';
import { AiSectionTitle } from '@/components/ui/AiSectionTitle';
import {
  formatScore,
  getMatrixScore,
  getMatrixMethodIndex,
  getMatrixScopeIndex,
  getScoreTintBg,
  getScoreTintFg,
} from '@/lib/evaluationMatrix';

/* ── 간트 날짜 계산 (1월~12월 기준) ──────────────────────── */
const GANTT_MONTHS = 12;
const GANTT_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

const toGanttFrac = (value?: string): number => {
  if (!value) return 0;
  const d = new Date(value);
  if (isNaN(d.getTime())) return 0;
  const month = d.getMonth();          // 0=Jan
  const day = d.getDate();
  const frac = (month + (day - 1) / 31) / GANTT_MONTHS;
  return Math.max(0, Math.min(1, frac));
};

const todayDate = new Date();
const todayFrac = toGanttFrac(
  `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`,
);

const formatDate = (value?: string) => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/* ════════════════════════════════════════════════════════ */
const MyHome = () => {
  const { user } = useAuth();
  const { matrix } = useEvaluationMatrix();
  const { evaluationData, isLoading, calculateTotalScore, isAchieved } =
    useEvaluationDataDB(user?.employeeId || '', { readOnly: true });

  const tasks = useMemo(() => evaluationData?.tasks ?? [], [evaluationData?.tasks]);
  const { exactScore } = calculateTotalScore();
  const achieved = isAchieved();
  const [fireworkTrigger, setFireworkTrigger] = useState<CelebrationTrigger | null>(null);
  const handleAchievementClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!achieved) return;
    event.currentTarget.animate(
      [
        { transform: 'scale(1)', textShadow: '0 0 0 rgba(255, 190, 64, 0)' },
        { transform: 'scale(1.08)', textShadow: '0 0 22px rgba(255, 196, 72, 0.75)' },
        { transform: 'scale(0.99)', textShadow: '0 0 9px rgba(255, 196, 72, 0.45)' },
        { transform: 'scale(1)', textShadow: '0 0 0 rgba(255, 190, 64, 0)' },
      ],
      { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    setFireworkTrigger((prev) => ({
      id: (prev?.id ?? 0) + 1,
      x: event.clientX,
      y: event.clientY,
    }));
  };
  const getCurrentScore = (task: {
    contributionMethod?: string | null;
    contributionScope?: string | null;
    score?: number | null;
  }) =>
    getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ??
    task.score ??
    null;

  /* 매트릭스 셀 맵 (한 셀에 여러 과업 가능) */
  const cellMap = useMemo(() => {
    const map: Record<string, Array<{ taskIndex: number; score?: number | null }>> = {};
    tasks.forEach((task, i) => {
      const row = getMatrixMethodIndex(task.contributionMethod);
      const col = getMatrixScopeIndex(task.contributionScope);
      if (row >= 0 && col >= 0) {
        const k = `${row}-${col}`;
        if (!map[k]) map[k] = [];
        map[k].push({
          taskIndex: i,
          score: getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ??
            task.score ??
            null,
        });
      }
    });
    return map;
  }, [matrix, tasks]);

  /* 점수 분포 */
  const dist = useMemo(() => {
    const d: Record<string, number> = { '4': 0, '3': 0, '2': 0, '1': 0, none: 0 };
    tasks.forEach((t) => {
      const score = getMatrixScore(t.contributionMethod, t.contributionScope, matrix) ?? t.score ?? null;
      if (score === 1 || score === 2 || score === 3 || score === 4) {
        d[String(score)]++;
      } else {
        d.none++;
      }
    });
    return d;
  }, [matrix, tasks]);

  /* 도넛차트 데이터 — 과업별 가중치 */
  const totalWeight = useMemo(
    () => tasks.reduce((sum, t) => sum + (t.weight ?? 0), 0),
    [tasks],
  );
  // 과업비율 도넛 선택 → 리스트·기여분포·간트 연동 하이라이트.
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const toggleActiveTask = (id: string | null) => setActiveTaskId((prev) => (prev === id ? null : id));
  const weightDonutData = useMemo(
    () =>
      tasks.map((t, i) => ({
        name: `T${String(i + 1).padStart(2, '0')} ${t.title}`,
        shortName: `T${String(i + 1).padStart(2, '0')}`,
        weight: t.weight ?? 0,
        score: getMatrixScore(t.contributionMethod, t.contributionScope, matrix) ?? t.score ?? null,
        index: i,
        id: t.id,
        isAiTask: t.isAiTask ?? false,
      })),
    [matrix, tasks],
  );

  const { selectedPeriod } = useEvaluationPeriod();
  // 간트 '오늘' 세로줄은 현재 연도 평가기간을 볼 때만 표시(지난 연도 조회 시 숨김).
  const showTodayMarker = (selectedPeriod?.evaluation_year ?? todayDate.getFullYear()) === todayDate.getFullYear();

  // AI 종합 성장제안 — 평가자 저장 시 생성·영속된 값만 불러온다(조회 시 AI 재호출 없음).
  const growthScopeId =
    user?.employeeId && selectedPeriod?.id ? `${user.employeeId}:${selectedPeriod.id}` : null;
  const [growthSuggestion, setGrowthSuggestion] = useState<string | null>(null);
  const [growthGeneratedAt, setGrowthGeneratedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!growthScopeId) {
      setGrowthSuggestion(null);
      setGrowthGeneratedAt(null);
      return;
    }
    let cancelled = false;
    aiContentService.get('evaluatee_growth_suggestion', growthScopeId).then((rec) => {
      if (cancelled) return;
      setGrowthSuggestion(rec?.content ?? null);
      setGrowthGeneratedAt(rec?.generated_at ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [growthScopeId]);

  /* 최근 피드백 */
  const recentFeedbacks = useMemo(
    () =>
      tasks
        .flatMap((task, i) =>
          (task.feedbackHistory ?? []).map((fb) => ({
            ...fb,
            taskTitle: task.title,
            taskIndex: i,
            taskScore:
              getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ??
              task.score ??
              null,
          })),
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 2),
    [matrix, tasks],
  );

  // 최상단 한 줄 알림 — 성과보고(=최종제출) 주기. 매월 최소 1회 제출을 안내한다.
  // (현재 점수·목표 달성은 헤더에 이미 크게 있어 여기서는 제외)
  const summaryText = useMemo(() => {
    if (!evaluationData) return '평가 데이터가 없습니다.';
    const submittedAt = evaluationData.submittedAt;
    if (!submittedAt) {
      return '아직 성과보고(최종제출)가 없습니다. 매월 최소 1회는 성과보고를 해주세요.';
    }
    const now = new Date();
    const last = new Date(submittedAt);
    if (Number.isNaN(last.getTime())) return '성과보고 기록을 확인할 수 없습니다.';
    const days = Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000));
    const lastLabel = days === 0 ? '오늘' : `${days}일 전`;
    const thisMonth =
      last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth();
    if (thisMonth) {
      return `이번 달 성과보고 완료 · 마지막 제출 ${lastLabel}`;
    }
    return `이번 달 성과보고가 없습니다 (마지막 ${lastLabel}) · 매월 최소 1회는 성과보고를 해주세요`;
  }, [evaluationData]);

  if (isLoading) {
    return (
      <div style={{ padding: 32 }}>
        <LoadingState message="평가 데이터를 불러오는 중입니다…" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <>
            {user?.name}{' '}
            <span style={{ fontSize: 'var(--fs-h3)', fontWeight: 500, color: 'var(--fg-muted)' }}>
              {user?.position} · {user?.department}
            </span>
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 24, flexShrink: 0, alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 'var(--fs-micro)',
                  fontWeight: 700,
                  color: 'var(--fg-subtle)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                최종 점수
              </div>
              <div
                className="tnum"
                style={{ fontSize: 'var(--fs-display)', fontWeight: 900, color: 'var(--ok-orange)', lineHeight: 1 }}
              >
                {formatScore(exactScore)}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 'var(--fs-micro)',
                  fontWeight: 700,
                  color: 'var(--fg-subtle)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                목표 레벨
              </div>
              <div
                className="tnum"
                style={{ fontSize: 'var(--fs-display)', fontWeight: 900, lineHeight: 1 }}
              >
                Lv.{evaluationData?.growthLevel ?? '-'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 'var(--fs-micro)',
                  fontWeight: 700,
                  color: 'var(--fg-subtle)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                달성 여부
              </div>
              {achieved ? (
                <button
                  type="button"
                  className="tnum"
                  onClick={handleAchievementClick}
                  title="클릭하면 축하 폭죽이 터집니다."
                  style={{
                    fontSize: 'var(--fs-display)',
                    fontWeight: 900,
                    lineHeight: 1,
                    letterSpacing: 0,
                    color: 'var(--ok-orange)',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  달성
                </button>
              ) : (
                <div
                  style={{
                    fontSize: 'var(--fs-display)',
                    fontWeight: 900,
                    lineHeight: 1,
                    letterSpacing: 0,
                    color: 'var(--fg-muted)',
                  }}
                >
                  미달성
                </div>
              )}
            </div>
          </div>
        }
      />
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px 32px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <CelebrationOverlay trigger={fireworkTrigger} />

      {!evaluationData ? (
        <div className="sd-card" style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
          평가 데이터가 없습니다.
        </div>
      ) : (
        <>
          {/* 최상단 한 줄 요약 — order 로 재배치되는 행들보다 위(-3)에 고정 */}
          <div
            style={{
              order: -3,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 16px',
              borderRadius: 10,
              background: 'var(--ok-orange-50)',
              border: '1px solid var(--ok-orange-100)',
            }}
          >
            <span className="sd-label-mini" style={{ color: 'var(--ok-orange-700)', flexShrink: 0 }}>
              알림
            </span>
            <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--fg)' }}>
              {summaryText}
            </span>
          </div>

          {/* ── 2-컬럼 (기여 분포 + 간트) ── 화면상 '두 번째' 줄(order 로 과업비율 줄과 자리 바꿈) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, order: -1 }}>
            {/* 기여 분포 */}
            <div className="sd-card" style={{ padding: 18 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>기여 분포</h3>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', fontWeight: 600 }}>
                  방식 × 범위
                </span>
              </div>

              {/* Matrix */}
              <MatrixGrid
                matrix={matrix}
                rowHeaderWidth={64}
                gap={3}
                renderScopeLabel={(scope) => (
                  <div
                    style={{
                      textAlign: 'center',
                      fontSize: 'var(--fs-micro)',
                      fontWeight: 700,
                      color: 'var(--fg-muted)',
                      paddingTop: 4,
                    }}
                  >
                    {scope}
                  </div>
                )}
                renderCell={(_, __, mi, si, baseScore) => {
                  const key = `${mi}-${si}`;
                  const cellTasks = cellMap[key];

                  if (!cellTasks || cellTasks.length === 0) {
                    return (
                      <div
                        style={{
                          height: 48,
                          borderRadius: 8,
                          background: 'var(--bg-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--fg-subtle)',
                          fontWeight: 700,
                          fontSize: 'var(--fs-h4)',
                        }}
                      >
                        {baseScore}
                      </div>
                    );
                  }

                  if (cellTasks.length === 1) {
                    const cell = cellTasks[0];
                    const label = `T${String(cell.taskIndex + 1).padStart(2, '0')}`;
                    const hasScore = cell.score != null;
                    const bg = getScoreTintBg(cell.score);
                    const cellTask = tasks[cell.taskIndex];
                    const cellActive = cellTask?.id != null && cellTask.id === activeTaskId;
                    return (
                      <div
                        onClick={() => cellTask?.id && toggleActiveTask(cellTask.id)}
                        style={{
                          height: 48,
                          borderRadius: 8,
                          background: bg,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: getScoreTintFg(cell.score),
                          lineHeight: 1.05,
                          gap: 2,
                          padding: '4px 0',
                          cursor: 'pointer',
                          opacity: activeTaskId && !cellActive ? 0.35 : 1,
                        }}
                        title={hasScore ? `${label} · ${cell.score}점` : `${label} · 미완료`}
                      >
                        <span
                          style={{
                            fontSize: 'var(--fs-micro)',
                            fontWeight: 800,
                            opacity: 0.85,
                            letterSpacing: '0.04em',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          {cellTask?.isAiTask && (
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ai-accent)', boxShadow: '0 0 0 1px rgba(255,255,255,0.75)' }} />
                          )}
                          {label}
                        </span>
                        <span
                          className="tnum"
                          style={{
                            fontSize: hasScore ? 'var(--fs-h3)' : 'var(--fs-xs)',
                            fontWeight: 900,
                          }}
                        >
                          {hasScore ? cell.score : '미완료'}
                        </span>
                      </div>
                    );
                  }

                  const MAX_VISIBLE = 2;
                  const isOverflow = cellTasks.length > MAX_VISIBLE;
                  const visibleTasks = isOverflow
                    ? cellTasks.slice(0, MAX_VISIBLE - 1)
                    : cellTasks;
                  const overflowCount = cellTasks.length - visibleTasks.length;
                  return (
                    <div
                      style={{
                        height: 48,
                        borderRadius: 8,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        padding: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        overflow: 'hidden',
                      }}
                      title={cellTasks
                        .map((c) => {
                          const lab = `T${String(c.taskIndex + 1).padStart(2, '0')}`;
                          return c.score != null ? `${lab}·${c.score}점` : `${lab}·미완료`;
                        })
                        .join(', ')}
                    >
                      {visibleTasks.map((c) => {
                        const lab = `T${String(c.taskIndex + 1).padStart(2, '0')}`;
                        const hasScore = c.score != null;
                        const bg = getScoreTintBg(c.score);
                        const chipTask = tasks[c.taskIndex];
                        const chipActive = chipTask?.id != null && chipTask.id === activeTaskId;
                        return (
                          <div
                            key={`chip-${c.taskIndex}`}
                            onClick={() => chipTask?.id && toggleActiveTask(chipTask.id)}
                            style={{
                              flex: 1,
                              minHeight: 18,
                              borderRadius: 5,
                              background: bg,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0 6px',
                              color: getScoreTintFg(c.score),
                              fontSize: 'var(--fs-micro)',
                              fontWeight: 800,
                              lineHeight: 1,
                              cursor: 'pointer',
                              opacity: activeTaskId && !chipActive ? 0.35 : 1,
                            }}
                          >
                            <span
                              style={{ opacity: 0.9, letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            >
                              {chipTask?.isAiTask && (
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ai-accent)', boxShadow: '0 0 0 1px rgba(255,255,255,0.75)' }} />
                              )}
                              {lab}
                            </span>
                            <span className="tnum" style={{ fontSize: 'var(--fs-xs)', fontWeight: 900 }}>
                              {hasScore ? c.score : '–'}
                            </span>
                          </div>
                        );
                      })}
                      {overflowCount > 0 && (
                        <div
                          style={{
                            flex: 1,
                            minHeight: 18,
                            borderRadius: 5,
                            background: 'var(--bg-muted)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--fg-muted)',
                            fontSize: 'var(--fs-micro)',
                            fontWeight: 800,
                            lineHeight: 1,
                          }}
                        >
                          +{overflowCount}
                        </div>
                      )}
                    </div>
                  );
                }}
              />

              {/* Summary — 한 줄 가로 배치로 카드 높이 일정하게 유지 */}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  fontSize: 'var(--fs-sm)',
                  alignItems: 'center',
                }}
              >
                {([4, 3, 2, 1] as const).filter((s) => dist[String(s)] > 0).map((s) => (
                  <span
                    key={s}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span style={{ color: 'var(--fg-muted)' }}>{s}점</span>
                    <span className="tnum" style={{ fontWeight: 800, color: 'var(--fg)' }}>
                      {dist[String(s)]}
                    </span>
                  </span>
                ))}
                {dist.none > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--fg-muted)' }}>미완료</span>
                    <span className="tnum" style={{ fontWeight: 800, color: 'var(--fg)' }}>
                      {dist.none}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* 과업 일정 (간트) */}
            <div className="sd-card" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginBottom: 12 }}>
                과업 일정 (간트)
              </h3>
              {/* month labels — task row grid(1fr 64px gap 8)와 동일 정렬 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 64px',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex' }}>
                  {GANTT_LABELS.map((m) => (
                    <div
                      key={m}
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        fontSize: 'var(--fs-micro)',
                        fontWeight: 700,
                        color: 'var(--fg-muted)',
                      }}
                    >
                      {m}
                    </div>
                  ))}
                </div>
                <div />
              </div>

              {/* Task rows — 영역 고정. 과업이 많으면 안에서 세로 스크롤 */}
              <div
                style={{
                  height: 176,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  position: 'relative',
                }}
              >
                {/* Today marker — 현재 연도 조회 시에만 */}
                {showTodayMarker && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `calc(${todayFrac * 100}% - 32px)`,
                      width: 2,
                      background: 'var(--ok-orange)',
                      borderRadius: 1,
                      zIndex: 2,
                      pointerEvents: 'none',
                    }}
                  />
                )}

                {tasks.map((task, index) => {
                  const startFrac = toGanttFrac(task.startDate);
                  const endFrac = Math.max(startFrac + 0.04, toGanttFrac(task.endDate));
                  const leftPct = startFrac * 100;
                  const widthPct = (endFrac - startFrac) * 100;
                  const taskScore = getCurrentScore(task);

                  const ganttActive = task.id === activeTaskId;
                  return (
                    <div
                      key={task.id}
                      onClick={() => toggleActiveTask(task.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 64px',
                        gap: 8,
                        alignItems: 'center',
                        cursor: 'pointer',
                        opacity: activeTaskId && !ganttActive ? 0.45 : 1,
                      }}
                    >
                      <div
                        style={{
                          position: 'relative',
                          height: 28,
                          background: 'var(--bg-muted)',
                          borderRadius: 6,
                          overflow: 'hidden',
                        }}
                      >
                        {Array.from({ length: GANTT_MONTHS - 1 }, (_, i) => i + 1).map((i) => (
                          <div
                            key={i}
                            style={{
                              position: 'absolute',
                              top: 0,
                              bottom: 0,
                              left: `${(i / GANTT_MONTHS) * 100}%`,
                              width: 1,
                              background: 'rgba(0,0,0,0.08)',
                            }}
                          />
                        ))}
                        <div
                          style={{
                            position: 'absolute',
                            top: 3,
                            bottom: 3,
                            left: `${Math.min(96, leftPct)}%`,
                            width: `${Math.max(4, widthPct)}%`,
                            background: getScoreTintBg(taskScore),
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 8px',
                            color: getScoreTintFg(taskScore),
                            fontSize: 'var(--fs-xs)',
                            fontWeight: 700,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {`T${String(index + 1).padStart(2, '0')}`}
                          {task.isAiTask && (
                            <span
                              style={{
                                flexShrink: 0,
                                margin: '0 4px',
                                padding: '0 4px',
                                borderRadius: 999,
                                fontSize: 'var(--fs-2xs)',
                                fontWeight: 800,
                                color: 'var(--ai-accent)',
                                background: '#fff',
                              }}
                            >
                              AI
                            </span>
                          )}
                          {` · ${task.title}`}
                        </div>
                      </div>

                      {/* Score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {taskScore != null ? (
                          <>
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 6,
                                background: getScoreTintBg(taskScore),
                                color: getScoreTintFg(taskScore),
                                fontWeight: 900,
                                fontSize: 'var(--fs-sm)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {taskScore}
                            </div>
                            <span
                              className="tnum"
                              style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)' }}
                            >
                              {taskScore.toFixed(1)}
                            </span>
                          </>
                        ) : (
                          <span
                            style={{
                              fontSize: 'var(--fs-micro)',
                              fontWeight: 600,
                              color: 'var(--fg-subtle)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            미완료
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {!tasks.length && (
                  <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                    등록된 과업이 없습니다.
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>

          {/* ── 과업 비율 + AI 성장제안 (2단) ── 화면상 '첫 번째' 줄로 올림(order) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 16, alignItems: 'stretch', order: -2 }}>
          {/* 과업 비율 도넛차트 */}
          <div className="sd-card" style={{ padding: 18 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>과업 비율</h3>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', fontWeight: 600 }}>
                가중치 기준 · 총 {totalWeight}%
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 24, alignItems: 'center' }}>
              {/* Donut */}
              <div style={{ position: 'relative', height: 240 }}>
                {weightDonutData.length === 0 ? (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--fg-muted)',
                      fontSize: 'var(--fs-body)',
                    }}
                  >
                    표시할 과업이 없습니다.
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={weightDonutData}
                          onClick={(_d: unknown, idx: number) => toggleActiveTask(weightDonutData[idx]?.id ?? null)}
                          cursor="pointer"
                          dataKey="weight"
                          nameKey="shortName"
                          cx="50%"
                          cy="50%"
                          innerRadius={68}
                          outerRadius={96}
                          paddingAngle={2}
                          startAngle={90}
                          endAngle={-270}
                          stroke="var(--bg-card)"
                          strokeWidth={2}
                          labelLine={{ stroke: 'var(--fg-subtle)', strokeWidth: 1 }}
                          label={(props: any) => {
                            const { cx, cy, midAngle, outerRadius, percent, name } = props;
                            if (!percent) return null;
                            const RADIAN = Math.PI / 180;
                            const r = outerRadius + 14;
                            const x = cx + r * Math.cos(-midAngle * RADIAN);
                            const y = cy + r * Math.sin(-midAngle * RADIAN);
                            const anchor = x > cx ? 'start' : 'end';
                            return (
                              <text
                                x={x}
                                y={y}
                                textAnchor={anchor}
                                dominantBaseline="central"
                                style={{
                                  fontSize: 'var(--fs-xs)',
                                  fontWeight: 700,
                                  fill: 'var(--fg)',
                                }}
                              >
                                <tspan>{name}</tspan>
                                <tspan
                                  style={{ fill: 'var(--fg-muted)', fontWeight: 600 }}
                                  dx={4}
                                >
                                  {Math.round(percent * 100)}%
                                </tspan>
                              </text>
                            );
                          }}
                        >
                          {weightDonutData.map((entry) => (
                            <Cell
                              key={entry.shortName}
                              fill={getScoreTintBg(entry.score)}
                              opacity={activeTaskId && entry.id !== activeTaskId ? 0.25 : 1}
                              stroke="var(--bg-card)"
                              strokeWidth={2}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number) => [`${v}%`, '가중치']}
                          contentStyle={{
                            borderRadius: 10,
                            border: '1px solid var(--border)',
                            fontSize: 'var(--fs-sm)',
                            background: 'var(--bg-card)',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center label */}
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 'var(--fs-xs)',
                          fontWeight: 700,
                          color: 'var(--fg-muted)',
                          letterSpacing: '0.04em',
                        }}
                      >
                        과업
                      </div>
                      <div
                        className="tnum"
                        style={{
                          fontSize: 'var(--fs-h1)',
                          fontWeight: 900,
                          color: 'var(--fg)',
                          lineHeight: 1.1,
                        }}
                      >
                        {weightDonutData.length}
                        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--fg-muted)', marginLeft: 2 }}>
                          개
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Legend / breakdown — 높이 고정 + 스크롤 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  height: 240,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {weightDonutData.map((item, i) => {
                  const color = getScoreTintBg(item.score);
                  return (
                    <div
                      key={item.shortName}
                      onClick={() => toggleActiveTask(item.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: 'var(--bg-muted)',
                        opacity: activeTaskId && item.id !== activeTaskId ? 0.4 : 1,
                        cursor: 'pointer',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 'var(--fs-micro)',
                          fontWeight: 800,
                          color: 'var(--fg-muted)',
                          minWidth: 28,
                        }}
                      >
                        {item.shortName}
                      </span>
                      <span
                        style={{
                          fontSize: 'var(--fs-sm)',
                          fontWeight: 600,
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                      >
                        {tasks[i]?.title}
                      </span>
                      {item.isAiTask && (
                        <span
                          style={{
                            flexShrink: 0,
                            padding: '0 5px',
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
                      <span
                        className="tnum"
                        style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg)' }}
                      >
                        {item.weight}%
                      </span>
                      {item.score != null ? (
                        <NumBadge score={item.score} size={20} tint />
                      ) : (
                        <span
                          style={{
                            fontSize: 'var(--fs-2xs)',
                            fontWeight: 700,
                            color: 'var(--fg-subtle)',
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          미완료
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {/* AI 성장제안 카드 — 행의 오른쪽. 평가자 저장 시 생성·영속된 종합 제안(조회 시 AI 0). */}
          <div
            className="sd-card ai-shine-border"
            style={{ padding: 18, display: 'flex', flexDirection: 'column' }}
          >
            <AiSectionTitle
              title="AI 성장 제안"
              variant="heading"
              right={
                growthGeneratedAt
                  ? `${new Date(growthGeneratedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 생성`
                  : '평가자 저장 시 자동'
              }
              style={{ marginBottom: 14 }}
            />
            <div style={{ flex: 1, minHeight: 220 }}>
              {growthSuggestion ? (
                <AiContentText text={growthSuggestion} accent="var(--ai-accent)" fontSize="var(--fs-body)" />
              ) : (
                <p style={{ margin: 0, fontSize: 'var(--fs-body)', lineHeight: 1.75, color: 'var(--fg-muted)' }}>
                  평가자가 평가를 저장하면 과업 전체(일정·비중·기여방식/범위·피드백)를 종합한 성장 제안이
                  여기에 표시됩니다.
                </p>
              )}
            </div>
            {/* 최근 피드백 — 로그인 직후 '평가자가 뭐라고 했는지'를 첫 화면에서 바로 볼 수 있게. */}
            {recentFeedbacks.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg-muted)' }}>
                    최근 피드백
                  </span>
                  <Link
                    to="/my/feedback"
                    style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--ok-orange)' }}
                  >
                    피드백 이력 전체 보기 →
                  </Link>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recentFeedbacks.map((fb) => (
                    <div key={fb.id} style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
                      <span style={{ fontWeight: 700 }}>{fb.taskTitle}</span>
                      <span style={{ color: 'var(--fg-subtle)', fontSize: 'var(--fs-xs)', marginLeft: 6 }}>
                        {new Date(fb.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                      </span>
                      <div
                        style={{
                          color: 'var(--fg-muted)',
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {fb.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
        </>
      )}
      </div>
    </>
  );
};

export default MyHome;
