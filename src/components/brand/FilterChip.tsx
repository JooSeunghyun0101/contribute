import type { ReactNode } from 'react';

type Props = {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** 칩 형태의 단일 선택 필터 버튼. 전체 일정·피드백 내역 등 목록 화면 필터에서 공통 사용.
 *  스타일은 index.css 의 .sd-filter-chip (hover/focus-visible/active 상태 포함). */
export const FilterChip = ({ active, onClick, children }: Props) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`sd-filter-chip${active ? ' is-active' : ''}`}
  >
    {children}
  </button>
);
