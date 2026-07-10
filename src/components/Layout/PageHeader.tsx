import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
  /** 검색·필터 등 페이지 레벨 컨트롤. 제목 아래에 함께 표시된다. */
  filters?: ReactNode;
};

// 모든 페이지 공통 헤더 — 제목·필터를 표시한다.
// 고정(sticky)하지 않는다: 콘텐츠와 함께 스크롤되어 본문 영역을 더 넓게 쓴다.
export const PageHeader = ({ title, subtitle, actions, filters }: Props) => (
  <div
    data-sticky-header=""
    style={{
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
