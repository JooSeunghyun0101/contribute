import type { Employee } from '@/types';
import type {
  EmployeeProfileImportRowInput,
  MatchingImportRowInput,
} from '@/lib/services/employeeService';

// 업로드 미리보기용 변경 분류.
// 서버 apply 로직과 별개로, 파일 행을 현재 직원 상태와 대조해
// "신규 / 변경 / 동일 / 오류"로 미리 분류한다(예상 변경).
// 'ignored' = 변경점이 있으나 규칙상 반영하지 않는 항목(예: 평가자 동일인데 발령일만 다른 경우 → 날짜 미반영).
export type DiffStatus = 'new' | 'changed' | 'unchanged' | 'ignored' | 'error';

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface DiffItem {
  employeeId: string;
  name: string;
  status: DiffStatus;
  changes: FieldChange[];
  message?: string;
}

export interface DiffResult {
  items: DiffItem[];
  summary: { new: number; changed: number; unchanged: number; ignored: number; error: number; total: number };
}

const ROLE_KO: Record<string, string> = {
  evaluatee: '피평가자',
  evaluator: '평가자',
  hr: 'HR',
};

const parseGrowthLevel = (label?: string | null): number | null => {
  if (!label) return null;
  const m = String(label).match(/\d+/);
  return m ? Number(m[0]) : null;
};

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
};

const rolesLabel = (roles?: string[] | null): string =>
  roles && roles.length ? roles.map((r) => ROLE_KO[r] ?? r).join(', ') : '—';

const summarize = (items: DiffItem[]): DiffResult => ({
  items,
  summary: {
    new: items.filter((i) => i.status === 'new').length,
    changed: items.filter((i) => i.status === 'changed').length,
    unchanged: items.filter((i) => i.status === 'unchanged').length,
    ignored: items.filter((i) => i.status === 'ignored').length,
    error: items.filter((i) => i.status === 'error').length,
    total: items.length,
  },
});

const evaluatorLabel = (id: string | null | undefined, empMap: Map<string, Employee>): string => {
  if (!id) return '평가자 없음';
  return empMap.get(id)?.name ?? id;
};

// ── 대상자(프로필) 업로드 diff ────────────────────────────────
interface MergedProfile {
  employee_id: string;
  name: string;
  position?: string | null;
  department?: string | null;
  growth_level?: number | null;
  job_role?: string | null;
  roles?: string[];
  evaluator_id?: string | null;
}

export const diffProfileRows = (
  rows: EmployeeProfileImportRowInput[],
  employees: Employee[],
): DiffResult => {
  const empMap = new Map(employees.map((e) => [e.employee_id, e]));
  const merged = new Map<string, MergedProfile>();

  for (const r of rows) {
    if (!r.employee_id) continue;
    const cur: MergedProfile = merged.get(r.employee_id) ?? {
      employee_id: r.employee_id,
      name: r.employee_name ?? '',
    };
    if (r.employee_name) cur.name = r.employee_name;
    if (r.position != null) cur.position = r.position;
    if (r.department_name != null) cur.department = r.department_name;
    const gl = parseGrowthLevel(r.growth_level_label);
    if (gl != null) cur.growth_level = gl;
    if (r.job_role != null) cur.job_role = r.job_role;
    if (r.available_roles && r.available_roles.length) cur.roles = r.available_roles;
    if (r.evaluator_id != null) cur.evaluator_id = r.evaluator_id;
    merged.set(r.employee_id, cur);
  }

  const items: DiffItem[] = [];
  for (const m of merged.values()) {
    if (!m.name) {
      items.push({ employeeId: m.employee_id, name: '(이름 없음)', status: 'error', changes: [], message: '이름이 비어 있습니다.' });
      continue;
    }
    const emp = empMap.get(m.employee_id);
    if (!emp) {
      items.push({ employeeId: m.employee_id, name: m.name, status: 'new', changes: [] });
      continue;
    }
    const changes: FieldChange[] = [];
    if (m.name && m.name !== emp.name) changes.push({ field: '이름', before: fmt(emp.name), after: fmt(m.name) });
    if (m.position != null && m.position !== emp.position) changes.push({ field: '직급', before: fmt(emp.position), after: fmt(m.position) });
    if (m.department != null && m.department !== emp.department) changes.push({ field: '부서', before: fmt(emp.department), after: fmt(m.department) });
    if (m.growth_level != null && m.growth_level !== (emp.growth_level ?? null)) changes.push({ field: '성장레벨', before: fmt(emp.growth_level), after: fmt(m.growth_level) });
    if (m.job_role != null && m.job_role !== (emp.job_role ?? null)) changes.push({ field: '직무', before: fmt(emp.job_role), after: fmt(m.job_role) });
    if (m.roles) {
      const before = [...(emp.available_roles ?? [])].sort().join(',');
      const after = [...m.roles].sort().join(',');
      if (before !== after) changes.push({ field: '역할', before: rolesLabel(emp.available_roles), after: rolesLabel(m.roles) });
    }
    if (m.evaluator_id != null && m.evaluator_id !== (emp.evaluator_id ?? null)) {
      changes.push({ field: '평가자', before: evaluatorLabel(emp.evaluator_id, empMap), after: evaluatorLabel(m.evaluator_id, empMap) });
    }
    items.push({ employeeId: m.employee_id, name: m.name, status: changes.length ? 'changed' : 'unchanged', changes });
  }
  return summarize(items);
};

// ── 매칭(평가자 배정) 업로드 diff ─────────────────────────────
export const diffMatchingRows = (
  rows: MatchingImportRowInput[],
  employees: Employee[],
): DiffResult => {
  const empMap = new Map(employees.map((e) => [e.employee_id, e]));
  const byEmployee = new Map<string, MatchingImportRowInput[]>();
  for (const r of rows) {
    if (!r.employee_id) continue;
    if (!byEmployee.has(r.employee_id)) byEmployee.set(r.employee_id, []);
    byEmployee.get(r.employee_id)!.push(r);
  }

  const startTime = (r: MatchingImportRowInput) => (r.work_start_date ? Date.parse(r.work_start_date) || 0 : 0);

  const items: DiffItem[] = [];
  for (const [employeeId, group] of byEmployee.entries()) {
    // 결과 평가자 = 근무시작일이 가장 늦은 행(같으면 마지막 행).
    const sorted = [...group].sort((a, b) => startTime(a) - startTime(b));
    const primary = sorted[sorted.length - 1];
    const name = primary.employee_name ?? employeeId;
    const distinctEvaluators = [...new Set(group.map((r) => r.evaluator_id).filter(Boolean))];

    const emp = empMap.get(employeeId);
    if (!emp) {
      const changes: FieldChange[] = [
        { field: '평가자', before: '신규', after: evaluatorLabel(primary.evaluator_id, empMap) },
      ];
      if (distinctEvaluators.length > 1) changes.push({ field: '발령단계', before: '—', after: `${distinctEvaluators.length}단계` });
      items.push({ employeeId, name, status: 'new', changes });
      continue;
    }

    const changes: FieldChange[] = [];
    if ((primary.evaluator_id ?? null) !== (emp.evaluator_id ?? null)) {
      changes.push({ field: '평가자', before: evaluatorLabel(emp.evaluator_id, empMap), after: evaluatorLabel(primary.evaluator_id, empMap) });
    }
    if (primary.department_name != null && primary.department_name !== emp.department) {
      changes.push({ field: '부서', before: fmt(emp.department), after: fmt(primary.department_name) });
    }
    if (distinctEvaluators.length > 1) {
      changes.push({ field: '발령단계', before: '—', after: `${distinctEvaluators.length}단계 (이전 평가자 보존)` });
    }
    items.push({ employeeId, name, status: changes.length ? 'changed' : 'unchanged', changes });
  }
  return summarize(items);
};
