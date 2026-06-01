import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildAggregateMonthlyTrend,
  hasAggregateTrendData,
  type AggregateMonthlyPoint,
  type AggregateTrendMember,
} from '@/lib/scoreTrend';

interface AggregateScoreTrendChartProps {
  members: AggregateTrendMember[];
  year?: number;
  title?: string;
  subtitle?: string;
}

const AggregateTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as AggregateMonthlyPoint;
  if (point.avgScore === null && point.achievementRate === null) return null;
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
        <span style={{ color: 'var(--fg-muted)' }}>평균 점수</span>
        <span className="tnum" style={{ fontWeight: 800, color: 'var(--ok-orange)' }}>
          {point.avgScore === null ? '-' : point.avgScore.toFixed(2)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: 'var(--fg-muted)' }}>달성률</span>
        <span className="tnum" style={{ fontWeight: 800 }}>
          {point.achievementRate === null ? '-' : `${point.achievementRate}%`}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: 'var(--fg-muted)' }}>평가 완료</span>
        <span className="tnum" style={{ fontWeight: 700, color: 'var(--fg-muted)' }}>
          {point.evaluatedCount}/{point.totalCount}명
        </span>
      </div>
    </div>
  );
};

/** 조직/팀 단위 월별 평균 점수·달성률 추이(연중 진척 비교). */
const AggregateScoreTrendChart = ({
  members,
  year,
  title = '월별 평균 점수 추이',
  subtitle = '구성원 누적 점수 평균 · 달성률',
}: AggregateScoreTrendChartProps) => {
  const points = useMemo(
    () => buildAggregateMonthlyTrend(members, { year }),
    [members, year],
  );
  const hasData = useMemo(() => hasAggregateTrendData(members), [members]);
  const yMax = useMemo(() => {
    const max = points.reduce((m, p) => (p.avgScore !== null && p.avgScore > m ? p.avgScore : m), 0);
    return Math.max(4, Math.ceil(max));
  }, [points]);

  return (
    <div className="sd-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{title}</h3>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', fontWeight: 600 }}>{subtitle}</span>
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
          평가가 진행되면 월별 추이가 표시됩니다.
        </div>
      ) : (
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="aggScoreFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ok-orange)" stopOpacity={0.26} />
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
                yAxisId="score"
                domain={[0, yMax]}
                tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
                axisLine={false}
                tickLine={false}
                width={32}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: 'var(--fg-subtle)' }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<AggregateTooltip />} cursor={{ stroke: 'var(--border)' }} />
              <Area
                yAxisId="score"
                type="monotone"
                dataKey="avgScore"
                name="평균 점수"
                stroke="var(--ok-orange)"
                strokeWidth={2.5}
                fill="url(#aggScoreFill)"
                connectNulls={false}
                dot={{ r: 3, fill: 'var(--ok-orange)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="achievementRate"
                name="달성률"
                stroke="var(--fg-subtle)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default AggregateScoreTrendChart;
