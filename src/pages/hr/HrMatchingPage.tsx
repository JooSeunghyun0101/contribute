import { useMemo, useState } from 'react';
import { employeeService } from '@/lib/services';
import PageHeader from '@/components/Layout/PageHeader';
import { EvaluationPeriodSelector } from '@/components/Layout/EvaluationPeriodSelector';
import { IconSearch, Pill, type PillTone } from '@/components/brand';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCompanyDashboardRecords, useAllEmployees } from '@/hooks/useDashboardRecords';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import OrgChecklist from '@/components/hr/OrgChecklist';
import { getOrgValue, matchesOrgNodes } from '@/lib/orgHierarchy';
import {
  assignmentTypeLabel,
  formatAssignmentDate,
  isBulkMatchingHistory,
} from '@/lib/evaluatorHistory';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';
import type { Employee, EvaluationPeriod, EvaluatorAssignmentHistory } from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// 매칭 1:1 정합성 점검 (점검=read-only, 개별 재배정=명시적 write 공존)
//
// 이 화면은 "경고판"이 아니라 "점검 명세서"다. 분류·요약·드릴다운은 데이터 쓰기를 하지
// 않으며, 모든 판정은 이미 로드된 employee/record 컬럼(NULL·문자열 비교)만으로 수행한다.
// per-employee 추가 호출은 행을 펼치는 드릴다운에서만(lazy) 일어난다.
//
// 단, 점검에서 드러난 행을 그 자리에서 바로잡을 수 있도록 드릴다운에 "평가자 변경"
// 액션(개별 재배정)을 제공한다. 이 write 는 HR 이 명시적으로 새 평가자를 고르고 확인
// 모달을 거친 경우에만 호출되며, 자동 쓰기는 없다. 재배정은 기존 PUT /api/employee/:id
// (HrUsersPage.addAssignmentChange 와 동일한 경로)를 재사용해 단일 트랜잭션에서
// employees.evaluator_id(마스터) 동기화 + evaluator_assignment_history 새 행(change/applied)
// 추가를 함께 수행한다. 이전 배정/평가는 삭제·취소하지 않고 보존(발령=정상)한다.
//
// [절대 규칙] 피평가자에게 평가자가 여럿/평가가 여럿인 것은 "발령(전보)"으로 인한 정상
// 케이스다. 절대 "중복"으로 플래그하지 않는다. 발령 흔적은 중립(neutral) 정보로만 안내하고,
// 행을 펼칠 때 발령 타임라인을 "이전 평가 내역"으로 보존 표시한다.
// ────────────────────────────────────────────────────────────────────────────

type RuleKind = 'anomaly' | 'neutral-info';

type RuleKey =
  | 'unassigned' // 미배정 (평가자 NULL)
  | 'no-evaluation' // 평가 레코드 없음 (해당 기간 미생성)
  | 'self-eval' // 자기평가 후보 (사번 = 평가자 사번)
  | 'transfer-trace' // 평가자 변경 이력 있음 (발령 가능)
  | 'evaluator-unknown'; // 평가자 신원 미확인 (참조 무결성 정보)

type RuleDef = {
  key: RuleKey;
  name: string;
  kind: RuleKind;
  /** 요약 칩 / 섹션 헤더 카운트 색조. anomaly 는 warning/info 까지만, neutral 은 neutral. danger 금지. */
  tone: PillTone;
  kindLabel: string;
  description: string;
};

const RULES: RuleDef[] = [
  {
    key: 'unassigned',
    name: '미배정 (평가자 미지정)',
    kind: 'anomaly',
    tone: 'warning',
    kindLabel: '점검',
    description: '평가 대상자이나 평가자가 지정되지 않은 행입니다. (employees.evaluator_id 가 비어 있음)',
  },
  {
    key: 'no-evaluation',
    name: '평가 레코드 없음 (해당 기간 미생성)',
    kind: 'anomaly',
    tone: 'info',
    kindLabel: '점검',
    description: '평가자는 지정돼 있으나 선택한 평가기간에 평가 레코드가 아직 생성되지 않은 행입니다.',
  },
  {
    key: 'self-eval',
    name: '자기평가 후보 (사번 = 평가자 사번)',
    kind: 'anomaly',
    tone: 'warning',
    kindLabel: '점검',
    description:
      '본인 사번이 평가자 사번과 같은 행입니다. 입력 오류일 수도, 발령 과정의 일시 상태일 수도 있어 "후보"로만 표시합니다.',
  },
  {
    key: 'transfer-trace',
    name: '평가자 변경 이력 있음 (발령 가능)',
    kind: 'neutral-info',
    tone: 'neutral',
    kindLabel: '정보',
    description:
      '최신 발령 평가자가 직원 마스터의 평가자와 다른 행입니다. 발령(전보)으로 인한 정상 케이스일 수 있어 이상이 아닌 중립 정보로만 안내합니다. 행을 펼치면 발령 타임라인을 확인할 수 있습니다.',
  },
  {
    key: 'evaluator-unknown',
    name: '평가자 신원 미확인 (참조 정보)',
    kind: 'neutral-info',
    tone: 'neutral',
    kindLabel: '정보',
    description:
      '평가자 사번 값은 있으나 현재 직원 목록에서 그 사번을 찾지 못한 행입니다. 외부 발령자·퇴직자 등 정상 사유가 흔하므로 이상이 아닌 점검 정보로만 표시합니다.',
  },
];

type CheckRow = {
  record: EmployeeEvaluationRecord;
  /** 이 행이 속한 규칙들(한 행이 여러 규칙에 해당할 수 있음). */
  rules: Set<RuleKey>;
};

const kindBadgeTone = (kind: RuleKind): PillTone => (kind === 'anomaly' ? 'orange' : 'neutral');

const evaluatorCell = (record: EmployeeEvaluationRecord): string =>
  record.evaluation?.evaluator_name ?? record.employee.evaluator_id ?? '-';

const HrMatchingPage = () => {
  const { records, isLoading, error, reload: reloadRecords } = useCompanyDashboardRecords();
  // 평가자 사번 → 직원 매핑(평가자 신원 확인용). 평가 점수/과업은 쓰지 않는 가벼운 로드.
  // 동시에 재배정 시 평가자 후보 풀로 재사용한다(추가 API 호출 없음).
  const { employees: allEmployees, reload: reloadEmployees } = useAllEmployees();
  const { selectedPeriod } = useEvaluationPeriod();
  const { user } = useAuth();
  const { toast } = useToast();
  const actorId = user?.employeeId ?? user?.id ?? null;

  const [searchQuery, setSearchQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [jobRole, setJobRole] = useState('');
  const [openSections, setOpenSections] = useState<Set<RuleKey>>(
    () => new Set<RuleKey>(['unassigned', 'no-evaluation', 'self-eval']),
  );

  // 이미 로드된 직원 사번 집합(평가자 신원 확인용). useAllEmployees 가 비면 records 로 폴백.
  const knownEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    const source = allEmployees.length ? allEmployees : records.map((r) => r.employee);
    for (const emp of source) ids.add(emp.employee_id);
    return ids;
  }, [allEmployees, records]);

  // 재배정용 평가자 후보 — 이미 로드된 allEmployees 만 사용(추가 호출 없음).
  // HrUsersPage.evaluatorOptions 와 동일한 필터: admin·잘못된 사번 제외, evaluator 역할만, 부서→이름 정렬.
  const evaluatorCandidates = useMemo(
    () =>
      allEmployees
        .filter((employee) => employee.employee_id !== 'admin')
        .filter((employee) => !/^[A-Za-z]/.test(employee.employee_id))
        .filter((employee) => employee.available_roles?.includes('evaluator'))
        .sort(
          (a, b) =>
            a.department.localeCompare(b.department, 'ko') || a.name.localeCompare(b.name, 'ko'),
        ),
    [allEmployees],
  );

  // 사번 → 이름 매핑(재배정 확인 모달에서 평가자명 표시용).
  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const emp of allEmployees) map.set(emp.employee_id, emp.name);
    return map;
  }, [allEmployees]);

  const jobRoleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      const role = r.employee.job_role?.trim();
      if (role) set.add(role);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [records]);

  // 점검 대상: 평가 대상자(evaluatee) 롤 직원만. (평가자/HR 전용은 매칭 점검 대상 아님)
  const targetRecords = useMemo(
    () => records.filter((r) => r.employee.available_roles?.includes('evaluatee')),
    [records],
  );

  // org/직종/검색 필터 적용.
  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return targetRecords.filter((r) => {
      if (!matchesOrgNodes(r.employee, orgFilter)) return false;
      if (jobRole && (r.employee.job_role ?? '') !== jobRole) return false;
      if (!q) return true;
      const haystack = [
        r.employee.employee_id,
        r.employee.name,
        r.employee.evaluator_id ?? '',
        r.evaluation?.evaluator_name ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [targetRecords, orgFilter, jobRole, searchQuery]);

  // 각 규칙별 분류. 모두 NULL/문자열 비교만 — 추가 호출 없음.
  const { rowsByRule, checkRows, ruleCounts } = useMemo(() => {
    const byRule = new Map<RuleKey, CheckRow[]>();
    for (const rule of RULES) byRule.set(rule.key, []);
    const rows: CheckRow[] = [];

    for (const record of filteredRecords) {
      const emp = record.employee;
      const matched = new Set<RuleKey>();

      const evaluatorId = emp.evaluator_id;
      const hasEvaluator = evaluatorId != null && String(evaluatorId).trim() !== '';

      // 1) 미배정 — 평가자 사번이 비어 있음 (100% 객관적 NULL 체크).
      if (!hasEvaluator) {
        matched.add('unassigned');
      }

      // 2) 평가 레코드 없음 — 평가자는 있으나 선택 기간에 evaluation 이 null.
      if (hasEvaluator && record.evaluation == null) {
        matched.add('no-evaluation');
      }

      // 3) 자기평가 후보 — 본인 사번 === 평가자 사번 (1차 신호만, 100% 객관적).
      if (hasEvaluator && emp.employee_id === evaluatorId) {
        matched.add('self-eval');
      }

      // 4) 평가자 변경 이력 있음(발령 가능) — 최신 발령 평가자(evaluation.evaluator_id)가
      //    직원 마스터 평가자(employee.evaluator_id)와 다름. 중립 정보로만.
      const latestEvaluatorId = record.evaluation?.evaluator_id;
      if (
        hasEvaluator &&
        latestEvaluatorId != null &&
        String(latestEvaluatorId).trim() !== '' &&
        latestEvaluatorId !== evaluatorId
      ) {
        matched.add('transfer-trace');
      }

      // 5) 평가자 신원 미확인 — 평가자 사번이 직원 목록에 없음(외부/퇴직 등 정상 사유 가능).
      if (hasEvaluator && evaluatorId !== emp.employee_id && !knownEmployeeIds.has(evaluatorId)) {
        matched.add('evaluator-unknown');
      }

      if (matched.size > 0) {
        const row: CheckRow = { record, rules: matched };
        rows.push(row);
        for (const key of matched) byRule.get(key)!.push(row);
      }
    }

    const counts = new Map<RuleKey, number>();
    for (const rule of RULES) counts.set(rule.key, byRule.get(rule.key)!.length);

    return { rowsByRule: byRule, checkRows: rows, ruleCounts: counts };
  }, [filteredRecords, knownEmployeeIds]);

  const toggleSection = (key: RuleKey) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const periodLabel = selectedPeriod
    ? `${selectedPeriod.name} · ${selectedPeriod.evaluation_year}`
    : '평가기간 미선택';

  // 드릴다운 슬라이드 상태.
  const [drilldown, setDrilldown] = useState<{
    record: EmployeeEvaluationRecord;
    rules: Set<RuleKey>;
  } | null>(null);

  // 개별 재배정(평가자 변경) 상태. reassignTarget 이 설정된 동안에만 모달이 열린다.
  // reassigningId 가 차 있으면 해당 직원 호출이 진행 중(중복 클릭 방지).
  const [reassignTarget, setReassignTarget] = useState<EmployeeEvaluationRecord | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  // 명시적 "평가자 변경" 확정 — 기존 PUT /api/employee/:id 재사용.
  // 단일 트랜잭션에서 (1) evaluator_assignment_history 새 행(change/applied) 추가,
  // (2) employees.evaluator_id(마스터) 동기화를 함께 수행한다(server.js:4135-4180).
  // 이전 배정/평가는 삭제하지 않고 보존(발령=정상).
  const handleReassign = async (employee: Employee, newEvaluatorId: string) => {
    // 게이트(필수): 활성 평가기간 선택 + 동일 평가자/자기평가 차단.
    // ★ 이 PUT 경로에는 self-eval 서버 가드가 없으므로 프런트가 유일한 게이트다.
    if (!selectedPeriod || selectedPeriod.status !== 'active') {
      toast({
        title: '활성 평가기간을 선택해 주세요.',
        description: '재배정은 활성(active) 평가기간에서만 가능합니다.',
        variant: 'destructive',
      });
      return;
    }
    if (!newEvaluatorId) return;
    if (newEvaluatorId === employee.employee_id) {
      toast({
        title: '자기 자신은 평가자로 지정할 수 없습니다.',
        description: '본인 사번과 다른 평가자를 선택해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    if ((employee.evaluator_id ?? '') === newEvaluatorId) {
      toast({
        title: '현재 평가자와 동일합니다.',
        description: '다른 평가자를 선택해 주세요.',
        variant: 'destructive',
      });
      return;
    }

    // 모달 고지의 "발령일"과 기록일을 일치시키기 위해 오늘 날짜(yyyy-mm-dd)를 명시 전달.
    const changedAt = new Date().toISOString().slice(0, 10);
    const toEvaluatorLabel = employeeNameById.get(newEvaluatorId) ?? newEvaluatorId;

    setReassigningId(employee.employee_id);
    try {
      await employeeService.updateEmployee(employee.employee_id, {
        evaluator_id: newEvaluatorId,
        changed_by: actorId,
        changed_at: changedAt,
        evaluation_period_id: selectedPeriod.id,
        reason: 'HR matching reassignment',
      });
      // 두 데이터 소스를 모두 갱신 — 목록·점검 분류가 새 마스터 기준으로 재계산된다.
      await Promise.all([reloadRecords(), reloadEmployees()]);
      setReassignTarget(null);
      // 드릴다운이 열려 있으면 닫아 옛 타임라인 캐시를 버린다.
      setDrilldown(null);
      toast({
        title: '평가자가 변경되었습니다.',
        description: `${employee.name}: ${toEvaluatorLabel} (발령일 ${changedAt}, 이전 배정 보존)`,
      });
    } catch (err) {
      console.error('평가자 변경 실패:', err);
      toast({
        title: '평가자 변경 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setReassigningId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="매칭 정합성 점검"
        subtitle="피평가자–평가자 1:1 매칭 상태를 점검합니다. 분류·요약은 읽기 전용이며, 행을 펼쳐 발령 이력을 확인하거나 평가자를 변경(재배정)할 수 있습니다."
        actions={<Pill tone="neutral">{periodLabel}</Pill>}
        filters={
          <>
            <EvaluationPeriodSelector />

            <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
              <span
                style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-subtle)', pointerEvents: 'none' }}
              >
                <IconSearch width={16} height={16} />
              </span>
              <input
                className="sd-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="사번·이름·평가자 검색"
                style={{ paddingLeft: 36, width: '100%' }}
              />
            </div>

            <OrgChecklist items={targetRecords.map((r) => r.employee)} value={orgFilter} onChange={setOrgFilter} />

            {jobRoleOptions.length > 0 && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                }}
              >
                직종
                <select
                  className="sd-input"
                  value={jobRole}
                  onChange={(event) => setJobRole(event.target.value)}
                  style={{ minWidth: 130, width: 130 }}
                >
                  <option value="">전체</option>
                  {jobRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
              점검 대상 {filteredRecords.length}명
            </div>
          </>
        }
      />

      <div className="flex flex-col gap-6" style={{ padding: '24px 32px 32px' }}>
        {isLoading ? (
          <div className="sd-card">매칭 데이터를 불러오는 중입니다.</div>
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : (
          <>
            {/* (1) 요약 카운트 밴드 */}
            <SummaryBand
              targetCount={filteredRecords.length}
              flaggedCount={checkRows.length}
              ruleCounts={ruleCounts}
            />

            {/* (2) 카테고리별 접이식 섹션 */}
            {RULES.map((rule) => (
              <RuleSection
                key={rule.key}
                rule={rule}
                rows={rowsByRule.get(rule.key) ?? []}
                count={ruleCounts.get(rule.key) ?? 0}
                isOpen={openSections.has(rule.key)}
                onToggle={() => toggleSection(rule.key)}
                knownEmployeeIds={knownEmployeeIds}
                onOpenDrilldown={(row) => setDrilldown({ record: row.record, rules: row.rules })}
              />
            ))}
          </>
        )}
      </div>

      {drilldown && (
        <DrilldownPanel
          record={drilldown.record}
          rules={drilldown.rules}
          periodLabel={periodLabel}
          onClose={() => setDrilldown(null)}
          onReassign={() => setReassignTarget(drilldown.record)}
        />
      )}

      {reassignTarget && (
        <ReassignModal
          record={reassignTarget}
          period={selectedPeriod}
          candidates={evaluatorCandidates}
          employeeNameById={employeeNameById}
          isSaving={reassigningId === reassignTarget.employee.employee_id}
          onCancel={() => setReassignTarget(null)}
          onConfirm={(newEvaluatorId) => handleReassign(reassignTarget.employee, newEvaluatorId)}
        />
      )}
    </>
  );
};

// ── 요약 밴드 ────────────────────────────────────────────────────────────────

type SummaryBandProps = {
  targetCount: number;
  flaggedCount: number;
  ruleCounts: Map<RuleKey, number>;
};

const SummaryBand = ({ targetCount, flaggedCount, ruleCounts }: SummaryBandProps) => {
  const cleanCount = Math.max(0, targetCount - flaggedCount);
  return (
    <div className="sd-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="sd-label-mini">점검 요약</span>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
            점검 대상 <b className="tnum" style={{ color: 'var(--fg)' }}>{targetCount}</b>명 중 특이행{' '}
            <b className="tnum" style={{ color: 'var(--fg)' }}>{flaggedCount}</b>명 · 정상{' '}
            <b className="tnum" style={{ color: 'var(--fg)' }}>{cleanCount}</b>명
          </span>
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: `repeat(${RULES.length}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {RULES.map((rule) => {
          const n = ruleCounts.get(rule.key) ?? 0;
          const isEmpty = n === 0;
          return (
            <div
              key={rule.key}
              style={{
                padding: '14px 16px',
                borderRadius: 10,
                background: 'var(--bg-muted)',
                border: '1px solid var(--border)',
                opacity: isEmpty ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Pill tone={kindBadgeTone(rule.kind)}>{rule.kindLabel}</Pill>
              </div>
              <div
                style={{
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  lineHeight: 1.3,
                  minHeight: 34,
                }}
              >
                {rule.name}
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                {isEmpty ? (
                  <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg-subtle)' }}>없음</span>
                ) : (
                  <>
                    <span
                      className="tnum"
                      style={{
                        fontSize: 'var(--fs-h2)',
                        fontWeight: 900,
                        color: rule.kind === 'anomaly' ? 'var(--ok-orange)' : 'var(--fg)',
                        lineHeight: 1,
                      }}
                    >
                      {n}
                    </span>
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>건</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── 카테고리 섹션 ────────────────────────────────────────────────────────────

type RuleSectionProps = {
  rule: RuleDef;
  rows: CheckRow[];
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  knownEmployeeIds: Set<string>;
  onOpenDrilldown: (row: CheckRow) => void;
};

const RuleSection = ({
  rule,
  rows,
  count,
  isOpen,
  onToggle,
  knownEmployeeIds,
  onOpenDrilldown,
}: RuleSectionProps) => {
  return (
    <section className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 20px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              transition: 'transform 160ms',
              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              color: 'var(--fg-subtle)',
              fontWeight: 900,
            }}
          >
            ›
          </span>
          <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>{rule.name}</span>
          <Pill tone={kindBadgeTone(rule.kind)}>{rule.kindLabel}</Pill>
          {count > 0 ? (
            <Pill tone={rule.tone}>{count}건</Pill>
          ) : (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-subtle)' }}>없음</span>
          )}
        </div>
      </button>

      {isOpen && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '12px 20px', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', lineHeight: 1.5 }}>
            {rule.description}
          </div>
          {rows.length === 0 ? (
            <div style={{ padding: '8px 20px 20px', color: 'var(--fg-subtle)', fontSize: 'var(--fs-sm)' }}>
              해당하는 행이 없습니다.
            </div>
          ) : (
            <div style={{ overflow: 'auto', padding: '0 4px 8px' }}>
              <Table>
                <TableHeader style={{ background: 'var(--bg-muted)' }}>
                  <TableRow>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>사번</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>이름</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>법인</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>본부</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>부</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>팀</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>직종</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>평가자</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>평가기간</TableHead>
                    <TableHead style={{ whiteSpace: 'nowrap' }}>점검</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <RuleRow
                      key={`${rule.key}-${row.record.employee.id}`}
                      rule={rule}
                      row={row}
                      knownEmployeeIds={knownEmployeeIds}
                      onOpenDrilldown={() => onOpenDrilldown(row)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

type RuleRowProps = {
  rule: RuleDef;
  row: CheckRow;
  knownEmployeeIds: Set<string>;
  onOpenDrilldown: () => void;
};

const RuleRow = ({ rule, row, knownEmployeeIds, onOpenDrilldown }: RuleRowProps) => {
  const { employee } = row.record;
  const evaluatorId = employee.evaluator_id;
  const evaluatorName = evaluatorCell(row.record);

  // 평가자 셀 표기 — 규칙별 폴백.
  let evaluatorDisplay: { text: string; tone?: 'muted' | 'warn' | 'unknown' };
  if (rule.key === 'unassigned') {
    evaluatorDisplay = { text: '미지정', tone: 'warn' };
  } else if (rule.key === 'no-evaluation') {
    evaluatorDisplay = { text: evaluatorName === '-' ? '-' : evaluatorName, tone: 'muted' };
  } else if (rule.key === 'self-eval') {
    evaluatorDisplay = { text: evaluatorName, tone: 'warn' };
  } else if (rule.key === 'evaluator-unknown') {
    evaluatorDisplay = { text: evaluatorId ?? '-', tone: 'unknown' };
  } else {
    evaluatorDisplay = { text: evaluatorName };
  }

  const evaluatorColor =
    evaluatorDisplay.tone === 'warn'
      ? 'var(--warning)'
      : evaluatorDisplay.tone === 'unknown'
        ? 'var(--info)'
        : 'var(--fg-muted)';

  return (
    <TableRow>
      <TableCell
        style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
      >
        {employee.employee_id}
      </TableCell>
      <TableCell style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{employee.name}</TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {getOrgValue(employee, 'corporation') || '-'}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {getOrgValue(employee, 'division') || '-'}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {getOrgValue(employee, 'department') || '-'}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {getOrgValue(employee, 'team') || '-'}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {employee.job_role ?? '-'}
      </TableCell>
      <TableCell style={{ whiteSpace: 'nowrap' }}>
        {rule.key === 'self-eval' ? (
          <span style={{ fontWeight: 800, color: 'var(--warning)' }} title="본인 사번과 평가자 사번이 같습니다.">
            {evaluatorDisplay.text}
          </span>
        ) : (
          <span
            style={{
              color: evaluatorColor,
              fontFamily: evaluatorDisplay.tone === 'unknown' ? 'monospace' : undefined,
            }}
          >
            {evaluatorDisplay.text}
            {rule.key === 'evaluator-unknown' && !knownEmployeeIds.has(evaluatorId ?? '') && (
              <span style={{ marginLeft: 6, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                (목록에 없음)
              </span>
            )}
          </span>
        )}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap', fontSize: 'var(--fs-sm)' }}>
        {row.record.evaluation?.evaluation_period_id ? '레코드 있음' : '레코드 없음'}
      </TableCell>
      <TableCell style={{ whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="sd-btn sd-btn-ghost sd-btn-sm"
          onClick={onOpenDrilldown}
          title="매칭 컨텍스트·발령 이력 보기 (읽기 전용)"
        >
          자세히
        </button>
      </TableCell>
    </TableRow>
  );
};

// ── 드릴다운(우측 슬라이드) ─────────────────────────────────────────────────

type DrilldownPanelProps = {
  record: EmployeeEvaluationRecord;
  rules: Set<RuleKey>;
  periodLabel: string;
  onClose: () => void;
  /** "평가자 변경"(개별 재배정) 모달을 연다. */
  onReassign: () => void;
};

const DrilldownPanel = ({ record, rules, periodLabel, onClose, onReassign }: DrilldownPanelProps) => {
  const { employee } = record;
  const [history, setHistory] = useState<EvaluatorAssignmentHistory[] | null>(null);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  // 드릴다운을 열 때만(행을 펼칠 때만) 발령 타임라인을 lazy 호출한다.
  // 전직원 일괄 호출은 하지 않는다(요청 폭주 방지).
  const loadHistory = async () => {
    if (historyState === 'loading' || historyState === 'loaded') return;
    setHistoryState('loading');
    try {
      const result = await employeeService.getEvaluatorAssignmentHistory(employee.employee_id);
      setHistory(result);
      setHistoryState('loaded');
    } catch {
      setHistory([]);
      setHistoryState('error');
    }
  };

  // 시간순(오래된 → 최신) 정렬한 발령 타임라인.
  const timeline = useMemo(() => {
    if (!history) return [];
    return [...history].sort((a, b) => {
      const at = a.changed_at ? new Date(a.changed_at).getTime() : 0;
      const bt = b.changed_at ? new Date(b.changed_at).getTime() : 0;
      return at - bt;
    });
  }, [history]);

  const matchedRules = RULES.filter((rule) => rules.has(rule.key));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sd-card"
        style={{
          width: 'min(520px, 100%)',
          height: '100%',
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="sd-label-mini">매칭 점검 상세</div>
            <h2 style={{ marginTop: 4, fontSize: 'var(--fs-h3)', fontWeight: 900 }}>{employee.name}</h2>
            <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontFamily: 'monospace' }}>
              {employee.employee_id}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              className="sd-btn sd-btn-primary sd-btn-sm"
              onClick={onReassign}
              title="이 피평가자의 평가자를 변경(재배정)합니다."
            >
              평가자 변경
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        <div style={{ overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* 해당 규칙 배지 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {matchedRules.map((rule) => (
              <Pill key={rule.key} tone={rule.tone}>
                {rule.name}
              </Pill>
            ))}
          </div>

          {/* 매칭 컨텍스트 (읽기 전용 카드) */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="sd-label-mini">매칭 컨텍스트</div>
            <ContextRow label="평가기간" value={periodLabel} />
            <ContextRow
              label="직원 마스터 평가자 (employee.evaluator_id)"
              value={employee.evaluator_id ?? '미지정'}
              mono={Boolean(employee.evaluator_id)}
              warn={!employee.evaluator_id}
            />
            <ContextRow
              label="최신 발령 평가자 (evaluation.evaluator_id)"
              value={record.evaluation?.evaluator_id ?? '레코드 없음'}
              mono={Boolean(record.evaluation?.evaluator_id)}
            />
            <ContextRow label="평가자명" value={record.evaluation?.evaluator_name ?? '-'} />
            <ContextRow
              label="이 기간 평가 레코드"
              value={record.evaluation ? '있음' : '없음 (미생성)'}
              warn={!record.evaluation}
            />
            <ContextRow
              label="조직"
              value={
                [
                  getOrgValue(employee, 'corporation'),
                  getOrgValue(employee, 'division'),
                  getOrgValue(employee, 'department'),
                  getOrgValue(employee, 'team'),
                ]
                  .filter(Boolean)
                  .join(' › ') || '-'
              }
            />
          </div>

          {/* 발령 타임라인 (lazy) — "이전 평가 내역"으로 보존 표시. 삭제/취소 없음. */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div className="sd-label-mini">발령(평가자 변경) 이력 · 이전 평가 내역</div>
              {historyState === 'idle' && (
                <button type="button" className="sd-btn sd-btn-outline sd-btn-sm" onClick={loadHistory}>
                  이력 불러오기
                </button>
              )}
            </div>

            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', lineHeight: 1.5, margin: 0 }}>
              평가자가 여럿이거나 평가가 여러 건인 것은 발령(전보)으로 인한 정상 케이스입니다. 아래 이력은 보존
              목적의 읽기 전용 기록이며, 이 화면에서는 어떤 변경도 하지 않습니다.
            </p>

            {historyState === 'loading' && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>이력을 불러오는 중입니다…</div>
            )}
            {historyState === 'error' && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                이력을 불러오지 못했습니다.
              </div>
            )}
            {historyState === 'loaded' && timeline.length === 0 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-subtle)' }}>
                기록된 발령 이력이 없습니다. (직원 마스터 평가자가 줄곧 담당)
              </div>
            )}
            {historyState === 'loaded' && timeline.length > 0 && (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {timeline.map((item, index) => {
                  const isLast = index === timeline.length - 1;
                  return (
                    <li
                      key={item.id}
                      style={{
                        position: 'relative',
                        paddingLeft: 18,
                        borderLeft: '2px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          left: -5,
                          top: 4,
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: isLast ? 'var(--ok-orange)' : 'var(--fg-subtle)',
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 800 }}>
                          {formatAssignmentDate(item.changed_at)}
                        </span>
                        <Pill tone={item.change_type === 'cancel' ? 'neutral' : 'info'}>
                          {assignmentTypeLabel(item.change_type)}
                        </Pill>
                        {isLast && <Pill tone="orange">최종</Pill>}
                        {isBulkMatchingHistory(item) && <Pill tone="neutral">일괄매칭</Pill>}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                        {(item.previous_evaluator_name ?? item.previous_evaluator_id) ?? '이전 없음'}
                        <span style={{ margin: '0 6px', color: 'var(--fg-subtle)' }}>→</span>
                        {(item.new_evaluator_name ?? item.new_evaluator_id) ?? '없음'}
                      </div>
                      {item.evaluation_period_name && (
                        <div style={{ marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                          기간: {item.evaluation_period_name}
                        </div>
                      )}
                      {item.reason && (
                        <div style={{ marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
                          사유: {item.reason}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── 평가자 변경(개별 재배정) 확인 모달 ───────────────────────────────────────
//
// HR 이 새 평가자를 명시적으로 고르고 "현→새" 요약·발령/보존 고지를 확인한 뒤에만
// onConfirm 이 호출된다. 자기평가·동일 평가자·후보 미선택은 확인 버튼을 비활성화한다.

type ReassignModalProps = {
  record: EmployeeEvaluationRecord;
  period: EvaluationPeriod | null;
  candidates: Employee[];
  employeeNameById: Map<string, string>;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: (newEvaluatorId: string) => void;
};

const ReassignModal = ({
  record,
  period,
  candidates,
  employeeNameById,
  isSaving,
  onCancel,
  onConfirm,
}: ReassignModalProps) => {
  const { employee } = record;
  const [newEvaluatorId, setNewEvaluatorId] = useState('');

  const currentEvaluatorId = employee.evaluator_id ?? null;
  const currentEvaluatorLabel = currentEvaluatorId
    ? record.evaluation?.evaluator_name ??
      employeeNameById.get(currentEvaluatorId) ??
      currentEvaluatorId
    : '미지정';
  const newEvaluatorLabel = newEvaluatorId
    ? employeeNameById.get(newEvaluatorId) ?? newEvaluatorId
    : '';

  const isActivePeriod = Boolean(period && period.status === 'active');
  const isSelf = newEvaluatorId === employee.employee_id;
  const isSame = (currentEvaluatorId ?? '') === newEvaluatorId;
  const canConfirm =
    !isSaving && isActivePeriod && Boolean(newEvaluatorId) && !isSelf && !isSame;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sd-card"
        style={{
          width: 'min(480px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div className="sd-label-mini">평가자 변경 · 개별 재배정</div>
          <h2 style={{ marginTop: 6, fontSize: 'var(--fs-h3)', fontWeight: 900 }}>
            {employee.name}
            <span
              style={{
                marginLeft: 8,
                fontSize: 'var(--fs-sm)',
                fontWeight: 600,
                color: 'var(--fg-muted)',
                fontFamily: 'monospace',
              }}
            >
              {employee.employee_id}
            </span>
          </h2>
        </div>

        {/* 현 → 새 요약 */}
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 120 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>현재 평가자</div>
            <div style={{ marginTop: 2, fontSize: 'var(--fs-body)', fontWeight: 700 }}>
              {currentEvaluatorLabel}
            </div>
          </div>
          <span style={{ color: 'var(--fg-subtle)', fontWeight: 900 }}>→</span>
          <div style={{ minWidth: 120 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>새 평가자</div>
            <div
              style={{
                marginTop: 2,
                fontSize: 'var(--fs-body)',
                fontWeight: 800,
                color: newEvaluatorLabel ? 'var(--ok-orange)' : 'var(--fg-subtle)',
              }}
            >
              {newEvaluatorLabel || '선택 안 됨'}
            </div>
          </div>
        </div>

        {/* 평가자 선택 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-muted)' }}>
            새 평가자 선택
          </label>
          <EvaluatorPicker
            options={candidates}
            value={newEvaluatorId}
            onChange={setNewEvaluatorId}
            placeholder="이름·부서·사번으로 검색…"
            disabled={isSaving}
            minWidth={0}
          />
          {isSelf && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>
              자기 자신은 평가자로 지정할 수 없습니다.
            </span>
          )}
          {!isSelf && isSame && newEvaluatorId && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)' }}>
              현재 평가자와 동일합니다. 다른 평가자를 선택해 주세요.
            </span>
          )}
        </div>

        {/* 발령/보존 고지 */}
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            background: 'var(--bg-muted)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--fg-muted)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 800, color: 'var(--fg)', marginBottom: 4 }}>발령 안내</div>
          확인하면 이 변경이 <b>발령(평가자 변경)</b>으로 기록됩니다.
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>발령일: {today} (오늘)</li>
            <li>평가기간: {period ? `${period.name} · ${period.evaluation_year}` : '미선택'}</li>
            <li>직원 마스터의 현재 평가자가 새 평가자로 갱신됩니다.</li>
            <li>이전 배정·평가 내역은 삭제하지 않고 발령 이력으로 보존됩니다.</li>
          </ul>
          {!isActivePeriod && (
            <div style={{ marginTop: 8, color: 'var(--danger)', fontWeight: 700 }}>
              활성(active) 평가기간을 선택해야 재배정할 수 있습니다.
            </div>
          )}
        </div>

        {/* 액션 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="sd-btn sd-btn-ghost sd-btn-sm"
            onClick={onCancel}
            disabled={isSaving}
          >
            취소
          </button>
          <button
            type="button"
            className="sd-btn sd-btn-primary sd-btn-sm"
            onClick={() => onConfirm(newEvaluatorId)}
            disabled={!canConfirm}
            title={
              !isActivePeriod
                ? '활성 평가기간을 선택해 주세요.'
                : !newEvaluatorId
                  ? '새 평가자를 선택해 주세요.'
                  : '평가자 변경을 확정합니다.'
            }
          >
            {isSaving ? '변경 중…' : '평가자 변경 확정'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ContextRow = ({
  label,
  value,
  mono = false,
  warn = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  warn?: boolean;
}) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)', flexShrink: 0 }}>{label}</span>
    <span
      style={{
        fontSize: 'var(--fs-sm)',
        fontWeight: 700,
        textAlign: 'right',
        color: warn ? 'var(--warning)' : 'var(--fg)',
        fontFamily: mono ? 'monospace' : undefined,
        wordBreak: 'break-word',
      }}
    >
      {value}
    </span>
  </div>
);

export default HrMatchingPage;
