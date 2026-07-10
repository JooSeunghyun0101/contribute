import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, props: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconHome = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M3 12l9-9 9 9" />
    <path d="M5 10v10h14V10" />
  </svg>
);

export const IconUsers = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 21c0-3.8 3.1-6 7-6s7 2.2 7 6" />
    <circle cx="17" cy="7" r="2.5" />
    <path d="M22 19c0-2.8-2-4.5-5-4.5" />
  </svg>
);

export const IconTarget = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

export const IconChart = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M3 3v18h18" />
    <rect x="7" y="11" width="3" height="7" />
    <rect x="13" y="6" width="3" height="12" />
    <rect x="19" y="14" width="0.5" height="4" />
  </svg>
);

export const IconSettings = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
);

export const IconBell = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10 21a2 2 0 004 0" />
  </svg>
);

export const IconCheck = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)} strokeWidth={2.5}>
    <polyline points="4 12 10 18 20 6" />
  </svg>
);

export const IconClock = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 16 14" />
  </svg>
);

export const IconMsg = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);

export const IconTrend = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <polyline points="3 17 9 11 13 15 21 7" />
    <polyline points="15 7 21 7 21 13" />
  </svg>
);

export const IconSearch = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

export const IconPlus = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const IconChevron = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

export const IconChevronDown = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const IconArrowRight = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" />
  </svg>
);

export const IconSparkle = ({ size = 20, ...p }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    {...p}
  >
    <path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z" />
  </svg>
);

export const IconCalendar = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
  </svg>
);

export const IconSend = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export const IconFile = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
    <polyline points="14 3 14 9 20 9" />
  </svg>
);

export const IconX = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="6" y1="18" x2="18" y2="6" />
  </svg>
);

export const IconUser = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);

export const IconGrid = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export const IconBook = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z" />
  </svg>
);

export const IconMoon = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
  </svg>
);

export const IconSun = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </svg>
);

export const IconLogout = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
