import { useEffect, useState } from 'react';
import { LoadingState } from '@/components/ui/state-views';
import { Pill } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useReason } from '@/components/ui/confirm-dialog';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { evaluationService, taskService, taskEvaluationEntryService } from '@/lib/services';
import {
  EvaluatorAccordion,
  resolveTaskScore,
  toScoreSummary,
  type EvaluatorGroup,
  type EvaluatorTaskView,
} from '@/components/Evaluation/EvaluatorReview';
import type { Task as DbTask, TaskEvaluationEntry as DbEntry } from '@/types';
import type { Task, TaskEvaluationEntry } from '@/types/evaluation';

const STATUS_LABEL: Record<string, string> = {
  'not-started': '시작 전',
  draft: '작성 중',
  'in-progress': '작성 중',
  submitted: '검토 대기',
  evaluating: '평가 중',
  completed: '완료',
  locked: '잠금',
};
const statusTone = (status?: string): 'success' | 'orange' | 'warning' | 'info' | 'neutral' => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'locked':
      return 'neutral';
    case 'evaluating':
      return 'info';
    case 'submitted':
      return 'orange';
    default:
      return 'warning';
  }
};

const entryTime = (e: DbEntry) => {
  const d = e.updated_at || e.feedback_date || e.created_at;
  const t = d ? new Date(d).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
};

type GroupMeta = { group: EvaluatorGroup; status: string };
type EvaluateeMeta = { name: string; position: string; department: string; growthLevel: number };

/**
 * 피평가자 한 명의 평가를 '읽기 전용'으로 렌더한다(이동 시 평가자별로 분리 표시).
 * HR 열람과 부서장 열람이 공유한다.
 * - enableEditRequest=true(HR): 평가자별 '수정요청' 버튼 노출(상태 변경 없음, 알림만).
 * - enableEditRequest=false(부서장 등): 순수 읽기 — 액션 없음.
 */
export const EvaluationReadonlyView = ({
  evaluateeId,
  initialTaskId,
  enableEditRequest = false,
  requestOrigin = 'hr',
}: {
  evaluateeId: string;
  initialTaskId?: string | null;
  enableEditRequest?: boolean;
  requestOrigin?: 'hr';
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const askReason = useReason();
  const { matrix } = useEvaluationMatrix();
  const { selectedPeriodId } = useEvaluationPeriod();

  const [groups, setGroups] = useState<GroupMeta[]>([]);
  const [meta, setMeta] = useState<EvaluateeMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string>>({});
  const [requestingId, setRequestingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 그 기간의 모든 평가 레코드(= 이동 시 평가자별로 분리됨)를 불러온다.
        const evals = await evaluationService.getEvaluationsByEmployeeId(evaluateeId, {
          periodId: selectedPeriodId,
        });
        const built = await Promise.all(
          evals.map(async (ev, idx): Promise<GroupMeta> => {
            const [dbTasksRaw, dbEntriesRaw] = await Promise.all([
              ev.id ? taskService.getTasksByEvaluationId(ev.id).catch(() => [] as DbTask[]) : Promise.resolve([] as DbTask[]),
              ev.id
                ? taskEvaluationEntryService.getEntriesByEvaluationId(ev.id).catch(() => [] as DbEntry[])
                : Promise.resolve([] as DbEntry[]),
            ]);
            const dbTasks = (dbTasksRaw as DbTask[]).filter((t) => !t.deleted_at);
            const entriesByTask = new Map<string, DbEntry[]>();
            for (const e of dbEntriesRaw as DbEntry[]) {
              if ((e.status ?? 'active') !== 'active') continue;
              const arr = entriesByTask.get(e.task_uuid) ?? [];
              arr.push(e);
              entriesByTask.set(e.task_uuid, arr);
            }
            const views: EvaluatorTaskView[] = dbTasks.map((dbt) => {
              const latest = (entriesByTask.get(dbt.id) ?? [])
                .slice()
                .sort((a, b) => entryTime(b) - entryTime(a))[0] ?? null;
              const task: Task = {
                id: dbt.id,
                taskId: dbt.task_id,
                evaluation_id: ev.id,
                title: dbt.title,
                description: dbt.description ?? '',
                weight: dbt.weight,
                isAiTask: dbt.is_ai_task ?? false,
                startDate: dbt.start_date ?? undefined,
                endDate: dbt.end_date ?? undefined,
                contributionMethod: latest ? latest.contribution_method ?? undefined : dbt.contribution_method ?? undefined,
                contributionScope: latest ? latest.contribution_scope ?? undefined : dbt.contribution_scope ?? undefined,
                score: latest ? latest.score ?? undefined : dbt.score ?? undefined,
                feedback: latest ? latest.feedback ?? undefined : dbt.feedback ?? undefined,
                feedbackDate: latest ? latest.feedback_date ?? undefined : dbt.feedback_date ?? undefined,
                evaluatorName: latest ? latest.evaluator_name ?? undefined : dbt.evaluator_name ?? undefined,
              };
              // 저장 시점 AI 검수 결과(ai_*)를 camelCase entry 로 매핑해 검수 카드에 그대로 전달한다.
              const entry: TaskEvaluationEntry | null = latest
                ? {
                    id: latest.id,
                    taskUuid: latest.task_uuid,
                    taskId: dbt.task_id,
                    evaluationId: ev.id,
                    evaluatorId: latest.evaluator_id ?? ev.evaluator_id ?? '',
                    evaluatorName: latest.evaluator_name ?? ev.evaluator_name ?? '',
                    status: (latest.status as 'active' | 'cancelled' | undefined) ?? 'active',
                    contributionMethod: latest.contribution_method ?? null,
                    contributionScope: latest.contribution_scope ?? null,
                    score: latest.score ?? null,
                    feedback: latest.feedback ?? null,
                    feedbackDate: latest.feedback_date ?? null,
                    aiFlagged: latest.ai_flagged ?? null,
                    aiSummary: latest.ai_summary ?? null,
                    aiType: latest.ai_type ?? null,
                    aiReviewedAt: latest.ai_reviewed_at ?? null,
                  }
                : null;
              return { task, displayTask: task, score: resolveTaskScore(task, matrix), hasDraft: false, entry };
            });
            const summary = toScoreSummary(views);
            const isCurrent = idx === 0; // 엔드포인트가 현재(최신 배정/draft) 평가를 먼저 정렬해 반환.
            const group: EvaluatorGroup = {
              key: `eval:${ev.id}`,
              evaluationId: ev.id,
              evaluatorId: ev.evaluator_id ?? '',
              evaluatorName: ev.evaluator_name ?? '평가자 미배정',
              label: isCurrent ? '현재 평가' : '이전 평가',
              description: '과업별 평가 내역 (읽기 전용)',
              accent: isCurrent ? 'var(--ok-orange)' : 'var(--fg-muted)',
              mutedAccent: isCurrent ? 'var(--ok-orange-50)' : 'var(--bg-muted)',
              canEdit: false,
              isOwnedByCurrentUser: false,
              isCurrentAssignment: isCurrent,
              tasks: views,
              ...summary,
            };
            return { group, status: ev.evaluation_status };
          }),
        );
        if (cancelled) return;
        const first = evals[0];
        setMeta(
          first
            ? {
                name: first.evaluatee_name,
                position: first.evaluatee_position,
                department: first.evaluatee_department,
                growthLevel: first.growth_level && first.growth_level > 0 ? first.growth_level : 1,
              }
            : null,
        );
        setGroups(built);
        // 특정 과업으로 진입(AI검수 등)했으면 그 과업이 든 평가자 그룹을 펼치고 해당 과업을 선택한다.
        const targetGroup = initialTaskId
          ? built.find((b) => b.group.tasks.some((t) => t.task.id === initialTaskId))
          : undefined;
        if (targetGroup) {
          setExpandedKeys(new Set([targetGroup.group.key]));
          setSelectedByGroup({ [targetGroup.group.key]: initialTaskId as string });
        } else {
          setExpandedKeys(new Set(built.length ? [built[0].group.key] : []));
          setSelectedByGroup({});
        }
      } catch (err) {
        console.error('평가 열람 로드 실패:', err);
        if (!cancelled) {
          setError('평가 데이터를 불러오지 못했습니다.');
          setGroups([]);
          setMeta(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evaluateeId, selectedPeriodId, matrix, initialTaskId]);

  const handleRequestEdit = async (evaluationId: string | undefined, evaluatorName: string) => {
    if (!evaluationId) {
      toast({ title: '수정요청 불가', description: '연결된 평가 레코드가 없습니다.', variant: 'destructive' });
      return;
    }
    if (!user?.employeeId) {
      toast({ title: '수정요청 불가', description: '요청자 정보를 확인할 수 없습니다.', variant: 'destructive' });
      return;
    }
    const reason = await askReason({
      title: `${meta?.name ?? '피평가자'} 평가 수정요청 · ${evaluatorName}`,
      description:
        `${evaluatorName} 평가자에게 전달할 수정요청 사유를 입력해 주세요. (선택) ※ 평가 상태는 변경되지 않으며 알림만 발송됩니다.`,
      placeholder: '수정요청 사유 (선택)',
      confirmText: '수정요청 보내기',
    });
    if (reason === null) return;
    setRequestingId(evaluationId);
    try {
      await evaluationService.requestReturn(evaluationId, {
        requestedBy: user.employeeId,
        reason: reason.trim() || undefined,
        origin: requestOrigin,
      });
      toast({
        title: '수정요청을 보냈습니다.',
        description: `${evaluatorName} 평가자에게 수정요청 알림이 전달되었습니다. (상태 변경 없음)`,
      });
    } catch (err) {
      console.error('수정요청 실패:', err);
      toast({ title: '수정요청 실패', description: '잠시 후 다시 시도해 주세요.', variant: 'destructive' });
    } finally {
      setRequestingId(null);
    }
  };

  if (isLoading) {
    return <LoadingState message="평가 데이터를 불러오는 중입니다…" />;
  }
  if (error) {
    return <div className="sd-card" style={{ color: 'var(--danger)' }}>{error}</div>;
  }
  if (groups.length === 0) {
    return <div className="sd-card" style={{ color: 'var(--fg-muted)' }}>선택한 기간에 이 피평가자의 평가가 없습니다.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 피평가자 요약 */}
      {meta && (
        <div className="sd-card" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 'var(--fs-h3)', fontWeight: 900 }}>
            {meta.name}{' '}
            <span style={{ fontWeight: 600, color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>{meta.position}</span>
          </h2>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>{meta.department}</span>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>Lv.{meta.growthLevel}</span>
          {groups.length > 1 && <Pill tone="info">평가자 {groups.length}명 (이동)</Pill>}
        </div>
      )}

      {groups.map(({ group, status }) => {
        const isExpanded = expandedKeys.has(group.key);
        const selectedTaskId = selectedByGroup[group.key] || group.tasks[0]?.task.id;
        const selectedItem = group.tasks.find((t) => t.task.id === selectedTaskId) ?? group.tasks[0];
        return (
          <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 평가자별 상태 바 (+ HR 한정 수정요청) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800 }}>평가자 {group.evaluatorName}</span>
                <Pill tone={statusTone(status)}>{STATUS_LABEL[status] ?? status}</Pill>
                {group.isCurrentAssignment ? (
                  <Pill tone="orange">현재</Pill>
                ) : (
                  <Pill tone="neutral">이전</Pill>
                )}
              </div>
              {enableEditRequest && (
                <button
                  className="sd-btn sd-btn-primary sd-btn-sm"
                  onClick={() => handleRequestEdit(group.evaluationId, group.evaluatorName)}
                  disabled={requestingId === group.evaluationId}
                  title={`${group.evaluatorName} 평가자에게 수정요청 알림을 보냅니다. (평가 상태는 변경되지 않음)`}
                >
                  {requestingId === group.evaluationId ? '전송 중…' : '이 평가자에게 수정요청'}
                </button>
              )}
            </div>

            <EvaluatorAccordion
              group={group}
              isExpanded={isExpanded}
              selectedItem={selectedItem}
              selectedTaskId={selectedItem?.task.id}
              periodLabel={null}
              growthLevel={meta?.growthLevel ?? 1}
              onToggle={() =>
                setExpandedKeys((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
              onSelectTask={(taskId) => setSelectedByGroup((prev) => ({ ...prev, [group.key]: taskId }))}
              onCellClick={() => {}}
              onNoContributionClick={() => {}}
              onFeedbackChange={() => {}}
              matrix={matrix}
            />
          </div>
        );
      })}
    </div>
  );
};

export default EvaluationReadonlyView;
