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
  /** HR 화면 전용: 평가/과업을 직원별 개별 요청 대신 벌크 2회로 모아 N+1·429 완화.
   *  실패하거나 includeFeedbackHistory 면 개별 조회로 폴백. */
  bulk?: boolean;
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

  return assembleEvaluationRecord(employee, evaluation, tasks);
};

// 평가·과업을 받아 점수/진행률/피드백 등을 계산하는 순수 함수.
// 개별 경로(loadEmployeeEvaluationRecord)와 벌크 경로가 같은 계산을 공유해
// 두 경로의 결과가 어긋나지 않게 한다. tasks 는 이미 deleted_at 제외된 상태로 전달.
const assembleEvaluationRecord = (
  employee: Employee,
  evaluation: Evaluation | null,
  tasks: EnrichedTask[],
): EmployeeEvaluationRecord => {
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

// 벌크 경로: 직원별 현재 평가(1회) + 기간 전체 과업(1회)을 모아 메모리에서 조립.
// 개별 N+1(직원당 평가+과업 호출)을 2회로 줄여 HR 화면의 429를 완화한다.
// includeFeedbackHistory 는 과업당 추가 호출이라 이 경로에서 다루지 않는다(호출부에서 개별 경로).
const loadEmployeeEvaluationRecordsBulk = async (
  employees: Employee[],
  options: LoadOptions,
): Promise<EmployeeEvaluationRecord[]> => {
  const evaluations = await evaluationService.getCurrentEvaluationsByEmployee({
    periodId: options.periodId,
    evaluatorId: options.evaluatorId,
  });
  const evalByEmployee = new Map<string, Evaluation>();
  for (const ev of evaluations) {
    if (ev.evaluatee_id && !evalByEmployee.has(ev.evaluatee_id)) {
      evalByEmployee.set(ev.evaluatee_id, ev);
    }
  }

  const tasksByEvaluation = new Map<string, EnrichedTask[]>();
  if (!options.skipTasks) {
    const allTasks = await taskService.getCurrentYearTasks({ periodId: options.periodId });
    for (const task of allTasks) {
      if (task.deleted_at || !task.evaluation_id) continue;
      const bucket = tasksByEvaluation.get(task.evaluation_id);
      if (bucket) bucket.push(task);
      else tasksByEvaluation.set(task.evaluation_id, [task]);
    }
  }

  return employees.map((employee) => {
    const evaluation = evalByEmployee.get(employee.employee_id) ?? null;
    const tasks = evaluation?.id ? tasksByEvaluation.get(evaluation.id) ?? [] : [];
    return assembleEvaluationRecord(employee, evaluation, tasks);
  });
};

export const loadEmployeeEvaluationRecords = async (
  employees: Employee[],
  options: LoadOptions = {},
) => {
  // HR 대시보드 경로: 벌크 2회로 N+1 제거. 피드백 이력 포함 요청은 개별 경로(과업당 추가 호출).
  if (options.bulk && !options.includeFeedbackHistory && employees.length > 0) {
    try {
      return await loadEmployeeEvaluationRecordsBulk(employees, options);
    } catch (err) {
      // 벌크 실패 시 개별 조회로 폴백 — 데이터 전멸 방지(이전 회귀 재발 방지 안전장치).
      console.warn('벌크 레코드 로드 실패, 개별 조회로 폴백합니다.', err);
    }
  }
  return mapWithConcurrency(employees, 6, (employee) => loadEmployeeEvaluationRecord(employee, options));
};

export const getActiveEvaluatees = (employees: Employee[]) =>
  employees.filter((employee) => employee.available_roles?.includes('evaluatee'));
