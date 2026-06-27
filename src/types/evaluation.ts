
export interface FeedbackHistoryItem {
  id: string;
  content: string;
  date: string;
  evaluatorName: string;
  evaluatorId: string;
}

export interface TaskEvaluationEntry {
  id: string;
  taskUuid: string;
  taskId: string;
  evaluationId: string;
  evaluatorId: string;
  evaluatorName: string;
  assignmentHistoryId?: string | null;
  status?: 'active' | 'cancelled';
  contributionMethod?: string | null;
  contributionScope?: string | null;
  score?: number | null;
  feedback?: string | null;
  feedbackDate?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  // 저장 시점 1차 AI 검수 결과(조회 시 재호출 없이 이 저장값만 표시). flagged 일 때만 summary/type 채워짐.
  aiFlagged?: boolean | null;
  aiSummary?: string | null;
  aiType?: string | null;
  aiReviewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Task {
  id: string;
  taskId?: string; // DB의 task_id 필드
  evaluationId?: string; // DB의 evaluation_id 필드
  /** DB 컬럼명: task_id */
  evaluation_year?: number;
  evaluation_period_id?: string | null;
  task_id?: string;
  /** DB 컬럼명: evaluation_id */
  evaluation_id?: string;
  /** 피평가자 ID (optional) */
  evaluatee_id?: string;
  /** DB 컬럼명: deleted_at */
  deleted_at?: string | null;
  title: string;
  description: string;
  weight: number;
  /** 'AI 과업' 표시 여부(AI 과업 50% 규칙 집계 대상). */
  isAiTask?: boolean;
  startDate?: string;
  endDate?: string;
  contributionMethod?: string | null;
  contributionScope?: string | null;
  score?: number | null;
  feedback?: string | null;
  feedbackHistory?: FeedbackHistoryItem[];
  evaluationEntries?: TaskEvaluationEntry[];
  currentEvaluatorEntry?: TaskEvaluationEntry | null;
  previousEvaluatorEntries?: TaskEvaluationEntry[];
  isHistoricalEvaluation?: boolean;
  sourceEvaluationId?: string;
  feedbackDate?: string;
  lastModified?: string;
  evaluatorName?: string;
  // DB에 존재하지만 현재 TypeScript에서는 사용되지 않는 컬럼
  deletedAt?: string | null;
}

// DTO for updating task evaluation fields
export interface TaskEvaluationUpdate {
  contributionMethod?: string | null;
  contributionScope?: string | null;
  score?: number | null;
  feedback?: string | null;
  feedbackDate?: string;
  evaluatorName?: string;
}

export interface EvaluationData {
  // 평가 레코드 UUID (optional – API에서 제공)
  id?: string;
  // 일부 백엔드에서는 `evaluation_id` 라는 이름으로 제공될 수 있음
  evaluation_id?: string;
  evaluatorId?: string | null;
  evaluatorName?: string | null;
  evaluatorAssignedAt?: string | null;
  evaluateeId: string;
  evaluateeName: string;
  evaluateePosition: string;
  evaluateeDepartment: string;
  growthLevel: number;
  evaluationStatus:
    | 'draft'
    | 'submitted'
    | 'evaluating'
    | 'completed'
    | 'locked'
    | 'in-progress';
  lastModified: string;
  /** 연도 컬럼 – 평가와 연동되는 연도 */
  evaluation_year?: number;
  evaluation_period_id?: string | null;
  evaluatorAccess?: {
    assignedEvaluatorId?: string | null;
    currentEvaluatorId?: string | null;
    canEdit: boolean;
    isCurrentAssignedEvaluator: boolean;
    isFormerEvaluator: boolean;
    hasOtherEvaluatorEntries: boolean;
    message?: string;
  };
  tasks: Task[];
}
