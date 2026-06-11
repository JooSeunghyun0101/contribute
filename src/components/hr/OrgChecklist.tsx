import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ORG_LEVEL_LABELS,
  ORG_SCOPE_PREFIX,
  orgNodeKey,
  orgNodeValues,
  orgNodes,
  orgOptionsForLevel,
  type OrgFields,
} from '@/lib/orgHierarchy';

const ALL = '__all__';

interface OrgChecklistProps {
  /** 후보를 뽑을 대상(직원 등). org_* 필드를 가진 객체. */
  items: OrgFields[];
  /** 선택 상태(범위 scope: 접두 + 부서 칩 노드키)를 한 배열로 보관. */
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * 조직 필터 — 두 종류를 함께 제공(사용자 결정):
 *  1) 범위 드롭다운: 법인 → 본부 cascading 단일 선택. 고르면 그 아래 전원으로 좁힌다.
 *  2) 부서 필터: '부서 추가' 팝오버(검색)에서 특정 부서를 골라 칩으로 누적(레벨 섞임, OR).
 * 두 조건은 AND. 선택 상태는 value:string[] 하나에 인코딩(범위는 ORG_SCOPE_PREFIX 접두)하여
 * 매칭(matchesOrgNodes)·화면 연동을 단일 인터페이스로 유지한다.
 */
const OrgChecklist = ({ items, value, onChange }: OrgChecklistProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // value 분해
  const scopeKey = value.find((k) => k.startsWith(ORG_SCOPE_PREFIX))?.slice(ORG_SCOPE_PREFIX.length) ?? '';
  const scopeVals = scopeKey ? orgNodeValues(scopeKey) : [];
  const scopeCorp = scopeVals[0] ?? '';
  const scopeDiv = scopeVals[1] ?? '';
  const unitKeys = useMemo(() => value.filter((k) => !k.startsWith(ORG_SCOPE_PREFIX)), [value]);
  const unitSet = useMemo(() => new Set(unitKeys), [unitKeys]);

  const corpOptions = useMemo(() => orgOptionsForLevel(items, 'corporation', {}), [items]);
  const divOptions = useMemo(
    () => (scopeCorp ? orgOptionsForLevel(items, 'division', { corporation: scopeCorp }) : []),
    [items, scopeCorp],
  );

  const allNodes = useMemo(() => orgNodes(items), [items]);
  const addable = useMemo(() => allNodes.filter((n) => !unitSet.has(n.key)), [allNodes, unitSet]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? addable.filter((n) => n.label.toLowerCase().includes(q)) : addable;
  }, [addable, query]);
  const selectedUnitNodes = useMemo(() => allNodes.filter((n) => unitSet.has(n.key)), [allNodes, unitSet]);

  // org 데이터가 전혀 없으면 숨김(빈 컨트롤 방지).
  if (corpOptions.length === 0 && allNodes.length === 0) return null;

  const setScope = (vals: string[]) => {
    const rest = value.filter((k) => !k.startsWith(ORG_SCOPE_PREFIX));
    onChange(vals.length > 0 ? [ORG_SCOPE_PREFIX + orgNodeKey(vals), ...rest] : rest);
  };
  const onCorp = (v: string) => setScope(v === ALL ? [] : [v]); // 법인 변경 시 본부 리셋
  const onDiv = (v: string) =>
    setScope(v === ALL ? (scopeCorp ? [scopeCorp] : []) : [scopeCorp, v]);

  const addUnit = (key: string) => {
    if (!unitSet.has(key)) onChange([...value, key]);
  };
  const removeUnit = (key: string) => onChange(value.filter((k) => k !== key));
  const clearAll = () => onChange([]);

  const hasAny = value.length > 0;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* 범위: 법인 → 본부 cascading 단일 드롭다운 */}
      {corpOptions.length > 0 && (
        <Select value={scopeCorp || ALL} onValueChange={onCorp}>
          <SelectTrigger style={{ width: 150, height: 36 }}>
            <SelectValue placeholder={ORG_LEVEL_LABELS.corporation} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{ORG_LEVEL_LABELS.corporation} 전체</SelectItem>
            {corpOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {scopeCorp && divOptions.length > 0 && (
        <Select value={scopeDiv || ALL} onValueChange={onDiv}>
          <SelectTrigger style={{ width: 160, height: 36 }}>
            <SelectValue placeholder={ORG_LEVEL_LABELS.division} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{ORG_LEVEL_LABELS.division} 전체</SelectItem>
            {divOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* 부서 필터: 추가 팝오버 + 칩 */}
      {allNodes.length > 0 && (
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
              + 부서 필터
              {unitKeys.length > 0 && (
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
                  {unitKeys.length}
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
                  추가할 부서가 없습니다.
                </div>
              ) : (
                filtered.map((node) => (
                  <button
                    key={node.key}
                    type="button"
                    onClick={() => addUnit(node.key)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 1,
                      padding: '6px 8px',
                      paddingLeft: 8 + (node.depth - 1) * 14,
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--fg)' }}>
                      {node.leaf}
                    </span>
                    {node.depth > 1 && (
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{node.label}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {selectedUnitNodes.map((node) => (
        <button
          key={node.key}
          type="button"
          onClick={() => removeUnit(node.key)}
          title={`${node.label} 필터 해제`}
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

      {hasAny && (
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
          초기화
        </button>
      )}
    </div>
  );
};

export default OrgChecklist;
