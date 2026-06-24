import { apiFetch } from '@/lib/api';
import { Employee, EvaluatorAssignmentHistory } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';
import type { DiffResult } from '@/lib/uploadDiff';

export type MatchingPreviewResult = DiffResult;

export type OrgStructureImport = {
  evaluation_period_id: string | null;
  period_name: string | null;
  evaluation_year: number | null;
  source_label: string | null;
  node_count: number;
  corp_count: number;
  uploaded_at: string | null;
};

export type OrgStructureRowData = {
  dept_code: string;
  dept_name: string | null;
  org_corporation: string | null;
  org_division: string | null;
  org_department: string | null;
  org_team: string | null;
  t_level: number | null;
  kind: string | null;
};

type EmployeeUpdatePayload = Partial<Employee> & {
  changed_by?: string | null;
  changedBy?: string | null;
  changed_at?: string | null;
  changedAt?: string | null;
  evaluation_period_id?: string | null;
  evaluationPeriodId?: string | null;
  assignment_change_reason?: string | null;
  change_reason?: string | null;
  reason?: string | null;
};

type AssignmentActionPayload = {
  changed_by?: string | null;
  changedBy?: string | null;
  actor_id?: string | null;
  actorId?: string | null;
  changed_at?: string | null;
  changedAt?: string | null;
  evaluation_period_id?: string | null;
  evaluationPeriodId?: string | null;
  reason?: string | null;
  cancel_reason?: string | null;
};


type EvaluatorCorrectPayload = {
  new_evaluator_id?: string | null;
  newEvaluatorId?: string | null;
  changed_by?: string | null;
  changedBy?: string | null;
  actor_id?: string | null;
  actorId?: string | null;
  changed_at?: string | null;
  changedAt?: string | null;
  evaluation_period_id?: string | null;
  evaluationPeriodId?: string | null;
  reason?: string | null;
};

export type MatchingImportRowInput = {
  row_number: number;
  employee_id: string;
  employee_name: string;
  org_sequence?: string | null;
  department_id?: string | null;
  org_corporation?: string | null;
  org_division?: string | null;
  org_department?: string | null;
  org_team?: string | null;
  department_name?: string | null;
  work_start_date?: string | null;
  work_end_date?: string | null;
  evaluator_id?: string | null;
  evaluator_name?: string | null;
  confirmer_id?: string | null;
  confirmer_name?: string | null;
  evaluation_type?: string | null;
  matching_result?: string | null;
  raw_data?: Record<string, unknown>;
};

export type MatchingImportStoredRow = MatchingImportRowInput & {
  id: string;
  batch_id: string;
  source_file_name?: string | null;
  source_sheet_name?: string | null;
  imported_at?: string | null;
  created_at?: string | null;
  is_primary?: boolean;
  validation_status?: string | null;
  validation_message?: string | null;
};

export type MatchingImportResult = {
  batch: {
    id: string;
    source_file_name: string;
    source_sheet_name: string | null;
    row_count: number;
    applied_count: number;
    warning_count: number;
    error_count: number;
    created_at: string;
  };
  row_count: number;
  applied_count: number;
  evaluator_count: number;
  changed_evaluator_count: number;
  warning_count: number;
  error_count: number;
  created_evaluations?: number;
  cancelled_evaluations?: number;
  cancelled_entries?: number;
  cancelled_feedbacks?: number;
  assignment_history_count?: number;
  baseline_assignment_history_count?: number;
  historical_tours_created?: number;
  stale_drafts_cancelled?: number;
};

export type EmployeeProfileImportRowInput = {
  sheet_name: string;
  row_number: number;
  evaluation_group?: string | null;
  employee_id: string;
  employee_name: string;
  org_sequence?: string | null;
  department_id?: string | null;
  org_corporation?: string | null;
  org_division?: string | null;
  org_department?: string | null;
  org_team?: string | null;
  department_name?: string | null;
  work_start_date?: string | null;
  work_end_date?: string | null;
  growth_level_label?: string | null;
  position?: string | null;
  job_role?: string | null;
  evaluator_id?: string | null;
  evaluator_name?: string | null;
  evaluator_position?: string | null;
  target_status?: string | null;
  available_roles?: string[];
  raw_data?: Record<string, unknown>;
};

export type EmployeeProfileImportStoredRow = EmployeeProfileImportRowInput & {
  id: string;
  batch_id: string;
  source_file_name?: string | null;
  imported_at?: string | null;
  created_at?: string | null;
  evaluation_group_id?: string | null;
  evaluation_group_name?: string | null;
  growth_level?: number | null;
  validation_status?: string | null;
  validation_message?: string | null;
  is_primary?: boolean;
};

export type EmployeeProfileImportResult = {
  batch: {
    id: string;
    source_file_name: string;
    source_sheet_names: string[];
    row_count: number;
    applied_count: number;
    warning_count: number;
    error_count: number;
    created_at: string;
  };
  row_count: number;
  applied_count: number;
  evaluator_count: number;
  warning_count: number;
  error_count: number;
};

export interface ContributionImportRow {
  sabun: string;
  so?: string;
  evaluatorId?: string;
  deptCode?: string;
  title?: string;
  weight?: number;
  score?: number | string | null;
  method?: string;
  scope?: string;
  description?: string;
  remark?: string;
  startDate?: string;
  endDate?: string;
}

export interface ContributionPreviewResult {
  period_id: string;
  period_name: string;
  total_groups: number;
  matched_evaluations: number;
  unmatched_count: number;
  unmatched_sample: { sabun: string; so: string }[];
  tasks_total: number;
  scored_total: number;
  org_mapped: number;
  org_unmapped: number;
}

export interface ContributionImportResult {
  period_id: string;
  applied_evaluations: number;
  tasks_inserted: number;
  scored: number;
  org_updated: number;
  skipped_groups: number;
}

export const employeeService = {
  // 모든 직원 조회
  async getAllEmployees(): Promise<Employee[]> {
    try {
      return await apiFetch<Employee[]>('/api/employees');
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 직원 ID로 직접 DB 조회
  async getEmployeeById(employeeId: string): Promise<Employee | null> {
    try {
      return await apiFetch<Employee>(`/api/employee/${employeeId}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가자 ID로 피평가자들 조회
  async getEvaluateesByEvaluator(evaluatorId: string): Promise<Employee[]> {
    try {
      return await apiFetch<Employee[]>(`/api/employees/evaluator/${evaluatorId}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getFormerEvaluateesByEvaluator(evaluatorId: string, periodId?: string | null): Promise<Employee[]> {
    try {
      // periodId 지정 시 해당 평가기간의 전보(이전 담당)만 — 타 연도 이력이 섞이지 않게.
      const qs = periodId ? `?periodId=${encodeURIComponent(periodId)}` : '';
      return await apiFetch<Employee[]>(`/api/employees/former-evaluator/${evaluatorId}${qs}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 부서별 직원 조회
  async getEmployeesByDepartment(department: string): Promise<Employee[]> {
    try {
      return await apiFetch<Employee[]>(`/api/employees/department/${department}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getLatestEmployeeProfileImportRows(
    periodId?: string | null,
  ): Promise<EmployeeProfileImportStoredRow[]> {
    try {
      const qs = periodId ? `?periodId=${encodeURIComponent(periodId)}` : '';
      return await apiFetch<EmployeeProfileImportStoredRow[]>(
        `/api/employee-profile-imports/latest-rows${qs}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가대상자 엑셀 업로드 반영
  async getLatestMatchingImportRows(
    periodId?: string | null,
  ): Promise<MatchingImportStoredRow[]> {
    try {
      const qs = periodId ? `?periodId=${encodeURIComponent(periodId)}` : '';
      return await apiFetch<MatchingImportStoredRow[]>(
        `/api/matching-imports/latest-rows${qs}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async importEmployeeProfiles(payload: {
    source_file_name: string;
    changed_by?: string | null;
    evaluation_period_id?: string | null;
    rows: EmployeeProfileImportRowInput[];
  }): Promise<EmployeeProfileImportResult> {
    try {
      return await apiFetch<EmployeeProfileImportResult>('/api/employee-profile-imports', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 개인별 매칭결과 엑셀 업로드 반영
  async importMatchingRows(payload: {
    source_file_name: string;
    source_sheet_name?: string | null;
    changed_by?: string | null;
    evaluation_period_id?: string | null;
    rows: MatchingImportRowInput[];
  }): Promise<MatchingImportResult> {
    try {
      return await apiFetch<MatchingImportResult>('/api/matching-imports', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 매칭 업로드 변경 미리보기(dry-run): 적용 전 신규/변경/정정/무시/삭제 분류만 받아온다.
  async previewMatchingRows(payload: {
    rows: MatchingImportRowInput[];
  }): Promise<MatchingPreviewResult> {
    try {
      return await apiFetch<MatchingPreviewResult>('/api/matching-imports/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 조직정보(부서코드→4단계 조직) 엑셀 업로드 → org_structure 보존 + employees.org_* 자동 매칭.
  async importOrgStructure(payload: {
    rows: { code: string; name: string; level: number; kind: string }[];
    periodId: string | null;
    sourceLabel?: string | null;
  }): Promise<{
    period_id: string;
    period_name: string;
    is_default_period: boolean;
    node_count: number;
    employees_updated: number;
    unmatched_corps: string[];
  }> {
    try {
      return await apiFetch('/api/admin/org-structure', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 조직정보 업로드 이력 — 평가기간별 스냅샷(업로드 일자·부서수·법인수).
  async getOrgStructureImports(): Promise<OrgStructureImport[]> {
    try {
      return await apiFetch<OrgStructureImport[]>('/api/admin/org-structure/imports');
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 특정 평가기간의 조직정보 스냅샷 행 — 이력에서 엑셀 다운로드용.
  async getOrgStructureRows(periodId: string | null): Promise<OrgStructureRowData[]> {
    const qs = periodId ? `?periodId=${encodeURIComponent(periodId)}` : '';
    try {
      return await apiFetch<OrgStructureRowData[]>(`/api/admin/org-structure/rows${qs}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 기여도 평가 엑셀 업로드 — 그 기간 평가에 과업·점수 + 기간 org 매핑. 미리보기(dry-run).
  async previewContributionRows(payload: {
    periodId?: string | null;
    rows: ContributionImportRow[];
  }): Promise<ContributionPreviewResult> {
    try {
      return await apiFetch('/api/contribution-imports/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 기여도 평가 엑셀 업로드 적용 — 매칭된 평가의 과업 교체 + 점수 + 기간 org.
  async importContributionRows(payload: {
    periodId?: string | null;
    rows: ContributionImportRow[];
  }): Promise<ContributionImportResult> {
    try {
      return await apiFetch('/api/contribution-imports', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 새로운 직원 생성. evaluation_period_id 를 주면 그 평가기간 기준으로 evaluation 을 맞춘다.
  async createEmployee(
    newEmployee: Partial<Employee> & { evaluation_period_id?: string | null },
  ): Promise<Employee> {
    try {
      return await apiFetch<Employee>('/api/employees', {
        method: 'POST',
        body: JSON.stringify(newEmployee),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 단건 직원 삭제 (admin 제외, 관련 데이터 cascade)
  async deleteEmployee(employeeId: string): Promise<void> {
    try {
      await apiFetch(`/api/employee/${employeeId}`, { method: 'DELETE' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
 
  // 직원 정보 업데이트
  async updateEmployee(
    employeeId: string,
    updates: EmployeeUpdatePayload
  ): Promise<Employee> {
    try {
      return await apiFetch<Employee>(`/api/employee/${employeeId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getEvaluatorAssignmentHistory(employeeId: string): Promise<EvaluatorAssignmentHistory[]> {
    try {
      return await apiFetch<EvaluatorAssignmentHistory[]>(
        `/api/evaluator-assignment-history/employee/${employeeId}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async cancelEvaluatorAssignment(
    historyId: string,
    payload: AssignmentActionPayload = {},
  ): Promise<{
    cancelled: EvaluatorAssignmentHistory;
    employee: Employee | null;
    cancelled_entries: number;
  }> {
    try {
      return await apiFetch<{
        cancelled: EvaluatorAssignmentHistory;
        employee: Employee | null;
        cancelled_entries: number;
      }>(`/api/evaluator-assignment-history/${historyId}/cancel`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 대상자 일괄삭제: admin 외 모든 employees + 그들에 딸린 평가·과업·이력·임포트 데이터 제거.
  async resetEmployees(payload: {
    actor_id?: string | null;
    actorId?: string | null;
  }): Promise<{ ok: boolean; deleted_employees: number; message: string }> {
    try {
      return await apiFetch<{
        ok: boolean;
        deleted_employees: number;
        message: string;
      }>('/api/admin/reset/employees', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 매칭정보 일괄삭제: employees 는 유지, 매칭 임포트로 들어온 평가자 배정·평가건·이력만 비움.
  async resetMatching(payload: {
    actor_id?: string | null;
    actorId?: string | null;
  }): Promise<{ ok: boolean; cleared_employees: number; message: string }> {
    try {
      return await apiFetch<{
        ok: boolean;
        cleared_employees: number;
        message: string;
      }>('/api/admin/reset/matching', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가기간별 초기화: 선택한 평가기간에 묶인 평가·과업·매칭·조직정보만 삭제. 직원 명부는 유지.
  async resetPeriod(payload: {
    evaluation_period_id: string;
    actor_id?: string | null;
  }): Promise<{ ok: boolean; period_code: string; deleted_evaluations: number; message: string }> {
    try {
      return await apiFetch<{
        ok: boolean;
        period_code: string;
        deleted_evaluations: number;
        message: string;
      }>('/api/admin/reset/period', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 임의의 applied 변경 이력을 "정정" — 원본을 cancelled 처리하고
  // supersedes_history_id 로 원본을 가리키는 새 change 행을 만든다.
  // 대상이 현재 반영된 배정일 때만 employee.evaluator_id + 하위 데이터가 함께 정합화된다.
  async correctEvaluatorAssignment(
    historyId: string,
    payload: EvaluatorCorrectPayload,
  ): Promise<{
    correction: EvaluatorAssignmentHistory;
    employee: Employee | null;
    is_current_assignment: boolean;
    transferred_entries: number;
    merged_entries: number;
    transferred_feedbacks: number;
  }> {
    try {
      return await apiFetch<{
        correction: EvaluatorAssignmentHistory;
        employee: Employee | null;
        is_current_assignment: boolean;
        transferred_entries: number;
        merged_entries: number;
        transferred_feedbacks: number;
      }>(`/api/evaluator-assignment-history/${historyId}/correct`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 직원 ID로 해당 평가 조회 (자동 생성된 평가가 존재함)
  // (제거됨) editEvaluator — evaluator-edit 엔드포인트 폐기에 따라 삭제(UI 미사용·cross-period transfer 위험).

  async getEvaluationByEmployeeId(employeeId: string): Promise<{ id: string }> {
    try {
      // 엔드포인트는 /api/evaluations/by-employee/:employeeId 로 가정
      return await apiFetch<{ id: string }>(`/api/evaluations/by-employee/${employeeId}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
