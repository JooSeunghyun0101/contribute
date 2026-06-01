import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildMonthlyScoreTrend,
  hasTrendData,
  type MonthlyScorePoint,
  type TrendTaskInput,
} from '@/lib/scoreTrend';

interface MonthlyScoreTrendChartProps {
  tasks: TrendTaskInput[];
  growthLevel: number;
  year?: number;
  title?: string;
}

const TrendTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as MonthlyScorePoint;
  if (point.cumulativeScore === null) return null;
  return (
    <div
      style={{
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        padding: '10px 12px',
        fontSize: 'var(--fs-sm)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{point.label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: 'var(--fg-muted)' }}>누적 점수</span>
        <span className="tnum" style={{ fontWeight: 800, color: 'var(--ok-orange)' }}>
          {point.cumulativeScore.toFixed(2)}
        </span>
      </div>
      {point.achievement !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: 'var(--fg-muted)' }}>달성률</span>
          <span className="tnum" style={{ fontWeight: 800 }}>{point.achievement}%</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: 'var(--fg-muted)' }}>완료 과업</span>
        <span className="tnum" style={{ fontWeight: 700, color: 'var(--fg-muted)' }}>
          {point.scoredCount}개
        </span>
      </div>
    </div>
  );
};

const MonthlyScoreTrendChart = ({
  tasks,
  growthLevel,
  year,
  title = '월별 점수 추이',
}: MonthlyScoreTrendChartProps) => {
  const points = useMemo(
    () => buildMonthlyScoreTrend(tasks, growthLevel, { year }),
    [tasks, growthLevel, year],
  );
  const hasData = useMemo(() => hasTrendData(tasks), [tasks]);

  const yMax = useMemo(() => {
    const maxScore = points.reduce(
      (max, p) => (p.cumulativeScore !== null && p.cumulativeScore > max ? p.cumulativeScore : max),
      0,
    );
    return Math.max(4, Math.ceil(growthLevel), Math.ceil(maxScore));
  }, [points, growthLevel]);

  return (
    <div className="sd-card" style={{ padding: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{title}</h3>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', fontWeight: 600 }}>
          누적 가중 점수 · 목표 Lv.{growthLevel}
        </span>
      </div>

      {!hasData ? (
        <div
          style={{
            height: 240,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fg-muted)',
            fontSize: 'var(--fs-body)',
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          아직 입력된 점수가 없습니다.
          <br />
          과업 점수가 입력되면 월별 누적 추이가 표시됩니다.
        </div>
      ) : (
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="scoreTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ok-orange)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--ok-orange)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis
                domain={[0, yMax]}
                tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
                axisLine={false}
                tickLine={false}
                width={36}
                allowDecimals={false}
              />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--border)' }} />
              {growthLevel > 0 && (
                <ReferenceLine
                  y={growthLevel}
                  stroke="var(--fg-subtle)"
                  strokeDasharray="4 4"
                  label={{
                    value: `목표 Lv.${growthLevel}`,
                    position: 'insideTopRight',
                    fontSize: 11,
                    fill: 'var(--fg-subtle)',
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="cumulativeScore"
                stroke="var(--ok-orange)"
                strokeWidth={2.5}
                fill="url(#scoreTrendFill)"
                connectNulls={false}
                dot={{ r: 3, fill: 'var(--ok-orange)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default MonthlyScoreTrendChart;
