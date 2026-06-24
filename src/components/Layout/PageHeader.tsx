import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
  /** 검색·필터 등 페이지 레벨 컨트롤. 제목과 함께 상단에 고정(sticky)되어 스크롤해도 유지된다. */
  filters?: ReactNode;
};

// 모든 페이지 공통 헤더 — 상단에 고정(sticky)되어 스크롤해도 제목·필터가 유지된다.
// 스크롤 컨테이너는 AppLayout 의 <main overflow-y-auto> 이며, 그 최상단(TopBar 아래)에 붙는다.
export const PageHeader = ({ title, subtitle, actions, filters }: Props) => (
  <div
    data-sticky-header=""
    style={{
      position: 'sticky',
      top: 0,
      zIndex: 30,
      background: 'var(--bg-app)',
      borderBottom: '1px solid var(--border)',
    }}
  >
    <div
      className="flex items-center justify-between"
      style={{ padding: filters ? '28px 32px 14px' : '28px 32px 20px', gap: 16 }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 'var(--fs-h1)', letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && (
          <p style={{ marginTop: 6, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>{actions}</div>}
    </div>
    {filters && (
      <div
        style={{
          padding: '0 32px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {filters}
      </div>
    )}
  </div>
);

export default PageHeader;
