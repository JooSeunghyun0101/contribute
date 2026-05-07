import type { ComponentType, SVGProps } from 'react';
import { IconTrend } from './Icons';

type Props = {
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  trend?: number;
};

export const StatCard = ({ icon: Icon, label, value, sub, accent = false, trend }: Props) => (
  <div
    className="sd-card"
    style={{
      padding: 18,
      background: accent
        ? 'linear-gradient(135deg, var(--ok-orange) 0%, var(--ok-orange-600) 100%)'
        : 'var(--bg-card)',
      color: accent ? '#fff' : 'inherit',
      border: accent ? 'none' : '1px solid var(--border)',
    }}
  >
    <div className="flex items-start justify-between">
      <div
        className="sd-label-mini"
        style={{ color: accent ? 'rgba(255,255,255,0.85)' : 'var(--fg-subtle)' }}
      >
        {label}
      </div>
      <div style={{ opacity: accent ? 0.85 : 0.6 }}>
        <Icon width={18} height={18} />
      </div>
    </div>
    <div
      className="tnum"
      style={{
        fontSize: 30,
        fontWeight: 800,
        marginTop: 8,
        letterSpacing: '-0.03em',
      }}
    >
      {value}
    </div>
    {sub && (
      <div
        style={{
          fontSize: 12,
          color: accent ? 'rgba(255,255,255,0.85)' : 'var(--fg-muted)',
          marginTop: 4,
        }}
      >
        {sub}
      </div>
    )}
    {trend != null && (
      <div
        className="flex items-center gap-1"
        style={{
          marginTop: 10,
          fontSize: 12,
          color: accent ? '#fff' : 'var(--success)',
          fontWeight: 700,
        }}
      >
        <IconTrend width={14} height={14} /> +{trend}%
      </div>
    )}
  </div>
);
