import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Target, X } from 'lucide-react';
import { kpiService } from '@/lib/services';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import KpiProgressBar, { formatKpiValue } from '@/components/Kpi/KpiProgressBar';
import type { OrgKpi, TaskKpiAllocation } from '@/types/kpi';

const LEVEL_LABEL: Record<string, string> = { corporation: '법인', division: '본부', department: '부', team: '팀' };

type Props = {
  taskUuid: string;
  taskId: string;
  evaluationId: string;
  canEdit: boolean;
};

// 평가 화면 과업 카드 하단 — 그 과업이 정렬된 조직 KPI를 "참고 지표"로 강조(부분 반영).
// 팀장/HR 은 여기서 KPI 정렬을 추가하고 목표 배분·실적을 입력한다(점수 산식과 무관).
const TaskKpiPanel = ({ taskUuid, taskId, evaluationId, canEdit }: Props) => {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [allocs, setAllocs] = useState<TaskKpiAllocation[] | null>(null);
  const [candidates, setCandidates] = useState<OrgKpi[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [evaluateeOrg, setEvaluateeOrg] = useState<{
    corporation: string | null;
    division: string | null;
    department: string | null;
    team: string | null;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ kpiId: string; allocated: string; achieved: string }>({
    kpiId: '',
    allocated: '',
    achieved: '',
  });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await kpiService.allocationsByTask(taskUuid);
      setAllocs(list);
    } catch {
      setAllocs([]);
    }
  }, [taskUuid]);

  useEffect(() => {
    reload();
  }, [reload]);

  const alignedKpiIds = useMemo(() => new Set((allocs ?? []).map((a) => a.kpi_id)), [allocs]);
  const availableCandidates = useMemo(
    () => candidates.filter((c) => !alignedKpiIds.has(c.id)),
    [candidates, alignedKpiIds],
  );

  const openAdd = async () => {
    setAdding(true);
    setCandLoading(true);
    try {
      const res = await kpiService.candidatesForEvaluation(evaluationId);
      setCandidates(res.candidates);
      setEvaluateeOrg(res.evaluatee_org);
    } catch (error) {
      toast({
        title: '정렬 가능한 KPI를 불러오지 못했습니다.',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setCandLoading(false);
    }
  };

  // 빈 상태 원인 안내 — 어떤 조직 기준으로 후보를 찾았는지 함께 보여준다.
  const evaluateeOrgLabel = evaluateeOrg
    ? [evaluateeOrg.corporation, evaluateeOrg.division, evaluateeOrg.department, evaluateeOrg.team]
        .filter(Boolean)
        .join(' > ')
    : '';

  const saveAlignment = async () => {
    if (!form.kpiId) {
      toast({ title: '정렬할 KPI를 선택해 주세요.', variant: 'destructive' });
      return;
    }
    const allocated = form.allocated === '' ? 0 : Number(form.allocated);
    const achieved = form.achieved === '' ? null : Number(form.achieved);
    if (Number.isNaN(allocated) || (achieved != null && Number.isNaN(achieved))) {
      toast({ title: '목표·실적은 숫자로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    try {
      setBusy(true);
      await kpiService.upsertAllocations(form.kpiId, [
        { task_uuid: taskUuid, task_id: taskId, evaluation_id: evaluationId, allocated_target: allocated, achieved_value: achieved },
      ]);
      setAdding(false);
      setForm({ kpiId: '', allocated: '', achieved: '' });
      await reload();
      toast({ title: 'KPI 정렬을 저장했습니다.' });
    } catch (error) {
      toast({
        title: 'KPI 정렬 저장 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const removeAlloc = async (a: TaskKpiAllocation) => {
    const ok = await confirm({ title: `"${a.kpi_name}" 정렬을 해제할까요?`, variant: 'danger', confirmText: '해제' });
    if (!ok) return;
    try {
      setBusy(true);
      await kpiService.removeAllocation(a.kpi_id, a.id);
      await reload();
      toast({ title: '정렬을 해제했습니다.' });
    } catch (error) {
      toast({
        title: '정렬 해제 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  // 정렬도 없고 편집 불가면 영역을 숨겨 화면을 깔끔하게 유지.
  if ((allocs == null || allocs.length === 0) && !canEdit) return null;

  return (
    <div
      style={{
        marginTop: 22,
        padding: '14px 16px',
        borderRadius: 8,
        border: '1px solid var(--ok-orange-100)',
        background: 'var(--ok-orange-50)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Target size={15} color="var(--ok-orange)" />
          <span style={{ fontWeight: 800, fontSize: 'var(--fs-body)', color: 'var(--ok-orange-700)' }}>조직 KPI 정렬</span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>참고 지표 · 점수와 별개</span>
        </div>
        {canEdit && !adding && (
          <button className="sd-btn sd-btn-outline sd-btn-xs" onClick={openAdd}>
            <Plus size={13} />
            KPI 정렬
          </button>
        )}
      </div>

      {allocs && allocs.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {allocs.map((a) => (
            <div key={a.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
                  {a.kpi_name}
                  <span style={{ marginLeft: 6, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                    {a.kpi_org_level ? LEVEL_LABEL[a.kpi_org_level] : ''} · {a.kpi_org_key}
                  </span>
                </span>
                {canEdit && (
                  <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={() => removeAlloc(a)} disabled={busy} style={{ color: 'var(--danger)', padding: 3 }}>
                    <X size={13} />
                  </button>
                )}
              </div>
              <KpiProgressBar achieved={a.achieved_value} target={a.kpi_target} unit={a.kpi_unit ?? ''} direction={a.kpi_direction} compact />
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 4 }}>
                이 과업 배분 {formatKpiValue(a.allocated_target, a.kpi_unit ?? '')}
                {a.achieved_value != null ? ` · 실적 ${formatKpiValue(a.achieved_value, a.kpi_unit ?? '')}` : ' · 실적 미입력'}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !adding && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
            정렬된 KPI가 없습니다.{canEdit ? ' "KPI 정렬"로 이 과업을 조직 목표에 연결하세요.' : ''}
          </div>
        )
      )}

      {adding && (
        <div style={{ marginTop: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {candLoading ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>정렬 가능한 KPI를 불러오는 중…</div>
          ) : availableCandidates.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              {candidates.length > 0
                ? '후보 KPI가 모두 이미 이 과업에 정렬되어 있습니다.'
                : `피평가자 조직${evaluateeOrgLabel ? `(${evaluateeOrgLabel})` : ''}과 일치하는 KPI가 없습니다. 먼저 "조직 KPI" 메뉴에서 이 조직명으로 등록하세요.`}
            </div>
          ) : (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
                KPI
                <select className="sd-input" value={form.kpiId} onChange={(e) => setForm((p) => ({ ...p, kpiId: e.target.value }))}>
                  <option value="">선택…</option>
                  {availableCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{LEVEL_LABEL[c.org_level]}·{c.org_key}] {c.name} (목표 {formatKpiValue(c.target_value, c.unit)})
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 'var(--fs-sm)', fontWeight: 700, flex: 1 }}>
                  이 과업 목표 배분
                  <input className="sd-input" inputMode="decimal" value={form.allocated} onChange={(e) => setForm((p) => ({ ...p, allocated: e.target.value }))} placeholder="0" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 'var(--fs-sm)', fontWeight: 700, flex: 1 }}>
                  실적 (선택)
                  <input className="sd-input" inputMode="decimal" value={form.achieved} onChange={(e) => setForm((p) => ({ ...p, achieved: e.target.value }))} placeholder="미입력" />
                </label>
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={() => setAdding(false)}>
              취소
            </button>
            {availableCandidates.length > 0 && (
              <button className="sd-btn sd-btn-primary sd-btn-xs" onClick={saveAlignment} disabled={busy}>
                저장
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskKpiPanel;
