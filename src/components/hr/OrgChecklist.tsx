import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ORG_FILTER_CORP,
  ORG_FILTER_DIV,
  ORG_FILTER_UNIT,
  ORG_LEVEL_LABELS,
  orgNodeKey,
  orgNodeValues,
  orgNodes,
  orgOptionsForLevel,
  type OrgFields,
  type OrgNode,
} from '@/lib/orgHierarchy';

interface OrgChecklistProps {
  /** 후보를 뽑을 대상(직원 등). org_* 필드를 가진 객체. */
  items: OrgFields[];
  /** 선택 상태(corp:/div:/unit: 인코딩)를 한 배열로 보관. */
  value: string[];
  onChange: (next: string[]) => void;
}

// 트리거 버튼 + 팝오버 묶음(법인·본부·부서 공용).
const CheckDropdown = ({
  label,
  count,
  width = 150,
  children,
}: {
  label: string;
  count: number;
  width?: number;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
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
            minWidth: width,
            justifyContent: 'space-between',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {label}
            {count > 0 && (
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
                {count}
              </span>
            )}
          </span>
          <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" style={{ width: 300, padding: 8 }}>
        {children}
      </PopoverContent>
    </Popover>
  );
};

const checkRowStyle = (on: boolean, indent = 0): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 6px',
  paddingLeft: 6 + indent,
  borderRadius: 6,
  cursor: 'pointer',
  background: on ? 'var(--ok-orange-50)' : 'transparent',
});

/**
 * 조직 필터(사용자 결정):
 *  - 법인·본부: 다중체크 드롭다운. 각 레벨 내 OR, 두 레벨 AND로 범위를 좁힌다.
 *  - 부서: 체크박스 다중선택. 후보(부/팀)는 선택한 법인·본부 범위에 따라 바뀐다.
 * 선택 상태는 value:string[] 하나(corp:/div:/unit: 접두)에 인코딩 → matchesOrgNodes 와
 * 단일 인터페이스로 연동(10개 화면 무수정). 범위 변경 시 범위 밖 본부/부서 선택은 자동 정리.
 */
const OrgChecklist = ({ items, value, onChange }: OrgChecklistProps) => {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (deptKey: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(deptKey)) next.delete(deptKey);
      else next.add(deptKey);
      return next;
    });

  const corpVals = useMemo(
    () => value.filter((k) => k.startsWith(ORG_FILTER_CORP)).map((k) => k.slice(ORG_FILTER_CORP.length)),
    [value],
  );
  const divVals = useMemo(
    () => value.filter((k) => k.startsWith(ORG_FILTER_DIV)).map((k) => k.slice(ORG_FILTER_DIV.length)),
    [value],
  );
  const unitKeys = useMemo(
    () => value.filter((k) => k.startsWith(ORG_FILTER_UNIT)).map((k) => k.slice(ORG_FILTER_UNIT.length)),
    [value],
  );
  const corpSet = useMemo(() => new Set(corpVals), [corpVals]);
  const divSet = useMemo(() => new Set(divVals), [divVals]);
  const unitSet = useMemo(() => new Set(unitKeys), [unitKeys]);

  const corpOptions = useMemo(() => orgOptionsForLevel(items, 'corporation', {}), [items]);
  const divOptions = useMemo(
    () => orgOptionsForLevel(items, 'division', corpVals.length ? { corporation: corpVals } : {}),
    [items, corpVals],
  );

  // 부서(부/팀) 후보 — 선택한 법인·본부 범위 안으로 한정.
  const unitNodes = useMemo(() => {
    return orgNodes(items).filter((n) => {
      if (n.depth < 3) return false; // 부·팀만
      const nv = orgNodeValues(n.key);
      if (corpVals.length > 0 && !corpSet.has(nv[0])) return false;
      if (divVals.length > 0 && !divSet.has(nv[1])) return false;
      return true;
    });
  }, [items, corpVals, divVals, corpSet, divSet]);
  const filteredUnits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? unitNodes.filter((n) => n.label.toLowerCase().includes(q)) : unitNodes;
  }, [unitNodes, query]);

  // 부서 트리: 부(depth3) → 팀(depth4) 그룹. (검색 중엔 평면 목록 사용)
  const unitTree = useMemo(() => {
    const depts = unitNodes.filter((n) => n.depth === 3);
    const teamsByDept = new Map<string, OrgNode[]>();
    for (const n of unitNodes) {
      if (n.depth >= 4) {
        const deptKey = orgNodeKey(orgNodeValues(n.key).slice(0, 3));
        const arr = teamsByDept.get(deptKey);
        if (arr) arr.push(n);
        else teamsByDept.set(deptKey, [n]);
      }
    }
    return { depts, teamsByDept };
  }, [unitNodes]);

  if (corpOptions.length === 0 && unitNodes.length === 0) return null;

  // 범위가 바뀌면 더 이상 유효하지 않은 본부/부서 선택을 떨어낸다.
  const prune = (next: string[]): string[] => {
    const c = next.filter((k) => k.startsWith(ORG_FILTER_CORP)).map((k) => k.slice(ORG_FILTER_CORP.length));
    const cSet = new Set(c);
    const validDiv = new Set(orgOptionsForLevel(items, 'division', c.length ? { corporation: c } : {}));
    const keptDiv = next.filter((k) => k.startsWith(ORG_FILTER_DIV) && validDiv.has(k.slice(ORG_FILTER_DIV.length)));
    const dSet = new Set(keptDiv.map((k) => k.slice(ORG_FILTER_DIV.length)));
    const keptUnit = next.filter((k) => {
      if (!k.startsWith(ORG_FILTER_UNIT)) return false;
      const nv = orgNodeValues(k.slice(ORG_FILTER_UNIT.length));
      if (c.length > 0 && !cSet.has(nv[0])) return false;
      if (dSet.size > 0 && !dSet.has(nv[1])) return false;
      return true;
    });
    return [...next.filter((k) => k.startsWith(ORG_FILTER_CORP)), ...keptDiv, ...keptUnit];
  };

  const toggle = (key: string) => {
    const next = value.includes(key) ? value.filter((k) => k !== key) : [...value, key];
    onChange(prune(next));
  };
  const clearAll = () => onChange([]);
  const hasAny = value.length > 0;

  const unitRow = (node: OrgNode, indent: number) => {
    const key = ORG_FILTER_UNIT + node.key;
    const on = unitSet.has(node.key);
    return (
      <label key={node.key} style={checkRowStyle(on, indent)}>
        <Checkbox checked={on} onCheckedChange={() => toggle(key)} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 600, color: 'var(--fg)' }}>
            {node.leaf}
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{node.label}</span>
        </span>
      </label>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* 법인 다중체크 */}
      {corpOptions.length > 0 && (
        <CheckDropdown label={ORG_LEVEL_LABELS.corporation} count={corpVals.length}>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {corpOptions.map((opt) => {
              const key = ORG_FILTER_CORP + opt;
              const on = corpSet.has(opt);
              return (
                <label key={opt} style={checkRowStyle(on)}>
                  <Checkbox checked={on} onCheckedChange={() => toggle(key)} />
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 600 }}>{opt}</span>
                </label>
              );
            })}
          </div>
        </CheckDropdown>
      )}

      {/* 본부 다중체크 (법인 선택에 따라 후보 변동) */}
      {divOptions.length > 0 && (
        <CheckDropdown label={ORG_LEVEL_LABELS.division} count={divVals.length} width={160}>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {divOptions.map((opt) => {
              const key = ORG_FILTER_DIV + opt;
              const on = divSet.has(opt);
              return (
                <label key={opt} style={checkRowStyle(on)}>
                  <Checkbox checked={on} onCheckedChange={() => toggle(key)} />
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 600 }}>{opt}</span>
                </label>
              );
            })}
          </div>
        </CheckDropdown>
      )}

      {/* 부서 필터: 체크박스 다중선택 (범위 안 부/팀) */}
      {unitNodes.length > 0 && (
        <CheckDropdown label="부서 필터" count={unitKeys.length} width={130}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="부서명 검색…"
            style={{ height: 34, marginBottom: 8 }}
          />
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {query.trim() ? (
              filteredUnits.length === 0 ? (
                <div style={{ padding: '12px 8px', color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                  일치하는 부서가 없습니다.
                </div>
              ) : (
                filteredUnits.map((node) => unitRow(node, (node.depth - 3) * 14))
              )
            ) : unitTree.depts.length === 0 ? (
              <div style={{ padding: '12px 8px', color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                해당 범위에 부서가 없습니다.
              </div>
            ) : (
              unitTree.depts.map((dept) => {
                const teams = unitTree.teamsByDept.get(dept.key) ?? [];
                const isCollapsed = collapsed.has(dept.key);
                const dKey = ORG_FILTER_UNIT + dept.key;
                const dOn = unitSet.has(dept.key);
                return (
                  <div key={dept.key}>
                    <div style={{ ...checkRowStyle(dOn), gap: 4 }}>
                      {teams.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleCollapse(dept.key)}
                          aria-label={isCollapsed ? '펼치기' : '접기'}
                          style={{
                            width: 18,
                            height: 18,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--fg-muted)',
                            fontSize: 11,
                            flexShrink: 0,
                          }}
                        >
                          {isCollapsed ? '▸' : '▾'}
                        </button>
                      ) : (
                        <span style={{ width: 18, flexShrink: 0 }} />
                      )}
                      <Checkbox checked={dOn} onCheckedChange={() => toggle(dKey)} />
                      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: dOn ? 700 : 600, color: 'var(--fg)' }}>
                        {dept.leaf}
                        {teams.length > 0 && (
                          <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}> ({teams.length})</span>
                        )}
                      </span>
                    </div>
                    {!isCollapsed && teams.map((team) => unitRow(team, 24))}
                  </div>
                );
              })
            )}
          </div>
        </CheckDropdown>
      )}

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
