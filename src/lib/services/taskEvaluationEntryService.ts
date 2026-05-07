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
};
