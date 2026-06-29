import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
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

// 달성 현황 막대 색 — "레벨별 인원 구성 · 평균 점수" 차트와 동일 팔레트.
const COLOR_ACHIEVED = 'var(--score-4-bg)'; // 달성 — 점수 단계 팔레트(4점)
const COLOR_MISSED = 'var(--score-2-bg)'; // 미달성 (2점 브라운)
const COLOR_PENDING = 'var(--score-1-bg)'; // 미완료 (1점 그레이)
// 달성률 라인 — 디자인 가이드 OK Yellow 계열.
const RATE_COLOR = '#CA8A04'; // 올해 달성률 — 진한 골드(글자색과 동일)
const RATE_PRIOR = '#E8C77A'; // 전년 달성률 — 연한 골드(명확히 구분)
const RATE_TEXT = '#CA8A04'; // 노랑 글자 가독성용 골드(--warning/--chart-5)
const PRIOR_RATE_TEXT = '#C9A85C';

// 'bars' = 달성/미달성/미완료 누적 막대, 'rate' = 달성률 라인, 'both' = 둘 다.
type Metric = 'bars' | 'rate' | 'both';

interface AggregateScoreTrendChartProps {
  members: AggregateTrendMember[];
  year?: number;
  title?: string;
  subtitle?: string;
  comparison?: AggregateMonthlyPoint[];
  comparisonLabel?: string;
  /** 차트 영역 높이(px). 기본 290. fill 이면 무시. */
  chartHeight?: number;
  /** 카드 높이를 부모(stretch)에 맞추고 차트가 남는 공간을 채움. */
  fill?: boolean;
}

const fmtRate = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v}%`);

const makeTooltip = (comparisonLabel: string, showComparison: boolean) =>
  function AggregateTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    // 미래 월(데이터 없음)은 툴팁을 띄우지 않는다.
    if (p.achievementRate === null && p.compareRate == null) return null;
    const cell: React.CSSProperties = { textAlign: 'right', fontWeight: 800 };
    const dot = (color: string) => (
      <span
        style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 6 }}
      />
    );
    return (
      <div
        style={{
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          padding: '10px 12px',
          fontSize: 'var(--fs-sm)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          minWidth: 160,
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
          {showComparison && (
            <>
              <span />
              <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>올해</span>
              <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--fg-subtle)' }}>{comparisonLabel}</span>
            </>
          )}
          <span style={{ color: 'var(--fg-muted)' }}>{dot(COLOR_ACHIEVED)}달성</span>
          <span className="tnum" style={cell}>{p.achievedCount}명</span>
          {showComparison && <span className="tnum" style={{ ...cell, color: 'var(--fg-subtle)' }}>{p.compareAchieved}명</span>}
          <span style={{ color: 'var(--fg-muted)' }}>{dot(COLOR_MISSED)}미달성</span>
          <span className="tnum" style={cell}>{p.missedCount}명</span>
          {showComparison && <span className="tnum" style={{ ...cell, color: 'var(--fg-subtle)' }}>{p.compareMissed}명</span>}
          <span style={{ color: 'var(--fg-muted)' }}>{dot(COLOR_PENDING)}미완료</span>
          <span className="tnum" style={cell}>{p.pendingCount}명</span>
          {showComparison && <span className="tnum" style={{ ...cell, color: 'var(--fg-subtle)' }}>{p.comparePending}명</span>}
          <span style={{ color: 'var(--fg)', fontWeight: 800, marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>합계</span>
          <span className="tnum" style={{ ...cell, marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
            {p.achievedCount + p.missedCount + p.pendingCount}명
          </span>
          {showComparison && (
            <span className="tnum" style={{ ...cell, marginTop: 4, color: 'var(--fg-subtle)', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
              {p.compareAchieved + p.compareMissed + p.comparePending}명
            </span>
          )}
          <span style={{ color: 'var(--fg-muted)', marginTop: 4 }}>달성률</span>
          <span className="tnum" style={{ ...cell, marginTop: 4, color: RATE_TEXT }}>{fmtRate(p.achievementRate)}</span>
          {showComparison && <span className="tnum" style={{ ...cell, marginTop: 4, color: PRIOR_RATE_TEXT }}>{fmtRate(p.compareRate)}</span>}
        </div>
        <div style={{ marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
          평가 완료 {p.evaluatedCount}/{p.totalCount}명
        </div>
      </div>
    );
  };

const METRIC_OPTIONS: Array<{ id: Metric; label: string }> = [
  { id: 'both', label: '종합' },
  { id: 'bars', label: '구성' },
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

/** 조직/팀 월별 추이 — 달성/미달성/미완료 누적 막대 + 달성률 라인. 전년 달성률 비교 on/off. */
const AggregateScoreTrendChart = ({
  members,
  year,
  title = '월별 추이',
  subtitle,
  comparison,
  comparisonLabel = '전년도',
  chartHeight = 290,
  fill = false,
}: AggregateScoreTrendChartProps) => {
  const [metric, setMetric] = useState<Metric>('both');
  const [showPrior, setShowPrior] = useState(true);

  const points = useMemo(() => buildAggregateMonthlyTrend(members, { year }), [members, year]);
  const data = useMemo(
    () =>
      points.map((p, i) => ({
        ...p,
        compareRate: comparison?.[i]?.achievementRate ?? null,
        compareAchieved: comparison?.[i]?.achievedCount ?? 0,
        compareMissed: comparison?.[i]?.missedCount ?? 0,
        comparePending: comparison?.[i]?.pendingCount ?? 0,
      })),
    [points, comparison],
  );
  const hasCurrent = useMemo(() => hasAggregateTrendData(members), [members]);
  const priorAvailable = useMemo(
    () => (comparison ?? []).some((p) => p.achievementRate !== null),
    [comparison],
  );
  const showComparison = priorAvailable && showPrior;
  const hasData = hasCurrent || priorAvailable;

  const showBars = metric === 'bars' || metric === 'both';
  const showRate = metric === 'rate' || metric === 'both';

  // 누적 막대 합 = 총 인원. 축을 안정적으로 유지하기 위해 최대 총원(올해·전년 중 큰 값)으로 고정.
  const countMax = useMemo(() => {
    const max = data.reduce(
      (m, p) =>
        Math.max(
          m,
          p.achievedCount + p.missedCount + p.pendingCount,
          p.compareAchieved + p.compareMissed + p.comparePending,
        ),
      0,
    );
    return Math.max(1, max);
  }, [data]);

  const barSize = 26;

  const TooltipContent = makeTooltip(comparisonLabel, showComparison);

  return (
    <div
      className="sd-card"
      style={{ padding: 18, ...(fill ? { height: '100%', display: 'flex', flexDirection: 'column' } : {}) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{title}</h3>
          {subtitle && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
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
            // 데이터 있을 때와 동일 높이로 고정 — 레벨 선택에 따라 페이지 높이가 변해
            // 스크롤이 튀고 고정 헤더가 풀리는 것을 막는다. fill 이면 남는 공간을 채운다.
            ...(fill ? { flex: 1, minHeight: 240 } : { height: chartHeight }),
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
        <div style={fill ? { flex: 1, minHeight: 240 } : { height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            {/* barGap 음수 → 전년 누적막대(올해와 동일 두께)가 뒤에, 올해 막대가 앞에서 전년 좌측을 가려 전년이 우측으로 겹쳐 보임 */}
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barGap={-44}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              {showBars && (
                <YAxis yAxisId="count" domain={[0, countMax]} tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
              )}
              {showRate && (
                <YAxis yAxisId="rate" orientation={showBars ? 'right' : 'left'} domain={[0, 100]} tick={{ fontSize: 11, fill: RATE_TEXT }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
              )}
              <Tooltip content={<TooltipContent />} cursor={{ fill: 'var(--bg-muted)', opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              {/* 전년 누적 막대 — 올해 막대 옆에 그룹으로, 흐리게. 범례는 올해 것만 사용. */}
              {showBars && showComparison && (
                <Bar yAxisId="count" stackId="compPrior" dataKey="compareAchieved" name={`${comparisonLabel} 달성`} fill={COLOR_ACHIEVED} fillOpacity={0.4} barSize={barSize} legendType="none" />
              )}
              {showBars && showComparison && (
                <Bar yAxisId="count" stackId="compPrior" dataKey="compareMissed" name={`${comparisonLabel} 미달성`} fill={COLOR_MISSED} fillOpacity={0.4} barSize={barSize} legendType="none" />
              )}
              {showBars && showComparison && (
                <Bar yAxisId="count" stackId="compPrior" dataKey="comparePending" name={`${comparisonLabel} 미완료`} fill={COLOR_PENDING} fillOpacity={0.4} barSize={barSize} legendType="none" radius={[3, 3, 0, 0]} />
              )}
              {/* 올해 누적 막대 — 달성(아래) → 미달성 → 미완료(위, 상단 라운드) */}
              {showBars && (
                <Bar yAxisId="count" stackId="comp" dataKey="achievedCount" name="달성" fill={COLOR_ACHIEVED} barSize={barSize} />
              )}
              {showBars && (
                <Bar yAxisId="count" stackId="comp" dataKey="missedCount" name="미달성" fill={COLOR_MISSED} barSize={barSize} />
              )}
              {showBars && (
                <Bar yAxisId="count" stackId="comp" dataKey="pendingCount" name="미완료" fill={COLOR_PENDING} barSize={barSize} radius={[3, 3, 0, 0]} />
              )}
              {/* 전년 달성률 라인 */}
              {showRate && showComparison && (
                <Line yAxisId="rate" type="monotone" dataKey="compareRate" name={`${comparisonLabel} 달성률`} stroke={RATE_PRIOR} strokeWidth={2} dot={false} connectNulls />
              )}
              {/* 올해 달성률 라인 (맨 앞) */}
              {showRate && (
                <Line yAxisId="rate" type="monotone" dataKey="achievementRate" name="올해 달성률" stroke={RATE_COLOR} strokeWidth={2.5} dot={{ r: 2.5, fill: RATE_COLOR, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default AggregateScoreTrendChart;
