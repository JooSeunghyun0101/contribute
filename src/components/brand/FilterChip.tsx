import type { ReactNode } from 'react';

type Props = {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** 칩 형태의 단일 선택 필터 버튼. 전체 일정·피드백 내역 등 목록 화면 필터에서 공통 사용. */
export const FilterChip = ({ active, onClick, children }: Props) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '5px 12px',
      borderRadius: 16,
      border: `1px solid ${active ? 'var(--ok-orange)' : 'var(--border)'}`,
      background: active ? 'var(--ok-orange)' : 'var(--bg-card)',
      color: active ? '#fff' : 'var(--fg-muted)',
      fontSize: 'var(--fs-sm)',
      fontWeight: 700,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'background 0.15s, color 0.15s, border-color 0.15s',
    }}
  >
    {children}
  </button>
);
