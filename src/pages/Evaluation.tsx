import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Clock3, PencilLine } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { Pill } from '@/components/brand';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { useToast } from '@/hooks/use-toast';
import { evaluationService } from '@/lib/services';
import { Task, TaskEvaluationEntry } from '@/types/evaluation';
import {
  MATRIX_METHODS,
  MATRIX_SCOPES,
  MATRIX_SCORE_COLORS,
  EvaluationMatrixScores,
  getMatrixScore,
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
      return '평가가 완료된 건입니다. 수정이 필요하면 평가 수정으로 다시 열 수 있습니다.';
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { matrix } = useEvaluationMatrix();
  const { toast } = useToast();

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
  } = useEvaluationDataDB(id || '');

  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [selectedTaskByGroup, setSelectedTaskByGroup] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  const committedTasks = useMemo(() => evaluationData?.tasks ?? [], [evaluationData?.tasks]);
  const currentEvaluationTasks = useMemo(
    () => committedTasks.filter((task) => !task.isHistoricalEvaluation),
    [committedTasks],
  );
  const evaluationStatus = evaluationData?.evaluationStatus;
  const isSubmittedForReview = EVALUATOR_EDITABLE_STATUSES.has(evaluationStatus ?? '');
  const canEditEvaluation = evaluationData?.evaluatorAccess?.canEdit ?? true;
  const evaluatorAccessMessage = evaluationData?.evaluatorAccess?.message;
  const canEvaluate = isPeriodEditable && isSubmittedForReview && canEditEvaluation;
  const canReopenCompleted = isPeriodEditable && evaluationStatus === 'completed' && canEditEvaluation;
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
      Boolean(evaluationData.evaluatorAccess?.isCurrentAssignedEvaluator);

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
        label: evaluationData.evaluatorAccess?.isFormerEvaluator ? '내 이전 평가' : '현재 평가',
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
          label: group.ownedByCurrentUser ? '내 이전 평가' : '이전 평가',
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

  useEffect(() => {
    if (groupKeys.length === 0) {
      setExpandedGroupKeys([]);
      setSelectedTaskByGroup({});
      return;
    }

    setExpandedGroupKeys((prev) => {
      const next = prev.filter((key) => groupKeys.includes(key));
      const normalized = next.length > 0 ? next : [groupKeys[0]];
      return normalized.length === prev.length && normalized.every((key, index) => key === prev[index])
        ? prev
        : normalized;
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
    setIsSaving(true);
    try {
      const ok = await handleSave();
      if (ok) {
        setTimeout(() => navigate('/'), 1200);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const onTemporarySaveClick = () => {
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

    const ok = window.confirm('완료된 평가를 수정 모드로 전환할까요? 저장하면 다시 완료 상태로 반영됩니다.');
    if (!ok) return;

    setIsReopening(true);
    try {
      await evaluationService.updateEvaluation(evaluationData.id, {
        evaluation_status: 'evaluating',
        last_modified: new Date().toISOString(),
      });
      await reloadData();
      toast({
        title: '평가 수정 모드로 전환했습니다.',
        description: '점수와 피드백을 수정한 뒤 평가 저장을 눌러 완료 처리하세요.',
      });
    } catch (error) {
      console.error('평가 수정 모드 전환 실패:', error);
      toast({
        title: '평가 수정 모드 전환 실패',
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
        title="성과 평가"
        subtitle={`${evaluationData.evaluateeName} · ${evaluationData.evaluateePosition} · ${evaluationData.evaluateeDepartment ?? ''}`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {canReopenCompleted ? (
              <button
                className="sd-btn sd-btn-primary sd-btn-sm"
                onClick={onReopenEvaluationClick}
                disabled={isReopening}
              >
                <PencilLine size={14} aria-hidden="true" />
                {isReopening ? '전환 중...' : '평가 수정'}
              </button>
            ) : (
              <>
                <button
                  className="sd-btn sd-btn-outline sd-btn-sm"
                  onClick={onTemporarySaveClick}
                  disabled={!hasDrafts || isDraftSaving || !canEvaluate}
                  title={!canEvaluate ? evaluatorEditMessage ?? undefined : undefined}
                >
                  {isDraftSaving ? '임시저장 중…' : '임시저장'}
                </button>
                <button
                  className="sd-btn sd-btn-primary sd-btn-sm"
                  onClick={onSaveClick}
                  disabled={isSaving || !canEvaluate}
                  title={!canEvaluate ? evaluatorEditMessage ?? undefined : undefined}
                >
                  {isSaving ? 'AI 검토 중…' : '평가 저장'}
                </button>
              </>
            )}
          </div>
        }
      />

      {(!isPeriodEditable || !isSubmittedForReview || !canEditEvaluation) && evaluatorEditMessage && (
        <div
          style={{
            padding: '10px 32px',
            background: '#FFF7ED',
            borderBottom: '1px solid #FDBA74',
            color: '#9A3412',
            fontSize: 13,
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

type EvaluatorAccordionProps = {
  group: EvaluatorGroup;
  isExpanded: boolean;
  selectedItem?: EvaluatorTaskView;
  selectedTaskId?: string;
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
              fontSize: 30,
              fontWeight: 900,
              color: group.accent,
              lineHeight: 1.15,
            }}
          >
            {group.evaluatorName}
          </h2>
          <Pill tone={group.canEdit ? 'orange' : group.isOwnedByCurrentUser ? 'success' : 'neutral'}>
            {group.label}
          </Pill>
          {!group.canEdit && <Pill tone="neutral">읽기 전용</Pill>}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          {group.description}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div className="sd-label-mini">반영 점수</div>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 900, color: group.accent }}>
            {group.exactScore.toFixed(1)}
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 700 }}>
              {' '}
              / {group.flooredScore}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 3 }}>
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
          fontSize: 14,
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
          gridTemplateColumns: '280px minmax(0, 1fr)',
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
      const scoreBg = item.score != null ? (SCORE_BG[item.score] ?? '#C2BAB0') : 'var(--fg-subtle)';

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
          <div style={{ fontSize: 12, fontWeight: 900, color: active ? group.accent : 'var(--fg-muted)' }}>
            T{String(index + 1).padStart(2, '0')}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div
                style={{
                  fontSize: 13,
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
              {item.score != null && (
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: scoreBg,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 900,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {item.score}
                </span>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
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
  onCellClick: (task: Task, methodIndex: number, scopeIndex: number) => void;
  onNoContributionClick: (task: Task) => void;
  onFeedbackChange: (taskId: string, feedback: string) => void;
};

const TaskDetail = ({
  group,
  item,
  matrix,
  onCellClick,
  onNoContributionClick,
  onFeedbackChange,
}: TaskDetailProps) => {
  const { task, displayTask } = item;
  const selectedMethodIdx = METHODS.indexOf(displayTask.contributionMethod ?? '');
  const selectedScopeIdx = SCOPES.indexOf(displayTask.contributionScope ?? '');
  const noContribSelected =
    displayTask.contributionMethod === '기여없음' && displayTask.contributionScope === '기여없음';

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
          <span style={{ fontSize: 13, fontWeight: 800 }}>
            {formatDate(task.startDate)}~{formatDate(task.endDate)}
          </span>
          <Pill tone="neutral">가중치 {task.weight}%</Pill>
          {item.hasDraft && <Pill tone="orange">임시저장</Pill>}
        </div>

        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, lineHeight: 1.25 }}>
          {task.title}
        </h1>
        {task.description && (
          <p style={{ marginTop: 16, fontSize: 14, lineHeight: 1.8, color: 'var(--fg-muted)' }}>
            {task.description}
          </p>
        )}

        <div style={{ marginTop: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div className="sd-label-mini">스코어링 매트릭스</div>
              <h3 style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 900 }}>
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
                fontSize: 12,
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
            rowHeaderWidth={64}
            gap={6}
            renderCell={(_, __, methodIndex, scopeIndex, cellScore) => {
              const isSelected = !noContribSelected && methodIndex === selectedMethodIdx && scopeIndex === selectedScopeIdx;
              const cellBg = isSelected ? (SCORE_BG[cellScore] ?? group.accent) : 'var(--bg-muted)';
              const cellColor = isSelected ? '#fff' : 'var(--fg-subtle)';

              return (
                <button
                  type="button"
                  onClick={() => onCellClick(task, methodIndex, scopeIndex)}
                  disabled={!group.canEdit}
                  style={{
                    width: '100%',
                    height: 54,
                    borderRadius: 8,
                    border: `2px solid ${isSelected ? (SCORE_BG[cellScore] ?? group.accent) : 'var(--border)'}`,
                    background: cellBg,
                    color: cellColor,
                    fontWeight: isSelected ? 900 : 700,
                    fontSize: isSelected ? 22 : 16,
                    cursor: group.canEdit ? 'pointer' : 'not-allowed',
                    opacity: group.canEdit || isSelected ? 1 : 0.48,
                  }}
                >
                  {cellScore}
                </button>
              );
            }}
          />
        </div>

        <div style={{ marginTop: 24 }}>
          <div className="sd-label-mini">피드백</div>
          <textarea
            value={displayTask.feedback ?? ''}
            onChange={(event) => onFeedbackChange(task.id, event.target.value)}
            disabled={!group.canEdit}
            placeholder="이번 과업에 대한 피드백을 작성하세요."
            rows={6}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: group.canEdit ? 'var(--bg-card)' : 'var(--bg-muted)',
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--fg)',
              resize: 'vertical',
              fontFamily: 'inherit',
              cursor: group.canEdit ? 'text' : 'not-allowed',
            }}
          />
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
              <div
                style={{
                  width: 78,
                  height: 78,
                  borderRadius: 16,
                  background: SCORE_BG[item.score] ?? group.accent,
                  color: '#fff',
                  fontSize: 36,
                  fontWeight: 900,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 12,
                }}
              >
                {item.score}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-muted)' }}>
                {displayTask.contributionMethod || '미정'} × {displayTask.contributionScope || '미정'}
              </div>
            </>
          ) : (
            <div style={{ marginTop: 18, color: 'var(--fg-muted)', fontSize: 13 }}>
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
          <div className="tnum" style={{ marginTop: 8, fontSize: 24, fontWeight: 900, color: group.accent }}>
            {item.score != null ? ((item.score * task.weight) / 100).toFixed(2) : '–'}
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--fg-muted)' }}>
            점수 {item.score ?? '–'} × 가중치 {task.weight}%
          </div>
        </div>

        {!group.canEdit && (
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: '#F8FAFC',
              border: '1px solid var(--border)',
              color: 'var(--fg-muted)',
              fontSize: 12,
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
