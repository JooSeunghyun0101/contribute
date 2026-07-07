import { useEffect, useState, type CSSProperties } from 'react';
import { kpiService } from '@/lib/services';
import { ORG_KPI_ENABLED } from '@/lib/featureFlags';
import type { KpiNode, KpiOrgLevel } from '@/types/kpi';

const LEVEL_ORDER: KpiOrgLevel[] = ['corporation', 'division', 'department', 'team'];

// 법인 › 본부 › 부 › 팀 전체 경로(2026-07-07 사용자: 말단만 쓰지 말 것).
// 노드 레벨까지는 org_path_*, 자기 레벨은 org_key. 레거시(경로 NULL)는 있는 값만 잇는다.
const fullOrgPath = (n: KpiNode): string => {
  const parts: (string | null | undefined)[] = [];
  for (const lvl of LEVEL_ORDER) {
    if (lvl === n.org_level) {
      parts.push(n.org_key);
      break;
    }
    parts.push(
      lvl === 'corporation'
        ? n.org_path_corporation
        : lvl === 'division'
          ? n.org_path_division
          : n.org_path_department,
    );
  }
  return parts.filter(Boolean).join(' › ');
};

type FlatNode = KpiNode & { __depth: number };

/**
 * 내 대시보드용 조직 KPI 현황 요약(읽기 전용) — 피평가자는 전용 메뉴 없이 여기서만 본다
 * (2026-07-07 사용자 결정). 서버가 이미 '체인 최상단 조직장 관할 + 내 소속 경로'로
 * 스코프를 잘라 내려주므로 그대로 그리기만 한다. 플래그 OFF·KPI 없음·로드 실패면
 * 카드 자체를 렌더하지 않는다(대시보드 보조 위젯 — 에러로 소란 떨지 않음).
 * 긴 한 줄 행은 좌(이름)·우(바)가 시각적으로 끊겨서 타일 그리드로 표현한다.
 */
export const OrgKpiSummaryCard = ({ periodId, style }: { periodId: string | null; style?: CSSProperties }) => {
  const [nodes, setNodes] = useState<FlatNode[] | null>(null);

  useEffect(() => {
    if (!ORG_KPI_ENABLED || !periodId) {
      setNodes(null);
      return;
    }
    let cancelled = false;
    kpiService
      .tree(periodId)
      .then((tree) => {
        if (cancelled) return;
        const flat: FlatNode[] = [];
        const walk = (n: KpiNode, d: number) => {
          flat.push({ ...n, __depth: d });
          (n.children ?? []).forEach((c) => walk(c, d + 1));
        };
        (tree ?? []).forEach((n) => walk(n, 0));
        setNodes(flat);
      })
      .catch(() => {
        if (!cancelled) setNodes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [periodId]);

  if (!ORG_KPI_ENABLED || !nodes || nodes.length === 0) return null;

  return (
    <div className="sd-card" style={{ padding: '14px 18px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>조직 KPI</h3>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', fontWeight: 600 }}>
          소속 조직 목표 달성 현황 · 읽기 전용
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 10,
          maxHeight: 236,
          overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {nodes.map((node) => {
          const pct = Math.round(Math.min(1, Math.max(0, node.progress ?? 0)) * 100);
          const path = fullOrgPath(node);
          return (
            <div
              key={node.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                background: 'var(--bg-subtle)',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 'var(--fs-2xs)',
                  fontWeight: 700,
                  color: 'var(--ok-orange-700)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={path}
              >
                {path}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 'var(--fs-body)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    flex: 1,
                  }}
                  title={node.name}
                >
                  {node.name}
                </span>
                <span className="tnum" style={{ flexShrink: 0, fontWeight: 900, fontSize: 'var(--fs-h4)' }}>
                  {pct}%
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-muted)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: pct >= 100 ? 'var(--ok-orange)' : 'var(--warning)',
                    borderRadius: 3,
                  }}
                />
              </div>
              <div className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                실적 {node.rolled_achieved ?? 0} / 목표 {node.target_value} {node.unit}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
