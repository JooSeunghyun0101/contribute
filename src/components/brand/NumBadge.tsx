import { cn } from '@/lib/utils';

type Props = {
  score: number | null | undefined;
  size?: number;
  className?: string;
};

export const NumBadge = ({ score, size = 28, className }: Props) => {
  const label = score == null ? '-' : score;
  const bg =
    score == null
      ? 'var(--bg-muted)'
      : 'linear-gradient(135deg, var(--ok-orange) 0%, var(--ok-yellow) 100%)';
  const color = score == null ? 'var(--fg-subtle)' : '#fff';

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
