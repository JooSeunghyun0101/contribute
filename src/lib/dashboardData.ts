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
): Promise<EmployeeEvaluationRecord> => {
  let evaluation: Evaluation | null = null;

  try {
    evaluation = await evaluationService.getEvaluationByEmployeeId(employee.employee_id, {
      periodId: options.periodId,
      evaluatorId: options.evaluatorId,
    });
  } catch {
    evaluation = null;
  }

  let tasks: EnrichedTask[] = [];

  if (evaluation?.id) {
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
) => mapWithConcurrency(employees, 6, (employee) => loadEmployeeEvaluationRecord(employee, options));

export const getActiveEvaluatees = (employees: Employee[]) =>
  employees.filter((employee) => employee.available_roles?.includes('evaluatee'));
