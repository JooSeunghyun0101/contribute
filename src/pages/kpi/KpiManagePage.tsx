import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, RefreshCw, Target, Trash2, X } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { SpiralLoader } from '@/components/ui/loader';
import KpiProgressBar, { formatKpiValue } from '@/components/Kpi/KpiProgressBar';
import { kpiService } from '@/lib/services';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { KpiNode, KpiOrgChoice, KpiOrgLevel, OrgKpi } from '@/types/kpi';

const LEVEL_LABEL: Record<KpiOrgLevel, string> = {
  corporation: '법인',
  division: '본부',
  department: '부',
  team: '팀',
};
const LEVEL_DEPTH: Record<KpiOrgLevel, number> = { corporation: 0, division: 1, department: 2, team: 3 };
const LEVEL_ORDER: KpiOrgLevel[] = ['corporation', 'division', 'department', 'team'];
const UNIT_SUGGESTIONS = ['억', '%', '건', '명', '점', '백만'];
// 레벨별 좌측 액센트 색 — 트리에서 계층을 한눈에 구분.
const LEVEL_ACCENT: Record<KpiOrgLevel, string> = {
  corporation: 'var(--ok-brown, #6B4423)',
  division: 'var(--ok-orange)',
  department: 'var(--ok-yellow-700, #B8860B)',
  team: 'var(--fg-subtle)',
};

type OrgOptions = Awaited<ReturnType<typeof kpiService.orgOptions>>;

type KpiForm = {
  id: string | null;
  parent_kpi_id: string;
  org_level: KpiOrgLevel;
  org_key: string;
  // 상위 조직 경로 — 정형화 드롭다운 선택 시 함께 채워져 동명 조직을 구분('' = 미지정/레거시).
  org_path_corporation: string;
  org_path_division: string;
  org_path_department: string;
  name: string;
  unit: string;
  target_value: string;
  direction: 'higher' | 'lower';
  /** 실적 직접 입력('' = 미입력) — 과업 배분 제거 후 KPI 단독 관리. */
  achieved_value: string;
  description: string;
};

const emptyForm = (level: KpiOrgLevel = 'division'): KpiForm => ({
  id: null,
  parent_kpi_id: '',
  org_level: level,
  org_key: '',
  org_path_corporation: '',
  org_path_division: '',
  org_path_department: '',
  name: '',
  unit: '억',
  target_value: '',
  direction: 'higher',
  achieved_value: '',
  description: '',
});

// 경로 튜플 → 선택 키(법인|본부|부|팀, 레벨까지) — 서버 leaders/orgChoices 키와 동일 규칙.
const choicePathKey = (t: KpiOrgChoice, level: KpiOrgLevel): string => {
  const parts: string[] = [];
  for (const l of LEVEL_ORDER) {
    parts.push(t[l] ?? '');
    if (l === level) break;
  }
  return parts.join('|');
};
const choiceLabel = (t: KpiOrgChoice): string =>
  [t.corporation, t.division, t.department, t.team].filter(Boolean).join(' › ');

// 조직 튜플이 어떤 KPI(부모)의 하위 조직인가 — 부모 레벨 값 일치 + 부모의 상위 경로와 충돌 없음.
const choiceUnderParent = (c: KpiOrgChoice, parent: OrgKpi): boolean => {
  if (c[parent.org_level] !== parent.org_key) return false;
  for (const l of LEVEL_ORDER) {
    if (LEVEL_DEPTH[l] >= LEVEL_DEPTH[parent.org_level]) break;
    const pv =
      l === 'corporation'
        ? parent.org_path_corporation
        : l === 'division'
          ? parent.org_path_division
          : parent.org_path_department;
    if (pv && c[l] !== pv) return false;
  }
  return true;
};
// 선택지 튜플 → 폼 필드 반영(조상 경로까지 함께).
const applyChoiceToForm = (base: KpiForm, level: KpiOrgLevel, choice: KpiOrgChoice): KpiForm => ({
  ...base,
  org_level: level,
  org_key: choice[level] ?? '',
  org_path_corporation: level !== 'corporation' ? choice.corporation ?? '' : '',
  org_path_division: LEVEL_DEPTH[level] > LEVEL_DEPTH.division ? choice.division ?? '' : '',
  org_path_department: LEVEL_DEPTH[level] > LEVEL_DEPTH.department ? choice.department ?? '' : '',
});

// 폼 상태 → 선택 키(조상 경로 + 해당 레벨 org_key). 서버 kpiTupleKey 와 동일하게 빈 계층도
// '' 조각으로 포함한다 — 중간 계층이 원래 없는 조직(예: 본부 없는 법인)이 레거시로 오인되지 않게.
// org_key 가 없을 때만 null(미선택).
const formPathKey = (form: KpiForm): string | null => {
  if (!form.org_key) return null;
  const parts: string[] = [];
  for (const l of LEVEL_ORDER) {
    if (l === form.org_level) {
      parts.push(form.org_key);
      break;
    }
    parts.push(
      l === 'corporation'
        ? form.org_path_corporation
        : l === 'division'
          ? form.org_path_division
          : form.org_path_department,
    );
  }
  return parts.join('|');
};

const flatten = (nodes: KpiNode[], depth = 0, acc: { node: KpiNode; depth: number }[] = []) => {
  for (const n of nodes) {
    acc.push({ node: n, depth });
    if (n.children?.length) flatten(n.children, depth + 1, acc);
  }
  return acc;
};

const OrgBadge = ({ level, orgKey, path }: { level: KpiOrgLevel; orgKey: string; path?: string }) => (
  <span
    title={path || undefined}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 9px',
      borderRadius: 999,
      background: 'var(--bg-muted)',
      border: '1px solid var(--border)',
      color: 'var(--fg-muted)',
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}
  >
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: LEVEL_ACCENT[level], flexShrink: 0 }} />
    <span style={{ fontWeight: 800 }}>{LEVEL_LABEL[level]}</span>
    <span style={{ color: 'var(--fg)' }}>{orgKey}</span>
  </span>
);

const StatBox = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)', padding: '14px 16px' }}>
    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 700 }}>{label}</div>
    <div className="tnum" style={{ marginTop: 6, fontSize: 'var(--fs-h3)', fontWeight: 900, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ marginTop: 3, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{sub}</div>}
  </div>
);

const KpiManagePage = () => {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { selectedPeriod, selectedPeriodId, isSelectedPeriodEditable, selectedPeriodEditMessage } =
    useEvaluationPeriod();

  const isHr = user?.role === 'hr';

  const [tree, setTree] = useState<KpiNode[]>([]);
  const [orgOptions, setOrgOptions] = useState<OrgOptions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [form, setForm] = useState<KpiForm | null>(null);
  // '하위 KPI 추가'로 열렸을 때의 부모 — 조직 선택지를 그 부모 조직 하위로 한정.
  const [seedParent, setSeedParent] = useState<KpiNode | null>(null);
  const [saving, setSaving] = useState(false);

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
  const summary = useMemo(() => {
    const total = flatKpis.length;
    const withTarget = flatKpis.filter((k) => (k.target_value ?? 0) > 0);
    const avg = withTarget.length
      ? Math.round((withTarget.reduce((s, k) => s + Math.min(1, k.progress ?? 0), 0) / withTarget.length) * 100)
      : 0;
    const achieved = flatKpis.filter((k) => (k.progress ?? 0) >= 1).length;
    return { total, avg, achieved, roots: tree.length };
  }, [flatKpis, tree]);

  const startCreate = (parent?: KpiNode) => {
    setSeedParent(parent ?? null);
    if (parent) {
      const childLevel = LEVEL_ORDER[Math.min(LEVEL_DEPTH[parent.org_level] + 1, 3)];
      setForm({
        ...emptyForm(childLevel),
        parent_kpi_id: parent.id,
        unit: parent.unit,
      });
    } else {
      // 가장 상위의 선택 가능 레벨을 기본으로. 선택지가 1개뿐이면 미리 채운다.
      const choices = orgOptions?.orgChoices;
      const lvl = LEVEL_ORDER.find((l) => (choices?.[l]?.length ?? 0) > 0) ?? (isHr ? 'division' : 'team');
      const opts = choices?.[lvl] ?? [];
      const base = emptyForm(lvl);
      setForm(opts.length === 1 ? applyChoiceToForm(base, lvl, opts[0]) : base);
    }
  };

  const startEdit = (k: OrgKpi) => {
    setSeedParent(null);
    setForm({
      id: k.id,
      parent_kpi_id: k.parent_kpi_id ?? '',
      org_level: k.org_level,
      org_key: k.org_key,
      org_path_corporation: k.org_path_corporation ?? '',
      org_path_division: k.org_path_division ?? '',
      org_path_department: k.org_path_department ?? '',
      name: k.name,
      unit: k.unit,
      target_value: String(k.target_value ?? ''),
      direction: k.direction,
      achieved_value: k.achieved_value == null ? '' : String(k.achieved_value),
      description: k.description ?? '',
    });
  };

  const submitForm = async () => {
    if (!form || !periodId) return;
    const target = Number(form.target_value);
    if (!form.org_key.trim() || !form.name.trim() || !form.unit.trim() || !(target > 0)) {
      toast({ title: '조직·이름·단위·목표(0보다 큰 값)를 확인해 주세요.', variant: 'destructive' });
      return;
    }
    const achievedRaw = form.achieved_value.trim();
    const achieved = achievedRaw === '' ? null : Number(achievedRaw);
    if (achieved !== null && !Number.isFinite(achieved)) {
      toast({ title: '실적은 숫자로 입력해 주세요.', variant: 'destructive' });
      return;
    }
    try {
      setSaving(true);
      // 조직은 정형화 드롭다운에서 온 경로 튜플('' → null) — 서버가 실존 조합인지 재검증한다.
      const orgPayload = {
        org_level: form.org_level,
        org_key: form.org_key.trim(),
        org_path_corporation: form.org_path_corporation.trim() || null,
        org_path_division: form.org_path_division.trim() || null,
        org_path_department: form.org_path_department.trim() || null,
      };
      if (form.id) {
        await kpiService.update(form.id, {
          parent_kpi_id: form.parent_kpi_id || null,
          ...orgPayload,
          name: form.name.trim(),
          unit: form.unit.trim(),
          target_value: target,
          direction: form.direction,
          achieved_value: achieved,
          description: form.description.trim() || null,
        });
      } else {
        await kpiService.create({
          evaluation_period_id: periodId,
          parent_kpi_id: form.parent_kpi_id || null,
          ...orgPayload,
          name: form.name.trim(),
          unit: form.unit.trim(),
          target_value: target,
          direction: form.direction,
          achieved_value: achieved,
          description: form.description.trim() || null,
        });
      }
      setForm(null);
      setSeedParent(null);
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
      description: '하위 KPI도 함께 삭제됩니다.',
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

  if (!periodId) {
    return (
      <>
        <PageHeader title="조직 KPI" subtitle="조직 목표를 등록하고 실적·달성률을 관리합니다." />
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
        subtitle={`${selectedPeriod?.name ?? ''} — 조직 목표를 등록하고 실적·달성률을 관리합니다.`}
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

        {/* 범위 규칙 안내 — 스코프 모델은 화면만 봐서는 알 수 없어 반드시 명시한다. */}
        {orgOptions?.scopeInfo && orgOptions.scopeInfo.mode !== 'all' && (
          <div
            className="sd-card"
            style={{
              background: 'var(--ok-orange-50)',
              border: '1px solid var(--ok-orange-100)',
              color: 'var(--fg-muted)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.6,
            }}
          >
            <b style={{ color: 'var(--ok-orange-700)' }}>보이는 범위</b> —{' '}
            <>
              <b>내가 조직장인 조직과 그 하위 조직</b>의 KPI를 등록·관리할 수 있고, 그 KPI가 연결된 상위
              KPI는 <b>읽기 전용</b>으로 함께 표시됩니다. (조직장 = 조직 구성원을 직접·간접으로 모두
              평가하는 내부 최상위 평가자)
            </>
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
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 12,
              }}
            >
              <StatBox label="전체 KPI" value={`${summary.total}개`} sub={`최상위 ${summary.roots}개`} />
              <StatBox label="평균 달성률" value={`${summary.avg}%`} />
              <StatBox label="달성 완료" value={`${summary.achieved}개`} sub={`목표 100% 이상`} />
              <StatBox label="평가기간" value={selectedPeriod?.evaluation_year ? `${selectedPeriod.evaluation_year}` : '-'} sub={selectedPeriod?.name ?? ''} />
            </div>

            <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
            {rows.map(({ node, depth }) => {
              // 범위 밖 상위 KPI — 롤업 맥락용으로 트리에 포함되지만 관리(수정·삭제·하위추가·실적)는 불가.
              const readOnly = node.can_manage === false;
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
                      borderLeft: `3px solid ${LEVEL_ACCENT[node.org_level]}`,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: 'var(--fs-body)' }}>{node.name}</span>
                        {readOnly && (
                          <span
                            style={{
                              fontSize: 'var(--fs-xs)',
                              fontWeight: 700,
                              color: 'var(--fg-subtle)',
                              border: '1px solid var(--border)',
                              borderRadius: 999,
                              padding: '1px 8px',
                              background: 'var(--bg-muted)',
                            }}
                            title="내 범위 밖의 상위 조직 KPI — 하위 KPI의 롤업 맥락을 보여주기 위해 표시됩니다."
                          >
                            읽기 전용
                          </span>
                        )}
                        <OrgBadge
                          level={node.org_level}
                          orgKey={node.org_key}
                          path={[
                            node.org_path_corporation,
                            node.org_path_division,
                            node.org_path_department,
                            node.org_key,
                          ]
                            .filter(Boolean)
                            .join(' › ')}
                        />
                        {(() => {
                          // 동명 조직 구분 — 조직장(체인 최상위 평가자)을 경로 키로 조회해 표기.
                          // 경로 판별: 새 폼으로 저장된 KPI 는 법인 경로가 반드시 채워진다(중간 계층은
                          // 원래 없어서 NULL 일 수 있음). 법인 경로까지 없는 비-법인 KPI = 레거시 → 라벨 생략.
                          const pathKnown =
                            node.org_level === 'corporation' || Boolean(node.org_path_corporation);
                          const parts: string[] = [];
                          for (const l of LEVEL_ORDER) {
                            const v =
                              l === node.org_level
                                ? node.org_key
                                : l === 'corporation'
                                  ? node.org_path_corporation
                                  : l === 'division'
                                    ? node.org_path_division
                                    : node.org_path_department;
                            parts.push(v ?? '');
                            if (l === node.org_level) break;
                          }
                          const names = pathKnown
                            ? orgOptions?.leaders?.[node.org_level]?.[parts.join('|')]
                            : undefined;
                          return names?.length ? (
                            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                              조직장 {names[0]}
                            </span>
                          ) : null;
                        })()}
                        {depth === 0 && node.parent_kpi_id && node.parent_name && (
                          // 비-HR 트리는 가시성 밖 부모를 재루팅해 최상위처럼 보이므로, 연결 사실을 표기.
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                            ↑ 상위: {node.parent_name}
                          </span>
                        )}
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
                        direction={node.direction}
                        hasActuals={node.has_actuals}
                        compact
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {(() => {
                        // 하위 조직 조합이 하나도 없으면(팀 데이터 없는 부 등) 죽은 모달 대신 버튼을 비활성.
                        const choices = orgOptions?.orgChoices;
                        const hasChildOrg =
                          node.org_level !== 'team' &&
                          (!choices ||
                            LEVEL_ORDER.slice(LEVEL_DEPTH[node.org_level] + 1).some((lvl) =>
                              (choices[lvl] ?? []).some((c) => choiceUnderParent(c, node)),
                            ));
                        return (
                          <button
                            className="sd-btn sd-btn-ghost sd-btn-xs"
                            onClick={() => startCreate(node)}
                            disabled={!isSelectedPeriodEditable || !hasChildOrg || readOnly}
                            title={
                              readOnly
                                ? '내 범위 밖의 상위 조직 KPI(읽기 전용)입니다.'
                                : node.org_level === 'team'
                                  ? '팀 아래 하위 KPI는 없습니다.'
                                  : !hasChildOrg
                                    ? '이 조직 하위에 등록 가능한 조직이 없습니다(이 평가기간 평가 대상 기준).'
                                    : '하위 KPI 추가'
                            }
                          >
                            <Plus size={14} />
                          </button>
                        );
                      })()}
                      <button
                        className="sd-btn sd-btn-outline sd-btn-xs"
                        onClick={() => startEdit(node)}
                        disabled={!isSelectedPeriodEditable || readOnly}
                        title={readOnly ? '내 범위 밖의 상위 조직 KPI(읽기 전용)입니다.' : '수정'}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="sd-btn sd-btn-ghost sd-btn-xs"
                        onClick={() => deleteKpi(node)}
                        disabled={!isSelectedPeriodEditable || readOnly}
                        style={{ color: 'var(--danger)' }}
                        title={readOnly ? '내 범위 밖의 상위 조직 KPI(읽기 전용)입니다.' : '삭제'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>

      {form && (
        <KpiFormModal
          form={form}
          setForm={setForm}
          orgOptions={orgOptions}
          periodId={periodId}
          seedParent={seedParent}
          hasChildren={Boolean(form.id && flatKpis.find((k) => k.id === form.id)?.children?.length)}
          isHr={isHr}
          saving={saving}
          onSubmit={submitForm}
          onClose={() => {
            setForm(null);
            setSeedParent(null);
          }}
        />
      )}
    </>
  );
};

// ── KPI 등록/수정 모달 ─────────────────────────────────────────
const KpiFormModal = ({
  form,
  setForm,
  orgOptions,
  periodId,
  seedParent,
  hasChildren,
  isHr,
  saving,
  onSubmit,
  onClose,
}: {
  form: KpiForm;
  setForm: (f: KpiForm) => void;
  orgOptions: OrgOptions | null;
  periodId: string;
  seedParent: OrgKpi | null;
  /** 수정 대상에 하위 KPI 가 있으면 실적 직접 입력 대신 하위 합산을 안내. */
  hasChildren: boolean;
  isHr: boolean;
  saving: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) => {
  const confirm = useConfirm();
  // 레벨 선택지 = 조직 선택지가 있는 레벨만(HR=전체 데이터, 비-HR=본인 평가 범위).
  // '하위 KPI 추가'로 열렸으면 부모보다 아래 레벨만.
  const levelOptions: KpiOrgLevel[] = LEVEL_ORDER.filter(
    (l) =>
      (orgOptions?.orgChoices?.[l]?.length ?? 0) > 0 &&
      (!seedParent || LEVEL_DEPTH[l] > LEVEL_DEPTH[seedParent.org_level]),
  );

  // 조직 선택지 — 정형화 경로 튜플. seedParent 가 있으면 그 부모 조직 하위 조합으로 한정.
  const orgChoiceList = useMemo(() => {
    const all = orgOptions?.orgChoices?.[form.org_level] ?? [];
    if (!seedParent) return all;
    return all.filter((c) => choiceUnderParent(c, seedParent));
  }, [orgOptions, form.org_level, seedParent]);

  const selectedOrgKey = formPathKey(form);
  const selectedChoice = selectedOrgKey
    ? orgChoiceList.find((c) => choicePathKey(c, form.org_level) === selectedOrgKey) ?? null
    : null;
  // 레거시(경로 미저장) KPI 수정: 현재 값을 유지하는 합성 옵션을 노출해 수정 진입을 막지 않는다.
  const legacyOrg = Boolean(form.org_key && !selectedChoice);

  // 상위 KPI 연결 후보 — 조직·단위가 정해지면 서버에서 상위 경로의 같은 단위 KPI 를 조회.
  // 생성자-체인 가시성과 무관하므로 팀장이 본부장 KPI 에도 연결할 수 있다.
  const [parentOptions, setParentOptions] = useState<OrgKpi[]>([]);
  const [parentLoading, setParentLoading] = useState(false);
  const unitTrimmed = form.unit.trim();
  useEffect(() => {
    let cancelled = false;
    if (!form.org_key || !unitTrimmed || form.org_level === 'corporation') {
      setParentOptions([]);
      // 직전 fetch 가 in-flight 인 채 이 분기로 오면 cleanup(cancelled) 때문에 finally 가
      // 로딩을 못 풀어 '불러오는 중…'이 고착된다 — 여기서 명시적으로 해제.
      setParentLoading(false);
      return;
    }
    setParentLoading(true);
    kpiService
      .parentCandidates({
        periodId,
        orgLevel: form.org_level,
        unit: unitTrimmed,
        corporation: form.org_path_corporation.trim() || undefined,
        division: form.org_path_division.trim() || undefined,
        department: form.org_path_department.trim() || undefined,
      })
      .then((rows) => {
        if (!cancelled) setParentOptions(rows.filter((r) => r.id !== form.id));
      })
      .catch(() => {
        if (!cancelled) setParentOptions([]);
      })
      .finally(() => {
        if (!cancelled) setParentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    periodId,
    form.id,
    form.org_level,
    form.org_key,
    unitTrimmed,
    form.org_path_corporation,
    form.org_path_division,
    form.org_path_department,
  ]);

  const set = (patch: Partial<KpiForm>) => setForm({ ...form, ...patch });

  // 이탈 보호 — 바깥 클릭·X·취소 모두, 입력이 변경됐으면 확인을 거친다.
  const initialFormRef = useRef(form);
  const requestClose = async () => {
    const dirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
    if (dirty) {
      const ok = await confirm({
        title: '작성 중인 내용을 닫을까요?',
        description: '저장하지 않은 입력이 사라집니다.',
        variant: 'danger',
        confirmText: '닫기',
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <div
      onClick={requestClose}
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
          <button className="sd-btn sd-btn-ghost sd-btn-xs" onClick={requestClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            조직 레벨
            <select
              className="sd-input"
              value={form.org_level}
              disabled={levelOptions.length <= 1}
              onChange={(e) =>
                set({
                  org_level: e.target.value as KpiOrgLevel,
                  org_key: '',
                  org_path_corporation: '',
                  org_path_division: '',
                  org_path_department: '',
                  parent_kpi_id: seedParent ? form.parent_kpi_id : '',
                })
              }
            >
              {levelOptions.map((lv) => (
                <option key={lv} value={lv}>
                  {LEVEL_LABEL[lv]}
                </option>
              ))}
            </select>
            {levelOptions.length === 0 && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 500 }}>
                이 평가기간에 조직 데이터가 없어 KPI를 등록할 수 없습니다.
              </span>
            )}
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800, gridColumn: 'span 2' }}>
            조직
            {/* 정형화 드롭다운 — 실제 평가 데이터의 조직 조합(경로 포함)만 선택 가능. 동명 조직은 경로·조직장으로 구분. */}
            <select
              className="sd-input"
              value={legacyOrg ? '__legacy__' : selectedChoice ? choicePathKey(selectedChoice, form.org_level) : ''}
              disabled={orgChoiceList.length === 0 && !legacyOrg}
              onChange={(e) => {
                const choice = orgChoiceList.find((c) => choicePathKey(c, form.org_level) === e.target.value);
                if (!choice) return;
                setForm({
                  ...applyChoiceToForm(form, form.org_level, choice),
                  // 조직이 바뀌면 상위 KPI 후보도 달라진다 — 하위 추가로 고정된 부모가 아니면 초기화.
                  parent_kpi_id: seedParent ? form.parent_kpi_id : '',
                });
              }}
            >
              <option value="">선택…</option>
              {legacyOrg && (
                <option value="__legacy__" disabled>
                  (현재) {form.org_key} — 경로 미지정(레거시)
                </option>
              )}
              {orgChoiceList.map((c) => (
                <option key={choicePathKey(c, form.org_level)} value={choicePathKey(c, form.org_level)}>
                  {choiceLabel(c)}
                  {c.leader ? ` — 조직장 ${c.leader}` : ''}
                </option>
              ))}
            </select>
            {selectedChoice?.leader && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 500 }}>
                조직장(평가자): {selectedChoice.leader}
              </span>
            )}
            {legacyOrg && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 500 }}>
                이 KPI는 조직 경로가 저장되지 않은 이전 형식입니다. 목록에서 다시 선택하면 경로가 채워집니다.
              </span>
            )}
            {orgChoiceList.length === 0 && !legacyOrg && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 500 }}>
                {seedParent
                  ? `'${seedParent.org_key}' 하위에 등록 가능한 ${LEVEL_LABEL[form.org_level]} 조직이 없습니다(이 평가기간에 해당 조직 평가 대상 없음).`
                  : `이 평가기간에 선택 가능한 ${LEVEL_LABEL[form.org_level]} 조직이 없습니다.`}
              </span>
            )}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800, gridColumn: 'span 2' }}>
            KPI 이름
            <input className="sd-input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 기업여신 총금액" />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
            목표값
            {/* 숫자 전용 — 문자 입력 자체를 차단(type=number). */}
            <input
              className="sd-input"
              type="number"
              inputMode="decimal"
              step="any"
              value={form.target_value}
              onChange={(e) => set({ target_value: e.target.value })}
              placeholder="5000"
            />
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
            {/* 후보 = 이 조직의 '상위 경로'에 있는 같은 단위 KPI(가시성 무관) — 팀장이 본부 KPI에 직접 연결 가능. */}
            <select
              className="sd-input"
              value={form.parent_kpi_id}
              onChange={(e) => set({ parent_kpi_id: e.target.value })}
              disabled={parentLoading || (parentOptions.length === 0 && !form.parent_kpi_id)}
            >
              <option value="">없음 (최상위)</option>
              {form.parent_kpi_id && !parentOptions.some((p) => p.id === form.parent_kpi_id) && (
                <option value={form.parent_kpi_id}>
                  {seedParent?.name ? `(선택됨) ${seedParent.name}` : '(기존 상위 KPI 연결 유지)'}
                </option>
              )}
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  [{LEVEL_LABEL[p.org_level]}·{p.org_key}] {p.name} (목표 {formatKpiValue(p.target_value, p.unit)})
                </option>
              ))}
            </select>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 500 }}>
              {parentLoading
                ? '상위 KPI 후보를 불러오는 중…'
                : form.org_level === 'corporation'
                  ? '법인 KPI는 최상위입니다.'
                  : !form.org_key
                    ? '조직을 먼저 선택하면 연결 가능한 상위 KPI가 표시됩니다.'
                    : parentOptions.length === 0 && !form.parent_kpi_id
                      ? '연결 가능한 상위 KPI가 없습니다 — 상위 조직에 같은 단위의 KPI가 등록돼 있어야 합니다.'
                      : '실적은 상위 KPI로 자동 합산됩니다.'}
            </span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 800, gridColumn: 'span 2' }}>
            실적 (선택)
            <input
              className="sd-input"
              type="number"
              inputMode="decimal"
              step="any"
              value={form.achieved_value}
              disabled={hasChildren}
              onChange={(e) => set({ achieved_value: e.target.value })}
              placeholder={hasChildren ? '' : '미입력'}
            />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 500 }}>
              {hasChildren
                ? '하위 KPI가 연결된 KPI는 실적이 하위에서 자동 합산됩니다(직접 입력 불가).'
                : '이 KPI의 실적을 직접 입력합니다. 상위 KPI가 있으면 자동 합산됩니다.'}
            </span>
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

        {['%', '점'].includes(form.unit.trim()) && (
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--ok-orange-700)',
              background: 'var(--ok-orange-50)',
              border: '1px solid var(--ok-orange-100)',
              borderRadius: 8,
              padding: '8px 10px',
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            %·점 같은 비율/점수형 단위는 하위 KPI 실적이 <b>단순 합산</b>되어 왜곡될 수 있습니다(예: 88점+92점=180점).
            하위 연결 없이 단독으로 쓰거나 합산 가능한 단위(억·건·명)를 권장합니다.
          </div>
        )}

        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 10 }}>
          상위 KPI는 같은 단위·상위 레벨만 선택할 수 있고, 실적은 하위에서 자동 합산됩니다.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={requestClose}>
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
