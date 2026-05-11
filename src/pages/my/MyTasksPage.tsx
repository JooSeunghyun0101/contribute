import { useEffect, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { employeeService, evaluationService } from '@/lib/services';
import EvaluationAccordionCard from './EvaluationAccordionCard';
import type { Evaluation, Employee } from '@/types';

const MyTasksPage = () => {
  const { user } = useAuth();
  const employeeId = user?.employeeId ?? '';

  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [emp, evals] = await Promise.all([
          employeeService.getEmployeeById(employeeId),
          evaluationService.getEvaluationsByEmployeeId(employeeId),
        ]);
        if (cancelled) return;
        setEmployee(emp ?? null);
        const sorted = [...evals].sort((a, b) => {
          // 현재 평가(employees.evaluator_id 매칭)를 앞으로
          const aIsCurrent = a.evaluator_id && a.evaluator_id === emp?.evaluator_id ? 1 : 0;
          const bIsCurrent = b.evaluator_id && b.evaluator_id === emp?.evaluator_id ? 1 : 0;
          if (aIsCurrent !== bIsCurrent) return bIsCurrent - aIsCurrent;
          // 그 외엔 assigned_at(있으면) 또는 created_at 내림차순
          const aT = new Date(a.evaluator_assigned_at ?? a.created_at).getTime();
          const bT = new Date(b.evaluator_assigned_at ?? b.created_at).getTime();
          return bT - aT;
        });
        setEvaluations(sorted);
      } catch (error) {
        console.warn('평가 목록 로드 실패:', error);
        if (!cancelled) setEvaluations([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadKey 변경시 다시 로드
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, reloadKey]);

  // current evaluator로 분류
  const employeeEvaluatorId = employee?.evaluator_id ?? null;

  return (
    <>
      <PageHeader
        title="내 과업"
        subtitle={`${user?.name ?? ''}님의 등록 과업과 평가 이력`}
      />

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px 24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {isLoading && (
          <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '20px 6px' }}>
            평가 목록을 불러오는 중입니다.
          </div>
        )}

        {!isLoading && evaluations.length === 0 && (
          <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
            아직 등록된 평가가 없습니다.
          </div>
        )}

        {!isLoading &&
          evaluations.map((ev, index) => {
            const isCurrent = Boolean(
              ev.evaluator_id && employeeEvaluatorId && ev.evaluator_id === employeeEvaluatorId,
            );
            return (
              <EvaluationAccordionCard
                key={ev.id}
                employeeId={employeeId}
                evaluationId={ev.id}
                isCurrent={isCurrent}
                defaultExpanded={index === 0}
              />
            );
          })}
      </div>
    </>
  );
};

export default MyTasksPage;
