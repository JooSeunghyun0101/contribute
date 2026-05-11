import { useEffect, useState } from 'react';
import { evaluationService, taskService, feedbackService } from '@/lib/services';
import type {
  PastEvaluationBundle,
} from '@/components/Feedback/PastEvaluationAccordion';
import type { TaskFeedbackEntry } from '@/components/Feedback/TaskFeedbackCard';

export const usePastEvaluations = (employeeId: string, currentEvaluationId?: string | null) => {
  const [pastBundles, setPastBundles] = useState<PastEvaluationBundle[]>([]);
  const [isLoadingPast, setIsLoadingPast] = useState(false);

  useEffect(() => {
    if (!employeeId) {
      setPastBundles([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoadingPast(true);
      try {
        const all = await evaluationService.getEvaluationsByEmployeeId(employeeId);
        // 현재 evaluation이 아닌 모든 active 평가를 과거로 표시
        // (completed/submitted/evaluating 등 status 무관)
        const past = all.filter((ev) => ev.id !== currentEvaluationId);
        const enriched: PastEvaluationBundle[] = await Promise.all(
          past.map(async (ev) => {
            let cards: PastEvaluationBundle['cards'] = [];
            try {
              const tasks = (await taskService.getTasksByEvaluationId(ev.id)).filter(
                (t: any) => !t.deleted_at,
              );
              cards = await Promise.all(
                tasks.map(async (task: any, idx: number) => {
                  let entries: TaskFeedbackEntry[] = [];
                  try {
                    const fbs = await feedbackService.getFeedbackHistoryByTaskId(task.task_id);
                    entries = fbs
                      .map((fb: any) => ({
                        id: fb.id,
                        content: fb.content,
                        date: fb.created_at,
                        evaluatorName: fb.evaluator_name ?? null,
                      }))
                      .sort(
                        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
                      );
                  } catch {
                    entries = [];
                  }
                  return {
                    taskId: task.task_id,
                    taskIndex: idx,
                    taskTitle: task.title,
                    contributionMethod: task.contribution_method,
                    contributionScope: task.contribution_scope,
                    score: task.score ?? null,
                    entries,
                  };
                }),
              );
            } catch {
              cards = [];
            }
            return { evaluation: ev, cards };
          }),
        );
        if (!cancelled) setPastBundles(enriched);
      } catch (error) {
        console.warn('과거 평가 로드 실패:', error);
        if (!cancelled) setPastBundles([]);
      } finally {
        if (!cancelled) setIsLoadingPast(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, currentEvaluationId]);

  return { pastBundles, isLoadingPast };
};
