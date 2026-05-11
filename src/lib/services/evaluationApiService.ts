import { apiFetch } from '@/lib/api';
import { Evaluation, EvaluationStatus } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

type EvaluationQuery = {
  periodId?: string | null;
  year?: number | null;
};

const buildEvaluationQuery = (query: EvaluationQuery = {}) => {
  const params = new URLSearchParams();
  if (query.periodId) {
    params.set('periodId', query.periodId);
  } else if (query.year != null) {
    params.set('year', String(query.year));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export const evaluationService = {
  // 모든 평가 조회
  async getAllEvaluations(query?: EvaluationQuery): Promise<Evaluation[]> {
    try {
      return await apiFetch<Evaluation[]>(`/api/evaluations${buildEvaluationQuery(query)}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 특정 직원의 평가 조회
  async getEvaluationByEmployeeId(employeeId: string, query?: EvaluationQuery): Promise<Evaluation | null> {
    if (!employeeId) {
      // Prevent calling API with empty ID which results in 404
      throw new Error('employeeId is required');
    }
    try {
      // The endpoint returns a single Evaluation object (or null), not an array.
      const evaluation = await apiFetch<Evaluation>(
        `/api/evaluations/by-employee/${employeeId}${buildEvaluationQuery(query)}`,
      );
      // Ensure the returned object always has an `id` field.
      if (evaluation && !evaluation.id && (evaluation as any).evaluation_id) {
        (evaluation as any).id = (evaluation as any).evaluation_id;
      }
      return evaluation ?? null;
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getEvaluationById(id: string): Promise<Evaluation | null> {
    if (!id) throw new Error('id is required');
    try {
      const evaluation = await apiFetch<Evaluation>(`/api/evaluation/${id}`);
      if (evaluation && !evaluation.id && (evaluation as any).evaluation_id) {
        (evaluation as any).id = (evaluation as any).evaluation_id;
      }
      return evaluation ?? null;
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getEvaluationsByEmployeeId(employeeId: string, query?: EvaluationQuery): Promise<Evaluation[]> {
    if (!employeeId) {
      throw new Error('employeeId is required');
    }
    try {
      return await apiFetch<Evaluation[]>(
        `/api/evaluations/employee/${employeeId}${buildEvaluationQuery(query)}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가 생성
  async createEvaluation(evaluation: Omit<Evaluation, 'id' | 'created_at' | 'updated_at'>): Promise<Evaluation> {
    try {
      return await apiFetch<Evaluation>('/api/evaluation', {
        method: 'POST',
        body: JSON.stringify(evaluation),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가 업데이트
  async updateEvaluation(id: string, updates: Partial<Evaluation>): Promise<Evaluation> {
    try {
      return await apiFetch<Evaluation>(`/api/evaluation/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가 상태별 조회
  async getEvaluationsByStatus(status: EvaluationStatus, query?: EvaluationQuery): Promise<Evaluation[]> {
    try {
      return await apiFetch<Evaluation[]>(
        `/api/evaluations/status/${status}${buildEvaluationQuery(query)}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가 삭제
  async deleteEvaluation(id: string): Promise<void> {
    try {
      await apiFetch<void>(`/api/evaluation/${id}`, { method: 'DELETE' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 피평가자가 평가자에게 반려 요청 (알림만 발송)
  async requestReturn(evaluationId: string, payload: { requestedBy: string; reason?: string }): Promise<void> {
    try {
      await apiFetch<void>(`/api/evaluation/${evaluationId}/return-request`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 평가자가 완료 평가를 재오픈 (status → evaluating + 피평가자 알림)
  async reopenEvaluation(evaluationId: string, payload: { actorId: string; reason?: string }): Promise<void> {
    try {
      await apiFetch<void>(`/api/evaluation/${evaluationId}/reopen`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
