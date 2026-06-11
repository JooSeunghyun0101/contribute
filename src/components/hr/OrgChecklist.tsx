import { useMemo, useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { orgNodes, type OrgFields } from '@/lib/orgHierarchy';

interface OrgChecklistProps {
  /** 노드를 뽑을 대상(직원 등). org_* 필드를 가진 객체. */
  items: OrgFields[];
  /** 선택된 노드 key 목록. */
  value: string[];
  onChange: (next: string[]) => void;
  /** 트리거 라벨(기본 "조직"). */
  label?: string;
}

/**
 * 평탄한 조직 체크리스트 필터.
 * 법인/본부/부/팀을 한 목록에 펼쳐(들여쓰기로 깊이 표시) 레벨을 섞어 여러 부서를
 * 동시에 선택할 수 있다. cascading 칩 필터로는 불가능한
 * "OK›인사팀 + OKH›인사팀 + OKH›AX›인사부 동시 조회" 케이스를 지원한다.
 * 상위 노드를 선택하면 그 하위(부·팀) 인원이 모두 포함된다(접두 매칭).
 */
const OrgChecklist = ({ items, value, onChange, label = '조직' }: OrgChecklistProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const nodes = useMemo(() => orgNodes(items), [items]);
  const selected = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((n) => n.label.toLowerCase().includes(q));
  }, [nodes, query]);

  if (nodes.length === 0) return null;

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };

  const selectedNodes = nodes.filter((n) => selected.has(n.key));

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--fg)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {label}
            {selected.size > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 9,
                  background: 'var(--ok-orange-50)',
                  color: 'var(--ok-brown)',
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                {selected.size}
              </span>
            )}
            <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>▾</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" style={{ width: 320, padding: 8 }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="부서명 검색…"
            style={{ height: 34, marginBottom: 8 }}
          />
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 8px', color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                일치하는 조직이 없습니다.
              </div>
            ) : (
              filtered.map((node) => {
                const isOn = selected.has(node.key);
                return (
                  <label
                    key={node.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 6px',
                      paddingLeft: 6 + (node.depth - 1) * 16,
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: isOn ? 'var(--ok-orange-50)' : 'transparent',
                    }}
                  >
                    <Checkbox checked={isOn} onCheckedChange={() => toggle(node.key)} />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 'var(--fs-sm)',
                          fontWeight: isOn ? 700 : 600,
                          color: 'var(--fg)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {node.leaf}
                      </span>
                      {node.depth > 1 && (
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--fg-muted)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {node.label}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              style={{
                marginTop: 8,
                width: '100%',
                height: 32,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--fg-muted)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              전체 해제 ({selected.size})
            </button>
          )}
        </PopoverContent>
      </Popover>

      {selectedNodes.map((node) => (
        <button
          key={node.key}
          type="button"
          onClick={() => toggle(node.key)}
          title={`${node.label} 선택 해제`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 32,
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid var(--ok-orange-100)',
            background: 'var(--ok-orange-50)',
            color: 'var(--ok-brown)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 700,
            cursor: 'pointer',
            maxWidth: 220,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.leaf}
          </span>
          <span aria-hidden>✕</span>
        </button>
      ))}
    </div>
  );
};

export default OrgChecklist;
