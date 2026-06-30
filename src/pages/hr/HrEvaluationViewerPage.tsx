import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { Pill } from '@/components/brand';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import EvaluationReadonlyView from '@/components/Evaluation/EvaluationReadonlyView';

const HrEvaluationViewerPage = () => {
  const { records, isLoading } = useCompanyDashboardRecords();
  const { selectedPeriod } = useEvaluationPeriod();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('evaluatee'));
  // AI검수 등에서 특정 과업을 지정해 들어온 경우 — 그 과업을 자동 선택하고 '뒤로' 버튼을 보여준다.
  const initialTaskId = searchParams.get('task');

  const candidates = useMemo(() => records.filter((r) => r.evaluation != null), [records]);
  const options = useMemo(
    () => [...candidates].map((r) => r.employee).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [candidates],
  );

  const periodLabel = selectedPeriod
    ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}`
    : '평가기간';

  const select = (employeeId: string | null) => {
    setSelectedId(employeeId);
    const next = new URLSearchParams(searchParams);
    if (employeeId) next.set('evaluatee', employeeId);
    else next.delete('evaluatee');
    next.delete('task'); // 수동으로 다른 피평가자를 고르면 과업 지정(자동선택·뒤로가기)은 해제.
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (selectedId && candidates.length > 0 && !candidates.some((r) => r.employee.employee_id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, candidates]);

  return (
    <>
      <PageHeader
        title={
          initialTaskId ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="sd-btn sd-btn-outline sd-btn-sm"
                title="직전 화면(AI 검수)으로 돌아가기"
                aria-label="뒤로 가기"
                style={{ flexShrink: 0 }}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                뒤로
              </button>
              <span>피평가자 평가 열람</span>
            </span>
          ) : (
            '피평가자 평가 열람'
          )
        }
        subtitle="피평가자를 선택해 평가자 화면(읽기 전용)을 그대로 봅니다. 이동으로 평가자가 여럿이면 평가자별로 모두 표시되며, 각 평가자에게 따로 수정요청을 보낼 수 있습니다."
        actions={<Pill tone="neutral">{periodLabel}</Pill>}
        filters={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)' }}>대상 피평가자</span>
            <EvaluatorPicker
              options={options}
              value={selectedId ?? ''}
              onChange={(id) => select(id || null)}
              placeholder={isLoading ? '불러오는 중…' : '피평가자 검색 (이름·부서·사번)'}
              disabled={isLoading}
              minWidth={320}
            />
          </div>
        }
      />

      <div style={{ padding: '20px 32px 32px' }}>
        {selectedId ? (
          <EvaluationReadonlyView
            key={selectedId}
            evaluateeId={selectedId}
            initialTaskId={initialTaskId}
            enableEditRequest
          />
        ) : (
          <div className="sd-card" style={{ color: 'var(--fg-muted)' }}>
            상단에서 피평가자를 선택하면 평가 내역(읽기 전용)이 표시됩니다.
          </div>
        )}
      </div>
    </>
  );
};
export default HrEvaluationViewerPage;
