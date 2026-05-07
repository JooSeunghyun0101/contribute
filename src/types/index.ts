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
}

// 직원 관련 타입
export interface Employee {
  id: string;
  employee_id: string;
  name: string;
  position: string;
  department: string;
  growth_level: number | null;
  evaluator_id: string | null;
  available_roles: string[];
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
  growth_level: number;
  evaluation_status: EvaluationStatus;
  /** 연도 컬럼 – 평가와 연동되는 연도 */
  evaluation_year?: number;
  evaluation_period_id?: string | null;
  assignment_history_id?: string | null;
  record_status?: 'active' | 'cancelled';
  last_modified: string;
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
  
  // 기본 비밀번호 (개발용)
  DEFAULT_PASSWORD: '1234',
  
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
