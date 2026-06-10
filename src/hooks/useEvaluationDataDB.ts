import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useNotifications } from '@/contexts/NotificationContextDB';
import { EvaluationData, Task, FeedbackHistoryItem, TaskEvaluationEntry } from '@/types/evaluation';

// In‑memory cache to remember which evaluatee already has an evaluation during this session
// Prevents creating a new evaluation on every view reload.
const evaluationCache = new Set<string>();
import { Employee, TaskEvaluationEntry as DbTaskEvaluationEntry } from '@/types';
import {
  employeeService,
  evaluationService,
  taskService,
  feedbackService,
  notificationService,
  taskEvaluationEntryService,
} from '@/lib/services';
import { getMatrixScore } from '@/lib/evaluationMatrix';
import { reviewEvaluationFeedbacks } from '@/lib/gptOss';

type TaskDraft = Partial<Pick<
  Task,
  'contributionMethod' | 'contributionScope' | 'score' | 'feedback' | 'feedbackDate' | 'evaluatorName'
>>;

const DRAFT_FIELDS: Array<keyof TaskDraft> = [
  'contributionMethod',
  'contributionScope',
  'score',
  'feedback',
  'feedbackDate',
  'evaluatorName',
];

const getDraftStorageKey = (employeeId: string, evaluatorId?: string) =>
  `evaluationDraft:${evaluatorId || 'anonymous'}:${employeeId}`;

const sanitizeTaskDraft = (draft?: TaskDraft | null): TaskDraft | null => {
  if (!draft) return null;

  const sanitized: TaskDraft = {};
  DRAFT_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(draft, field) && draft[field] !== undefined) {
      (sanitized as any)[field] = (draft as any)[field];
    }
  });

  return Object.keys(sanitized).length > 0 ? sanitized : null;
};

const normalizeDrafts = (
  drafts: Record<string, TaskDraft> | null | undefined,
  validTaskIds?: Set<string>,
) => {
  const normalized: Record<string, TaskDraft> = {};
  if (!drafts) return normalized;

  Object.entries(drafts).forEach(([taskId, draft]) => {
    if (validTaskIds && !validTaskIds.has(taskId)) return;
    const sanitized = sanitizeTaskDraft(draft);
    if (sanitized) {
      normalized[taskId] = sanitized;
    }
  });

  return normalized;
};

const readStoredDrafts = (storageKey: string, validTaskIds: Set<string>) => {
  if (!storageKey || typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    const draftMap = parsed?.tasks ?? parsed;
    return normalizeDrafts(draftMap, validTaskIds);
  } catch (error) {
    console.warn('임시저장 데이터 복원 실패:', error);
    return {};
  }
};

const writeStoredDrafts = (storageKey: string, drafts: Record<string, TaskDraft>) => {
  if (!storageKey || typeof window === 'undefined') return;

  const normalized = normalizeDrafts(drafts);
  if (Object.keys(normalized).length === 0) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      tasks: normalized,
    }),
  );
};

const applyTaskDraft = (task: Task, draft?: TaskDraft): Task => ({
  ...task,
  ...(draft ? sanitizeTaskDraft(draft) ?? {} : {}),
});

const getEvaluatorIdentity = (user?: { employeeId?: string; id?: string } | null) =>
  user?.employeeId || user?.id || '';

const mapTaskEvaluationEntry = (entry: DbTaskEvaluationEntry): TaskEvaluationEntry => ({
  id: entry.id,
  taskUuid: entry.task_uuid,
  taskId: entry.task_id,
  evaluationId: entry.evaluation_id,
  evaluatorId: entry.evaluator_id,
  evaluatorName: entry.evaluator_name,
  assignmentHistoryId: entry.assignment_history_id,
  status: entry.status,
  contributionMethod: entry.contribution_method,
  contributionScope: entry.contribution_scope,
  score: entry.score,
  feedback: entry.feedback,
  feedbackDate: entry.feedback_date,
  cancelledAt: entry.cancelled_at,
  cancelledBy: entry.cancelled_by,
  cancelReason: entry.cancel_reason,
  createdAt: entry.created_at,
  updatedAt: entry.updated_at,
});

const isEntryForEvaluator = (
  entry: Pick<TaskEvaluationEntry, 'evaluatorId' | 'evaluatorName'>,
  evaluatorId: string,
  evaluatorName?: string,
) =>
  Boolean(evaluatorId && entry.evaluatorId === evaluatorId) ||
  Boolean(
    evaluatorName &&
      entry.evaluatorName === evaluatorName &&
      (!entry.evaluatorId || entry.evaluatorId.startsWith('legacy:')),
  );

const getEntryTimestamp = (entry: Pick<TaskEvaluationEntry, 'updatedAt' | 'createdAt' | 'feedbackDate'>) => {
  const date = entry.updatedAt || entry.feedbackDate || entry.createdAt;
  const time = date ? new Date(date).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

const sortEntriesByRecent = (entries: TaskEvaluationEntry[]) =>
  [...entries].sort((a, b) => getEntryTimestamp(b) - getEntryTimestamp(a));

const buildEmptyEvaluationData = (employee: Employee): EvaluationData => ({
  evaluateeId: employee.employee_id,
  evaluateeName: employee.name,
  evaluateePosition: employee.position,
  evaluateeDepartment: employee.department,
  growthLevel: employee.growth_level || 1,
  evaluationStatus: 'draft',
  lastModified: new Date().toISOString(),
  evaluatorAccess: {
    assignedEvaluatorId: employee.evaluator_id,
    currentEvaluatorId: null,
    canEdit: false,
    isCurrentAssignedEvaluator: false,
    isFormerEvaluator: false,
    hasOtherEvaluatorEntries: false,
  },
  tasks: [],
});

export const useEvaluationDataDB = (
  employeeId: string,
  options?: { evaluationId?: string | null },
) => {
  const { user } = useAuth();
  const { matrix } = useEvaluationMatrix();
  const {
    selectedPeriodId,
    selectedPeriod,
    isSelectedPeriodEditable,
    selectedPeriodEditMessage,
  } = useEvaluationPeriod();
  const overrideEvaluationId = options?.evaluationId ?? null;
  const selectedPeriodStatus = selectedPeriod?.status;
  const selectedPeriodYear = selectedPeriod?.evaluation_year;
  const { toast } = useToast();
  const confirm = useConfirm();
  const { addNotification } = useNotifications();
  const currentEvaluatorId = getEvaluatorIdentity(user);
  const draftStorageKey = getDraftStorageKey(
    overrideEvaluationId ? `${employeeId}#${overrideEvaluationId}` : employeeId,
    currentEvaluatorId,
  );

  const [evaluationData, setEvaluationData] = useState<EvaluationData | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({});
  const [isLoading, setIsLoading] = useState(true);

  const showPeriodLockedToast = useCallback(() => {
    toast({
      title: '수정할 수 없는 평가기간입니다.',
      description: selectedPeriodEditMessage ?? '활성 평가기간에서만 저장할 수 있습니다.',
      variant: 'destructive',
    });
  }, [selectedPeriodEditMessage, toast]);

  const ensurePeriodEditable = useCallback(() => {
    if (isSelectedPeriodEditable) return true;
    showPeriodLockedToast();
    return false;
  }, [isSelectedPeriodEditable, showPeriodLockedToast]);

  // 데이터베이스에서 평가 데이터 로드
  const loadEvaluationData = useCallback(async () => {
    try {
      setIsLoading(true);
      // Holds employee info for possible mock fallback when DB returns nothing
      let loadedEmployee: Employee | null = null;

      // 1. 평가 정보 조회 — evaluationId 오버라이드가 있으면 해당 평가 우선
      let evaluation = null;
      if (overrideEvaluationId) {
        try {
          evaluation = await evaluationService.getEvaluationById(overrideEvaluationId);
        } catch (error) {
          console.warn('지정 evaluationId 조회 실패:', error);
        }
      } else {
        try {
          evaluation = await evaluationService.getEvaluationByEmployeeId(employeeId, {
            periodId: selectedPeriodId,
          });
        } catch (error) {
          console.warn('평가 레코드 조회 실패, 빈 평가 데이터로 대체합니다:', error);
        }
      }
      // Some back‑ends may return the identifier under a different key (e.g., evaluation_id)
      // Ensure the evaluation object always has an `id` property for downstream usage.
      if (evaluation && !evaluation.id && (evaluation as any).evaluation_id) {
        // Map possible evaluation_id to id for consistency
        evaluation.id = (evaluation as any).evaluation_id;
      }
      // 2. 평가가 없으면 생성 (한 번만)
      if (!evaluation) {
          const employee = await employeeService.getEmployeeById(employeeId);
          if (employee) {
            if (selectedPeriodStatus === 'closed' || selectedPeriodStatus === 'locked') {
              setEvaluationData(buildEmptyEvaluationData(employee));
              setTaskDrafts({});
              writeStoredDrafts(draftStorageKey, {});
              setIsLoading(false);
              return;
            }
            try {
              evaluation = await evaluationService.createEvaluation({
                evaluatee_id: employeeId,
                evaluatee_name: employee.name,
                evaluatee_position: employee.position,
                evaluatee_department: employee.department,
                growth_level: employee.growth_level || 1,
                evaluation_status: 'draft',
                evaluation_year: selectedPeriodYear,
                evaluation_period_id: selectedPeriodId,
                last_modified: new Date().toISOString()
              });
            } catch (error) {
              console.warn('평가 레코드 생성 실패, 빈 평가 데이터로 대체합니다:', error);
              setEvaluationData(buildEmptyEvaluationData(employee));
              setTaskDrafts({});
              writeStoredDrafts(draftStorageKey, {});
              setIsLoading(false);
              return;
            }
            // Ensure we have the full evaluation record (including generated ID)
            // Some back‑ends may return only the created fields without the ID,
            // so fetch it again to guarantee a persistent evaluation exists.
            if (!evaluation.id) {
              // Back‑end may use `evaluation_id` instead of `id`
              if ((evaluation as any).evaluation_id) {
                // Map possible evaluation_id to id for consistency
                evaluation.id = (evaluation as any).evaluation_id;
              } else {
                const fresh = await evaluationService.getEvaluationByEmployeeId(employeeId, {
                  periodId: selectedPeriodId,
                });
                if (fresh) {
                  evaluation = fresh;
                }
              }
            }
          } else {
            throw new Error('직원 정보를 찾을 수 없습니다.');
          }
      }
      
       // Ensure real employee data is used for the dashboard
       const emp = await employeeService.getEmployeeById(employeeId);
       if (emp) {
         loadedEmployee = emp;
         if (!evaluation) {
           setEvaluationData(buildEmptyEvaluationData(emp));
           setTaskDrafts({});
           writeStoredDrafts(draftStorageKey, {});
           setIsLoading(false);
           return;
         }
         // Override evaluation fields with actual employee info
         evaluation = {
           ...evaluation,
           evaluatee_name: emp.name,
           evaluatee_position: emp.position,
           evaluatee_department: emp.department,
           growth_level: emp.growth_level || 1,
         };
       }
      
      // Additional safety: ensure evaluation has an id before proceeding
      if (!evaluation.id) {
        console.warn('⚠️ 평가 객체에 id가 없으며, 기본 화면을 표시합니다.');
        setEvaluationData(null);
        setIsLoading(false);
        return;
      }
      // Mark that this evaluation exists to prevent re‑creation on future reloads
      // Store both in‑memory and persistent flag
      evaluationCache.add(employeeId);
      localStorage.setItem(`evaluationCreated-${employeeId}`, 'true');
      
      // 3. 과업들 조회
      let tasks = await taskService.getTasksByEvaluationId(evaluation?.id);
      // Filter out soft‑deleted tasks (deleted_at is not null)
      tasks = tasks.filter((t: any) => !t.deleted_at);
      if (!Array.isArray(tasks)) {
        console.warn('⚠️ taskService.getTasksByEvaluationId returned non‑array, defaulting to empty list');
        tasks = [];
      }
      tasks = tasks.filter(Boolean);

      let taskEvaluationEntries: TaskEvaluationEntry[] = [];
      try {
        const dbEntries = await taskEvaluationEntryService.getEntriesByEvaluationId(evaluation.id);
        taskEvaluationEntries = sortEntriesByRecent(dbEntries.map(mapTaskEvaluationEntry));
      } catch (error) {
        console.warn('평가자별 평가 이력 조회 실패, 기존 과업 컬럼으로 대체합니다:', error);
        taskEvaluationEntries = [];
      }

      let historicalTasks: any[] = [];
      let historicalTaskEvaluationEntries: TaskEvaluationEntry[] = [];
      // 특정 evaluationId를 지정해서 열었으면 다른 evaluation의 이력은 불러오지 않음.
      // (예: 평가자가 자기 과거 평가를 열면 그 평가에 속한 task/entry만 노출)
      if (user?.role === 'evaluator' && !overrideEvaluationId) {
        try {
          const evaluations = await evaluationService.getEvaluationsByEmployeeId(employeeId, {
            periodId: selectedPeriodId,
          });
          const previousEvaluations = evaluations.filter((item) => item.id && item.id !== evaluation.id);

          for (const previousEvaluation of previousEvaluations) {
            const previousTasks = await taskService.getTasksByEvaluationId(previousEvaluation.id);
            historicalTasks.push(
              ...previousTasks
                .filter((task: any) => !task.deleted_at)
                .map((task: any) => ({
                  ...task,
                  isHistoricalEvaluation: true,
                  sourceEvaluationId: previousEvaluation.id,
                })),
            );

            const previousEntries = await taskEvaluationEntryService.getEntriesByEvaluationId(
              previousEvaluation.id,
            );
            historicalTaskEvaluationEntries.push(...previousEntries.map(mapTaskEvaluationEntry));
          }
        } catch (error) {
          console.warn('이전 평가 이력 조회 실패:', error);
          historicalTasks = [];
          historicalTaskEvaluationEntries = [];
        }
      }

      tasks = tasks.map((task: any) => ({
        ...task,
        isHistoricalEvaluation: false,
        sourceEvaluationId: evaluation.id,
      }));
      tasks = [...tasks, ...historicalTasks];
      taskEvaluationEntries = sortEntriesByRecent([
        ...taskEvaluationEntries,
        ...historicalTaskEvaluationEntries,
      ]);

      const entriesByTaskKey = new Map<string, TaskEvaluationEntry[]>();
      taskEvaluationEntries.forEach((entry) => {
        [entry.taskUuid, entry.taskId].filter(Boolean).forEach((key) => {
          const entries = entriesByTaskKey.get(key) ?? [];
          entries.push(entry);
          entriesByTaskKey.set(key, entries);
        });
      });

      const getEntriesForTask = (task: any) => {
        const combined = [
          ...(entriesByTaskKey.get(task.id) ?? []),
          ...(entriesByTaskKey.get(task.task_id) ?? []),
        ];
        return sortEntriesByRecent(
          Array.from(new Map(combined.map((entry) => [entry.id, entry])).values()),
        );
      };

      const hasOwnEvaluationEntries =
        user?.role === 'evaluator' &&
        taskEvaluationEntries.some((entry) =>
          isEntryForEvaluator(entry, currentEvaluatorId, user?.name),
        );
      const hasOtherEvaluatorEntries =
        user?.role === 'evaluator' &&
        taskEvaluationEntries.some(
          (entry) => !isEntryForEvaluator(entry, currentEvaluatorId, user?.name),
        );
      // 로드된 평가의 소유 평가자 정보
      const evaluationOwnerEvaluatorId =
        (evaluation as any)?.evaluator_id ?? null;
      // 현재 사용자가 로드된 평가의 소유 평가자인가
      const isEvaluatorOfThisEvaluation =
        user?.role === 'evaluator' &&
        Boolean(currentEvaluatorId) &&
        evaluationOwnerEvaluatorId === currentEvaluatorId;
      // 현재 사용자가 직원의 현재 담당 평가자(employees.evaluator_id)인가
      const isEmployeeCurrentEvaluator =
        user?.role === 'evaluator' &&
        Boolean(currentEvaluatorId) &&
        loadedEmployee?.evaluator_id === currentEvaluatorId;
      // 로드된 평가가 직원의 현재 평가인가 (시간상 진행 중)
      const isLoadedEvaluationCurrent =
        evaluationOwnerEvaluatorId !== null &&
        loadedEmployee?.evaluator_id !== undefined &&
        evaluationOwnerEvaluatorId === loadedEmployee.evaluator_id;
      // 사용자가 '현재 평가의 담당 평가자' 인지 (라벨/권한용)
      const isCurrentAssignedEvaluator =
        isEvaluatorOfThisEvaluation && isLoadedEvaluationCurrent;
      // '이전 평가'로 볼지 —
      // 본인이 현재 평가자(isCurrentAssignedEvaluator)가 아닌데
      // 이 evaluation 에 본인 또는 다른 평가자의 entry 가 존재하거나
      // 본인이 evaluation 의 소유 평가자였다면 former 로 본다.
      // (백엔드 former-evaluator 라우트가 이미 권한 검증 후의 흐름이므로 안전.)
      const isFormerEvaluator =
        user?.role === 'evaluator' &&
        !isCurrentAssignedEvaluator &&
        (isEvaluatorOfThisEvaluation ||
          hasOwnEvaluationEntries ||
          hasOtherEvaluatorEntries);
      const canEditAsEvaluator =
        user?.role !== 'evaluator' ||
        Boolean(hasOwnEvaluationEntries) ||
        Boolean(isCurrentAssignedEvaluator) ||
        Boolean(isEvaluatorOfThisEvaluation);
      const evaluatorAccessMessage =
        user?.role === 'evaluator' && !canEditAsEvaluator
          ? '현재 이 평가를 수정할 수 있는 담당자가 아닙니다.'
          : undefined;
             
      // 5. 각 과업의 피드백 히스토리 로드
      const tasksWithHistory = await Promise.all(
        tasks.map(async (task) => {
          
          
          let feedbackHistory: any[] = [];
          try {
            feedbackHistory = await feedbackService.getFeedbackHistoryByTaskId(task.task_id);
          } catch (error) {
            console.error('❌ 피평가자 대시보드 - 피드백 히스토리 조회 실패:', {
              taskId: task.task_id,
              taskTitle: task.title,
              error: error,
              message: error instanceof Error ? error.message : 'Unknown error'
            });
            feedbackHistory = [];
          }
          
          // 피드백 히스토리를 feedbackHistory로 사용
          const feedbackHistoryItems = feedbackHistory.map(fh => ({
            id: fh.id,
            content: fh.content,
            date: fh.created_at,
            evaluatorName: fh.evaluator_name || '평가자',
            evaluatorId: fh.evaluator_id || currentEvaluatorId || 'unknown'
          }));

          // 날짜순으로 정렬 (최신순)
          feedbackHistoryItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          const evaluationEntries = getEntriesForTask(task);
          const currentEvaluatorEntry =
            user?.role === 'evaluator'
              ? evaluationEntries.find((entry) =>
                  isEntryForEvaluator(entry, currentEvaluatorId, user?.name),
                ) ?? null
              : null;
          const latestEntry = evaluationEntries[0] ?? null;
          // evaluator role: 본인이 매긴 entry 우선, 없으면 가장 최근 entry로 fallback.
          // (정정으로 평가자였지만 본인이 직접 점수를 입력하지 않은 케이스 — 박준형 같은
          //  '이전 평가자' 화면에서 다른 평가자가 매긴 점수/피드백이 그대로 노출되어야 함.)
          const displayEntry =
            user?.role === 'evaluator' ? currentEvaluatorEntry ?? latestEntry : latestEntry;
          const legacyMatchesCurrentEvaluator =
            user?.role === 'evaluator' &&
            evaluationEntries.length === 0 &&
            task.evaluator_name === user?.name;
          const canUseLegacyTaskEvaluation =
            user?.role !== 'evaluator' || legacyMatchesCurrentEvaluator;
          const previousEvaluatorEntries =
            user?.role === 'evaluator'
              ? evaluationEntries.filter(
                  (entry) => !isEntryForEvaluator(entry, currentEvaluatorId, user?.name),
                )
              : evaluationEntries;
          
          return {
            id: task.id,
            taskId: task.task_id,
            // Ensure the task knows its evaluation for creation/update
            evaluation_id: task.evaluation_id || evaluation.id,
            sourceEvaluationId: task.sourceEvaluationId || task.evaluation_id || evaluation.id,
            isHistoricalEvaluation: Boolean(task.isHistoricalEvaluation),
            title: task.title,
            description: task.description || '',
            weight: task.weight,
            startDate: task.start_date || undefined,
            endDate: task.end_date || undefined,
            contributionMethod:
              displayEntry
                ? displayEntry.contributionMethod ?? undefined
                : canUseLegacyTaskEvaluation
                  ? task.contribution_method || undefined
                  : undefined,
            contributionScope:
              displayEntry
                ? displayEntry.contributionScope ?? undefined
                : canUseLegacyTaskEvaluation
                  ? task.contribution_scope || undefined
                  : undefined,
            score:
              displayEntry
                ? displayEntry.score ?? undefined
                : canUseLegacyTaskEvaluation
                  ? task.score ?? undefined
                  : undefined,
            feedback:
              displayEntry
                ? displayEntry.feedback ?? undefined
                : canUseLegacyTaskEvaluation
                  ? task.feedback || undefined
                  : undefined,
            feedbackDate:
              displayEntry
                ? displayEntry.feedbackDate ?? undefined
                : canUseLegacyTaskEvaluation
                  ? task.feedback_date || undefined
                  : undefined,
            evaluatorName:
              displayEntry
                ? displayEntry.evaluatorName ?? undefined
                : canUseLegacyTaskEvaluation
                  ? task.evaluator_name || undefined
                  : undefined,
            feedbackHistory: feedbackHistoryItems,
            evaluationEntries,
            currentEvaluatorEntry,
            previousEvaluatorEntries,
          } as Task;
        })
      );

      // 6. EvaluationData 형태로 변환
      const evaluationDataResult: EvaluationData = {
        // Include the evaluation UUID for downstream usage (e.g., notifications)
        id: evaluation.id,
        evaluatorId: (evaluation as any).evaluator_id ?? null,
        evaluatorName: (evaluation as any).evaluator_name ?? null,
        evaluatorAssignedAt: (evaluation as any).evaluator_assigned_at ?? null,
        evaluateeId: evaluation.evaluatee_id,
        evaluateeName: evaluation.evaluatee_name,
        evaluateePosition: evaluation.evaluatee_position,
        evaluateeDepartment: evaluation.evaluatee_department,
        // Ensure growth level is at least 1 (fallback if 0 or undefined)
        growthLevel: evaluation.growth_level && evaluation.growth_level > 0 ? evaluation.growth_level : 1,
        evaluationStatus: evaluation.evaluation_status,
        evaluationPeriodId: evaluation.evaluation_period_id,
        lastModified: evaluation.last_modified,
        evaluatorAccess: {
          assignedEvaluatorId: loadedEmployee?.evaluator_id ?? null,
          currentEvaluatorId: currentEvaluatorId || null,
          canEdit: canEditAsEvaluator,
          isCurrentAssignedEvaluator,
          isFormerEvaluator,
          hasOtherEvaluatorEntries,
          message: evaluatorAccessMessage,
        },
        tasks: tasksWithHistory
      };

      setEvaluationData(evaluationDataResult);

      const validTaskIds = new Set(tasksWithHistory.map(task => task.id));
      setTaskDrafts(readStoredDrafts(draftStorageKey, validTaskIds));

      
    } catch (error) {
      console.error('❌ 평가 데이터 로드 실패:', error);
      toast({
        title: "데이터 로드 실패",
        description: "평가 데이터를 불러오는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [
    draftStorageKey,
    employeeId,
    overrideEvaluationId,
    selectedPeriodStatus,
    selectedPeriodYear,
    selectedPeriodId,
    toast,
    currentEvaluatorId,
    user?.name,
    user?.role,
  ]);

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    if (employeeId) {
      loadEvaluationData();
    }
  }, [employeeId, loadEvaluationData]);

  const updateTask = async (taskId: string, field: keyof Task, value: any) => {
    if (!evaluationData) return;
    if (!ensurePeriodEditable()) return;

    try {

      // 로컬 상태만 업데이트 (데이터베이스 업데이트는 저장 시에만)
      setEvaluationData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map(task => {
            if (task.id === taskId) {
              return { ...task, [field]: value };
            }
            return task;
          }),
          lastModified: new Date().toISOString()
        };
      });

      
    } catch (error) {
      console.error('❌ 과업 업데이트 실패:', error);
      toast({
        title: "업데이트 실패",
        description: "과업 업데이트 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleWeightChange = (taskId: string, weight: number) => {
    if (!ensurePeriodEditable()) return;
    updateTask(taskId, 'weight', weight);
    
    if (!evaluationData) return;
    
    // 알림 생성 제거 - 저장 시에만 생성하도록 변경
    
    const newTotalWeight = evaluationData.tasks.reduce((sum, t) => {
      return sum + (t.id === taskId ? weight : t.weight);
    }, 0);
    
    if (newTotalWeight !== 100) {
      toast({
        title: "가중치 확인 필요",
        description: `현재 총 가중치: ${newTotalWeight}% (100%가 되도록 조정해주세요)`,
        variant: "destructive",
      });
    }
  };

  const getTaskWithDraft = (task: Task) => applyTaskDraft(task, taskDrafts[task.id]);

  const hasTaskDraft = (taskId: string) => Boolean(sanitizeTaskDraft(taskDrafts[taskId]));

  const getTasksWithDrafts = () => {
    if (!evaluationData) return [];
    return evaluationData.tasks
      .filter((task) => !task.isHistoricalEvaluation)
      .map(task => getTaskWithDraft(task));
  };

  const calculateMatrixScore = (method?: string | null, scope?: string | null) => {
    return getMatrixScore(method, scope, matrix);
  };

  const updateTaskDraft = (taskId: string, updater: (task: Task) => TaskDraft) => {
    if (!evaluationData) return;

    setTaskDrafts(prev => {
      const baseTask = evaluationData.tasks.find(t => t.id === taskId);
      if (!baseTask) return prev;

      const workingTask = applyTaskDraft(baseTask, prev[taskId]);
      const nextDraft = sanitizeTaskDraft({
        ...(prev[taskId] ?? {}),
        ...updater(workingTask),
      });
      const next = { ...prev };

      if (nextDraft) {
        next[taskId] = nextDraft;
      } else {
        delete next[taskId];
      }

      return next;
    });
  };

  const handleTemporarySave = () => {
    if (!evaluationData) return false;
    if (!ensurePeriodEditable()) return false;

    const validTaskIds = new Set(
      evaluationData.tasks
        .filter((task) => !task.isHistoricalEvaluation)
        .map(task => task.id),
    );
    const normalized = normalizeDrafts(taskDrafts, validTaskIds);
    setTaskDrafts(normalized);
    writeStoredDrafts(draftStorageKey, normalized);

    return Object.keys(normalized).length > 0;
  };

  const handleMethodClick = (taskId: string, method: string) => {
    if (!evaluationData) return;
    if (!ensurePeriodEditable()) return;

    updateTaskDraft(taskId, (task) => {
      if (method === '기여없음') {
        return {
          contributionMethod: '기여없음',
          contributionScope: '기여없음',
          score: 0,
        };
      }

      const nextScope = task.contributionScope === '기여없음' ? null : task.contributionScope;
      const nextScore = calculateMatrixScore(method, nextScope);
      return {
        contributionMethod: method,
        contributionScope: nextScope,
        score: nextScore,
      };
    });

    // 알림 생성 제거 - 저장 시에만 생성하도록 변경
  };

  const handleScopeClick = (taskId: string, scope: string) => {
    if (!evaluationData) return;
    if (!ensurePeriodEditable()) return;

    updateTaskDraft(taskId, (task) => {
      if (scope === '기여없음') {
        return {
          contributionMethod: '기여없음',
          contributionScope: '기여없음',
          score: 0,
        };
      }

      const nextMethod = task.contributionMethod === '기여없음' ? null : task.contributionMethod;
      const nextScore = calculateMatrixScore(nextMethod, scope);
      return {
        contributionMethod: nextMethod,
        contributionScope: scope,
        score: nextScore,
      };
    });

    // 알림 생성 제거 - 저장 시에만 생성하도록 변경
  };

  const handleTaskUpdate = async (taskId: string, updates: { title?: string; description?: string; startDate?: string; endDate?: string }) => {
    if (!evaluationData) return;
    if (!ensurePeriodEditable()) return;

    const task = evaluationData.tasks.find(t => t.id === taskId);
    if (!task) return;

    // 각 필드를 개별적으로 업데이트
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== task[key as keyof Task]) {
        await updateTask(taskId, key as keyof Task, value);
      }
    }

    // 알림 생성 제거 - 저장 시에만 생성하도록 변경
  };

  const handleFeedbackChange = (taskId: string, feedback: string) => {
    if (!ensurePeriodEditable()) return;
    updateTaskDraft(taskId, () => ({ feedback }));
  };

  const calculateTotalScoreFromTasks = (tasks: Task[]) => {
    const totalWeightedScore = tasks.reduce((sum, task) => {
      const matrixScore =
        getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ?? task.score;
      if (matrixScore !== null && matrixScore !== undefined) {
        return sum + (matrixScore * task.weight / 100);
      }
      return sum;
    }, 0);
    
    return {
      exactScore: Math.round(totalWeightedScore * 100) / 100,
      flooredScore: Math.floor(totalWeightedScore)
    };
  };

  const calculateTotalScore = () => {
    if (!evaluationData) return { exactScore: 0, flooredScore: 0 };
    return calculateTotalScoreFromTasks(
      evaluationData.tasks.filter((task) => !task.isHistoricalEvaluation),
    );
  };

  const isEvaluationComplete = () => {
    if (!evaluationData) return false;
    return evaluationData.tasks
      .filter((task) => !task.isHistoricalEvaluation)
      .every(task => task.score !== undefined && task.score !== null);
  };

  const isAchieved = () => {
    if (!evaluationData) return false;
    const { flooredScore } = calculateTotalScore();
    return flooredScore >= evaluationData.growthLevel;
  };

  const handleSave = async () => {
  // === 평가 저장 흐름 타임라인 ===
  // 1️⃣ 가중치 총합 검사
  // 2️⃣ 피드백 중복(빈/검증) 검사
  // 3️⃣ AI 중복 검사
  // 4️⃣ DB 과업 조회
  // 5️⃣ 각 과업별 업데이트 (weight, score, contribution, feedback 등)
  // 6️⃣ 평가 상태 업데이트
  // 7️⃣ 알림 생성

    if (!evaluationData || !user) return false;
    if (!ensurePeriodEditable()) return false;
    if (user.role === 'evaluator' && evaluationData.evaluatorAccess?.canEdit === false) {
      toast({
        title: '평가를 수정할 수 없습니다.',
        description:
          evaluationData.evaluatorAccess.message ??
          '이 평가 건은 다른 평가자가 작성한 이력이 있어 수정 권한이 없습니다.',
        variant: 'destructive',
      });
      return false;
    }

    try {

      const tasksToSave = getTasksWithDrafts().map((task) => {
        const matrixScore = getMatrixScore(task.contributionMethod, task.contributionScope, matrix);
        return matrixScore == null ? task : { ...task, score: matrixScore };
      });

      // 1. 가중치 검사
      const totalWeight = tasksToSave.reduce((sum, task) => sum + task.weight, 0);
      
      if (totalWeight !== 100) {
        toast({
          title: "저장 실패",
          description: `가중치 합계가 100%가 아닙니다. 현재: ${totalWeight}%\n가중치를 조정한 후 다시 저장해주세요.`,
          variant: "destructive",
        });
        return false;
      }
      
      // overrideEvaluationId가 설정되었으면 그 평가를 직접 사용 (과거 평가 편집).
      // 아니면 직원의 기본(우선순위 0) 평가를 가져옴.
      let evaluation: any = null;
      if (overrideEvaluationId) {
        evaluation = await evaluationService.getEvaluationById(overrideEvaluationId);
      } else {
        evaluation = await evaluationService.getEvaluationByEmployeeId(employeeId, {
          periodId: selectedPeriodId,
        });
      }
      if (evaluation && !evaluation.id && (evaluation as any).evaluation_id) {
        evaluation.id = (evaluation as any).evaluation_id;
      }
      if (!evaluation) throw new Error('평가 정보를 찾을 수 없습니다.');

      const dbTasks = await taskService.getTasksByEvaluationId(evaluation.id);
      const evaluatorId = getEvaluatorIdentity(user);
      const evaluatorName = user.name;
      const dbEntries = await taskEvaluationEntryService.getEntriesByEvaluationId(evaluation.id);
      const isDbEntryForCurrentEvaluator = (entry: DbTaskEvaluationEntry) =>
        entry.evaluator_id === evaluatorId ||
        (entry.evaluator_id?.startsWith('legacy:') && entry.evaluator_name === evaluatorName);
      const getCurrentDbEntry = (taskUuid: string) =>
        dbEntries.find((entry) => entry.task_uuid === taskUuid && isDbEntryForCurrentEvaluator(entry));

      // 2. 피드백 검수 — 빈 값 가드만 로컬, 의미·품질·중복은 모두 AI(reviewEvaluationFeedbacks)가 판정
      const duplicateWarnings: string[] = [];

      for (const task of tasksToSave) {
        const currentFeedback = task.feedback || '';
        const taskTitle = task.title || `과업 ${task.id}`;

        if (!currentFeedback || !currentFeedback.trim()) {
          duplicateWarnings.push(`"${taskTitle}": 피드백이 입력되지 않았습니다. 모든 과업에 대한 피드백을 작성해주세요.`);
        }
      }

      // 길이·반복 문자·문장 수 등 정형 정규식 검증은 제거하고
      // 의미·품질·중복은 reviewEvaluationFeedbacks(AI) 한 군데에서만 판정합니다.

      const existingFeedbacks = Array.from(
        new Set(
          tasksToSave
            .flatMap((task) => [
              ...(task.feedbackHistory?.map((history) => history.content) ?? []),
              ...dbEntries.map((entry) => entry.feedback ?? ''),
              dbTasks.find((dbTask) => dbTask.id === task.id)?.feedback ?? '',
            ])
            .map((feedback) => feedback.trim())
            .filter(Boolean),
        ),
      );

      const changedFeedbackItems = tasksToSave
        .map((task) => {
          const dbTask = dbTasks.find((candidate) => candidate.id === task.id);
          const currentEntry = dbTask ? getCurrentDbEntry(dbTask.id) : null;
          const currentFeedback = (task.feedback || '').trim();
          const previousFeedback = (
            currentEntry?.feedback ??
            (dbTask?.evaluator_name === evaluatorName ? dbTask?.feedback : '') ??
            ''
          ).trim();

          if (!currentFeedback || currentFeedback === previousFeedback) {
            return null;
          }

          return {
            taskId: task.id,
            taskTitle: task.title,
            feedback: currentFeedback,
            score: task.score,
            contributionMethod: task.contributionMethod,
            contributionScope: task.contributionScope,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      if (changedFeedbackItems.length > 0 && duplicateWarnings.length === 0) {
        const reviewResult = await reviewEvaluationFeedbacks(
          changedFeedbackItems,
          existingFeedbacks,
          user.name,
        );
        reviewResult.warnings.forEach((warning) => {
          const taskTitle =
            warning.taskTitle ||
            tasksToSave.find((task) => task.id === warning.taskId)?.title ||
            warning.taskId;
          duplicateWarnings.push(`"${taskTitle}": ${warning.summary}`);
        });
      }


      if (duplicateWarnings.length > 0) {
        const shouldContinue = await confirm({
          title: '성의 없는 피드백이 감지되었습니다',
          description: `${duplicateWarnings.join(' / ')}\n\n계속 저장하시겠습니까?`,
          confirmText: '계속 저장',
        });

        if (!shouldContinue) {
          return false;
        }
      } else {
        console.log('✅ 중복 피드백 없음 - 저장 진행');
      }

      const changedTasks: Array<{id: string, title: string, hasNewFeedback?: boolean, changeDetails?: string}> = [];

      // 5. 각 과업별 피드백 처리 및 업데이트
      for (const task of tasksToSave) {
        const dbTask = dbTasks.find(t => t.id === task.id);
        if (!dbTask) continue;

        const currentFeedback = task.feedback || '';
        const currentEntry = getCurrentDbEntry(dbTask.id);
        const previousFeedback =
          currentEntry?.feedback ??
          (dbTask.evaluator_name === evaluatorName ? dbTask.feedback : '') ??
          '';
        

        let hasChanges = false;
        let hasNewFeedback = false;
        let shouldCreateFeedbackHistory = false;
        const changeDetails: string[] = [];

        if ((currentEntry?.score ?? null) !== (task.score ?? null)) {
          hasChanges = true;
          changeDetails.push('점수');
        }
        if ((currentEntry?.contribution_method ?? null) !== (task.contributionMethod ?? null)) {
          hasChanges = true;
          changeDetails.push('기여방식');
        }
        if ((currentEntry?.contribution_scope ?? null) !== (task.contributionScope ?? null)) {
          hasChanges = true;
          changeDetails.push('기여범위');
        }

        // 피드백 변경 감지
        if (currentFeedback.trim() && (currentFeedback.trim() !== previousFeedback.trim() || !previousFeedback.trim())) {
          shouldCreateFeedbackHistory = true;
          hasChanges = true;
          changeDetails.push('피드백');
        } else if (currentFeedback.trim() && currentFeedback.trim() === previousFeedback.trim()) {
          console.log('⚪ 피드백 변경 없음 - 히스토리 저장 건너뜀:', {
            taskTitle: task.title,
            feedback: currentFeedback.substring(0, 50) + '...',
            reason: 'same_content'
          });
        } else if (!currentFeedback.trim()) {
          console.log('⚪ 피드백 비어있음 - 히스토리 저장 건너뜀:', {
            taskTitle: task.title,
            reason: 'empty_feedback'
          });
        }

        let savedEntry;
        try {
          savedEntry = await taskEvaluationEntryService.upsertEntry({
            task_uuid: dbTask.id,
            task_id: dbTask.task_id,
            evaluation_id: evaluation.id,
            evaluator_id: evaluatorId,
            evaluator_name: evaluatorName,
            contribution_method: task.contributionMethod ?? null,
            contribution_scope: task.contributionScope ?? null,
            score: task.score ?? null,
            feedback: currentFeedback.trim() ? currentFeedback : task.feedback ?? null,
            feedback_date: task.feedbackDate ? task.feedbackDate : new Date().toISOString(),
          });
        } catch (err) {
          console.error('❌ taskEvaluationEntryService.upsertEntry 호출 실패', {
            taskId: dbTask.id,
            error: err,
          });
          throw err;
        }

        if (shouldCreateFeedbackHistory) {
          try {
            await feedbackService.createFeedbackHistory({
              task_id: dbTask.task_id,
              task_uuid: dbTask.id,
              evaluation_id: evaluation.id,
              evaluator_id: evaluatorId,
              evaluator_name: evaluatorName,
              task_evaluation_entry_id: savedEntry?.id ?? null,
              content: currentFeedback,
            });

            hasNewFeedback = true;
          } catch (error) {
            console.error('❌ 피드백 히스토리 저장 실패:', error);
          }
        }

        if (hasChanges) {
          const taskChange = {
            id: task.id,
            title: task.title,
            hasNewFeedback,
            changeDetails: changeDetails.join(', ')
          };
          changedTasks.push(taskChange);
        } else {
          console.log('📝 변경사항 없음:', task.title);
        }
      }

      // 평가 상태 업데이트
      const isComplete = tasksToSave.every(task => task.score !== undefined && task.score !== null);
      await evaluationService.updateEvaluation(evaluation.id, {
        // Log evaluation status update payload
        evaluation_status: isComplete ? 'completed' : 'evaluating',
        last_modified: new Date().toISOString(),
      });

      setEvaluationData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: tasksToSave,
          evaluationStatus: isComplete ? 'completed' : 'evaluating',
          lastModified: new Date().toISOString()
        };
      });

      // 알림 생성
      if (user.role === 'evaluator' && changedTasks.length > 0) {
        for (const task of changedTasks) {
          if (task.changeDetails) {
            const message = `"${task.title}" 과업이 업데이트되었습니다.\n\n변경사항: ${task.changeDetails}`;

            // Find the internal DB task ID (uuid) that corresponds to the external task identifier
            const dbTaskForNotification = dbTasks.find(t => t.id === task.id);
            try {
              await addNotification({
                recipientId: employeeId,
                title: `평가 업데이트: ${task.title}`,
                message,
                type: 'task_updated',
                priority: 'medium',
                senderId: user.id,
                senderName: user.name,
                relatedEvaluationId: employeeId,
                // Use the internal task UUID for the foreign‑key reference
                relatedTaskId: dbTaskForNotification?.id
              });
            } catch (error) {
              console.error('❌ 과업별 알림 생성 실패:', error);
            }
          }
        }
      } else {
        console.log('⚠️ 알림 생성 조건 불만족:', {
          userRole: user.role,
          isEvaluator: user.role === 'evaluator',
          hasChanges: changedTasks.length > 0
        });
      }

      setTaskDrafts({});
      writeStoredDrafts(draftStorageKey, {});

      toast({
        title: "평가 저장 완료",
        description: `평가 내용이 성공적으로 저장되었습니다. ${isComplete ? '평가가 완료되었습니다.' : ''}`,
      });

      await loadEvaluationData();

       // Evaluator role no longer stores data in localStorage; server updates are handled above.
      return true;
    } catch (error) {
      console.error('❌ 평가 저장 실패:', error);
      toast({
        title: "저장 실패",
        description: "평가 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    evaluationData,
    isLoading,
    handleWeightChange,
    handleMethodClick,
    handleScopeClick,
    handleFeedbackChange,
    handleTaskUpdate,
    calculateTotalScore,
    isEvaluationComplete,
    isAchieved,
    handleSave,
    handleTemporarySave,
    getTaskWithDraft,
    hasTaskDraft,
    hasDrafts: Object.keys(taskDrafts).length > 0,
    taskDrafts,
    isPeriodEditable: isSelectedPeriodEditable,
    periodEditMessage: selectedPeriodEditMessage,
    reloadData: loadEvaluationData
  };
};
