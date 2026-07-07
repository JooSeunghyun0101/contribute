import { Fragment, useEffect, useState, type CSSProperties } from 'react';
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

// 하위 KPI 는 ↳ 접두 + 왼쪽 오렌지 마커로 상위와의 연결을 표시(세로 중첩은 카드가 길어져 금지).
const KpiTile = ({ node, depth }: { node: KpiNode; depth: number }) => {
  const pct = Math.round(Math.min(1, Math.max(0, node.progress ?? 0)) * 100);
  const path = fullOrgPath(node);
  return (
    <div
      style={{
        flexShrink: 0,
        width: 300,
        border: '1px solid var(--border)',
        borderLeft: depth > 0 ? '3px solid var(--ok-orange-100)' : '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-subtle)',
        padding: '9px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
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
        title={depth > 0 ? `상위 KPI 의 하위 — ${path}` : path}
      >
        {depth > 0 && <span style={{ marginRight: 4 }}>{'↳'.repeat(depth)}</span>}
        {path}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span
          style={{
            fontWeight: 800,
            fontSize: 'var(--fs-sm)',
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
        <span className="tnum" style={{ flexShrink: 0, fontWeight: 900, fontSize: 'var(--fs-body)' }}>
          {pct}%
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-muted)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: pct >= 100 ? 'var(--ok-orange)' : 'var(--warning)',
            borderRadius: 3,
          }}
        />
      </div>
      <div className="tnum" style={{ fontSize: 'var(--fs-2xs)', color: 'var(--fg-muted)' }}>
        실적 {node.rolled_achieved ?? 0} / 목표 {node.target_value} {node.unit}
      </div>
    </div>
  );
};

type FlatRow = { node: KpiNode; depth: number };

/**
 * 내 대시보드용 조직 KPI 현황 요약(읽기 전용) — 피평가자는 전용 메뉴 없이 여기서만 본다
 * (2026-07-07 사용자 결정). 서버가 이미 '체인 최상단 조직장 관할 + 내 소속 경로'로
 * 스코프를 잘라 내려주므로 그대로 그리기만 한다. 플래그 OFF·KPI 없음·로드 실패면
 * 카드 자체를 렌더하지 않는다(대시보드 보조 위젯 — 에러로 소란 떨지 않음).
 * 전체를 가로 한 줄로(카드 높이 고정) — 상위→하위 순서(DFS)로 잇고 하위는 ↳ 표시,
 * 최상위가 바뀌는 지점엔 세로 구분선. 넘치면 가로 스크롤.
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
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, alignItems: 'stretch' }}>
        {rows.map(({ node, depth }, i) => (
          <Fragment key={node.id}>
            {depth === 0 && i > 0 && (
              <div style={{ flexShrink: 0, width: 1, background: 'var(--border)', margin: '2px 5px' }} />
            )}
            <KpiTile node={node} depth={depth} />
          </Fragment>
        ))}
      </div>
    </div>
  );
};
