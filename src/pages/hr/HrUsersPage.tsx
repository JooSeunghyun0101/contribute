import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { IconSearch, Pill } from '@/components/brand';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { employeeService, evaluationService } from '@/lib/services';
import type {
  EmployeeProfileImportRowInput,
  MatchingImportRowInput,
} from '@/lib/services/employeeService';
import {
  downloadEmployeeProfileUploadWorkbook,
  downloadMatchingUploadWorkbook,
} from '@/utils/hrDataExport';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EvaluatorHistoryModal from '@/components/hr/EvaluatorHistoryModal';
import AddEmployeeModal, { type NewEmployeeInput } from '@/components/hr/AddEmployeeModal';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import UploadPreviewModal from '@/components/hr/UploadPreviewModal';
import OrgChecklist from '@/components/hr/OrgChecklist';
import { getOrgValue, matchesOrgNodes, orgPathLabel } from '@/lib/orgHierarchy';
import { isOnLeave } from '@/lib/employeeStatus';
import { diffProfileRows, type DiffResult } from '@/lib/uploadDiff';
import type {
  Employee,
  Evaluation,
  EvaluationStatus,
  EvaluatorAssignmentHistory,
  UserRole,
} from '@/types';

const roleFilters: Array<{ id: 'all' | UserRole; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'evaluator', label: '평가자' },
  { id: 'evaluatee', label: '피평가자' },
  { id: 'hr', label: 'HR' },
];
const editableRoleOptions = roleFilters.filter(
  (filter): filter is { id: UserRole; label: string } => filter.id !== 'all',
);

const ROLE_BG: Record<string, string> = {
  hr: '#EFF6FF',
  evaluator: 'var(--ok-orange-50)',
  evaluatee: 'var(--bg-muted)',
};
const ROLE_COLOR: Record<string, string> = {
  hr: '#2563EB',
  evaluator: 'var(--ok-orange)',
  evaluatee: 'var(--fg-muted)',
};
const ROLE_BORDER: Record<string, string> = {
  hr: '#BFDBFE',
  evaluator: 'var(--ok-orange-100)',
  evaluatee: 'var(--border)',
};

// 묶어서 보기 그룹 키 — 조직 경로(법인 › 본부 › 부 › 팀). 없으면 부서명, 그래도 없으면 '미지정'.
const orgGroupKey = (employee: Employee) =>
  orgPathLabel(employee) || employee.department || '미지정';

const roleLabel = (role: UserRole) => {
  if (role === 'hr') return 'HR';
  if (role === 'evaluator') return '평가자';
  return '피평가자';
};

const statusLabel = (status?: EvaluationStatus | null) => {
  if (status === 'submitted') return '검토 대기';
  if (status === 'evaluating') return '평가 중';
  if (status === 'completed') return '완료';
  if (status === 'locked') return '잠금';
  if (status === 'draft' || status === 'in-progress') return '작성 중';
  return '없음';
};

const statusTone = (status?: EvaluationStatus | null) => {
  if (status === 'submitted') return 'orange';
  if (status === 'evaluating') return 'info';
  if (status === 'completed') return 'success';
  if (status === 'locked') return 'neutral';
  if (status === 'draft' || status === 'in-progress') return 'warning';
  return 'neutral';
};

type EmployeeEditForm = {
  name: string;
  position: string;
  department: string;
  growthLevel: string;
  roles: UserRole[];
  jobRole: string;
  orgCorporation: string;
  orgDivision: string;
  orgDepartment: string;
  orgTeam: string;
  onLeave: boolean; // 휴직 여부(편집 폼에서 토글). 실제 소속은 org_* 로 보존.
};

type AssignmentChangeOptions = {
  startDate: string;
  evaluationPeriodId: string | null;
};

const toCellText = (value: unknown) => {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

const toOptionalCellText = (value: unknown) => {
  const text = toCellText(value);
  return text || null;
};

// 업로드 양식의 헤더 위치가 바뀌어도(예: 법인/본부/부/팀 컬럼 추가) 깨지지 않도록
// 헤더 "이름" 기준으로 컬럼 인덱스를 매핑해서 읽는다. (기존: 위치 고정 → 컬럼 추가 시 전부 어긋남)
const buildColIndex = (headerRow: unknown[]): Record<string, number> => {
  const map: Record<string, number> = {};
  (headerRow ?? []).forEach((cell, i) => {
    const key = toCellText(cell);
    if (key && !(key in map)) map[key] = i;
  });
  return map;
};

const cellByName = (
  row: unknown[],
  idx: Record<string, number>,
  name: string,
): string | null => {
  const i = idx[name];
  return i == null ? null : toOptionalCellText(row[i]);
};

// 4단계 조직 계층(법인/본부/부/팀)을 헤더명으로 읽는다. 컬럼이 없거나 "-"(빈 계층)면 null.
const normOrgCell = (v: string | null): string | null => {
  if (v == null) return null;
  const t = v.trim();
  return !t || t === '-' ? null : t;
};
const orgFieldsFromRow = (row: unknown[], idx: Record<string, number>) => ({
  org_corporation: normOrgCell(cellByName(row, idx, '법인')),
  org_division: normOrgCell(cellByName(row, idx, '본부')),
  org_department: normOrgCell(cellByName(row, idx, '부')),
  org_team: normOrgCell(cellByName(row, idx, '팀')),
});

// 매칭 결과 시트 식별: 평가자/평가유형 헤더가 있으면 매칭 시트.
const MATCHING_REQUIRED_HEADERS = ['사번', '부서명', '평가자사번', '평가유형'];
const hasMatchingImportHeaders = (sheetRows: unknown[][]) => {
  const idx = buildColIndex(sheetRows[0] ?? []);
  return MATCHING_REQUIRED_HEADERS.every((header) => header in idx);
};

const buildMatchingImportRows = (sheetRows: unknown[][]): MatchingImportRowInput[] => {
  const idx = buildColIndex(sheetRows[0] ?? []);
  return sheetRows
    .slice(1)
    .map((row, index) => {
      const get = (name: string) => cellByName(row, idx, name);
      const item = {
        row_number: index + 2,
        employee_id: get('사번') ?? '',
        employee_name: get('성명') ?? '',
        org_sequence: get('소속순번'),
        department_id: get('부서ID'),
        ...orgFieldsFromRow(row, idx),
        department_name: get('부서명'),
        work_start_date: get('근무시작일'),
        work_end_date: get('근무종료일'),
        evaluator_id: get('평가자사번'),
        evaluator_name: get('평가자명'),
        confirmer_id: get('확인자사번'),
        confirmer_name: get('확인자명'),
        evaluation_type: get('평가유형'),
        matching_result: get('결과'),
      };
      return { ...item, raw_data: { ...item } };
    })
    .filter((row) => row.employee_id || row.employee_name);
};

const PROFILE_ROLE_LABELS: Record<string, UserRole> = {
  '피평가자': 'evaluatee',
  '평가자': 'evaluator',
  'HR': 'hr',
};

const parseRolesFromCells = (...cells: unknown[]): UserRole[] => {
  const roles = new Set<UserRole>();
  cells.forEach((cell) => {
    const value = toOptionalCellText(cell);
    const mapped = value ? PROFILE_ROLE_LABELS[value] : undefined;
    if (mapped) roles.add(mapped);
  });
  return [...roles];
};

// 프로필(대상자) 시트 식별 — 헤더명 기준(컬럼 추가에도 견고).
const hasProfileSummaryHeaders = (sheetRows: unknown[][]) => {
  const idx = buildColIndex(sheetRows[0] ?? []);
  return ['사번', '성명', '부서명', '직무', '권한1'].every((h) => h in idx);
};
const hasProfileDetailHeaders = (sheetRows: unknown[][]) => {
  const idx = buildColIndex(sheetRows[0] ?? []);
  return ['사번', '소속순번', '부서ID', '근무시작일'].every((h) => h in idx);
};
const isProfileSheet = (sheetRows: unknown[][]) =>
  hasProfileSummaryHeaders(sheetRows) || hasProfileDetailHeaders(sheetRows);

const buildEmployeeProfileRows = (
  sheetName: string,
  sheetRows: unknown[][],
): EmployeeProfileImportRowInput[] => {
  const idx = buildColIndex(sheetRows[0] ?? []);
  const isDetailSheet = hasProfileDetailHeaders(sheetRows);
  const isSummarySheet = hasProfileSummaryHeaders(sheetRows);
  if (!isSummarySheet && !isDetailSheet) return [];

  return sheetRows
    .slice(1)
    .map((row, index) => {
      const get = (name: string) => cellByName(row, idx, name);
      if (isDetailSheet) {
        const item = {
          sheet_name: sheetName,
          row_number: index + 2,
          evaluation_group: get('평가그룹'),
          employee_id: get('사번') ?? '',
          employee_name: get('성명') ?? '',
          org_sequence: get('소속순번'),
          department_id: get('부서ID'),
          ...orgFieldsFromRow(row, idx),
          department_name: get('부서명'),
          work_start_date: get('근무시작일'),
          work_end_date: get('근무종료일'),
          growth_level_label: get('성장레벨(직급)'),
          position: get('직책'),
          // 상세시트의 평가자/대상여부 컬럼은 헤더명이 명확치 않아 기존 고정 위치 유지(레거시 호환)
          evaluator_id: toOptionalCellText(row[14]),
          evaluator_name: toOptionalCellText(row[15]),
          evaluator_position: toOptionalCellText(row[16]),
          target_status: toOptionalCellText(row[20]),
        };
        return { ...item, raw_data: item };
      }

      const item = {
        sheet_name: sheetName,
        row_number: index + 2,
        evaluation_group: get('평가그룹'),
        employee_id: get('사번') ?? '',
        employee_name: get('성명') ?? '',
        ...orgFieldsFromRow(row, idx),
        department_name: get('부서명'),
        growth_level_label: get('성장레벨(직급)'),
        position: get('직책'),
        available_roles: parseRolesFromCells(get('권한1'), get('권한2'), get('권한3')),
        job_role: get('직무'),
      };
      return { ...item, raw_data: item };
    })
    .filter((row) => row.employee_id || row.employee_name);
};

type PendingUpload =
  | { kind: 'profile'; fileName: string; rows: EmployeeProfileImportRowInput[]; result: DiffResult }
  | {
      kind: 'matching';
      fileName: string;
      sheetName: string;
      rows: MatchingImportRowInput[];
      result: DiffResult;
    };

const HrUsersPage = () => {
  const profileFileInputRef = useRef<HTMLInputElement | null>(null);
  const matchingFileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [orgNodeKeys, setOrgNodeKeys] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<'all' | UserRole>('all');
  const [groupBySection, setGroupBySection] = useState(false); // 조직별로 묶어서 보기
  const [updatingEvaluationId, setUpdatingEvaluationId] = useState<string | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [savingEmployeeId, setSavingEmployeeId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EmployeeEditForm | null>(null);
  // 평가자 변경 이력 모달 대상 직원 id (null = 모달 닫힘)
  const [historyModalEmployeeId, setHistoryModalEmployeeId] = useState<string | null>(null);
  const [assignmentHistoryByEmployee, setAssignmentHistoryByEmployee] = useState<
    Record<string, EvaluatorAssignmentHistory[]>
  >({});
  const [loadingHistoryEmployeeId, setLoadingHistoryEmployeeId] = useState<string | null>(null);
  const [historyActionId, setHistoryActionId] = useState<string | null>(null);
  const [evaluationsByEmployee, setEvaluationsByEmployee] = useState<Record<string, Evaluation[]>>({});
  const [loadingEvaluationsEmployeeId, setLoadingEvaluationsEmployeeId] = useState<string | null>(null);
  const [isImportingProfiles, setIsImportingProfiles] = useState(false);
  const [isImportingMatching, setIsImportingMatching] = useState(false);
  const [isExportingProfiles, setIsExportingProfiles] = useState(false);
  const [isExportingMatching, setIsExportingMatching] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [isApplyingUpload, setIsApplyingUpload] = useState(false);
  const [deletingEmployeeId, setDeletingEmployeeId] = useState<string | null>(null);
  // 다중 선택 + 페이지네이션
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEvaluatorId, setBulkEvaluatorId] = useState('');
  const [bulkChangeDate, setBulkChangeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bulkActionRunning, setBulkActionRunning] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [pageIndex, setPageIndex] = useState(0);
  const { employees, records, isLoading, error, reload } = useAllEmployees();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { periods, selectedPeriodId } = useEvaluationPeriod();
  const actorId = user?.employeeId ?? user?.id ?? null;

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.employee_id, employee])),
    [employees],
  );
  const recordMap = useMemo(
    () => new Map(records.map((record) => [record.employee.employee_id, record])),
    [records],
  );
  // admin 은 시스템 계정 — 사용자 목록과 평가자 후보 모두에서 제외한다.
  // 로그인 등 시스템 동작에는 그대로 사용 가능.
  const evaluatorOptions = useMemo(
    () =>
      employees
        .filter((employee) => employee.employee_id !== 'admin')
        // 사번이 영문자로 시작하는 잘못된 데이터는 평가자 후보에서 숨김.
        .filter((employee) => !/^[A-Za-z]/.test(employee.employee_id))
        .filter((employee) => employee.available_roles.includes('evaluator'))
        .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)),
    [employees],
  );

  // 휴직자(매칭결과 '휴직'·소속 '휴직자소속')는 '조직 필터 후보'에서만 제외한다.
  // 사용자관리 목록에는 복직·계정관리를 위해 표시하되, 조직 필터를 걸면 자연히 빠진다
  // ('휴직자소속'이 필터 노드가 아니므로 매칭되지 않음).
  const orgRosterEmployees = useMemo(() => employees.filter((e) => !isOnLeave(e)), [employees]);

  const filteredEmployees = useMemo(
    () =>
      [...employees]
        .filter((employee) => employee.employee_id !== 'admin')
        // 표시 대상:
        //  - 평가 대상자(evaluatee): 선택한 평가기간에 evaluation 이 있는 직원만.
        //    (대상자 업로드 시 그 평가기간에 evaluation 이 생성되므로, 업로드한 평가기간 화면에만 나온다.)
        //  - 평가자/HR 전용(evaluatee 아님): 평가 대상이 아니므로 평가기간과 무관하게 항상 표시.
        .filter((employee) => {
          if (isOnLeave(employee)) return true; // 휴직자는 평가 유무와 무관하게 계정관리용으로 표시
          const isEvaluatee = employee.available_roles.includes('evaluatee');
          if (!isEvaluatee) return true;
          return Boolean(recordMap.get(employee.employee_id)?.evaluation);
        })
        .filter((employee) => {
          const normalizedQuery = query.trim().toLowerCase();
          const matchesQuery =
            !normalizedQuery ||
            employee.name.toLowerCase().includes(normalizedQuery) ||
            employee.department.toLowerCase().includes(normalizedQuery) ||
            employee.position.toLowerCase().includes(normalizedQuery) ||
            employee.employee_id.toLowerCase().includes(normalizedQuery);
          const matchesRole =
            selectedRole === 'all' || employee.available_roles.includes(selectedRole);
          return matchesQuery && matchesRole;
        })
        .filter((employee) => matchesOrgNodes(employee, orgNodeKeys))
        .sort((a, b) => {
          // 묶어서 보기일 땐 같은 조직 그룹이 인접하도록 그룹 키 우선 정렬.
          if (groupBySection) {
            const cmp = orgGroupKey(a).localeCompare(orgGroupKey(b), 'ko');
            if (cmp !== 0) return cmp;
          }
          return a.department.localeCompare(b.department) || a.name.localeCompare(b.name);
        }),
    [employees, recordMap, query, selectedRole, orgNodeKeys, groupBySection],
  );

  // 페이지네이션: 필터링된 목록을 페이지 단위로 자른다.
  const totalFiltered = filteredEmployees.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pagedEmployees = useMemo(
    () => filteredEmployees.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filteredEmployees, currentPage, pageSize],
  );
  // 검색·역할·평가기간·페이지크기가 바뀌면 첫 페이지로.
  useEffect(() => {
    setPageIndex(0);
  }, [query, selectedRole, selectedPeriodId, pageSize, groupBySection]);

  // 다중 선택 (현재 페이지 기준 전체선택, 선택 자체는 페이지 넘어가도 유지).
  const pageIds = useMemo(() => pagedEmployees.map((e) => e.employee_id), [pagedEmployees]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSelectPage = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());

  const getEvaluatorLabel = (evaluatorId?: string | null, evaluatorName?: string | null) => {
    if (evaluatorName) return evaluatorName;
    if (!evaluatorId) return '평가자 없음';
    return employeeMap.get(evaluatorId)?.name ?? evaluatorId;
  };

  const loadAssignmentHistory = async (employeeId: string, force = false) => {
    if (!force && assignmentHistoryByEmployee[employeeId]) return;

    setLoadingHistoryEmployeeId(employeeId);
    try {
      const history = await employeeService.getEvaluatorAssignmentHistory(employeeId);
      setAssignmentHistoryByEmployee((prev) => ({ ...prev, [employeeId]: history }));
    } catch (error) {
      console.error('평가자 이력 조회 실패:', error);
      toast({
        title: '평가자 이력 조회 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setLoadingHistoryEmployeeId((prev) => (prev === employeeId ? null : prev));
    }
  };

  const loadEmployeeEvaluations = async (employeeId: string, force = false) => {
    if (!force && evaluationsByEmployee[employeeId]) return;
    setLoadingEvaluationsEmployeeId(employeeId);
    try {
      const list = await evaluationService.getEvaluationsByEmployeeId(employeeId);
      setEvaluationsByEmployee((prev) => ({ ...prev, [employeeId]: list }));
    } catch (error) {
      console.error('평가 목록 조회 실패:', error);
      toast({
        title: '평가 목록 조회 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setLoadingEvaluationsEmployeeId((prev) => (prev === employeeId ? null : prev));
    }
  };

  const openAssignmentHistory = async (employeeId: string) => {
    setHistoryModalEmployeeId(employeeId);
    await Promise.all([loadAssignmentHistory(employeeId), loadEmployeeEvaluations(employeeId)]);
  };

  const closeAssignmentHistory = () => {
    setHistoryModalEmployeeId(null);
  };

  const startEditing = (employee: Employee) => {
    setEditingEmployeeId(employee.employee_id);
    setEditForm({
      name: employee.name,
      position: employee.position,
      department: employee.department,
      growthLevel: employee.growth_level == null ? '' : String(employee.growth_level),
      roles: employee.available_roles as UserRole[],
      jobRole: employee.job_role ?? '',
      orgCorporation: getOrgValue(employee, 'corporation'),
      orgDivision: getOrgValue(employee, 'division'),
      orgDepartment: getOrgValue(employee, 'department'),
      orgTeam: getOrgValue(employee, 'team'),
      onLeave: isOnLeave(employee),
    });
  };

  const cancelEditing = () => {
    setEditingEmployeeId(null);
    setEditForm(null);
  };

  const updateEditForm = <K extends keyof EmployeeEditForm>(key: K, value: EmployeeEditForm[K]) => {
    setEditForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleEditRole = (role: UserRole) => {
    setEditForm((prev) => {
      if (!prev) return prev;
      const hasRole = prev.roles.includes(role);
      const roles = hasRole ? prev.roles.filter((item) => item !== role) : [...prev.roles, role];
      return { ...prev, roles };
    });
  };

  const saveEmployeeEdit = async (employee: Employee) => {
    if (!editForm) return;

    const name = editForm.name.trim();
    const position = editForm.position.trim();
    const realDept =
      editForm.orgTeam.trim() ||
      editForm.orgDepartment.trim() ||
      editForm.orgDivision.trim() ||
      editForm.orgCorporation.trim() ||
      '미지정';
    // 휴직이면 소속 표시를 '휴직자소속'으로(실제 소속은 org_* 에 보존). 재직이면 실제 소속으로 복원.
    const department = editForm.onLeave
      ? '휴직자소속'
      : editForm.department.trim() === '휴직자소속' || !editForm.department.trim()
        ? realDept
        : editForm.department.trim();
    const growthLevel = editForm.growthLevel.trim();

    if (!name || !position || !department) {
      toast({
        title: '사용자 정보를 저장할 수 없습니다.',
        description: '이름, 직급, 부서는 비워둘 수 없습니다.',
        variant: 'destructive',
      });
      return;
    }

    if (editForm.roles.length === 0) {
      toast({
        title: '역할을 선택해 주세요.',
        description: '사용자는 최소 1개 이상의 역할이 필요합니다.',
        variant: 'destructive',
      });
      return;
    }

    const parsedGrowthLevel = growthLevel ? Number(growthLevel) : null;
    if (
      parsedGrowthLevel !== null &&
      (!Number.isInteger(parsedGrowthLevel) || parsedGrowthLevel < 1)
    ) {
      toast({
        title: '성장레벨을 확인해 주세요.',
        description: '성장레벨은 1 이상의 정수로 입력해야 합니다.',
        variant: 'destructive',
      });
      return;
    }

    setSavingEmployeeId(employee.employee_id);
    try {
      const orgOrNull = (v: string) => {
        const t = v.trim();
        return !t || t === '-' ? null : t;
      };
      await employeeService.updateEmployee(employee.employee_id, {
        name,
        position,
        department,
        growth_level: parsedGrowthLevel,
        available_roles: editForm.roles,
        job_role: editForm.jobRole.trim() || null,
        org_corporation: orgOrNull(editForm.orgCorporation),
        org_division: orgOrNull(editForm.orgDivision),
        org_department: orgOrNull(editForm.orgDepartment),
        org_team: orgOrNull(editForm.orgTeam),
        // 휴직=‘휴직’, 복직(휴직→재직)=null 로 해제, 그 외 일반 편집은 미전송(기존값 유지).
        matching_result: editForm.onLeave ? '휴직' : isOnLeave(employee) ? null : undefined,
        changed_by: actorId,
      });
      await reload();
      cancelEditing();
      toast({
        title: '사용자 정보가 저장되었습니다.',
        description: `${name}님의 정보가 변경되었습니다.`,
      });
    } catch (error) {
      console.error('사용자 정보 저장 실패:', error);
      toast({
        title: '사용자 정보 저장 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setSavingEmployeeId(null);
    }
  };

  const cancelAssignmentChange = async (
    employee: Employee,
    history: EvaluatorAssignmentHistory,
  ) => {
    const previousEvaluator = getEvaluatorLabel(
      history.previous_evaluator_id,
      history.previous_evaluator_name,
    );
    const ok = await confirm({
      title: '평가자 변경 취소',
      description: `${employee.name}님의 평가자 변경을 취소하고 "${previousEvaluator}"(으)로 되돌릴까요?`,
      confirmText: '되돌리기',
    });
    if (!ok) return;

    setHistoryActionId(history.id);
    try {
      const result = await employeeService.cancelEvaluatorAssignment(history.id, {
        changed_by: actorId,
        cancel_reason: 'HR assignment cancellation',
      });
      await reload();
      await loadAssignmentHistory(employee.employee_id, true);
      const restoredEvaluatorLabel = result.employee?.evaluator_id
        ? getEvaluatorLabel(result.employee.evaluator_id)
        : '평가자 없음';
      toast({
        title: '평가자 변경이 취소되었습니다.',
        description: `${employee.name}: ${restoredEvaluatorLabel}`,
      });
    } catch (error) {
      console.error('평가자 변경 취소 실패:', error);
      toast({
        title: '평가자 변경 취소 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setHistoryActionId(null);
    }
  };

  const addAssignmentChange = async (
    employee: Employee,
    newEvaluatorId: string,
    options: AssignmentChangeOptions,
  ) => {
    if ((employee.evaluator_id ?? '') === newEvaluatorId) return;
    if (!options.startDate || !options.evaluationPeriodId) {
      toast({
        title: '평가자 변경 기준을 선택해주세요.',
        description: '변경 시작일과 평가기간을 모두 선택해야 합니다.',
        variant: 'destructive',
      });
      return;
    }
    const toEvaluator = getEvaluatorLabel(newEvaluatorId);
    const ok = await confirm({
      title: '평가자 변경',
      description: `${employee.name}님의 평가자를 "${toEvaluator}"(으)로 변경하고 이력을 추가할까요?`,
      confirmText: '변경',
    });
    if (!ok) return;

    setHistoryActionId('add');
    try {
      await employeeService.updateEmployee(employee.employee_id, {
        evaluator_id: newEvaluatorId,
        changed_by: actorId,
        changed_at: options.startDate,
        evaluation_period_id: options.evaluationPeriodId,
        reason: 'HR assignment add',
      });
      await reload();
      await loadAssignmentHistory(employee.employee_id, true);
      toast({
        title: '평가자 변경 이력이 추가되었습니다.',
        description: `${employee.name}: ${toEvaluator}`,
      });
    } catch (error) {
      console.error('평가자 변경 이력 추가 실패:', error);
      toast({
        title: '평가자 변경 이력 추가 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setHistoryActionId(null);
    }
  };

  const correctAssignmentChange = async (
    employee: Employee,
    history: EvaluatorAssignmentHistory,
    newEvaluatorId: string,
    options: AssignmentChangeOptions,
  ) => {
    if (!options.startDate || !options.evaluationPeriodId) {
      toast({
        title: '평가자 변경 기준을 선택해주세요.',
        description: '변경 시작일과 평가기간을 모두 선택해야 합니다.',
        variant: 'destructive',
      });
      return;
    }
    const fromEvaluator = getEvaluatorLabel(
      history.new_evaluator_id,
      history.new_evaluator_name,
    );
    const toEvaluator = getEvaluatorLabel(newEvaluatorId);
    const ok = await confirm({
      title: '평가자 변경 정정',
      description: `${employee.name}님의 평가자 변경 항목을 "${fromEvaluator}" → "${toEvaluator}"(으)로 정정할까요? 원본 항목은 취소 처리되고, 정정 기록이 새로 남습니다.`,
      confirmText: '정정',
    });
    if (!ok) return;

    setHistoryActionId(history.id);
    try {
      const result = await employeeService.correctEvaluatorAssignment(history.id, {
        new_evaluator_id: newEvaluatorId,
        changed_by: actorId,
        changed_at: options.startDate,
        evaluation_period_id: options.evaluationPeriodId,
        reason: 'HR assignment correction',
      });
      await reload();
      await loadAssignmentHistory(employee.employee_id, true);
      toast({
        title: '평가자 변경이 정정되었습니다.',
        description: result.is_current_assignment
          ? `${employee.name}: 현재 평가자가 "${toEvaluator}"(으)로 갱신되었습니다.`
          : `${employee.name}: 과거 이력만 정정되어 현재 평가자는 그대로입니다.`,
      });
    } catch (error) {
      console.error('평가자 변경 정정 실패:', error);
      toast({
        title: '평가자 변경 정정 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setHistoryActionId(null);
    }
  };

  const changeEvaluationStatus = async (
    evaluationId: string,
    employeeName: string,
    currentStatus: EvaluationStatus,
    nextStatus: EvaluationStatus,
  ) => {
    if (nextStatus === currentStatus) return;

    const ok = await confirm({
      title: '평가 단계 변경',
      description: `${employeeName}님의 평가 단계를 "${statusLabel(currentStatus)}"에서 "${statusLabel(nextStatus)}"(으)로 변경할까요?`,
      confirmText: '변경',
    });
    if (!ok) return;

    setUpdatingEvaluationId(evaluationId);
    try {
      const updated = await evaluationService.updateEvaluation(evaluationId, {
        evaluation_status: nextStatus,
        last_modified: new Date().toISOString(),
      });
      // 모달의 평가 목록도 즉시 동기화.
      if (historyModalEmployeeId) {
        setEvaluationsByEmployee((prev) => {
          const list = prev[historyModalEmployeeId];
          if (!list) return prev;
          return {
            ...prev,
            [historyModalEmployeeId]: list.map((ev) =>
              ev.id === evaluationId ? { ...ev, ...updated, evaluation_status: nextStatus } : ev,
            ),
          };
        });
      }
      await reload();
      toast({
        title: '평가 단계가 변경되었습니다.',
        description: `${employeeName}: ${statusLabel(nextStatus)}`,
      });
    } catch (error) {
      console.error('평가 단계 변경 실패:', error);
      toast({
        title: '평가 단계 변경 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingEvaluationId(null);
    }
  };

  const handleCreateUser = async (data: NewEmployeeInput) => {
    setIsAddingUser(true);
    try {
      await employeeService.createEmployee({ ...data, evaluation_period_id: selectedPeriodId });
      await reload();
      setShowAddModal(false);
      toast({ title: '사용자가 추가되었습니다.', description: `${data.name} (${data.employee_id})` });
    } catch (error) {
      console.error('사용자 추가 실패:', error);
      toast({
        title: '사용자 추가 실패',
        description: error instanceof Error ? error.message : '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleDeleteUser = async (employee: Employee) => {
    const ok = await confirm({
      title: `${employee.name}(${employee.employee_id}) 사용자를 삭제할까요?`,
      description:
        '이 직원의 평가·과업·피드백·이력 등 연결 데이터가 모두 삭제됩니다. 되돌릴 수 없습니다.',
      variant: 'danger',
      confirmText: '삭제',
    });
    if (!ok) return;
    setDeletingEmployeeId(employee.employee_id);
    try {
      await employeeService.deleteEmployee(employee.employee_id);
      await reload();
      toast({ title: '사용자가 삭제되었습니다.', description: `${employee.name} (${employee.employee_id})` });
    } catch (error) {
      console.error('사용자 삭제 실패:', error);
      toast({
        title: '사용자 삭제 실패',
        description: error instanceof Error ? error.message : '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setDeletingEmployeeId(null);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const ok = await confirm({
      title: `선택한 ${ids.length}명의 사용자를 삭제할까요?`,
      description:
        '각 직원의 평가·과업·피드백·이력 등 연결 데이터가 모두 삭제됩니다. 되돌릴 수 없습니다.',
      variant: 'danger',
      confirmText: `${ids.length}명 삭제`,
    });
    if (!ok) return;
    setBulkActionRunning(true);
    let success = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await employeeService.deleteEmployee(id);
        success += 1;
      } catch (err) {
        console.error('일괄 삭제 실패:', id, err);
        failed.push(id);
      }
    }
    await reload();
    clearSelection();
    setBulkActionRunning(false);
    toast({
      title: '일괄 삭제 완료',
      description: `${success}명 삭제${failed.length ? ` · 실패 ${failed.length}명` : ''}`,
      variant: failed.length ? 'destructive' : undefined,
    });
  };

  const handleBulkEvaluatorChange = async () => {
    const ids = [...selectedIds];
    if (!ids.length || !bulkEvaluatorId) return;
    if (!selectedPeriodId) {
      toast({
        title: '평가기간을 선택해 주세요.',
        description: '평가자 일괄 변경은 평가기간 기준으로 이력이 기록됩니다.',
        variant: 'destructive',
      });
      return;
    }
    if (!bulkChangeDate) {
      toast({
        title: '변경일을 선택해 주세요.',
        description: '평가자 변경(발령) 시작일 기준으로 이력이 기록됩니다.',
        variant: 'destructive',
      });
      return;
    }
    const toLabel = getEvaluatorLabel(bulkEvaluatorId);
    const ok = await confirm({
      title: '평가자 일괄 변경',
      description: `선택한 ${ids.length}명의 평가자를 "${toLabel}"(으)로 ${bulkChangeDate}부로 일괄 변경할까요?`,
      confirmText: `${ids.length}명 변경`,
    });
    if (!ok) return;
    setBulkActionRunning(true);
    let success = 0;
    let skipped = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const emp = employeeMap.get(id);
      if (!emp) {
        failed.push(id);
        continue;
      }
      if ((emp.evaluator_id ?? '') === bulkEvaluatorId) {
        skipped += 1;
        continue;
      }
      try {
        await employeeService.updateEmployee(id, {
          evaluator_id: bulkEvaluatorId,
          changed_by: actorId,
          changed_at: bulkChangeDate,
          evaluation_period_id: selectedPeriodId,
          reason: 'HR bulk assignment',
        });
        success += 1;
      } catch (err) {
        console.error('일괄 평가자 변경 실패:', id, err);
        failed.push(id);
      }
    }
    await reload();
    clearSelection();
    setBulkEvaluatorId('');
    setBulkActionRunning(false);
    toast({
      title: '평가자 일괄 변경 완료',
      description: `${success}명 변경${skipped ? ` · 동일 ${skipped}명` : ''}${failed.length ? ` · 실패 ${failed.length}명` : ''}`,
      variant: failed.length ? 'destructive' : undefined,
    });
  };

  const openMatchingFileDialog = () => {
    if (isImportingMatching) return;
    matchingFileInputRef.current?.click();
  };

  const openProfileFileDialog = () => {
    if (isImportingProfiles) return;
    profileFileInputRef.current?.click();
  };

  const exportProfileFile = async () => {
    setIsExportingProfiles(true);
    try {
      const result = await downloadEmployeeProfileUploadWorkbook({ periodId: selectedPeriodId });
      toast({
        title: '대상자 다운로드가 완료되었습니다.',
        description: `${result.targetCount}명의 현재 대상자를 업로드 양식 그대로 받았습니다.`,
      });
    } catch (error) {
      console.error('대상자 다운로드 실패:', error);
      toast({
        title: '대상자 다운로드 실패',
        description: '대상자 파일을 생성하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsExportingProfiles(false);
    }
  };

  const exportMatchingFile = async () => {
    setIsExportingMatching(true);
    try {
      const result = await downloadMatchingUploadWorkbook({ periodId: selectedPeriodId });
      toast({
        title: '매칭 다운로드가 완료되었습니다.',
        description: `${result.rowCount ?? 0}건의 현재/이전 평가자 매칭 이력을 업로드 양식 그대로 받았습니다.`,
      });
    } catch (error) {
      console.error('매칭 다운로드 실패:', error);
      toast({
        title: '매칭 다운로드 실패',
        description: '매칭 현황 파일을 생성하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsExportingMatching(false);
    }
  };

  const importProfileFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast({
        title: '엑셀 파일을 선택해 주세요.',
        description: '평가대상자 xlsx/xls 파일만 업로드할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }

    setIsImportingProfiles(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        cellDates: true,
      });
      const rows = workbook.SheetNames.flatMap((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) return [];
        const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          raw: true,
          defval: '',
        }) as unknown[][];
        if (isProfileSheet(sheetRows)) {
          return buildEmployeeProfileRows(sheetName, sheetRows);
        }
        return [];
      });

      if (rows.length === 0) {
        throw new Error('평가대상자 양식의 시트를 찾을 수 없습니다.');
      }

      // 바로 반영하지 않고 변경 미리보기를 띄운다(증분 병합 · 미리보기 후 적용).
      const result = diffProfileRows(rows, employees);
      setPendingUpload({ kind: 'profile', fileName: file.name, rows, result });
    } catch (error) {
      console.error('평가대상자 엑셀 업로드 실패:', error);
      toast({
        title: '대상자 업로드 실패',
        description: error instanceof Error ? error.message : '대상자 파일을 처리하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsImportingProfiles(false);
    }
  };

  const importMatchingFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast({
        title: '엑셀 파일을 선택해 주세요.',
        description: '개인별 매칭결과 xlsx/xls 파일만 업로드할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }

    setIsImportingMatching(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        cellDates: true,
      });
      const sheetName = workbook.SheetNames[0];
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
      if (!worksheet) {
        throw new Error('엑셀 시트를 찾을 수 없습니다.');
      }

      const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: true,
        defval: '',
      }) as unknown[][];
      if (!hasMatchingImportHeaders(sheetRows)) {
        throw new Error('개인별 매칭결과 양식의 13개 헤더가 필요합니다.');
      }
      const rows = buildMatchingImportRows(sheetRows);
      if (rows.length === 0) {
        throw new Error('업로드할 매칭 데이터가 없습니다.');
      }

      // 바로 반영하지 않고, 서버 dry-run 으로 reconcile 분류(신규/변경/정정/무시/삭제)를 받아 미리보기.
      const result = await employeeService.previewMatchingRows({ rows });
      setPendingUpload({ kind: 'matching', fileName: file.name, sheetName: sheetName ?? '', rows, result });
    } catch (error) {
      console.error('매칭 엑셀 업로드 실패:', error);
      toast({
        title: '매칭 업로드 실패',
        description: error instanceof Error ? error.message : '매칭 파일을 처리하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsImportingMatching(false);
    }
  };

  // 미리보기에서 "적용"을 누르면 실제 업로드를 수행한다(기존 검증된 서버 로직 사용).
  const handleConfirmUpload = async () => {
    if (!pendingUpload) return;
    setIsApplyingUpload(true);
    try {
      if (pendingUpload.kind === 'profile') {
        const r = await employeeService.importEmployeeProfiles({
          source_file_name: pendingUpload.fileName,
          changed_by: actorId,
          evaluation_period_id: selectedPeriodId,
          rows: pendingUpload.rows,
        });
        await reload();
        toast({
          title: '대상자 업로드가 완료되었습니다.',
          description: `${r.applied_count}명 등록 · 평가자 ${r.evaluator_count}명 · 경고 ${r.warning_count}건`,
        });
      } else {
        const r = await employeeService.importMatchingRows({
          source_file_name: pendingUpload.fileName,
          source_sheet_name: pendingUpload.sheetName,
          changed_by: actorId,
          evaluation_period_id: selectedPeriodId,
          rows: pendingUpload.rows,
        });
        await reload();
        toast({
          title: '매칭 업로드가 완료되었습니다.',
          description: `${r.applied_count}명 반영 · 이력 ${r.assignment_history_count ?? 0}건 · 경고 ${r.warning_count}건`,
        });
      }
      setPendingUpload(null);
    } catch (error) {
      console.error('업로드 적용 실패:', error);
      toast({
        title: '업로드 적용 실패',
        description: error instanceof Error ? error.message : '파일을 처리하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsApplyingUpload(false);
    }
  };

  return (
    <>
      <PageHeader
        title="사용자 관리"
        subtitle={`이 평가기간 대상자 ${records.filter((r) => r.evaluation).length}명 · 전체 등록 ${employees.length}명`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={openProfileFileDialog}
              disabled={isImportingProfiles}
            >
              {isImportingProfiles ? '업로드 중' : '대상자 업로드'}
            </button>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={exportProfileFile}
              disabled={isExportingProfiles}
            >
              {isExportingProfiles ? '다운로드 중' : '대상자 다운로드'}
            </button>
            <input
              ref={profileFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={importProfileFile}
              style={{ display: 'none' }}
            />
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={openMatchingFileDialog}
              disabled={isImportingMatching}
            >
              {isImportingMatching ? '업로드 중' : '매칭 업로드'}
            </button>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={exportMatchingFile}
              disabled={isExportingMatching}
            >
              {isExportingMatching ? '다운로드 중' : '매칭 다운로드'}
            </button>
            <input
              ref={matchingFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={importMatchingFile}
              style={{ display: 'none' }}
            />
            <button className="sd-btn sd-btn-primary sd-btn-sm" onClick={() => setShowAddModal(true)}>
              + 사용자 추가
            </button>
          </div>
        }
        filters={
          <>
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 380 }}>
              <span
                style={{ position: 'absolute', left: 12, top: 11, color: 'var(--fg-subtle)', pointerEvents: 'none' }}
              >
                <IconSearch width={16} height={16} />
              </span>
              <input
                className="sd-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 · 부서 검색"
                style={{ paddingLeft: 36, width: '100%' }}
              />
            </div>

            <OrgChecklist items={orgRosterEmployees} value={orgNodeKeys} onChange={setOrgNodeKeys} />

            <div style={{ display: 'flex', gap: 6 }}>
              {roleFilters.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setSelectedRole(filter.id)}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 8,
                    border: '1px solid',
                    borderColor: selectedRole === filter.id ? 'var(--ok-orange)' : 'var(--border)',
                    background: selectedRole === filter.id ? 'var(--ok-orange)' : 'transparent',
                    color: selectedRole === filter.id ? '#fff' : 'var(--fg)',
                    fontSize: 'var(--fs-body)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setGroupBySection((v) => !v)}
              aria-pressed={groupBySection}
              title="조직(법인·본부·부·팀)별로 행을 묶어서 봅니다."
              style={{
                padding: '5px 14px',
                borderRadius: 8,
                fontSize: 'var(--fs-body)',
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${groupBySection ? 'var(--ok-orange)' : 'var(--border)'}`,
                background: groupBySection ? 'var(--ok-orange-50)' : 'transparent',
                color: groupBySection ? 'var(--ok-orange)' : 'var(--fg)',
              }}
            >
              묶어서 보기 {groupBySection ? 'ON' : 'OFF'}
            </button>
          </>
        }
      />

      <div style={{ padding: '24px 32px 32px' }}>
        <div className="sd-card sd-card-lg" style={{ padding: 0, overflow: 'hidden' }}>
          {/* 다중 선택 일괄 작업 바 */}
          {selectedCount > 0 && (
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--ok-orange-50)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <strong style={{ fontSize: 'var(--fs-body)' }}>{selectedCount}명 선택됨</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                  평가자 일괄 변경:
                </span>
                <EvaluatorPicker
                  options={evaluatorOptions}
                  value={bulkEvaluatorId}
                  onChange={setBulkEvaluatorId}
                  placeholder="평가자 선택…"
                  minWidth={200}
                />
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                  변경일
                </span>
                <input
                  type="date"
                  className="sd-input"
                  value={bulkChangeDate}
                  onChange={(e) => setBulkChangeDate(e.target.value)}
                  style={{ width: 150 }}
                />
                <button
                  className="sd-btn sd-btn-primary sd-btn-sm"
                  onClick={handleBulkEvaluatorChange}
                  disabled={bulkActionRunning || !bulkEvaluatorId}
                >
                  {bulkActionRunning ? '처리 중' : '적용'}
                </button>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  onClick={handleBulkDelete}
                  disabled={bulkActionRunning}
                  style={{ color: 'var(--danger, #B91C1C)' }}
                >
                  {bulkActionRunning ? '처리 중' : '선택 삭제'}
                </button>
                <button
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  onClick={clearSelection}
                  disabled={bulkActionRunning}
                >
                  선택 해제
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div style={{ padding: 20, color: 'var(--fg-muted)' }}>직원 목록을 불러오는 중입니다.</div>
          ) : error ? (
            <div style={{ padding: 20, color: 'var(--danger)' }}>{error}</div>
          ) : (
            <Table className="sd-users-table">
              <TableHeader style={{ background: 'var(--bg-muted)' }}>
                <TableRow>
                  <TableHead style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected && !allPageSelected;
                      }}
                      onChange={toggleSelectPage}
                      aria-label="현재 페이지 전체 선택"
                    />
                  </TableHead>
                  <TableHead style={{ width: 96 }}>사번</TableHead>
                  <TableHead style={{ width: 130 }}>이름</TableHead>
                  <TableHead style={{ width: 110, whiteSpace: 'nowrap' }}>직책</TableHead>
                  <TableHead style={{ width: 80, whiteSpace: 'nowrap' }}>법인</TableHead>
                  <TableHead style={{ width: 140, whiteSpace: 'nowrap' }}>본부</TableHead>
                  <TableHead style={{ width: 140, whiteSpace: 'nowrap' }}>부</TableHead>
                  <TableHead style={{ width: 140, whiteSpace: 'nowrap' }}>팀</TableHead>
                  <TableHead style={{ width: 110, whiteSpace: 'nowrap' }}>직무</TableHead>
                  <TableHead style={{ width: 92 }}>레벨</TableHead>
                  <TableHead style={{ width: 220 }}>역할</TableHead>
                  <TableHead style={{ width: 140 }}>평가자</TableHead>
                  <TableHead style={{ width: 110 }}>평가 상태</TableHead>
                  <TableHead className="text-right" style={{ minWidth: 140, position: 'sticky', right: 0, background: 'var(--bg-muted)', zIndex: 2, borderLeft: '1px solid var(--border)' }}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedEmployees.map((employee, index) => {
                  const evaluatorName = employee.evaluator_id
                    ? (employeeMap.get(employee.evaluator_id)?.name ?? employee.evaluator_id)
                    : '-';
                  const record = recordMap.get(employee.employee_id);
                  const evaluation = record?.evaluation;
                  const currentStatus = evaluation?.evaluation_status;
                  const isEditing = editingEmployeeId === employee.employee_id && Boolean(editForm);
                  const isSaving = savingEmployeeId === employee.employee_id;
                  // 묶어서 보기: 그룹 키가 바뀌는 첫 행 앞에 섹션 헤더를 넣는다(현재 페이지 기준).
                  const groupKey = orgGroupKey(employee);
                  const showGroupHeader =
                    groupBySection &&
                    (index === 0 || orgGroupKey(pagedEmployees[index - 1]) !== groupKey);
                  const groupCount = showGroupHeader
                    ? pagedEmployees.filter((e) => orgGroupKey(e) === groupKey).length
                    : 0;
                  return (
                    <Fragment key={employee.id}>
                    {showGroupHeader && (
                      <TableRow>
                        <TableCell
                          colSpan={14}
                          style={{
                            background: 'var(--ok-orange-50)',
                            borderTop: '2px solid var(--ok-orange-100)',
                            fontWeight: 800,
                            color: 'var(--ok-brown)',
                          }}
                        >
                          {groupKey}
                          <span style={{ marginLeft: 8, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
                            {groupCount}명
                          </span>
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow style={selectedIds.has(employee.employee_id) ? { background: 'var(--ok-orange-50)' } : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(employee.employee_id)}
                          onChange={() => toggleSelect(employee.employee_id)}
                          aria-label={`${employee.name} 선택`}
                        />
                      </TableCell>
                      <TableCell
                        style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontFamily: 'monospace' }}
                      >
                        {employee.employee_id}
                      </TableCell>
                      <TableCell>
                        {isEditing && editForm ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <input
                              className="sd-input"
                              value={editForm.name}
                              onChange={(event) => updateEditForm('name', event.target.value)}
                              style={{ minWidth: 0 }}
                            />
                            <label
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 'var(--fs-xs)',
                                color: editForm.onLeave ? 'var(--ok-brown)' : 'var(--fg-muted)',
                                fontWeight: editForm.onLeave ? 700 : 600,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={editForm.onLeave}
                                onChange={(event) => updateEditForm('onLeave', event.target.checked)}
                              />
                              휴직 처리
                            </label>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                            <div
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: '50%',
                                background: 'var(--ok-orange)',
                                color: '#fff',
                                fontSize: 'var(--fs-sm)',
                                fontWeight: 800,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {employee.name.charAt(0)}
                            </div>
                            <strong style={{ whiteSpace: 'nowrap' }}>{employee.name}</strong>
                            {isOnLeave(employee) && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  padding: '1px 7px',
                                  borderRadius: 999,
                                  background: 'var(--bg-muted)',
                                  color: 'var(--fg-muted)',
                                  fontSize: 'var(--fs-xs)',
                                  fontWeight: 800,
                                  border: '1px solid var(--border)',
                                  flexShrink: 0,
                                }}
                              >
                                휴직
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.position}
                            onChange={(event) => updateEditForm('position', event.target.value)}
                            style={{ minWidth: 0 }}
                          />
                        ) : (
                          employee.position
                        )}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.orgCorporation}
                            onChange={(event) => updateEditForm('orgCorporation', event.target.value)}
                            style={{ minWidth: 0 }}
                          />
                        ) : (
                          getOrgValue(employee, 'corporation') || '-'
                        )}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.orgDivision}
                            onChange={(event) => updateEditForm('orgDivision', event.target.value)}
                            style={{ minWidth: 0 }}
                          />
                        ) : (
                          getOrgValue(employee, 'division') || '-'
                        )}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.orgDepartment}
                            onChange={(event) => updateEditForm('orgDepartment', event.target.value)}
                            style={{ minWidth: 0 }}
                          />
                        ) : (
                          getOrgValue(employee, 'department') || '-'
                        )}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.orgTeam}
                            onChange={(event) => updateEditForm('orgTeam', event.target.value)}
                            style={{ minWidth: 0 }}
                          />
                        ) : (
                          getOrgValue(employee, 'team') || '-'
                        )}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.jobRole}
                            onChange={(event) => updateEditForm('jobRole', event.target.value)}
                            style={{ minWidth: 0 }}
                          />
                        ) : (
                          employee.job_role ?? '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing && editForm ? (
                          <select
                            className="sd-input"
                            value={editForm.growthLevel}
                            onChange={(event) => updateEditForm('growthLevel', event.target.value)}
                            style={{ width: 84 }}
                          >
                            <option value="">해당없음</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                          </select>
                        ) : employee.growth_level ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 12,
                              background: 'var(--bg-muted)',
                              border: '1px solid var(--border)',
                              fontSize: 'var(--fs-sm)',
                              fontWeight: 600,
                            }}
                          >
                            Lv.{employee.growth_level}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing && editForm ? (
                          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
                            {editableRoleOptions.map((role) => (
                              <label
                                key={role.id}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  fontSize: 'var(--fs-sm)',
                                  fontWeight: 700,
                                  color: 'var(--fg-muted)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={editForm.roles.includes(role.id)}
                                  onChange={() => toggleEditRole(role.id)}
                                />
                                {role.label}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 4 }}>
                            {employee.available_roles.map((role) => (
                              <span
                                key={role}
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: 12,
                                  background: ROLE_BG[role] ?? 'var(--bg-muted)',
                                  color: ROLE_COLOR[role] ?? 'var(--fg)',
                                  border: `1px solid ${ROLE_BORDER[role] ?? 'var(--border)'}`,
                                  fontSize: 'var(--fs-sm)',
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                }}
                              >
                                {roleLabel(role as UserRole)}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell style={{ color: isEditing ? 'var(--fg)' : 'var(--fg-muted)' }}>
                        {evaluatorName}
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>
                        <Pill tone={statusTone(currentStatus)}>
                          {statusLabel(currentStatus)}
                        </Pill>
                      </TableCell>
                      <TableCell
                        className="text-right"
                        style={{
                          position: 'sticky',
                          right: 0,
                          background: selectedIds.has(employee.employee_id) ? 'var(--ok-orange-50)' : 'var(--bg-card)',
                          zIndex: 1,
                          borderLeft: '1px solid var(--border)',
                        }}
                      >
                        {isEditing ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              className="sd-btn sd-btn-primary sd-btn-sm"
                              onClick={() => saveEmployeeEdit(employee)}
                              disabled={isSaving}
                            >
                              {isSaving ? '저장 중' : '저장'}
                            </button>
                            <button
                              className="sd-btn sd-btn-ghost sd-btn-sm"
                              onClick={cancelEditing}
                              disabled={isSaving}
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <button
                              className="sd-btn sd-btn-ghost sd-btn-sm"
                              onClick={() => openAssignmentHistory(employee.employee_id)}
                            >
                              이력
                            </button>
                            <button
                              className="sd-btn sd-btn-ghost sd-btn-sm"
                              onClick={() => startEditing(employee)}
                            >
                              편집
                            </button>
                            <button
                              className="sd-btn sd-btn-ghost sd-btn-sm"
                              onClick={() => handleDeleteUser(employee)}
                              disabled={deletingEmployeeId === employee.employee_id}
                              style={{ color: 'var(--danger, #B91C1C)' }}
                            >
                              {deletingEmployeeId === employee.employee_id ? '삭제 중' : '삭제'}
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    </Fragment>
                  );
                })}

                {!filteredEmployees.length && (
                  <TableRow>
                    <TableCell colSpan={14} style={{ color: 'var(--fg-muted)' }}>
                      {records.filter((r) => r.evaluation).length === 0
                        ? '선택한 평가기간에 매칭된 직원이 없습니다. 대상자/매칭 엑셀을 업로드하세요.'
                        : '조건에 맞는 사용자가 없습니다.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {!isLoading && !error && totalFiltered > 0 && (
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                전체 {totalFiltered}명 · {currentPage * pageSize + 1}–
                {Math.min(currentPage * pageSize + pageSize, totalFiltered)} 표시
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>페이지당</span>
                <select
                  className="sd-input"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={{ width: 80 }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  onClick={() => setPageIndex(Math.max(0, currentPage - 1))}
                  disabled={currentPage <= 0}
                >
                  이전
                </button>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, minWidth: 72, textAlign: 'center' }}>
                  {currentPage + 1} / {pageCount}
                </span>
                <button
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  onClick={() => setPageIndex(Math.min(pageCount - 1, currentPage + 1))}
                  disabled={currentPage >= pageCount - 1}
                >
                  다음
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {historyModalEmployeeId && employeeMap.get(historyModalEmployeeId) && (
        <EvaluatorHistoryModal
          employee={employeeMap.get(historyModalEmployeeId)!}
          historyItems={assignmentHistoryByEmployee[historyModalEmployeeId] ?? []}
          evaluatorOptions={evaluatorOptions}
          periods={periods}
          defaultPeriodId={selectedPeriodId ?? periods[0]?.id ?? ''}
          isLoading={loadingHistoryEmployeeId === historyModalEmployeeId}
          actionId={historyActionId}
          employeeEvaluations={evaluationsByEmployee[historyModalEmployeeId] ?? []}
          isLoadingEvaluations={loadingEvaluationsEmployeeId === historyModalEmployeeId}
          updatingEvaluationId={updatingEvaluationId}
          onChangeEvaluationStatus={(evaluationId, employeeName, currentStatus, nextStatus) =>
            changeEvaluationStatus(evaluationId, employeeName, currentStatus, nextStatus)
          }
          onAddChange={addAssignmentChange}
          onCorrect={correctAssignmentChange}
          onCancelChange={cancelAssignmentChange}
          onRefresh={() => {
            void loadAssignmentHistory(historyModalEmployeeId, true);
            void loadEmployeeEvaluations(historyModalEmployeeId, true);
          }}
          onClose={closeAssignmentHistory}
        />
      )}

      {showAddModal && (
        <AddEmployeeModal
          evaluatorOptions={evaluatorOptions}
          isSaving={isAddingUser}
          onSubmit={handleCreateUser}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {pendingUpload && (
        <UploadPreviewModal
          title={pendingUpload.kind === 'profile' ? '대상자 업로드' : '매칭 업로드'}
          fileName={pendingUpload.fileName}
          result={pendingUpload.result}
          isApplying={isApplyingUpload}
          onConfirm={handleConfirmUpload}
          onClose={() => setPendingUpload(null)}
        />
      )}
    </>
  );
};

export default HrUsersPage;
