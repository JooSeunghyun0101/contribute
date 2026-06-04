import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  CartesianGrid,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import {
  useTeamDashboardRecords,
  useFormerTeamDashboardRecords,
  usePriorYearRecords,
} from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { employeeService } from '@/lib/services';
import { buildEvaluatorPeriods, evaluatorActiveMonthRange } from '@/lib/evaluatorHistory';
import type { EvaluatorAssignmentHistory } from '@/types';
import OrgFilterBar from '@/components/hr/OrgFilterBar';
import AggregateScoreTrendChart from '@/components/Evaluation/AggregateScoreTrendChart';
import { buildAggregateMonthlyTrend } from '@/lib/scoreTrend';
import { matchesOrgFilter, type OrgFilterState } from '@/lib/orgHierarchy';
import {
  formatScore,
  getMatrixMethodIndex,
  getMatrixScopeIndex,
  getScoreColor,
  MATRIX_METHODS,
  MATRIX_SCOPES,
  MATRIX_SCORE_COLORS,
} from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

// 점수 색상표 기준
const COLOR_ACHIEVED = MATRIX_SCORE_COLORS[4]; // #E84200 진오렌지
const COLOR_MISSED = MATRIX_SCORE_COLORS[2]; // #C99A4E (예비, 점수표 2점)
const COLOR_PENDING = MATRIX_SCORE_COLORS[1]; // #BBB1A4 미완료 회색
const COLOR_BAR_DIM = '#F2D7C2'; // 비활성 막대용 옅은 오렌지
const COLOR_MISSED_LIGHT = '#E8B588'; // 미달성 — 달성색(#E84200)의 흐린 살구톤

type AchievementBucket = 'achieved' | 'missed' | 'pending';

const isEvaluationCompleted = (record: EmployeeEvaluationRecord): boolean =>
  record.reviewStatus === 'completed' || record.reviewStatus === 'locked';

const getBucket = (record: EmployeeEvaluationRecord): AchievementBucket => {
  if (!isEvaluationCompleted(record)) return 'pending';
  return record.achieved ? 'achieved' : 'missed';
};

const ScoreTablePage = () => {
  const { user } = useAuth();
  const evaluatorId = user?.employeeId || '';
  const { records: allRecords, isLoading, error } = useTeamDashboardRecords(evaluatorId);
  // 발령으로 떠난 과거 담당 피평가자도 월별 추이 분모에 포함하기 위해 함께 로드.
  const { records: formerRecords } = useFormerTeamDashboardRecords(evaluatorId);
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [orgFilter, setOrgFilter] = useState<OrgFilterState>({});

  // 카드/도넛/히트맵은 "현재 담당" 스냅샷 기준(기존 유지).
  const records = useMemo(
    () => allRecords.filter((r) => matchesOrgFilter(r.employee, orgFilter)),
    [allRecords, orgFilter],
  );

  const { periods, selectedPeriod } = useEvaluationPeriod();
  const currentYear = selectedPeriod?.evaluation_year ?? new Date().getFullYear();
  const priorYear = currentYear - 1;

  // 월별 추이는 "연중 담당했던 전체(현재+과거 발령)"를 모은 뒤,
  // 평가자 변경 이력으로 각 피평가자의 담당 기간을 구해 월별 담당 인원을 보정한다.
  const rosterRecords = useMemo(() => {
    const map = new Map<string, (typeof allRecords)[number]>();
    for (const r of allRecords) map.set(r.employee.employee_id, r);
    for (const r of formerRecords) {
      if (!map.has(r.employee.employee_id)) map.set(r.employee.employee_id, r);
    }
    return [...map.values()];
  }, [allRecords, formerRecords]);

  const rosterIdsKey = useMemo(
    () => rosterRecords.map((r) => r.employee.employee_id).sort().join(','),
    [rosterRecords],
  );

  // 피평가자별 평가자 변경 이력(원본). 연도별 담당기간은 그 평가기간(period) 행만으로 따로 계산한다.
  const [historyById, setHistoryById] = useState<Map<string, EvaluatorAssignmentHistory[]>>(
    () => new Map(),
  );
  useEffect(() => {
    const ids = rosterIdsKey ? rosterIdsKey.split(',') : [];
    if (!evaluatorId || ids.length === 0) {
      setHistoryById(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, await employeeService.getEvaluatorAssignmentHistory(id)] as const;
          } catch {
            return [id, [] as EvaluatorAssignmentHistory[]] as const;
          }
        }),
      );
      if (!cancelled) setHistoryById(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [evaluatorId, rosterIdsKey]);

  const selectedPeriodId = selectedPeriod?.id ?? null;
  const priorPeriodId = useMemo(
    () => periods.find((p) => p.evaluation_year === priorYear)?.id ?? null,
    [periods, priorYear],
  );

  // 추이용 멤버 빌더 — 해당 평가기간(periodId) 행만으로 담당기간을 구해 월별 활성 범위를 부여.
  // 그 기간에 한 번도 담당하지 않은 사람은 제외. 점수/달성은 완료(또는 잠금)된 평가만 반영.
  const buildTrendMembers = useCallback(
    (sourceRecords: EmployeeEvaluationRecord[], year: number, periodId: string | null) =>
      sourceRecords
        .filter((r) => matchesOrgFilter(r.employee, orgFilter))
        .filter((r) => selectedLevel === 'all' || (r.employee.growth_level ?? 1) === selectedLevel)
        .map((r) => {
          const history = historyById.get(r.employee.employee_id) ?? [];
          const period = history.length
            ? buildEvaluatorPeriods(history, { periodId }).get(evaluatorId) ?? null
            : { start: null, end: null }; // 이력 없음 → 현재 마스터 평가자가 줄곧 담당
          return {
            activeRange: evaluatorActiveMonthRange(period, year),
            tasks: isEvaluationCompleted(r)
              ? r.tasks.map((t) => ({ score: t.score, weight: t.weight, feedbackDate: t.feedback_date }))
              : [],
            growthLevel: Math.max(1, r.employee.growth_level ?? 1),
          };
        })
        .filter((m) => m.activeRange !== null),
    [orgFilter, selectedLevel, historyById, evaluatorId],
  );

  const trendMembers = useMemo(
    () => buildTrendMembers(rosterRecords, currentYear, selectedPeriodId),
    [buildTrendMembers, rosterRecords, currentYear, selectedPeriodId],
  );

  // 직전연도 비교 — 동일 로스터, 전년 평가기간(periodId) 행으로 담당기간 투영.
  const priorEmployees = useMemo(() => rosterRecords.map((r) => r.employee), [rosterRecords]);
  const priorRecords = usePriorYearRecords(priorEmployees, priorPeriodId, null);
  const priorTrend = useMemo(
    () =>
      buildAggregateMonthlyTrend(buildTrendMembers(priorRecords, priorYear, priorPeriodId), {
        year: priorYear,
      }),
    [buildTrendMembers, priorRecords, priorYear, priorPeriodId],
  );

  const levelStats = useMemo(() => {
    const buckets = new Map<
      number,
      { total: number; evaluated: number; achieved: number; scoreSum: number }
    >();
    // Lv.1~4 모두 기본 0으로 시작 — 대상자 없어도 0명 카드 표시
    for (const lv of [1, 2, 3, 4]) {
      buckets.set(lv, { total: 0, evaluated: 0, achieved: 0, scoreSum: 0 });
    }
    records.forEach((record) => {
      const level = record.employee.growth_level ?? 1;
      const b = buckets.get(level) ?? { total: 0, evaluated: 0, achieved: 0, scoreSum: 0 };
      b.total += 1;
      if (isEvaluationCompleted(record)) {
        b.evaluated += 1;
        b.scoreSum += record.weightedScore;
        if (record.achieved) b.achieved += 1;
      }
      buckets.set(level, b);
    });

    return Array.from(buckets.entries())
      .sort(([a], [b]) => b - a)
      .map(([level, b]) => ({
        level,
        label: `Lv.${level}`,
        total: b.total,
        evaluated: b.evaluated,
        achieved: b.achieved,
        missed: b.evaluated - b.achieved,
        pending: b.total - b.evaluated,
        avgScore: b.evaluated > 0 ? Number((b.scoreSum / b.evaluated).toFixed(2)) : 0,
        // 달성률은 평가 완료자가 아니라 전체 대상자(미완료 포함) 기준
        achievementRate: b.total > 0 ? Math.round((b.achieved / b.total) * 100) : 0,
      }));
  }, [records]);

  const scopedRecords = useMemo(
    () =>
      selectedLevel === 'all'
        ? records
        : records.filter((r) => (r.employee.growth_level ?? 1) === selectedLevel),
    [records, selectedLevel],
  );
  const scopedTotal = scopedRecords.length;

  const matrixHeatmap = useMemo(() => {
    const cells = MATRIX_METHODS.map(() =>
      MATRIX_SCOPES.map(() => ({ count: 0, scoreSum: 0, avgScore: 0 })),
    );
    scopedRecords.forEach((r) => {
      r.tasks.forEach((t) => {
        if (t.score == null || t.score <= 0) return;
        const mi = getMatrixMethodIndex(t.contribution_method);
        const si = getMatrixScopeIndex(t.contribution_scope);
        if (mi < 0 || si < 0) return;
        const cell = cells[mi][si];
        cell.count += 1;
        cell.scoreSum += t.score;
      });
    });
    cells.forEach((row) =>
      row.forEach((cell) => {
        cell.avgScore = cell.count > 0 ? cell.scoreSum / cell.count : 0;
      }),
    );
    const totalEvaluated = cells.reduce((s, row) => s + row.reduce((rs, c) => rs + c.count, 0), 0);
    return { cells, totalEvaluated };
  }, [scopedRecords]);

  const achievementBuckets = useMemo(() => {
    const counts = { achieved: 0, missed: 0, pending: 0 };
    scopedRecords.forEach((r) => {
      counts[getBucket(r)] += 1;
    });
    return [
      { key: 'achieved', name: '달성', value: counts.achieved, color: COLOR_ACHIEVED },
      { key: 'missed', name: '미달성', value: counts.missed, color: COLOR_MISSED_LIGHT },
      { key: 'pending', name: '미완료', value: counts.pending, color: COLOR_PENDING },
    ].filter((b) => b.value > 0);
  }, [scopedRecords]);

  const hasData = records.length > 0;
  const scopeLabel = selectedLevel === 'all' ? '전체' : `Lv.${selectedLevel}`;

  // 팀 전체 통계 (상단 카드 첫 칸용)
  const teamStats = useMemo<LevelStatRow>(() => {
    const evaluated = records.filter(isEvaluationCompleted);
    const achieved = evaluated.filter((r) => r.achieved);
    const avgScore =
      evaluated.length > 0
        ? evaluated.reduce((s, r) => s + r.weightedScore, 0) / evaluated.length
        : 0;
    return {
      level: 0,
      label: '전체',
      total: records.length,
      evaluated: evaluated.length,
      achieved: achieved.length,
      missed: evaluated.length - achieved.length,
      pending: records.length - evaluated.length,
      avgScore: Number(avgScore.toFixed(2)),
      // 달성률은 전체 대상자(미완료 포함) 기준
      achievementRate:
        records.length > 0 ? Math.round((achieved.length / records.length) * 100) : 0,
    };
  }, [records]);

  const allCards: LevelStatRow[] = useMemo(
    () => [teamStats, ...levelStats],
    [teamStats, levelStats],
  );

  return (
    <>
      <PageHeader
        title="팀 통계"
        subtitle="레벨별 평균 점수와 달성 현황 · 점수 분포"
      />

      <div style={{ padding: '24px 32px 32px' }} className="flex flex-col gap-5">
        <OrgFilterBar
          items={allRecords.map((r) => r.employee)}
          value={orgFilter}
          onChange={setOrgFilter}
        />
        {isLoading ? (
          <div className="sd-card">통계 데이터를 불러오는 중입니다.</div>
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>{error}</div>
        ) : !hasData ? (
          <div className="sd-card">표시할 팀원이 없습니다.</div>
        ) : (
          <>
            {/* Level summary row — 카드 자체가 필터. 전체 + 레벨별 N개 */}
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(allCards.length, 1)}, minmax(0, 1fr))`,
                gap: 14,
              }}
            >
              {allCards.map((row) => {
                const target: number | 'all' = row.level === 0 ? 'all' : row.level;
                const isActive = selectedLevel === target;
                return (
                  <LevelSummaryCard
                    key={row.level}
                    row={row}
                    isActive={isActive}
                    onClick={() => setSelectedLevel(target)}
                  />
                );
              })}
            </section>

            {/* Shared filter + bar/donut */}
            <section
              className="sd-card sd-card-lg"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <div>
                <div className="sd-label-mini">레벨 비교</div>
                <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginTop: 2 }}>
                  평균 점수 · 달성 현황
                </h3>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 4 }}>
                  현재 보기 · <b style={{ color: 'var(--ok-orange)' }}>{scopeLabel}</b>
                  {selectedLevel !== 'all' && ` · ${scopedTotal}명`}
                  <span style={{ marginLeft: 6, color: 'var(--fg-subtle)' }}>
                    (위 카드를 클릭해 필터 변경)
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
                  gap: 20,
                  alignItems: 'stretch',
                }}
              >
                {/* Bar (stacked: 달성/미달성/미완료) + Line (평균 점수) */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg-muted)', marginBottom: 6 }}>
                    레벨별 인원 구성 · 평균 점수
                  </div>
                  <div style={{ width: '100%', height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={levelStats}
                        margin={{ top: 24, right: 8, left: -10, bottom: 0 }}
                        barCategoryGap="34%"
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 'var(--fs-sm)', fill: 'var(--fg)', fontWeight: 800 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="count"
                          allowDecimals={false}
                          tick={{ fontSize: 'var(--fs-xs)', fill: 'var(--fg-muted)' }}
                          axisLine={false}
                          tickLine={false}
                          label={{
                            value: '명',
                            position: 'insideTopLeft',
                            fontSize: 10,
                            fill: 'var(--fg-muted)',
                            offset: 0,
                          }}
                        />
                        <YAxis
                          yAxisId="score"
                          orientation="right"
                          domain={[0, 4]}
                          ticks={[0, 1, 2, 3, 4]}
                          tick={{ fontSize: 'var(--fs-xs)', fill: 'var(--fg-muted)' }}
                          axisLine={false}
                          tickLine={false}
                          label={{
                            value: '점',
                            position: 'insideTopRight',
                            fontSize: 10,
                            fill: 'var(--fg-muted)',
                            offset: 0,
                          }}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(245,80,0,0.06)' }}
                          contentStyle={{
                            borderRadius: 10,
                            border: '1px solid var(--border)',
                            fontSize: 'var(--fs-sm)',
                            background: 'var(--bg-card)',
                          }}
                          formatter={(value: number, name: string) => {
                            if (name === '평균 점수') {
                              return [value > 0 ? formatScore(value) : '–', name];
                            }
                            return [`${value}명`, name];
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 'var(--fs-xs)', fontWeight: 700 }}
                          iconType="circle"
                        />
                        {(['achieved', 'missed', 'pending'] as const).map((key) => {
                          const config = {
                            achieved: { name: '달성', color: COLOR_ACHIEVED },
                            missed: { name: '미달성', color: COLOR_MISSED_LIGHT },
                            pending: { name: '미완료', color: COLOR_PENDING },
                          }[key];
                          const isLastSegment = key === 'pending';
                          return (
                            <Bar
                              key={key}
                              yAxisId="count"
                              stackId="count"
                              dataKey={key}
                              name={config.name}
                              fill={config.color}
                              radius={isLastSegment ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                              onClick={(d: any) =>
                                setSelectedLevel((prev) =>
                                  prev === d.level ? 'all' : (d.level as number),
                                )
                              }
                              style={{ cursor: 'pointer' }}
                            >
                              {levelStats.map((row) => {
                                const isActive =
                                  selectedLevel === 'all' || selectedLevel === row.level;
                                return (
                                  <Cell
                                    key={row.level}
                                    fillOpacity={isActive ? 1 : 0.32}
                                  />
                                );
                              })}
                              {isLastSegment && (
                                <LabelList
                                  dataKey="total"
                                  position="top"
                                  formatter={(v: number) => (v > 0 ? `${v}명` : '')}
                                  style={{
                                    fontSize: 'var(--fs-xs)',
                                    fontWeight: 800,
                                    fill: 'var(--fg-muted)',
                                  }}
                                />
                              )}
                            </Bar>
                          );
                        })}
                        <Line
                          yAxisId="score"
                          type="monotone"
                          dataKey="avgScore"
                          name="평균 점수"
                          stroke="var(--ok-orange-700)"
                          strokeWidth={2.5}
                          dot={{ r: 5, fill: 'var(--ok-orange-700)', stroke: '#fff', strokeWidth: 2 }}
                          activeDot={{ r: 7 }}
                        >
                          <LabelList
                            dataKey="avgScore"
                            position="bottom"
                            formatter={(v: number) => (v > 0 ? formatScore(v) : '')}
                            style={{
                              fontSize: 'var(--fs-xs)',
                              fontWeight: 800,
                              fill: 'var(--ok-orange-700)',
                            }}
                          />
                        </Line>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Donut */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg-muted)', marginBottom: 6 }}>
                    {scopeLabel} 달성 현황
                  </div>

                  {achievementBuckets.length === 0 ? (
                    <div
                      style={{
                        color: 'var(--fg-muted)',
                        fontSize: 'var(--fs-body)',
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      표시할 데이터가 없습니다.
                    </div>
                  ) : (
                    <>
                      <div style={{ width: '100%', height: 280, position: 'relative' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={achievementBuckets}
                              dataKey="value"
                              nameKey="name"
                              innerRadius="58%"
                              outerRadius="88%"
                              paddingAngle={2}
                              startAngle={90}
                              endAngle={-270}
                            >
                              {achievementBuckets.map((b) => (
                                <Cell
                                  key={b.key}
                                  fill={b.color}
                                  stroke="var(--bg-card)"
                                  strokeWidth={2}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                borderRadius: 10,
                                border: '1px solid var(--border)',
                                fontSize: 'var(--fs-sm)',
                                background: 'var(--bg-card)',
                              }}
                              formatter={(value: number, name: string) => [
                                `${value}명 (${scopedTotal > 0 ? Math.round((value / scopedTotal) * 100) : 0}%)`,
                                name,
                              ]}
                            />
                            <Legend
                              verticalAlign="bottom"
                              iconType="circle"
                              wrapperStyle={{ fontSize: 'var(--fs-xs)', fontWeight: 700 }}
                              formatter={(value: string) => {
                                const item = achievementBuckets.find((b) => b.name === value);
                                if (!item) return value;
                                const pct =
                                  scopedTotal > 0
                                    ? Math.round((item.value / scopedTotal) * 100)
                                    : 0;
                                return `${value} ${item.value}명 (${pct}%)`;
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>

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
                          <span
                            className="tnum"
                            style={{
                              fontSize: 'var(--fs-h2)',
                              fontWeight: 900,
                              color: 'var(--ok-orange)',
                              lineHeight: 1.0,
                            }}
                          >
                            {(() => {
                              if (scopedTotal === 0) return '–';
                              const achieved =
                                achievementBuckets.find((b) => b.key === 'achieved')?.value ?? 0;
                              return `${Math.round((achieved / scopedTotal) * 100)}%`;
                            })()}
                          </span>
                          <span
                            style={{
                              fontSize: 'var(--fs-xs)',
                              fontWeight: 700,
                              color: 'var(--fg-muted)',
                              marginTop: 2,
                            }}
                          >
                            달성률
                          </span>
                        </div>
                      </div>

                    </>
                  )}
                </div>

                {/* Heatmap - method × scope */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--fg-muted)', marginBottom: 6 }}>
                    {scopeLabel} 매트릭스 분포
                  </div>
                  <MatrixHeatmap cells={matrixHeatmap.cells} total={matrixHeatmap.totalEvaluated} />
                </div>
              </div>
            </section>

            <AggregateScoreTrendChart
              members={trendMembers}
              year={selectedPeriod?.evaluation_year}
              title="월별 달성 현황 추이 (팀)"
              comparison={priorTrend}
              comparisonLabel="전년도"
            />

          </>
        )}
      </div>
    </>
  );
};

type LevelStatRow = {
  level: number;
  label: string;
  total: number;
  evaluated: number;
  achieved: number;
  missed: number;
  pending: number;
  avgScore: number;
  achievementRate: number;
};

const LevelSummaryCard = ({
  row,
  isActive,
  onClick,
}: {
  row: LevelStatRow;
  isActive?: boolean;
  onClick?: () => void;
}) => {
  const hasData = row.evaluated > 0;
  const pending = row.total - row.evaluated;
  const isOverall = row.level === 0;
  const rateColor = !hasData
    ? 'var(--fg-muted)'
    : row.achievementRate >= 50
      ? COLOR_ACHIEVED
      : COLOR_MISSED;

  // 전체 카드 — 짙은 오렌지 배경 + 흰 글자 (그룹 헤더 느낌)
  // 레벨 카드 — 옅은 오렌지 배경, 활성 시 한 단계 진하게 + ring
  const bg = isOverall
    ? 'var(--ok-orange)'
    : isActive
      ? 'var(--ok-orange-100)'
      : 'var(--ok-orange-50)';
  const border = isOverall ? 'var(--ok-orange-700)' : 'var(--ok-orange-100)';
  const labelColor = isOverall ? '#fff' : 'var(--ok-brown)';
  const subColor = isOverall ? 'rgba(255,255,255,0.82)' : 'var(--fg-muted)';
  const bigColor = isOverall ? '#fff' : hasData ? rateColor : 'var(--fg-muted)';
  const dividerColor = isOverall ? 'rgba(255,255,255,0.7)' : 'var(--fg-muted)';
  const trackBg = isOverall ? 'rgba(255,255,255,0.22)' : 'var(--bg-card)';
  const fillColor = isOverall ? '#fff' : rateColor;
  const ring = isActive
    ? isOverall
      ? '0 0 0 3px var(--ok-orange-700)'
      : '0 0 0 2px var(--ok-orange)'
    : 'none';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '18px 22px',
        borderRadius: 10,
        background: bg,
        boxShadow: ring,
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'left',
        transition: 'box-shadow 0.15s, background 0.15s',
        font: 'inherit',
        color: 'inherit',
        border: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 900, color: labelColor }}>
          {row.label}
        </span>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: subColor }}>
          전체 {row.total}명
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          className="tnum"
          style={{
            fontSize: 'var(--fs-h1)',
            fontWeight: 900,
            color: bigColor,
            lineHeight: 1.0,
          }}
        >
          {row.achieved}
        </span>
        <span
          className="tnum"
          style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: dividerColor }}
        >
          / {row.total}
        </span>
        <span
          style={{
            fontSize: 'var(--fs-sm)',
            fontWeight: 800,
            color: bigColor,
            marginLeft: 6,
          }}
        >
          달성 {hasData ? `· ${row.achievementRate}%` : ''}
        </span>
      </div>

      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: trackBg,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${hasData ? row.achievementRate : 0}%`,
            background: fillColor,
            borderRadius: 4,
            transition: 'width 0.4s',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          color: subColor,
        }}
      >
        <span>
          미달성 {row.missed}명{pending > 0 ? ` · 미완료 ${pending}명` : ''}
        </span>
        <span>평균 {hasData ? formatScore(row.avgScore) : '–'}</span>
      </div>
    </button>
  );
};

type HeatmapCell = { count: number; scoreSum: number; avgScore: number };

const HEATMAP_CELL = 56; // 정사각형 셀 크기 (px) — 막대/도넛 차트 280px와 시각적 균형

const MatrixHeatmap = ({
  cells,
  total,
}: {
  cells: HeatmapCell[][];
  total: number;
}) => {
  if (total === 0) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-muted)',
          fontSize: 'var(--fs-sm)',
          border: '1px dashed var(--border)',
          borderRadius: 10,
        }}
      >
        평가된 과업이 없습니다.
      </div>
    );
  }

  const maxCount = Math.max(...cells.flat().map((c) => c.count));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `auto repeat(4, ${HEATMAP_CELL}px)`,
        gap: 4,
        width: 'fit-content',
        margin: '0 auto',
      }}
    >
      {/* Header row */}
      <div />
      {MATRIX_SCOPES.map((scope) => (
        <div
          key={scope}
          style={{
            textAlign: 'center',
            fontWeight: 800,
            color: 'var(--fg-muted)',
            padding: '2px 0',
            fontSize: 'var(--fs-xs)',
            letterSpacing: '-0.02em',
          }}
        >
          {scope}
        </div>
      ))}

      {/* Body */}
      {MATRIX_METHODS.map((method, mi) => (
        <FragmentRow key={method} method={method} row={cells[mi]} maxCount={maxCount} />
      ))}

      {/* Footer 범례 */}
      <div style={{ gridColumn: '1 / -1', marginTop: 10 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 'var(--fs-xs)',
            color: 'var(--fg-muted)',
          }}
        >
          <span style={{ fontWeight: 700 }}>총 {total}건</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>적음</span>
            <div
              style={{
                width: 64,
                height: 8,
                borderRadius: 4,
                background:
                  'linear-gradient(to right, rgba(245,80,0,0.12), rgba(245,80,0,1.0))',
              }}
            />
            <span>많음</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const FragmentRow = ({
  method,
  row,
  maxCount,
}: {
  method: string;
  row: HeatmapCell[];
  maxCount: number;
}) => (
  <>
    <div
      style={{
        fontWeight: 800,
        color: 'var(--fg)',
        fontSize: 'var(--fs-xs)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingRight: 8,
        letterSpacing: '-0.02em',
      }}
    >
      {method}
    </div>
    {row.map((cell, si) => {
      const intensity = maxCount > 0 ? cell.count / maxCount : 0;
      const alpha = cell.count > 0 ? 0.15 + intensity * 0.85 : 0;
      const bg = cell.count > 0 ? `rgba(245, 80, 0, ${alpha})` : 'transparent';
      const isDark = intensity >= 0.6;
      const fg = cell.count > 0 ? (isDark ? '#fff' : 'var(--fg)') : 'var(--fg-muted)';
      return (
        <div
          key={si}
          title={
            cell.count > 0
              ? `${method} × ${MATRIX_SCOPES[si]} · ${cell.count}건 · 평균 ${formatScore(cell.avgScore)}`
              : `${method} × ${MATRIX_SCOPES[si]} · 평가 없음`
          }
          style={{
            width: HEATMAP_CELL,
            height: HEATMAP_CELL,
            background: bg,
            color: fg,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: cell.count === 0 ? '1px dashed var(--border)' : 'none',
          }}
        >
          {cell.count > 0 && (
            <span
              className="tnum"
              style={{
                fontSize: 'var(--fs-h4)',
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {Math.round(cell.avgScore)}
            </span>
          )}
        </div>
      );
    })}
  </>
);

export default ScoreTablePage;
