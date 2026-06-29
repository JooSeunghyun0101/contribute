import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
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

const SCORE_COLOR = 'var(--score-4-bg)'; // 올해 점수 (4점 색)
const SCORE_PRIOR = 'var(--score-2-bg)'; // 전년 점수 (2점 브라운)
const PRIOR_SCORE_TEXT = '#C2772E';

interface MonthlyScoreTrendChartProps {
  tasks: TrendTaskInput[];
  growthLevel: number;
  year?: number;
  title?: string;
  comparison?: MonthlyScorePoint[];
  comparisonLabel?: string;
}

const fmtScore = (v: number | null | undefined) => (v === null || v === undefined ? '-' : v.toFixed(2));

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
        </div>
      </div>
    );
  };

function ChartControls({
  showPrior,
  onTogglePrior,
  priorAvailable,
}: {
  showPrior: boolean;
  onTogglePrior: () => void;
  priorAvailable: boolean;
}) {
  if (!priorAvailable) return null;
  return (
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
              <YAxis domain={[0, yMax]} tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
              <Tooltip content={<TooltipContent />} cursor={{ fill: 'var(--bg-muted)', opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              {/* 전년 점수 바 (맨 뒤) */}
              {showComparison && (
                <Bar dataKey="compareScore" name={`${comparisonLabel} 점수`} fill={SCORE_PRIOR} radius={[3, 3, 0, 0]} barSize={26} />
              )}
              {/* 올해 점수 바 */}
              <Bar dataKey="cumulativeScore" name="올해 누적" fill={SCORE_COLOR} radius={[3, 3, 0, 0]} barSize={26} />
              {/* 목표 레벨 */}
              {growthLevel > 0 && (
                <ReferenceLine
                  y={growthLevel}
                  stroke="var(--score-3-bg)"
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
