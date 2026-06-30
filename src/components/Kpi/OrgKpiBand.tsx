import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Target } from 'lucide-react';
import { kpiService } from '@/lib/services';
import KpiProgressBar from '@/components/Kpi/KpiProgressBar';
import type { KpiNode } from '@/types/kpi';

const flatten = (nodes: KpiNode[], acc: KpiNode[] = []): KpiNode[] => {
  for (const n of nodes) {
    acc.push(n);
    if (n.children?.length) flatten(n.children, acc);
  }
  return acc;
};

// 평가자 보드 상단 — 본인 조직 KPI 진척을 한눈에(읽기 전용). 매칭되는 KPI 없으면 렌더하지 않음.
const OrgKpiBand = ({ periodId }: { periodId: string | null }) => {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<KpiNode[] | null>(null);
  const [mine, setMine] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    if (!periodId) return;
    try {
      const [tree, opts] = await Promise.all([kpiService.tree(periodId), kpiService.orgOptions(periodId)]);
      setNodes(tree);
      setMine(opts.mine);
    } catch {
      setNodes([]);
    }
  }, [periodId]);

  useEffect(() => {
    load();
  }, [load]);

  const matched = useMemo(() => {
    if (!nodes) return [];
    const mineSet = new Set(Object.values(mine).filter(Boolean) as string[]);
    if (mineSet.size === 0) return [];
    // 본인 조직(법인/본부/부/팀)에 해당하는 KPI만. 상위 레벨 우선 정렬.
    const order: Record<string, number> = { corporation: 0, division: 1, department: 2, team: 3 };
    return flatten(nodes)
      .filter((n) => mineSet.has(n.org_key))
      .sort((a, b) => order[a.org_level] - order[b.org_level]);
  }, [nodes, mine]);

  if (!periodId || matched.length === 0) return null;

  const shown = matched.slice(0, 6);

  return (
    <div style={{ border: '1px solid var(--ok-orange-100)', borderRadius: 10, background: 'var(--bg-card)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '12px 16px',
          background: 'var(--ok-orange-50)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={15} color="var(--ok-orange)" />
          <span style={{ fontWeight: 800, color: 'var(--ok-orange-700)' }}>조직 KPI 현황</span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>{matched.length}개</span>
        </span>
        <ChevronDown size={15} style={{ color: 'var(--fg-muted)', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 160ms' }} />
      </button>
      {open && (
        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {shown.map((n) => (
            <button
              key={n.id}
              onClick={() => navigate('/kpi')}
              style={{ textAlign: 'left', background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {n.name}
                <span style={{ marginLeft: 6, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 600 }}>{n.org_key}</span>
              </div>
              <KpiProgressBar achieved={n.rolled_achieved} target={n.target_value} unit={n.unit} compact />
            </button>
          ))}
          {matched.length > shown.length && (
            <button
              onClick={() => navigate('/kpi')}
              style={{ background: 'transparent', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 'var(--fs-sm)' }}
            >
              외 {matched.length - shown.length}개 전체 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default OrgKpiBand;
