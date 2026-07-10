import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import EvaluationReadonlyView from '@/components/Evaluation/EvaluationReadonlyView';

// 평가 라인 하위 열람(#1) — 본인 평가 라인의 재귀 하위 인원 평가를 읽기 전용으로 본다.
// 진입은 평가 보드의 '평가 라인 하위(열람)' 요약에서 ?evaluatee=<사번> 으로.
const DeptMemberViewerPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const evaluateeId = searchParams.get('evaluatee');

  return (
    <>
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => navigate('/team')}
              className="sd-btn sd-btn-outline sd-btn-sm"
              title="평가 보드로 돌아가기"
              aria-label="평가 보드로"
              style={{ flexShrink: 0 }}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              보드로
            </button>
            <span>평가 라인 하위 열람</span>
          </span>
        }
        subtitle="내 평가 라인 하위 인원의 평가를 읽기 전용으로 봅니다. (수정 불가)"
      />

      <div style={{ padding: '20px 32px 32px' }}>
        {evaluateeId ? (
          <EvaluationReadonlyView key={evaluateeId} evaluateeId={evaluateeId} />
        ) : (
          <div className="sd-card" style={{ color: 'var(--fg-muted)' }}>
            열람할 인원이 지정되지 않았습니다. 평가 보드의 '평가 라인 하위' 목록에서 선택해 주세요.
          </div>
        )}
      </div>
    </>
  );
};

export default DeptMemberViewerPage;
