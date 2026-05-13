import { Fragment, useMemo, useRef, useState, type ChangeEvent } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { IconSearch, Pill } from '@/components/brand';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { employeeService, evaluationService } from '@/lib/services';
import type {
  EmployeeProfileImportRowInput,
  MatchingImportRowInput,
} from '@/lib/services/employeeService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  Employee,
  EvaluationStatus,
  EvaluatorAssignmentChangeType,
  EvaluatorAssignmentHistory,
  EvaluatorAssignmentStatus,
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

const roleLabel = (role: UserRole) => {
  if (role === 'hr') return 'HR';
  if (role === 'evaluator') return '평가자';
  return '피평가자';
};

const statusOptions: Array<{ id: EvaluationStatus; label: string }> = [
  { id: 'in-progress', label: '작성 중' },
  { id: 'submitted', label: '검토 대기' },
  { id: 'evaluating', label: '평가 중' },
  { id: 'completed', label: '완료' },
  { id: 'locked', label: '잠금' },
];

const statusLabel = (status?: EvaluationStatus | null) => {
  if (status === 'submitted') return '검토 대기';
  if (status === 'evaluating') return '평가 중';
  if (status === 'completed') return '완료';
  if (status === 'locked') return '잠금';
  if (status === 'draft' || status === 'in-progress') return '작성 중';
  return '평가 없음';
};

const statusTone = (status?: EvaluationStatus | null) => {
  if (status === 'submitted') return 'orange';
  if (status === 'evaluating') return 'info';
  if (status === 'completed') return 'success';
  if (status === 'locked') return 'neutral';
  if (status === 'draft' || status === 'in-progress') return 'warning';
  return 'neutral';
};

const assignmentTypeLabel = (type: EvaluatorAssignmentChangeType) => {
  if (type === 'cancel') return '취소';
  return '변경';
};

const assignmentStatusLabel = (status: EvaluatorAssignmentStatus) =>
  status === 'cancelled' ? '취소됨' : '적용됨';

const assignmentStatusTone = (status: EvaluatorAssignmentStatus) =>
  status === 'cancelled' ? 'neutral' : 'success';

const formatAssignmentDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

type EmployeeEditForm = {
  name: string;
  position: string;
  department: string;
  growthLevel: string;
  evaluatorId: string;
  roles: UserRole[];
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

const MATCHING_IMPORT_HEADERS = [
  '사번',
  '성명',
  '소속순번',
  '부서ID',
  '부서명',
  '근무시작일',
  '근무종료일',
  '평가자사번',
  '평가자명',
  '확인자사번',
  '확인자명',
  '평가유형',
  '결과',
];

const hasMatchingImportHeaders = (sheetRows: unknown[][]) => {
  const headerRow = sheetRows[0] ?? [];
  return MATCHING_IMPORT_HEADERS.every((header, index) => toCellText(headerRow[index]) === header);
};

const buildMatchingImportRows = (sheetRows: unknown[][]): MatchingImportRowInput[] =>
  sheetRows
    .slice(1)
    .map((row, index) => {
      const employeeId = toCellText(row[0]);
      const employeeName = toCellText(row[1]);
      const orgSequence = toOptionalCellText(row[2]);
      const departmentId = toOptionalCellText(row[3]);
      const departmentName = toOptionalCellText(row[4]);
      const workStartDate = toOptionalCellText(row[5]);
      const workEndDate = toOptionalCellText(row[6]);
      const evaluatorId = toOptionalCellText(row[7]);
      const evaluatorName = toOptionalCellText(row[8]);
      const confirmerId = toOptionalCellText(row[9]);
      const confirmerName = toOptionalCellText(row[10]);
      const evaluationType = toOptionalCellText(row[11]);
      const matchingResult = toOptionalCellText(row[12]);

      return {
        row_number: index + 2,
        employee_id: employeeId,
        employee_name: employeeName,
        org_sequence: orgSequence,
        department_id: departmentId,
        department_name: departmentName,
        work_start_date: workStartDate,
        work_end_date: workEndDate,
        evaluator_id: evaluatorId,
        evaluator_name: evaluatorName,
        confirmer_id: confirmerId,
        confirmer_name: confirmerName,
        evaluation_type: evaluationType,
        matching_result: matchingResult,
        raw_data: {
          employee_id: employeeId,
          employee_name: employeeName,
          org_sequence: orgSequence,
          department_id: departmentId,
          department_name: departmentName,
          work_start_date: workStartDate,
          work_end_date: workEndDate,
          evaluator_id: evaluatorId,
          evaluator_name: evaluatorName,
          confirmer_id: confirmerId,
          confirmer_name: confirmerName,
          evaluation_type: evaluationType,
          matching_result: matchingResult,
        },
      };
    })
    .filter((row) => row.employee_id || row.employee_name);

const PROFILE_SHEET1_HEADERS = [
  '평가그룹',
  '사번',
  '성명',
  '성장레벨(직급)',
  '부서명',
  '직책',
  '권한1',
  '권한2',
  '권한3',
  '직무',
];

const PROFILE_SHEET2_HEADERS = [
  '평가그룹',
  '사번',
  '성명',
  '소속순번',
  '선택',
  '부서ID',
  '부서명',
  '근무시작일',
  '근무종료일',
  '성장레벨(직급)',
  '직책',
];

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

const hasHeaders = (sheetRows: unknown[][], expectedHeaders: string[]) => {
  const headerRow = sheetRows[0] ?? [];
  return expectedHeaders.every((header, index) => toCellText(headerRow[index]) === header);
};

const buildEmployeeProfileRows = (
  sheetName: string,
  sheetRows: unknown[][],
): EmployeeProfileImportRowInput[] => {
  const isSummarySheet = hasHeaders(sheetRows, PROFILE_SHEET1_HEADERS);
  const isDetailSheet = hasHeaders(sheetRows, PROFILE_SHEET2_HEADERS);
  if (!isSummarySheet && !isDetailSheet) return [];

  return sheetRows
    .slice(1)
    .map((row, index) => {
      if (isDetailSheet) {
        const item = {
          sheet_name: sheetName,
          row_number: index + 2,
          evaluation_group: toOptionalCellText(row[0]),
          employee_id: toCellText(row[1]),
          employee_name: toCellText(row[2]),
          org_sequence: toOptionalCellText(row[3]),
          department_id: toOptionalCellText(row[5]),
          department_name: toOptionalCellText(row[6]),
          work_start_date: toOptionalCellText(row[7]),
          work_end_date: toOptionalCellText(row[8]),
          growth_level_label: toOptionalCellText(row[9]),
          position: toOptionalCellText(row[10]),
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
        evaluation_group: toOptionalCellText(row[0]),
        employee_id: toCellText(row[1]),
        employee_name: toCellText(row[2]),
        growth_level_label: toOptionalCellText(row[3]),
        department_name: toOptionalCellText(row[4]),
        position: toOptionalCellText(row[5]),
        available_roles: parseRolesFromCells(row[6], row[7], row[8]),
        job_role: toOptionalCellText(row[9]),
      };
      return { ...item, raw_data: item };
    })
    .filter((row) => row.employee_id || row.employee_name);
};

const HrUsersPage = () => {
  const profileFileInputRef = useRef<HTMLInputElement | null>(null);
  const matchingFileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<'all' | UserRole>('all');
  const [statusDrafts, setStatusDrafts] = useState<Record<string, EvaluationStatus>>({});
  const [updatingEvaluationId, setUpdatingEvaluationId] = useState<string | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [savingEmployeeId, setSavingEmployeeId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EmployeeEditForm | null>(null);
  const [expandedHistoryEmployeeId, setExpandedHistoryEmployeeId] = useState<string | null>(null);
  const [assignmentHistoryByEmployee, setAssignmentHistoryByEmployee] = useState<
    Record<string, EvaluatorAssignmentHistory[]>
  >({});
  const [loadingHistoryEmployeeId, setLoadingHistoryEmployeeId] = useState<string | null>(null);
  const [historyActionId, setHistoryActionId] = useState<string | null>(null);
  const [isImportingProfiles, setIsImportingProfiles] = useState(false);
  const [isImportingMatching, setIsImportingMatching] = useState(false);
  const { employees, records, isLoading, error, reload } = useAllEmployees();
  const { toast } = useToast();
  const { user } = useAuth();
  const actorId = user?.employeeId ?? user?.id ?? null;

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.employee_id, employee])),
    [employees],
  );
  const recordMap = useMemo(
    () => new Map(records.map((record) => [record.employee.employee_id, record])),
    [records],
  );
  const evaluatorOptions = useMemo(
    () =>
      employees
        .filter((employee) => employee.available_roles.includes('evaluator'))
        .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)),
    [employees],
  );

  const filteredEmployees = useMemo(
    () =>
      [...employees]
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
        .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)),
    [employees, query, selectedRole],
  );

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

  const toggleAssignmentHistory = async (employeeId: string) => {
    if (expandedHistoryEmployeeId === employeeId) {
      setExpandedHistoryEmployeeId(null);
      return;
    }

    setExpandedHistoryEmployeeId(employeeId);
    await loadAssignmentHistory(employeeId);
  };

  const startEditing = (employee: Employee) => {
    setEditingEmployeeId(employee.employee_id);
    setEditForm({
      name: employee.name,
      position: employee.position,
      department: employee.department,
      growthLevel: employee.growth_level == null ? '' : String(employee.growth_level),
      evaluatorId: employee.evaluator_id ?? '',
      roles: employee.available_roles as UserRole[],
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

  const saveEmployeeEdit = async (
    employee: Employee,
    evaluatorMode: 'assignment' | 'direct' = 'assignment',
  ) => {
    if (!editForm) return;

    const name = editForm.name.trim();
    const position = editForm.position.trim();
    const department = editForm.department.trim();
    const growthLevel = editForm.growthLevel.trim();
    const nextEvaluatorId = editForm.evaluatorId || null;
    const evaluatorChanged = (employee.evaluator_id ?? null) !== nextEvaluatorId;

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

    if (evaluatorMode === 'direct' && !evaluatorChanged) {
      toast({
        title: '평가자 수정 대상이 없습니다.',
        description: '현재 평가자와 다른 평가자를 선택한 뒤 실행해주세요.',
      });
      return;
    }

    if (evaluatorMode === 'direct') {
      const ok = window.confirm(
        `${employee.name}님의 평가자를 이력 없이 수정할까요?\n\n기존 평가자가 입력한 평가/피드백은 수정한 평가자에게 그대로 승계됩니다.`,
      );
      if (!ok) return;
    } else if (evaluatorChanged) {
      const ok = window.confirm(
        `${employee.name}님의 평가자 변경 이력을 남기고 새 평가건을 생성할까요?\n\n잘못 매칭을 바로잡는 경우라면 "평가자 수정"을 사용하세요.`,
      );
      if (!ok) return;
    }

    setSavingEmployeeId(employee.employee_id);
    try {
      const baseUpdates = {
        name,
        position,
        department,
        growth_level: parsedGrowthLevel,
        available_roles: editForm.roles,
        changed_by: actorId,
      };

      if (evaluatorMode === 'direct') {
        await employeeService.updateEmployee(employee.employee_id, baseUpdates);
        const result = await employeeService.editEvaluator(employee.employee_id, {
          evaluator_id: nextEvaluatorId,
          changed_by: actorId,
          reason: 'HR evaluator edit',
        });
        await reload();
        cancelEditing();
        toast({
          title: '평가자가 수정되었습니다.',
          description:
            result.transferred_entries + result.merged_entries > 0
              ? `기존 평가 ${result.transferred_entries + result.merged_entries}건을 수정한 평가자에게 넘겼습니다.`
              : '평가자 변경 이력 없이 현재 평가자만 수정했습니다.',
        });
        return;
      }

      await employeeService.updateEmployee(employee.employee_id, {
        ...baseUpdates,
        evaluator_id: nextEvaluatorId,
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
    const ok = window.confirm(
      `${employee.name}님의 최근 평가자 변경을 취소하고 "${previousEvaluator}"(으)로 되돌릴까요?`,
    );
    if (!ok) return;

    setHistoryActionId(history.id);
    try {
      await employeeService.cancelEvaluatorAssignment(history.id, {
        changed_by: actorId,
        cancel_reason: 'HR assignment cancellation',
      });
      await reload();
      await loadAssignmentHistory(employee.employee_id, true);
      toast({
        title: '평가자 변경이 취소되었습니다.',
        description: `${employee.name}: ${previousEvaluator}`,
      });
    } catch (error) {
      console.error('평가자 변경 취소 실패:', error);
      toast({
        title: '평가자 변경 취소 실패',
        description: '최근 적용된 변경만 취소할 수 있습니다.',
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
  ) => {
    const nextStatus = statusDrafts[evaluationId] ?? currentStatus;
    if (nextStatus === currentStatus) return;

    const ok = window.confirm(
      `${employeeName}님의 평가 단계를 "${statusLabel(currentStatus)}"에서 "${statusLabel(nextStatus)}"(으)로 변경할까요?`,
    );
    if (!ok) return;

    setUpdatingEvaluationId(evaluationId);
    try {
      await evaluationService.updateEvaluation(evaluationId, {
        evaluation_status: nextStatus,
        last_modified: new Date().toISOString(),
      });
      setStatusDrafts((prev) => {
        const next = { ...prev };
        delete next[evaluationId];
        return next;
      });
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

  const openMatchingFileDialog = () => {
    if (isImportingMatching) return;
    matchingFileInputRef.current?.click();
  };

  const openProfileFileDialog = () => {
    if (isImportingProfiles) return;
    profileFileInputRef.current?.click();
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
        if (hasHeaders(sheetRows, PROFILE_SHEET1_HEADERS) || hasHeaders(sheetRows, PROFILE_SHEET2_HEADERS)) {
          return buildEmployeeProfileRows(sheetName, sheetRows);
        }
        return [];
      });

      if (rows.length === 0) {
        throw new Error('평가대상자 양식의 시트를 찾을 수 없습니다.');
      }

      const result = await employeeService.importEmployeeProfiles({
        source_file_name: file.name,
        changed_by: actorId,
        rows,
      });
      await reload();

      toast({
        title: '대상자 업로드가 완료되었습니다.',
        description: `${result.applied_count}명 등록 · 평가자 ${result.evaluator_count}명 · 경고 ${result.warning_count}건`,
      });
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

      const result = await employeeService.importMatchingRows({
        source_file_name: file.name,
        source_sheet_name: sheetName,
        changed_by: actorId,
        rows,
      });
      await reload();

      toast({
        title: '매칭 업로드가 완료되었습니다.',
        description: `${result.applied_count}명 반영 · 이력 ${result.assignment_history_count ?? 0}건 · 경고 ${result.warning_count}건`,
      });
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

  return (
    <>
      <PageHeader
        title="사용자 관리"
        subtitle={`${employees.length}명 · 평가 권한 & 매핑 관리`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={openProfileFileDialog}
              disabled={isImportingProfiles}
            >
              {isImportingProfiles ? '업로드 중' : '대상자 업로드'}
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
            <input
              ref={matchingFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={importMatchingFile}
              style={{ display: 'none' }}
            />
            <button className="sd-btn sd-btn-primary sd-btn-sm">+ 사용자 추가</button>
          </div>
        }
      />

      <div style={{ padding: '24px 32px 32px' }}>
        <div className="sd-card sd-card-lg" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Search + filter row */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 380 }}>
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 11,
                  color: 'var(--fg-subtle)',
                  pointerEvents: 'none',
                }}
              >
                <IconSearch width={16} height={16} />
              </span>
              <input
                className="sd-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 · 부서 검색"
                style={{ paddingLeft: 36 }}
              />
            </div>

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
          </div>

          {isLoading ? (
            <div style={{ padding: 20, color: 'var(--fg-muted)' }}>직원 목록을 불러오는 중입니다.</div>
          ) : error ? (
            <div style={{ padding: 20, color: 'var(--danger)' }}>{error}</div>
          ) : (
            <Table>
              <TableHeader style={{ background: 'var(--bg-muted)' }}>
                <TableRow>
                  <TableHead>사번</TableHead>
                  <TableHead>이름</TableHead>
                  <TableHead>직급</TableHead>
                  <TableHead>부서</TableHead>
                  <TableHead>직무</TableHead>
                  <TableHead>레벨</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>평가자</TableHead>
                  <TableHead>평가 상태</TableHead>
                  <TableHead>단계 변경</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((employee) => {
                  const evaluatorName = employee.evaluator_id
                    ? (employeeMap.get(employee.evaluator_id)?.name ?? employee.evaluator_id)
                    : '-';
                  const record = recordMap.get(employee.employee_id);
                  const evaluation = record?.evaluation;
                  const currentStatus = evaluation?.evaluation_status;
                  const selectableCurrentStatus =
                    currentStatus === 'draft' ? 'in-progress' : currentStatus;
                  const draftStatus = evaluation
                    ? statusDrafts[evaluation.id] ?? selectableCurrentStatus ?? 'in-progress'
                    : 'in-progress';
                  const canChangeStatus = Boolean(evaluation?.id && employee.available_roles.includes('evaluatee'));
                  const isUpdating = updatingEvaluationId === evaluation?.id;
                  const isEditing = editingEmployeeId === employee.employee_id && Boolean(editForm);
                  const isSaving = savingEmployeeId === employee.employee_id;
                  const hasEvaluatorChange =
                    isEditing &&
                    Boolean(editForm) &&
                    (employee.evaluator_id ?? '') !== editForm.evaluatorId;
                  const isHistoryExpanded = expandedHistoryEmployeeId === employee.employee_id;
                  const isHistoryLoading = loadingHistoryEmployeeId === employee.employee_id;
                  const historyItems = assignmentHistoryByEmployee[employee.employee_id] ?? [];
                  const latestActionableHistory =
                    historyItems.find(
                      (history) => history.status === 'applied' && history.change_type !== 'cancel',
                    ) ?? null;

                  return (
                    <Fragment key={employee.id}>
                    <TableRow>
                      <TableCell
                        style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontFamily: 'monospace' }}
                      >
                        {employee.employee_id}
                      </TableCell>
                      <TableCell>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.name}
                            onChange={(event) => updateEditForm('name', event.target.value)}
                            style={{ minWidth: 110 }}
                          />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                            <strong>{employee.name}</strong>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.position}
                            onChange={(event) => updateEditForm('position', event.target.value)}
                            style={{ minWidth: 90 }}
                          />
                        ) : (
                          employee.position
                        )}
                      </TableCell>
                      <TableCell style={{ color: isEditing ? 'var(--fg)' : 'var(--fg-muted)' }}>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            value={editForm.department}
                            onChange={(event) => updateEditForm('department', event.target.value)}
                            style={{ minWidth: 120 }}
                          />
                        ) : (
                          employee.department
                        )}
                      </TableCell>
                      <TableCell style={{ color: 'var(--fg-muted)' }}>
                        {employee.job_role ?? '-'}
                      </TableCell>
                      <TableCell>
                        {isEditing && editForm ? (
                          <input
                            className="sd-input"
                            type="number"
                            min={1}
                            step={1}
                            value={editForm.growthLevel}
                            onChange={(event) => updateEditForm('growthLevel', event.target.value)}
                            style={{ width: 72 }}
                          />
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
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {editableRoleOptions.map((role) => (
                              <label
                                key={role.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
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
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
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
                                }}
                              >
                                {roleLabel(role as UserRole)}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell style={{ color: isEditing ? 'var(--fg)' : 'var(--fg-muted)' }}>
                        {isEditing && editForm ? (
                          <select
                            value={editForm.evaluatorId}
                            onChange={(event) => updateEditForm('evaluatorId', event.target.value)}
                            style={{
                              minWidth: 128,
                              padding: '6px 8px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--bg-card)',
                              color: 'var(--fg)',
                              fontSize: 'var(--fs-sm)',
                              fontWeight: 700,
                            }}
                          >
                            <option value="">평가자 없음</option>
                            {evaluatorOptions
                              .filter((option) => option.employee_id !== employee.employee_id)
                              .map((option) => (
                                <option key={option.employee_id} value={option.employee_id}>
                                  {option.name} · {option.department}
                                </option>
                              ))}
                          </select>
                        ) : (
                          evaluatorName
                        )}
                      </TableCell>
                      <TableCell>
                        <Pill tone={statusTone(currentStatus)}>
                          {statusLabel(currentStatus)}
                        </Pill>
                      </TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-start' }}>
                          <select
                            value={draftStatus}
                            disabled={!canChangeStatus || isUpdating || isEditing}
                            onChange={(event) =>
                              evaluation &&
                              setStatusDrafts((prev) => ({
                                ...prev,
                                [evaluation.id]: event.target.value as EvaluationStatus,
                              }))
                            }
                            title={!canChangeStatus ? '평가 레코드가 있는 피평가자만 단계 변경이 가능합니다.' : undefined}
                            style={{
                              minWidth: 104,
                              padding: '6px 8px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--bg-card)',
                              color: 'var(--fg)',
                              fontSize: 'var(--fs-sm)',
                              fontWeight: 700,
                              opacity: canChangeStatus && !isEditing ? 1 : 0.55,
                            }}
                          >
                            {statusOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            className="sd-btn sd-btn-outline sd-btn-xs"
                            disabled={!canChangeStatus || isUpdating || isEditing || draftStatus === currentStatus}
                            onClick={() =>
                              evaluation &&
                              currentStatus &&
                              changeEvaluationStatus(evaluation.id, employee.name, currentStatus)
                            }
                          >
                            {isUpdating ? '변경 중' : '변경'}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              className="sd-btn sd-btn-primary sd-btn-sm"
                              onClick={() => saveEmployeeEdit(employee, 'assignment')}
                              disabled={isSaving}
                              title={
                                hasEvaluatorChange
                                  ? '발령/담당 변경처럼 평가자 변경 이력을 남깁니다.'
                                  : undefined
                              }
                            >
                              {isSaving ? '저장 중' : hasEvaluatorChange ? '평가자 변경' : '저장'}
                            </button>
                            {hasEvaluatorChange && (
                              <button
                                className="sd-btn sd-btn-outline sd-btn-sm"
                                onClick={() => saveEmployeeEdit(employee, 'direct')}
                                disabled={isSaving}
                                title="잘못된 초기 매칭을 이력 없이 바로잡고 기존 평가를 새 평가자에게 넘깁니다."
                              >
                                평가자 수정
                              </button>
                            )}
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
                              onClick={() => toggleAssignmentHistory(employee.employee_id)}
                            >
                              {isHistoryExpanded ? '닫기' : '이력'}
                            </button>
                            <button
                              className="sd-btn sd-btn-ghost sd-btn-sm"
                              onClick={() => startEditing(employee)}
                            >
                              편집
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {isHistoryExpanded && (
                      <TableRow>
                        <TableCell colSpan={11} style={{ background: 'var(--bg-muted)', padding: 0 }}>
                          <div
                            style={{
                              margin: '0 16px 16px',
                              padding: 16,
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              background: 'var(--bg-card)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                marginBottom: 12,
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>평가자 변경 이력</div>
                                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>
                                  현재 평가자: {evaluatorName}
                                </div>
                              </div>
                              <button
                                className="sd-btn sd-btn-outline sd-btn-xs"
                                onClick={() => loadAssignmentHistory(employee.employee_id, true)}
                                disabled={isHistoryLoading}
                              >
                                {isHistoryLoading ? '조회 중' : '새로고침'}
                              </button>
                            </div>

                            {isHistoryLoading && historyItems.length === 0 ? (
                              <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                                이력을 불러오는 중입니다.
                              </div>
                            ) : historyItems.length === 0 ? (
                              <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                                평가자 변경 이력이 없습니다.
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gap: 8 }}>
                                {historyItems.map((history) => {
                                  const previousEvaluator = getEvaluatorLabel(
                                    history.previous_evaluator_id,
                                    history.previous_evaluator_name,
                                  );
                                  const newEvaluator = getEvaluatorLabel(
                                    history.new_evaluator_id,
                                    history.new_evaluator_name,
                                  );
                                  const isLatestAction =
                                    latestActionableHistory?.id === history.id &&
                                    history.status === 'applied' &&
                                    history.change_type !== 'cancel';
                                  const canCancel = isLatestAction;
                                  const isRowActionRunning = historyActionId === history.id;

                                  return (
                                    <div
                                      key={history.id}
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: '112px minmax(220px, 1fr) 82px 82px 88px',
                                        alignItems: 'center',
                                        gap: 10,
                                        padding: '10px 12px',
                                        border: '1px solid var(--border)',
                                        borderRadius: 8,
                                        background:
                                          history.status === 'cancelled'
                                            ? 'var(--bg-muted)'
                                            : 'var(--bg-card)',
                                      }}
                                    >
                                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
                                        {formatAssignmentDate(history.changed_at)}
                                      </div>
                                      <div style={{ minWidth: 0 }}>
                                        <div
                                          style={{
                                            fontSize: 'var(--fs-body)',
                                            fontWeight: 800,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                          }}
                                        >
                                          {previousEvaluator} → {newEvaluator}
                                        </div>
                                        {history.reason && (
                                          <div
                                            style={{
                                              fontSize: 'var(--fs-sm)',
                                              color: 'var(--fg-muted)',
                                              marginTop: 2,
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                            }}
                                          >
                                            {history.reason}
                                          </div>
                                        )}
                                      </div>
                                      <Pill tone={history.change_type === 'cancel' ? 'neutral' : 'orange'}>
                                        {assignmentTypeLabel(history.change_type)}
                                      </Pill>
                                      <Pill tone={assignmentStatusTone(history.status)}>
                                        {assignmentStatusLabel(history.status)}
                                      </Pill>
                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'flex-end',
                                          gap: 6,
                                        }}
                                      >
                                        <button
                                          className="sd-btn sd-btn-ghost sd-btn-xs"
                                          disabled={!canCancel || isRowActionRunning}
                                          title={!canCancel ? '최신 적용 이력만 취소할 수 있습니다.' : undefined}
                                          onClick={() => cancelAssignmentChange(employee, history)}
                                        >
                                          취소
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}

                {!filteredEmployees.length && (
                  <TableRow>
                    <TableCell colSpan={11} style={{ color: 'var(--fg-muted)' }}>
                      조건에 맞는 사용자가 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
};

export default HrUsersPage;
