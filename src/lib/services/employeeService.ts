import { apiFetch } from '@/lib/api';
import { Employee, EvaluatorAssignmentHistory } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

type EmployeeUpdatePayload = Partial<Employee> & {
  changed_by?: string | null;
  changedBy?: string | null;
  assignment_change_reason?: string | null;
  change_reason?: string | null;
  reason?: string | null;
};

type AssignmentActionPayload = {
  changed_by?: string | null;
  changedBy?: string | null;
  actor_id?: string | null;
  actorId?: string | null;
  reason?: string | null;
  cancel_reason?: string | null;
};

type EvaluatorEditPayload = {
  evaluator_id?: string | null;
  evaluatorId?: string | null;
  changed_by?: string | null;
  changedBy?: string | null;
  actor_id?: string | null;
  actorId?: string | null;
  reason?: string | null;
};

export type MatchingImportRowInput = {
  row_number: number;
  employee_id: string;
  employee_name: string;
  org_sequence?: string | null;
  department_id?: string | null;
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
  transferred_entries: number;
  merged_entries: number;
  transferred_feedbacks: number;
  reconciled_histories: number;
  created_evaluations?: number;
  cancelled_evaluations?: number;
  cancelled_entries?: number;
  cancelled_feedbacks?: number;
};

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

  async getFormerEvaluateesByEvaluator(evaluatorId: string): Promise<Employee[]> {
    try {
      return await apiFetch<Employee[]>(`/api/employees/former-evaluator/${evaluatorId}`);
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

  // 개인별 매칭결과 엑셀 업로드 반영
  async importMatchingRows(payload: {
    source_file_name: string;
    source_sheet_name?: string | null;
    changed_by?: string | null;
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

  // 새로운 직원 생성 (평가 자동 생성)
  async createEmployee(
    newEmployee: Partial<Employee>
  ): Promise<{ employee: Employee; evaluationId: string }> {
    try {
      // 1. 직원 레코드 생성
      const employee = await apiFetch<Employee>('/api/employees', {
        method: 'POST',
        body: JSON.stringify(newEmployee),
        headers: { 'Content-Type': 'application/json' },
      });
 
      // 2. 트리거에 의해 자동 생성된 평가 레코드 조회
      // (예시 엔드포인트: /api/evaluations/by-employee/:employeeId)
      const evalResult = await apiFetch<{ id: string }>(`/api/evaluations/by-employee/${employee.employee_id}`);
 
      return { employee, evaluationId: evalResult.id };
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

  // 직원 ID로 해당 평가 조회 (자동 생성된 평가가 존재함)
  async editEvaluator(
    employeeId: string,
    payload: EvaluatorEditPayload,
  ): Promise<{
    employee: Employee;
    transferred_entries: number;
    merged_entries: number;
    transferred_feedbacks: number;
    reconciled_histories: number;
  }> {
    try {
      return await apiFetch<{
        employee: Employee;
        transferred_entries: number;
        merged_entries: number;
        transferred_feedbacks: number;
        reconciled_histories: number;
      }>(`/api/employee/${employeeId}/evaluator-edit`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getEvaluationByEmployeeId(employeeId: string): Promise<{ id: string }> {
    try {
      // 엔드포인트는 /api/evaluations/by-employee/:employeeId 로 가정
      return await apiFetch<{ id: string }>(`/api/evaluations/by-employee/${employeeId}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
