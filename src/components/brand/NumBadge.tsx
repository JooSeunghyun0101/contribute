import { cn } from '@/lib/utils';
import { getScoreColor, getScoreTextColor } from '@/lib/evaluationMatrix';

type Props = {
  score: number | null | undefined;
  size?: number;
  className?: string;
};

export const NumBadge = ({ score, size = 28, className }: Props) => {
  const label = score == null ? '-' : score;
  // 점수별 색상 체계와 동일하게 — 배경/텍스트 모두 점수에 연동.
  const bg = score == null ? 'var(--bg-muted)' : getScoreColor(score);
  const color = score == null ? 'var(--fg-subtle)' : getScoreTextColor(score);

  return (
    <span
      className={cn('inline-flex items-center justify-center font-mono font-bold', className)}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color,
        fontSize: Math.max(11, Math.round(size * 0.48)),
      }}
    >
      {label}
    </span>
  );
};
