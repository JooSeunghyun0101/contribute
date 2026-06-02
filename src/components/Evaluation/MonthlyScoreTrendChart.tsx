import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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

const SCORE_COLOR = '#E84200'; // 올해 점수 (달성 색)
const SCORE_PRIOR = '#E8B588'; // 전년 점수 (연한 살구)
const RATE_COLOR = '#CA8A04'; // 올해 달성률 — 진한 골드(글자색과 동일)
const RATE_PRIOR = '#E8C77A'; // 전년 달성률 — 연한 골드(명확히 구분)
const RATE_TEXT = '#CA8A04'; // 노랑 글자 가독성용 골드
const PRIOR_SCORE_TEXT = '#C2772E';
const PRIOR_RATE_TEXT = '#C9A85C';

type Metric = 'score' | 'rate' | 'both';

interface MonthlyScoreTrendChartProps {
  tasks: TrendTaskInput[];
  growthLevel: number;
  year?: number;
  title?: string;
  comparison?: MonthlyScorePoint[];
  comparisonLabel?: string;
}

const fmtScore = (v: number | null | undefined) => (v === null || v === undefined ? '-' : v.toFixed(2));
const fmtRate = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v}%`);

const makeTooltip = (comparisonLabel: string, showComparison: boolean) =>
  function TrendTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    if (p.cumulativeScore === null && p.compareScore == null) return null;
    const cell: React.CSSProperties = { textAlign: 'right', fontWeight: 800 };
    return (
      <div
        style={{
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          padding: '10px 12px',
          fontSize: 'var(--fs-sm)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          minWidth: showComparison ? 180 : 140,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{p.label}</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: showComparison ? 'auto 1fr 1fr' : 'auto 1fr',
            columnGap: 14,
            rowGap: 5,
            alignItems: 'center',
          }}
        >
          <span />
          <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>올해</span>
          {showComparison && (
            <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg-subtle)' }}>{comparisonLabel}</span>
          )}
          <span style={{ color: 'var(--fg-muted)' }}>누적 점수</span>
          <span className="tnum" style={{ ...cell, color: SCORE_COLOR }}>{fmtScore(p.cumulativeScore)}</span>
          {showComparison && (
            <span className="tnum" style={{ ...cell, fontWeight: 700, color: PRIOR_SCORE_TEXT }}>{fmtScore(p.compareScore)}</span>
          )}
          <span style={{ color: 'var(--fg-muted)' }}>달성률</span>
          <span className="tnum" style={{ ...cell, color: RATE_TEXT }}>{fmtRate(p.achievement)}</span>
          {showComparison && (
            <span className="tnum" style={{ ...cell, fontWeight: 700, color: PRIOR_RATE_TEXT }}>{fmtRate(p.compareRate)}</span>
          )}
        </div>
      </div>
    );
  };

const METRIC_OPTIONS: Array<{ id: Metric; label: string }> = [
  { id: 'both', label: '종합' },
  { id: 'score', label: '점수' },
  { id: 'rate', label: '달성률' },
];

function ChartControls({
  metric,
  onMetric,
  showPrior,
  onTogglePrior,
  priorAvailable,
}: {
  metric: Metric;
  onMetric: (m: Metric) => void;
  showPrior: boolean;
  onTogglePrior: () => void;
  priorAvailable: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {METRIC_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onMetric(opt.id)}
            style={{
              padding: '4px 12px',
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              background: metric === opt.id ? 'var(--ok-orange)' : 'transparent',
              color: metric === opt.id ? '#fff' : 'var(--fg-muted)',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {priorAvailable && (
        <button
          type="button"
          onClick={onTogglePrior}
          aria-pressed={showPrior}
          style={{
            padding: '4px 10px',
            fontSize: 'var(--fs-xs)',
            fontWeight: 700,
            borderRadius: 8,
            cursor: 'pointer',
            border: `1px solid ${showPrior ? 'var(--ok-orange)' : 'var(--border)'}`,
            background: showPrior ? 'var(--ok-orange-50)' : 'transparent',
            color: showPrior ? 'var(--ok-orange)' : 'var(--fg-muted)',
          }}
        >
          전년 비교
        </button>
      )}
    </div>
  );
}

const MonthlyScoreTrendChart = ({
  tasks,
  growthLevel,
  year,
  title = '월별 추이',
  comparison,
  comparisonLabel = '전년도',
}: MonthlyScoreTrendChartProps) => {
  const [metric, setMetric] = useState<Metric>('both');
  const [showPrior, setShowPrior] = useState(true);

  const points = useMemo(
    () => buildMonthlyScoreTrend(tasks, growthLevel, { year }),
    [tasks, growthLevel, year],
  );
  const data = useMemo(
    () =>
      points.map((p, i) => ({
        ...p,
        compareScore: comparison?.[i]?.cumulativeScore ?? null,
        compareRate: comparison?.[i]?.achievement ?? null,
      })),
    [points, comparison],
  );
  const hasCurrent = useMemo(() => hasTrendData(tasks), [tasks]);
  const priorAvailable = useMemo(
    () => (comparison ?? []).some((p) => p.cumulativeScore !== null),
    [comparison],
  );
  const showComparison = priorAvailable && showPrior;
  const hasData = hasCurrent || priorAvailable;

  const showScore = metric === 'score' || metric === 'both';
  const showRate = metric === 'rate' || metric === 'both';

  const yMax = useMemo(() => {
    const max = data.reduce((m, p) => {
      const cand = Math.max(p.cumulativeScore ?? 0, p.compareScore ?? 0);
      return cand > m ? cand : m;
    }, 0);
    return Math.max(4, Math.ceil(growthLevel), Math.ceil(max));
  }, [data, growthLevel]);

  const TooltipContent = makeTooltip(comparisonLabel, showComparison);

  return (
    <div className="sd-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{title}</h3>
        <ChartControls
          metric={metric}
          onMetric={setMetric}
          showPrior={showPrior}
          onTogglePrior={() => setShowPrior((v) => !v)}
          priorAvailable={priorAvailable}
        />
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
          과업 점수가 입력되면 월별 추이가 표시됩니다.
        </div>
      ) : (
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barGap={-44}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              {showScore && (
                <YAxis yAxisId="score" domain={[0, yMax]} tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
              )}
              {showRate && (
                <YAxis yAxisId="rate" orientation={showScore ? 'right' : 'left'} domain={[0, 100]} tick={{ fontSize: 11, fill: RATE_TEXT }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
              )}
              <Tooltip content={<TooltipContent />} cursor={{ fill: 'var(--bg-muted)', opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              {/* z-순서(뒤→앞): 전년점수 → 전년달성률 → 올해점수 → 올해달성률 → 목표 */}
              {/* 전년 점수 바 (맨 뒤) */}
              {showScore && showComparison && (
                <Bar yAxisId="score" dataKey="compareScore" name={`${comparisonLabel} 점수`} fill={SCORE_PRIOR} radius={[3, 3, 0, 0]} barSize={26} />
              )}
              {/* 전년 달성률 라인 */}
              {showRate && showComparison && (
                <Line yAxisId="rate" type="monotone" dataKey="compareRate" name={`${comparisonLabel} 달성률`} stroke={RATE_PRIOR} strokeWidth={2} dot={false} connectNulls />
              )}
              {/* 올해 점수 바 */}
              {showScore && (
                <Bar yAxisId="score" dataKey="cumulativeScore" name="올해 누적" fill={SCORE_COLOR} radius={[3, 3, 0, 0]} barSize={26} />
              )}
              {/* 올해 달성률 라인 */}
              {showRate && (
                <Line yAxisId="rate" type="monotone" dataKey="achievement" name="올해 달성률" stroke={RATE_COLOR} strokeWidth={2.5} dot={{ r: 2.5, fill: RATE_COLOR, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} />
              )}
              {/* 목표 레벨 (맨 앞) */}
              {showScore && growthLevel > 0 && (
                <ReferenceLine
                  yAxisId="score"
                  y={growthLevel}
                  stroke="#FFAA00"
                  strokeWidth={2}
                  label={{ value: `목표 Lv.${growthLevel}`, position: 'insideTopRight', fontSize: 11, fontWeight: 700, fill: '#CA8A04' }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default MonthlyScoreTrendChart;
