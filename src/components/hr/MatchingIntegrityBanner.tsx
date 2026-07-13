import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Pill } from '@/components/brand';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { getOrgValue } from '@/lib/orgHierarchy';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

// 사용자 관리 상단 매칭 무결성 경고 — 구 '매칭 정합성 점검'의 핵심 이상(anomaly)만 흡수.
// 발령(이동)으로 평가자가 여럿인 것은 정상이므로 중립 정보(transfer-trace 등)는 제외하고,
// 객관적 이상 3종만 본다: 미배정 · 자기평가 후보 · 평가 레코드 없음. 읽기 전용(카운트+명단).
type Anomaly = 'unassigned' | 'self-eval' | 'no-evaluation';

const META: Record<Anomaly, { label: string; desc: string }> = {
  unassigned: { label: '미배정', desc: '평가 대상자이나 평가자가 지정되지 않음' },
  'self-eval': { label: '자기평가 후보', desc: '본인 사번 = 평가자 사번 (입력 오류 가능)' },
  'no-evaluation': { label: '평가 레코드 없음', desc: '평가자는 있으나 이 기간 평가가 미생성' },
};
const ORDER: Anomaly[] = ['unassigned', 'self-eval', 'no-evaluation'];

const MatchingIntegrityBanner = () => {
  const { records } = useCompanyDashboardRecords();
  const { selectedPeriod } = useEvaluationPeriod();
  const [open, setOpen] = useState(false);

  const byAnomaly = useMemo(() => {
    const map: Record<Anomaly, EmployeeEvaluationRecord[]> = { unassigned: [], 'self-eval': [], 'no-evaluation': [] };
    for (const r of records) {
      if (!r.employee.available_roles?.includes('evaluatee')) continue;
      const evaluatorId = r.employee.evaluator_id;
      const hasEvaluator = evaluatorId != null && String(evaluatorId).trim() !== '';
      if (!hasEvaluator) map.unassigned.push(r);
      else if (r.employee.employee_id === evaluatorId) map['self-eval'].push(r);
      else if (r.evaluation == null) map['no-evaluation'].push(r);
    }
    return map;
  }, [records]);

  const total = ORDER.reduce((sum, k) => sum + byAnomaly[k].length, 0);
  if (total === 0) return null;

  const periodLabel = selectedPeriod ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}` : '선택 기간';

  return (
    <section
      className="sd-card"
      style={{ border: '1px solid var(--warning)', background: 'var(--warning-bg)', padding: 0, overflow: 'hidden' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="kbd-focus"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            color: 'var(--fg-subtle)',
            display: 'inline-flex',
          }}
        >
          <ChevronRight size={15} />
        </span>
        <span style={{ fontWeight: 800 }}>매칭 점검 필요</span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>{periodLabel}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ORDER.filter((k) => byAnomaly[k].length > 0).map((k) => (
            <Pill key={k} tone="warning">
              {META[k].label} {byAnomaly[k].length}
            </Pill>
          ))}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
            발령(이동)으로 평가자가 여럿인 것은 정상입니다. 아래는 객관적 이상 후보만 모은 읽기 전용 점검입니다.
            아래 사용자 목록에서 평가자를 지정·변경할 수 있습니다.
          </p>
          {ORDER.filter((k) => byAnomaly[k].length > 0).map((k) => (
            <div key={k}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Pill tone="warning">{META[k].label}</Pill>
                <span className="tnum" style={{ fontWeight: 800 }}>{byAnomaly[k].length}명</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>· {META[k].desc}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {byAnomaly[k].slice(0, 40).map((r) => (
                  <span
                    key={r.employee.id}
                    title={[getOrgValue(r.employee, 'division'), getOrgValue(r.employee, 'department'), getOrgValue(r.employee, 'team')].filter(Boolean).join(' › ')}
                    style={{ fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  >
                    {r.employee.name} <span style={{ color: 'var(--fg-subtle)', fontFamily: 'monospace' }}>{r.employee.employee_id}</span>
                  </span>
                ))}
                {byAnomaly[k].length > 40 && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>외 {byAnomaly[k].length - 40}명</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default MatchingIntegrityBanner;
