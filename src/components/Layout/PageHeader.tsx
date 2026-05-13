import type { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export const PageHeader = ({ title, subtitle, actions }: Props) => (
  <div
    className="flex items-center justify-between"
    style={{ padding: '28px 32px 20px', borderBottom: '1px solid var(--border)' }}
  >
    <div>
      <h1 style={{ fontSize: 'var(--fs-h1)', letterSpacing: '-0.02em' }}>{title}</h1>
      {subtitle && (
        <p style={{ marginTop: 6, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>{subtitle}</p>
      )}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export default PageHeader;
