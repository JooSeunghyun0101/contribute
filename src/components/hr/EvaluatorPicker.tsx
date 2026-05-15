import { useEffect, useMemo, useRef, useState } from 'react';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
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
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            } else if (e.key === 'Enter' && filtered.length > 0) {
              e.preventDefault();
              pick(filtered[0].employee_id);
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
          <span style={{ color: 'var(--fg-subtle)', flexShrink: 0 }}>▾</span>
        </button>
      )}

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 60,
            maxHeight: 260,
            overflow: 'auto',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        >
          {allowEmpty && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick('');
              }}
              style={optionStyle(value === '')}
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
            filtered.map((opt) => (
              <button
                key={opt.employee_id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(opt.employee_id);
                }}
                style={optionStyle(opt.employee_id === value)}
              >
                <span style={{ fontWeight: 700 }}>{opt.name}</span>
                <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                  {opt.department} · {opt.employee_id}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const optionStyle = (active: boolean): React.CSSProperties => ({
  width: '100%',
  textAlign: 'left',
  padding: '8px 12px',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  background: active ? 'var(--ok-orange-50)' : 'transparent',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 'var(--fs-body)',
});

export default EvaluatorPicker;
