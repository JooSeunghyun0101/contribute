import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { orgNodeKey, orgNodeValues, orgNodes, type OrgFields, type OrgNode } from '@/lib/orgHierarchy';

interface OrgChecklistProps {
  /** 후보를 뽑을 대상(직원 등). org_* 필드를 가진 객체. */
  items: OrgFields[];
  /** 선택된 조직 노드키(캐스케이드로 펼쳐진 집합). matchesOrgNodes 와 동일 인터페이스. */
  value: string[];
  onChange: (next: string[]) => void;
}

const parentKeyOf = (key: string): string | null => {
  const vals = orgNodeValues(key);
  return vals.length > 1 ? orgNodeKey(vals.slice(0, -1)) : null;
};

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
 * 조직 필터(법인 → 본부 → 부 → 팀 단일 캐스케이드 트리).
 *  - 압축경로 기반이라 계층 구멍(본부 누락 등)이 있어도 모든 부/팀이 나온다.
 *  - 상위 체크 = 하위 전부 자동 체크(캐스케이드). 하위만 해제하면 그 인원만 빠진다.
 *  - 항목별 펼침/접기(▸/▾), 전체선택/해제, 부서명 다중어(띄어쓰기) 검색.
 *  - '선택 N' 패널에서 선택항목 모두/하나씩 해제.
 * 선택은 value:string[](펼쳐진 노드키)로 보관 → 10개 화면 무수정.
 */
const OrgChecklist = ({ items, value, onChange }: OrgChecklistProps) => {
  const [open, setOpen] = useState(false);
  const [selOpen, setSelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const nodes = useMemo(() => orgNodes(items), [items]);
  const selected = useMemo(() => new Set(value), [value]);
  const roots = useMemo(() => nodes.filter((n) => n.depth === 1), [nodes]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, OrgNode[]>();
    for (const n of nodes) {
      const pk = parentKeyOf(n.key);
      if (!pk) continue;
      const arr = map.get(pk);
      if (arr) arr.push(n);
      else map.set(pk, [n]);
    }
    return map;
  }, [nodes]);

  // 각 노드의 '자신+하위' 노드키 전체(캐스케이드용).
  const subtreeOf = useMemo(() => {
    const m = new Map<string, string[]>();
    const build = (key: string): string[] => {
      const cached = m.get(key);
      if (cached) return cached;
      const arr = [key];
      for (const k of childrenOf.get(key) ?? []) arr.push(...build(k.key));
      m.set(key, arr);
      return arr;
    };
    for (const n of nodes) build(n.key);
    return m;
  }, [nodes, childrenOf]);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const matches = useMemo(() => {
    if (terms.length === 0) return [];
    return nodes.filter((n) => {
      const l = n.label.toLowerCase();
      return terms.every((t) => l.includes(t));
    });
  }, [nodes, terms]);

  // 선택목록(상위만): value 노드 중 부모가 선택 안 된 최상위들. (트리거 카운트용)
  const topMost = useMemo(
    () =>
      nodes.filter((n) => {
        if (!selected.has(n.key)) return false;
        const pk = parentKeyOf(n.key);
        return !pk || !selected.has(pk);
      }),
    [nodes, selected],
  );

  // 선택필터 트리에 표시할 노드: 선택된 노드 + 그 조상(구조용). 조상이 선택 안 됐어도
  // 트리 모양을 위해 포함(부분 해제로 부모만 빠진 경우 등).
  const displaySet = useMemo(() => {
    const s = new Set<string>();
    for (const key of selected) {
      s.add(key);
      let pk = parentKeyOf(key);
      while (pk) {
        s.add(pk);
        pk = parentKeyOf(pk);
      }
    }
    return s;
  }, [selected]);

  if (nodes.length === 0) return null;

  // 노드 체크/해제 — 캐스케이드(하위 전체) + 상위 정합.
  const applyCheck = (nodeKey: string, check: boolean) => {
    const set = new Set(value);
    const sub = subtreeOf.get(nodeKey) ?? [nodeKey];
    const vals = orgNodeValues(nodeKey);
    if (check) {
      for (const k of sub) set.add(k);
      // 상위: 모든 자식이 선택되면 상위도 체크(아니면 중단).
      for (let i = vals.length - 1; i >= 1; i--) {
        const anc = orgNodeKey(vals.slice(0, i));
        const kids = childrenOf.get(anc) ?? [];
        if (kids.length > 0 && kids.every((k) => set.has(k.key))) set.add(anc);
        else break;
      }
    } else {
      for (const k of sub) set.delete(k);
      // 상위는 더 이상 '전부 선택'이 아니므로 해제.
      for (let i = 1; i < vals.length; i++) set.delete(orgNodeKey(vals.slice(0, i)));
    }
    onChange([...set]);
  };

  const toggleNode = (node: OrgNode) => {
    const willCheck = !selected.has(node.key);
    applyCheck(node.key, willCheck);
    // 체크 시 자신+조상을 펼쳐, 검색에서 고른 것도 검색어를 지운 전체 트리에서 바로 보이게.
    if (willCheck)
      setExpanded((prev) => {
        const next = new Set(prev).add(node.key);
        let pk = parentKeyOf(node.key);
        while (pk) {
          next.add(pk);
          pk = parentKeyOf(pk);
        }
        return next;
      });
  };
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectAll = () => {
    if (terms.length > 0) {
      const set = new Set(value);
      for (const n of matches) for (const k of subtreeOf.get(n.key) ?? [n.key]) set.add(k);
      onChange([...set]);
    } else {
      onChange(nodes.map((n) => n.key));
    }
  };
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
          <Checkbox checked={on} onCheckedChange={() => toggleNode(node)} />
          <button
            type="button"
            onClick={() => (kids.length > 0 ? toggleExpand(node.key) : toggleNode(node))}
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

  // 선택필터 트리 — displaySet 안의 노드만, 항상 펼친 채. 선택 노드는 체크박스(해제 가능),
  // 구조용 조상은 흐리게 라벨만.
  const renderSelectedNode = (node: OrgNode): ReactNode => {
    const kids = (childrenOf.get(node.key) ?? []).filter((k) => displaySet.has(k.key));
    const isSel = selected.has(node.key);
    return (
      <div key={node.key}>
        <div style={rowStyle(false, node.depth)}>
          {isSel ? (
            <Checkbox checked onCheckedChange={() => applyCheck(node.key, false)} />
          ) : (
            <span style={{ width: 16, flexShrink: 0 }} />
          )}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 'var(--fs-sm)',
              fontWeight: isSel ? 700 : 600,
              color: isSel ? 'var(--fg)' : 'var(--fg-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.leaf}
          </span>
        </div>
        {kids.map(renderSelectedNode)}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* 조직 필터 트리 */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" style={triggerStyle}>
            조직 필터
            {selected.size > 0 && <span style={badgeStyle}>{selected.size}</span>}
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
            <button type="button" onClick={selectAll} style={smallPrimaryBtn}>
              {terms.length > 0 ? '검색결과 전체선택' : '전체 선택'}
            </button>
            <button type="button" onClick={clearAll} disabled={selected.size === 0} style={smallBtn(selected.size === 0)}>
              전체 해제
            </button>
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {terms.length > 0 ? (
              matches.length === 0 ? (
                <div style={emptyStyle}>일치하는 조직이 없습니다.</div>
              ) : (
                matches.map((node) => {
                  const on = selected.has(node.key);
                  return (
                    <label key={node.key} style={rowStyle(on, 1)}>
                      <Checkbox checked={on} onCheckedChange={() => toggleNode(node)} />
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 600, color: 'var(--fg)' }}>
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

      {/* 선택 목록(모두/하나씩 해제) */}
      {selected.size > 0 && (
        <Popover open={selOpen} onOpenChange={setSelOpen}>
          <PopoverTrigger asChild>
            <button type="button" style={triggerStyle}>
              선택 {topMost.length}
              <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>▾</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" style={{ width: 320, padding: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>선택한 조직</span>
              <button
                type="button"
                onClick={clearAll}
                style={{
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 7,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--fg-muted)',
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                모두 해제
              </button>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {roots.filter((r) => displaySet.has(r.key)).map(renderSelectedNode)}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

const triggerStyle: CSSProperties = {
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
};

const badgeStyle: CSSProperties = {
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
};

const emptyStyle: CSSProperties = {
  padding: '12px 8px',
  color: 'var(--fg-muted)',
  fontSize: 'var(--fs-sm)',
};

const smallPrimaryBtn: CSSProperties = {
  flex: 1,
  height: 30,
  borderRadius: 7,
  border: '1px solid var(--ok-orange-100)',
  background: 'var(--ok-orange-50)',
  color: 'var(--ok-brown)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  cursor: 'pointer',
};

const smallBtn = (disabled: boolean): CSSProperties => ({
  flex: 1,
  height: 30,
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--fg-muted)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

export default OrgChecklist;
