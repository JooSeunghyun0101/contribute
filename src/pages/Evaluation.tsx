import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, CircleHelp, Clock3, PencilLine } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { AiOpinionButton } from '@/components/ui/ai-opinion-button';
import { NumBadge, Pill } from '@/components/brand';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import {
  GrowthLevelExpectationContent,
  ScoreExpectationContent,
} from '@/components/Evaluation/ExpectationTooltipContent';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { useToast } from '@/hooks/use-toast';
import { employeeService, evaluationService } from '@/lib/services';
import { generateFeedbackRecommendation } from '@/lib/gptOss';
import { buildEvaluatorPeriods, formatEvaluatorPeriod } from '@/lib/evaluatorHistory';
import type { EvaluatorAssignmentHistory } from '@/types';
import { Task, TaskEvaluationEntry } from '@/types/evaluation';
import {
  MATRIX_METHODS,
  MATRIX_SCOPES,
  MATRIX_SCORE_COLORS,
  EvaluationMatrixScores,
  formatScore,
  getMatrixScore,
  getScoreTextColor,
} from '@/lib/evaluationMatrix';

const METHODS = MATRIX_METHODS;
const SCOPES = MATRIX_SCOPES;
const SCORE_BG = MATRIX_SCORE_COLORS;
const EVALUATOR_EDITABLE_STATUSES = new Set(['submitted', 'evaluating']);

type EvaluatorTaskView = {
  task: Task;
  displayTask: Task;
  entry?: TaskEvaluationEntry | null;
  score: number | null;
  hasDraft: boolean;
};

type EvaluatorGroup = {
  key: string;
  evaluatorId: string;
  evaluatorName: string;
  label: string;
  description: string;
  accent: string;
  mutedAccent: string;
  canEdit: boolean;
  isOwnedByCurrentUser: boolean;
  isCurrentAssignment: boolean;
  tasks: EvaluatorTaskView[];
  exactScore: number;
  flooredScore: number;
  completedCount: number;
};

const getEvaluatorStatusMessage = (status?: string) => {
  switch (status) {
    case 'submitted':
    case 'evaluating':
      return '';
    case 'completed':
      return '평가가 완료된 건입니다. 수정이 필요하면 피평가자에게 돌려보내 다시 작성하도록 할 수 있습니다.';
    case 'locked':
      return '평가가 잠겨 있어 수정할 수 없습니다.';
    case 'not-started':
    case 'draft':
    case 'in-progress':
    default:
      return '피평가자가 최종제출한 뒤 평가할 수 있습니다.';
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(d);
};

const resolveTaskScore = (
  task: Pick<Task, 'contributionMethod' | 'contributionScope' | 'score'>,
  matrix: EvaluationMatrixScores,
) => getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ?? task.score ?? null;

const resolveEntryScore = (entry: TaskEvaluationEntry, matrix: EvaluationMatrixScores) =>
  getMatrixScore(entry.contributionMethod, entry.contributionScope, matrix) ?? entry.score ?? null;

const toScoreSummary = (tasks: EvaluatorTaskView[]) => {
  const exactScore = tasks.reduce((sum, item) => {
    if (item.score == null) return sum;
    return sum + (item.score * item.task.weight) / 100;
  }, 0);

  return {
    exactScore: Math.round(exactScore * 100) / 100,
    flooredScore: Math.floor(exactScore),
    completedCount: tasks.filter((item) => item.score != null).length,
  };
};

const getEntryTime = (entry?: TaskEvaluationEntry | null) => {
  const raw = entry?.updatedAt || entry?.feedbackDate || entry?.createdAt;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

const getCurrentEvaluatorId = (user?: { employeeId?: string; id?: string } | null) =>
  user?.employeeId || user?.id || '';

const isEntryOwnedBy = (
  entry: TaskEvaluationEntry,
  evaluatorId: string,
  evaluatorName?: string,
) =>
  Boolean(evaluatorId && entry.evaluatorId === evaluatorId) ||
  Boolean(
    evaluatorName &&
      entry.evaluatorName === evaluatorName &&
      (!entry.evaluatorId || entry.evaluatorId.startsWith('legacy:')),
  );

const getTaskForEntry = (task: Task, entry: TaskEvaluationEntry): Task => ({
  ...task,
  contributionMethod: entry.contributionMethod,
  contributionScope: entry.contributionScope,
  score: entry.score,
  feedback: entry.feedback,
  feedbackDate: entry.feedbackDate ?? undefined,
  evaluatorName: entry.evaluatorName,
});

const Evaluation = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { matrix } = useEvaluationMatrix();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const overrideEvaluationId = searchParams.get('evaluationId');

  const {
    evaluationData,
    isLoading,
    handleMethodClick,
    handleScopeClick,
    handleFeedbackChange,
    handleSave,
    handleTemporarySave,
    getTaskWithDraft,
    hasTaskDraft,
    hasDrafts,
    isPeriodEditable,
    periodEditMessage,
    reloadData,
  } = useEvaluationDataDB(id || '', { evaluationId: overrideEvaluationId });

  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const hasInitializedExpansion = useRef(false);
  const [selectedTaskByGroup, setSelectedTaskByGroup] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [assignmentHistory, setAssignmentHistory] = useState<EvaluatorAssignmentHistory[]>([]);

  useEffect(() => {
    if (!id) {
      setAssignmentHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const history = await employeeService.getEvaluatorAssignmentHistory(id);
        if (cancelled) return;
        setAssignmentHistory(history);
      } catch (error) {
        console.warn('평가자 이력 로드 실패:', error);
        if (!cancelled) setAssignmentHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 근무기간은 이 평가의 평가기간(evaluation_period_id) 행만으로 계산 — 연도 넘어 합쳐지지 않게.
  const evaluatorPeriods = useMemo(
    () =>
      buildEvaluatorPeriods(assignmentHistory, {
        periodId: evaluationData?.evaluationPeriodId ?? null,
      }),
    [assignmentHistory, evaluationData?.evaluationPeriodId],
  );

  const committedTasks = useMemo(() => evaluationData?.tasks ?? [], [evaluationData?.tasks]);
  const currentEvaluationTasks = useMemo(
    () => committedTasks.filter((task) => !task.isHistoricalEvaluation),
    [committedTasks],
  );
  const evaluationStatus = evaluationData?.evaluationStatus;
  // 평가 저장 후 AI 검토중(evaluating)·제출 대기(submitted) 단계에서는 점수가 확정되지 않은 상태다.
  // 최종 완료(completed)·잠금(locked)일 때만 "내 반영 점수"를 상단에 반영한다.
  const isEvaluationFinalized = evaluationStatus === 'completed' || evaluationStatus === 'locked';
  const isSubmittedForReview = EVALUATOR_EDITABLE_STATUSES.has(evaluationStatus ?? '');
  const canEditEvaluation = evaluationData?.evaluatorAccess?.canEdit ?? true;
  const evaluatorAccessMessage = evaluationData?.evaluatorAccess?.message;
  const canEvaluate = isPeriodEditable && isSubmittedForReview && canEditEvaluation;
  // 평가자가 평가 시작 전(submitted)이거나 진행 중(evaluating), 또는 완료(completed) — 모두 돌려보내기 가능
  const canReopenCompleted =
    isPeriodEditable &&
    (evaluationStatus === 'completed' ||
      evaluationStatus === 'submitted' ||
      evaluationStatus === 'evaluating') &&
    canEditEvaluation;
  const evaluatorEditMessage = !isPeriodEditable
    ? periodEditMessage
    : !canEditEvaluation
      ? evaluatorAccessMessage
      : getEvaluatorStatusMessage(evaluationStatus);
  const currentEvaluatorId = getCurrentEvaluatorId(user);

  const evaluatorGroups = useMemo<EvaluatorGroup[]>(() => {
    if (!evaluationData || !user) return [];

    const entryGroups = new Map<
      string,
      {
        evaluatorId: string;
        evaluatorName: string;
        entriesByTaskId: Map<string, TaskEvaluationEntry>;
        latestTime: number;
        ownedByCurrentUser: boolean;
      }
    >();

    committedTasks.forEach((task) => {
      (task.evaluationEntries ?? []).forEach((entry) => {
        const key = entry.evaluatorId || `name:${entry.evaluatorName}`;
        const group =
          entryGroups.get(key) ??
          {
            evaluatorId: entry.evaluatorId,
            evaluatorName: entry.evaluatorName || '평가자',
            entriesByTaskId: new Map<string, TaskEvaluationEntry>(),
            latestTime: 0,
            ownedByCurrentUser: false,
          };
        group.entriesByTaskId.set(task.id, entry);
        group.latestTime = Math.max(group.latestTime, getEntryTime(entry));
        group.ownedByCurrentUser =
          group.ownedByCurrentUser || isEntryOwnedBy(entry, currentEvaluatorId, user.name);
        entryGroups.set(key, group);
      });
    });

    const groups: EvaluatorGroup[] = [];
    const currentGroupKey = currentEvaluatorId || user.name;
    const currentEntryGroup = Array.from(entryGroups.values()).find((group) => group.ownedByCurrentUser);
    const shouldShowCurrentGroup =
      Boolean(
        currentEntryGroup &&
          currentEvaluationTasks.some((task) =>
            task.evaluationEntries?.some((entry) =>
              isEntryOwnedBy(entry, currentEvaluatorId, user.name),
            ),
          ),
      ) ||
      Boolean(evaluationData.evaluatorAccess?.isCurrentAssignedEvaluator) ||
      Boolean(evaluationData.evaluatorAccess?.isFormerEvaluator);

    if (shouldShowCurrentGroup) {
      const views = currentEvaluationTasks.map((task) => {
        const displayTask = getTaskWithDraft(task);
        return {
          task,
          displayTask,
          entry: task.currentEvaluatorEntry ?? null,
          score: resolveTaskScore(displayTask, matrix),
          hasDraft: hasTaskDraft(task.id),
        };
      });
      const summary = toScoreSummary(views);
      groups.push({
        key: `current:${currentGroupKey}`,
        evaluatorId: currentEvaluatorId,
        evaluatorName: user.name,
        label: evaluationData.evaluatorAccess?.isFormerEvaluator ? '이전 평가' : '현재 평가',
        description: '과업별 평가 내역',
        accent: evaluationData.evaluatorAccess?.isFormerEvaluator ? 'var(--ok-orange-600)' : 'var(--ok-orange)',
        mutedAccent: evaluationData.evaluatorAccess?.isFormerEvaluator ? 'var(--ok-yellow-50)' : 'var(--ok-orange-50)',
        canEdit: canEvaluate,
        isOwnedByCurrentUser: true,
        isCurrentAssignment: Boolean(evaluationData.evaluatorAccess?.isCurrentAssignedEvaluator),
        tasks: views,
        ...summary,
      });
    }

    const previousGroups = Array.from(entryGroups.values())
      .filter(
        (group) =>
          !(
            group.ownedByCurrentUser &&
            currentEvaluationTasks.some((task) => group.entriesByTaskId.has(task.id))
          ),
      )
      .sort((a, b) => b.latestTime - a.latestTime)
      .map((group) => {
        const groupTasks = committedTasks.filter((task) => group.entriesByTaskId.has(task.id));
        const views = groupTasks.map((task) => {
          const entry = group.entriesByTaskId.get(task.id) ?? null;
          const displayTask = entry ? getTaskForEntry(task, entry) : { ...task, score: null };
          return {
            task,
            displayTask,
            entry,
            score: entry ? resolveEntryScore(entry, matrix) : null,
            hasDraft: false,
          };
        });
        const summary = toScoreSummary(views);
        return {
          key: `entry:${group.evaluatorId || group.evaluatorName}`,
          evaluatorId: group.evaluatorId,
          evaluatorName: group.evaluatorName,
          label: '이전 평가',
          description: '과업별 평가 내역',
          accent: 'var(--fg-muted)',
          mutedAccent: 'var(--bg-muted)',
          canEdit: false,
          isOwnedByCurrentUser: false,
          isCurrentAssignment: false,
          tasks: views,
          ...summary,
        };
      });

    return [...groups, ...previousGroups];
  }, [
    canEvaluate,
    committedTasks,
    currentEvaluationTasks,
    currentEvaluatorId,
    evaluationData,
    getTaskWithDraft,
    hasTaskDraft,
    matrix,
    user,
  ]);

  const groupKeys = useMemo(() => evaluatorGroups.map((group) => group.key), [evaluatorGroups]);

  // 현재 평가자 그룹 — exactScore/flooredScore 는 과업별 점수 선택(draft)을 즉시 반영하므로
  // 상단 "내 반영 점수 · 달성 여부"를 저장 전에도 라이브로 보여준다.
  const currentEvaluatorGroup = useMemo(
    () => evaluatorGroups.find((group) => group.isOwnedByCurrentUser) ?? null,
    [evaluatorGroups],
  );

  useEffect(() => {
    if (groupKeys.length === 0) {
      setExpandedGroupKeys([]);
      setSelectedTaskByGroup({});
      return;
    }

    setExpandedGroupKeys((prev) => {
      // 사용자가 모두 접을 수 있도록 강제 펼침 없음
      const next = prev.filter((key) => groupKeys.includes(key));
      // 최초 렌더에서만 첫 그룹을 펼친 상태로 시작
      if (!hasInitializedExpansion.current && groupKeys.length > 0) {
        hasInitializedExpansion.current = true;
        return [groupKeys[0]];
      }
      return next.length === prev.length && next.every((key, index) => key === prev[index])
        ? prev
        : next;
    });

    setSelectedTaskByGroup((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      evaluatorGroups.forEach((group) => {
        const value =
          prev[group.key] && group.tasks.some((item) => item.task.id === prev[group.key])
            ? prev[group.key]
            : group.tasks[0]?.task.id ?? '';
        next[group.key] = value;
        if (prev[group.key] !== value) changed = true;
      });
      if (Object.keys(prev).some((key) => !groupKeys.includes(key))) changed = true;
      return changed ? next : prev;
    });
  }, [evaluatorGroups, groupKeys]);

  if (!user || user.role !== 'evaluator') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h2 className="text-xl sm:text-2xl font-bold mb-4">접근 권한이 없습니다</h2>
          <p className="text-sm sm:text-base text-muted-foreground">
            평가자만 접근할 수 있는 페이지입니다.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div style={{ padding: 32, color: 'var(--fg-muted)' }}>평가 데이터를 불러오는 중입니다…</div>;
  }
  if (!evaluationData) {
    return <div style={{ padding: 32, color: 'var(--fg-muted)' }}>평가 데이터를 찾을 수 없습니다.</div>;
  }

  const toggleGroup = (groupKey: string) => {
    setExpandedGroupKeys((prev) =>
      prev.includes(groupKey) ? prev.filter((key) => key !== groupKey) : [...prev, groupKey],
    );
  };

  const selectTask = (groupKey: string, taskId: string) => {
    const prevTaskId = selectedTaskByGroup[groupKey];
    if (prevTaskId && prevTaskId !== taskId && hasTaskDraft(prevTaskId)) {
      const prevTask = committedTasks.find((t) => t.id === prevTaskId);
      toast({
        title: `${prevTask?.title || '과업'} 임시저장`,
        description: '변경 사항이 임시저장되었습니다. 우측 상단 임시저장/저장 버튼으로 최종 반영됩니다.',
      });
    }
    setSelectedTaskByGroup((prev) => ({ ...prev, [groupKey]: taskId }));
  };

  const onCellClick = (group: EvaluatorGroup, task: Task, methodIndex: number, scopeIndex: number) => {
    if (!group.canEdit) return;
    handleMethodClick(task.id, METHODS[methodIndex]);
    handleScopeClick(task.id, SCOPES[scopeIndex]);
  };

  const onNoContributionClick = (group: EvaluatorGroup, task: Task) => {
    if (!group.canEdit) return;
    handleMethodClick(task.id, '기여없음');
    handleScopeClick(task.id, '기여없음');
  };

  const onSaveClick = async () => {
    if (!canEvaluate) {
      toast({
        title: '평가를 저장할 수 없습니다.',
        description: evaluatorEditMessage ?? '피평가자가 최종제출한 뒤 평가할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    if (!window.confirm('최종 평가를 저장하시겠습니까?\n저장 후에는 평가 단계가 완료로 전환됩니다.')) {
      return;
    }
    setIsSaving(true);
    try {
      // 저장 후 홈으로 이동하지 않고 현재 평가 화면을 유지한다.
      // handleSave 내부에서 성공 토스트와 데이터 갱신(loadEvaluationData)을 수행하므로
      // 화면은 그대로 두고 갱신된 상태(완료/평가중)만 반영된다.
      await handleSave();
    } finally {
      setIsSaving(false);
    }
  };

  const onTemporarySaveClick = async () => {
    // completed 상태: 평가 단계를 evaluating으로 되돌려 평가자가 다시 수정 가능하게
    if (evaluationStatus === 'completed') {
      if (!canEditEvaluation) {
        toast({
          title: '평가를 수정할 수 없습니다.',
          description: evaluatorAccessMessage ?? '권한이 없습니다.',
          variant: 'destructive',
        });
        return;
      }
      if (!evaluationData?.id) return;
      setIsDraftSaving(true);
      try {
        await evaluationService.reopenForEvaluator(evaluationData.id);
        await reloadData();
        toast({
          title: '평가 단계를 임시저장으로 되돌렸습니다.',
          description: '점수와 피드백을 수정한 뒤 다시 평가 저장하세요.',
        });
      } catch (error) {
        console.error('단계 되돌리기 실패:', error);
        toast({
          title: '단계 되돌리기 실패',
          description: '서버와 통신 중 오류가 발생했습니다.',
          variant: 'destructive',
        });
      } finally {
        setIsDraftSaving(false);
      }
      return;
    }
    // 작성 중 상태: 기존 임시저장 동작 (drafts → DB)
    if (!canEvaluate) {
      toast({
        title: '임시저장할 수 없습니다.',
        description: evaluatorEditMessage ?? '피평가자가 최종제출한 뒤 평가할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    setIsDraftSaving(true);
    try {
      const ok = handleTemporarySave();
      toast({
        title: ok ? '임시저장되었습니다.' : '임시저장할 내용이 없습니다.',
        description: ok ? '평가 저장 전까지 점수와 진행 현황에는 반영되지 않습니다.' : undefined,
        variant: ok ? 'default' : 'destructive',
      });
    } finally {
      setIsDraftSaving(false);
    }
  };

  const onReopenEvaluationClick = async () => {
    if (!evaluationData?.id) {
      toast({
        title: '평가 정보를 찾을 수 없습니다.',
        description: '페이지를 새로고침한 뒤 다시 시도해 주세요.',
        variant: 'destructive',
      });
      return;
    }

    const reason = window.prompt(
      '피평가자에게 돌려보내 다시 수정하도록 할까요?\n사유를 입력하면 피평가자에게 함께 전달됩니다. (선택)',
    );
    if (reason === null) return;

    setIsReopening(true);
    try {
      await evaluationService.reopenEvaluation(evaluationData.id, {
        actorId: user?.employeeId ?? user?.id ?? '',
        reason: reason.trim() || undefined,
      });
      await reloadData();
      toast({
        title: '피평가자에게 돌려보냈습니다.',
        description: '피평가자가 과업을 수정한 뒤 다시 최종제출할 때까지 평가는 잠시 잠깁니다.',
      });
    } catch (error) {
      console.error('돌려보내기 실패:', error);
      toast({
        title: '돌려보내기 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsReopening(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`성과 평가 · ${evaluationData.evaluateeName}`}
        subtitle={[
          evaluationData.evaluateePosition,
          evaluationData.evaluateeDepartment,
          evaluationData.evaluateeId ? `ID ${evaluationData.evaluateeId}` : null,
          `과업 ${currentEvaluationTasks.length}건`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <EvaluateeStatHero
              growthLevel={evaluationData.growthLevel}
              currentScore={currentEvaluatorGroup?.exactScore ?? null}
              achieved={
                currentEvaluatorGroup != null &&
                currentEvaluatorGroup.flooredScore >= evaluationData.growthLevel
              }
              isFinalized={isEvaluationFinalized}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="sd-btn sd-btn-outline sd-btn-sm"
                onClick={onReopenEvaluationClick}
                disabled={!canReopenCompleted || isReopening}
                title={
                  canReopenCompleted
                    ? '피평가자가 다시 수정할 수 있도록 돌려보냅니다.'
                    : '피평가자가 최종제출한 평가 건에서만 돌려보낼 수 있습니다.'
                }
              >
                <PencilLine size={14} aria-hidden="true" />
                {isReopening ? '처리 중...' : '피평가자에게 돌려보내기'}
              </button>
              <button
                className="sd-btn sd-btn-outline sd-btn-sm"
                onClick={onTemporarySaveClick}
                disabled={
                  isDraftSaving ||
                  (evaluationStatus === 'completed'
                    ? !canEditEvaluation
                    : !canEvaluate || !hasDrafts)
                }
                title={
                  evaluationStatus === 'completed'
                    ? '평가 단계를 임시저장 단계로 되돌려 점수/피드백을 수정할 수 있게 합니다.'
                    : !canEvaluate
                      ? evaluatorEditMessage ?? undefined
                      : !hasDrafts
                        ? '저장할 임시 내용이 없습니다.'
                        : undefined
                }
              >
                {isDraftSaving
                  ? '처리 중…'
                  : evaluationStatus === 'completed'
                    ? '임시저장'
                    : '임시저장'}
              </button>
              {isSaving ? (
                // 저장 클릭 후 AI 검토 중 — AI 의견 버튼과 동일한 파랑+shine+이모지 로딩 효과.
                <AiOpinionButton loading label="AI 검토 중…" />
              ) : (
                <button
                  className="sd-btn sd-btn-primary sd-btn-sm"
                  onClick={onSaveClick}
                  disabled={!canEvaluate}
                  title={!canEvaluate ? evaluatorEditMessage ?? undefined : undefined}
                >
                  평가 저장
                </button>
              )}
            </div>
          </div>
        }
      />

      {(!isPeriodEditable || !isSubmittedForReview || !canEditEvaluation) && evaluatorEditMessage && (
        <div
          style={{
            padding: '10px 32px',
            background: 'var(--ok-orange-50)',
            borderBottom: '1px solid var(--ok-orange-100)',
            color: 'var(--ok-orange-700)',
            fontSize: 'var(--fs-body)',
            fontWeight: 700,
          }}
        >
          {evaluatorEditMessage}
        </div>
      )}

      <div
        style={{
          padding: '24px 32px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflow: 'auto',
        }}
      >
        {evaluatorGroups.map((group) => {
          const isExpanded = expandedGroupKeys.includes(group.key);
          const selectedTaskId = selectedTaskByGroup[group.key] || group.tasks[0]?.task.id;
          const selectedItem = group.tasks.find((item) => item.task.id === selectedTaskId) ?? group.tasks[0];

          return (
            <EvaluatorAccordion
              key={group.key}
              group={group}
              isExpanded={isExpanded}
              selectedItem={selectedItem}
              selectedTaskId={selectedItem?.task.id}
              periodLabel={
                group.evaluatorId
                  ? formatEvaluatorPeriod(evaluatorPeriods.get(group.evaluatorId))
                  : null
              }
              growthLevel={evaluationData.growthLevel}
              onToggle={() => toggleGroup(group.key)}
              onSelectTask={(taskId) => selectTask(group.key, taskId)}
              onCellClick={(task, methodIndex, scopeIndex) =>
                onCellClick(group, task, methodIndex, scopeIndex)
              }
              onNoContributionClick={(task) => onNoContributionClick(group, task)}
              onFeedbackChange={(taskId, feedback) => {
                if (group.canEdit) handleFeedbackChange(taskId, feedback);
              }}
              matrix={matrix}
            />
          );
        })}

        {evaluatorGroups.length === 0 && (
          <div className="sd-card" style={{ color: 'var(--fg-muted)' }}>
            표시할 평가 내용이 없습니다.
          </div>
        )}
      </div>
    </>
  );
};

type EvaluateeStatHeroProps = {
  growthLevel: number;
  currentScore: number | null;
  achieved: boolean;
  /** 최종 완료(completed)·잠금(locked)에서만 점수/달성을 반영. 저장 후 AI 검토중(evaluating)에는 미반영. */
  isFinalized: boolean;
};

const EvaluateeStatHero = ({ growthLevel, currentScore, achieved, isFinalized }: EvaluateeStatHeroProps) => {
  // 달성 축하 연출은 피평가자(/my) 화면에서만 노출한다. 평가자 화면(/evaluation/:id)에는 두지 않는다.
  const canCelebrate = isFinalized && achieved;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <StatTile
          label="성장 레벨"
          value={`Lv.${growthLevel}`}
          valueColor="var(--fg)"
          tooltipContent={<GrowthLevelExpectationContent level={growthLevel} />}
        />
        <StatTile
          label="내 반영 점수"
          value={currentScore != null && currentScore > 0 ? formatScore(currentScore) : '–'}
          valueColor="var(--ok-orange)"
        />
        <StatTile
          label="달성 여부"
          value={currentScore != null && currentScore > 0 ? (achieved ? '달성' : '미달성') : '–'}
          valueColor={canCelebrate ? 'var(--ok-orange)' : 'var(--fg-muted)'}
        />
      </div>
    </>
  );
};

type StatTileProps = {
  label: string;
  value: string;
  valueColor: string;
  tooltipContent?: ReactNode;
  onValueClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
};

const StatTile = ({ label, value, valueColor, tooltipContent, onValueClick, title }: StatTileProps) => {
  const valueStyle = {
    fontSize: 'var(--fs-h2)',
    fontWeight: 900,
    lineHeight: 1,
    marginTop: 4,
    color: valueColor,
    whiteSpace: 'nowrap' as const,
    letterSpacing: 0,
  };
  const content = (
    <div style={{ textAlign: 'center', lineHeight: 1.1, cursor: tooltipContent ? 'help' : 'default' }}>
      <div
        style={{
          fontSize: 'var(--fs-micro)',
          fontWeight: 700,
          color: 'var(--fg-subtle)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        {label}
        {tooltipContent && <CircleHelp size={12} aria-hidden="true" />}
      </div>
      {onValueClick ? (
        <button
          type="button"
          className="tnum"
          onClick={onValueClick}
          title={title}
          style={{
            ...valueStyle,
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {value}
        </button>
      ) : (
        <div className="tnum" style={valueStyle}>
          {value}
        </div>
      )}
    </div>
  );

  if (!tooltipContent) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="bottom" className="p-3">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
};

type EvaluatorAccordionProps = {
  group: EvaluatorGroup;
  isExpanded: boolean;
  selectedItem?: EvaluatorTaskView;
  selectedTaskId?: string;
  periodLabel?: string | null;
  growthLevel: number;
  onToggle: () => void;
  onSelectTask: (taskId: string) => void;
  onCellClick: (task: Task, methodIndex: number, scopeIndex: number) => void;
  onNoContributionClick: (task: Task) => void;
  onFeedbackChange: (taskId: string, feedback: string) => void;
  matrix: EvaluationMatrixScores;
};

const EvaluatorAccordion = ({
  group,
  isExpanded,
  selectedItem,
  selectedTaskId,
  periodLabel,
  growthLevel,
  onToggle,
  onSelectTask,
  onCellClick,
  onNoContributionClick,
  onFeedbackChange,
  matrix,
}: EvaluatorAccordionProps) => (
  <section
    style={{
      border: `1px solid ${isExpanded ? group.accent : 'var(--border)'}`,
      borderRadius: 8,
      background: 'var(--bg-card)',
      overflow: 'hidden',
    }}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      style={{
        width: '100%',
        minHeight: 116,
        padding: '24px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 20,
        border: 'none',
        background: 'transparent',
        color: 'var(--fg)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--fs-h1)',
              fontWeight: 900,
              color: group.accent,
              lineHeight: 1.15,
            }}
          >
            평가자 {group.evaluatorName}
          </h2>
          <Pill tone={group.canEdit ? 'orange' : group.isOwnedByCurrentUser ? 'success' : 'neutral'}>
            {group.label}
          </Pill>
          {!group.canEdit && <Pill tone="neutral">읽기 전용</Pill>}
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
        <p style={{ margin: '12px 0 0', fontSize: 'var(--fs-body)', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          {group.description}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div className="sd-label-mini">반영 점수</div>
          <div className="tnum" style={{ fontSize: 'var(--fs-h2)', fontWeight: 900, color: group.accent }}>
            {formatScore(group.exactScore)}
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
              {' '}
              / {growthLevel}
            </span>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 3 }}>
            {group.completedCount}/{group.tasks.length} 과업
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp size={24} color={group.accent} aria-hidden="true" />
        ) : (
          <ChevronDown size={24} color={group.accent} aria-hidden="true" />
        )}
      </div>
    </button>

    {isExpanded && group.tasks.length === 0 && (
      <div
        style={{
          borderTop: `1px solid ${group.accent}`,
          minHeight: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-muted)',
          fontSize: 'var(--fs-body)',
          fontWeight: 700,
          background: 'var(--bg-muted)',
        }}
      >
        피평가자가 과업을 제출하기 전입니다.
      </div>
    )}

    {isExpanded && selectedItem && (
      <div
        style={{
          borderTop: `1px solid ${group.accent}`,
          display: 'grid',
          gridTemplateColumns: '420px minmax(0, 1fr)',
          minHeight: 420,
        }}
      >
        <TaskTabs
          group={group}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
        />
        <TaskDetail
          group={group}
          item={selectedItem}
          matrix={matrix}
          growthLevel={growthLevel}
          onCellClick={onCellClick}
          onNoContributionClick={onNoContributionClick}
          onFeedbackChange={onFeedbackChange}
        />
      </div>
    )}
  </section>
);

type TaskTabsProps = {
  group: EvaluatorGroup;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
};

const TaskTabs = ({ group, selectedTaskId, onSelectTask }: TaskTabsProps) => (
  <nav
    style={{
      borderRight: '1px solid var(--border)',
      background: 'var(--bg-muted)',
      overflow: 'auto',
    }}
  >
    {group.tasks.map((item, index) => {
      const active = item.task.id === selectedTaskId;

      return (
        <button
          key={item.task.id}
          type="button"
          onClick={() => onSelectTask(item.task.id)}
          style={{
            width: '100%',
            minHeight: 72,
            padding: '12px 12px 12px 18px',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            background: active ? group.mutedAccent : 'transparent',
            color: active ? 'var(--fg)' : 'var(--fg-muted)',
            display: 'grid',
            gridTemplateColumns: '52px minmax(0, 1fr)',
            gap: 10,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 900, color: active ? group.accent : 'var(--fg-muted)' }}>
            T{String(index + 1).padStart(2, '0')}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div
                style={{
                  fontSize: 'var(--fs-body)',
                  fontWeight: 800,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {item.task.title}
              </div>
              {item.score != null && <NumBadge score={item.score} size={28} />}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 'var(--fs-xs)' }}>
              <span>{item.displayTask.contributionMethod || '방식 미정'}</span>
              <span>·</span>
              <span>{item.displayTask.contributionScope || '범위 미정'}</span>
              {item.hasDraft && (
                <>
                  <span>·</span>
                  <span style={{ color: group.accent, fontWeight: 900 }}>임시저장</span>
                </>
              )}
            </div>
          </div>
        </button>
      );
    })}
  </nav>
);

type TaskDetailProps = {
  group: EvaluatorGroup;
  item: EvaluatorTaskView;
  matrix: EvaluationMatrixScores;
  growthLevel: number;
  onCellClick: (task: Task, methodIndex: number, scopeIndex: number) => void;
  onNoContributionClick: (task: Task) => void;
  onFeedbackChange: (taskId: string, feedback: string) => void;
};

const TaskDetail = ({
  group,
  item,
  matrix,
  growthLevel,
  onCellClick,
  onNoContributionClick,
  onFeedbackChange,
}: TaskDetailProps) => {
  const { toast } = useToast();
  const { task, displayTask } = item;
  const selectedMethodIdx = METHODS.indexOf(displayTask.contributionMethod ?? '');
  const selectedScopeIdx = SCOPES.indexOf(displayTask.contributionScope ?? '');
  const noContribSelected =
    displayTask.contributionMethod === '기여없음' && displayTask.contributionScope === '기여없음';
  const [feedbackAiLoading, setFeedbackAiLoading] = useState(false);
  const [feedbackAiSuggestion, setFeedbackAiSuggestion] = useState<string | null>(null);

  const handleGenerateFeedbackDraft = async () => {
    if (!group.canEdit) return;

    const score = resolveTaskScore(displayTask, matrix);
    const contributionMethod = displayTask.contributionMethod ?? '';
    const contributionScope = displayTask.contributionScope ?? '';
    if (score == null || !contributionMethod || !contributionScope) {
      toast({
        title: '점수 선택이 필요합니다.',
        description: '기여방식과 기여범위를 먼저 선택한 뒤 AI 피드백을 생성해 주세요.',
        variant: 'destructive',
      });
      return;
    }

    setFeedbackAiLoading(true);
    try {
      const generated = await generateFeedbackRecommendation(
        displayTask.title || task.title || '제목 없음',
        displayTask.description || task.description || '',
        score,
        contributionMethod,
        contributionScope,
        displayTask.feedback ?? '',
      );
      const nextFeedback = generated.trim();
      if (!nextFeedback || nextFeedback.startsWith('⚠')) {
        throw new Error(nextFeedback || 'AI 응답이 비어 있습니다.');
      }
      setFeedbackAiSuggestion(nextFeedback);
      toast({ title: 'AI 피드백 의견을 생성했습니다.' });
    } catch (error) {
      console.error('피드백 AI 생성 실패:', error);
      toast({
        title: 'AI 피드백 생성 실패',
        description: error instanceof Error ? error.message : 'AI 호출 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setFeedbackAiLoading(false);
    }
  };

  useEffect(() => {
    setFeedbackAiSuggestion(null);
  }, [task.id]);

  return (
    <div
      style={{
        padding: '28px 34px',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 280px',
        gap: 24,
        alignItems: 'start',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Clock3 size={14} color="var(--fg-muted)" aria-hidden="true" />
          <span style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>
            {formatDate(task.startDate)}~{formatDate(task.endDate)}
          </span>
          <Pill tone="neutral">가중치 {task.weight}%</Pill>
          {item.hasDraft && <Pill tone="orange">임시저장</Pill>}
        </div>

        <h1 style={{ margin: 0, fontSize: 'var(--fs-h1)', fontWeight: 900, lineHeight: 1.25 }}>
          {task.title}
        </h1>
        {task.description && (
          <p style={{ marginTop: 16, fontSize: 'var(--fs-body)', lineHeight: 1.8, color: 'var(--fg-muted)' }}>
            {task.description}
          </p>
        )}

        <div style={{ marginTop: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div className="sd-label-mini">스코어링 매트릭스</div>
              <h3 style={{ margin: '2px 0 0', fontSize: 'var(--fs-body)', fontWeight: 900 }}>
                {group.canEdit ? '셀을 클릭해 점수 선택' : '평가자가 선택한 점수'}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNoContributionClick(task)}
              disabled={!group.canEdit}
              style={{
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid',
                borderColor: noContribSelected ? 'var(--danger)' : 'var(--border)',
                background: noContribSelected ? 'var(--danger)' : 'transparent',
                color: noContribSelected ? '#fff' : 'var(--fg)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 800,
                cursor: group.canEdit ? 'pointer' : 'not-allowed',
                opacity: group.canEdit ? 1 : 0.55,
              }}
            >
              기여없음 (0점)
            </button>
          </div>

          <MatrixGrid
            matrix={matrix}
            rowHeaderWidth={56}
            gap={4}
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
            renderCell={(method, scope, methodIndex, scopeIndex, cellScore) => {
              const isSelected = !noContribSelected && methodIndex === selectedMethodIdx && scopeIndex === selectedScopeIdx;
              const cellBg = isSelected ? (SCORE_BG[cellScore] ?? group.accent) : 'var(--bg-muted)';
              const cellColor = isSelected ? getScoreTextColor(cellScore) : 'var(--fg-subtle)';

              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span style={{ display: 'block', width: '100%' }}>
                      <button
                        type="button"
                        onClick={() => onCellClick(task, methodIndex, scopeIndex)}
                        disabled={!group.canEdit}
                        style={{
                          width: '100%',
                          height: 44,
                          borderRadius: 8,
                          border: `2px solid ${isSelected ? (SCORE_BG[cellScore] ?? group.accent) : 'var(--border)'}`,
                          background: cellBg,
                          color: cellColor,
                          fontWeight: isSelected ? 900 : 700,
                          fontSize: isSelected ? 'var(--fs-h3)' : 'var(--fs-h4)',
                          cursor: group.canEdit ? 'pointer' : 'not-allowed',
                          opacity: group.canEdit || isSelected ? 1 : 0.48,
                        }}
                      >
                        {cellScore}
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="p-3">
                    <ScoreExpectationContent
                      score={cellScore}
                      method={method}
                      scope={scope}
                      growthLevel={growthLevel}
                    />
                  </TooltipContent>
                </Tooltip>
              );
            }}
          />
        </div>

        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div className="sd-label-mini">피드백</div>
            <AiOpinionButton
              onClick={handleGenerateFeedbackDraft}
              disabled={!group.canEdit}
              loading={feedbackAiLoading}
              title={
                group.canEdit
                  ? '선택한 점수와 과업 정보를 바탕으로 평가자 피드백 의견 초안을 작성합니다.'
                  : '현재 평가를 수정할 수 없습니다.'
              }
            />
          </div>
          <div
            style={{
              marginTop: 8,
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 0.7fr)',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            <textarea
              value={displayTask.feedback ?? ''}
              onChange={(event) => onFeedbackChange(task.id, event.target.value)}
              disabled={!group.canEdit}
              placeholder="이번 과업에 대한 피드백을 작성하세요."
              rows={7}
              style={{
                width: '100%',
                minHeight: 178,
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: group.canEdit ? 'var(--bg-card)' : 'var(--bg-muted)',
                fontSize: 'var(--fs-body)',
                lineHeight: 1.7,
                color: 'var(--fg)',
                resize: 'vertical',
                fontFamily: 'inherit',
                cursor: group.canEdit ? 'text' : 'not-allowed',
              }}
            />
            <div
              onCopy={(event) => {
                event.preventDefault();
                toast({ title: 'AI 의견은 복사할 수 없습니다.' });
              }}
              onCut={(event) => event.preventDefault()}
              onContextMenu={(event) => event.preventDefault()}
              style={{
                minHeight: 178,
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid var(--ok-orange-100)',
                background: 'var(--ok-orange-50)',
                color: 'var(--ok-brown)',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                cursor: 'default',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontWeight: 900 }}>AI 의견</span>
              </div>
              {feedbackAiLoading
                ? '생성 중입니다...'
                : feedbackAiSuggestion ?? 'AI 의견 초안을 생성하면 여기에 표시됩니다.'}
            </div>
          </div>
        </div>
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            padding: 20,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-muted)',
            textAlign: 'center',
          }}
        >
          <div className="sd-label-mini">{group.canEdit ? '현재 선택 점수' : '평가 점수'}</div>
          {item.score != null ? (
            <>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                <NumBadge score={item.score} size={78} />
              </div>
              <div style={{ marginTop: 10, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                {displayTask.contributionMethod || '미정'} × {displayTask.contributionScope || '미정'}
              </div>
            </>
          ) : (
            <div style={{ marginTop: 18, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
              아직 평가되지 않았습니다.
            </div>
          )}
        </div>

        <div
          style={{
            padding: 18,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}
        >
          <div className="sd-label-mini">가중치 반영</div>
          <div className="tnum" style={{ marginTop: 8, fontSize: 'var(--fs-h2)', fontWeight: 900, color: group.accent }}>
            {item.score != null ? ((item.score * task.weight) / 100).toFixed(2) : '–'}
          </div>
          <div style={{ marginTop: 5, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
            점수 {item.score ?? '–'} × 가중치 {task.weight}%
          </div>
        </div>

        {!group.canEdit && (
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--bg-muted)',
              border: '1px solid var(--border)',
              color: 'var(--fg-muted)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.6,
            }}
          >
            이 평가는 {group.evaluatorName} 평가자의 기록입니다. 해당 평가자만 수정할 수 있습니다.
          </div>
        )}
      </aside>
    </div>
  );
};

export default Evaluation;
