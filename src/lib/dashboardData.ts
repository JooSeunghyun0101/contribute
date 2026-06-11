import { employeeService, evaluationService, feedbackApiService, taskService } from '@/lib/services';
import type { Employee, Evaluation, FeedbackHistory, Task as DbTask } from '@/types';

export type FeedbackSnapshot = {
  taskId: string;
  taskTitle: string;
  content: string;
  date: string;
  evaluatorName: string | null;
};

export type EnrichedTask = DbTask & {
  feedbackHistory?: FeedbackHistory[];
};

export type EmployeeEvaluationRecord = {
  employee: Employee;
  evaluation: Evaluation | null;
  evaluationStatus: Evaluation['evaluation_status'] | 'not-started';
  reviewStatus: 'not-started' | 'draft' | 'submitted' | 'evaluating' | 'completed' | 'locked';
  tasks: EnrichedTask[];
  totalTasks: number;
  completedTasks: number;
  feedbackCount: number;
  progress: number;
  totalWeight: number;
  weightedScore: number;
  flooredScore: number;
  achieved: boolean;
  status: 'not-started' | 'in-progress' | 'completed';
  latestFeedback: FeedbackSnapshot | null;
};

type LoadOptions = {
  includeFeedbackHistory?: boolean;
  periodId?: string | null;
  evaluatorId?: string | null;
  /** 과업(tasks) 조회를 생략 — 평가 존재/상태만 필요한 목록 화면에서 요청 수를 줄인다. */
  skipTasks?: boolean;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sortByDateDesc = <T extends { date: string }>(items: T[]) =>
  [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

const buildFeedbackSnapshots = (task: EnrichedTask): FeedbackSnapshot[] => {
  const historySnapshots =
    task.feedbackHistory?.map((item) => ({
      taskId: task.task_id,
      taskTitle: task.title,
      content: item.content,
      date: item.created_at,
      evaluatorName: item.evaluator_name,
    })) ?? [];

  if (historySnapshots.length > 0) {
    return historySnapshots;
  }

  if (task.feedback && task.feedback_date) {
    return [
      {
        taskId: task.task_id,
        taskTitle: task.title,
        content: task.feedback,
        date: task.feedback_date,
        evaluatorName: task.evaluator_name,
      },
    ];
  }

  return [];
};

const getReviewStatus = (
  evaluation: Evaluation | null,
): EmployeeEvaluationRecord['reviewStatus'] => {
  if (!evaluation) return 'not-started';

  switch (evaluation.evaluation_status) {
    case 'submitted':
      return 'submitted';
    case 'evaluating':
      return 'evaluating';
    case 'completed':
      return 'completed';
    case 'locked':
      return 'locked';
    case 'draft':
    case 'in-progress':
    default:
      return 'draft';
  }
};

export const loadEmployeeEvaluationRecord = async (
  employee: Employee,
  options: LoadOptions = {},
  // 벌크 프리페치된 평가. undefined = 프리페치 없음(직원별 조회), null = 평가 없음(조회 생략).
  preloadedEvaluation: Evaluation | null | undefined = undefined,
): Promise<EmployeeEvaluationRecord> => {
  let evaluation: Evaluation | null = null;

  if (preloadedEvaluation !== undefined) {
    evaluation = preloadedEvaluation;
  } else {
    try {
      evaluation = await evaluationService.getEvaluationByEmployeeId(employee.employee_id, {
        periodId: options.periodId,
        evaluatorId: options.evaluatorId,
      });
    } catch {
      evaluation = null;
    }
  }

  let tasks: EnrichedTask[] = [];

  if (evaluation?.id && !options.skipTasks) {
    try {
      tasks = await taskService.getTasksByEvaluationId(evaluation.id);
    } catch {
      tasks = [];
    }
  }

  tasks = tasks.filter((task) => !task.deleted_at);

  if (options.includeFeedbackHistory) {
    tasks = await Promise.all(
      tasks.map(async (task) => {
        try {
          const feedbackHistory = await feedbackApiService.getFeedbackHistoryByTaskId(task.task_id);
          return { ...task, feedbackHistory };
        } catch {
          return { ...task, feedbackHistory: [] };
        }
      }),
    );
  }

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.score !== null && task.score !== undefined).length;
  const totalWeight = tasks.reduce((sum, task) => sum + toNumber(task.weight), 0);
  const weightedScore = tasks.reduce((sum, task) => {
    if (task.score === null || task.score === undefined) {
      return sum;
    }
    return sum + toNumber(task.score) * (toNumber(task.weight) / 100);
  }, 0);
  const flooredScore = Math.floor(weightedScore);
  const growthLevel = Math.max(1, toNumber(employee.growth_level, 1));
  const achieved = flooredScore >= growthLevel;
  const feedbackSnapshots = sortByDateDesc(tasks.flatMap((task) => buildFeedbackSnapshots(task)));
  const feedbackCount = feedbackSnapshots.length;
  const latestFeedback = feedbackSnapshots[0] ?? null;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const status: EmployeeEvaluationRecord['status'] =
    !evaluation ? 'not-started' : totalTasks > 0 && completedTasks === totalTasks ? 'completed' : 'in-progress';
  const reviewStatus = getReviewStatus(evaluation);

  return {
    employee,
    evaluation,
    evaluationStatus: evaluation?.evaluation_status ?? 'not-started',
    reviewStatus,
    tasks,
    totalTasks,
    completedTasks,
    feedbackCount,
    progress,
    totalWeight,
    weightedScore,
    flooredScore,
    achieved,
    status,
    latestFeedback,
  };
};

// 동시 요청 수를 제한해 직원이 많을 때 브라우저 리소스 고갈(ERR_INSUFFICIENT_RESOURCES)을 막는다.
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const worker = async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await fn(items[current]);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
};

export const loadEmployeeEvaluationRecords = async (
  employees: Employee[],
  options: LoadOptions = {},
) => {
  // N+1 정리: 직원별 평가 조회(E건)를 벌크 1건으로 대체해 요청 폭주(429)를 막는다.
  // 한 직원에 평가가 여러 건(발령/전보)인 경우만 per-employee로 폴백해 점수 정합성을 보존하고,
  // 벌크 조회가 실패하면 전체를 기존 직원별 경로로 되돌린다(undefined 전달).
  let evalByEmployee: Map<string, Evaluation> | null = null;
  const multiEvalEmployees = new Set<string>();
  try {
    const all = await evaluationService.getAllEvaluations({
      periodId: options.periodId,
      evaluatorId: options.evaluatorId,
    });
    evalByEmployee = new Map<string, Evaluation>();
    for (const ev of all) {
      const empId = ev.employee_id;
      if (!empId) continue;
      if (evalByEmployee.has(empId)) {
        multiEvalEmployees.add(empId); // 다중 평가 → per-employee 폴백 대상
      } else {
        evalByEmployee.set(empId, ev);
      }
    }
  } catch {
    evalByEmployee = null;
  }

  return mapWithConcurrency(employees, 6, (employee) => {
    const preEval =
      evalByEmployee && !multiEvalEmployees.has(employee.employee_id)
        ? evalByEmployee.get(employee.employee_id) ?? null
        : undefined; // undefined = 직원별 조회로 폴백
    return loadEmployeeEvaluationRecord(employee, options, preEval);
  });
};

export const getActiveEvaluatees = (employees: Employee[]) =>
  employees.filter((employee) => employee.available_roles?.includes('evaluatee'));
