import { apiFetch } from '@/lib/api';
import type { EvaluationPeriod, EvaluationPeriodStatus } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export type EvaluationPeriodInput = {
  code?: string;
  name: string;
  evaluation_year: number;
  starts_on?: string | null;
  ends_on?: string | null;
  status?: EvaluationPeriodStatus;
  is_default?: boolean;
};

export type EvaluationPeriodUpdate = Partial<EvaluationPeriodInput>;

export const evaluationPeriodService = {
  async getPeriods(): Promise<EvaluationPeriod[]> {
    try {
      return await apiFetch<EvaluationPeriod[]>('/api/evaluation-periods');
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getCurrentPeriod(): Promise<EvaluationPeriod | null> {
    try {
      return await apiFetch<EvaluationPeriod | null>('/api/evaluation-periods/current');
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async createPeriod(period: EvaluationPeriodInput): Promise<EvaluationPeriod> {
    try {
      return await apiFetch<EvaluationPeriod>('/api/evaluation-periods', {
        method: 'POST',
        body: JSON.stringify(period),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async updatePeriod(id: string, updates: EvaluationPeriodUpdate): Promise<EvaluationPeriod> {
    try {
      return await apiFetch<EvaluationPeriod>(`/api/evaluation-periods/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async activatePeriod(id: string): Promise<EvaluationPeriod> {
    return this.updatePeriod(id, { status: 'active', is_default: true });
  },

  async closePeriod(id: string): Promise<EvaluationPeriod> {
    return this.updatePeriod(id, { status: 'closed' });
  },

  async lockPeriod(id: string): Promise<EvaluationPeriod> {
    return this.updatePeriod(id, { status: 'locked' });
  },
};
