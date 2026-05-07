import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, Save } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import { IconSparkle, NumBadge, Pill, type PillTone } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { taskService, evaluationService } from '@/lib/services';
import { useToast } from '@/hooks/use-toast';
import {
  getMatrixScore,
  getMatrixMethodIndex,
  getMatrixScopeIndex,
  MATRIX_METHODS,
  MATRIX_SCOPES,
  MATRIX_SCORE_COLORS,
} from '@/lib/evaluationMatrix';

type TaskDraft = {
  title: string;
  description: string;
  weight: number;
  startDate: string;
  endDate: string;
};

type WeightStatus = {
  tone: PillTone;
  label: string;
  message: string;
  guide: string;
  color: string;
  background: string;
  border: string;
};

type EvaluationStatusMeta = {
  tone: PillTone;
  label: string;
  description: string;
};

const EMPTY_DRAFT: TaskDraft = {
  title: '',
  description: '',
  weight: 0,
  startDate: '',
  endDate: '',
};

const toDateInput = (value?: string) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
};

/* ── 매트릭스 (전 시스템 통일: 우상단=4, X축 아래, Y축 왼쪽) ── */
const METHODS = MATRIX_METHODS;
const SCOPES = MATRIX_SCOPES;
const SCORE_BG = MATRIX_SCORE_COLORS;
const EVALUATEE_TASK_LOCKED_STATUSES = new Set(['submitted', 'evaluating', 'completed', 'locked']);

const formatDate = (value?: string) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getMatrixCoords = (method?: string, scope?: string): { row: number; col: number } | null => {
  const row = getMatrixMethodIndex(method);
  const col = getMatrixScopeIndex(scope);
  if (row < 0 || col < 0) return null;
  return { row, col };
};

const getTaskSuggestion = (score?: number | null) => {
  if (score === 4) {
    return '성과가 충분히 드러난 과업입니다. 다음 반기에는 확산 방식까지 설계하는 편이 좋습니다.';
  }
  if (score === 3) {
    return '현재 수준은 안정적입니다. 기여 범위를 한 단계 더 넓히면 상위 점수에 가까워집니다.';
  }
  if (score === 2) {
    return '실행 근거와 영향 범위를 더 명확히 정리하면 평가 해석이 쉬워집니다.';
  }
  if (score === 1) {
    return '기여 내용은 있으나 임팩트 설명이 부족할 수 있습니다. 구체적 결과를 보강하는 편이 낫습니다.';
  }
  return '평가 전 과업입니다. 시작일, 종료일, 설명과 가중치가 충분한지 먼저 점검하세요.';
};

const getWeightStatus = (totalWeight: number): WeightStatus => {
  if (totalWeight === 100) {
    return {
      tone: 'success',
      label: '100% 완료',
      message: '총합 100%',
      guide: '가중치 조건을 충족했습니다.',
      color: 'var(--success)',
      background: 'rgba(22, 163, 74, 0.10)',
      border: '1px solid rgba(22, 163, 74, 0.45)',
    };
  }

  if (totalWeight > 100) {
    return {
      tone: 'danger',
      label: '초과',
      message: `${totalWeight - 100}% 초과`,
      guide: '임시저장은 가능하지만 최종제출하려면 총합을 100%로 낮춰야 합니다.',
      color: 'var(--danger)',
      background: 'rgba(220, 69, 69, 0.10)',
      border: '1px solid rgba(220, 69, 69, 0.45)',
    };
  }

  return {
    tone: 'warning',
    label: '조정 필요',
    message: `${100 - totalWeight}% 부족`,
    guide: '임시저장은 가능하지만 최종제출하려면 총합을 100%로 맞춰야 합니다.',
    color: 'var(--warning)',
    background: 'var(--bg-muted)',
    border: '1px solid transparent',
  };
};

const getEvaluationStatusMeta = (status?: string): EvaluationStatusMeta => {
  switch (status) {
    case 'submitted':
      return {
        tone: 'info',
        label: '제출 완료',
        description: '평가자 검토 단계로 넘어갔습니다.',
      };
    case 'evaluating':
      return {
        tone: 'orange',
        label: '평가 진행',
        description: '평가자가 점수와 피드백을 작성 중입니다.',
      };
    case 'completed':
      return {
        tone: 'success',
        label: '평가 완료',
        description: '평가가 완료되어 과업을 수정할 수 없습니다.',
      };
    case 'locked':
      return {
        tone: 'neutral',
        label: '잠금',
        description: '평가가 잠겨 과업을 수정할 수 없습니다.',
      };
    case 'in-progress':
      return {
        tone: 'warning',
        label: '작성 중',
        description: '과업을 작성하고 최종제출해 주세요.',
      };
    case 'draft':
    default:
      return {
        tone: 'warning',
        label: '작성 중',
        description: '과업을 작성하고 최종제출해 주세요.',
      };
  }
};

const MyTasksPage = () => {
  const { user } = useAuth();
  const { matrix } = useEvaluationMatrix();
  const { toast } = useToast();
  const {
    evaluationData,
    isLoading,
    reloadData,
    isPeriodEditable,
    periodEditMessage,
  } = useEvaluationDataDB(user?.employeeId || '');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'create'>('view');
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [isSaving, setIsSaving] = useState(false);

  const tasks = useMemo(() => evaluationData?.tasks ?? [], [evaluationData?.tasks]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null,
    [selectedTaskId, tasks],
  );
  const getCurrentScore = (task: {
    contributionMethod?: string | null;
    contributionScope?: string | null;
    score?: number | null;
  }) =>
    getMatrixScore(task.contributionMethod, task.contributionScope, matrix) ??
    task.score ??
    null;
  const selectedScore = selectedTask ? getCurrentScore(selectedTask) : null;
  const totalWeight = tasks.reduce((sum, task) => sum + task.weight, 0);
  const otherTasksWeight =
    mode === 'create' ? totalWeight : totalWeight - (selectedTask?.weight ?? 0);
  const draftTotalWeight = otherTasksWeight + draft.weight;
  const isOverWeight = draftTotalWeight > 100;
  const weightStatus = useMemo(() => getWeightStatus(draftTotalWeight), [draftTotalWeight]);
  const evaluationStatus = evaluationData?.evaluationStatus ?? 'draft';
  const statusMeta = useMemo(() => getEvaluationStatusMeta(evaluationStatus), [evaluationStatus]);
  const isTaskEditingLocked = EVALUATEE_TASK_LOCKED_STATUSES.has(evaluationStatus);
  const taskEditMessage = isTaskEditingLocked
    ? '최종제출 이후에는 과업을 수정할 수 없습니다. 수정이 필요하면 평가자에게 반려를 요청하세요.'
    : periodEditMessage;
  const canEditTasks = isPeriodEditable && !isTaskEditingLocked;
  const hasTitle = draft.title.trim().length > 0;
  const lockedInputStyle = !canEditTasks ? { opacity: 0.68, cursor: 'not-allowed' } : {};

  const showTaskEditLockedToast = () => {
    toast({
      title: '과업을 수정할 수 없습니다.',
      description: taskEditMessage ?? '활성 평가기간에서만 과업을 저장할 수 있습니다.',
      variant: 'destructive',
    });
  };

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);

  /* 선택 과업이 바뀌면 draft를 그 값으로 초기화 (view 모드일 때) */
  useEffect(() => {
    if (mode === 'view') {
      const taskForDraft = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;
      if (!taskForDraft) return;

      setDraft({
        title: taskForDraft.title ?? '',
        description: taskForDraft.description ?? '',
        weight: taskForDraft.weight ?? 0,
        startDate: toDateInput(taskForDraft.startDate),
        endDate: toDateInput(taskForDraft.endDate),
      });
    }
  }, [mode, selectedTaskId, tasks]);

  const startCreate = () => {
    if (!canEditTasks) {
      showTaskEditLockedToast();
      return;
    }
    setMode('create');
    setDraft(EMPTY_DRAFT);
  };

  const cancelCreate = () => {
    setMode('view');
    if (selectedTask) {
      setDraft({
        title: selectedTask.title ?? '',
        description: selectedTask.description ?? '',
        weight: selectedTask.weight ?? 0,
        startDate: toDateInput(selectedTask.startDate),
        endDate: toDateInput(selectedTask.endDate),
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
  };

  const computeNextTaskId = () => {
    const evaluateeId = evaluationData?.evaluateeId;
    if (!evaluateeId) return null;
    const evaluationId = evaluationData.id ?? (evaluationData as any).evaluation_id ?? '';
    const idSuffix = String(evaluationId).slice(0, 8);
    const prefix = idSuffix ? `${evaluateeId}_${idSuffix}_T` : `${evaluateeId}_T`;
    const numbers = tasks
      .map((t) => {
        const m = (t.taskId ?? '').match(new RegExp(`^${prefix}(\\d+)$`));
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `${prefix}${next}`;
  };

  const maybeFinalizeEvaluation = async () => {
    if (!evaluationData) return;
    const evaluationId = evaluationData.id ?? (evaluationData as any).evaluation_id;
    if (!evaluationId) return;
    try {
      await evaluationService.updateEvaluation(evaluationId, {
        evaluation_status: 'submitted',
        last_modified: new Date().toISOString(),
      } as any);
    } catch (err) {
      console.error('평가 상태 업데이트 실패:', err);
      // 실패해도 task 저장은 이미 됐으니 throw 하지 않음
    }
  };

  const handleSave = async (isFinal: boolean) => {
    if (!canEditTasks) {
      showTaskEditLockedToast();
      return;
    }
    if (!draft.title.trim()) {
      toast({
        title: '제목을 입력해 주세요.',
        variant: 'destructive',
      });
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
    if (!evaluationData) return;

    setIsSaving(true);
    try {
      if (mode === 'create') {
        const newTaskId = computeNextTaskId();
        const evaluationId = evaluationData.id ?? (evaluationData as any).evaluation_id;
        if (!newTaskId || !evaluationId) {
          toast({
            title: '평가 정보를 찾을 수 없습니다.',
            description: !newTaskId
              ? '직원 정보를 확인할 수 없습니다.'
              : '평가 레코드 ID가 없습니다. 페이지를 새로고침해 주세요.',
            variant: 'destructive',
          });
          setIsSaving(false);
          return;
        }
        await taskService.createTask({
          task_id: newTaskId,
          evaluation_id: evaluationId,
          title: draft.title.trim(),
          description: draft.description?.trim() || null,
          weight: draft.weight || 0,
          start_date: draft.startDate || null,
          end_date: draft.endDate || null,
          contribution_method: null,
          contribution_scope: null,
          score: null,
          feedback: null,
          feedback_date: null,
          evaluator_name: null,
          deleted_at: null,
        } as any);
        if (isFinal) {
          await maybeFinalizeEvaluation();
        }
        toast({
          title: isFinal ? '과업 등록 및 최종제출 완료' : '과업이 임시저장되었습니다.',
        });
        await reloadData();
        setMode('view');
        // 새로 만든 과업 선택은 reloadData 후 effect에서 처리
        setSelectedTaskId(newTaskId);
      } else {
        if (!selectedTask) return;
        await taskService.updateTask(selectedTask.id, {
          title: draft.title.trim(),
          description: draft.description?.trim() || null,
          weight: draft.weight || 0,
          start_date: draft.startDate || null,
          end_date: draft.endDate || null,
        });
        if (isFinal) {
          await maybeFinalizeEvaluation();
        }
        toast({ title: isFinal ? '최종제출이 완료되었습니다.' : '임시저장되었습니다.' });
        await reloadData();
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
    <>
      <PageHeader
        title="내 과업"
        subtitle={`${user?.name ?? ''}님의 등록 과업과 제출 상태`}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <section
          style={{
            width: 340,
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
                <h3 style={{ marginTop: 2, fontSize: 16 }}>
                  내 과업 <span style={{ color: 'var(--fg-muted)', fontWeight: 500, fontSize: 13 }}>{tasks.length}건</span>
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
                <span style={{ color: 'var(--fg-muted)', fontSize: 11, fontWeight: 700 }}>
                  총 가중치{isDirty ? ' (편집중)' : ''}
                </span>
                <Pill tone={weightStatus.tone}>{weightStatus.label}</Pill>
              </div>
              <div className="flex items-end justify-between gap-3">
                <span className="tnum" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1, color: weightStatus.color }}>
                  {draftTotalWeight}%
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: weightStatus.color }}>
                  {weightStatus.message}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                {weightStatus.guide}
              </div>
            </div>
            {(isTaskEditingLocked || !isPeriodEditable) && (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#FFF7ED',
                  border: '1px solid #FDBA74',
                  color: '#9A3412',
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontWeight: 700,
                }}
              >
                {taskEditMessage}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {isLoading && (
              <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 13 }}>과업을 불러오는 중입니다.</div>
            )}
            {!isLoading &&
              tasks.map((task, index) => {
                const active = mode === 'view' && task.id === selectedTask?.id;
                const taskScore = getCurrentScore(task);
                return (
                  <button
                    key={task.id}
                    onClick={() => {
                      setSelectedTaskId(task.id);
                      setMode('view');
                    }}
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
                      <Pill tone={taskScore == null ? 'neutral' : 'orange'}>
                        T{String(index + 1).padStart(2, '0')}
                      </Pill>
                      <NumBadge score={taskScore} size={22} />
                    </div>
                    <div style={{ fontWeight: active ? 700 : 600, fontSize: 13, lineHeight: 1.45 }}>{task.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6, display: 'flex', gap: 8 }}>
                      <span>{task.contributionMethod || '방식 미정'} · {task.contributionScope || '범위 미정'}</span>
                      <span style={{ color: 'var(--fg-subtle)' }}>·</span>
                      <span>가중치 {task.weight}%</span>
                    </div>
                  </button>
                );
              })}
            {!isLoading && tasks.length === 0 && (
              <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 13 }}>
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
                  <Pill tone={weightStatus.tone}>총 가중치 {draftTotalWeight}%</Pill>
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
                      isSaving ||
                      !canEditTasks ||
                      !hasTitle ||
                      (mode === 'view' && !isDirty)
                    }
                    title={canEditTasks ? '총 가중치가 100%가 아니어도 현재 입력값을 저장합니다.' : taskEditMessage ?? undefined}
                  >
                    <Save size={14} aria-hidden="true" />
                    {isSaving ? '저장 중...' : '임시저장'}
                  </button>
                  <button
                    className="sd-btn sd-btn-primary sd-btn-sm"
                    onClick={() => handleSave(true)}
                    disabled={
                      isSaving ||
                      !canEditTasks ||
                      !hasTitle ||
                      draftTotalWeight !== 100
                    }
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
                </div>
                <input
                  className="sd-input"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  disabled={!canEditTasks}
                  placeholder={mode === 'create' ? '새 과업 제목을 입력하세요' : '과업 제목'}
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: 0,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    ...lockedInputStyle,
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
                <div className="flex flex-col gap-4">
                  <div className="sd-card sd-card-lg">
                    <div className="sd-label-mini">과업 설명</div>
                    <textarea
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      disabled={!canEditTasks}
                      placeholder="과업의 목적·범위·기대 결과를 입력하세요."
                      rows={4}
                      style={{
                        marginTop: 10,
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)',
                        fontSize: 14,
                        lineHeight: 1.7,
                        color: 'var(--fg)',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        ...lockedInputStyle,
                      }}
                    />

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
                            border: `1px solid ${isOverWeight ? 'rgba(220,69,69,0.55)' : 'var(--border)'}`,
                            fontWeight: 700,
                            fontSize: 13,
                            color: isOverWeight ? 'var(--danger)' : 'inherit',
                            background: 'var(--bg-card)',
                            ...lockedInputStyle,
                          }}
                        />
                      </div>

                      <div style={{ padding: 12, background: 'var(--bg-muted)', borderRadius: 8, minWidth: 0 }}>
                        <div className="sd-label-mini">기간</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                          <input
                            type="date"
                            value={draft.startDate}
                            disabled={!canEditTasks}
                            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                            style={{
                              flex: 1,
                              width: '100%',
                              padding: '4px 4px',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              fontSize: 12,
                              background: 'var(--bg-card)',
                              minWidth: 0,
                              ...lockedInputStyle,
                            }}
                          />
                          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>~</span>
                          <input
                            type="date"
                            value={draft.endDate}
                            disabled={!canEditTasks}
                            onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                            style={{
                              flex: 1,
                              width: '100%',
                              padding: '4px 4px',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              fontSize: 12,
                              background: 'var(--bg-card)',
                              minWidth: 0,
                              ...lockedInputStyle,
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ padding: 12, background: 'var(--bg-muted)', borderRadius: 8, minWidth: 0 }}>
                        <div className="sd-label-mini">기여 방식</div>
                        <div style={{ marginTop: 4, fontWeight: 700, fontSize: 13 }}>
                          {mode === 'create'
                            ? '평가자 지정'
                            : selectedTask?.contributionMethod || '미정'}
                        </div>
                      </div>

                      <div style={{ padding: 12, background: 'var(--bg-muted)', borderRadius: 8, minWidth: 0 }}>
                        <div className="sd-label-mini">기여 범위</div>
                        <div style={{ marginTop: 4, fontWeight: 700, fontSize: 13 }}>
                          {mode === 'create'
                            ? '평가자 지정'
                            : selectedTask?.contributionScope || '미정'}
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
                          <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                            평가자 · <b style={{ color: 'var(--fg)' }}>{selectedTask.evaluatorName}</b>
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
                        <div className="flex flex-col gap-3">
                          {selectedTask.feedbackHistory.map((item, index) => (
                            <div
                              key={item.id}
                              style={{
                                padding: 14,
                                border: '1px solid var(--border)',
                                borderRadius: 10,
                                position: 'relative',
                              }}
                            >
                              {index === 0 && (
                                <span style={{ position: 'absolute', top: 12, right: 12 }}>
                                  <Pill tone="orange">최신</Pill>
                                </span>
                              )}
                              <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
                                <div className="sd-avatar sd-avatar-sm">{item.evaluatorName[0]}</div>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 13 }}>{item.evaluatorName}</div>
                                  <div
                                    style={{ fontSize: 11, color: 'var(--fg-subtle)' }}
                                    className="tnum"
                                  >
                                    {formatDateTime(item.date)}
                                  </div>
                                </div>
                              </div>
                              <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--fg)', margin: 0 }}>
                                {item.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  {mode === 'create' && (
                    <div className="sd-card sd-card-lg" style={{ background: 'var(--bg-muted)' }}>
                      <div className="sd-label-mini">새 과업</div>
                      <p
                        style={{
                          marginTop: 10,
                          fontSize: 12,
                          color: 'var(--fg-muted)',
                          lineHeight: 1.6,
                        }}
                      >
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
                            fontSize: 22,
                            fontWeight: 900,
                            color: SCORE_BG[selectedScore] ?? 'var(--fg)',
                            lineHeight: 1,
                          }}
                        >
                          {selectedScore}.0
                        </span>
                      )}
                    </div>

                    {/* 4×4 매트릭스 — 선택된 셀 하이라이트 */}
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
                                fontSize: 10,
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
                                fontSize: 9,
                                fontWeight: 700,
                                color: 'var(--fg-muted)',
                                paddingTop: 4,
                              }}
                            >
                              {scope}
                            </div>
                          )}
                          renderCell={(_, __, mi, si, baseScore) => {
                            const selected = coords?.row === mi && coords?.col === si;
                            const bg = selected
                              ? (SCORE_BG[baseScore] ?? '#78716C')
                              : 'var(--bg-muted)';
                            const color = selected ? '#fff' : 'var(--fg-subtle)';
                            return (
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
                                  fontSize: selected ? 16 : 13,
                                  boxShadow: selected
                                    ? '0 0 0 2px rgba(245,80,0,0.25)'
                                    : 'none',
                                  transition: 'all 0.15s',
                                }}
                              >
                                {baseScore}
                              </div>
                            );
                          }}
                        />
                      );
                    })()}

                    {/* 선택 요약 */}
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
                              fontSize: 12,
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
                            fontSize: 12,
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
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
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

                  {mode === 'view' && selectedTask && (
                  <div
                    className="sd-card"
                    style={{
                      background: 'var(--ok-orange-50)',
                      border: '1px solid var(--ok-orange-100)',
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div style={{ color: 'var(--ok-orange)', marginTop: 2 }}>
                        <IconSparkle width={18} height={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ok-brown)' }}>AI 성장 제안</div>
                        <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ok-brown)', marginTop: 4 }}>
                          {getTaskSuggestion(selectedScore)}
                        </div>
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
    </>
  );
};

export default MyTasksPage;
