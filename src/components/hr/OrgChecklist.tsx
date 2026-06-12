import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { orgNodeKey, orgNodeValues, orgNodes, type OrgFields, type OrgNode } from '@/lib/orgHierarchy';

interface OrgChecklistProps {
  /** 후보를 뽑을 대상(직원 등). org_* 필드를 가진 객체. */
  items: OrgFields[];
  /** 선택된 조직 노드키 목록. 노드 선택 = 그 단위 하위 전원(subtree). */
  value: string[];
  onChange: (next: string[]) => void;
}

const rowStyle = (on: boolean, depth: number): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 6px',
  paddingLeft: 6 + (depth - 1) * 20,
  borderRadius: 6,
  background: on ? 'var(--ok-orange-50)' : 'transparent',
});

/**
 * 조직 필터(법인 → 본부 → 부 → 팀 단일 트리).
 *  - 압축경로 기반이라 계층 구멍(본부 누락 등)이 있어도 모든 부/팀이 나온다.
 *  - 노드 체크 = 그 단위 하위 전원(subtree). 여러 단위 OR.
 *  - 항목별 펼침/접기(▸/▾), 전체선택/해제, 부서명 다중어(띄어쓰기) 검색.
 * 선택은 value:string[](노드키)로 보관 → matchesOrgNodes 와 단일 인터페이스(10개 화면 무수정).
 */
const OrgChecklist = ({ items, value, onChange }: OrgChecklistProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const nodes = useMemo(() => orgNodes(items), [items]);
  const selected = useMemo(() => new Set(value), [value]);

  const roots = useMemo(() => nodes.filter((n) => n.depth === 1), [nodes]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, OrgNode[]>();
    for (const n of nodes) {
      if (n.depth < 2) continue;
      const parentKey = orgNodeKey(orgNodeValues(n.key).slice(0, -1));
      const arr = map.get(parentKey);
      if (arr) arr.push(n);
      else map.set(parentKey, [n]);
    }
    return map;
  }, [nodes]);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const matches = useMemo(() => {
    if (terms.length === 0) return [];
    return nodes.filter((n) => {
      const l = n.label.toLowerCase();
      return terms.every((t) => l.includes(t));
    });
  }, [nodes, terms]);

  if (nodes.length === 0) return null;

  const toggle = (key: string) =>
    onChange(selected.has(key) ? value.filter((k) => k !== key) : [...value, key]);
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectAll = () =>
    onChange(terms.length > 0 ? [...new Set([...value, ...matches.map((n) => n.key)])] : roots.map((n) => n.key));
  const clearAll = () => onChange([]);

  const renderNode = (node: OrgNode): ReactNode => {
    const kids = childrenOf.get(node.key) ?? [];
    const isOpen = expanded.has(node.key);
    const on = selected.has(node.key);
    return (
      <div key={node.key}>
        <div style={rowStyle(on, node.depth)}>
          {kids.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.key)}
              aria-label={isOpen ? '접기' : '펼치기'}
              style={{
                width: 22,
                height: 22,
                flexShrink: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--fg)',
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span style={{ width: 22, flexShrink: 0 }} />
          )}
          <Checkbox checked={on} onCheckedChange={() => toggle(node.key)} />
          <button
            type="button"
            onClick={() => (kids.length > 0 ? toggleExpand(node.key) : toggle(node.key))}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              padding: 0,
              fontSize: 'var(--fs-sm)',
              fontWeight: on ? 700 : 600,
              color: 'var(--fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.leaf}
            {kids.length > 0 && (
              <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}> ({kids.length})</span>
            )}
          </button>
        </div>
        {isOpen && kids.map(renderNode)}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
            조직 필터
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
        <PopoverContent align="start" style={{ width: 360, padding: 8 }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색 (예: OK 인사 — 띄어쓰기로 여러 단어)"
            style={{ height: 34, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              onClick={selectAll}
              style={{
                flex: 1,
                height: 30,
                borderRadius: 7,
                border: '1px solid var(--ok-orange-100)',
                background: 'var(--ok-orange-50)',
                color: 'var(--ok-brown)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {terms.length > 0 ? '검색결과 전체선택' : '전체 선택'}
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selected.size === 0}
              style={{
                flex: 1,
                height: 30,
                borderRadius: 7,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--fg-muted)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 600,
                cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                opacity: selected.size === 0 ? 0.6 : 1,
              }}
            >
              전체 해제
            </button>
          </div>

          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {terms.length > 0 ? (
              matches.length === 0 ? (
                <div style={{ padding: '12px 8px', color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                  일치하는 조직이 없습니다.
                </div>
              ) : (
                matches.map((node) => {
                  const on = selected.has(node.key);
                  return (
                    <label key={node.key} style={rowStyle(on, 1)}>
                      <Checkbox checked={on} onCheckedChange={() => toggle(node.key)} />
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span
                          style={{ fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 600, color: 'var(--fg)' }}
                        >
                          {node.leaf}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{node.label}</span>
                      </span>
                    </label>
                  );
                })
              )
            ) : (
              roots.map(renderNode)
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selected.size > 0 && (
        <button
          type="button"
          onClick={clearAll}
          style={{
            height: 36,
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--fg-muted)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          초기화 ({selected.size})
        </button>
      )}
    </div>
  );
};

export default OrgChecklist;
