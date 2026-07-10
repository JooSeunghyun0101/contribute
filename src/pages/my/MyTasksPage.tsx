import { useEffect, useMemo, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import EvaluationGuide from '@/components/Dashboard/EvaluationGuide';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { employeeService, evaluationService } from '@/lib/services';
import { formatEvaluatorPeriod } from '@/lib/evaluatorHistory';
import { buildEvaluatorPeriods } from '@/lib/evaluatorHistory';
import EvaluationAccordionCard from './EvaluationAccordionCard';
import { ErrorState, EmptyState, LoadingState } from '@/components/ui/state-views';
import type { Evaluation, Employee, EvaluatorAssignmentHistory } from '@/types';

const MyTasksPage = () => {
  const { user } = useAuth();
  const employeeId = user?.employeeId ?? '';

  const { selectedPeriod } = useEvaluationPeriod();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [history, setHistory] = useState<EvaluatorAssignmentHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // P3-11: 평가 가이드 모달(기구현 EvaluationGuide 재배선) — 작성 기준·매트릭스 안내.
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(false);
      try {
        const [emp, evals, history] = await Promise.all([
          employeeService.getEmployeeById(employeeId),
          // 선택한 평가기간을 서버에 전달 — 미전달 시 서버가 활성기간(2026)만 반환해
          // 이전 연도(2025) 선택 시 빈 목록이 되는 문제를 막는다.
          evaluationService.getEvaluationsByEmployeeId(
            employeeId,
            selectedPeriod?.id ? { periodId: selectedPeriod.id } : undefined,
          ),
          employeeService.getEvaluatorAssignmentHistory(employeeId).catch((error): never[] => {
            console.warn('평가자 이력 로드 실패:', error);
            return [];
          }),
        ]);
        if (cancelled) return;
        setEmployee(emp ?? null);
        setHistory(history);
        setEvaluations(evals);
      } catch (error) {
        // 오류를 빈 배열로 흡수하지 않는다 — "평가 없음"이 아니라 "불러오기 실패"로 구분 표시.
        console.warn('평가 목록 로드 실패:', error);
        if (!cancelled) {
          setEvaluations([]);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadKey 또는 선택 평가기간 변경 시 다시 로드(기간 전환 시 해당 기간 평가를 새로 가져옴)
  }, [employeeId, reloadKey, selectedPeriod?.id]);

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
        actions={
          <button
            className="sd-btn sd-btn-outline sd-btn-sm"
            onClick={() => setShowGuide(true)}
            title="평가 기준·매트릭스 가이드를 봅니다."
          >
            <HelpCircle size={14} aria-hidden="true" />
            평가 가이드
          </button>
        }
      />
      {showGuide && <EvaluationGuide onClose={() => setShowGuide(false)} />}

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
        {isLoading && <LoadingState message="평가 목록을 불러오는 중입니다…" />}

        {!isLoading && loadError && (
          <ErrorState
            message="평가 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        )}

        {!isLoading && !loadError && visibleEvaluations.length === 0 && (
          <EmptyState message="아직 등록된 평가가 없습니다." />
        )}

        {!isLoading && !loadError &&
          visibleEvaluations.map((ev, index) => {
            // 선택한 평가기간 안에서 가장 최근 배정(목록 최상단)이 그 기간의 '현재 평가', 이전 배정은 '이전 평가'.
            // (전역 현재 평가자와 비교하면, 과거 연도를 보는데도 그 해 평가자가 '이전'으로 잘못 표시된다.)
            const isCurrent = index === 0;
            const rawPeriod = ev.evaluator_id ? scopedPeriods.get(ev.evaluator_id) : null;
            // 특정 평가기간을 한정해 보는 중이면, 열린 구간(end=null)의 종료를 그 기간의 종료일로 끝낸다.
            // (buildEvaluatorPeriods는 마지막 구간을 end=null로 두는데, 기간 한정 조회에서는 '~현재'가 아니라 기간 종료일이 맞다.)
            const periodEnd = selectedPeriod?.ends_on ?? null;
            const periodLabel = rawPeriod
              ? formatEvaluatorPeriod(
                  rawPeriod.end === null && periodEnd
                    ? { start: rawPeriod.start, end: periodEnd }
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
