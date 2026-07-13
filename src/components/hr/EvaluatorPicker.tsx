import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { Employee } from '@/types';

interface Props {
  options: Employee[];
  value: string; // 선택된 employee_id ('' = 미선택)
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** "평가자 없음" 같은 빈 값 선택을 허용할지 */
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** 컨테이너 최소 너비 */
  minWidth?: number;
}

// 평가자 검색 콤보박스 — 대상이 많아 드롭다운으로 찾기 어려운 문제 해결.
// 이름 / 부서 / 사번으로 필터링한다.
const EvaluatorPicker = ({
  options,
  value,
  onChange,
  placeholder = '평가자 검색…',
  disabled = false,
  allowEmpty = false,
  emptyLabel = '평가자 없음',
  minWidth = 200,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 키보드 화살표로 이동하는 활성 항목의 인덱스(allowEmpty 시 0=빈 값 옵션).
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  // 드롭다운을 포털(position:fixed)로 띄워 모달의 overflow 클리핑/스크롤바를 피하고,
  // 뷰포트 기준으로 위/아래 펼침 방향과 높이를 정한다.
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.employee_id === value) ?? null,
    [options, value],
  );
  const selectedLabel = selected
    ? `${selected.name} · ${selected.department}`
    : value
      ? value
      : allowEmpty
        ? emptyLabel
        : '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.department.toLowerCase().includes(q) ||
        o.employee_id.toLowerCase().includes(q),
    );
  }, [options, query]);

  const emptyOffset = allowEmpty ? 1 : 0;
  const navCount = filtered.length + emptyOffset;

  // 검색어가 바뀌거나 새로 열릴 때 키보드 활성 항목을 첫 항목으로 리셋.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // 키보드 활성 항목이 보이도록 스크롤.
  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inContainer && !inMenu) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // 컨테이너의 뷰포트 위치로 위/아래 펼침 방향과 최대 높이를 결정.
  // (아래 effect보다 먼저 선언해야 TDZ 에러가 나지 않는다.)
  const computePlacement = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const DESIRED = 260;
    const up = spaceBelow < DESIRED && spaceAbove > spaceBelow;
    const maxHeight = Math.max(140, Math.min(DESIRED, (up ? spaceAbove : spaceBelow) - 12));
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(up
        ? { bottom: Math.max(8, window.innerHeight - rect.top + 4) }
        : { top: rect.bottom + 4 }),
    });
  }, []);

  // 열린 동안 스크롤·리사이즈에 따라 펼침 방향 재계산.
  useEffect(() => {
    if (!open) return;
    computePlacement();
    const onReflow = () => computePlacement();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, computePlacement]);

  const openPicker = () => {
    if (disabled) return;
    computePlacement();
    setOpen(true);
    setQuery('');
    // 다음 틱에 input 포커스
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth }}>
      {open ? (
        <input
          ref={inputRef}
          className="sd-input sd-input-sm"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${baseId}-listbox`}
          aria-activedescendant={navCount > 0 ? `${baseId}-opt-${activeIndex}` : undefined}
          aria-autocomplete="list"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((i) => Math.min(navCount - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && navCount > 0) {
              e.preventDefault();
              if (allowEmpty && activeIndex === 0) pick('');
              else {
                const opt = filtered[activeIndex - emptyOffset];
                if (opt) pick(opt.employee_id);
              }
            }
          }}
          style={{ width: '100%' }}
        />
      ) : (
        <button
          type="button"
          className="sd-input sd-input-sm"
          disabled={disabled}
          onClick={openPicker}
          style={{
            width: '100%',
            textAlign: 'left',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: 'var(--bg-card)',
            color: selectedLabel ? 'var(--fg)' : 'var(--fg-subtle)',
            fontWeight: selected ? 700 : 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedLabel || placeholder}
          </span>
          <span style={{ color: 'var(--fg-subtle)', flexShrink: 0, display: 'inline-flex' }} aria-hidden>
            <ChevronDown size={14} />
          </span>
        </button>
      )}

      {open && menuStyle && createPortal(
        <div
          ref={menuRef}
          id={`${baseId}-listbox`}
          role="listbox"
          style={{
            ...menuStyle,
            zIndex: 1000,
            overflow: 'auto',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--sh-lg)',
          }}
        >
          {allowEmpty && (
            <button
              type="button"
              id={`${baseId}-opt-0`}
              data-idx={0}
              role="option"
              className="row-hover"
              aria-selected={value === ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick('');
              }}
              style={optionStyle(value === '', activeIndex === 0)}
            >
              <span style={{ color: 'var(--fg-muted)' }}>{emptyLabel}</span>
            </button>
          )}
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '10px 12px',
                fontSize: 'var(--fs-sm)',
                color: 'var(--fg-muted)',
              }}
            >
              검색 결과가 없습니다.
            </div>
          ) : (
            filtered.map((opt, i) => {
              const idx = i + emptyOffset;
              return (
                <button
                  key={opt.employee_id}
                  type="button"
                  id={`${baseId}-opt-${idx}`}
                  data-idx={idx}
                  role="option"
                  className="row-hover"
                  aria-selected={opt.employee_id === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(opt.employee_id);
                  }}
                  style={optionStyle(opt.employee_id === value, idx === activeIndex)}
                >
                  <span style={{ fontWeight: 700 }}>{opt.name}</span>
                  <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                    {opt.department} · {opt.employee_id}
                  </span>
                </button>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

const optionStyle = (selected: boolean, keyboardActive: boolean): React.CSSProperties => ({
  width: '100%',
  textAlign: 'left',
  padding: '8px 12px',
  border: 'none',
  // 비활성 항목은 background 미지정 — .row-hover 의 마우스 hover 배경이 살아있게 한다.
  background: selected ? 'var(--ok-orange-50)' : keyboardActive ? 'var(--bg-muted)' : undefined,
  // 키보드 화살표로 이동 중인 항목을 선택(주황 배경)과 구분되게 외곽선으로 강조.
  outline: keyboardActive ? '2px solid var(--ok-orange)' : 'none',
  outlineOffset: '-2px',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 'var(--fs-body)',
});

export default EvaluatorPicker;
