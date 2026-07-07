import { useEffect, useState, type CSSProperties } from 'react';
import { kpiService } from '@/lib/services';
import { ORG_KPI_ENABLED } from '@/lib/featureFlags';
import type { KpiNode, KpiOrgLevel } from '@/types/kpi';

const LEVEL_LABEL: Record<KpiOrgLevel, string> = {
  corporation: '법인',
  division: '본부',
  department: '부',
  team: '팀',
};

type FlatRow = { node: KpiNode; depth: number };

/**
 * 내 대시보드용 조직 KPI 현황 요약(읽기 전용) — 피평가자는 전용 메뉴 없이 여기서만 본다
 * (2026-07-07 사용자 결정). 서버가 이미 '체인 최상단 조직장 관할 + 내 소속 경로'로
 * 스코프를 잘라 내려주므로 그대로 그리기만 한다. 플래그 OFF·KPI 없음·로드 실패면
 * 카드 자체를 렌더하지 않는다(대시보드 보조 위젯 — 에러로 소란 떨지 않음).
 */
export const OrgKpiSummaryCard = ({ periodId, style }: { periodId: string | null; style?: CSSProperties }) => {
  const [rows, setRows] = useState<FlatRow[] | null>(null);

  useEffect(() => {
    if (!ORG_KPI_ENABLED || !periodId) {
      setRows(null);
      return;
    }
    let cancelled = false;
    kpiService
      .tree(periodId)
      .then((tree) => {
        if (cancelled) return;
        const flat: FlatRow[] = [];
        const walk = (n: KpiNode, d: number) => {
          flat.push({ node: n, depth: d });
          (n.children ?? []).forEach((c) => walk(c, d + 1));
        };
        (tree ?? []).forEach((n) => walk(n, 0));
        setRows(flat);
      })
      .catch(() => {
        if (!cancelled) setRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, [periodId]);

  if (!ORG_KPI_ENABLED || !rows || rows.length === 0) return null;

  return (
    <div className="sd-card" style={{ padding: '14px 18px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>조직 KPI</h3>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', fontWeight: 600 }}>
          소속 조직 목표 달성 현황 · 읽기 전용
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 168, overflowY: 'auto', paddingRight: 4 }}>
        {rows.map(({ node, depth }) => {
          const pct = Math.round(Math.min(1, Math.max(0, node.progress ?? 0)) * 100);
          return (
            <div
              key={node.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                paddingLeft: depth * 18,
                minWidth: 0,
                fontSize: 'var(--fs-sm)',
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 'var(--fs-2xs)',
                  fontWeight: 800,
                  color: 'var(--ok-orange-700)',
                  background: 'var(--ok-orange-50)',
                  border: '1px solid var(--ok-orange-100)',
                  borderRadius: 5,
                  padding: '0 5px',
                }}
              >
                {LEVEL_LABEL[node.org_level]} {node.org_key}
              </span>
              <span
                style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}
                title={node.name}
              >
                {node.name}
              </span>
              <span className="tnum" style={{ flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                {node.rolled_achieved ?? 0}/{node.target_value} {node.unit}
              </span>
              <div
                style={{
                  flexShrink: 0,
                  width: 96,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--bg-muted)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: pct >= 100 ? 'var(--ok-orange)' : 'var(--warning)',
                    borderRadius: 3,
                  }}
                />
              </div>
              <span className="tnum" style={{ flexShrink: 0, width: 38, textAlign: 'right', fontWeight: 800 }}>
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
