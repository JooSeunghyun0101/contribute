import { getScoreColor } from '@/lib/evaluationMatrix';

// 단위 표시: 큰 수는 천단위 콤마, 소수는 최대 1자리.
export const formatKpiValue = (value: number | null | undefined, unit: string): string => {
  if (value == null || Number.isNaN(value)) return '-';
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? rounded.toLocaleString('ko-KR') : rounded.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  return `${text}${unit}`;
};

export const kpiProgressPct = (achieved?: number | null, target?: number | null): number => {
  if (!target || target <= 0) return 0;
  return Math.round(((achieved ?? 0) / target) * 100);
};

type Props = {
  achieved?: number | null;
  target?: number | null;
  unit: string;
  /** 배분 합계(과/미배분 점검용). 있으면 목표 대비 배분 표시. */
  allocated?: number | null;
  compact?: boolean;
};

// 진척 막대 — 달성률에 따라 OK 매트릭스 색을 재사용(4점=달성 색).
const KpiProgressBar = ({ achieved, target, unit, allocated, compact = false }: Props) => {
  const pct = kpiProgressPct(achieved, target);
  const clamped = Math.min(100, Math.max(0, pct));
  // 0~100% 를 매트릭스 점수 1~4 로 매핑해 색 일관성 유지.
  const color = getScoreColor(1 + (clamped / 100) * 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 6, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="tnum" style={{ fontSize: compact ? 'var(--fs-sm)' : 'var(--fs-body)', fontWeight: 800 }}>
          {formatKpiValue(achieved, unit)}{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}>/ {formatKpiValue(target, unit)}</span>
        </span>
        <span className="tnum" style={{ fontSize: compact ? 'var(--fs-sm)' : 'var(--fs-body)', fontWeight: 900, color }}>
          {pct}%
        </span>
      </div>
      <div style={{ height: compact ? 6 : 8, background: 'var(--bg-muted)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${clamped}%`, background: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
      {allocated != null && target != null && target > 0 && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
          배분 {formatKpiValue(allocated, unit)} ({kpiProgressPct(allocated, target)}%)
          {allocated > target ? ' · 과배분' : allocated < target ? ' · 미배분' : ''}
        </span>
      )}
    </div>
  );
};

export default KpiProgressBar;
