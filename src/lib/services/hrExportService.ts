import { apiFetch } from '@/lib/api';
import { apiErrorHandler } from '@/utils/errorHandler';
import type {
  Employee,
  Evaluation,
  EvaluatorAssignmentHistory,
  FeedbackHistory,
  Task,
  TaskEvaluationEntry,
} from '@/types';

/**
 * P3-7: HR 전체 평가 데이터 벌크 export 페이로드 — 전체 엑셀 내보내기가 직원·평가별
 * 순차 조회(수천 요청)로 돌던 것을 서버 1회 조회로 대체한다. 각 배열은 기존 개별
 * 라우트가 주던 것과 같은 원자료(superset)이며, 조합·필터는 hrDataExport 가 기존
 * 로직 그대로 수행한다.
 */
export type HrEvaluationExportPayload = {
  employees: Employee[];
  evaluations: Evaluation[];
  tasks: Task[];
  task_evaluation_entries: TaskEvaluationEntry[];
  feedback_history: FeedbackHistory[];
  assignment_histories: EvaluatorAssignmentHistory[];
};

export const hrExportService = {
  async getEvaluationExportData(): Promise<HrEvaluationExportPayload> {
    try {
      return await apiFetch<HrEvaluationExportPayload>('/api/hr/export/evaluation-data');
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
