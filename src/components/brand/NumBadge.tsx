import { cn } from '@/lib/utils';
import { getScoreColor, getScoreTextColor } from '@/lib/evaluationMatrix';

type Props = {
  score: number | null | undefined;
  /** 정사각형 한 변 px. */
  size?: number;
  className?: string;
};

// 과업 카드/리스트에서 점수를 강조하는 정사각형 배지.
// 점수 색상 배경 + 숫자만 표시.
export const NumBadge = ({ score, size = 28, className }: Props) => {
  const label = score == null ? '-' : score;
  const bg = score == null ? 'var(--bg-muted)' : getScoreColor(score);
  const color = score == null ? 'var(--fg-subtle)' : getScoreTextColor(score);
  const radius = Math.max(5, Math.round(size * 0.2));
  const valueSize = Math.max(12, Math.round(size * 0.62));

  return (
    <span
      className={cn('items-center justify-center tnum font-bold', className)}
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        flexGrow: 0,
        boxSizing: 'border-box',
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: radius,
        background: bg,
        color,
        lineHeight: 1,
        fontSize: valueSize,
        boxShadow: score == null ? 'none' : '0 1px 3px rgba(0,0,0,0.10)',
        verticalAlign: 'middle',
      }}
    >
      {label}
    </span>
  );
};
