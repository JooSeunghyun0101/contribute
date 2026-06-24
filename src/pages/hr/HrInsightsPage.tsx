import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { Pill } from '@/components/brand';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useSharedOrgFilter } from '@/hooks/useSharedOrgFilter';
import { matchesOrgNodes, orgFieldsFromEvaluation } from '@/lib/orgHierarchy';
import OrgChecklist from '@/components/hr/OrgChecklist';
import InsightScatter from '@/components/hr/InsightScatter';
import type { ScatterPoint } from '@/lib/insightScatter';
import { AiReviewRollup } from '@/components/Feedback/AiReviewRollup';

// 평가 인사이트 — 조직/직종/평가자 편향·품질을 한 화면에서 축(토글)만 바꿔 보고,
// AI 검수 결과(롤업)도 같은 화면의 탭으로 묶는다. 각 축은 기존 분석 화면을 embedded 로 재사용.
type TabKey = 'org' | 'job' | 'evaluator' | 'ai';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'org', label: '조직별' },
  { key: 'job', label: '직종별' },
  { key: 'evaluator', label: '평가자별' },
  { key: 'ai', label: 'AI 검수' },
];

const isTabKey = (v: string | null): v is TabKey =>
  v === 'org' || v === 'job' || v === 'evaluator' || v === 'ai';

const HrInsightsPage = () => {
  const { selectedPeriod, selectedPeriodId } = useEvaluationPeriod();
  const { records } = useCompanyDashboardRecords();
  const [orgFilter, setOrgFilter] = useSharedOrgFilter(selectedPeriodId);
  const [levelFilter, setLevelFilter] = useState<'all' | 1 | 2 | 3 | 4>('all');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'org';
  const [picked, setPicked] = useState<ScatterPoint | null>(null);

  // 산점도에 적용할 필터 — 조직(아래 화면과 공유) + 성장레벨. 레벨평균 기준선은 전사 기준이라
  // 레벨 필터를 걸어도 비교 기준은 흔들리지 않는다.
  const scatterRecords = useMemo(
    () =>
      records.filter(
        (r) =>
          (orgFilter.length === 0 ||
            matchesOrgNodes(orgFieldsFromEvaluation(r.evaluation, r.employee), orgFilter)) &&
          (levelFilter === 'all' || (r.employee.growth_level ?? 0) === levelFilter),
      ),
    [records, orgFilter, levelFilter],
  );

  const periodLabel = useMemo(
    () => (selectedPeriod ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}` : '평가기간'),
    [selectedPeriod],
  );

  const setTab = (next: TabKey) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="평가 인사이트"
        subtitle="평가자·조직·직종별로 점수가 레벨평균보다 높은지/낮은지, 사람마다 차등을 뒀는지를 한눈에 봅니다. 점을 클릭하면 대상자와 후속 조치로 이어집니다. (판정이 아닌 검토 참고용)"
        actions={<Pill tone="neutral">{periodLabel}</Pill>}
        filters={
          <div
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: 3,
              borderRadius: 10,
              background: 'var(--bg-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-pressed={active}
                  style={{
                    padding: '6px 16px',
                    borderRadius: 7,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 800,
                    color: active ? '#fff' : 'var(--fg-muted)',
                    background: active ? 'var(--ok-orange)' : 'transparent',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        }
      />

      {tab !== 'ai' && (
        <div style={{ padding: '20px 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 산점도 필터 — 조직(아래 표와 공유) + 성장레벨 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)' }}>그래프 필터</span>
            <OrgChecklist
              items={records.map((r) => orgFieldsFromEvaluation(r.evaluation, r.employee))}
              value={orgFilter}
              onChange={setOrgFilter}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 1, 2, 3, 4] as const).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevelFilter(lv)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    border: '1px solid',
                    borderColor: levelFilter === lv ? 'var(--ok-orange)' : 'var(--border)',
                    background: levelFilter === lv ? 'var(--ok-orange)' : 'transparent',
                    color: levelFilter === lv ? '#fff' : 'var(--fg)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {lv === 'all' ? '전체 레벨' : `Lv.${lv}`}
                </button>
              ))}
            </div>
          </div>
          <InsightScatter records={scatterRecords} cohortRecords={records} axis={tab} onSelect={setPicked} periodLabel={periodLabel} />
        </div>
      )}
      {tab === 'ai' && (
        <div className="flex flex-col gap-5" style={{ padding: '24px 32px 32px' }}>
          <AiReviewRollup />
        </div>
      )}

      {picked && (
        <PointMembersDrawer
          point={picked}
          onClose={() => setPicked(null)}
          onOpenEvaluatee={(employeeId) => {
            setPicked(null);
            navigate(`/hr/evaluation-viewer?evaluatee=${encodeURIComponent(employeeId)}`);
          }}
        />
      )}
    </>
  );
};

// 산점도 점 클릭 시 그 그룹(평가자/직종/본부)의 대상자 목록 + 바로 열람 액션.
const PointMembersDrawer = ({
  point,
  onClose,
  onOpenEvaluatee,
}: {
  point: ScatterPoint;
  onClose: () => void;
  onOpenEvaluatee: (employeeId: string) => void;
}) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={`검토 대상자 ${point.label} 상세`}
    onClick={onClose}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      className="sd-card"
      style={{ width: 'min(440px, 100%)', height: '100%', borderRadius: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
    >
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="sd-label-mini">검토 대상자 · {point.label}</div>
          <div style={{ marginTop: 4, display: 'flex', gap: 10, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
            <span className="tnum">레벨평균 대비 {point.bias >= 0 ? '+' : ''}{point.bias.toFixed(2)}</span>
            <span className="tnum">변별력 {point.stdDev == null ? '–' : point.stdDev.toFixed(2)}</span>
            <span className="tnum">쏠림 {Math.round(point.modeShare * 100)}% ‘{point.modeLabel}’</span>
            <span className="tnum">{point.n}명</span>
          </div>
        </div>
        <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose} aria-label="닫기">
          <X size={16} />
        </button>
      </div>
      <div style={{ overflow: 'auto', padding: '8px 12px 16px' }}>
        {point.members.map((m) => (
          <div
            key={m.employeeId}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 8px', borderBottom: '1px solid var(--border)' }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{m.name}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                <span className="tnum">{m.employeeId}</span> · 점수 <span className="tnum">{m.score.toFixed(1)}</span> · 갭{' '}
                <span className="tnum">{m.gap >= 0 ? '+' : ''}{m.gap}</span>
              </div>
            </div>
            <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={() => onOpenEvaluatee(m.employeeId)}>
              평가 열람
            </button>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default HrInsightsPage;
