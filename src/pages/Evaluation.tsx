import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PencilLine } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { AiOpinionButton } from '@/components/ui/ai-opinion-button';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { useToast } from '@/hooks/use-toast';
import { useConfirm, useReason } from '@/components/ui/confirm-dialog';
import { employeeService, evaluationService } from '@/lib/services';
import { buildEvaluatorPeriods, formatEvaluatorPeriod } from '@/lib/evaluatorHistory';
import type { EvaluatorAssignmentHistory } from '@/types';
import { Task, TaskEvaluationEntry } from '@/types/evaluation';
import { EvaluationMatrixScores, getMatrixScore } from '@/lib/evaluationMatrix';
import {
  EvaluatorAccordion,
  EvaluateeStatHero,
  METHODS,
  SCOPES,
  resolveTaskScore,
  toScoreSummary,
  type EvaluatorGroup,
  type EvaluatorTaskView,
} from '@/components/Evaluation/EvaluatorReview';

const EVALUATOR_EDITABLE_STATUSES = new Set(['submitted', 'evaluating']);

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

const resolveEntryScore = (entry: TaskEvaluationEntry, matrix: EvaluationMatrixScores) =>
  getMatrixScore(entry.contributionMethod, entry.contributionScope, matrix) ?? entry.score ?? null;

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
  const confirm = useConfirm();
  const askReason = useReason();
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
        periodId: evaluationData?.evaluation_period_id ?? null,
      }),
    [assignmentHistory, evaluationData?.evaluation_period_id],
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
      // 이미 비어 있으면 같은 참조를 반환해 불필요한 재렌더(→ 무한 루프 위험)를 막는다.
      setExpandedGroupKeys((prev) => (prev.length === 0 ? prev : []));
      setSelectedTaskByGroup((prev) => (Object.keys(prev).length === 0 ? prev : {}));
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
    handleMethodClick(task.id, '기여미흡');
    handleScopeClick(task.id, '기여미흡');
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
    const ok = await confirm({
      title: '최종 평가를 저장하시겠습니까?',
      description: '저장 후에는 평가 단계가 완료로 전환됩니다.',
      confirmText: '최종 저장',
    });
    if (!ok) return;
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
      // 마감된 평가기간은 되돌려도 편집이 막혀 'evaluating'인데 입력 불가한 stuck 상태가 된다.
      // canReopenCompleted 와 동일하게 기간 편집 가능 여부를 먼저 막는다(핸들러 누락 보정).
      if (!isPeriodEditable) {
        toast({
          title: '평가기간이 마감되어 되돌릴 수 없습니다.',
          description: periodEditMessage ?? '마감된 평가기간의 평가는 수정할 수 없습니다.',
          variant: 'destructive',
        });
        return;
      }
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

    const reason = await askReason({
      title: '피평가자에게 돌려보내 다시 수정하도록 할까요?',
      description: '사유를 입력하면 피평가자에게 함께 전달됩니다. (선택)',
      placeholder: '돌려보내는 사유 (선택)',
      confirmText: '돌려보내기',
    });
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
                    ? !canEditEvaluation || !isPeriodEditable
                    : !canEvaluate || !hasDrafts)
                }
                title={
                  evaluationStatus === 'completed'
                    ? !isPeriodEditable
                      ? periodEditMessage ?? '마감된 평가기간이라 되돌릴 수 없습니다.'
                      : !canEditEvaluation
                        ? evaluatorAccessMessage ?? '권한이 없습니다.'
                        : '평가 단계를 임시저장 단계로 되돌려 점수/피드백을 수정할 수 있게 합니다.'
                    : !canEvaluate
                      ? evaluatorEditMessage ?? undefined
                      : !hasDrafts
                        ? '저장할 임시 내용이 없습니다.'
                        : undefined
                }
              >
                {isDraftSaving ? '처리 중…' : '임시저장'}
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

export default Evaluation;
