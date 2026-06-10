import { useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { employeeService, evaluationService } from '@/lib/services';
import { formatEvaluatorPeriod } from '@/lib/evaluatorHistory';
import { buildEvaluatorPeriods } from '@/lib/evaluatorHistory';
import EvaluationAccordionCard from './EvaluationAccordionCard';
import type { Evaluation, Employee, EvaluatorAssignmentHistory } from '@/types';

const MyTasksPage = () => {
  const { user } = useAuth();
  const employeeId = user?.employeeId ?? '';

  const { selectedPeriod } = useEvaluationPeriod();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [history, setHistory] = useState<EvaluatorAssignmentHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [emp, evals, history] = await Promise.all([
          employeeService.getEmployeeById(employeeId),
          // 선택한 평가기간을 서버에 전달 — 미전달 시 서버가 활성기간(2026)만 반환해
          // 이전 연도(2025) 선택 시 빈 목록이 되는 문제를 막는다.
          evaluationService.getEvaluationsByEmployeeId(
            employeeId,
            selectedPeriod?.id ? { periodId: selectedPeriod.id } : undefined,
          ),
          employeeService.getEvaluatorAssignmentHistory(employeeId).catch((error) => {
            console.warn('평가자 이력 로드 실패:', error);
            return [];
          }),
        ]);
        if (cancelled) return;
        setEmployee(emp ?? null);
        setHistory(history);
        setEvaluations(evals);
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
    // reloadKey 또는 선택 평가기간 변경 시 다시 로드(기간 전환 시 해당 기간 평가를 새로 가져옴)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, reloadKey, selectedPeriod?.id]);

  // current evaluator로 분류
  const employeeEvaluatorId = employee?.evaluator_id ?? null;

  // 근무기간은 선택한 평가기간(evaluation_period_id) 단위로 계산 — 연도를 넘어 한 구간으로 합쳐지지 않게.
  const scopedPeriods = useMemo(
    () => buildEvaluatorPeriods(history, { periodId: selectedPeriod?.id ?? null }),
    [history, selectedPeriod?.id],
  );
  // 선택한 평가기간의 평가만 노출하고, 배정 시점 내림차순(최신=현재 평가가 위, 이전 평가가 아래로 쌓임).
  const visibleEvaluations = useMemo(() => {
    const inPeriod = selectedPeriod?.id
      ? evaluations.filter((ev) =>
          ev.evaluation_period_id
            ? ev.evaluation_period_id === selectedPeriod.id
            : ev.evaluation_year === selectedPeriod.evaluation_year,
        )
      : evaluations;
    return [...inPeriod].sort((a, b) => {
      const aT = new Date(a.evaluator_assigned_at ?? a.created_at).getTime();
      const bT = new Date(b.evaluator_assigned_at ?? b.created_at).getTime();
      return bT - aT;
    });
  }, [evaluations, selectedPeriod?.id, selectedPeriod?.evaluation_year]);

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
          <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)', padding: '20px 6px' }}>
            평가 목록을 불러오는 중입니다.
          </div>
        )}

        {!isLoading && visibleEvaluations.length === 0 && (
          <div className="sd-card sd-card-lg" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
            아직 등록된 평가가 없습니다.
          </div>
        )}

        {!isLoading &&
          visibleEvaluations.map((ev, index) => {
            const isCurrent = Boolean(
              ev.evaluator_id && employeeEvaluatorId && ev.evaluator_id === employeeEvaluatorId,
            );
            const rawPeriod = ev.evaluator_id ? scopedPeriods.get(ev.evaluator_id) : null;
            // 마감/잠금된 평가기간은 마지막 평가자도 '현재(진행중)'가 아니라 기간 종료일로 끝낸다.
            // (buildEvaluatorPeriods는 마지막 구간을 end=null로 두는데, 이는 활성기간에서만 '~현재'가 맞다.)
            const closedPeriodEnd =
              selectedPeriod &&
              (selectedPeriod.status === 'closed' || selectedPeriod.status === 'locked')
                ? selectedPeriod.ends_on ?? null
                : null;
            const periodLabel = rawPeriod
              ? formatEvaluatorPeriod(
                  rawPeriod.end === null && closedPeriodEnd
                    ? { start: rawPeriod.start, end: closedPeriodEnd }
                    : rawPeriod,
                )
              : null;
            return (
              <EvaluationAccordionCard
                key={ev.id}
                employeeId={employeeId}
                evaluationId={ev.id}
                isCurrent={isCurrent}
                defaultExpanded={index === 0}
                periodLabel={periodLabel}
              />
            );
          })}
      </div>
    </>
  );
};

export default MyTasksPage;
