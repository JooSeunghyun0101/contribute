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

// accent=true 는 그라디언트 대신 잉크 카드(--surface-ink) — 대시보드에서 딱 한 장만 쓰는 강조 서피스.
export const StatCard = ({ icon: Icon, label, value, sub, accent = false, trend }: Props) => (
  <div
    className="sd-card"
    style={{
      padding: 18,
      background: accent ? 'var(--surface-ink)' : 'var(--bg-card)',
      color: accent ? 'var(--surface-ink-fg)' : 'inherit',
      border: accent ? '1px solid transparent' : '1px solid var(--border)',
    }}
  >
    <div className="flex items-start justify-between">
      <div
        className="sd-label-mini"
        style={{ color: accent ? 'var(--surface-ink-sub)' : 'var(--fg-subtle)' }}
      >
        {label}
      </div>
      <div style={{ opacity: accent ? 0.9 : 0.6, color: accent ? 'var(--ok-orange-brand)' : undefined }}>
        <Icon width={18} height={18} />
      </div>
    </div>
    <div
      className="tnum"
      style={{
        fontSize: 'var(--fs-h1)',
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
          fontSize: 'var(--fs-sm)',
          color: accent ? 'var(--surface-ink-sub)' : 'var(--fg-muted)',
          marginTop: 4,
        }}
      >
        {sub}
      </div>
    )}
    {trend != null && (
      <div
        className="flex items-center gap-1 tnum"
        style={{
          marginTop: 10,
          fontSize: 'var(--fs-sm)',
          color: accent ? 'var(--ok-yellow-300)' : 'var(--success)',
          fontWeight: 700,
        }}
      >
        <IconTrend width={14} height={14} /> +{trend}%
      </div>
    )}
  </div>
);
