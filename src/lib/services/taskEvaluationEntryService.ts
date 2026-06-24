import { apiFetch } from '@/lib/api';
import { TaskEvaluationEntry } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export type TaskEvaluationEntryInput = {
  task_uuid?: string;
  task_id?: string;
  evaluation_id?: string;
  evaluator_id: string;
  evaluator_name: string;
  contribution_method?: string | null;
  contribution_scope?: string | null;
  score?: number | null;
  feedback?: string | null;
  feedback_date?: string | null;
};

export const taskEvaluationEntryService = {
  async getEntriesByEvaluationId(evaluationId: string): Promise<TaskEvaluationEntry[]> {
    try {
      return await apiFetch<TaskEvaluationEntry[]>(
        `/api/task-evaluation-entries/evaluation/${evaluationId}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async upsertEntry(entry: TaskEvaluationEntryInput): Promise<TaskEvaluationEntry> {
    try {
      return await apiFetch<TaskEvaluationEntry>('/api/task-evaluation-entry', {
        method: 'PUT',
        body: JSON.stringify(entry),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 복붙 검수용 — 같은 평가자가 그 기간 다른 피평가자에게 쓴 피드백 모음(현재 평가 제외).
  async getEvaluatorFeedbacks(
    evaluatorId: string,
    periodId?: string | null,
    excludeEvaluationId?: string | null,
  ): Promise<string[]> {
    const params = new URLSearchParams({ evaluatorId });
    if (periodId) params.set('periodId', periodId);
    if (excludeEvaluationId) params.set('excludeEvaluationId', excludeEvaluationId);
    try {
      return await apiFetch<string[]>(`/api/evaluator-feedbacks?${params.toString()}`);
    } catch {
      return [];
    }
  },

  // 평가 저장 시 그 항목의 AI 검수 결과를 기록(매 저장 덮어쓰기). 실패해도 저장 흐름은 막지 않는다.
  async setAiReview(
    entryId: string,
    payload: { flagged: boolean; type?: string | null; summary?: string | null; feedbackHash?: string | null },
  ): Promise<void> {
    await apiFetch<unknown>(`/api/task-evaluation-entry/${entryId}/ai-review`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
