import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, Target, Trash2, X } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { SpiralLoader } from '@/components/ui/loader';
import KpiProgressBar, { formatKpiValue } from '@/components/Kpi/KpiProgressBar';
import { kpiService } from '@/lib/services';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { KpiNode, KpiOrgLevel, OrgKpi, TaskKpiAllocation } from '@/types/kpi';

const LEVEL_LABEL: Record<KpiOrgLevel, string> = {
  corporation: '법인',
  division: '본부',
  department: '부',
  team: '팀',
};
const LEVEL_DEPTH: Record<KpiOrgLevel, number> = { corporation: 0, division: 1, department: 2, team: 3 };
const LEVEL_ORDER: KpiOrgLevel[] = ['corporation', 'division', 'department', 'team'];
const UNIT_SUGGESTIONS = ['억', '%', '건', '명', '점', '백만'];

type OrgOptions = Awaited<ReturnType<typeof kpiService.orgOptions>>;

type KpiForm = {
  id: string | null;
  parent_kpi_id: string;
  org_level: KpiOrgLevel;
  org_key: string;
  name: string;
  unit: string;
  target_value: string;
  direction: 'higher' | 'lower';
  description: string;
};

const emptyForm = (level: KpiOrgLevel = 'division'): KpiForm => ({
  id: null,
  parent_kpi_id: '',
  org_level: level,
  org_key: '',
  name: '',
  unit: '억',
  target_value: '',
  direction: 'higher',
  description: '',
});

const flatten = (nodes: KpiNode[], depth = 0, acc: { node: KpiNode; depth: number }[] = []) => {
  for (const n of nodes) {
    acc.push({ node: n, depth });
    if (n.children?.length) flatten(n.children, depth + 1, acc);
  }
  return acc;
};

const OrgBadge = ({ level, orgKey }: { level: KpiOrgLevel; orgKey: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 999,
      background: 'var(--bg-muted)',
      border: '1px solid var(--border)',
      color: 'var(--fg-muted)',
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}
  >
    {LEVEL_LABEL[level]} · {orgKey}
  </span>
);

const KpiManagePage = () => {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { selectedPeriod, selectedPeriodId, isSelectedPeriodEditable, selectedPeriodEditMessage } =
    useEvaluationPeriod();

  const isHr = user?.role === 'hr';
  const isEvaluator = user?.role === 'evaluator';

  const [tree, setTree] = useState<KpiNode[]>([]);
  const [orgOptions, setOrgOptions] = useState<OrgOptions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [form, setForm] = useState<KpiForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const periodId = selectedPeriodId;

  const load = useCallback(async () => {
    if (!periodId) return;
    try {
      setIsLoading(true);
      const [t, o] = await Promise.all([kpiService.tree(periodId), kpiService.orgOptions(periodId)]);
      setTree(t);
      setOrgOptions(o);
    } catch (error) {
      toast({
        title: 'KPI를 불러오지 못했습니다.',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [periodId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => flatten(tree), [tree]);
  const flatKpis = useMemo(() => rows.map((r) => r.node), [rows]);

  const canEditKpi = (k: OrgKpi) =>
    isHr || (isEvaluator && k.created_by === user?.employeeId && k.org_level === 'team');

  const startCreate = (parent?: KpiNode) => {
    if (parent) {
      const childLevelIdx = Math.min(LEVEL_DEPTH[parent.org_level] + 1, 3);
      setForm({
        ...emptyForm(LEVEL_ORDER[childLevelIdx]),
        parent_kpi_id: parent.id,
        unit: parent.unit,
        org_level: LEVEL_ORDER[childLevelIdx],
      });
    } else if (isEvaluator && !isHr) {
      // 평가자: 팀 레벨 + 본인 팀 기본값
      setForm({ ...emptyForm('team'), org_key: orgOptions?.mine.team ?? '' });
    } else {
      setForm(emptyForm('division'));
    }
  };

  const startEdit = (k: OrgKpi) => {
    setForm({
      id: k.id,
      parent_kpi_id: k.parent_kpi_id ?? '',
      org_level: k.org_level,
      org_key: k.org_key,
      name: k.name,
      unit: k.unit,
      target_value: String(k.target_value ?? ''),
      direction: k.direction,
      description: k.description ?? '',
    });
  };

  const parentChoices = useMemo(() => {
    if (!form) return [];
    return flatKpis.filter(
      (k) => k.id !== form.id && LEVEL_DEPTH[k.org_level] < LEVEL_DEPTH[form.org_level] && k.unit === form.unit,
    );
  }, [flatKpis, form]);

  const submitForm = async () => {
    if (!form || !periodId) return;
    const target = Number(form.target_value);
    if (!form.org_key.trim() || !form.name.trim() || !form.unit.trim() || !(target > 0)) {
      toast({ title: '조직·이름·단위·목표(0보다 큰 값)를 확인해 주세요.', variant: 'destructive' });
      return;
    }
    try {
      setSaving(true);
      if (form.id) {
        await kpiService.update(form.id, {
          parent_kpi_id: form.parent_kpi_id || null,
          org_level: form.org_level,
          org_key: form.org_key.trim(),
          name: form.name.trim(),
          unit: form.unit.trim(),
          target_value: target,
          direction: form.direction,
          description: form.description.trim() || null,
        });
      } else {
        await kpiService.create({
          evaluation_period_id: periodId,
          parent_kpi_id: form.parent_kpi_id || null,
          org_level: form.org_level,
          org_key: form.org_key.trim(),
          name: form.name.trim(),
          unit: form.unit.trim(),
          target_value: target,
          direction: form.direction,
          description: form.description.trim() || null,
        });
      }
      setForm(null);
      await load();
      toast({ title: form.id ? 'KPI를 수정했습니다.' : 'KPI를 등록했습니다.' });
    } catch (error) {
      toast({
        title: 'KPI 저장에 실패했습니다.',
        description: error instanceof Error ? error.message : '입력값을 확인해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteKpi = async (k: OrgKpi) => {
    const ok = await confirm({
      title: `"${k.name}" KPI를 삭제할까요?`,
      description: '하위 KPI와 과업 배분도 함께 삭제됩니다.',
      variant: 'danger',
      confirmText: '삭제',
    });
    if (!ok) return;
    try {
      await kpiService.remove(k.id);
      await load();
      toast({ title: 'KPI를 삭제했습니다.' });
    } catch (error) {
      toast({
        title: 'KPI 삭제에 실패했습니다.',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    }
  };

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!periodId) {
    return (
      <>
        <PageHeader title="조직 KPI" subtitle="조직 목표를 등록하고 과업과 정렬합니다." />
        <div style={{ padding: '24px 32px' }}>
          <div className="sd-card" style={{ color: 'var(--fg-muted)' }}>평가기간을 먼저 선택해 주세요.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="조직 KPI"
        subtitle={`${selectedPeriod?.name ?? ''} — 조직 목표를 등록하고 과업과 정렬합니다.`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={load} disabled={isLoading}>
              <RefreshCw size={15} />
              새로고침
            </button>
            <button
              className="sd-btn sd-btn-primary sd-btn-sm"
              onClick={() => startCreate()}
              disabled={!isSelectedPeriodEditable}
              title={!isSelectedPeriodEditable ? selectedPeriodEditMessage ?? undefined : undefined}
            >
              <Plus size={15} />
              KPI 추가
            </button>
          </div>
        }
      />

      <div style={{ padding: '24px 32px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!isSelectedPeriodEditable && (
          <div
            className="sd-card"
            style={{ background: 'var(--bg-muted)', color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}
          >
            {selectedPeriodEditMessage ?? '이 평가기간은 읽기 전용입니다.'} (조회만 가능)
          </div>
        )}

        {isLoading ? (
          <div className="sd-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--fg-muted)' }}>
            <SpiralLoader size={32} />
            KPI를 불러오는 중입니다.
          </div>
        ) : rows.length === 0 ? (
          <div className="sd-card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--fg-muted)' }}>
            <Target size={28} style={{ color: 'var(--fg-subtle)', margin: '0 auto 10px' }} />
            <div style={{ fontWeight: 700, marginBottom: 4 }}>등록된 KPI가 없습니다.</div>
            <div style={{ fontSize: 'var(--fs-sm)' }}>상단 "KPI 추가"로 조직 목표를 등록하세요.</div>
          </div>
        ) : (
          <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
            {rows.map(({ node, depth }) => {
              const isOpen = expanded.has(node.id);
              return (
                <div key={node.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 18px',
                      paddingLeft: 18 + depth * 24,
                      background: depth > 0 ? 'var(--bg-subtle)' : 'var(--bg-card)',
                    }}
                  >
                    <button
                      onClick={() => toggleExpand(node.id)}
                      className="sd-btn sd-btn-ghost sd-btn-xs"
                      style={{ flexShrink: 0, padding: 4 }}
                      title="배분 내역"
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div style={{ minWidth: 0, flex: '1 1 280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: 'var(--fs-body)' }}>{node.name}</span>
                        <OrgBadge level={node.org_level} orgKey={node.org_key} />
                        {node.children?.length ? (
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                            하위 {node.children.length}
                          </span>
                        ) : null}
                      </div>
                      {node.description && (
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 3 }}>{node.description}</div>
                      )}
                    </div>
                    <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                      <KpiProgressBar
                        achieved={node.rolled_achieved}
                        target={node.target_value}
                        unit={node.unit}
                        allocated={node.rolled_allocated}
                        compact
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        className="sd-btn sd-btn-ghost sd-btn-xs"
                        onClick={() => startCreate(node)}
                        disabled={!isSelectedPeriodEditable || node.org_level === 'team' || !isHr}
                        title={node.org_level === 'team' ? '팀 아래 하위 KPI는 없습니다.' : !isHr ? 'HR만 하위 KPI를 추가할 수 있습니다.' : '하위 KPI 추가'}
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        className="sd-btn sd-btn-outline sd-btn-xs"
                        onClick={() => startEdit(node)}
                        disabled={!isSelectedPeriodEditable || !canEditKpi(node)}
                      >
                        <Pencil size={14} />
                      </button>
                      {isHr && (
                        <button
                          className="sd-btn sd-btn-ghost sd-btn-xs"
                          onClick={() => deleteKpi(node)}
                          disabled={!isSelectedPeriodEditable}
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <AllocationPanel
                      kpiId={node.id}
                      unit={node.unit}
                      editable={isSelectedPeriodEditable && (isHr || isEvaluator)}
                      onChanged={load}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {form && (
        <KpiFormModal
          form={form}
          setForm={setForm}
          orgOptions={orgOptions}
          parentChoices={parentChoices}
          isHr={isHr}
          saving={saving}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
        />
      )}
    </>
  );
};

// ── 배분 내역 패널 (실적 인라인 편집) ─────────────────────────────
const AllocationPanel = ({
  kpiId,
  unit,
  editable,
  onChanged,
}: {
  kpiId: string;
  unit: string;
  editable: boolean;
  onChanged: () => void;
}) => {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [allocs, setAllocs] = useState<(TaskKpiAllocation & { evaluatee_name?: string })[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const detail = await kpiService.get(kpiId);
      setAllocs(detail.allocations as (TaskKpiAllocation & { evaluatee_name?: string })[]);
      setDrafts(
        Object.fromEntries(
          (detail.allocations as TaskKpiAllocation[]).map((a) => [a.id, a.achieved_value == null ? '' : String(a.achieved_value)]),
        ),
      );
    } catch (error) {
      toast({
        title: '배분 내역을 불러오지 못했습니다.',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
      setAllocs([]);
    }
  }, [kpiId, toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveAchieved = async (a: TaskKpiAllocation) => {
    const raw = drafts[a.id];
    const achieved = raw === '' || raw == null ? null : Number(raw);
    if (achieved != null && Number.isNaN(achieved)) {
      toast({ title: '실적은 숫자로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    try {
      setBusyId(a.id);
      await kpiService.upsertAllocations(kpiId, [
        {
          task_uuid: a.task_uuid,
          task_id: a.task_id,
          evaluation_id: a.evaluation_id,
          allocated_target: a.allocated_target,
          achieved_value: achieved,
          note: a.note ?? null,
        },
      ]);
      await reload();
      onChanged();
      toast({ title: '실적을 저장했습니다.' });
    } catch (error) {
      toast({
        title: '실적 저장 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const removeAlloc = async (a: TaskKpiAllocation) => {
    const ok = await confirm({ title: '이 과업 배분을 해제할까요?', variant: 'danger', confirmText: '해제' });
    if (!ok) return;
    try {
      setBusyId(a.id);
      await kpiService.removeAllocation(kpiId, a.id);
      await reload();
      onChanged();
      toast({ title: '배분을 해제했습니다.' });
    } catch (error) {
      toast({
        title: '배분 해제 실패',
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ background: 'var(--bg-muted)', padding: '12px 18px 16px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 800, color: 'var(--fg-subtle)', letterSpacing: '0.06em', marginBottom: 8 }}>
        과업 배분 · 실적
      </div>
      {allocs == null ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>불러오는 중…</div>
      ) : allocs.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
          배분된 과업이 없습니다. 평가 화면의 과업 카드에서 이 KPI에 정렬하세요.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allocs.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>{a.evaluatee_name ?? '피평가자'}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                  배분 {formatKpiValue(a.allocated_target, unit)}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
                실적
                <input
                  className="sd-input"
                  style={{ width: 110 }}
                  inputMode="decimal"
                  value={drafts[a.id] ?? ''}
                  disabled={!editable}
                  onChange={(e) => setDrafts((p) => ({ ...p, [a.id]: e.target.value }))}
                />
                <span style={{ color: 'var(--fg-muted)' }}>{unit}</span>
              </label>
              {editable && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sd-btn sd-btn-primary sd-btn-xs" onClick={() => saveAchieved(a)} disabled={busyId === a.id}>
                    저장
                  </button>
                  <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={() => removeAlloc(a)} disabled={busyId === a.id} style={{ color: 'var(--danger)' }}>
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── KPI 등록/수정 모달 ─────────────────────────────────────────
const KpiFormModal = ({
  form,
  setForm,
  orgOptions,
  parentChoices,
  isHr,
  saving,
  onSubmit,
  onClose,
}: {
  form: KpiForm;
  setForm: (f: KpiForm) => void;
  orgOptions: OrgOptions | null;
  parentChoices: OrgKpi[];
  isHr: boolean;
  saving: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) => {
  const levelOptions: KpiOrgLevel[] = isHr ? LEVEL_ORDER : ['team'];
  const orgKeyChoices = orgOptions ? orgOptions[form.org_level] : [];

  const set = (patch: Partial<KpiForm>) => setForm({ ...form, ...patch });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sd-card sd-card-lg"
        style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 900 }}>{form.id ? 'KPI 수정' : '새 KPI'}</h2>
          <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            조직 레벨
            <select
              className="sd-input"
              value={form.org_level}
              disabled={!isHr}
              onChange={(e) => set({ org_level: e.target.value as KpiOrgLevel, org_key: '', parent_kpi_id: '' })}
            >
              {levelOptions.map((lv) => (
                <option key={lv} value={lv}>
                  {LEVEL_LABEL[lv]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            조직
            <input
              className="sd-input"
              list="kpi-org-keys"
              value={form.org_key}
              onChange={(e) => set({ org_key: e.target.value })}
              placeholder={`${LEVEL_LABEL[form.org_level]}명`}
            />
            <datalist id="kpi-org-keys">
              {orgKeyChoices.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800, gridColumn: 'span 2' }}>
            KPI 이름
            <input className="sd-input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 기업여신 총금액" />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            목표값
            <input className="sd-input" inputMode="decimal" value={form.target_value} onChange={(e) => set({ target_value: e.target.value })} placeholder="5000" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            단위
            <input className="sd-input" list="kpi-units" value={form.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="억" />
            <datalist id="kpi-units">
              {UNIT_SUGGESTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            방향
            <select className="sd-input" value={form.direction} onChange={(e) => set({ direction: e.target.value as 'higher' | 'lower' })}>
              <option value="higher">높을수록 좋음</option>
              <option value="lower">낮을수록 좋음</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            상위 KPI (선택)
            <select
              className="sd-input"
              value={form.parent_kpi_id}
              onChange={(e) => set({ parent_kpi_id: e.target.value })}
              disabled={parentChoices.length === 0}
            >
              <option value="">없음 (최상위)</option>
              {parentChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  [{LEVEL_LABEL[p.org_level]}] {p.name}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800, gridColumn: 'span 2' }}>
            설명 (선택)
            <textarea
              className="sd-input"
              rows={2}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              style={{ resize: 'vertical' }}
            />
          </label>
        </div>

        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 10 }}>
          상위 KPI는 같은 단위·상위 레벨만 선택할 수 있고, 실적은 하위에서 자동 합산됩니다.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={onClose}>
            취소
          </button>
          <button className="sd-btn sd-btn-primary sd-btn-sm" onClick={onSubmit} disabled={saving}>
            {saving ? '저장 중…' : form.id ? '수정' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KpiManagePage;
