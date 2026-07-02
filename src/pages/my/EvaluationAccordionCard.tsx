import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import { AccordionMotion } from '@/components/ui/accordion-motion';
import { SpiralLoader } from '@/components/ui/loader';
import { AiOpinionButton } from '@/components/ui/ai-opinion-button';
import { ScoreExpectationContent } from '@/components/Evaluation/ExpectationTooltipContent';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DateRangePicker, isValidDateValue } from '@/components/ui/date-picker';
import { NumBadge, Pill } from '@/components/brand';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { useLocalDraftPersistence } from '@/hooks/useLocalDraftPersistence';
import { taskService, evaluationService } from '@/lib/services';
import { useToast } from '@/hooks/use-toast';
import { useConfirm, useReason } from '@/components/ui/confirm-dialog';
import { generatePerformanceReportDraft } from '@/lib/gptOss';
import { AiContentText } from '@/components/ui/AiContentText';
import type { FeedbackHistoryItem, Task } from '@/types/evaluation';
import {
  formatScore,
  getMatrixScore,
  getMatrixMethodIndex,
  getMatrixScopeIndex,
  MATRIX_METHODS,
  MATRIX_SCOPES,
  getScoreTintBg,
  getScoreTintFg,
} from '@/lib/evaluationMatrix';
import {
  EMPTY_DRAFT,
  EVALUATEE_TASK_LOCKED_STATUSES,
  formatDate,
  formatDateTime,
  getEvaluationStatusMeta,
  getWeightStatus,
  toDateInput,
  type TaskDraft,
} from './_taskHelpers';

const METHODS = MATRIX_METHODS;
const SCOPES = MATRIX_SCOPES;

const getMatrixCoords = (method?: string, scope?: string): { row: number; col: number } | null => {
  const row = getMatrixMethodIndex(method);
  const col = getMatrixScopeIndex(scope);
  if (row < 0 || col < 0) return null;
  return { row, col };
};

interface Props {
  employeeId: string;
  evaluationId: string | null;
  isCurrent: boolean;
  defaultExpanded?: boolean;
  periodLabel?: string | null;
}

const EvaluationAccordionCard = ({
  employeeId,
  evaluationId,
  isCurrent,
  defaultExpanded = false,
  periodLabel,
}: Props) => {
  const { user } = useAuth();
  const { matrix } = useEvaluationMatrix();
  const { toast } = useToast();
  const confirm = useConfirm();
  const askReason = useReason();
  const {
    evaluationData,
    isLoading,
    reloadData,
    isPeriodEditable,
    periodEditMessage,
  } = useEvaluationDataDB(employeeId, { evaluationId });

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'create'>('view');
  // 옵션 B — task별 draft 유지. 다른 과업으로 전환해도 unsaved 변경사항이 메모리에 유지됨.
  const NEW_DRAFT_KEY = '__new__';
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [reportAiLoading, setReportAiLoading] = useState(false);
  const [reportAiSuggestion, setReportAiSuggestion] = useState<string | null>(null);

  const tasks = useMemo(() => evaluationData?.tasks ?? [], [evaluationData?.tasks]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null,
    [selectedTaskId, tasks],
  );

  const currentDraftKey = mode === 'create' ? NEW_DRAFT_KEY : (selectedTaskId ?? '');
  const baseDraft: TaskDraft = useMemo(() => {
    if (mode === 'create') return EMPTY_DRAFT;
    if (!selectedTask) return EMPTY_DRAFT;
    return {
      title: selectedTask.title ?? '',
      description: selectedTask.description ?? '',
      weight: selectedTask.weight ?? 0,
      isAiTask: selectedTask.isAiTask ?? false,
      startDate: toDateInput(selectedTask.startDate),
      endDate: toDateInput(selectedTask.endDate),
    };
  }, [mode, selectedTask]);
  const draft = drafts[currentDraftKey] ?? baseDraft;
  const setDraft = useCallback(
    (next: TaskDraft) => {
      setDrafts((prev) => ({ ...prev, [currentDraftKey]: next }));
    },
    [currentDraftKey],
  );
  const clearDraft = useCallback((key: string) => {
    setDrafts((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  // 특정 task에 unsaved 변경이 있는지 확인
  const isTaskDirty = useCallback(
    (taskId: string): boolean => {
      const d = drafts[taskId];
      if (!d) return false;
      const t = tasks.find((x) => x.id === taskId);
      if (!t) return false;
      const original: TaskDraft = {
        title: t.title ?? '',
        description: t.description ?? '',
        weight: t.weight ?? 0,
        isAiTask: t.isAiTask ?? false,
        startDate: toDateInput(t.startDate),
        endDate: toDateInput(t.endDate),
      };
      return JSON.stringify(d) !== JSON.stringify(original);
    },
    [drafts, tasks],
  );

  // 미저장 변경이 있는 기존 과업 수 — 임시저장은 dirty 과업을 일괄 저장하므로 버튼 게이트·라벨에 사용.
  const dirtyTaskCount = useMemo(
    () => tasks.filter((t) => isTaskDirty(t.id)).length,
    [tasks, isTaskDirty],
  );
  // F-2: 이 카드(자체 로컬 drafts 사용)의 미저장 편집 시 이탈 경고. 작성 중 새 과업 또는 dirty 과업.
  const hasUnsavedEdits = useMemo(() => {
    const newDraft = drafts[NEW_DRAFT_KEY];
    const newDraftHasContent = Boolean(
      newDraft && (newDraft.title?.trim() || newDraft.description?.trim() || newDraft.weight),
    );
    return newDraftHasContent || dirtyTaskCount > 0;
  }, [drafts, dirtyTaskCount]);
  useUnsavedChangesWarning(hasUnsavedEdits);

  // F-2: 카드 로컬 drafts 를 localStorage 에 자동저장/복원(새로고침·탭닫기 후 작성 중 내용 복구).
  const cardDraftKey = useMemo(
    () => (evaluationId ? `taskCardDraft:${employeeId}:${evaluationId}` : ''),
    [employeeId, evaluationId],
  );
  const isValidDraftKey = useCallback(
    (key: string) => key === NEW_DRAFT_KEY || tasks.some((t) => t.id === key),
    [tasks],
  );
  useLocalDraftPersistence<Record<string, TaskDraft>>({
    storageKey: cardDraftKey,
    drafts,
    setDrafts: (next) => setDrafts(next),
    ready: !isLoading,
    validKey: isValidDraftKey,
  });

  // 다른 과업 클릭 시 — 현재 과업에 unsaved 변경이 있으면 토스트로 알림
  const handleSelectTask = useCallback(
    (nextTaskId: string) => {
      if (mode === 'view' && selectedTaskId && selectedTaskId !== nextTaskId) {
        const currentDraft = drafts[selectedTaskId];
        const prevTask = tasks.find((t) => t.id === selectedTaskId);
        if (currentDraft && prevTask) {
          const original: TaskDraft = {
            title: prevTask.title ?? '',
            description: prevTask.description ?? '',
            weight: prevTask.weight ?? 0,
            isAiTask: prevTask.isAiTask ?? false,
            startDate: toDateInput(prevTask.startDate),
            endDate: toDateInput(prevTask.endDate),
          };
          if (JSON.stringify(currentDraft) !== JSON.stringify(original)) {
            toast({
              title: `${prevTask.title || '과업'} 변경사항 유지 중`,
              description: '변경 사항이 유지됩니다. 저장하려면 임시저장 또는 최종제출 버튼을 눌러주세요.',
            });
          }
        }
      }
      setSelectedTaskId(nextTaskId);
      setMode('view');
    },
    [mode, selectedTaskId, drafts, tasks, toast],
  );
  const getCurrentScore = (task: {
    contributionMethod?: string | null;
    contributionScope?: string | null;
    score?: number | null;
  }) =>
    getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ?? task.score ?? null;
  const selectedScore = selectedTask ? getCurrentScore(selectedTask) : null;

  // 각 과업의 유효 가중치(미저장 draft 우선) 합 — 어떤 과업을 보고 있든 모든 미저장 변경을 동일하게 반영.
  const savedTasksTotalWeight = tasks.reduce(
    (sum, task) => sum + (drafts[task.id]?.weight ?? task.weight ?? 0),
    0,
  );
  const draftTotalWeight =
    mode === 'create' ? savedTasksTotalWeight + draft.weight : savedTasksTotalWeight;
  const isOverWeight = draftTotalWeight > 100;
  // AI 과업 비중(50% 규칙) — 미저장 draft 우선. 면제자(user.aiRuleExempt)는 검사 생략.
  const savedTasksAiWeight = tasks.reduce((sum, task) => {
    const w = drafts[task.id]?.weight ?? task.weight ?? 0;
    const ai = drafts[task.id]?.isAiTask ?? task.isAiTask ?? false;
    return sum + (ai ? w : 0);
  }, 0);
  const draftAiWeight =
    mode === 'create' ? savedTasksAiWeight + (draft.isAiTask ? draft.weight : 0) : savedTasksAiWeight;
  const aiTaskRatio = draftTotalWeight > 0 ? draftAiWeight / draftTotalWeight : 0;
  const aiRuleSatisfied = (user?.aiRuleExempt ?? false) || aiTaskRatio >= 0.5;
  const weightStatus = useMemo(() => getWeightStatus(draftTotalWeight), [draftTotalWeight]);
  const evaluationStatus = evaluationData?.evaluationStatus ?? 'draft';
  const statusMeta = useMemo(() => getEvaluationStatusMeta(evaluationStatus), [evaluationStatus]);
  // 현재/과거 모두 동일하게 EVALUATEE_TASK_LOCKED_STATUSES (submitted/evaluating/completed/locked) 에서 잠금.
  // "제출 완료" 라벨이 뜨면 더 이상 피평가자 단에서 수정할 수 없도록 일관 처리.
  // 수정이 필요하면 평가자/HR 단에서 단계를 되돌려야 한다.
  const isTaskEditingLocked = EVALUATEE_TASK_LOCKED_STATUSES.has(evaluationStatus);
  const taskEditMessage = isTaskEditingLocked
    ? '최종제출 이후에는 과업을 수정할 수 없습니다. 수정이 필요하면 평가자에게 수정을 요청하세요.'
    : periodEditMessage;
  const canEditTasks = isPeriodEditable && !isTaskEditingLocked;
  const hasTitle = draft.title.trim().length > 0;
  const lockedInputStyle = !canEditTasks ? { opacity: 0.68, cursor: 'not-allowed' } : {};

  const evaluatorName = evaluationData?.evaluatorName ?? null;
  const headerLabel = isCurrent ? '현재 평가' : '이전 평가';
  const evaluatorDisplayName = evaluatorName ?? (isCurrent ? user?.name ?? null : null);
  const headerTitle = evaluatorDisplayName
    ? `평가자 ${evaluatorDisplayName}`
    : isCurrent
      ? '평가자'
      : '이전 평가자';
  // 아바타 이니셜은 평가자 이름 기준 (헤더 prefix "평가자" 제외)
  const headerInitial = (evaluatorDisplayName ?? headerTitle).charAt(0);
  const accentColor = isCurrent ? 'var(--ok-orange)' : 'var(--fg-muted)';
  const isCompleted = evaluationStatus === 'completed';
  const [isRequestingReturn, setIsRequestingReturn] = useState(false);

  const handleRequestReturn = async () => {
    if (!evaluationData?.id) return;
    const reason = await askReason({
      title: '수정 요청',
      description: '수정이 필요한 사유를 입력해 주세요. (선택)',
      placeholder: '수정 요청 사유 (선택)',
      confirmText: '수정 요청',
    });
    if (reason === null) return; // 취소 시 발송 중단
    setIsRequestingReturn(true);
    try {
      await evaluationService.requestReturn(evaluationData.id, {
        requestedBy: employeeId,
        reason: reason.trim() || undefined,
      });
      toast({
        title: '수정 요청을 보냈습니다.',
        description: `${evaluatorName ?? '평가자'}에게 알림이 전달되었습니다.`,
      });
    } catch (error) {
      console.error('수정 요청 실패:', error);
      toast({
        title: '수정 요청 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsRequestingReturn(false);
    }
  };

  // 헤더용 점수 요약
  const summary = useMemo(() => {
    const total = tasks.reduce((sum, t) => {
      const score = getMatrixScore(t.contributionMethod, t.contributionScope, matrix) ?? t.score;
      return sum + (score != null ? (Number(score) * Number(t.weight ?? 0)) / 100 : 0);
    }, 0);
    const completed = tasks.filter((t) => {
      const score = getMatrixScore(t.contributionMethod, t.contributionScope, matrix) ?? t.score;
      return score != null;
    }).length;
    return {
      exactScore: Math.round(total * 100) / 100,
      flooredScore: Math.floor(total),
      completedCount: completed,
    };
  }, [tasks, matrix]);

  const showTaskEditLockedToast = () => {
    toast({
      title: '과업을 수정할 수 없습니다.',
      description: taskEditMessage ?? '활성 평가기간에서만 과업을 저장할 수 있습니다.',
      variant: 'destructive',
    });
  };

  const handleGenerateReportDescription = async () => {
    if (!canEditTasks) {
      showTaskEditLockedToast();
      return;
    }
    if (!draft.title.trim()) {
      toast({ title: '과업 제목을 먼저 입력해 주세요.', variant: 'destructive' });
      return;
    }

    setReportAiLoading(true);
    try {
      const generated = await generatePerformanceReportDraft({
        taskTitle: draft.title.trim(),
        currentDescription: draft.description,
        startDate: draft.startDate,
        endDate: draft.endDate,
        weight: draft.weight,
      });
      const nextDescription = generated.trim();
      if (!nextDescription || nextDescription.startsWith('⚠')) {
        throw new Error(nextDescription || 'AI 응답이 비어 있습니다.');
      }
      setReportAiSuggestion(nextDescription);
      toast({ title: 'AI 성과보고 의견을 생성했습니다.' });
    } catch (error) {
      console.error('성과보고 AI 생성 실패:', error);
      toast({
        title: 'AI 성과보고 생성 실패',
        description: error instanceof Error ? error.message : 'AI 호출 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setReportAiLoading(false);
    }
  };

  useEffect(() => {
    setReportAiSuggestion(null);
  }, [currentDraftKey]);

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);

  // 옵션 B에서는 task별 drafts에 변경사항 유지되므로 selectedTaskId 변경 시 별도 reset 불필요.

  const startCreate = () => {
    if (!canEditTasks) {
      showTaskEditLockedToast();
      return;
    }
    setMode('create');
    // 새 과업 입력은 별도 키. 기존 NEW_DRAFT_KEY draft가 있으면 그대로 복원.
  };

  const cancelCreate = () => {
    setMode('view');
    clearDraft(NEW_DRAFT_KEY);
  };

  const computeNextTaskId = () => {
    const evaluateeId = evaluationData?.evaluateeId;
    if (!evaluateeId) return null;
    const evalId = evaluationData?.id ?? (evaluationData as any)?.evaluation_id ?? '';
    const idSuffix = String(evalId).slice(0, 8);
    const prefix = idSuffix ? `${evaluateeId}_${idSuffix}_T` : `${evaluateeId}_T`;
    const numbers = tasks
      .map((t: Task) => {
        const m = (t.taskId ?? '').match(new RegExp(`^${prefix}(\\d+)$`));
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `${prefix}${next}`;
  };

  const maybeFinalizeEvaluation = async () => {
    if (!evaluationData) return;
    const evalId = evaluationData.id ?? (evaluationData as any).evaluation_id;
    if (!evalId) return;
    try {
      await evaluationService.updateEvaluation(evalId, {
        evaluation_status: 'submitted',
        last_modified: new Date().toISOString(),
      } as any);
    } catch (err) {
      console.error('평가 상태 업데이트 실패:', err);
    }
  };

  const isPastEvalEditing = !isCurrent;

  // 미저장 변경이 있는 모든 기존 과업을 저장하고, 저장한 taskId 목록을 반환.
  const saveDirtyExistingTasks = useCallback(async (): Promise<string[]> => {
    const ids = tasks.filter((t) => isTaskDirty(t.id)).map((t) => t.id);
    for (const tid of ids) {
      const d = drafts[tid];
      if (!d) continue;
      await taskService.updateTask(
        tid,
        {
          title: d.title.trim(),
          description: d.description?.trim() || null,
          weight: d.weight || 0,
          is_ai_task: d.isAiTask,
          start_date: d.startDate || null,
          end_date: d.endDate || null,
        },
        { past: isPastEvalEditing },
      );
    }
    return ids;
  }, [tasks, drafts, isTaskDirty, isPastEvalEditing]);

  const handleSave = async (isFinal: boolean) => {
    if (!canEditTasks) {
      showTaskEditLockedToast();
      return;
    }
    if (!draft.title.trim()) {
      toast({ title: '제목을 입력해 주세요.', variant: 'destructive' });
      return;
    }
    if (isFinal && draftTotalWeight !== 100) {
      toast({
        title: '최종제출은 총 가중치 100%에서만 가능합니다.',
        description:
          draftTotalWeight > 100
            ? `현재 ${draftTotalWeight}%입니다. ${draftTotalWeight - 100}%를 줄여 주세요.`
            : `현재 ${draftTotalWeight}%입니다. ${100 - draftTotalWeight}%를 추가하거나 가중치를 조정해 주세요.`,
        variant: 'destructive',
      });
      return;
    }
    if (isFinal && !aiRuleSatisfied) {
      toast({
        title: 'AI 과업 비중이 50% 미만입니다.',
        description: `현재 AI 과업 비중 ${Math.round(aiTaskRatio * 100)}%. 'AI 과업'으로 표시한 과업의 가중치 합이 전체의 50% 이상이어야 최종제출할 수 있습니다.`,
        variant: 'destructive',
      });
      return;
    }
    if (!isValidDateValue(draft.startDate) || !isValidDateValue(draft.endDate)) {
      toast({ title: '기간은 YYYY-MM-DD 형식으로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      toast({ title: '종료일은 시작일 이후여야 합니다.', variant: 'destructive' });
      return;
    }
    if (!evaluationData) return;

    // 미저장 변경이 있는 다른 과업들도 함께 검증 (최종제출 시 모두 반영되므로)
    for (const t of tasks) {
      if (!isTaskDirty(t.id)) continue;
      const d = drafts[t.id];
      const label = t.title || '과업';
      if (!d.title.trim()) {
        toast({ title: `'${label}' 제목을 입력해 주세요.`, variant: 'destructive' });
        return;
      }
      if (!isValidDateValue(d.startDate) || !isValidDateValue(d.endDate)) {
        toast({ title: `'${label}' 기간은 YYYY-MM-DD 형식이어야 합니다.`, variant: 'destructive' });
        return;
      }
      if (d.startDate && d.endDate && d.startDate > d.endDate) {
        toast({ title: `'${label}' 종료일은 시작일 이후여야 합니다.`, variant: 'destructive' });
        return;
      }
    }

    if (isFinal) {
      const ok = await confirm({
        title: '최종제출 하시겠습니까?',
        description: '제출 후에는 평가자 확인 전까지 수정할 수 없습니다.',
        confirmText: '최종제출',
      });
      if (!ok) return;
    }

    setIsSaving(true);
    try {
      if (mode === 'create') {
        const newTaskId = computeNextTaskId();
        const evalId = evaluationData.id ?? (evaluationData as any).evaluation_id;
        if (!newTaskId || !evalId) {
          toast({
            title: '평가 정보를 찾을 수 없습니다.',
            description: !newTaskId ? '직원 정보 확인 불가.' : '평가 레코드 ID가 없습니다.',
            variant: 'destructive',
          });
          setIsSaving(false);
          return;
        }
        await taskService.createTask(
          {
            task_id: newTaskId,
            evaluation_id: evalId,
            title: draft.title.trim(),
            description: draft.description?.trim() || null,
            weight: draft.weight || 0,
            is_ai_task: draft.isAiTask,
            start_date: draft.startDate || null,
            end_date: draft.endDate || null,
            contribution_method: null,
            contribution_scope: null,
            score: null,
            feedback: null,
            feedback_date: null,
            evaluator_name: null,
            deleted_at: null,
          } as any,
          { past: isPastEvalEditing },
        );
        const savedIds = await saveDirtyExistingTasks();
        if (isFinal) await maybeFinalizeEvaluation();
        toast({ title: isFinal ? '과업 등록 및 최종제출 완료' : '과업이 임시저장되었습니다.' });
        await reloadData();
        setMode('view');
        clearDraft(NEW_DRAFT_KEY);
        savedIds.forEach((id) => clearDraft(id));
        setSelectedTaskId(newTaskId);
      } else {
        if (!selectedTask) return;
        // 현재 과업뿐 아니라 미저장 변경이 있는 모든 과업을 저장(가중치 등 전체 반영).
        const savedIds = await saveDirtyExistingTasks();
        if (isFinal) await maybeFinalizeEvaluation();
        toast({ title: isFinal ? '최종제출이 완료되었습니다.' : '임시저장되었습니다.' });
        await reloadData();
        // 저장된 draft는 캐시에서 비워 다음 진입 시 서버 데이터로 동기화
        savedIds.forEach((id) => clearDraft(id));
      }
    } catch (err) {
      console.error(err);
      toast({
        title: '저장 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (mode !== 'view' || !selectedTask) return;
    if (!canEditTasks) {
      showTaskEditLockedToast();
      return;
    }
    const ok = await confirm({
      title: `"${selectedTask.title || '제목 없음'}" 과업을 삭제할까요?`,
      description: '삭제 후에는 복구할 수 없습니다.',
      variant: 'danger',
      confirmText: '삭제',
    });
    if (!ok) return;

    setIsSaving(true);
    try {
      await taskService.softDeleteTask(selectedTask.id, { past: isPastEvalEditing });
      toast({ title: '과업이 삭제되었습니다.' });
      const deletedId = selectedTask.id;
      setSelectedTaskId(null);
      clearDraft(deletedId);
      await reloadData();
    } catch (err) {
      console.error('과업 삭제 실패:', err);
      toast({
        title: '과업 삭제 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isDirty = useMemo(() => {
    if (mode === 'create') {
      return (
        draft.title.trim().length > 0 ||
        draft.description.trim().length > 0 ||
        draft.weight > 0 ||
        !!draft.startDate ||
        !!draft.endDate
      );
    }
    if (!selectedTask) return false;
    return (
      draft.title !== (selectedTask.title ?? '') ||
      draft.description !== (selectedTask.description ?? '') ||
      draft.weight !== (selectedTask.weight ?? 0) ||
      draft.startDate !== toDateInput(selectedTask.startDate) ||
      draft.endDate !== toDateInput(selectedTask.endDate)
    );
  }, [draft, mode, selectedTask]);

  return (
    <section
      style={{
        border: `1px solid ${expanded ? accentColor : 'var(--border)'}`,
        borderRadius: 10,
        background: 'var(--bg-card)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: accentColor,
              color: '#fff',
              fontSize: 'var(--fs-h4)',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {headerInitial}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--fs-h2)', fontWeight: 900, color: accentColor, lineHeight: 1.15 }}>
                {headerTitle}
              </h2>
              <Pill tone={isCurrent ? 'orange' : 'neutral'}>{headerLabel}</Pill>
              <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>
              {periodLabel && (
                <span
                  className="tnum"
                  style={{
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    color: 'var(--fg-muted)',
                    background: 'var(--bg-muted)',
                    padding: '3px 10px',
                    borderRadius: 999,
                  }}
                  title="평가자 근무기간"
                >
                  {periodLabel}
                </span>
              )}
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 6, lineHeight: 1.5 }}>
              과업 {tasks.length}개 · 총 가중치 {draftTotalWeight}% (AI {draftAiWeight}%)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="sd-label-mini">반영 점수</div>
            <div className="tnum" style={{ fontSize: 'var(--fs-h2)', fontWeight: 900, color: accentColor }}>
              {formatScore(summary.exactScore)}
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
                {' '} / {evaluationData?.growthLevel ?? 1}
              </span>
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 3 }}>
              {summary.completedCount}/{tasks.length} 과업
            </div>
          </div>
          <span style={{ fontSize: 'var(--fs-h3)', color: accentColor }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      <AccordionMotion isOpen={expanded}>
        <div
          style={{
            display: 'flex',
            borderTop: '1px solid var(--border)',
            minHeight: 560,
            height: 720,
          }}
        >
          <section
            style={{
              width: 360,
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-card)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="sd-label-mini">과업 목록</div>
                  <h3 style={{ marginTop: 2, fontSize: 'var(--fs-h4)' }}>
                    내 과업{' '}
                    <span style={{ color: 'var(--fg-muted)', fontWeight: 500, fontSize: 'var(--fs-body)' }}>
                      {tasks.length}건
                    </span>
                  </h3>
                </div>
                <button
                  className="sd-btn sd-btn-primary sd-btn-sm"
                  onClick={startCreate}
                  disabled={mode === 'create' || !canEditTasks}
                  title={canEditTasks ? '과업 추가' : taskEditMessage ?? undefined}
                >
                  <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                  과업 추가
                </button>
              </div>
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  background: weightStatus.background,
                  border: weightStatus.border,
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-xs)', fontWeight: 700 }}>
                    총 가중치{isDirty ? ' (편집중)' : ''}
                  </span>
                  <Pill tone={weightStatus.tone}>{weightStatus.label}</Pill>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <span
                    className="tnum"
                    style={{ fontSize: 'var(--fs-h2)', fontWeight: 900, lineHeight: 1, color: weightStatus.color }}
                  >
                    {draftTotalWeight}%
                  </span>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: weightStatus.color }}>
                    {weightStatus.message}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 'var(--fs-xs)',
                    fontWeight: 700,
                    color: user?.aiRuleExempt
                      ? 'var(--fg-muted)'
                      : aiTaskRatio >= 0.5
                        ? 'var(--success)'
                        : 'var(--danger)',
                  }}
                >
                  AI 과업 {draftAiWeight}%
                  {user?.aiRuleExempt
                    ? ' · 50% 규칙 면제'
                    : aiTaskRatio >= 0.5
                      ? ' · 50% 충족'
                      : ' · 50% 이상 필요'}
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                  {weightStatus.guide}
                </div>
              </div>
              {(isTaskEditingLocked || !isPeriodEditable) && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--ok-orange-50)',
                    border: '1px solid var(--ok-orange-100)',
                    color: 'var(--ok-orange-700)',
                    fontSize: 'var(--fs-sm)',
                    lineHeight: 1.5,
                    fontWeight: 700,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span>{taskEditMessage}</span>
                  {/* 현재·이전 평가 모두: 최종제출 이후 잠금 상태면 그 평가의 담당 평가자에게 수정 요청. */}
                  {isTaskEditingLocked && (
                    <button
                      type="button"
                      onClick={handleRequestReturn}
                      disabled={isRequestingReturn}
                      style={{
                        alignSelf: 'flex-start',
                        padding: '5px 10px',
                        background: 'var(--ok-orange)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 'var(--fs-xs)',
                        fontWeight: 700,
                        cursor: isRequestingReturn ? 'not-allowed' : 'pointer',
                        opacity: isRequestingReturn ? 0.7 : 1,
                      }}
                    >
                      {isRequestingReturn ? '요청 중…' : '평가자에게 수정 요청'}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {isLoading && (
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                  <SpiralLoader size={32} />
                  과업을 불러오는 중입니다.
                </div>
              )}
              {!isLoading &&
                tasks.map((task, index) => {
                  const active = mode === 'view' && task.id === selectedTask?.id;
                  const taskScore = getCurrentScore(task);
                  return (
                    <button
                      key={task.id}
                      onClick={() => handleSelectTask(task.id)}
                      style={{
                        width: '100%',
                        padding: '14px 20px',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: active ? 'var(--ok-orange-50)' : 'transparent',
                        borderLeft: active ? '3px solid var(--ok-orange)' : '3px solid transparent',
                        textAlign: 'left',
                      }}
                    >
                      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Pill tone={taskScore == null ? 'neutral' : 'orange'}>
                            T{String(index + 1).padStart(2, '0')}
                          </Pill>
                          {task.isAiTask && (
                            <span
                              style={{
                                padding: '1px 7px',
                                borderRadius: 999,
                                fontSize: 'var(--fs-2xs)',
                                fontWeight: 800,
                                color: 'var(--ai-accent)',
                                background: 'var(--ai-accent-bg)',
                              }}
                            >
                              AI
                            </span>
                          )}
                        </div>
                        <NumBadge score={taskScore} size={28} tint />
                      </div>
                      <div style={{ fontWeight: active ? 700 : 600, fontSize: 'var(--fs-body)', lineHeight: 1.45 }}>
                        {task.title}
                      </div>
                      <div
                        style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 6, display: 'flex', gap: 8 }}
                      >
                        <span>
                          {task.contributionMethod || '방식 미정'} · {task.contributionScope || '범위 미정'}
                        </span>
                        {isTaskDirty(task.id) && (
                          <span style={{ color: 'var(--ok-orange-700)', fontWeight: 900 }}>
                            임시저장
                          </span>
                        )}
                        <span style={{ color: 'var(--fg-subtle)' }}>·</span>
                        <span>가중치 {task.weight}%</span>
                      </div>
                    </button>
                  );
                })}
              {!isLoading && tasks.length === 0 && (
                <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                  등록된 과업이 없습니다. 과업 추가로 시작하세요.
                </div>
              )}
            </div>
          </section>

          <section style={{ flex: 1, overflow: 'auto' }}>
            {mode === 'view' && !selectedTask ? (
              <div style={{ padding: '32px', color: 'var(--fg-muted)' }}>
                표시할 과업이 없습니다. 좌측의 <b>과업 추가</b>로 새 과업을 추가해 주세요.
              </div>
            ) : (
              <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                    {mode === 'create' ? (
                      <Pill tone="orange">신규 과업</Pill>
                    ) : (
                      <>
                        <Pill tone="orange">
                          T{String(tasks.findIndex((task) => task.id === selectedTask!.id) + 1).padStart(2, '0')}
                        </Pill>
                        <Pill tone="neutral">가중치 {draft.weight}%</Pill>
                        <Pill tone={selectedTask!.score == null ? 'warning' : 'success'}>
                          {selectedTask!.score == null ? '평가 대기' : '평가 완료'}
                        </Pill>
                      </>
                    )}
                    <Pill tone={weightStatus.tone}>총 가중치 {draftTotalWeight}% · AI {draftAiWeight}%</Pill>
                    <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>
                    <span style={{ flex: 1 }} />
                    {mode === 'create' && (
                      <button
                        className="sd-btn sd-btn-ghost sd-btn-sm"
                        onClick={cancelCreate}
                        disabled={isSaving}
                      >
                        취소
                      </button>
                    )}
                    <button
                      className="sd-btn sd-btn-outline sd-btn-sm"
                      onClick={() => handleSave(false)}
                      disabled={
                        isSaving || !canEditTasks || !hasTitle || (mode === 'view' && !hasUnsavedEdits)
                      }
                      title={
                        canEditTasks
                          ? '총 가중치가 100%가 아니어도 현재 입력값을 저장합니다. 미저장 변경이 있는 다른 과업도 함께 저장됩니다.'
                          : taskEditMessage ?? undefined
                      }
                    >
                      <Save size={14} aria-hidden="true" />
                      {isSaving
                        ? '저장 중...'
                        : dirtyTaskCount > 1
                          ? `임시저장 (변경 ${dirtyTaskCount}건)`
                          : '임시저장'}
                    </button>
                    <button
                      className="sd-btn sd-btn-primary sd-btn-sm"
                      onClick={() => handleSave(true)}
                      disabled={isSaving || !canEditTasks || !hasTitle || draftTotalWeight !== 100}
                      title={
                        !canEditTasks
                          ? taskEditMessage ?? undefined
                          : draftTotalWeight === 100
                            ? '평가자 검토 단계로 제출합니다.'
                            : '최종제출은 총 가중치가 정확히 100%일 때만 가능합니다.'
                      }
                    >
                      <CheckCircle2 size={14} aria-hidden="true" />
                      최종제출
                    </button>
                    {mode === 'view' && selectedTask && (
                      <button
                        className="sd-btn sd-btn-outline sd-btn-sm"
                        onClick={handleDelete}
                        disabled={isSaving || !canEditTasks}
                        title={
                          canEditTasks
                            ? '이 과업을 삭제합니다. 삭제 후에는 복구할 수 없습니다.'
                            : taskEditMessage ?? undefined
                        }
                        style={{
                          color: 'var(--danger, #B91C1C)',
                          borderColor: 'rgba(220,69,69,0.45)',
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        과업 삭제
                      </button>
                    )}
                  </div>
                  <input
                    className="sd-input"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    disabled={!canEditTasks}
                    placeholder={mode === 'create' ? '새 과업 제목을 입력하세요' : '과업 제목'}
                    style={{
                      fontSize: 'var(--fs-h2)',
                      fontWeight: 800,
                      letterSpacing: 0,
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      ...lockedInputStyle,
                    }}
                  />
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 8,
                      fontSize: 'var(--fs-sm)',
                      fontWeight: 700,
                      color: draft.isAiTask ? 'var(--ai-accent)' : 'var(--fg-muted)',
                      cursor: canEditTasks ? 'pointer' : 'default',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={draft.isAiTask}
                      onChange={(e) => setDraft({ ...draft, isAiTask: e.target.checked })}
                      disabled={!canEditTasks}
                    />
                    AI 과업
                    <span style={{ fontWeight: 500, color: 'var(--fg-subtle)', fontSize: 'var(--fs-xs)' }}>
                      (AI 과업 가중치 합이 전체의 50% 이상이어야 최종제출 가능)
                    </span>
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
                  <div className="flex flex-col gap-4">
                    <div className="sd-card sd-card-lg">
                      <div className="flex items-center justify-between gap-2">
                        <div className="sd-label-mini">과업 설명</div>
                        <AiOpinionButton
                          onClick={handleGenerateReportDescription}
                          disabled={!canEditTasks}
                          loading={reportAiLoading}
                          title={
                            canEditTasks
                              ? '과업 제목과 현재 입력값을 바탕으로 성과보고 초안을 작성합니다.'
                              : taskEditMessage ?? undefined
                          }
                        />
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 0.7fr)',
                          gap: 12,
                          alignItems: 'stretch',
                        }}
                      >
                        <textarea
                          value={draft.description}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          disabled={!canEditTasks}
                          placeholder="과업의 목적·범위·기대 결과를 입력하세요."
                          rows={6}
                          style={{
                            width: '100%',
                            minHeight: 158,
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-card)',
                            fontSize: 'var(--fs-body)',
                            lineHeight: 1.7,
                            color: 'var(--fg)',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            ...lockedInputStyle,
                          }}
                        />
                        <div
                          className={reportAiSuggestion ? 'ai-shine-border' : undefined}
                          onCopy={(event) => {
                            event.preventDefault();
                            toast({ title: 'AI 의견은 복사할 수 없습니다.' });
                          }}
                          onCut={(event) => event.preventDefault()}
                          onContextMenu={(event) => event.preventDefault()}
                          style={{
                            minHeight: 158,
                            padding: '12px 14px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-muted)',
                            color: 'var(--fg)',
                            fontSize: 'var(--fs-sm)',
                            lineHeight: 1.7,
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            cursor: 'default',
                          }}
                        >
                          {reportAiLoading ? (
                            <span style={{ color: 'var(--fg-muted)' }}>작성 중입니다...</span>
                          ) : reportAiSuggestion ? (
                            <AiContentText text={reportAiSuggestion} accent="var(--ai-accent)" />
                          ) : (
                            <span style={{ color: 'var(--fg-muted)' }}>AI 성과보고를 생성하면 여기에 표시됩니다.</span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 18,
                          display: 'grid',
                          gridTemplateColumns: '0.85fr 1.55fr 1fr 1fr',
                          gap: 10,
                        }}
                      >
                        <div style={{ padding: 12, background: 'var(--bg-muted)', borderRadius: 8, minWidth: 0 }}>
                          <div className="sd-label-mini">가중치 (%)</div>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={draft.weight}
                            disabled={!canEditTasks}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                              })
                            }
                            style={{
                              marginTop: 4,
                              width: '100%',
                              padding: '4px 6px',
                              borderRadius: 6,
                              border: `1px solid ${
                                isOverWeight ? 'rgba(220,69,69,0.55)' : 'var(--border)'
                              }`,
                              fontWeight: 700,
                              fontSize: 'var(--fs-body)',
                              color: isOverWeight ? 'var(--danger)' : 'inherit',
                              background: 'var(--bg-card)',
                              ...lockedInputStyle,
                            }}
                          />
                        </div>
                        <div style={{ padding: 12, background: 'var(--bg-muted)', borderRadius: 8, minWidth: 0 }}>
                          <div className="sd-label-mini">기간</div>
                          <DateRangePicker
                            startValue={draft.startDate}
                            endValue={draft.endDate}
                            disabled={!canEditTasks}
                            onChange={({ startDate, endDate }) =>
                              setDraft({ ...draft, startDate, endDate })
                            }
                            className="mt-1"
                            style={lockedInputStyle}
                          />
                        </div>
                        <div style={{ padding: 12, background: 'var(--bg-muted)', borderRadius: 8, minWidth: 0, textAlign: 'center' }}>
                          <div className="sd-label-mini">기여 방식</div>
                          <div style={{ marginTop: 4, fontWeight: 800, fontSize: 'var(--fs-h3)' }}>
                            {mode === 'create' ? '평가자 지정' : selectedTask?.contributionMethod || '미정'}
                          </div>
                        </div>
                        <div style={{ padding: 12, background: 'var(--bg-muted)', borderRadius: 8, minWidth: 0, textAlign: 'center' }}>
                          <div className="sd-label-mini">기여 범위</div>
                          <div style={{ marginTop: 4, fontWeight: 800, fontSize: 'var(--fs-h3)' }}>
                            {mode === 'create' ? '평가자 지정' : selectedTask?.contributionScope || '미정'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {mode === 'view' && selectedTask && (
                      <div className="sd-card sd-card-lg">
                        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                          <div>
                            <div className="sd-label-mini">피드백 이력</div>
                            <h4 style={{ marginTop: 2 }}>
                              {selectedTask.feedbackHistory?.length ?? 0}건의 평가자 코멘트
                            </h4>
                          </div>
                          {selectedTask.evaluatorName && (
                            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                              평가자 ·{' '}
                              <b style={{ color: 'var(--fg)' }}>{selectedTask.evaluatorName}</b>
                            </div>
                          )}
                        </div>
                        {!selectedTask.feedbackHistory?.length ? (
                          <div
                            style={{
                              padding: '32px 20px',
                              textAlign: 'center',
                              color: 'var(--fg-subtle)',
                              background: 'var(--bg-muted)',
                              borderRadius: 10,
                            }}
                          >
                            피드백 이력이 아직 없습니다.
                          </div>
                        ) : (
                          <FeedbackHistoryList
                            key={selectedTask.id}
                            entries={selectedTask.feedbackHistory}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    {mode === 'create' && (
                      <div className="sd-card sd-card-lg" style={{ background: 'var(--bg-muted)' }}>
                        <div className="sd-label-mini">새 과업</div>
                        <p style={{ marginTop: 10, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                          과업이 등록되면 평가자가 기여 방식·범위를 지정하고 점수를 매깁니다. 등록 시점에는 점수가 산정되지 않습니다.
                        </p>
                      </div>
                    )}
                    {mode === 'view' && selectedTask && (
                      <div className="sd-card sd-card-lg">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 14,
                          }}
                        >
                          <div className="sd-label-mini">현재 점수</div>
                          {selectedScore != null && (
                            <span
                              className="tnum"
                              style={{
                                fontSize: 'var(--fs-h2)',
                                fontWeight: 900,
                                color: getScoreTintFg(selectedScore),
                                lineHeight: 1,
                              }}
                            >
                              {selectedScore}.0
                            </span>
                          )}
                        </div>
                        {(() => {
                          const coords = getMatrixCoords(
                            selectedTask.contributionMethod,
                            selectedTask.contributionScope,
                          );
                          return (
                            <MatrixGrid
                              matrix={matrix}
                              rowHeaderWidth={52}
                              gap={3}
                              renderMethodLabel={(method) => (
                                <div
                                  style={{
                                    fontSize: 'var(--fs-sm)',
                                    fontWeight: 700,
                                    color: 'var(--fg-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                  }}
                                >
                                  {method}
                                </div>
                              )}
                              renderScopeLabel={(scope) => (
                                <div
                                  style={{
                                    textAlign: 'center',
                                    fontSize: 'var(--fs-sm)',
                                    fontWeight: 700,
                                    color: 'var(--fg-muted)',
                                    paddingTop: 4,
                                  }}
                                >
                                  {scope}
                                </div>
                              )}
                              renderCell={(method, scope, mi, si, baseScore) => {
                                const selected = coords?.row === mi && coords?.col === si;
                                const bg = selected ? getScoreTintBg(baseScore) : 'var(--bg-muted)';
                                const color = selected ? getScoreTintFg(baseScore) : 'var(--fg-subtle)';
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div
                                        style={{
                                          height: 36,
                                          borderRadius: 6,
                                          background: bg,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          color,
                                          fontWeight: selected ? 900 : 700,
                                          fontSize: selected ? 'var(--fs-h4)' : 'var(--fs-body)',
                                          boxShadow: selected ? '0 0 0 2px rgba(245,80,0,0.25)' : 'none',
                                          transition: 'all 0.15s',
                                          cursor: 'help',
                                        }}
                                      >
                                        {baseScore}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="p-3">
                                      <ScoreExpectationContent
                                        score={baseScore}
                                        method={method}
                                        scope={scope}
                                        growthLevel={evaluationData?.growthLevel}
                                      />
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              }}
                            />
                          );
                        })()}
                        {(() => {
                          const coords = getMatrixCoords(
                            selectedTask.contributionMethod,
                            selectedTask.contributionScope,
                          );
                          if (!coords) {
                            return (
                              <div
                                style={{
                                  marginTop: 14,
                                  padding: '10px 12px',
                                  background: 'var(--bg-muted)',
                                  borderRadius: 8,
                                  fontSize: 'var(--fs-sm)',
                                  color: 'var(--fg-muted)',
                                  textAlign: 'left',
                                  lineHeight: 1.55,
                                }}
                              >
                                기여 방식·범위가 선택되지 않았습니다.
                              </div>
                            );
                          }
                          return (
                            <div
                              style={{
                                marginTop: 14,
                                padding: '10px 12px',
                                background: 'var(--ok-orange-50)',
                                borderRadius: 8,
                                fontSize: 'var(--fs-sm)',
                                color: 'var(--ok-brown)',
                                textAlign: 'left',
                                lineHeight: 1.55,
                              }}
                            >
                              <b>{METHODS[coords.row]}</b> × <b>{SCOPES[coords.col]}</b> →{' '}
                              <b>{matrix[coords.row]?.[coords.col]}점</b>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {mode === 'view' && selectedTask && (
                      <div className="sd-card">
                        <div className="sd-label-mini">일정</div>
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-body)' }}>
                          <div className="flex items-center justify-between">
                            <span style={{ color: 'var(--fg-muted)' }}>시작</span>
                            <b className="tnum">{formatDate(selectedTask.startDate)}</b>
                          </div>
                          <div className="flex items-center justify-between">
                            <span style={{ color: 'var(--fg-muted)' }}>종료</span>
                            <b className="tnum">{formatDate(selectedTask.endDate)}</b>
                          </div>
                          <div style={{ marginTop: 4 }} className="sd-bar">
                            <div
                              className="sd-bar-fill"
                              style={{ width: selectedScore == null ? '62%' : '100%' }}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </AccordionMotion>
    </section>
  );
};

const FeedbackEntryItem = ({ item, isLatest }: { item: FeedbackHistoryItem; isLatest?: boolean }) => (
  <div
    style={{
      padding: 14,
      border: '1px solid var(--border)',
      borderRadius: 10,
      position: 'relative',
    }}
  >
    {isLatest && (
      <span style={{ position: 'absolute', top: 12, right: 12 }}>
        <Pill tone="orange">최신</Pill>
      </span>
    )}
    <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
      <div className="sd-avatar sd-avatar-sm">{item.evaluatorName[0]}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)' }}>{item.evaluatorName}</div>
        <div className="tnum" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
          {formatDateTime(item.date)}
        </div>
      </div>
    </div>
    <p style={{ fontSize: 'var(--fs-body)', lineHeight: 1.65, color: 'var(--fg)', margin: 0 }}>
      {item.content}
    </p>
  </div>
);

// 최신 피드백 1건만 펼쳐 보여주고, 이전 피드백은 '이전 피드백 N건 펼치기 ▼' 토글로 접는다.
// entries는 호출부에서 최신순(date 내림차순)으로 정렬되어 전달된다.
const FeedbackHistoryList = ({ entries }: { entries: FeedbackHistoryItem[] }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [latest, ...older] = entries;
  if (!latest) return null;

  return (
    <div className="flex flex-col gap-3">
      <FeedbackEntryItem item={latest} isLatest={older.length > 0} />
      {older.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            style={{
              alignSelf: 'flex-start',
              padding: '5px 12px',
              borderRadius: 14,
              border: '1px solid var(--border)',
              background: 'var(--bg-muted)',
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isExpanded ? '이전 피드백 접기' : `이전 피드백 ${older.length}건 펼치기`}
            <span style={{ fontSize: 'var(--fs-2xs)' }}>{isExpanded ? '▲' : '▼'}</span>
          </button>

          {isExpanded &&
            older.map((item) => <FeedbackEntryItem key={item.id} item={item} />)}
        </>
      )}
    </div>
  );
};

export default EvaluationAccordionCard;
