import * as XLSX from 'xlsx';
import {
  employeeService,
  evaluationService,
  evaluatorQnaLogService,
  feedbackService,
  taskEvaluationEntryService,
  taskService,
} from '@/lib/services';
import type {
  EmployeeProfileImportStoredRow,
  MatchingImportStoredRow,
} from '@/lib/services/employeeService';
import type {
  Employee,
  Evaluation,
  EvaluatorAssignmentHistory,
  EvaluatorQnaLog,
  FeedbackHistory,
  Task,
  TaskEvaluationEntry,
} from '@/types';

const PROFILE_SUMMARY_HEADERS = [
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

const MATCHING_IMPORT_SHEET_NAME = '개인별 매칭결과';

const EVALUATION_SUMMARY_HEADERS = [
  '구분',
  '평가ID',
  '평가기간ID',
  '평가연도',
  '피평가자사번',
  '피평가자명',
  '직급',
  '부서',
  '성장레벨',
  '평가자사번',
  '평가자명',
  '평가자직급',
  '평가자부서',
  '평가상태',
  '과업수',
  '평가입력건수',
  '피드백이력건수',
  '총가중치',
  '가중점수',
  '달성여부',
  '평가시작일',
  '최종수정일',
  '생성일',
];

const TASK_REPORT_HEADERS = [
  '구분',
  '평가ID',
  '피평가자사번',
  '피평가자명',
  '과업UUID',
  '과업ID',
  '과업명',
  '성과보고내용',
  '가중치',
  '시작일',
  '종료일',
  '삭제일',
  '대표평가자',
  '기여방식',
  '기여범위',
  '대표점수',
  '대표평가내용',
  '피드백일시',
];

const ENTRY_DETAIL_HEADERS = [
  '구분',
  '평가ID',
  '피평가자사번',
  '피평가자명',
  '과업UUID',
  '과업ID',
  '과업명',
  '평가자사번',
  '평가자명',
  '기여방식',
  '기여범위',
  '점수',
  '평가내용',
  '피드백일시',
  '평가입력ID',
  '평가자배정이력ID',
  '상태',
  '생성일',
  '수정일',
];

const FEEDBACK_HISTORY_HEADERS = [
  '피드백ID',
  '평가ID',
  '피평가자사번',
  '피평가자명',
  '과업UUID',
  '과업ID',
  '과업명',
  '평가자사번',
  '평가자명',
  '평가내용',
  '평가입력ID',
  '상태',
  '생성일',
];

const ASSIGNMENT_HISTORY_HEADERS = [
  '피평가자사번',
  '피평가자명',
  '변경일',
  '이전평가자사번',
  '이전평가자명',
  '신규평가자사번',
  '신규평가자명',
  '평가ID',
  '평가기간ID',
  '평가기간명',
  '평가연도',
  '변경유형',
  '상태',
  '사유',
  '변경자사번',
  '변경자명',
  '취소일',
  '취소자사번',
  '취소자명',
  '취소사유',
  '대체이력ID',
];

const DEPARTMENT_STATS_HEADERS = [
  '부서',
  '대상자수',
  '평가완료수',
  '완료율',
  '평균가중점수',
  '달성자수',
  '달성율',
];

type LoadedEvaluationBundle = {
  employee: Employee;
  evaluation: Evaluation;
  kind: '현재' | '이전';
  tasks: Task[];
  entries: TaskEvaluationEntry[];
  feedbacks: FeedbackHistory[];
};

type ExportResult = {
  fileName: string;
  targetCount: number;
  rowCount?: number;
  evaluationCount?: number;
  taskCount?: number;
  entryCount?: number;
  feedbackCount?: number;
};

const evaluationStatusLabel = (status?: string | null) => {
  if (status === 'completed') return '완료';
  if (status === 'submitted') return '검토 대기';
  if (status === 'evaluating') return '평가 중';
  if (status === 'locked') return '잠금';
  if (status === 'draft' || status === 'in-progress') return '작성 중';
  return status ?? '';
};

const dateText = (value?: string | null) => {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateTimeText = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ko-KR');
};

const todayText = () => new Date().toISOString().slice(0, 10);

const getTargets = (employees: Employee[]) =>
  employees
    .filter((employee) => employee.employee_id !== 'admin')
    .filter((employee) => employee.available_roles?.includes('evaluatee'))
    .sort(
      (a, b) =>
        (a.department ?? '').localeCompare(b.department ?? '') ||
        (a.name ?? '').localeCompare(b.name ?? '') ||
        a.employee_id.localeCompare(b.employee_id),
    );

const getProfileEmployees = (employees: Employee[]) =>
  employees.filter((employee) => employee.employee_id !== 'admin');

const getEmployeeMap = (employees: Employee[]) =>
  new Map(employees.map((employee) => [employee.employee_id, employee]));

const getEvaluationGroupCell = (
  employee: Employee,
  sourceRow?: EmployeeProfileImportStoredRow | null,
) => {
  if (employee.evaluation_group_name && employee.evaluation_group_id) {
    return `${employee.evaluation_group_name}[${employee.evaluation_group_id}]`;
  }
  if (employee.evaluation_group_name) return employee.evaluation_group_name;
  if (employee.evaluation_group_id) return `[${employee.evaluation_group_id}]`;
  const rawGroup =
    sourceRow?.raw_data?.evaluation_group ??
    sourceRow?.evaluation_group;
  if (rawGroup !== undefined && rawGroup !== null && String(rawGroup).trim()) {
    return String(rawGroup).trim();
  }
  if (employee.available_roles?.includes('evaluatee')) return '[]';
  return '';
};

const getGrowthLevelCell = (employee: Employee) =>
  employee.growth_level == null ? '' : `Lv.${employee.growth_level}`;

const getRoleCells = (
  employee: Employee,
  sourceRow?: EmployeeProfileImportStoredRow | null,
) => {
  const roles = employee.available_roles ?? sourceRow?.available_roles ?? [];
  return [
    roles.includes('evaluatee') ? '피평가자' : '',
    roles.includes('evaluator') ? '평가자' : '',
    roles.includes('hr') ? 'HR' : '',
  ];
};

const fitColumns = (rows: unknown[][]) =>
  rows[0]?.map((_, colIndex) => {
    const maxLength = rows.reduce((max, row) => {
      const value = row[colIndex] == null ? '' : String(row[colIndex]);
      return Math.max(max, value.length);
    }, 0);
    return { wch: Math.min(Math.max(maxLength + 2, 10), 48) };
  }) ?? [];

const appendAoaSheet = (wb: XLSX.WorkBook, sheetName: string, rows: unknown[][]) => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = fitColumns(rows);
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
};

const appendObjectSheet = (
  wb: XLSX.WorkBook,
  sheetName: string,
  headers: string[],
  rows: Array<Record<string, unknown>>,
) => {
  const aoaRows = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))];
  appendAoaSheet(wb, sheetName, aoaRows);
};

const writeWorkbook = (wb: XLSX.WorkBook, fileName: string) => {
  XLSX.writeFile(wb, fileName);
  return fileName;
};

const safeAssignmentHistory = async (employeeId: string) => {
  try {
    return await employeeService.getEvaluatorAssignmentHistory(employeeId);
  } catch {
    return [];
  }
};

const getSortedAssignmentHistory = (history: EvaluatorAssignmentHistory[]) =>
  [...history]
    .filter((item) => item.change_type === 'change')
    .sort((a, b) => {
      const at = a.changed_at ? new Date(a.changed_at).getTime() : 0;
      const bt = b.changed_at ? new Date(b.changed_at).getTime() : 0;
      if (at !== bt) return at - bt;
      return a.id.localeCompare(b.id);
    });

const isSummaryProfileImportRow = (row: EmployeeProfileImportStoredRow) =>
  Boolean(
    row.raw_data &&
      (Object.prototype.hasOwnProperty.call(row.raw_data, 'available_roles') ||
        Object.prototype.hasOwnProperty.call(row.raw_data, 'availableRoles') ||
        Object.prototype.hasOwnProperty.call(row.raw_data, 'job_role') ||
        Object.prototype.hasOwnProperty.call(row.raw_data, 'jobRole')),
  );

const orderProfileEmployees = (
  employees: Employee[],
  sourceRows: EmployeeProfileImportStoredRow[],
  appendMissing = true,
) => {
  const employeeMap = getEmployeeMap(employees);
  const seen = new Set<string>();
  const ordered: Employee[] = [];

  sourceRows.forEach((row) => {
    const employee = row.employee_id ? employeeMap.get(row.employee_id) : null;
    if (!employee || seen.has(employee.employee_id)) return;
    ordered.push(employee);
    seen.add(employee.employee_id);
  });

  if (appendMissing) {
    employees
      .filter((employee) => !seen.has(employee.employee_id))
      .sort(
        (a, b) =>
          (a.department ?? '').localeCompare(b.department ?? '') ||
          (a.name ?? '').localeCompare(b.name ?? '') ||
          a.employee_id.localeCompare(b.employee_id),
      )
      .forEach((employee) => ordered.push(employee));
  }

  return ordered;
};

const buildProfileSummaryRows = (
  targets: Employee[],
  sourceRowsByEmployee = new Map<string, EmployeeProfileImportStoredRow>(),
) => [
  PROFILE_SUMMARY_HEADERS,
  ...targets.map((employee) => {
    const sourceRow = sourceRowsByEmployee.get(employee.employee_id);
    const roles = getRoleCells(employee, sourceRow);
    return [
      getEvaluationGroupCell(employee, sourceRow),
      employee.employee_id,
      employee.name,
      getGrowthLevelCell(employee),
      employee.department ?? '',
      employee.position ?? '',
      roles[0] ?? '',
      roles[1] ?? '',
      roles[2] ?? '',
      employee.job_role ?? '',
    ];
  }),
];

export const createEmployeeProfileUploadWorkbook = async (
  options: { periodId?: string | null } = {},
) => {
  const periodId = options.periodId ?? null;
  const [employees, latestImportRows] = await Promise.all([
    employeeService.getAllEmployees(),
    employeeService.getLatestEmployeeProfileImportRows(periodId).catch(() => []),
  ]);
  const profileEmployees = getProfileEmployees(employees);
  const summaryImportRows = latestImportRows.filter(isSummaryProfileImportRow);
  const sourceRowsByEmployee = new Map(
    summaryImportRows
      .filter((row) => row.employee_id)
      .map((row) => [row.employee_id, row]),
  );

  // 평가기간이 지정되었는데 그 기간에 대상자 업로드 기록이 없으면 빈 양식만 반환.
  // (다른 평가기간의 직원 명단이 섞여 내려가지 않도록.)
  const hasPeriodFilter = Boolean(periodId);
  const targets =
    summaryImportRows.length > 0
      ? orderProfileEmployees(profileEmployees, summaryImportRows, false)
      : hasPeriodFilter
        ? []
        : profileEmployees.sort(
            (a, b) =>
              (a.department ?? '').localeCompare(b.department ?? '') ||
              (a.name ?? '').localeCompare(b.name ?? '') ||
              a.employee_id.localeCompare(b.employee_id),
          );
  const wb = XLSX.utils.book_new();

  appendAoaSheet(wb, 'Sheet1', buildProfileSummaryRows(targets, sourceRowsByEmployee));

  return { wb, targetCount: targets.length };
};

export const downloadEmployeeProfileUploadWorkbook = async (
  options: { periodId?: string | null } = {},
): Promise<ExportResult> => {
  const { wb, targetCount } = await createEmployeeProfileUploadWorkbook(options);
  const fileName = writeWorkbook(wb, `평가대상자_업로드양식_${todayText()}.xlsx`);
  return { fileName, targetCount, rowCount: targetCount };
};

const resolveEvaluatorName = (
  evaluatorId: string | null | undefined,
  explicitName: string | null | undefined,
  employeeMap: Map<string, Employee>,
) => {
  if (explicitName) return explicitName;
  if (!evaluatorId) return '';
  return employeeMap.get(evaluatorId)?.name ?? evaluatorId;
};

const buildMatchingCurrentRow = (
  employee: Employee,
  employeeMap: Map<string, Employee>,
  sequence?: string,
) => {
  const evaluator = employee.evaluator_id ? employeeMap.get(employee.evaluator_id) : null;
  return [
    employee.employee_id,
    employee.name,
    sequence ?? employee.org_sequence ?? '',
    employee.department_id ?? '',
    employee.department ?? '',
    dateText(employee.work_start_date),
    dateText(employee.work_end_date),
    employee.evaluator_id ?? '',
    evaluator?.name ?? '',
    employee.confirmer_id ?? '',
    employee.confirmer_name ?? '',
    employee.evaluation_type ?? '',
    employee.matching_result ?? '',
  ];
};

const buildMatchingHistoryRow = (
  employee: Employee,
  history: EvaluatorAssignmentHistory,
  nextHistory: EvaluatorAssignmentHistory | undefined,
  index: number,
  employeeMap: Map<string, Employee>,
) => [
  employee.employee_id,
  employee.name,
  String(index + 1),
  employee.department_id ?? '',
  employee.department ?? '',
  dateText(history.changed_at),
  nextHistory ? dateText(nextHistory.changed_at) : '',
  history.new_evaluator_id ?? '',
  resolveEvaluatorName(history.new_evaluator_id, history.new_evaluator_name, employeeMap),
  employee.confirmer_id ?? '',
  employee.confirmer_name ?? '',
  employee.evaluation_type ?? '',
  history.status === 'cancelled' ? '취소' : employee.matching_result ?? '',
];

// 매칭 업로드 출처 이력(예전 'Matching import:' 변형 + 신 'Matching reconcile:').
// 매칭 source 행과 짝지을 때, 그리고 수동 추가 이력과 구분할 때 쓴다.
const isBulkMatchingHistory = (history: EvaluatorAssignmentHistory) =>
  /^Matching (import|past tour|baseline import|reconcile):/i.test((history.reason ?? '').trim());

const previousDateText = (value?: string | null) => {
  const text = dateText(value);
  if (!text) return '';
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const getNextSequence = (sourceRows: MatchingImportStoredRow[], offset: number) => {
  const maxSequence = sourceRows.reduce((max, row) => {
    const value = Number(row.org_sequence);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return String(maxSequence + offset);
};

const findSourceHistory = (
  row: MatchingImportStoredRow,
  histories: EvaluatorAssignmentHistory[],
  usedHistoryIds: Set<string>,
) => {
  const rowStart = dateText(row.work_start_date);
  const evaluatorId = row.evaluator_id ?? null;
  const matches = histories.filter(
    (history) =>
      !usedHistoryIds.has(history.id) &&
      isBulkMatchingHistory(history) &&
      (history.new_evaluator_id ?? null) === evaluatorId &&
      (!rowStart || dateText(history.changed_at) === rowStart),
  );
  const exact = matches.find((history) => dateText(history.changed_at) === rowStart);
  const match = exact ?? matches[0] ?? null;
  if (match) usedHistoryIds.add(match.id);
  return match;
};

const buildMatchingSourceRow = ({
  sourceRow,
  employee,
  employeeMap,
  history,
  correction,
  hasManualRows,
}: {
  sourceRow: MatchingImportStoredRow;
  employee?: Employee;
  employeeMap: Map<string, Employee>;
  history?: EvaluatorAssignmentHistory | null;
  correction?: EvaluatorAssignmentHistory | null;
  hasManualRows: boolean;
}) => {
  const effectiveEvaluatorId =
    correction?.new_evaluator_id ??
    (sourceRow.is_primary && !hasManualRows
      ? employee?.evaluator_id ?? sourceRow.evaluator_id
      : sourceRow.evaluator_id) ??
    '';
  const effectiveEvaluatorName = resolveEvaluatorName(
    effectiveEvaluatorId,
    correction?.new_evaluator_name ??
      (effectiveEvaluatorId === sourceRow.evaluator_id ? sourceRow.evaluator_name : null),
    employeeMap,
  );
  const isCancelledWithoutCorrection = history?.status === 'cancelled' && !correction;

  return [
    sourceRow.employee_id ?? '',
    employee?.name ?? sourceRow.employee_name ?? '',
    sourceRow.org_sequence ?? '',
    sourceRow.department_id ?? '',
    sourceRow.department_name ?? '',
    dateText(sourceRow.work_start_date),
    dateText(sourceRow.work_end_date),
    effectiveEvaluatorId,
    effectiveEvaluatorName,
    sourceRow.confirmer_id ?? '',
    sourceRow.confirmer_name ?? '',
    sourceRow.evaluation_type ?? '',
    isCancelledWithoutCorrection
      ? '취소'
      : sourceRow.matching_result ?? '',
  ];
};

const buildMatchingManualHistoryRow = ({
  employee,
  templateRow,
  sourceRows,
  history,
  nextHistory,
  sequenceOffset,
  employeeMap,
}: {
  employee: Employee;
  templateRow?: MatchingImportStoredRow;
  sourceRows: MatchingImportStoredRow[];
  history: EvaluatorAssignmentHistory;
  nextHistory?: EvaluatorAssignmentHistory;
  sequenceOffset: number;
  employeeMap: Map<string, Employee>;
}) => [
  employee.employee_id,
  employee.name,
  getNextSequence(sourceRows, sequenceOffset),
  templateRow?.department_id ?? employee.department_id ?? '',
  templateRow?.department_name ?? employee.department ?? '',
  dateText(history.changed_at),
  nextHistory ? previousDateText(nextHistory.changed_at) : '',
  history.new_evaluator_id ?? '',
  resolveEvaluatorName(history.new_evaluator_id, history.new_evaluator_name, employeeMap),
  templateRow?.confirmer_id ?? employee.confirmer_id ?? '',
  templateRow?.confirmer_name ?? employee.confirmer_name ?? '',
  templateRow?.evaluation_type ?? employee.evaluation_type ?? '',
  templateRow?.matching_result ?? employee.matching_result ?? '',
];

const buildMatchingRowsFromImportRows = (
  sourceRows: MatchingImportStoredRow[],
  employeeMap: Map<string, Employee>,
  historiesByEmployee: Map<string, EvaluatorAssignmentHistory[]>,
) => {
  const rows: unknown[][] = [MATCHING_IMPORT_HEADERS];
  const sourceRowsByEmployee = new Map<string, MatchingImportStoredRow[]>();
  sourceRows.forEach((row) => {
    if (!row.employee_id) return;
    const employeeRows = sourceRowsByEmployee.get(row.employee_id) ?? [];
    employeeRows.push(row);
    sourceRowsByEmployee.set(row.employee_id, employeeRows);
  });

  const historyContextByEmployee = new Map<
    string,
    {
      sourceHistoryByRowNumber: Map<number, EvaluatorAssignmentHistory>;
      correctionBySourceHistoryId: Map<string, EvaluatorAssignmentHistory>;
      manualRows: EvaluatorAssignmentHistory[];
    }
  >();

  sourceRowsByEmployee.forEach((employeeSourceRows, employeeId) => {
    const histories = getSortedAssignmentHistory(historiesByEmployee.get(employeeId) ?? []);
    const usedHistoryIds = new Set<string>();
    const sourceHistoryByRowNumber = new Map<number, EvaluatorAssignmentHistory>();
    const correctionBySupersededId = new Map<string, EvaluatorAssignmentHistory>();
    histories
      .filter((history) => history.status === 'applied' && history.supersedes_history_id)
      .forEach((history) => {
        if (history.supersedes_history_id) {
          correctionBySupersededId.set(history.supersedes_history_id, history);
        }
      });

    employeeSourceRows.forEach((sourceRow) => {
      const history = findSourceHistory(sourceRow, histories, usedHistoryIds);
      if (!history) return;
      sourceHistoryByRowNumber.set(sourceRow.row_number, history);
      const correction = correctionBySupersededId.get(history.id);
      if (correction) usedHistoryIds.add(correction.id);
    });

    const manualRows = histories.filter(
      (history) =>
        history.status === 'applied' &&
        history.change_type === 'change' &&
        !isBulkMatchingHistory(history) &&
        !usedHistoryIds.has(history.id),
    );

    historyContextByEmployee.set(employeeId, {
      sourceHistoryByRowNumber,
      correctionBySourceHistoryId: correctionBySupersededId,
      manualRows,
    });
  });

  const emittedSourceRowsByEmployee = new Map<string, unknown[][]>();

  sourceRows.forEach((sourceRow, index) => {
    const employeeId = sourceRow.employee_id ?? '';
    const employee = employeeMap.get(employeeId);
    const employeeSourceRows = sourceRowsByEmployee.get(employeeId) ?? [];
    const context = historyContextByEmployee.get(employeeId);
    const history = context?.sourceHistoryByRowNumber.get(sourceRow.row_number) ?? null;
    const correction = history ? context?.correctionBySourceHistoryId.get(history.id) ?? null : null;
    const manualRows = context?.manualRows ?? [];
    const row = buildMatchingSourceRow({
      sourceRow,
      employee,
      employeeMap,
      history,
      correction,
      hasManualRows: manualRows.length > 0,
    });
    rows.push(row);

    if (employeeId) {
      const emitted = emittedSourceRowsByEmployee.get(employeeId) ?? [];
      emitted.push(row);
      emittedSourceRowsByEmployee.set(employeeId, emitted);
    }

    const nextSourceRow = sourceRows[index + 1];
    if (!employee || nextSourceRow?.employee_id === employeeId || manualRows.length === 0) return;

    const emitted = emittedSourceRowsByEmployee.get(employeeId) ?? [];
    const rowBeforeManual = [...emitted].reverse().find((item) => item[7]) ?? emitted[emitted.length - 1];
    if (rowBeforeManual && manualRows[0]?.changed_at) {
      rowBeforeManual[6] = previousDateText(manualRows[0].changed_at);
    }

    const templateRow =
      employeeSourceRows.find((item) => item.is_primary) ??
      employeeSourceRows[employeeSourceRows.length - 1];
    manualRows.forEach((historyItem, manualIndex) => {
      rows.push(
        buildMatchingManualHistoryRow({
          employee,
          templateRow,
          sourceRows: employeeSourceRows,
          history: historyItem,
          nextHistory: manualRows[manualIndex + 1],
          sequenceOffset: manualIndex + 1,
          employeeMap,
        }),
      );
    });
  });

  return rows;
};

export const createMatchingUploadWorkbook = async (
  options: { periodId?: string | null } = {},
) => {
  const periodId = options.periodId ?? null;
  const [employees, latestImportRows] = await Promise.all([
    employeeService.getAllEmployees(),
    employeeService.getLatestMatchingImportRows(periodId).catch(() => []),
  ]);
  const employeeMap = getEmployeeMap(employees);

  // 평가기간이 지정되었는데 그 기간에 매칭 업로드 기록이 없으면 빈 양식(헤더만)을 반환.
  if (!latestImportRows.length && periodId) {
    const wb = XLSX.utils.book_new();
    appendAoaSheet(wb, MATCHING_IMPORT_SHEET_NAME, [MATCHING_IMPORT_HEADERS]);
    return { wb, targetCount: 0, rowCount: 0 };
  }

  if (latestImportRows.length > 0) {
    const sourceEmployeeIds = [
      ...new Set(latestImportRows.map((row) => row.employee_id).filter(Boolean)),
    ];
    const historyPairs = await Promise.all(
      sourceEmployeeIds.map(async (employeeId) => [
        employeeId,
        getSortedAssignmentHistory(await safeAssignmentHistory(employeeId)),
      ] as const),
    );
    const rows = buildMatchingRowsFromImportRows(
      latestImportRows,
      employeeMap,
      new Map(historyPairs),
    );
    const wb = XLSX.utils.book_new();
    appendAoaSheet(wb, MATCHING_IMPORT_SHEET_NAME, rows);

    return {
      wb,
      targetCount: new Set(latestImportRows.map((row) => row.employee_id).filter(Boolean)).size,
      rowCount: Math.max(0, rows.length - 1),
    };
  }

  const targets = getTargets(employees);
  const historyPairs = await Promise.all(
    targets.map(async (employee) => [
      employee.employee_id,
      getSortedAssignmentHistory(await safeAssignmentHistory(employee.employee_id)),
    ] as const),
  );
  const historiesByEmployee = new Map(historyPairs);
  const rows: unknown[][] = [MATCHING_IMPORT_HEADERS];

  targets.forEach((employee) => {
    const history = historiesByEmployee.get(employee.employee_id) ?? [];

    history.forEach((item, index) => {
      rows.push(buildMatchingHistoryRow(employee, item, history[index + 1], index, employeeMap));
    });

    const latestHistory = history[history.length - 1];
    const currentEvaluatorId = employee.evaluator_id ?? null;
    const latestEvaluatorId = latestHistory?.new_evaluator_id ?? null;
    const needsCurrentRow =
      history.length === 0 ||
      latestHistory?.status === 'cancelled' ||
      latestEvaluatorId !== currentEvaluatorId;

    if (needsCurrentRow) {
      rows.push(buildMatchingCurrentRow(employee, employeeMap, history.length > 0 ? String(history.length + 1) : undefined));
    }
  });

  const wb = XLSX.utils.book_new();
  appendAoaSheet(wb, MATCHING_IMPORT_SHEET_NAME, rows);

  return { wb, targetCount: targets.length, rowCount: Math.max(0, rows.length - 1) };
};

export const downloadMatchingUploadWorkbook = async (
  options: { periodId?: string | null } = {},
): Promise<ExportResult> => {
  const { wb, targetCount, rowCount } = await createMatchingUploadWorkbook(options);
  const fileName = writeWorkbook(wb, `개인별매칭결과_업로드양식_${todayText()}_이력포함.xlsx`);
  return { fileName, targetCount, rowCount };
};

const getEntryTime = (entry: TaskEvaluationEntry) => {
  const value = entry.updated_at ?? entry.feedback_date ?? entry.created_at;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

const getEntriesForTask = (entries: TaskEvaluationEntry[], task: Task) =>
  entries
    .filter((entry) => entry.task_uuid === task.id || entry.task_id === task.task_id)
    .sort((a, b) => getEntryTime(b) - getEntryTime(a));

const getRepresentativeEntry = (bundle: LoadedEvaluationBundle, task: Task) =>
  getEntriesForTask(bundle.entries, task)[0] ?? null;

const calcWeightedScore = (bundle: LoadedEvaluationBundle) =>
  bundle.tasks.reduce((sum, task) => {
    const entry = getRepresentativeEntry(bundle, task);
    const score = Number(entry?.score ?? task.score);
    const weight = Number(task.weight ?? 0);
    if (!Number.isFinite(score) || !Number.isFinite(weight)) return sum;
    return sum + (score * weight) / 100;
  }, 0);

const getCurrentEvaluationId = (employee: Employee, evaluations: Evaluation[]) => {
  const byCurrentEvaluator = evaluations.find(
    (evaluation) => (evaluation.evaluator_id ?? null) === (employee.evaluator_id ?? null),
  );
  return byCurrentEvaluator?.id ?? evaluations[0]?.id ?? null;
};

const getFeedbacksForEvaluation = async (evaluation: Evaluation, tasks: Task[]) => {
  const feedbackMap = new Map<string, FeedbackHistory>();
  await Promise.all(
    tasks.map(async (task) => {
      try {
        const feedbacks = await feedbackService.getFeedbackHistoryByTaskId(task.task_id);
        feedbacks
          .filter((feedback) => {
            const matchesEvaluation =
              !feedback.evaluation_id || feedback.evaluation_id === evaluation.id;
            const matchesTask =
              !feedback.task_uuid ||
              feedback.task_uuid === task.id ||
              feedback.task_id === task.task_id;
            return matchesEvaluation && matchesTask;
          })
          .forEach((feedback) => feedbackMap.set(feedback.id, feedback));
      } catch {
        // Keep export resilient: one task's feedback failure should not stop the workbook.
      }
    }),
  );
  return [...feedbackMap.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
};

const getVisibleTasks = (tasks: Task[]) => tasks.filter((task) => !task.deleted_at);

const loadEvaluationBundles = async (includePastEvaluations: boolean) => {
  const employees = await employeeService.getAllEmployees();
  const targets = getTargets(employees);
  const bundles: LoadedEvaluationBundle[] = [];

  for (const employee of targets) {
    const evaluations = await evaluationService.getEvaluationsByEmployeeId(employee.employee_id);
    const currentEvaluationId = getCurrentEvaluationId(employee, evaluations);
    const selectedEvaluations = includePastEvaluations
      ? evaluations
      : evaluations.filter((evaluation) => evaluation.id === currentEvaluationId);

    for (const evaluation of selectedEvaluations) {
      const [tasks, entries] = await Promise.all([
        taskService.getTasksByEvaluationId(evaluation.id),
        taskEvaluationEntryService.getEntriesByEvaluationId(evaluation.id),
      ]);
      const visibleTasks = getVisibleTasks(tasks);
      const feedbacks = await getFeedbacksForEvaluation(evaluation, visibleTasks);
      bundles.push({
        employee,
        evaluation,
        kind: evaluation.id === currentEvaluationId ? '현재' : '이전',
        tasks: visibleTasks,
        entries,
        feedbacks,
      });
    }
  }

  return { employees, targets, bundles };
};

const buildEvaluationSummaryRows = (bundles: LoadedEvaluationBundle[]) =>
  bundles.map((bundle) => {
    const totalScore = calcWeightedScore(bundle);
    const totalWeight = bundle.tasks.reduce((sum, task) => sum + Number(task.weight ?? 0), 0);
    return {
      구분: bundle.kind,
      평가ID: bundle.evaluation.id,
      평가기간ID: bundle.evaluation.evaluation_period_id ?? '',
      평가연도: bundle.evaluation.evaluation_year ?? '',
      피평가자사번: bundle.employee.employee_id,
      피평가자명: bundle.employee.name,
      직급: bundle.employee.position ?? bundle.evaluation.evaluatee_position ?? '',
      부서: bundle.employee.department ?? bundle.evaluation.evaluatee_department ?? '',
      성장레벨: bundle.evaluation.growth_level ?? bundle.employee.growth_level ?? '',
      평가자사번: bundle.evaluation.evaluator_id ?? '',
      평가자명: bundle.evaluation.evaluator_name ?? '',
      평가자직급: bundle.evaluation.evaluator_position ?? '',
      평가자부서: bundle.evaluation.evaluator_department ?? '',
      평가상태: evaluationStatusLabel(bundle.evaluation.evaluation_status),
      과업수: bundle.tasks.length,
      평가입력건수: bundle.entries.length,
      피드백이력건수: bundle.feedbacks.length,
      총가중치: totalWeight,
      가중점수: Math.round(totalScore * 10) / 10,
      달성여부:
        Math.floor(totalScore) >= Number(bundle.evaluation.growth_level ?? bundle.employee.growth_level ?? 0)
          ? '달성'
          : '미달성',
      평가시작일: dateText(bundle.evaluation.evaluator_assigned_at),
      최종수정일: dateTimeText(bundle.evaluation.last_modified),
      생성일: dateTimeText(bundle.evaluation.created_at),
    };
  });

const buildTaskRows = (bundles: LoadedEvaluationBundle[]) =>
  bundles.flatMap((bundle) =>
    bundle.tasks.map((task) => {
      const entry = getRepresentativeEntry(bundle, task);
      return {
        구분: bundle.kind,
        평가ID: bundle.evaluation.id,
        피평가자사번: bundle.employee.employee_id,
        피평가자명: bundle.employee.name,
        과업UUID: task.id,
        과업ID: task.task_id,
        과업명: task.title,
        성과보고내용: task.description ?? '',
        가중치: task.weight ?? '',
        시작일: dateText(task.start_date),
        종료일: dateText(task.end_date),
        삭제일: dateTimeText(task.deleted_at),
        대표평가자: entry?.evaluator_name ?? task.evaluator_name ?? bundle.evaluation.evaluator_name ?? '',
        기여방식: entry?.contribution_method ?? task.contribution_method ?? '',
        기여범위: entry?.contribution_scope ?? task.contribution_scope ?? '',
        대표점수: entry?.score ?? task.score ?? '',
        대표평가내용: entry?.feedback ?? task.feedback ?? '',
        피드백일시: dateTimeText(entry?.feedback_date ?? task.feedback_date),
      };
    }),
  );

const buildEntryRows = (bundles: LoadedEvaluationBundle[]) =>
  bundles.flatMap((bundle) =>
    bundle.tasks.flatMap((task) => {
      const entries = getEntriesForTask(bundle.entries, task);
      if (entries.length > 0) {
        return entries.map((entry) => ({
          구분: bundle.kind,
          평가ID: bundle.evaluation.id,
          피평가자사번: bundle.employee.employee_id,
          피평가자명: bundle.employee.name,
          과업UUID: task.id,
          과업ID: task.task_id,
          과업명: task.title,
          평가자사번: entry.evaluator_id ?? '',
          평가자명: entry.evaluator_name ?? '',
          기여방식: entry.contribution_method ?? '',
          기여범위: entry.contribution_scope ?? '',
          점수: entry.score ?? '',
          평가내용: entry.feedback ?? '',
          피드백일시: dateTimeText(entry.feedback_date),
          평가입력ID: entry.id,
          평가자배정이력ID: entry.assignment_history_id ?? '',
          상태: entry.status ?? 'active',
          생성일: dateTimeText(entry.created_at),
          수정일: dateTimeText(entry.updated_at),
        }));
      }

      if (
        task.score == null &&
        !task.contribution_method &&
        !task.contribution_scope &&
        !task.feedback
      ) {
        return [];
      }

      return [
        {
          구분: bundle.kind,
          평가ID: bundle.evaluation.id,
          피평가자사번: bundle.employee.employee_id,
          피평가자명: bundle.employee.name,
          과업UUID: task.id,
          과업ID: task.task_id,
          과업명: task.title,
          평가자사번: bundle.evaluation.evaluator_id ?? '',
          평가자명: task.evaluator_name ?? bundle.evaluation.evaluator_name ?? '',
          기여방식: task.contribution_method ?? '',
          기여범위: task.contribution_scope ?? '',
          점수: task.score ?? '',
          평가내용: task.feedback ?? '',
          피드백일시: dateTimeText(task.feedback_date),
          평가입력ID: '',
          평가자배정이력ID: bundle.evaluation.assignment_history_id ?? '',
          상태: 'legacy',
          생성일: '',
          수정일: '',
        },
      ];
    }),
  );

const buildFeedbackRows = (bundles: LoadedEvaluationBundle[]) =>
  bundles.flatMap((bundle) =>
    bundle.feedbacks.map((feedback) => {
      const task = bundle.tasks.find(
        (item) =>
          item.id === feedback.task_uuid ||
          item.task_id === feedback.task_id,
      );
      return {
        피드백ID: feedback.id,
        평가ID: feedback.evaluation_id ?? bundle.evaluation.id,
        피평가자사번: bundle.employee.employee_id,
        피평가자명: bundle.employee.name,
        과업UUID: feedback.task_uuid ?? task?.id ?? '',
        과업ID: feedback.task_id ?? task?.task_id ?? '',
        과업명: task?.title ?? '',
        평가자사번: feedback.evaluator_id ?? '',
        평가자명: feedback.evaluator_name ?? '',
        평가내용: feedback.content ?? '',
        평가입력ID: feedback.task_evaluation_entry_id ?? '',
        상태: feedback.status ?? 'active',
        생성일: dateTimeText(feedback.created_at),
      };
    }),
  );

const buildAssignmentHistoryRows = (
  targets: Employee[],
  historiesByEmployee: Map<string, EvaluatorAssignmentHistory[]>,
) =>
  targets.flatMap((employee) =>
    (historiesByEmployee.get(employee.employee_id) ?? []).map((history) => ({
      피평가자사번: employee.employee_id,
      피평가자명: employee.name,
      변경일: dateTimeText(history.changed_at),
      이전평가자사번: history.previous_evaluator_id ?? '',
      이전평가자명: history.previous_evaluator_name ?? '',
      신규평가자사번: history.new_evaluator_id ?? '',
      신규평가자명: history.new_evaluator_name ?? '',
      평가ID: history.evaluation_id ?? '',
      평가기간ID: history.evaluation_period_id ?? '',
      평가기간명: history.evaluation_period_name ?? '',
      평가연도: history.evaluation_year ?? '',
      변경유형: history.change_type,
      상태: history.status,
      사유: history.reason ?? '',
      변경자사번: history.changed_by ?? '',
      변경자명: history.changed_by_name ?? '',
      취소일: dateTimeText(history.cancelled_at),
      취소자사번: history.cancelled_by ?? '',
      취소자명: history.cancelled_by_name ?? '',
      취소사유: history.cancel_reason ?? '',
      대체이력ID: history.supersedes_history_id ?? '',
    })),
  );

const buildDepartmentStatsRows = (targets: Employee[], bundles: LoadedEvaluationBundle[]) => {
  const stats = new Map<
    string,
    { targetCount: number; completedCount: number; achievedCount: number; totalScore: number; scoreCount: number }
  >();

  targets.forEach((employee) => {
    const dept = employee.department || '미지정';
    const current = stats.get(dept) ?? {
      targetCount: 0,
      completedCount: 0,
      achievedCount: 0,
      totalScore: 0,
      scoreCount: 0,
    };
    current.targetCount += 1;
    stats.set(dept, current);
  });

  bundles
    .filter((bundle) => bundle.kind === '현재')
    .forEach((bundle) => {
      const dept = bundle.employee.department || '미지정';
      const current = stats.get(dept) ?? {
        targetCount: 0,
        completedCount: 0,
        achievedCount: 0,
        totalScore: 0,
        scoreCount: 0,
      };
      const score = calcWeightedScore(bundle);
      if (bundle.evaluation.evaluation_status === 'completed') current.completedCount += 1;
      if (Math.floor(score) >= Number(bundle.evaluation.growth_level ?? bundle.employee.growth_level ?? 0)) {
        current.achievedCount += 1;
      }
      current.totalScore += score;
      current.scoreCount += 1;
      stats.set(dept, current);
    });

  return [...stats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, item]) => ({
      부서: department,
      대상자수: item.targetCount,
      평가완료수: item.completedCount,
      완료율: item.targetCount > 0 ? `${Math.round((item.completedCount / item.targetCount) * 100)}%` : '0%',
      평균가중점수:
        item.scoreCount > 0 ? Math.round((item.totalScore / item.scoreCount) * 10) / 10 : 0,
      달성자수: item.achievedCount,
      달성율: item.targetCount > 0 ? `${Math.round((item.achievedCount / item.targetCount) * 100)}%` : '0%',
    }));
};

export const createFullEvaluationDataWorkbook = async (
  options: { includePastEvaluations?: boolean } = {},
) => {
  const includePastEvaluations = options.includePastEvaluations ?? true;
  const { targets, bundles } = await loadEvaluationBundles(includePastEvaluations);
  const historyPairs = await Promise.all(
    targets.map(async (employee) => [
      employee.employee_id,
      await safeAssignmentHistory(employee.employee_id),
    ] as const),
  );
  const historiesByEmployee = new Map(historyPairs);

  const evaluationRows = buildEvaluationSummaryRows(bundles);
  const taskRows = buildTaskRows(bundles);
  const entryRows = buildEntryRows(bundles);
  const feedbackRows = buildFeedbackRows(bundles);
  const historyRows = buildAssignmentHistoryRows(targets, historiesByEmployee);
  const departmentRows = buildDepartmentStatsRows(targets, bundles);

  const wb = XLSX.utils.book_new();
  appendObjectSheet(wb, '평가요약', EVALUATION_SUMMARY_HEADERS, evaluationRows);
  appendObjectSheet(wb, '성과보고내용', TASK_REPORT_HEADERS, taskRows);
  appendObjectSheet(wb, '평가자별평가', ENTRY_DETAIL_HEADERS, entryRows);
  appendObjectSheet(wb, '피드백이력', FEEDBACK_HISTORY_HEADERS, feedbackRows);
  appendObjectSheet(wb, '평가자이력', ASSIGNMENT_HISTORY_HEADERS, historyRows);
  appendObjectSheet(wb, '부서별통계', DEPARTMENT_STATS_HEADERS, departmentRows);

  return {
    wb,
    targetCount: targets.length,
    evaluationCount: bundles.length,
    taskCount: taskRows.length,
    entryCount: entryRows.length,
    feedbackCount: feedbackRows.length,
  };
};

export const downloadFullEvaluationDataWorkbook = async (
  options: { includePastEvaluations?: boolean } = {},
): Promise<ExportResult> => {
  const result = await createFullEvaluationDataWorkbook(options);
  const suffix = options.includePastEvaluations === false ? '' : '_이전평가포함';
  const fileName = writeWorkbook(result.wb, `평가데이터_전체_${todayText()}${suffix}.xlsx`);
  return { fileName, ...result };
};

export const createHrBackupWorkbook = async (
  options: { includePastEvaluations?: boolean } = {},
) => {
  const [
    profile,
    matching,
    evaluation,
  ] = await Promise.all([
    createEmployeeProfileUploadWorkbook(),
    createMatchingUploadWorkbook(),
    createFullEvaluationDataWorkbook(options),
  ]);

  const wb = XLSX.utils.book_new();
  profile.wb.SheetNames.forEach((sheetName) => {
    XLSX.utils.book_append_sheet(wb, profile.wb.Sheets[sheetName], sheetName);
  });
  matching.wb.SheetNames.forEach((sheetName) => {
    XLSX.utils.book_append_sheet(wb, matching.wb.Sheets[sheetName], sheetName);
  });
  evaluation.wb.SheetNames.forEach((sheetName) => {
    XLSX.utils.book_append_sheet(wb, evaluation.wb.Sheets[sheetName], sheetName);
  });

  return {
    wb,
    targetCount: profile.targetCount,
    matchingRowCount: matching.rowCount,
    evaluationCount: evaluation.evaluationCount,
    taskCount: evaluation.taskCount,
    entryCount: evaluation.entryCount,
    feedbackCount: evaluation.feedbackCount,
  };
};

export const downloadHrBackupWorkbook = async (
  options: { includePastEvaluations?: boolean } = {},
): Promise<ExportResult & { matchingRowCount?: number }> => {
  const result = await createHrBackupWorkbook(options);
  const suffix = options.includePastEvaluations === false ? '' : '_이전평가포함';
  const fileName = writeWorkbook(result.wb, `HR_전체데이터_${todayText()}${suffix}.xlsx`);
  return { fileName, rowCount: result.matchingRowCount, ...result };
};

const DEPARTMENT_MEMBER_HEADERS = [
  '사번',
  '이름',
  '직급',
  '부서',
  '직무',
  '성장레벨',
  '평가자',
  '평가 상태',
  '점수',
  '달성',
  '진행률(%)',
];

export type DepartmentExportMember = {
  employeeId: string;
  name: string;
  position: string;
  department: string;
  jobRole: string | null;
  growthLevel: number | null;
  evaluatorName: string | null;
  reviewStatusLabel: string;
  weightedScore: number;
  isFinalized: boolean;
  achieved: boolean;
  progress: number;
};

export const downloadDepartmentMembersWorkbook = (
  departmentName: string,
  members: DepartmentExportMember[],
): { fileName: string; memberCount: number } => {
  const rows = members.map((m) => ({
    사번: m.employeeId,
    이름: m.name,
    직급: m.position,
    부서: m.department,
    직무: m.jobRole ?? '',
    성장레벨: m.growthLevel ?? '',
    평가자: m.evaluatorName ?? '',
    '평가 상태': m.reviewStatusLabel,
    점수: m.isFinalized ? Number(m.weightedScore.toFixed(1)) : '',
    달성: m.isFinalized ? (m.achieved ? '달성' : '미달성') : '',
    '진행률(%)': m.progress,
  }));

  const wb = XLSX.utils.book_new();
  appendObjectSheet(wb, '부서명단', DEPARTMENT_MEMBER_HEADERS, rows);

  const safeName = departmentName.replace(/[\\/:*?"<>|]/g, '_');
  const fileName = writeWorkbook(wb, `부서명단_${safeName}_${todayText()}.xlsx`);
  return { fileName, memberCount: members.length };
};

// ── 부서·본부 결과 리포트 (F-D2) ─────────────────────────────────────────────
// 조직 계층(법인-본부-부-팀) 단위 결과 요약을 엑셀로 내려받는다. 화면(HrDepartmentResultsPage)이
// 이미 메모리에서 집계한 행을 그대로 직렬화한다 — 다운로드 시 추가 DB 조회 0건(커밋 8fc884c 준수).
// PDF 의존성·생성 없음(D-3). 달성률 분자는 '완료·유효 표본 중 갭>=0' 재계산 값(record.achieved 미사용).
// 갭은 정수 내림 점수(flooredScore) 기준 절대평가다.
const MIN_ORG_SAMPLE = 5; // 소표본 임계값(HrDepartmentResultsPage 와 동일).

const ORG_RESULT_HEADERS = [
  '집계레벨',
  '조직',
  '상위경로',
  '배정인원',
  '완료인원',
  '완료율',
  '평균점수',
  '평균갭',
  '표준편차',
  '달성인원',
  '달성률',
  '초과',
  '충족',
  '근접',
  '미달',
  '표본상태',
];

const ORG_RESULT_GUIDE_ROWS: unknown[][] = [
  ['항목', '설명'],
  ['갭', '갭 = 정수 내림 점수(flooredScore) − 성장레벨. 절대평가 기준이며 원점수 평균으로 줄세우지 않습니다.'],
  ['평균점수', '가중점수에 소수 절사(둘째 자리 내림)를 적용한 보조 표시값입니다(정렬축 아님).'],
  ['완료율', '완료인원 / 배정인원. 미완료 평가는 통계(달성률·평균갭·SD)에서 제외됩니다.'],
  ['달성률', '완료·유효 표본(n명) 중 갭이 0 이상인 비율입니다.'],
  ['표준편차', '표본표준편차(베셀 보정, n−1). 완료 표본 n<2 이면 정의되지 않습니다.'],
  ['표본상태', `완료 표본 n<${MIN_ORG_SAMPLE}(소표본) 또는 미지정 조직은 통계 비교에서 제외되는 참고 행입니다.`],
];

export type OrgResultRow = {
  levelLabel: string; // 집계 레벨(법인/본부/부/팀 등)
  org: string; // 조직 키
  parentPath: string; // 상위 경로 문자열('' 가능)
  assignedCount: number; // 배정 인원(완료율 분모)
  completedCount: number; // 완료 인원
  n: number; // 완료·유효 표본 수(통계 분모)
  achievedCount: number; // 완료·유효 표본 중 갭>=0
  meanGap: number | null;
  sd: number | null;
  meanScore: number | null; // 평균 가중점수(보조 표시값)
  buckets: { exceed: number; meet: number; near: number; below: number };
  isSmall: boolean; // n<MIN_ORG_SAMPLE
  isUnassigned: boolean; // '미지정' 등 비교 제외 참고 노드
};

const pctText = (numerator: number, denominator: number) =>
  denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '';

const gapText = (gap: number) => (gap > 0 ? `+${gap.toFixed(2)}` : gap.toFixed(2));

const buildOrgResultRows = (rows: OrgResultRow[]) =>
  rows.map((row) => {
    // 소표본/미지정 노드는 통계 셀을 비우고 표본상태 라벨만 남긴다('%' 미표기).
    const statsHidden = row.isSmall;
    const sampleStatus = row.isUnassigned
      ? '비교 제외(미지정)'
      : row.isSmall
        ? `표본 부족(n<${MIN_ORG_SAMPLE})`
        : '';
    return {
      집계레벨: row.levelLabel,
      조직: row.org,
      상위경로: row.parentPath,
      배정인원: row.assignedCount,
      완료인원: row.completedCount,
      완료율: pctText(row.completedCount, row.assignedCount),
      평균점수: statsHidden || row.meanScore == null ? '' : row.meanScore.toFixed(1),
      평균갭: statsHidden || row.meanGap == null ? '' : gapText(row.meanGap),
      표준편차: statsHidden || row.sd == null ? '' : row.sd.toFixed(2),
      달성인원: statsHidden ? '' : row.achievedCount,
      달성률: statsHidden ? '' : pctText(row.achievedCount, row.n),
      초과: row.buckets.exceed,
      충족: row.buckets.meet,
      근접: row.buckets.near,
      미달: row.buckets.below,
      표본상태: sampleStatus,
    };
  });

// 부서·본부 결과 리포트 엑셀 다운로드. rows 는 화면이 집계한 결과를 그대로 받는다(추가 조회 없음).
export const downloadOrgResultWorkbook = (
  rows: OrgResultRow[],
  meta: { levelLabel: string; periodLabel?: string } = { levelLabel: '조직' },
): { fileName: string; rowCount: number } => {
  const wb = XLSX.utils.book_new();
  appendObjectSheet(wb, '부서본부결과', ORG_RESULT_HEADERS, buildOrgResultRows(rows));
  appendAoaSheet(wb, '지표안내', ORG_RESULT_GUIDE_ROWS);
  const safeLevel = meta.levelLabel.replace(/[\\/:*?"<>|]/g, '_');
  const fileName = writeWorkbook(wb, `부서본부결과_${safeLevel}_${todayText()}.xlsx`);
  return { fileName, rowCount: rows.length };
};

// ── 개인 피드백 리포트 (F-D3a) ───────────────────────────────────────────────
// HR 가 1명을 선택해 본 '읽기 전용' 결과 리포트를 엑셀로 내려받는다. 화면(HrIndividualFeedbackPage)이
// 이미 메모리에 가진 EmployeeEvaluationRecord 를 그대로 직렬화한다 — 다운로드 시 추가 DB 조회 0건.
// downloadOrgResultWorkbook(F-D2) 와 동일 전략. PDF 의존성·생성 없음(D-3). 갭은 정수 내림 점수
// (flooredScore) 기준 절대평가다. 점수는 가중점수(weightedScore)에 소수 절사를 적용해 표시한다.

const INDIVIDUAL_SUMMARY_HEADERS = ['항목', '값'];

const INDIVIDUAL_TASK_HEADERS = [
  '과업명',
  '가중치(%)',
  '기여방식',
  '기여범위',
  '점수',
  '갭(점수−성장레벨)',
  '갭 판정',
  '최신 평가의견',
  '평가자',
  '피드백일시',
  '의견 이력 수',
];

const INDIVIDUAL_GUIDE_ROWS: unknown[][] = [
  ['항목', '설명'],
  ['갭', '갭 = 정수 내림 점수(flooredScore) − 성장레벨(절대평가). 원점수 자체로 줄세우지 않습니다.'],
  ['갭 판정', '탁월 기여(갭≥1) · 기준 충족(갭=0) · 보완 필요(갭=−1) · 미달성(갭≤−2). 판정이 아닌 검토 정황입니다.'],
  ['표시점수', '가중점수에 소수 절사(둘째 자리 내림)를 적용한 값입니다.'],
  ['종합 달성', '정수 내림 가중점수(flooredScore)가 성장레벨 이상이면 달성으로 표기합니다.'],
  ['미평가', '점수가 입력되지 않은 과업은 갭을 산출하지 않습니다(―).'],
  ['발령 다중평가자', '발령(전보)으로 평가자가 여럿인 경우 현재 평가자 기준 1건을 표시합니다. 정상 케이스입니다.'],
];

// 갭 버킷 → 한글 라벨(엑셀 직렬화용). 화면과 동일하게 절대평가 기준.
const GAP_BUCKET_LABEL: Record<'exceed' | 'meet' | 'near' | 'below', string> = {
  exceed: '탁월 기여',
  meet: '기준 충족',
  near: '보완 필요',
  below: '미달성',
};

// 개인 리포트 엑셀에 필요한 최소 형태. EmployeeEvaluationRecord 를 그대로 받지 않고
// 화면이 산출한 표시값까지 포함한 직렬화 친화 타입으로 받아 추가 계산을 막는다.
export type IndividualReportTaskRow = {
  title: string;
  weight: number;
  contributionMethod: string | null;
  contributionScope: string | null;
  score: number | null;
  gap: number | null; // Math.round(score) - Math.round(growthLevel), 미평가는 null
  gapBucket: 'exceed' | 'meet' | 'near' | 'below' | null;
  latestFeedback: string | null;
  latestEvaluatorName: string | null;
  latestFeedbackDate: string | null;
  feedbackCount: number;
};

export type IndividualReportData = {
  employeeId: string;
  name: string;
  position: string;
  department: string;
  orgPath: string; // 조직 계층 경로('' 가능)
  growthLevel: number | null;
  growthLevelTitle: string;
  currentEvaluatorName: string | null;
  evaluationStatusLabel: string;
  displayScore: string; // formatScore(weightedScore)
  flooredScore: number;
  achieved: boolean;
  totalWeight: number;
  totalTasks: number;
  ratedTasks: number;
  tasks: IndividualReportTaskRow[];
};

const formatGapCell = (gap: number | null): string => {
  if (gap == null) return '';
  return gap > 0 ? `+${gap}` : String(gap);
};

const buildIndividualSummaryRows = (data: IndividualReportData) => [
  INDIVIDUAL_SUMMARY_HEADERS,
  ['성명', data.name],
  ['사번', data.employeeId],
  ['직급', data.position],
  ['부서', data.department],
  ['조직 경로', data.orgPath],
  ['성장레벨', data.growthLevel == null ? '' : `Lv.${data.growthLevel} · ${data.growthLevelTitle}`],
  ['현재 평가자', data.currentEvaluatorName ?? ''],
  ['평가 상태', data.evaluationStatusLabel],
  ['표시 점수(가중)', data.displayScore],
  ['정수 내림 점수', String(data.flooredScore)],
  ['종합 달성', data.achieved ? '달성' : '미달성'],
  ['총 가중치(%)', String(data.totalWeight)],
  ['과업 수(평가/전체)', `${data.ratedTasks}/${data.totalTasks}`],
];

const buildIndividualTaskRows = (data: IndividualReportData) =>
  data.tasks.map((task) => ({
    과업명: task.title,
    '가중치(%)': task.weight,
    기여방식: task.contributionMethod ?? '',
    기여범위: task.contributionScope ?? '',
    점수: task.score ?? '',
    '갭(점수−성장레벨)': formatGapCell(task.gap),
    '갭 판정': task.gapBucket ? GAP_BUCKET_LABEL[task.gapBucket] : '',
    '최신 평가의견': task.latestFeedback ?? '',
    평가자: task.latestEvaluatorName ?? '',
    피드백일시: dateText(task.latestFeedbackDate),
    '의견 이력 수': task.feedbackCount,
  }));

// 개인 피드백 리포트 엑셀 다운로드. data 는 화면이 직렬화한 결과를 그대로 받는다(추가 조회 없음).
export const downloadIndividualReportWorkbook = (
  data: IndividualReportData,
  meta: { periodLabel?: string } = {},
): { fileName: string; taskCount: number } => {
  const wb = XLSX.utils.book_new();

  const summaryRows = buildIndividualSummaryRows(data);
  if (meta.periodLabel) {
    summaryRows.push(['평가기간', meta.periodLabel]);
  }
  appendAoaSheet(wb, '리포트요약', summaryRows);
  appendObjectSheet(wb, '과업상세', INDIVIDUAL_TASK_HEADERS, buildIndividualTaskRows(data));
  appendAoaSheet(wb, '지표안내', INDIVIDUAL_GUIDE_ROWS);

  const safeName = `${data.name}_${data.employeeId}`.replace(/[\\/:*?"<>|]/g, '_');
  const fileName = writeWorkbook(wb, `개인피드백리포트_${safeName}_${todayText()}.xlsx`);
  return { fileName, taskCount: data.tasks.length };
};

const QNA_LOG_HEADERS = [
  '일시',
  '사번',
  '이름',
  '부서',
  '역할',
  '질문',
  'AI 답변',
  '응답상태',
];

const roleLabel = (role?: string | null) => {
  if (role === 'evaluator') return '평가자';
  if (role === 'evaluatee') return '피평가자';
  if (role === 'hr') return 'HR';
  return role ?? '';
};

const buildQnaLogRows = (logs: EvaluatorQnaLog[]) =>
  logs.map((log) => ({
    일시: dateTimeText(log.created_at),
    사번: log.user_id,
    이름: log.user_name ?? '',
    부서: log.user_department ?? '',
    역할: roleLabel(log.user_role),
    질문: log.question,
    'AI 답변': log.is_error ? '' : log.answer ?? '',
    응답상태: log.is_error ? '응답 실패' : '정상',
  }));

// 평가자 AI 도움말 문의 이력 전체를 엑셀로 내려받는다. (HR 시스템 설정)
export const downloadEvaluatorQnaLogsWorkbook = async (): Promise<{
  fileName: string;
  rowCount: number;
}> => {
  const logs = await evaluatorQnaLogService.listAll();
  const wb = XLSX.utils.book_new();
  appendObjectSheet(wb, 'AI문의이력', QNA_LOG_HEADERS, buildQnaLogRows(logs));
  const fileName = writeWorkbook(wb, `AI문의이력_${todayText()}.xlsx`);
  return { fileName, rowCount: logs.length };
};
