// 기본 타입 정의
export type UserRole = 'hr' | 'evaluator' | 'evaluatee';
export type EvaluationStatus =
  | 'draft'
  | 'submitted'
  | 'evaluating'
  | 'completed'
  | 'locked'
  | 'in-progress';
export type EvaluationPeriodStatus = 'draft' | 'active' | 'closed' | 'locked';
export type NotificationPriority = 'low' | 'medium' | 'high';

// 사용자 관련 타입
export interface User {
  id: string;
  employeeId: string;
  name: string;
  role: UserRole;
  department: string;
  position?: string;
  growthLevel: number;
  evaluatorId?: string;
  availableRoles?: UserRole[];
  /** HR이 지정한 'AI 과업 50% 규칙' 면제 여부. true 면 성과보고 제출 시 비중 검사 생략. */
  aiRuleExempt?: boolean;
}

// 직원 관련 타입
export interface Employee {
  id: string;
  employee_id: string;
  name: string;
  position: string;
  department: string;
  department_id?: string | null;
  // 4단계 조직 계층 (법인 > 본부 > 부 > 팀). 업로드 양식 기준 현재 소속.
  org_corporation?: string | null;
  org_division?: string | null;
  org_department?: string | null;
  org_team?: string | null;
  growth_level: number | null;
  evaluator_id: string | null;
  available_roles: string[];
  org_sequence?: string | null;
  work_start_date?: string | null;
  work_end_date?: string | null;
  /** HR이 지정한 'AI 과업 50% 규칙' 면제 여부. */
  ai_rule_exempt?: boolean | null;
  evaluation_type?: string | null;
  matching_result?: string | null;
  confirmer_id?: string | null;
  confirmer_name?: string | null;
  last_matching_batch_id?: string | null;
  evaluation_group_id?: string | null;
  evaluation_group_name?: string | null;
  job_role?: string | null;
  target_status?: string | null;
  last_profile_batch_id?: string | null;
  assigned_period_start?: string | null;
  assigned_period_end?: string | null;
  /** 어떤 평가기간에라도 active evaluation 이 있는지 (사용자 관리 화면 필터용) */
  has_any_evaluation?: boolean;
  created_at: string;
  updated_at: string;
}

export type EvaluatorAssignmentChangeType = 'change' | 'cancel';
export type EvaluatorAssignmentStatus = 'applied' | 'cancelled';

export interface EvaluatorAssignmentHistory {
  id: string;
  employee_id: string;
  previous_evaluator_id: string | null;
  new_evaluator_id: string | null;
  evaluation_id: string | null;
  evaluation_period_id: string | null;
  change_type: EvaluatorAssignmentChangeType;
  status: EvaluatorAssignmentStatus;
  reason: string | null;
  changed_at: string;
  changed_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  supersedes_history_id: string | null;
  previous_evaluator_name?: string | null;
  new_evaluator_name?: string | null;
  changed_by_name?: string | null;
  cancelled_by_name?: string | null;
  evaluation_period_name?: string | null;
  evaluation_year?: number | null;
  /** 이 단계에 연결된 평가행의 조직 스냅샷(발령 전후 부서가 단계마다 다름) — 서버 JOIN 파생. */
  stage_dept_code?: string | null;
  stage_department?: string | null;
}

// 평가자 변경요청·승인
export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ChangeRequestRole = 'evaluator' | 'evaluatee';

export interface EvaluatorChangeRequest {
  id: string;
  evaluatee_id: string;
  evaluatee_name: string | null;
  current_evaluator_id: string | null;
  current_evaluator_name: string | null;
  requested_evaluator_id: string | null;
  requested_evaluator_name: string | null;
  evaluation_period_id: string | null;
  target_history_id: string | null;
  segment_start_date: string | null;
  segment_end_date: string | null;
  requested_by: string;
  requester_role: ChangeRequestRole;
  reason: string | null;
  status: ChangeRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  applied_history_id: string | null;
  created_at: string;
  updated_at: string;
  // 조인 표시용
  requested_by_name?: string | null;
  evaluatee_department?: string | null;
  evaluation_period_name?: string | null;
  evaluation_year?: number | null;
}

// 평가자 AI 도움말(문의) 이력
export interface EvaluatorQnaLog {
  id: string;
  user_id: string;
  user_name: string | null;
  user_department: string | null;
  user_role: string | null;
  question: string;
  answer: string | null;
  is_error: boolean;
  created_at: string;
}

// 평가 관련 타입
export interface EvaluationPeriod {
  id: string;
  code: string;
  name: string;
  evaluation_year: number;
  starts_on: string | null;
  ends_on: string | null;
  status: EvaluationPeriodStatus;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Evaluation {
  id: string;
  evaluatee_id: string;
  evaluatee_name: string;
  evaluatee_position: string;
  evaluatee_department: string;
  // 그 평가 기간의 부서코드·상위조직 (Option B — db_mig/backfill_period_org.cjs).
  // 그룹핑/필터를 현재 employee.org_* 대신 그 기간 기준으로 정확화하기 위함.
  evaluatee_dept_code?: string | null;
  evaluatee_org_corporation?: string | null;
  evaluatee_org_division?: string | null;
  evaluatee_org_department?: string | null;
  evaluatee_org_team?: string | null;
  growth_level: number;
  evaluation_status: EvaluationStatus;
  /** 연도 컬럼 – 평가와 연동되는 연도 */
  evaluation_year?: number;
  evaluation_period_id?: string | null;
  assignment_history_id?: string | null;
  record_status?: 'active' | 'cancelled';
  evaluator_id?: string | null;
  evaluator_name?: string | null;
  evaluator_position?: string | null;
  evaluator_department?: string | null;
  evaluator_assigned_at?: string | null;
  last_modified: string;
  /** 상태 전이 시각(#4) — 칸반 진입/성과보고 시점 계산용. */
  submitted_at?: string | null;
  returned_at?: string | null;
  reverted_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

// 과업 관련 타입
export interface Task {
  id: string;
  task_id: string;
  evaluation_id: string;
  /** 연도 컬럼 – 평가와 연동되는 연도 */
  evaluation_year?: number;
  evaluation_period_id?: string | null;
  title: string;
  description: string | null;
  weight: number;
  start_date: string | null;
  end_date: string | null;
  contribution_method: string | null;
  contribution_scope: string | null;
  score: number | null;
  feedback: string | null;
  feedback_date: string | null;
  evaluator_name: string | null;
  deleted_at: string | null;
  /** 피평가자가 'AI 과업'으로 표시한 과업 여부(AI 과업 50% 규칙 집계 대상). */
  is_ai_task?: boolean | null;
}

export interface TaskEvaluationEntry {
  id: string;
  task_uuid: string;
  task_id: string;
  evaluation_id: string;
  evaluator_id: string;
  evaluator_name: string;
  assignment_history_id?: string | null;
  status?: 'active' | 'cancelled';
  contribution_method: string | null;
  contribution_scope: string | null;
  score: number | null;
  feedback: string | null;
  feedback_date: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  // 저장 시점 1차 AI 검수 결과(항목당 최신 1건). flagged=false 면 '이상없음', summary/type 는 flagged 일 때만 채워짐.
  ai_flagged?: boolean | null;
  ai_summary?: string | null;
  ai_type?: string | null;
  ai_reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

// 피드백 히스토리 타입
export interface FeedbackHistory {
  id: string;
  task_id: string;
  task_uuid?: string | null;
  evaluation_id?: string | null;
  evaluator_id?: string | null;
  task_evaluation_entry_id?: string | null;
  content: string;
  evaluator_name: string | null;
  status?: 'active' | 'cancelled';
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  created_at: string;
}

// 알림 관련 타입
export interface Notification {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
  related_evaluation_id: string | null;
  related_task_id: string | null;
  is_read: boolean;
  created_at: string;
}

// 설정 관련 타입
export interface Setting {
  id: string;
  user_id: string;
  setting_type: string;
  setting_data: any;
  created_at: string;
  updated_at: string;
}

// 평가 데이터 타입 (프론트엔드용)
export interface EvaluationData {
  employeeId: string;
  employeeName: string;
  employeePosition: string;
  employeeDepartment: string;
  growthLevel: number;
  evaluationStatus: EvaluationStatus;
  evaluationPeriodId?: string | null;
  tasks: TaskData[];
  lastModified: string;
}

export interface TaskData {
  id: string;
  taskId: string;
  title: string;
  description: string;
  weight: number;
  startDate: string;
  endDate: string;
  contributionMethod: string;
  contributionScope: string;
  score: number | null;
  feedback: string | null;
  deletedAt?: string | null;
  feedbackHistory?: FeedbackHistory[];
}

// API 응답 타입
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

// 폼 관련 타입
export interface LoginFormData {
  employeeId: string;
  password: string;
  role?: UserRole;
}

// 상수 정의
export const CONSTANTS = {
  // 가중치 관련
  TOTAL_WEIGHT: 100,
  MIN_FEEDBACK_LENGTH: 30,
  MIN_FEEDBACK_SENTENCES: 2,

  // 페이지 제목
  PAGE_TITLES: {
    LOGIN: '로그인',
    DASHBOARD: '대시보드',
    EVALUATION: '평가',
    NOT_FOUND: '페이지를 찾을 수 없습니다'
  },
  
  // 알림 타입
  NOTIFICATION_TYPES: {
    EVALUATION_COMPLETED: 'evaluation_completed',
    FEEDBACK_RECEIVED: 'feedback_received',
    TASK_UPDATED: 'task_updated'
  }
} as const;

// 유틸리티 타입
export type ApiError = {
  code: string;
  message: string;
  details?: any;
};

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

// Re-export DTO for task evaluation updates so it can be imported from '@/types'
export type { TaskEvaluationUpdate } from './evaluation';

// 조직 KPI 타입 — '@/types' 에서 바로 import 가능하도록 re-export
export type {
  KpiOrgLevel,
  KpiDirection,
  KpiStatus,
  OrgKpi,
  KpiNode,
  OrgKpiInput,
  OrgKpiUpdate,
} from './kpi';
