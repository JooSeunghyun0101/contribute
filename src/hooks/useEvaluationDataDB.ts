import { useState, useEffect, useCallback, useRef } from 'react';
import { draftService } from '@/lib/services/draftService';
import { useNotifications } from '@/contexts/NotificationContextDB';
import { AppError } from '@/utils/errorHandler';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
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
  aiContentService,
} from '@/lib/services';
import { getMatrixScore, getScoreGapBucket } from '@/lib/evaluationMatrix';
import {
  reviewEvaluationFeedbacks,
  generateComprehensiveGrowthSuggestion,
  generateFeedbackSummaryForEvaluator,
  generateFeedbackSummaryForEvaluatee,
  generateFeedbackKeywords,
} from '@/lib/gptOss';

// 피드백 텍스트 해시 — AI 검수 결과가 어떤 피드백에 대한 것인지 기록(변경 추적용).
const hashText = (text: string): string => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return `${text.length}_${(h >>> 0).toString(36)}`;
};

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

// 리뷰 확정 수정: 키에 평가기간 포함 — 기간 전환 시 다른 기간의 빈 복원 결과가 같은 키로
// 기록되며 이전 기간의 draft(로컬+서버)를 지워버리던 문제 차단.
const getDraftStorageKey = (employeeId: string, evaluatorId?: string, periodId?: string | null) =>
  `evaluationDraft:${evaluatorId || 'anonymous'}:${employeeId}:${periodId || 'no-period'}`;

const sanitizeTaskDraft = (draft?: TaskDraft | null): TaskDraft | null => {
  if (!draft) return null;

  const sanitized: TaskDraft = {};
  DRAFT_FIELDS.forEach((field) => {
    const value = draft[field];
    if (value !== undefined) {
      Object.assign(sanitized, { [field]: value });
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

// 로컬 draft 복원 — 서버 draft(updated_at)와 최신 비교를 위해 savedAt 도 함께 반환한다(S2).
const readStoredDrafts = (
  storageKey: string,
  validTaskIds: Set<string>,
): { map: Record<string, TaskDraft>; savedAt: string | null } => {
  if (!storageKey || typeof window === 'undefined') return { map: {}, savedAt: null };

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { map: {}, savedAt: null };

    const parsed = JSON.parse(raw);
    const draftMap = parsed?.tasks ?? parsed;
    return {
      map: normalizeDrafts(draftMap, validTaskIds),
      savedAt: typeof parsed?.savedAt === 'string' ? parsed.savedAt : null,
    };
  } catch (error) {
    console.warn('임시저장 데이터 복원 실패:', error);
    return { map: {}, savedAt: null };
  }
};

const writeStoredDrafts = (storageKey: string, drafts: Record<string, TaskDraft>) => {
  if (!storageKey || typeof window === 'undefined') return;

  const normalized = normalizeDrafts(drafts);
  // S2: 서버 draft 도 동기화 — 기기 간 이어서 작성(빈 맵 = 서버측 삭제). 실패는 서비스가 무시.
  draftService.save(storageKey, normalized);
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
  aiFlagged: entry.ai_flagged ?? null,
  aiSummary: entry.ai_summary ?? null,
  aiType: entry.ai_type ?? null,
  aiReviewedAt: entry.ai_reviewed_at ?? null,
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
  // readOnly: 평가가 없을 때 자동 생성하지 않는다(빈 데이터 표시). 조회 전용 피평가자 화면용 —
  // 평가자 미배정 피평가자가 자기 화면을 여는 것만으로 평가자 없는 draft 평가가 생기던 버그(write-on-read) 차단.
  options?: { evaluationId?: string | null; readOnly?: boolean },
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
  const readOnly = options?.readOnly ?? false;
  const selectedPeriodStatus = selectedPeriod?.status;
  const selectedPeriodYear = selectedPeriod?.evaluation_year;
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const currentEvaluatorId = getEvaluatorIdentity(user);
  const draftStorageKey = getDraftStorageKey(
    overrideEvaluationId ? `${employeeId}#${overrideEvaluationId}` : employeeId,
    currentEvaluatorId,
    selectedPeriodId,
  );
  // 리뷰 확정 수정(S2 레이스): '이 키의 draft 복원이 완료된 뒤'에만 자동저장·플러시를 무장한다.
  // 없으면 로드(순차 API 다수)가 디바운스 800ms 보다 늦을 때 빈 맵이 기록되어
  // 로컬+서버 draft 가 복원 전에 삭제된다(기기 간 이어쓰기 파괴).
  const draftsRestoredKeyRef = useRef<string | null>(null);

  const [evaluationData, setEvaluationData] = useState<EvaluationData | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  // S3: 저장 후 백그라운드 AI 검수가 도는 동안 true — 저장 버튼이 'AI 검토 중…' 상태를
  // 검수가 실제로 끝날 때까지 유지하는 데 쓴다(저장이 즉시 끝나 검수 사실을 모르는 문제).
  const [isAiReviewing, setIsAiReviewing] = useState(false);
  // 리뷰 확정 수정: S4 이전/다음 이동은 같은 라우트에서 id 만 바뀌어 훅 state 가 유지된다 —
  // 이전 피평가자의 검수가 끝날 때까지 다음 피평가자의 저장 버튼이 잠기지 않게 전환 시 리셋.
  // (백그라운드 검수 자체는 계속 돌고, 완료 시 토스트·벨 알림으로 결과가 전달된다.)
  // 토큰: 구 검수의 finally 가 새 검수/새 화면의 표시 상태를 풀어버리지 않게 최신 검수만 해제.
  const aiReviewTokenRef = useRef(0);
  useEffect(() => {
    aiReviewTokenRef.current += 1;
    setIsAiReviewing(false);
  }, [employeeId, overrideEvaluationId]);

  // F-2: 미저장 편집(taskDrafts) 유실 방지 — 편집 컨텍스트(!readOnly)에서만 동작.
  // 서버/AI검수와 무관하게 localStorage 로만 영속(setState 미사용 → 렌더 루프 없음).
  const taskDraftsRef = useRef(taskDrafts);
  taskDraftsRef.current = taskDrafts;

  // ① 편집이 멈추면 디바운스로 드래프트를 localStorage 에 자동 영속('임시저장' 수동 클릭 불필요).
  //    key·snapshot 을 effect 진입 시점에 캡처하고 draftStorageKey 를 deps 에서 제외한다 →
  //    컨텍스트 전환(employeeId/evaluationId 변경)으로 key 가 바뀌어도 '이전 컨텍스트의 드래프트를
  //    새 key 로 잘못 기록'하는 레이스 차단(직전 타이머는 직전 key·snapshot 으로만 기록). 전환 후
  //    load 가 taskDrafts 를 갱신하면 그때 새 key·snapshot 으로 재무장된다.
  useEffect(() => {
    // 복원 완료 전에는 기록하지 않는다(리뷰 확정 수정 — 빈 맵이 저장본을 지우는 레이스 차단).
    if (readOnly || !draftStorageKey || draftsRestoredKeyRef.current !== draftStorageKey) return;
    const key = draftStorageKey;
    const snapshot = taskDrafts;
    const timer = setTimeout(() => writeStoredDrafts(key, snapshot), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskDrafts, readOnly]);

  // ② 미저장 편집이 있는 채로 새로고침/탭닫기 → 경고 + 종료 직전 동기 플러시.
  //    SPA 페이지 이동(언마운트) 시에도 드래프트를 보존한다.
  useEffect(() => {
    if (readOnly || !draftStorageKey) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(taskDraftsRef.current).length === 0) return;
      if (draftsRestoredKeyRef.current !== draftStorageKey) return; // 복원 전 기록 금지
      writeStoredDrafts(draftStorageKey, taskDraftsRef.current);
      // S2: 언로드 중 일반 fetch(PUT) 는 중단될 수 있어 keepalive 로 서버 플러시를 보장.
      draftService.flush(draftStorageKey, normalizeDrafts(taskDraftsRef.current));
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (
        Object.keys(taskDraftsRef.current).length > 0 &&
        draftsRestoredKeyRef.current === draftStorageKey
      ) {
        writeStoredDrafts(draftStorageKey, taskDraftsRef.current);
      }
    };
  }, [draftStorageKey, readOnly]);

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
  // 로딩 경합 가드: 기간/사번이 바뀌어 새 로드가 시작되면 이전(stale) 로드의 커밋을 무시한다.
  const loadSeqRef = useRef(0);
  const loadEvaluationData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const isStale = () => loadSeqRef.current !== seq;
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
          // ★ 보안: 평가자가 override 없이 상단 평가기간을 바꿔 같은 피평가자를 다시 열면,
          // primary 평가가 '그 기간의 현재(후임) 평가자' 평가로 잡혀(getEvaluationByEmployeeId 는
          // 피평가자의 현재 evaluator_id 와 일치하는 평가를 우선 선택) 후임 평가자의 점수·피드백이
          // 노출되던 치명적 문제. 평가자는 '본인이 (현재) 배정된 평가'만 primary 로 본다.
          // (이동 모델: 평가자별로 평가 레코드가 분리되므로 evaluatorId 스코프가 정확.)
          const scopedEvaluatorId =
            user?.role === 'evaluator' ? currentEvaluatorId || undefined : undefined;
          evaluation = await evaluationService.getEvaluationByEmployeeId(employeeId, {
            periodId: selectedPeriodId,
            evaluatorId: scopedEvaluatorId,
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
          // ★ 보안/무결성: 평가자가 본인 담당(배정) 평가가 없는 기간을 열람하면(위 evaluatorId
          // 스코프 결과 null) 평가를 '생성'하지 않고 권한 없음 빈 화면을 보여준다. former 평가자가
          // 상단 기간 전환으로 후임 평가를 들여다보던 케이스 + 평가자 write-on-read 를 동시 차단.
          if (user?.role === 'evaluator' && !overrideEvaluationId) {
            const viewer = await employeeService.getEmployeeById(employeeId);
            setEvaluationData(
              viewer
                ? {
                    ...buildEmptyEvaluationData(viewer),
                    evaluatorAccess: {
                      ...buildEmptyEvaluationData(viewer).evaluatorAccess,
                      currentEvaluatorId: currentEvaluatorId || null,
                      message: '이 평가기간에는 이 피평가자에 대한 평가 권한이 없습니다.',
                    },
                  }
                : null,
            );
            setTaskDrafts({});
            writeStoredDrafts(draftStorageKey, {});
            setIsLoading(false);
            return;
          }
          const employee = await employeeService.getEmployeeById(employeeId);
          if (employee) {
            // 조회 전용(readOnly)이거나 마감/잠금 기간이면 생성하지 않고 빈 데이터로 표시한다.
            if (readOnly || selectedPeriodStatus === 'closed' || selectedPeriodStatus === 'locked') {
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
         // 피평가자 표시정보(이름·직책·부서)는 최신 직원 데이터로 갱신.
         // ★ growth_level 은 덮지 않는다 — 성장레벨은 '그 평가기간 스냅샷'(evaluation.growth_level)이라,
         //   employee 의 현재(공유) 레벨로 덮으면 지난 기간 화면에 다른 연도 레벨이 떠 달성 판정이 틀어진다.
         evaluation = {
           ...evaluation,
           evaluatee_name: emp.name,
           evaluatee_position: emp.position,
           evaluatee_department: emp.department,
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
      tasks = tasks.filter((t) => !t.deleted_at);
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

      let historicalTasks: typeof tasks = [];
      let historicalTaskEvaluationEntries: TaskEvaluationEntry[] = [];
      // 특정 evaluationId를 지정해서 열었으면 다른 evaluation의 이력은 불러오지 않음.
      // (예: 평가자가 자기 과거 평가를 열면 그 평가에 속한 task/entry만 노출)
      // S1: 피평가자 본인 조회 화면(/my 대시보드·/my/feedback, readOnly)도 병합 — 발령자는
      // 같은 기간 평가가 여러 개(정상 보존)라 이전 평가자의 과업·피드백이 통째로 안 보였다.
      // 편집 화면(내 과업 카드)은 evaluationId 지정 경로라 영향 없음.
      if (
        (user?.role === 'evaluator' || (user?.role === 'evaluatee' && readOnly)) &&
        !overrideEvaluationId
      ) {
        try {
          const evaluations = await evaluationService.getEvaluationsByEmployeeId(employeeId, {
            periodId: selectedPeriodId,
          });
          // 현재(열람 중인) 평가의 평가자 배정일. 목록 응답의 evaluator_assigned_at(배정 이력
          // changed_at)을 단일 기준으로 쓴다(평가 created_at 은 벌크 적재로 동일할 수 있어 부적합).
          const assignedAt = (item: { evaluator_assigned_at?: string | null }) =>
            item.evaluator_assigned_at ? new Date(item.evaluator_assigned_at).getTime() : null;
          const currentInList = evaluations.find((item) => item.id === evaluation.id) as
            | { evaluator_assigned_at?: string | null }
            | undefined;
          const currentAssignedAt =
            assignedAt(currentInList ?? {}) ?? assignedAt(evaluation as { evaluator_assigned_at?: string | null });
          // 본인 평가 '이후'에 배정된 평가자(예: 발령 후임)의 평가는 제외 — 자기 평가 시점
          // 이후의 후임 평가가 과거 이력으로 섞여 보이던 문제. 이전(선임) 평가자 이력은 유지.
          const previousEvaluations = evaluations.filter((item) => {
            if (!item.id || item.id === evaluation.id) return false;
            // 같은 평가기간(이동)만 '이전 평가'로 노출 — 직전연도 등 다른 기간 평가가
            // 섞여 "이전 평가자"로 잘못 보이지 않게 한다(기간 격리). 서버 기간필터에만
            // 의존하지 않고 클라이언트에서도 명시적으로 같은 기간을 강제.
            const samePeriod = item.evaluation_period_id
              ? item.evaluation_period_id === evaluation.evaluation_period_id
              : item.evaluation_year === evaluation.evaluation_year;
            if (!samePeriod) return false;
            const itemAt = assignedAt(item as { evaluator_assigned_at?: string | null });
            if (currentAssignedAt != null && itemAt != null && itemAt > currentAssignedAt) return false;
            return true;
          });

          for (const previousEvaluation of previousEvaluations) {
            const previousTasks = await taskService.getTasksByEvaluationId(previousEvaluation.id);
            historicalTasks.push(
              ...previousTasks
                .filter((task) => !task.deleted_at)
                .map((task) => ({
                  ...task,
                  isHistoricalEvaluation: true,
                  sourceEvaluationId: previousEvaluation.id,
                  // 이전 평가의 평가자명 — 피평가자 화면 '이전 평가' 배지 표기용.
                  sourceEvaluatorName:
                    (previousEvaluation as { evaluator_name?: string | null }).evaluator_name ?? null,
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

      tasks = tasks.map((task) => ({
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

      const getEntriesForTask = (task: Task) => {
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
      // 이전(과거) 평가자 = 본인이 이 평가의 (현재 또는 과거) 담당 평가자였거나 본인 entry 가
      // 있는 경우만. ★ 다른 평가자의 entry 존재만으로는 '이전 평가자'가 아니다(권한 없음).
      const isFormerEvaluator =
        user?.role === 'evaluator' &&
        !isCurrentAssignedEvaluator &&
        (isEvaluatorOfThisEvaluation || hasOwnEvaluationEntries);
      const canEditAsEvaluator =
        user?.role !== 'evaluator' ||
        Boolean(hasOwnEvaluationEntries) ||
        Boolean(isCurrentAssignedEvaluator) ||
        Boolean(isEvaluatorOfThisEvaluation);

      // ★ 보안 게이트: 평가자는 '이 평가와 실제 관계가 있을 때만' 열람할 수 있다.
      // 본인이 이 평가의 (현/과거) 담당 평가자이거나 본인 entry 가 있어야 한다. 다른 평가자
      // entry 가 있다는 이유만으로는 열람 권한이 생기지 않는다. (상단 평가기간을 바꿔
      // 권한 없는 기간의 같은 피평가자 평가를 들여다보면 타 평가자의 점수·피드백이 유출되던
      // 치명적 문제 차단.) 차단 시 과업·entry 를 일절 노출하지 않는다.
      const canViewAsEvaluator =
        user?.role !== 'evaluator' ||
        isCurrentAssignedEvaluator ||
        isEvaluatorOfThisEvaluation ||
        hasOwnEvaluationEntries;
      if (!canViewAsEvaluator) {
        if (isStale()) return;
        setEvaluationData({
          id: evaluation.id,
          evaluatorId: (evaluation as any).evaluator_id ?? null,
          evaluatorName: (evaluation as any).evaluator_name ?? null,
          evaluatorAssignedAt: (evaluation as any).evaluator_assigned_at ?? null,
          submittedAt: (evaluation as any).submitted_at ?? null,
          evaluateeId: evaluation.evaluatee_id,
          evaluateeName: evaluation.evaluatee_name,
          evaluateePosition: evaluation.evaluatee_position,
          evaluateeDepartment: evaluation.evaluatee_department,
          growthLevel: evaluation.growth_level && evaluation.growth_level > 0 ? evaluation.growth_level : 1,
          evaluationStatus: evaluation.evaluation_status,
          evaluation_period_id: evaluation.evaluation_period_id,
          lastModified: evaluation.last_modified,
          evaluatorAccess: {
            assignedEvaluatorId: loadedEmployee?.evaluator_id ?? null,
            currentEvaluatorId: currentEvaluatorId || null,
            canEdit: false,
            isCurrentAssignedEvaluator: false,
            isFormerEvaluator: false,
            hasOtherEvaluatorEntries,
            message: '이 평가기간에는 이 피평가자에 대한 평가 권한이 없습니다.',
          },
          tasks: [],
        });
        setIsLoading(false);
        return;
      }

      const evaluatorAccessMessage =
        user?.role === 'evaluator' && !canEditAsEvaluator
          ? '현재 이 평가를 수정할 수 있는 담당자가 아닙니다.'
          : undefined;

      // 5. 각 과업의 피드백 히스토리 — N+1 제거: 과업당 조회 대신 피평가자 단위 1회 일괄 조회 후 task_id 그룹.
      const feedbackByTask = new Map<string, any[]>();
      try {
        for (const fh of await feedbackService.getFeedbackHistoryByEmployeeId(employeeId)) {
          const arr = feedbackByTask.get(fh.task_id);
          if (arr) arr.push(fh);
          else feedbackByTask.set(fh.task_id, [fh]);
        }
      } catch (error) {
        console.error('❌ 피평가자 대시보드 - 피드백 히스토리 일괄 조회 실패:', error);
      }

      const tasksWithHistory = tasks.map((task) => {
          const feedbackHistory = feedbackByTask.get(task.task_id) ?? [];

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
          // (정정으로 평가자였지만 본인이 직접 점수를 입력하지 않은 케이스 —
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
            sourceEvaluationId: (task as { sourceEvaluationId?: string }).sourceEvaluationId || task.evaluation_id || evaluation.id,
            isHistoricalEvaluation: Boolean((task as { isHistoricalEvaluation?: boolean }).isHistoricalEvaluation),
            sourceEvaluatorName:
              (task as { sourceEvaluatorName?: string | null }).sourceEvaluatorName ?? null,
            title: task.title,
            description: task.description || '',
            weight: task.weight,
            isAiTask: task.is_ai_task ?? false,
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
        });

      // 6. EvaluationData 형태로 변환
      const evaluationDataResult: EvaluationData = {
        // Include the evaluation UUID for downstream usage (e.g., notifications)
        id: evaluation.id,
        evaluatorId: (evaluation as any).evaluator_id ?? null,
        evaluatorName: (evaluation as any).evaluator_name ?? null,
        evaluatorAssignedAt: (evaluation as any).evaluator_assigned_at ?? null,
        submittedAt: (evaluation as any).submitted_at ?? null,
        evaluateeId: evaluation.evaluatee_id,
        evaluateeName: evaluation.evaluatee_name,
        evaluateePosition: evaluation.evaluatee_position,
        evaluateeDepartment: evaluation.evaluatee_department,
        // Ensure growth level is at least 1 (fallback if 0 or undefined)
        growthLevel: evaluation.growth_level && evaluation.growth_level > 0 ? evaluation.growth_level : 1,
        evaluationStatus: evaluation.evaluation_status,
        evaluation_period_id: evaluation.evaluation_period_id,
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

      if (isStale()) return;
      setEvaluationData(evaluationDataResult);

      const validTaskIds = new Set(tasksWithHistory.map(task => task.id));
      // S2: 로컬(localStorage)과 서버 draft 중 '더 최신'을 복원 — 다른 기기에서 쓰던 임시저장을
      // 이어서 작성. 조회 전용 화면은 편집이 없으므로 서버 조회를 생략한다. 서버 실패 시 로컬만.
      const localDrafts = readStoredDrafts(draftStorageKey, validTaskIds);
      let restoredDrafts = localDrafts.map;
      if (!readOnly) {
        const remote = await draftService.get(draftStorageKey);
        if (remote?.payload) {
          const remoteMap = normalizeDrafts(
            remote.payload as Record<string, TaskDraft>,
            validTaskIds,
          );
          const remoteNewer =
            !localDrafts.savedAt ||
            new Date(remote.updated_at).getTime() > new Date(localDrafts.savedAt).getTime();
          if (remoteNewer && Object.keys(remoteMap).length > 0) restoredDrafts = remoteMap;
        }
        if (isStale()) return;
      }
      // 복원 완료 표시 — 이 시점부터 이 키의 자동저장·플러시가 무장된다(리뷰 확정 수정).
      draftsRestoredKeyRef.current = draftStorageKey;
      setTaskDrafts(restoredDrafts);

      
    } catch (error) {
      console.error('❌ 평가 데이터 로드 실패:', error);
      toast({
        title: "데이터 로드 실패",
        description: "평가 데이터를 불러오는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      // stale 로드는 로딩 플래그를 건드리지 않는다(최신 로드가 소유).
      if (!isStale()) setIsLoading(false);
    }
  }, [
    draftStorageKey,
    employeeId,
    overrideEvaluationId,
    selectedPeriodStatus,
    readOnly,
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

  const getTaskWithDraft = useCallback(
    (task: Task) => applyTaskDraft(task, taskDrafts[task.id]),
    [taskDrafts],
  );

  const hasTaskDraft = useCallback(
    (taskId: string) => Boolean(sanitizeTaskDraft(taskDrafts[taskId])),
    [taskDrafts],
  );

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
      if (method === '기여미흡') {
        return {
          contributionMethod: '기여미흡',
          contributionScope: '기여미흡',
          score: 0,
        };
      }

      const nextScope = task.contributionScope === '기여미흡' ? null : task.contributionScope;
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
      if (scope === '기여미흡') {
        return {
          contributionMethod: '기여미흡',
          contributionScope: '기여미흡',
          score: 0,
        };
      }

      const nextMethod = task.contributionMethod === '기여미흡' ? null : task.contributionMethod;
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
      // float 누적 오차(예: 3.0 이 2.9999999…로) 때문에 Math.floor 가 한 단계 낮아져
      // '3.0인데 미달성'이 되던 문제 방지 — 아주 작은 epsilon 을 더해 경계를 보정한다.
      flooredScore: Math.floor(totalWeightedScore + 1e-9)
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
          description: `가중치 합계가 100%가 아닙니다. 현재: ${totalWeight}%\n가중치는 피평가자가 수정하는 값입니다 — '피평가자에게 돌려보내기'로 조정을 요청하세요.`,
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
        // 로드 경로와 동일하게 평가자는 '본인 배정 평가'로 스코프 — 저장 대상이 화면에 표시된
        // 평가와 어긋나(예: 후임 평가자 레코드) 다른 평가에 점수가 기록되는 오염을 방지.
        const scopedEvaluatorId =
          user?.role === 'evaluator' ? getEvaluatorIdentity(user) || undefined : undefined;
        evaluation = await evaluationService.getEvaluationByEmployeeId(employeeId, {
          periodId: selectedPeriodId,
          evaluatorId: scopedEvaluatorId,
        });
      }
      if (evaluation && !evaluation.id && (evaluation as any).evaluation_id) {
        evaluation.id = (evaluation as any).evaluation_id;
      }
      if (!evaluation) throw new Error('평가 정보를 찾을 수 없습니다.');

      // 소프트 삭제 과업 제외 — 돌려보내기 후 피평가자가 과업을 삭제한 사이 stale 탭이 저장해도
      // 삭제 과업에 유령 entry 가 남지 않게 한다(서버도 409로 차단하지만 여기서 선제 제외).
      const dbTasks = (await taskService.getTasksByEvaluationId(evaluation.id)).filter((t) => !t.deleted_at);
      const evaluatorId = getEvaluatorIdentity(user);
      const evaluatorName = user.name;
      const dbEntries = await taskEvaluationEntryService.getEntriesByEvaluationId(evaluation.id);
      const isDbEntryForCurrentEvaluator = (entry: DbTaskEvaluationEntry) =>
        entry.evaluator_id === evaluatorId ||
        (entry.evaluator_id?.startsWith('legacy:') && entry.evaluator_name === evaluatorName);
      const getCurrentDbEntry = (taskUuid: string) =>
        dbEntries.find((entry) => entry.task_uuid === taskUuid && isDbEntryForCurrentEvaluator(entry));

      // 2-1. 빈 피드백 = 하드 블록(저장 불가). 모든 과업에 피드백이 있어야 한다.
      const emptyTitles = tasksToSave
        .filter((task) => !(task.feedback || '').trim())
        .map((task) => task.title || `과업 ${task.id}`);
      if (emptyTitles.length > 0) {
        toast({
          title: '피드백을 모두 작성해 주세요',
          description: `다음 과업에 피드백이 없어 저장할 수 없습니다: ${emptyTitles.join(', ')}`,
          variant: 'destructive',
        });
        return false;
      }

      // 2-2. AI 검수 대상 수집(구체성·성의·복붙·점수논조) — 검수 자체는 저장을 막지 않도록
      // 저장 '후' 백그라운드로 수행한다(S3). 여기서는 대상 항목만 계산해 둔다.
      const growthLevel = evaluationData.growthLevel;
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

          // 변경됐거나, '아직 한 번도 검수되지 않은'(ai_reviewed_at 없음) 피드백은 검수 대상에 포함한다.
          // → 저장됐는데 검수 안 된 항목이 '통과'인지 '미저장'인지 구별 안 되던 문제 해소(저장 후 항상 판정).
          const neverReviewed = !currentEntry?.ai_reviewed_at;
          if (!currentFeedback || (currentFeedback === previousFeedback && !neverReviewed)) {
            return null;
          }

          return {
            taskId: task.id,
            taskTitle: task.title,
            feedback: currentFeedback,
            score: task.score,
            gapBucket:
              task.score != null && growthLevel > 0 ? getScoreGapBucket(task.score, growthLevel) : undefined,
            contributionMethod: task.contributionMethod,
            contributionScope: task.contributionScope,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const changedTasks: Array<{id: string, title: string, hasNewFeedback?: boolean, changeDetails?: string}> = [];
      // S3: 과업당 순차 요청(entry upsert N + 피드백 히스토리 M + 알림 L) 대신
      // 일괄 저장 페이로드를 만들어 한 요청으로 보낸다(서버가 한 트랜잭션으로 처리).
      const bulkEntries: Parameters<typeof taskEvaluationEntryService.bulkSave>[0]['entries'] = [];

      // 5. 각 과업별 변경 감지 및 일괄 저장 항목 구성
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
        }

        bulkEntries.push({
          task_uuid: dbTask.id,
          task_id: dbTask.task_id,
          contribution_method: task.contributionMethod ?? null,
          contribution_scope: task.contributionScope ?? null,
          score: task.score ?? null,
          feedback: currentFeedback.trim() ? currentFeedback : task.feedback ?? null,
          feedback_date: task.feedbackDate ? task.feedbackDate : new Date().toISOString(),
          create_feedback_history: shouldCreateFeedbackHistory,
          // 변경 요약이 있으면 서버가 피평가자 알림을 발송(기존 클라이언트 발송 이관).
          notify_change_details:
            user.role === 'evaluator' && hasChanges ? changeDetails.join(', ') : undefined,
        });

        if (hasChanges) {
          changedTasks.push({
            id: task.id,
            title: task.title,
            hasNewFeedback: shouldCreateFeedbackHistory,
            changeDetails: changeDetails.join(', '),
          });
        }
      }

      // 평가 상태 업데이트 — 완료 판정은 화면(stale 가능) 목록이 아니라 방금 조회한 살아있는 DB 과업 기준.
      // 돌려보내기 후 피평가자가 과업을 추가한 사이 stale 탭이 저장해도, 미채점 신규 과업이 있으면
      // 'completed'로 확정되지 않는다.
      const screenTaskIds = new Set(tasksToSave.map((task) => task.id));
      const tasksAddedAfterLoad = dbTasks.filter((t) => !screenTaskIds.has(t.id));
      const tasksRemovedAfterLoad = tasksToSave.filter((task) => !dbTasks.some((t) => t.id === task.id));
      // 살아있는 과업 0건이면 [].every()=true(공진리)로 '과업 없는 완료'가 확정되므로 명시적으로 미완료 처리.
      // 화면에 있는 과업은 방금 upsert 한 화면 값이 곧 최종값 — 점수를 지운 과업이 예전 DB entry 로
      // '채점됨' 판정되지 않도록, DB entry 폴백은 화면에 없던 과업에만 적용한다.
      const isComplete =
        dbTasks.length > 0 &&
        dbTasks.every((t) => {
          const draft = tasksToSave.find((task) => task.id === t.id);
          if (draft) return draft.score !== undefined && draft.score !== null;
          return getCurrentDbEntry(t.id)?.score != null;
        });
      if (tasksAddedAfterLoad.length > 0 || tasksRemovedAfterLoad.length > 0) {
        const parts = [
          tasksAddedAfterLoad.length > 0 ? `새 과업 ${tasksAddedAfterLoad.length}건 등록됨` : null,
          tasksRemovedAfterLoad.length > 0 ? `화면의 과업 ${tasksRemovedAfterLoad.length}건 삭제됨` : null,
        ].filter(Boolean);
        toast({
          title: '피평가자가 과업을 변경했습니다',
          description: `${parts.join(' · ')}. 저장 후 갱신된 목록을 확인하고 새 과업을 채점해 주세요.`,
        });
      }
      // S3: 일괄 저장 — entry(N)+피드백 히스토리+평가상태+알림을 한 요청·한 트랜잭션으로.
      // 실패 시 전체 롤백(기존 순차 흐름의 '일부 과업만 저장' 비원자성도 함께 제거).
      const bulkResult = await taskEvaluationEntryService.bulkSave({
        evaluation_id: evaluation.id,
        evaluation_status: isComplete ? 'completed' : 'evaluating',
        // S7 낙관적 잠금: 이 화면이 '로드했던 시점'의 last_modified 를 보낸다(방금 재조회한
        // evaluation 이 아니라 화면 상태 기준 — stale 탭이면 서버가 409 로 거부).
        expected_last_modified: evaluationData.lastModified ?? null,
        entries: bulkEntries,
      });
      const entryIdByTask = new Map<string, string>(); // task.id(=task_uuid) → entry id (AI 검수 기록용)
      bulkResult.entries.forEach((entry) => entryIdByTask.set(entry.task_uuid, entry.id));

      setEvaluationData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: tasksToSave,
          evaluationStatus: isComplete ? 'completed' : 'evaluating',
          // S7: 다음 저장의 낙관적 잠금 기준은 서버가 방금 기록한 값(클라 시계 아님).
          lastModified: bulkResult.last_modified ?? new Date().toISOString()
        };
      });

      // S3: AI 검수(구체성·성의·복붙·점수논조)는 저장을 막지 않는다 — 저장 완료 후 백그라운드로
      // 수행해 항목별 ai_* 컬럼에 기록(경고 없으면 flagged=false '이상없음')하고, 경고가 있으면
      // 토스트로 알린다. 수정 후 다시 저장하면 재검수된다. (기존: 저장 전 동기 대기 + confirm —
      // AI 응답이 늦으면 저장 버튼이 수십 초 잠기던 문제 해소.)
      // ※ 알림 발송은 일괄 저장 서버 트랜잭션으로 이관됨(notify_change_details).
      if (changedFeedbackItems.length > 0) {
        const reviewEvaluatorName = user.name;
        const reviewToken = ++aiReviewTokenRef.current;
        setIsAiReviewing(true);
        void (async () => {
          try {
            // 복붙 비교 대상: (a) 같은 평가자가 그 기간 다른 피평가자에게 쓴 피드백 +
            // (b) 이 피평가자의 다른 과업 피드백(변경 항목 제외). 둘 다와 비교해 복붙을 잡는다.
            const otherEvaluateeFeedbacks = await taskEvaluationEntryService
              .getEvaluatorFeedbacks(evaluatorId, selectedPeriodId, evaluation.id)
              .catch(() => [] as string[]);
            const changedTaskIds = new Set(changedFeedbackItems.map((item) => item.taskId));
            const sameEvaluateeOtherFeedbacks = tasksToSave
              .filter((task) => !changedTaskIds.has(task.id) && (task.feedback || '').trim())
              .map((task) => (task.feedback || '').trim());
            const existingFeedbacks = Array.from(
              new Set([...otherEvaluateeFeedbacks, ...sameEvaluateeOtherFeedbacks]),
            );

            const reviewResult = await reviewEvaluationFeedbacks(
              changedFeedbackItems,
              existingFeedbacks,
              reviewEvaluatorName,
            );
            if (reviewResult.skipped) return;

            const aiWarningByTaskId = new Map<string, { type?: string; summary: string }>();
            reviewResult.warnings.forEach((warning) => {
              aiWarningByTaskId.set(warning.taskId, { type: warning.type, summary: warning.summary });
            });
            await Promise.all(
              changedFeedbackItems.map(async (item) => {
                const entryId = entryIdByTask.get(item.taskId);
                if (!entryId) return;
                const w = aiWarningByTaskId.get(item.taskId);
                try {
                  await taskEvaluationEntryService.setAiReview(entryId, {
                    flagged: !!w,
                    type: w?.type ?? null,
                    summary: w?.summary ?? null,
                    feedbackHash: hashText(item.feedback),
                  });
                } catch (e) {
                  console.warn('AI 검수 결과 저장 실패:', e);
                }
              }),
            );

            if (reviewResult.warnings.length > 0) {
              const lines = reviewResult.warnings.map((warning) => {
                const taskTitle =
                  warning.taskTitle ||
                  tasksToSave.find((task) => task.id === warning.taskId)?.title ||
                  warning.taskId;
                return `· ${taskTitle}${warning.type ? ` — ${warning.type}` : ''}: ${warning.summary}`;
              });
              toast({
                title: `AI 검수: 확인이 필요한 피드백 ${reviewResult.warnings.length}건`,
                description: `저장은 완료되었습니다. 아래 항목을 확인하고 수정 후 다시 저장하면 재검수됩니다.\n\n${lines.join('\n')}`,
              });
              // 토스트는 잠깐 떴다 사라져 자리를 비웠으면 놓친다 — 벨 알림(영속)으로도 남긴다.
              // 수신자=평가자 본인. 알림 메시지는 서버에서 개행이 공백으로 치환되므로 한 줄로 요약.
              const summaryLine = reviewResult.warnings
                .map((warning) => {
                  const taskTitle =
                    warning.taskTitle ||
                    tasksToSave.find((task) => task.id === warning.taskId)?.title ||
                    warning.taskId;
                  return `${taskTitle}${warning.type ? `(${warning.type})` : ''}`;
                })
                .join(', ');
              try {
                await addNotification({
                  recipientId: evaluatorId,
                  type: 'ai_review_flagged',
                  title: `AI 검수: ${evaluation.evaluatee_name ?? '피평가자'} 피드백 ${reviewResult.warnings.length}건 확인 필요`,
                  message: `${evaluation.evaluatee_name ?? '피평가자'}님 평가에서 확인이 필요한 피드백: ${summaryLine}. 수정 후 다시 저장하면 재검수됩니다.`,
                  priority: 'medium',
                  senderId: evaluatorId,
                  senderName: 'AI 검수',
                  relatedEvaluationId: evaluation.id,
                });
              } catch (e) {
                console.warn('AI 검수 알림 발송 실패:', e);
              }
            } else {
              // 통과도 완료 신호를 준다 — 버튼이 'AI 검토 중…'을 보여주다 끝났는데 아무 표시가
              // 없으면 검수가 됐는지 알 수 없다. 경고와 달리 벨 알림 없이 토스트만(소음 방지).
              toast({
                title: 'AI 검수 통과',
                description: `피드백 ${changedFeedbackItems.length}건 모두 이상 없음으로 기록했습니다.`,
              });
            }
          } catch (e) {
            console.warn('AI 검수 백그라운드 실행 실패:', e);
          } finally {
            if (aiReviewTokenRef.current === reviewToken) setIsAiReviewing(false);
          }
        })();
      }

      setTaskDrafts({});
      writeStoredDrafts(draftStorageKey, {});

      toast({
        title: "평가 저장 완료",
        description: `평가 내용이 성공적으로 저장되었습니다. ${isComplete ? '평가가 완료되었습니다.' : ''}${
          changedFeedbackItems.length > 0
            ? ' AI 검수가 백그라운드에서 진행 중입니다 — 다른 화면으로 이동해도 되며, 결과는 알림으로 알려드립니다.'
            : ''
        }`,
      });

      await loadEvaluationData();

      // 저장 시점 자동 AI 생성(영속) — 조회 시 재호출 없이 그대로 표시(토큰 절약·표현 일관).
      // ⚠ 반드시 화면 리로드(loadEvaluationData) '이후'에, '순차(직렬)'로 호출한다(동시연결 점유 방지).
      //   그리고 'isComplete(모든 과업 채점 = 완료 저장)' 일 때만 돌린다 — 중간(작성중) 저장마다 3콜씩
      //   나가면 GitHub Models 무료티어 분당 한도를 쳐 429가 잦아진다. 완료 저장에서만 생성해 호출을 최소화.
      if (user.role === 'evaluator' && isComplete) {
        const evaluateeId = employeeId;
        const periodId = selectedPeriodId ?? null;
        const evaluateeName = evaluationData?.evaluateeName || '';
        const tasksSnapshot = tasksToSave;
        const anyTaskChanged = changedTasks.length > 0;       // 점수/방식/범위/피드백 등 무엇이든 변경됨
        const anyFeedbackChanged = changedFeedbackItems.length > 0;
        void (async () => {
          if (!periodId || !evaluateeId) return;

          // 생성 트리거 = '이번에 바뀌었거나' 또는 '아직 생성된 적이 없을 때'.
          // 업로드/일괄적재로 등록된 평가는 점수·피드백이 이미 있어 세션 내 '변경'이 없으므로,
          // 변경만 기준으로 하면 평가완료해도 AI가 안 생긴다. 그래서 '없으면 생성'을 함께 둬,
          // 평가자가 평가완료(저장)하면 누락된 성장제안·요약·키워드가 채워지도록 한다(이미 있으면 건너뜀=토큰 절약).
          const growthScope = `${evaluateeId}:${periodId}`;
          const evaluatorSummaryScope = `${evaluatorId}:${evaluateeId}:${periodId}`;
          const evaluateeSummaryScope = `${evaluateeId}:${periodId}`;
          const evaluatorKeywordsScope = `${evaluatorId}:${evaluateeId}:${periodId}`;
          const evaluateeKeywordsScope = `${evaluateeId}:${periodId}`;

          const [haveGrowth, haveEvaluatorSummary, haveEvaluateeSummary, haveEvaluatorKeywords, haveEvaluateeKeywords] =
            await Promise.all([
              aiContentService.get('evaluatee_growth_suggestion', growthScope),
              aiContentService.get('evaluator_feedback_summary', evaluatorSummaryScope),
              aiContentService.get('evaluatee_feedback_summary', evaluateeSummaryScope),
              aiContentService.get('evaluator_feedback_keywords', evaluatorKeywordsScope),
              aiContentService.get('evaluatee_feedback_keywords', evaluateeKeywordsScope),
            ]);

          // 4개 생성 호출을 연달아 쏘면 무료티어 분당 한도를 쳐 뒤쪽 호출(특히 키워드)이 조용히 실패한다.
          // 각 호출 자체도 백오프 재시도하지만, 호출 사이에 간격을 둬 분당 한도 압박을 줄인다.
          const AI_GEN_GAP_MS = 1500;
          let prevRan = false; // 직전 생성 호출이 실제로 나갔으면 다음 호출 전 간격을 둔다.
          const spaceOut = async () => {
            if (prevRan) await new Promise((resolve) => window.setTimeout(resolve, AI_GEN_GAP_MS));
          };

          const feedbackInputs = tasksSnapshot
            .filter((t) => (t.feedback || '').trim())
            .map((t) => ({ taskTitle: t.title, content: (t.feedback || '').trim(), score: t.score ?? null }));
          const hasFeedback = feedbackInputs.length > 0;

          // ① 종합 성장 제안 — 과업 변경 시 또는 아직 없을 때. 점수가 하나라도 있어야 생성.
          if ((anyTaskChanged || !haveGrowth) && tasksSnapshot.some((t) => t.score != null)) {
            try {
              const growth = await generateComprehensiveGrowthSuggestion({
                tasks: tasksSnapshot.map((t) => ({
                  taskTitle: t.title || '제목 없음',
                  startDate: t.startDate,
                  endDate: t.endDate,
                  weight: t.weight,
                  score: t.score,
                  contributionMethod: t.contributionMethod,
                  contributionScope: t.contributionScope,
                  feedback: t.feedback,
                })),
                growthLevel,
              });
              if (growth && !growth.startsWith('⚠')) {
                await aiContentService.put('evaluatee_growth_suggestion', growthScope, growth);
              }
            } catch {
              /* best-effort */
            }
            prevRan = true;
          }

          // ② 평가자 피드백 요약 — 피드백 변경 시 또는 아직 없을 때.
          if (hasFeedback && (anyFeedbackChanged || !haveEvaluatorSummary)) {
            await spaceOut();
            try {
              const summary = await generateFeedbackSummaryForEvaluator(evaluateeName, feedbackInputs);
              if (summary && !summary.startsWith('⚠')) {
                await aiContentService.put('evaluator_feedback_summary', evaluatorSummaryScope, summary);
              }
            } catch {
              /* best-effort */
            }
            prevRan = true;
          }

          // ③ 피평가자 피드백 요약 — 피드백 변경 시 또는 아직 없을 때.
          if (hasFeedback && (anyFeedbackChanged || !haveEvaluateeSummary)) {
            await spaceOut();
            try {
              const summary = await generateFeedbackSummaryForEvaluatee(
                feedbackInputs.map((f) => ({ ...f, evaluatorName: user.name })),
              );
              if (summary && !summary.startsWith('⚠')) {
                await aiContentService.put('evaluatee_feedback_summary', evaluateeSummaryScope, summary);
              }
            } catch {
              /* best-effort */
            }
            prevRan = true;
          }

          // ④ AI 키워드 — 피드백 변경 시 또는 한쪽 scope 라도 아직 없을 때. 1콜로 평가자/피평가자 양쪽 저장.
          if (hasFeedback && (anyFeedbackChanged || !haveEvaluatorKeywords || !haveEvaluateeKeywords)) {
            await spaceOut();
            try {
              const keywords = await generateFeedbackKeywords(feedbackInputs);
              if (keywords && !keywords.startsWith('⚠') && keywords.trim()) {
                await aiContentService.put('evaluator_feedback_keywords', evaluatorKeywordsScope, keywords);
                await aiContentService.put('evaluatee_feedback_keywords', evaluateeKeywordsScope, keywords);
              }
            } catch {
              /* best-effort */
            }
          }
        })();
      }

       // Evaluator role no longer stores data in localStorage; server updates are handled above.
      return true;
    } catch (error) {
      console.error('❌ 평가 저장 실패:', error);
      // S7: 충돌(409 — 다른 탭 선저장·삭제 과업 등)은 서버 메시지를 그대로 보여주고
      // 최신 상태로 자동 새로고침해 stale 화면에서 재시도하지 않게 한다.
      const isConflict = error instanceof AppError && error.code === '409';
      toast({
        title: isConflict ? '저장 충돌 — 최신 내용으로 새로고침합니다' : '저장 실패',
        description:
          isConflict && error instanceof Error && error.message
            ? error.message
            : '평가 저장 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
      if (isConflict) {
        await loadEvaluationData();
      }
      return false;
    }
  };

  return {
    evaluationData,
    isLoading,
    isAiReviewing,
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
