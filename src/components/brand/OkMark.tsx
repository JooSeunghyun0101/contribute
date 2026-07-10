type Props = { size?: number; className?: string };

export const OkMark = ({ size = 28, className }: Props) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    className={className}
    style={{ flexShrink: 0 }}
  >
    <path
      d="M 8 20 A 12 12 0 0 1 32 20"
      stroke="var(--ok-yellow)"
      strokeWidth="4.5"
      fill="none"
      strokeLinecap="round"
    />
    <rect x="17.5" y="14" width="5" height="14" rx="1.5" fill="var(--ok-orange)" />
    <circle cx="20" cy="33" r="2.6" fill="var(--ok-orange)" />
  </svg>
);
