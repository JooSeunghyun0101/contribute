import { cn } from '@/lib/utils';
import {
  getScoreColor,
  getScoreTextColor,
  getScoreTintBg,
  getScoreTintFg,
} from '@/lib/evaluationMatrix';

type Props = {
  score: number | null | undefined;
  /** 정사각형 한 변 px. */
  size?: number;
  /** 솔리드 대신 옅은 틴트(배경+글씨)로 표시. 직원 화면에서 색 과잉을 줄일 때 사용. */
  tint?: boolean;
  className?: string;
};

// 과업 카드/리스트에서 점수를 강조하는 정사각형 배지.
// 점수 색상 배경 + 숫자만 표시.
export const NumBadge = ({ score, size = 28, tint = false, className }: Props) => {
  const label = score == null ? '-' : score;
  const bg = score == null ? 'var(--bg-muted)' : tint ? getScoreTintBg(score) : getScoreColor(score);
  const color =
    score == null ? 'var(--fg-subtle)' : tint ? getScoreTintFg(score) : getScoreTextColor(score);
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
        boxShadow: score == null || tint ? 'none' : 'var(--sh-sm)',
        verticalAlign: 'middle',
      }}
    >
      {label}
    </span>
  );
};
