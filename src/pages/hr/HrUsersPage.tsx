import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import MatchingIntegrityBanner from '@/components/hr/MatchingIntegrityBanner';
import { IconSearch } from '@/components/brand';
import { useAllEmployees } from '@/hooks/useDashboardRecords';
import { employeeService, evaluationService, evaluationPeriodService, type OrgStructureImport } from '@/lib/services';
import type {
  EmployeeProfileImportRowInput,
  MatchingImportRowInput,
} from '@/lib/services/employeeService';
import {
  downloadEmployeeProfileUploadWorkbook,
  downloadMatchingUploadWorkbook,
  downloadOrgStructureWorkbook,
} from '@/utils/hrDataExport';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import EvaluatorHistoryModal from '@/components/hr/EvaluatorHistoryModal';
import AddEmployeeModal, { type NewEmployeeInput } from '@/components/hr/AddEmployeeModal';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import UploadPreviewModal from '@/components/hr/UploadPreviewModal';
import OrgChecklist from '@/components/hr/OrgChecklist';
import { getOrgValue, matchesOrgNodes, orgPathLabel, orgFieldsFromEvaluation, type OrgFields } from '@/lib/orgHierarchy';
import { isOnLeave } from '@/lib/employeeStatus';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { diffProfileRows, type DiffResult } from '@/lib/uploadDiff';
import type {
  Employee,
  Evaluation,
  EvaluationStatus,
  EvaluatorAssignmentHistory,
  UserRole,
} from '@/types';
import { roleFilters, statusLabel, type EmployeeEditForm } from './_hrUsersHelpers';
import { UserRow, GroupHeaderRow } from './UserRow';

// roleFilters·editableRoleOptions·ROLE_BG/COLOR/BORDER 는 ./_hrUsersHelpers 로 이동.

// 묶어서 보기 그룹 키 — 조직 경로(법인 › 본부 › 부 › 팀). 없으면 부서명, 그래도 없으면 '미지정'.
const orgGroupKey = (org: OrgFields) => orgPathLabel(org) || '미지정';

// 사용자관리 테이블 정렬(U-4)
type SortKey = 'employee_id' | 'name' | 'growth_level' | 'status';
type SortConfig = { key: SortKey; dir: 'asc' | 'desc' };
const STATUS_RANK: Record<string, number> = {
  'not-started': 0, draft: 1, 'in-progress': 1, submitted: 2, evaluating: 3, completed: 4, locked: 5,
};
const statusRank = (s?: string | null) => STATUS_RANK[s ?? ''] ?? 0;

const SortableTh = ({ label, sortKey, sort, onSort, style }: {
  label: string;
  sortKey: SortKey;
  sort: SortConfig | null;
  onSort: (key: SortKey) => void;
  style?: CSSProperties;
}) => {
  const active = sort?.key === sortKey;
  return (
    <TableHead style={style}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title="클릭하여 정렬"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        {label}
        <span style={{ opacity: active ? 1 : 0.35, fontSize: '0.82em' }}>
          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </TableHead>
  );
};

// roleLabel·statusLabel·statusTone·EmployeeEditForm 은 ./_hrUsersHelpers 로 이동.

type AssignmentChangeOptions = {
  startDate: string;
  evaluationPeriodId: string | null;
};

// F-6: 일괄작업 결과 리포트(부분 실패 시 어떤 직원이 왜 실패했는지).
type BulkActionResult = {
  action: string;
  total: number;
  success: number;
  skipped?: number;
  failed: Array<{ id: string; name: string; reason: string }>;
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
  return ['사번', '성명', '직무', '권한1'].every((h) => h in idx);
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
        // 부서ID — 매칭 파일에 행이 없는 평가자 전용 인원(임원 등)의 부서 지정 경로.
        // 서버가 출처 우선순위(매칭 1순위 > 대상자 2순위)를 적용하므로 충돌 시 매칭 값이 유지된다.
        department_id: get('부서ID'),
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

// 기여도 업로드 미리보기 상태 — 카운트형이라 DiffResult 모달과 분리. 서비스 타입에서 파생.
type ContribPreview = Awaited<ReturnType<typeof employeeService.previewContributionRows>>;
type ContribRow = Parameters<typeof employeeService.previewContributionRows>[0]['rows'][number];

// 엑셀 날짜셀(Date 또는 'YYYYMMDD'/'YYYY-MM-DD' 문자열)을 'YYYY-MM-DD' 로 정규화.
const toYmd = (v: unknown): string => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const m = String(v ?? '').trim().match(/(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

const HrUsersPage = () => {
  const profileFileInputRef = useRef<HTMLInputElement | null>(null);
  const matchingFileInputRef = useRef<HTMLInputElement | null>(null);
  const orgFileInputRef = useRef<HTMLInputElement | null>(null);
  const contribFileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [orgNodeKeys, setOrgNodeKeys] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<'all' | UserRole>('all');
  const [groupBySection, setGroupBySection] = useState(false); // 조직별로 묶어서 보기
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const toggleSort = useCallback((key: SortKey) => {
    setSortConfig((prev) =>
      prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }, []);
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
  const [isImportingOrg, setIsImportingOrg] = useState(false);
  const [isApplyingOrg, setIsApplyingOrg] = useState(false);
  const [orgUploadPeriodId, setOrgUploadPeriodId] = useState<string | null>(null);
  // 조직정보 업로드 이력(평가기간별 스냅샷) 모달.
  const [orgHistory, setOrgHistory] = useState<OrgStructureImport[] | null>(null);
  const [orgHistoryOpen, setOrgHistoryOpen] = useState(false);
  const [orgHistoryLoading, setOrgHistoryLoading] = useState(false);
  const [orgDownloadingKey, setOrgDownloadingKey] = useState<string | null>(null);
  const [pendingOrgUpload, setPendingOrgUpload] = useState<
    { fileName: string; rows: { code: string; name: string; level: number; kind: string }[] } | null
  >(null);
  const [isImportingContribution, setIsImportingContribution] = useState(false);
  const [isApplyingContrib, setIsApplyingContrib] = useState(false);
  const [contribPreview, setContribPreview] = useState<
    { fileName: string; rows: ContribRow[]; preview: ContribPreview } | null
  >(null);
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
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  // 일괄작업 중단 플래그 — 루프 상단에서 검사해 남은 처리를 멈춘다(이미 처리된 건은 유지).
  const bulkAbortRef = useRef(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [pageIndex, setPageIndex] = useState(0);
  const { employees, records, isLoading, isInitialLoading, error, reload } = useAllEmployees();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { periods, selectedPeriodId, reloadPeriods } = useEvaluationPeriod();
  const navigate = useNavigate();
  const actorId = user?.employeeId ?? user?.id ?? null;

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.employee_id, employee])),
    [employees],
  );
  const recordMap = useMemo(
    () => new Map(records.map((record) => [record.employee.employee_id, record])),
    [records],
  );
  // 선택 평가기간 기준 조직 필드 — 그 기간 평가의 evaluatee_org_*(없으면 현재 master).
  // 검색·조직필터·그룹·체크리스트가 모두 이 값을 공유해 "해당 연도 기준"으로 조회된다.
  const orgOf = useCallback(
    (employee: Employee): OrgFields =>
      orgFieldsFromEvaluation(recordMap.get(employee.employee_id)?.evaluation, employee),
    [recordMap],
  );
  // 현재 조직 기간(is_default) = master 조직이 동기화되는 기간. 그 외(과거) 기간을 볼 땐
  // 인라인 조직(법인/본부/부/팀) 편집을 잠근다(과거 기간 조직은 조직정보 업로드로 관리).
  const isCurrentOrgPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId)?.is_default === true,
    [periods, selectedPeriodId],
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
  // 조직 필터 후보(체크리스트)도 선택 기간 조직 기준.
  const orgRosterFields = useMemo(() => orgRosterEmployees.map(orgOf), [orgRosterEmployees, orgOf]);

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
          // 검색도 선택 기간 기준: 그 기간 조직 경로(법인›본부›부›팀)로 매칭.
          const orgPath = orgPathLabel(orgOf(employee)).toLowerCase();
          const matchesQuery =
            !normalizedQuery ||
            employee.name.toLowerCase().includes(normalizedQuery) ||
            orgPath.includes(normalizedQuery) ||
            employee.position.toLowerCase().includes(normalizedQuery) ||
            employee.employee_id.toLowerCase().includes(normalizedQuery);
          const matchesRole =
            selectedRole === 'all' || employee.available_roles.includes(selectedRole);
          return matchesQuery && matchesRole;
        })
        .filter((employee) => matchesOrgNodes(orgOf(employee), orgNodeKeys))
        .sort((a, b) => {
          // 묶어서 보기일 땐 같은 조직 그룹이 인접하도록 그룹 키 우선 정렬(선택 기간 조직 기준).
          if (groupBySection) {
            const cmp = orgGroupKey(orgOf(a)).localeCompare(orgGroupKey(orgOf(b)), 'ko');
            if (cmp !== 0) return cmp;
          }
          // 사용자가 헤더로 지정한 정렬(U-4) — 그룹 내/전체에서 적용.
          if (sortConfig) {
            const dir = sortConfig.dir === 'asc' ? 1 : -1;
            switch (sortConfig.key) {
              case 'employee_id':
                return a.employee_id.localeCompare(b.employee_id, undefined, { numeric: true }) * dir;
              case 'name':
                return a.name.localeCompare(b.name, 'ko') * dir;
              case 'growth_level':
                return ((a.growth_level ?? 0) - (b.growth_level ?? 0)) * dir;
              case 'status':
                return (
                  (statusRank(recordMap.get(a.employee_id)?.evaluation?.evaluation_status) -
                    statusRank(recordMap.get(b.employee_id)?.evaluation?.evaluation_status)) * dir
                );
            }
          }
          return (
            orgPathLabel(orgOf(a)).localeCompare(orgPathLabel(orgOf(b)), 'ko') ||
            a.name.localeCompare(b.name)
          );
        }),
    [employees, recordMap, query, selectedRole, orgNodeKeys, groupBySection, orgOf, sortConfig],
  );

  // 페이지네이션: 필터링된 목록을 페이지 단위로 자른다.
  const totalFiltered = filteredEmployees.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pagedEmployees = useMemo(
    () => filteredEmployees.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filteredEmployees, currentPage, pageSize],
  );
  // 현재 필터/검색/기간/조직에 실제로 보이는 대상 집합 — 일괄작업을 이 집합으로만 스코프해
  // 화면에서 사라진(선택만 남은) 대상까지 함께 바꾸는 사고를 막는다.
  const filteredIdSet = useMemo(
    () => new Set(filteredEmployees.map((e) => e.employee_id)),
    [filteredEmployees],
  );
  // 검색·역할·평가기간·페이지크기가 바뀌면 첫 페이지로.
  useEffect(() => {
    setPageIndex(0);
  }, [query, selectedRole, selectedPeriodId, pageSize, groupBySection, sortConfig]);
  // 평가기간이 바뀌면 조직 구조(연도별)도 달라지므로 이전 기간 기준 조직필터 선택을 초기화한다.
  useEffect(() => {
    setOrgNodeKeys([]);
  }, [selectedPeriodId]);
  // 평가기간·역할·조직필터가 바뀌면 '화면에 없는 이전 선택'이 일괄작업 대상으로 남지 않도록 초기화한다.
  // (검색어 타이핑마다 지우면 번거로우므로 구조적 필터 변경에만 초기화 — 검색 narrowing 은 filteredIdSet 스코프가 방어.)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectedPeriodId, selectedRole, orgNodeKeys]);

  // 다중 선택 (현재 페이지 기준 전체선택, 선택 자체는 페이지 넘어가도 유지).
  const pageIds = useMemo(() => pagedEmployees.map((e) => e.employee_id), [pagedEmployees]);
  // 페이지 내 조직 그룹 헤더/카운트 사전계산 — 렌더마다 orgGroupKey 재계산·헤더당 O(n) 필터(=페이지 내 O(n²))를 제거(P2-3).
  const pageGroupRows = useMemo(() => {
    const keys = pagedEmployees.map((e) => orgGroupKey(orgOf(e)));
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    return keys.map((key, i) => {
      const showHeader = groupBySection && (i === 0 || keys[i - 1] !== key);
      return { key, showHeader, count: showHeader ? (counts.get(key) ?? 0) : 0 };
    });
  }, [pagedEmployees, orgOf, groupBySection]);
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

  // 행 인라인 편집 중 새로고침·탭 닫기 시 유실 경고(과업 카드 편집과 동일 안전장치).
  // 앱 내 사이드바 이동은 BrowserRouter라 useBlocker 미지원 — 브라우저 레벨 이탈만 방어.
  useUnsavedChangesWarning(editingEmployeeId !== null);

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
    // 이력 모달은 '선택한 평가기간' 기준으로 평가/평가자/편집을 보여준다 — periodId 전달 + 기간별 캐시키.
    // (periodId 없이 호출하면 서버가 활성기간만 반환 → 과거 기간 평가가 비어 모달이 현재 기간만 표시됨.)
    const cacheKey = `${employeeId}::${selectedPeriodId ?? ''}`;
    if (!force && evaluationsByEmployee[cacheKey]) return;
    setLoadingEvaluationsEmployeeId(employeeId);
    try {
      const list = await evaluationService.getEvaluationsByEmployeeId(employeeId, { periodId: selectedPeriodId });
      setEvaluationsByEmployee((prev) => ({ ...prev, [cacheKey]: list }));
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
      aiRuleExempt: employee.ai_rule_exempt ?? false,
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

    if (!name || !department) {
      toast({
        title: '사용자 정보를 저장할 수 없습니다.',
        description: '이름, 부서는 비워둘 수 없습니다. (직책은 비워둘 수 있음)',
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
        // 조직은 '현재 조직 기간'에서만 편집 — 과거 기간 보기 중엔 org_* 미전송(master 조직 불변).
        ...(isCurrentOrgPeriod
          ? {
              org_corporation: orgOrNull(editForm.orgCorporation),
              org_division: orgOrNull(editForm.orgDivision),
              org_department: orgOrNull(editForm.orgDepartment),
              org_team: orgOrNull(editForm.orgTeam),
            }
          : {}),
        // 휴직=‘휴직’, 복직(휴직→재직)=null 로 해제, 그 외 일반 편집은 미전송(기존값 유지).
        matching_result: editForm.onLeave ? '휴직' : isOnLeave(employee) ? null : undefined,
        ai_rule_exempt: editForm.aiRuleExempt,
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
      // 모달의 평가 목록도 즉시 동기화(기간별 캐시키).
      if (historyModalEmployeeId) {
        const cacheKey = `${historyModalEmployeeId}::${selectedPeriodId ?? ''}`;
        setEvaluationsByEmployee((prev) => {
          const list = prev[cacheKey];
          if (!list) return prev;
          return {
            ...prev,
            [cacheKey]: list.map((ev) =>
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
      description: (
        <div className="space-y-1">
          <p>평가·과업·피드백·변경이력이 함께 영구 삭제되며 되돌릴 수 없습니다.</p>
          <p>발령으로 평가가 여러 건인 직원의 이전 평가도 함께 삭제됩니다.</p>
          <p>계속하려면 &quot;삭제&quot;를 입력하세요.</p>
        </div>
      ),
      variant: 'danger',
      requireTypedConfirmation: '삭제',
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

  // 평가 열람(읽기 전용) 화면으로 이동.
  const openEvaluationViewer = (employeeId: string) =>
    navigate(`/hr/evaluation-viewer?evaluatee=${encodeURIComponent(employeeId)}`);

  // U-3: 행 핸들러를 안정 참조로 래핑 → 메모된 UserRow 가 매 부모 렌더마다 리렌더되지 않게.
  //      실제 핸들러는 매 렌더 최신본을 ref 에 보관하고, 래퍼(useCallback [])가 최신본을 호출한다.
  const rowHandlersRef = useRef({
    toggleSelect,
    startEditing,
    cancelEditing,
    saveEmployeeEdit,
    updateEditForm,
    toggleEditRole,
    handleDeleteUser,
    openAssignmentHistory,
    openEvaluationViewer,
  });
  rowHandlersRef.current = {
    toggleSelect,
    startEditing,
    cancelEditing,
    saveEmployeeEdit,
    updateEditForm,
    toggleEditRole,
    handleDeleteUser,
    openAssignmentHistory,
    openEvaluationViewer,
  };
  const onRowToggleSelect = useCallback((id: string) => rowHandlersRef.current.toggleSelect(id), []);
  const onRowStartEdit = useCallback((emp: Employee) => rowHandlersRef.current.startEditing(emp), []);
  const onRowCancelEdit = useCallback(() => rowHandlersRef.current.cancelEditing(), []);
  const onRowSaveEdit = useCallback((emp: Employee) => rowHandlersRef.current.saveEmployeeEdit(emp), []);
  const onRowUpdateEditForm = useCallback(
    <K extends keyof EmployeeEditForm>(key: K, value: EmployeeEditForm[K]) =>
      rowHandlersRef.current.updateEditForm(key, value),
    [],
  );
  const onRowToggleEditRole = useCallback((role: UserRole) => rowHandlersRef.current.toggleEditRole(role), []);
  const onRowDelete = useCallback((emp: Employee) => rowHandlersRef.current.handleDeleteUser(emp), []);
  const onRowOpenHistory = useCallback((id: string) => rowHandlersRef.current.openAssignmentHistory(id), []);
  const onRowOpenEvaluation = useCallback((id: string) => rowHandlersRef.current.openEvaluationViewer(id), []);

  const handleBulkDelete = async () => {
    // 현재 목록에 보이는 대상만 — 필터/기간을 바꿔 화면에서 사라진 선택은 제외한다.
    const ids = [...selectedIds].filter((id) => filteredIdSet.has(id));
    if (!ids.length) {
      toast({
        title: '현재 목록에 포함된 선택 대상이 없습니다.',
        description: '검색·필터를 조정했다면 대상을 다시 선택해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    const names = ids.map((id) => employeeMap.get(id)?.name ?? id);
    const nameList =
      names.slice(0, 10).join(', ') + (names.length > 10 ? ` 외 ${names.length - 10}명` : '');
    const ok = await confirm({
      title: `선택한 ${ids.length}명의 사용자를 삭제할까요?`,
      description: (
        <div className="space-y-1">
          <p className="break-all">대상: {nameList}</p>
          <p>평가·과업·피드백·변경이력이 함께 영구 삭제되며 되돌릴 수 없습니다.</p>
          <p>발령으로 평가가 여러 건인 직원의 이전 평가도 함께 삭제됩니다.</p>
          <p>계속하려면 &quot;삭제&quot;를 입력하세요.</p>
        </div>
      ),
      variant: 'danger',
      requireTypedConfirmation: '삭제',
      confirmText: `${ids.length}명 삭제`,
    });
    if (!ok) return;
    bulkAbortRef.current = false;
    setBulkActionRunning(true);
    setBulkProgress({ done: 0, total: ids.length });
    let success = 0;
    let processed = 0;
    let aborted = false;
    const failed: BulkActionResult['failed'] = [];
    for (const id of ids) {
      if (bulkAbortRef.current) {
        aborted = true;
        break;
      }
      setBulkProgress({ done: ++processed, total: ids.length });
      try {
        await employeeService.deleteEmployee(id);
        success += 1;
      } catch (err) {
        console.error('일괄 삭제 실패:', id, err);
        failed.push({ id, name: employeeMap.get(id)?.name ?? id, reason: err instanceof Error ? err.message : '삭제 실패' });
      }
    }
    await reload();
    clearSelection();
    setBulkActionRunning(false);
    setBulkProgress(null);
    toast({
      title: aborted ? '일괄 삭제 중단됨' : '일괄 삭제 완료',
      description: `${success}명 삭제${failed.length ? ` · 실패 ${failed.length}명` : ''}${
        aborted ? ` · 중단(${ids.length - processed}건 미처리)` : ''
      }`,
      variant: failed.length ? 'destructive' : undefined,
    });
    if (failed.length) setBulkResult({ action: '선택 삭제', total: ids.length, success, failed });
  };

  const handleBulkEvaluatorChange = async () => {
    // 현재 목록에 보이는 대상만 — 필터/기간을 바꿔 화면에서 사라진 선택은 제외한다.
    const ids = [...selectedIds].filter((id) => filteredIdSet.has(id));
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
    // 삭제와 동일하게 대상 이름을 노출해, 안 보이는 코호트를 통째로 바꾸는 실수를 확인 단계에서 잡는다.
    const names = ids.map((id) => employeeMap.get(id)?.name ?? id);
    const nameList =
      names.slice(0, 10).join(', ') + (names.length > 10 ? ` 외 ${names.length - 10}명` : '');
    const ok = await confirm({
      title: '평가자 일괄 변경',
      description: (
        <div className="space-y-1">
          <p className="break-all">대상 {ids.length}명: {nameList}</p>
          <p>
            평가자를 &quot;{toLabel}&quot;(으)로 {bulkChangeDate}부로 일괄 변경합니다.
          </p>
        </div>
      ),
      confirmText: `${ids.length}명 변경`,
    });
    if (!ok) return;
    bulkAbortRef.current = false;
    setBulkActionRunning(true);
    setBulkProgress({ done: 0, total: ids.length });
    let success = 0;
    let skipped = 0;
    let processed = 0;
    let aborted = false;
    const failed: BulkActionResult['failed'] = [];
    for (const id of ids) {
      if (bulkAbortRef.current) {
        aborted = true;
        break;
      }
      setBulkProgress({ done: ++processed, total: ids.length });
      const emp = employeeMap.get(id);
      if (!emp) {
        failed.push({ id, name: id, reason: '직원 정보를 찾을 수 없음' });
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
        failed.push({ id, name: emp.name ?? id, reason: err instanceof Error ? err.message : '변경 실패' });
      }
    }
    await reload();
    clearSelection();
    setBulkEvaluatorId('');
    setBulkActionRunning(false);
    setBulkProgress(null);
    toast({
      title: aborted ? '평가자 일괄 변경 중단됨' : '평가자 일괄 변경 완료',
      description: `${success}명 변경${skipped ? ` · 동일 ${skipped}명` : ''}${failed.length ? ` · 실패 ${failed.length}명` : ''}${
        aborted ? ` · 중단(${ids.length - processed}건 미처리)` : ''
      }`,
      variant: failed.length ? 'destructive' : undefined,
    });
    if (failed.length) setBulkResult({ action: '평가자 일괄 변경', total: ids.length, success, skipped, failed });
  };

  const openMatchingFileDialog = () => {
    if (isImportingMatching) return;
    matchingFileInputRef.current?.click();
  };

  const openProfileFileDialog = () => {
    if (isImportingProfiles) return;
    profileFileInputRef.current?.click();
  };

  const openOrgFileDialog = () => {
    if (isImportingOrg) return;
    orgFileInputRef.current?.click();
  };

  // 조직정보 엑셀(T-Level 트리) 업로드 → 부서코드→상위조직(법인/본부/부/팀) 파생 + employees.org_* 자동 매칭.
  // 업로드 전 가드: 업로드 대상(selectedPeriodId)을 '단일 활성 평가기간'으로 만든다.
  // 다른 기간이 함께 active 면(둘 다 열림 = create_default 트리거가 엉뚱한 기간에 평가 생성)
  // 그 기간들을 마감(closed)하고 대상 기간을 활성화한 뒤 진행. 사용자에게 사전 고지·동의를 받는다.
  const ensureUploadPeriod = useCallback(async (): Promise<boolean> => {
    const target = periods.find((p) => p.id === selectedPeriodId);
    if (!target) {
      toast({ title: '평가기간을 먼저 선택하세요.', variant: 'destructive' });
      return false;
    }
    const otherActive = periods.filter((p) => p.id !== target.id && p.status === 'active');
    const alreadyOk = otherActive.length === 0 && target.status === 'active' && target.is_default === true;
    if (alreadyOk) return true;
    const otherNames = otherActive.map((p) => p.name).join(', ');
    const ok = await confirm({
      title: '평가기간 정리 후 업로드',
      description:
        `정확한 적재를 위해 업로드 대상 '${target.name}'을(를) 현재(활성) 평가기간으로 설정합니다.` +
        (otherActive.length ? ` 함께 열려 있는 '${otherNames}'은(는) 마감(closed) 처리됩니다.` : '') +
        ' 평가기간이 둘 이상 열려 있으면 평가가 엉뚱한 기간에 생성될 수 있어 막는 절차입니다.',
      confirmText: '마감하고 업로드',
    });
    if (!ok) return false;
    try {
      for (const p of otherActive) await evaluationPeriodService.closePeriod(p.id);
      await evaluationPeriodService.activatePeriod(target.id);
      await reloadPeriods();
      toast({
        title: `'${target.name}'을(를) 현재 평가기간으로 설정했습니다.`,
        description: otherActive.length ? `${otherNames} → 마감 처리됨` : undefined,
      });
      return true;
    } catch (error) {
      console.error('업로드 전 평가기간 정리 실패:', error);
      toast({ title: '평가기간 정리 실패', description: '다시 시도해 주세요.', variant: 'destructive' });
      return false;
    }
  }, [periods, selectedPeriodId, confirm, toast, reloadPeriods]);

  const importOrgStructureFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast({
        title: '엑셀 파일을 선택해 주세요.',
        description: '조직정보 xlsx/xls 파일만 업로드할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    if (!(await ensureUploadPeriod())) return;
    setIsImportingOrg(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.');
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
      // 조직정보 양식: 헤더가 1~2줄이고 열 위치가 바뀔 수 있어, 하드코딩 인덱스 대신
      // '헤더명'으로 열을 찾는다(부서명 / T-Level / 부서ID(부서코드) / 조직종류).
      const norm = (v: unknown) => String(v ?? '').replace(/[@\s-]/g, '').toUpperCase();
      const findCol = (keywords: string[]) => {
        for (let i = 0; i < Math.min(3, aoa.length); i += 1) {
          const row = aoa[i] ?? [];
          for (let j = 0; j < row.length; j += 1) {
            const h = norm(row[j]);
            if (h && keywords.some((k) => h.includes(k))) return j;
          }
        }
        return -1;
      };
      const levelCol = findCol(['TLEVEL']);
      const codeCol = findCol(['부서ID', '부서코드', '부서아이디']);
      const kindCol = findCol(['조직종류']);
      let nameCol = findCol(['부서명']);
      if (nameCol < 0) nameCol = findCol(['부서']);
      const missing: string[] = [];
      if (levelCol < 0) missing.push('T-Level');
      if (codeCol < 0) missing.push('부서ID(부서코드)');
      if (missing.length > 0) {
        throw new Error(`조직정보 양식에서 ${missing.join(', ')} 컬럼을 찾지 못했습니다. 헤더명을 확인해 주세요.`);
      }
      // 헤더 1~2줄은 level 이 숫자가 아니므로 필터에서 자연히 제외된다(슬라이스 불필요).
      const rows = aoa
        .map((r) => ({
          name: String(r[nameCol] ?? '').trim(),
          level: Number(r[levelCol]),
          code: String(r[codeCol] ?? '').trim(),
          kind: kindCol >= 0 ? String(r[kindCol] ?? '').trim() : '',
        }))
        // T-Level 은 1부터. Number('')===0 이므로 빈 헤더행이 끼지 않도록 level>=1 로 거른다.
        .filter((r) => r.code && Number.isFinite(r.level) && r.level >= 1);
      if (rows.length === 0) {
        throw new Error('조직 노드를 찾지 못했습니다(부서코드·T-Level 값이 비어 있는지 확인).');
      }
      // 바로 반영하지 않고 '어느 평가기간 기준인지' 물어본다(조직구조는 기간별로 다름).
      setPendingOrgUpload({ fileName: file.name, rows });
      setOrgUploadPeriodId(selectedPeriodId);
    } catch (error) {
      console.error('조직정보 엑셀 업로드 실패:', error);
      toast({
        title: '조직정보 업로드 실패',
        description: error instanceof Error ? error.message : '조직정보 파일을 처리하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsImportingOrg(false);
    }
  };

  const applyOrgUpload = async () => {
    if (!pendingOrgUpload || !orgUploadPeriodId) return;
    setIsApplyingOrg(true);
    try {
      const r = await employeeService.importOrgStructure({
        rows: pendingOrgUpload.rows,
        periodId: orgUploadPeriodId,
        sourceLabel: pendingOrgUpload.fileName.replace(/\.(xlsx|xls)$/i, ''),
      });
      await reload();
      const warn = r.unmatched_corps.length
        ? ` · 미등록 법인 ${r.unmatched_corps.length}개(${r.unmatched_corps.join(', ')})`
        : '';
      const empNote = r.is_default_period
        ? ` · 직원 ${r.employees_updated}명 상위조직 갱신`
        : ' · (현재 기간이 아니라 직원 org는 유지)';
      toast({
        title: '조직정보 업로드가 완료되었습니다.',
        description: `${r.period_name} · 부서 ${r.node_count}개${empNote}${warn}`,
      });
      setPendingOrgUpload(null);
    } catch (error) {
      console.error('조직정보 적용 실패:', error);
      toast({
        title: '조직정보 적용 실패',
        description: error instanceof Error ? error.message : '적용하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsApplyingOrg(false);
    }
  };

  // 조직정보 업로드 이력 모달 열기 + 로드.
  const openOrgHistory = async () => {
    setOrgHistoryOpen(true);
    setOrgHistoryLoading(true);
    try {
      setOrgHistory(await employeeService.getOrgStructureImports());
    } catch (error) {
      console.error('조직정보 업로드 이력 조회 실패:', error);
      setOrgHistory([]);
    } finally {
      setOrgHistoryLoading(false);
    }
  };

  // 이력에서 해당 기간 조직정보 엑셀 다운로드.
  const downloadOrgPeriod = async (h: OrgStructureImport) => {
    const key = h.evaluation_period_id ?? 'none';
    setOrgDownloadingKey(key);
    try {
      const rows = await employeeService.getOrgStructureRows(h.evaluation_period_id);
      if (!rows.length) {
        toast({ title: '다운로드할 조직정보가 없습니다.', variant: 'destructive' });
        return;
      }
      const label = [h.period_name ?? '기간미지정', h.evaluation_year ?? ''].filter(Boolean).join('_');
      downloadOrgStructureWorkbook(label, rows);
      toast({ title: '조직정보 다운로드', description: `${label} · 부서 ${rows.length}개` });
    } catch (error) {
      console.error('조직정보 다운로드 실패:', error);
      toast({ title: '조직정보 다운로드 실패', description: '서버와 통신 중 오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setOrgDownloadingKey(null);
    }
  };

  const openContribFileDialog = () => {
    if (isImportingContribution) return;
    contribFileInputRef.current?.click();
  };

  // 기여도 평가 엑셀 업로드 → 미리보기(매칭/과업/점수/org 카운트). 적용은 모달에서.
  const importContributionFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast({
        title: '엑셀 파일을 선택해 주세요.',
        description: '기여도 xlsx/xls 파일만 업로드할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    if (!(await ensureUploadPeriod())) return;
    setIsImportingContribution(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.');
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
      // 헤더 행 자동 탐지: 상단 몇 줄 중 '사번'과 'TASK'를 모두 가진 행을 헤더로 본다
      // (제목행이 위에 있어도 견고). 못 찾으면 첫 행 헤더를 에러에 표시해 원인 파악을 돕는다.
      const normH = (h: unknown) => String(h ?? '').replace(/\s+/g, ' ').trim();
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(6, aoa.length); i += 1) {
        const hs = (aoa[i] ?? []).map(normH);
        if (hs.includes('사번') && hs.includes('TASK')) { headerRowIdx = i; break; }
      }
      if (headerRowIdx < 0) {
        const found = (aoa[0] ?? []).map(normH).filter(Boolean).slice(0, 24).join(', ');
        throw new Error(`기여도 양식이 아닙니다(사번·TASK 헤더 필요). 첫 행 헤더: ${found || '(빈 행)'}`);
      }
      const header = (aoa[headerRowIdx] ?? []).map(normH);
      const ix: Record<string, number> = Object.create(null);
      header.forEach((h, i) => { if (h && !(h in ix)) ix[h] = i; });
      const col = (r: unknown[], n: string) => (ix[n] != null ? r[ix[n]] : '');
      const rows: ContribRow[] = aoa
        .slice(headerRowIdx + 1)
        .filter((r) => !/PL/i.test(String(col(r, '평가기준명'))))
        .map((r) => ({
          sabun: String(col(r, '사번') ?? '').trim(),
          so: String(col(r, '소속') ?? '').trim() || '1',
          evaluatorId: String(col(r, '평가자ID') ?? '').trim(),
          deptCode: String(col(r, '부서') ?? '').trim(),
          title: String(col(r, 'TASK') ?? '').trim(),
          weight: Number(col(r, '비중')) || 0,
          score: col(r, '평가점수') as number | string,
          method: String(col(r, '기여방식') ?? '').trim(),
          scope: String(col(r, '기여범위') ?? '').trim(),
          description: String(col(r, '설명1') ?? '').trim(),
          remark: String(col(r, '비고') ?? '').trim(),
          startDate: toYmd(col(r, '시작일')),
          endDate: toYmd(col(r, '종료일')),
        }))
        .filter((r) => r.sabun);
      if (rows.length === 0) throw new Error('기여도 데이터 행이 없습니다.');
      const preview = await employeeService.previewContributionRows({ periodId: selectedPeriodId, rows });
      setContribPreview({ fileName: file.name, rows, preview });
    } catch (error) {
      console.error('기여도 엑셀 업로드 실패:', error);
      toast({
        title: '기여도 업로드 실패',
        description: error instanceof Error ? error.message : '기여도 파일을 처리하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsImportingContribution(false);
    }
  };

  const applyContribution = async () => {
    if (!contribPreview) return;
    setIsApplyingContrib(true);
    try {
      const r = await employeeService.importContributionRows({
        periodId: selectedPeriodId,
        rows: contribPreview.rows,
      });
      await reload();
      toast({
        title: '기여도 업로드가 완료되었습니다.',
        description: `평가 ${r.applied_evaluations}건 · 과업 ${r.tasks_inserted}개(점수 ${r.scored}) · org ${r.org_updated} · 건너뜀 ${r.skipped_groups}`,
      });
      setContribPreview(null);
    } catch (error) {
      console.error('기여도 적용 실패:', error);
      toast({
        title: '기여도 적용 실패',
        description: error instanceof Error ? error.message : '적용하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsApplyingContrib(false);
    }
  };

  const exportProfileFile = async () => {
    setIsExportingProfiles(true);
    try {
      const result = await downloadEmployeeProfileUploadWorkbook({
        periodId: selectedPeriodId,
        periodLabel: periods.find((p) => p.id === selectedPeriodId)?.name ?? null,
      });
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
      const result = await downloadMatchingUploadWorkbook({
        periodId: selectedPeriodId,
        periodLabel: periods.find((p) => p.id === selectedPeriodId)?.name ?? null,
      });
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

    if (!(await ensureUploadPeriod())) return;
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

    if (!(await ensureUploadPeriod())) return;
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
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={openOrgFileDialog}
              disabled={isImportingOrg}
              title="조직구조 엑셀(법인·본부·부·팀 T-Level 트리)을 올리면 부서코드로 상위조직을 자동 매칭합니다."
            >
              {isImportingOrg ? '업로드 중' : '조직정보 업로드'}
            </button>
            <input
              ref={orgFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={importOrgStructureFile}
              style={{ display: 'none' }}
            />
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={openOrgHistory}
              title="평가기간별 조직정보 업로드 이력(업로드 일자·부서수)을 봅니다."
            >
              조직정보 이력
            </button>
            <button
              className="sd-btn sd-btn-outline sd-btn-sm"
              onClick={openContribFileDialog}
              disabled={isImportingContribution}
              title="기여도 평가 엑셀을 올리면 그 기간 평가에 과업·점수와 부서 상위조직을 매핑합니다(미리보기 후 적용)."
            >
              {isImportingContribution ? '업로드 중' : '기여도 업로드'}
            </button>
            <input
              ref={contribFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={importContributionFile}
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

            <OrgChecklist items={orgRosterFields} value={orgNodeKeys} onChange={setOrgNodeKeys} />

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

      <div style={{ padding: '24px 32px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 매칭 무결성 경고(구 매칭 정합성 점검 흡수) — 이상 0건이면 자동 숨김 */}
        <MatchingIntegrityBanner />

        {!isCurrentOrgPeriod && (
          <div
            className="sd-card"
            style={{ padding: '12px 16px', background: 'var(--ok-orange-50)', color: 'var(--ok-brown)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
          >
            현재(기본) 평가기간이 아닌 다른 기간을 보고 있습니다. 표시·검색·필터는 이 기간 기준이며,
            <strong> 조직(법인/본부/부/팀) 인라인 편집은 현재(기본) 기간에서만</strong> 가능합니다(다른 기간 조직은 조직정보 업로드로 관리).
          </div>
        )}

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
                  {bulkActionRunning ? (bulkProgress ? `처리 중 ${bulkProgress.done}/${bulkProgress.total}` : '처리 중') : '적용'}
                </button>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  onClick={handleBulkDelete}
                  disabled={bulkActionRunning}
                  style={{ color: 'var(--danger, #B91C1C)' }}
                >
                  {bulkActionRunning ? (bulkProgress ? `처리 중 ${bulkProgress.done}/${bulkProgress.total}` : '처리 중') : '선택 삭제'}
                </button>
                {bulkActionRunning ? (
                  <button
                    className="sd-btn sd-btn-outline sd-btn-sm"
                    onClick={() => {
                      bulkAbortRef.current = true;
                    }}
                    title="남은 처리를 멈춥니다. 이미 처리된 건은 유지됩니다."
                    style={{ color: 'var(--danger, #B91C1C)' }}
                  >
                    중단
                  </button>
                ) : (
                  <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={clearSelection}>
                    선택 해제
                  </button>
                )}
              </div>
            </div>
          )}

          {isLoading && !isInitialLoading && (
            <div style={{ padding: '4px 10px', fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>갱신 중…</div>
          )}
          {isInitialLoading ? (
            <div style={{ display: 'grid', gap: 8, padding: 8 }} aria-busy="true" aria-label="직원 목록 불러오는 중">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} style={{ height: 40, background: 'var(--bg-muted)' }} />
              ))}
            </div>
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
                  <SortableTh label="사번" sortKey="employee_id" sort={sortConfig} onSort={toggleSort} style={{ width: 96 }} />
                  <SortableTh label="이름" sortKey="name" sort={sortConfig} onSort={toggleSort} style={{ width: 130 }} />
                  <TableHead style={{ width: 110, whiteSpace: 'nowrap' }}>직책</TableHead>
                  <TableHead style={{ width: 80, whiteSpace: 'nowrap' }}>법인</TableHead>
                  <TableHead style={{ width: 140, whiteSpace: 'nowrap' }}>본부</TableHead>
                  <TableHead style={{ width: 140, whiteSpace: 'nowrap' }}>부</TableHead>
                  <TableHead style={{ width: 140, whiteSpace: 'nowrap' }}>팀</TableHead>
                  <TableHead style={{ width: 110, whiteSpace: 'nowrap' }}>직무</TableHead>
                  <SortableTh label="레벨" sortKey="growth_level" sort={sortConfig} onSort={toggleSort} style={{ width: 92 }} />
                  <TableHead style={{ width: 220 }}>역할</TableHead>
                  <TableHead style={{ width: 140 }}>평가자</TableHead>
                  <SortableTh label="평가 상태" sortKey="status" sort={sortConfig} onSort={toggleSort} style={{ width: 110 }} />
                  <TableHead className="text-right" style={{ minWidth: 140, position: 'sticky', right: 0, background: 'var(--bg-muted)', zIndex: 2, borderLeft: '1px solid var(--border)' }}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedEmployees.map((employee, index) => {
                  const record = recordMap.get(employee.employee_id);
                  const evaluation = record?.evaluation;
                  // 평가자 컬럼: 선택 평가기간의 평가자 우선, 없으면 master 평가자 폴백.
                  const periodEvaluatorId = evaluation?.evaluator_id ?? null;
                  const evaluatorName = periodEvaluatorId
                    ? (evaluation?.evaluator_name ?? employeeMap.get(periodEvaluatorId)?.name ?? periodEvaluatorId)
                    : employee.evaluator_id
                      ? (employeeMap.get(employee.evaluator_id)?.name ?? employee.evaluator_id)
                      : '-';
                  const { key: groupKey, showHeader: showGroupHeader, count: groupCount } =
                    pageGroupRows[index];
                  const isRowEditing = editingEmployeeId === employee.employee_id;
                  return (
                    <Fragment key={employee.id}>
                      {showGroupHeader && <GroupHeaderRow groupKey={groupKey} count={groupCount} />}
                      <UserRow
                        employee={employee}
                        evaluation={evaluation}
                        evaluatorName={evaluatorName}
                        isSelected={selectedIds.has(employee.employee_id)}
                        isEditing={isRowEditing && Boolean(editForm)}
                        isSaving={savingEmployeeId === employee.employee_id}
                        isDeleting={deletingEmployeeId === employee.employee_id}
                        isCurrentOrgPeriod={isCurrentOrgPeriod}
                        editForm={isRowEditing ? editForm : null}
                        onToggleSelect={onRowToggleSelect}
                        onStartEdit={onRowStartEdit}
                        onCancelEdit={onRowCancelEdit}
                        onSaveEdit={onRowSaveEdit}
                        onUpdateEditForm={onRowUpdateEditForm}
                        onToggleEditRole={onRowToggleEditRole}
                        onDelete={onRowDelete}
                        onOpenHistory={onRowOpenHistory}
                        onOpenEvaluation={onRowOpenEvaluation}
                      />
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

          {!isInitialLoading && !error && totalFiltered > 0 && (
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
          employeeEvaluations={evaluationsByEmployee[`${historyModalEmployeeId}::${selectedPeriodId ?? ''}`] ?? []}
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

      {bulkResult && (
        <Dialog open onOpenChange={(open) => { if (!open) setBulkResult(null); }}>
          <DialogContent style={{ maxWidth: 'min(540px, 92vw)' }}>
            <DialogHeader>
              <DialogTitle>{bulkResult.action} 결과</DialogTitle>
              <DialogDescription>
                전체 {bulkResult.total}명 · 성공 {bulkResult.success}명
                {typeof bulkResult.skipped === 'number' && bulkResult.skipped > 0
                  ? ` · 동일(건너뜀) ${bulkResult.skipped}명`
                  : ''}
                {` · 실패 ${bulkResult.failed.length}명`}
              </DialogDescription>
            </DialogHeader>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {bulkResult.failed.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--danger-bg)',
                    border: '1px solid var(--danger-bg)',
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  <strong style={{ whiteSpace: 'nowrap' }}>
                    {f.name}{' '}
                    <span style={{ color: 'var(--fg-muted)', fontFamily: 'monospace', fontWeight: 400 }}>{f.id}</span>
                  </strong>
                  <span style={{ color: 'var(--danger)', textAlign: 'right' }}>{f.reason}</span>
                </div>
              ))}
            </div>
            <DialogFooter>
              <button className="sd-btn sd-btn-primary sd-btn-sm" onClick={() => setBulkResult(null)}>
                확인
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

      {contribPreview && (
        <Dialog open onOpenChange={(open) => { if (!open && !isApplyingContrib) setContribPreview(null); }}>
          <DialogContent style={{ maxWidth: 'min(460px, 92vw)' }}>
            <DialogHeader>
              <DialogTitle>기여도 업로드 미리보기</DialogTitle>
              <DialogDescription>
                {contribPreview.fileName} · {contribPreview.preview.period_name}
              </DialogDescription>
            </DialogHeader>
            <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
              {[
                ['매칭된 평가', `${contribPreview.preview.matched_evaluations} / 그룹 ${contribPreview.preview.total_groups}`],
                ['적재할 과업', `${contribPreview.preview.tasks_total}개 (점수 ${contribPreview.preview.scored_total})`],
                ['기간 org 매핑', `${contribPreview.preview.org_mapped}건 (미매핑 ${contribPreview.preview.org_unmapped})`],
                ['건너뛸 그룹(평가 없음)', `${contribPreview.preview.unmatched_count}건`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--fg-muted)' }}>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            {contribPreview.preview.unmatched_count > 0 && (
              <p style={{ fontSize: 12, color: 'var(--warning, #b45309)', margin: 0 }}>
                평가가 없는 그룹은 건너뜁니다. 먼저 ‘대상자/매칭 업로드’로 그 기간 평가를 만들어 주세요.
              </p>
            )}
            <DialogFooter>
              <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={() => setContribPreview(null)} disabled={isApplyingContrib}>
                취소
              </button>
              <button
                className="sd-btn sd-btn-primary sd-btn-sm"
                onClick={applyContribution}
                disabled={isApplyingContrib || contribPreview.preview.matched_evaluations === 0}
              >
                {isApplyingContrib ? '적용 중…' : `적용 (${contribPreview.preview.matched_evaluations}건)`}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {pendingOrgUpload && (
        <Dialog open onOpenChange={(open) => { if (!open && !isApplyingOrg) setPendingOrgUpload(null); }}>
          <DialogContent style={{ maxWidth: 'min(460px, 92vw)' }}>
            <DialogHeader>
              <DialogTitle>조직정보 업로드</DialogTitle>
              <DialogDescription>
                {pendingOrgUpload.fileName} · 부서 {pendingOrgUpload.rows.length}개
              </DialogDescription>
            </DialogHeader>
            <div>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
                이 조직구조는 <strong>어느 평가기간</strong> 기준인가요?
              </label>
              <select
                className="sd-input"
                value={orgUploadPeriodId ?? ''}
                onChange={(e) => setOrgUploadPeriodId(e.target.value || null)}
                style={{ width: '100%', marginBottom: 8 }}
              >
                <option value="" disabled>평가기간 선택…</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.id === selectedPeriodId ? ' (현재 선택)' : ''}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: 'var(--fg-subtle, #888)', margin: 0 }}>
                활성(기본) 평가기간이면 직원의 현재 상위조직도 함께 갱신됩니다. 그 외 기간이면 그 기간 스냅샷만 저장합니다.
              </p>
            </div>
            <DialogFooter>
              <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={() => setPendingOrgUpload(null)} disabled={isApplyingOrg}>
                취소
              </button>
              <button
                className="sd-btn sd-btn-primary sd-btn-sm"
                onClick={applyOrgUpload}
                disabled={isApplyingOrg || !orgUploadPeriodId}
              >
                {isApplyingOrg ? '적용 중…' : '적용'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 조직정보 업로드 이력 — 평가기간별 스냅샷(업로드 일자·부서수·법인수) */}
      {orgHistoryOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) setOrgHistoryOpen(false); }}>
          <DialogContent style={{ maxWidth: 'min(720px, 96vw)', maxHeight: '85vh', overflow: 'auto' }}>
            <DialogHeader>
              <DialogTitle>조직정보 업로드 이력</DialogTitle>
              <DialogDescription>
                평가기간별로 마지막에 업로드된 조직구조 스냅샷입니다. (같은 기간 재업로드 시 교체됨)
              </DialogDescription>
            </DialogHeader>
            <div>
              {orgHistoryLoading ? (
                <div style={{ padding: 20, color: 'var(--fg-muted)' }}>불러오는 중…</div>
              ) : !orgHistory || orgHistory.length === 0 ? (
                <div style={{ padding: 20, color: 'var(--fg-muted)' }}>업로드된 조직정보가 없습니다.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 10px' }}>평가기간</th>
                      <th style={{ padding: '8px 10px' }}>스냅샷(파일)</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>부서</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>법인</th>
                      <th style={{ padding: '8px 10px' }}>업로드 일자</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>다운로드</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgHistory.map((h, i) => (
                      <tr key={`${h.evaluation_period_id ?? 'none'}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                          {h.period_name ?? '(기간 미지정)'}
                          {h.evaluation_year ? <span style={{ color: 'var(--fg-subtle)', fontWeight: 400 }}> · {h.evaluation_year}</span> : null}
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--fg-muted)' }}>{h.source_label ?? '-'}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }} className="tnum">{h.node_count}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }} className="tnum">{h.corp_count}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--fg-muted)' }}>
                          {h.uploaded_at ? new Date(h.uploaded_at).toLocaleString('ko-KR') : '-'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          <button
                            className="sd-btn sd-btn-outline sd-btn-sm"
                            onClick={() => downloadOrgPeriod(h)}
                            disabled={orgDownloadingKey === (h.evaluation_period_id ?? 'none')}
                          >
                            {orgDownloadingKey === (h.evaluation_period_id ?? 'none') ? '내려받는 중…' : '엑셀'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default HrUsersPage;
