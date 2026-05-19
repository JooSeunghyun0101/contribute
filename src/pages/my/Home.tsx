import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import { NumBadge } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import {
  getMatrixScore,
  getMatrixMethodIndex,
  getMatrixScopeIndex,
  getScoreColor,
  getScoreTextColor,
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
    useEvaluationDataDB(user?.employeeId || '');

  const tasks = useMemo(() => evaluationData?.tasks ?? [], [evaluationData?.tasks]);
  const { exactScore } = calculateTotalScore();
  const achieved = isAchieved();
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
  const weightDonutData = useMemo(
    () =>
      tasks.map((t, i) => ({
        name: `T${String(i + 1).padStart(2, '0')} ${t.title}`,
        shortName: `T${String(i + 1).padStart(2, '0')}`,
        weight: t.weight ?? 0,
        score: getMatrixScore(t.contributionMethod, t.contributionScope, matrix) ?? t.score ?? null,
        index: i,
      })),
    [matrix, tasks],
  );

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

  const newCount = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return tasks.flatMap((t) => t.feedbackHistory ?? []).filter((fb) => new Date(fb.date) > cutoff)
      .length;
  }, [tasks]);

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
        평가 데이터를 불러오는 중입니다…
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '28px 32px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* ── 헤더 ─────────────────────────────────────── */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <h1 style={{ fontSize: 'var(--fs-h1)', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
            {user?.name}{' '}
            <span style={{ fontSize: 'var(--fs-h3)', fontWeight: 500, color: 'var(--fg-muted)' }}>
              {user?.position} · {user?.department}
            </span>
          </h1>
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
                {exactScore.toFixed(1)}
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
              <div
                style={{
                  fontSize: 'var(--fs-display)',
                  fontWeight: 900,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                  color: achieved ? 'var(--ok-orange)' : 'var(--fg-muted)',
                }}
              >
                {achieved ? '달성' : '미달성'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {!evaluationData ? (
        <div className="sd-card" style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
          평가 데이터가 없습니다.
        </div>
      ) : (
        <>
          {/* ── 2-컬럼 (기여 분포 + 간트) ────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
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
                          minHeight: 48,
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
                    const bg = getScoreColor(cell.score);
                    return (
                      <div
                        style={{
                          minHeight: 48,
                          borderRadius: 8,
                          background: bg,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: getScoreTextColor(cell.score),
                          lineHeight: 1.05,
                          gap: 2,
                          padding: '4px 0',
                        }}
                        title={hasScore ? `${label} · ${cell.score}점` : `${label} · 미평가`}
                      >
                        <span
                          style={{
                            fontSize: 'var(--fs-micro)',
                            fontWeight: 800,
                            opacity: 0.85,
                            letterSpacing: '0.04em',
                          }}
                        >
                          {label}
                        </span>
                        <span
                          className="tnum"
                          style={{
                            fontSize: hasScore ? 'var(--fs-h3)' : 'var(--fs-xs)',
                            fontWeight: 900,
                          }}
                        >
                          {hasScore ? cell.score : '미평가'}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      style={{
                        minHeight: 48,
                        borderRadius: 8,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        padding: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                      title={cellTasks
                        .map((c) => {
                          const lab = `T${String(c.taskIndex + 1).padStart(2, '0')}`;
                          return c.score != null ? `${lab}·${c.score}점` : `${lab}·미평가`;
                        })
                        .join(', ')}
                    >
                      {cellTasks.map((c) => {
                        const lab = `T${String(c.taskIndex + 1).padStart(2, '0')}`;
                        const hasScore = c.score != null;
                        const bg = getScoreColor(c.score);
                        return (
                          <div
                            key={`chip-${c.taskIndex}`}
                            style={{
                              flex: 1,
                              minHeight: 18,
                              borderRadius: 5,
                              background: bg,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0 6px',
                              color: getScoreTextColor(c.score),
                              fontSize: 'var(--fs-micro)',
                              fontWeight: 800,
                              lineHeight: 1,
                            }}
                          >
                            <span style={{ opacity: 0.9, letterSpacing: '0.02em' }}>{lab}</span>
                            <span className="tnum" style={{ fontSize: 'var(--fs-xs)', fontWeight: 900 }}>
                              {hasScore ? c.score : '–'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />

              {/* Summary */}
              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                }}
              >
                {([4, 3, 2, 1] as const).filter((s) => dist[String(s)] > 0).map((s) => (
                  <div
                    key={s}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-body)' }}
                  >
                    <span style={{ color: 'var(--fg-muted)' }}>{s}점 과업</span>
                    <span style={{ fontWeight: 700 }}>{dist[String(s)]}</span>
                  </div>
                ))}
                {dist.none > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-body)' }}>
                    <span style={{ color: 'var(--fg-muted)' }}>미평가</span>
                    <span style={{ fontWeight: 700 }}>{dist.none}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 과업 일정 (간트) */}
            <div className="sd-card" style={{ padding: 18 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>과업 일정 (간트)</h3>
                {/* month labels */}
                <div style={{ display: 'flex', gap: 0, flex: 1, marginLeft: 16 }}>
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
                  <div style={{ width: 64 }} />
                </div>
              </div>

              {/* Task rows */}
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}
              >
                {/* Today marker */}
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

                {tasks.map((task, index) => {
                  const startFrac = toGanttFrac(task.startDate);
                  const endFrac = Math.max(startFrac + 0.04, toGanttFrac(task.endDate));
                  const leftPct = startFrac * 100;
                  const widthPct = (endFrac - startFrac) * 100;
                  const taskScore = getCurrentScore(task);

                  return (
                    <div
                      key={task.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 64px',
                        gap: 8,
                        alignItems: 'center',
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
                            background: getScoreColor(taskScore),
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
                          T{String(index + 1).padStart(2, '0')} · {task.title}
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
                                background: getScoreColor(taskScore),
                                color: getScoreTextColor(taskScore),
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
                            미평가
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

          {/* ── 과업 비율 도넛차트 ───────────────────────────── */}
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
              <div style={{ position: 'relative', height: 300 }}>
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
                            <Cell key={entry.shortName} fill={getScoreColor(entry.score)} />
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

              {/* Legend / breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {weightDonutData.map((item, i) => {
                  const color = getScoreColor(item.score);
                  return (
                    <div
                      key={item.shortName}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: 'var(--bg-muted)',
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
                      <span
                        className="tnum"
                        style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg)' }}
                      >
                        {item.weight}%
                      </span>
                      {item.score != null ? (
                        <NumBadge score={item.score} size={20} />
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
                          미평가
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── 최근 피드백 ───────────────────────────── */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>최근 피드백</h3>
              {newCount > 0 && (
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ok-orange)', fontWeight: 700 }}>
                  신규 {newCount}건
                </span>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 14,
              }}
            >
              {recentFeedbacks.map((fb, i) => (
                <div key={fb.id ?? i} className="sd-card" style={{ padding: 18 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 'var(--fs-body)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        marginRight: 8,
                      }}
                    >
                      {fb.taskTitle}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: getScoreColor(fb.taskScore),
                          color: getScoreTextColor(fb.taskScore),
                          fontWeight: 900,
                          fontSize: 'var(--fs-sm)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {fb.taskScore ?? '-'}
                      </div>
                      <span className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 700 }}>
                        {fb.taskScore != null ? `${fb.taskScore.toFixed(1)}` : '-'}
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: 'var(--fs-body)', lineHeight: 1.7, color: 'var(--fg)', margin: 0 }}>
                    {fb.content}
                  </p>
                  <div style={{ marginTop: 10, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                    {fb.evaluatorName} · {formatDate(fb.date)}
                  </div>
                </div>
              ))}
              {recentFeedbacks.length === 0 && (
                <div className="sd-card" style={{ padding: 18, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                  아직 받은 피드백이 없습니다.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MyHome;
