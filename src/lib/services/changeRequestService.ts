import { apiFetch } from '@/lib/api';
import type { ChangeRequestRole, EvaluatorChangeRequest } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export type ChangeRequestInput = {
  evaluatee_id: string;
  requested_evaluator_id: string | null;
  target_history_id: string;
  segment_start_date: string | null;
  segment_end_date: string | null;
  requested_by: string;
  requester_role: ChangeRequestRole;
  reason?: string | null;
};

export type ChangeRequestQuery = {
  status?: string;
  requestedBy?: string;
  periodId?: string;
};

const buildQuery = (query: ChangeRequestQuery = {}) => {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.requestedBy) params.set('requestedBy', query.requestedBy);
  if (query.periodId) params.set('periodId', query.periodId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export const changeRequestService = {
  async list(query?: ChangeRequestQuery): Promise<EvaluatorChangeRequest[]> {
    try {
      return await apiFetch<EvaluatorChangeRequest[]>(`/api/change-requests${buildQuery(query)}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async create(input: ChangeRequestInput): Promise<EvaluatorChangeRequest> {
    try {
      return await apiFetch<EvaluatorChangeRequest>('/api/change-requests', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async approve(
    id: string,
    payload: { reviewed_by: string; review_comment?: string | null },
  ): Promise<EvaluatorChangeRequest> {
    try {
      return await apiFetch<EvaluatorChangeRequest>(`/api/change-requests/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async reject(
    id: string,
    payload: { reviewed_by: string; review_comment?: string | null },
  ): Promise<EvaluatorChangeRequest> {
    try {
      return await apiFetch<EvaluatorChangeRequest>(`/api/change-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async revert(
    id: string,
    payload: { reviewed_by: string; review_comment?: string | null },
  ): Promise<EvaluatorChangeRequest> {
    try {
      return await apiFetch<EvaluatorChangeRequest>(`/api/change-requests/${id}/revert`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async cancel(id: string, actorId: string): Promise<EvaluatorChangeRequest> {
    try {
      return await apiFetch<EvaluatorChangeRequest>(`/api/change-requests/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ actor_id: actorId }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
