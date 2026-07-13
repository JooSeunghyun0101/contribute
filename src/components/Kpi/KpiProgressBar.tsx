import { getScoreColor } from '@/lib/evaluationMatrix';
import type { KpiDirection } from '@/types/kpi';

// 단위 표시: 큰 수는 천단위 콤마, 소수는 최대 1자리.
export const formatKpiValue = (value: number | null | undefined, unit: string): string => {
  if (value == null || Number.isNaN(value)) return '-';
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? rounded.toLocaleString('ko-KR') : rounded.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  return `${text}${unit}`;
};

// 달성률(%) — direction 반영. higher=실적/목표. lower(낮을수록 좋음)=목표/실적:
// 실적 미입력(null·hasActuals=false)이면 0(판정 불가), 실적 0 이하면 100(목표 이하 유지=달성).
export const kpiProgressPct = (
  achieved?: number | null,
  target?: number | null,
  direction: KpiDirection = 'higher',
  hasActuals?: boolean,
): number => {
  if (!target || target <= 0) return 0;
  if (direction === 'lower') {
    if (achieved == null || hasActuals === false) return 0;
    if (achieved <= 0) return 100;
    return Math.round((target / achieved) * 100);
  }
  return Math.round(((achieved ?? 0) / target) * 100);
};

type Props = {
  achieved?: number | null;
  target?: number | null;
  unit: string;
  /** 방향 — lower 면 '목표 이하 유지'가 달성. 미지정 시 higher. */
  direction?: KpiDirection;
  /** lower 방향에서 실적 미입력과 실적 0 을 구분하는 신호(서버 has_actuals). */
  hasActuals?: boolean;
  compact?: boolean;
};

// 진척 막대 — 달성률에 따라 OK 매트릭스 색을 재사용(4점=달성 색).
const KpiProgressBar = ({ achieved, target, unit, direction = 'higher', hasActuals, compact = false }: Props) => {
  const pct = kpiProgressPct(achieved, target, direction, hasActuals);
  const clamped = Math.min(100, Math.max(0, pct));
  // 0~100% 를 매트릭스 점수 1~4 로 매핑해 색 일관성 유지.
  // 점수 팔레트는 정수 키 조회 — 반올림 없이는 전 구간이 미평가 회색으로 떨어진다.
  const color = getScoreColor(Math.round(1 + (clamped / 100) * 3));
  const lowerNoActuals = direction === 'lower' && (achieved == null || hasActuals === false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 6, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="tnum" style={{ fontSize: compact ? 'var(--fs-sm)' : 'var(--fs-body)', fontWeight: 800 }}>
          {formatKpiValue(achieved, unit)}{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}>/ {formatKpiValue(target, unit)}</span>
          {direction === 'lower' && (
            <span style={{ marginLeft: 6, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 600 }}>
              낮을수록 좋음
            </span>
          )}
        </span>
        <span className="tnum" style={{ fontSize: compact ? 'var(--fs-sm)' : 'var(--fs-body)', fontWeight: 900, color: lowerNoActuals ? 'var(--fg-muted)' : color }}>
          {lowerNoActuals ? '실적 미입력' : `${pct}%`}
        </span>
      </div>
      <div style={{ height: compact ? 6 : 8, background: 'var(--bg-muted)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${clamped}%`, background: color, borderRadius: 'var(--r-pill)', transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
      </div>
    </div>
  );
};

export default KpiProgressBar;
