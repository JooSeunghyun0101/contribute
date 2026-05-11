import { apiFetch } from '@/lib/api';
import { Task } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export const taskApiService = {
  // 평가 ID로 과업들 조회 (삭제된 과업 제외)
  async getTasksByEvaluationId(evaluationId: string): Promise<Task[]> {
    try {
      return await apiFetch<Task[]>(`/api/tasks/evaluation/${evaluationId}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // task_id로 과업 조회 (삭제된 과업 제외)
  async getTaskByTaskId(taskId: string): Promise<Task | null> {
    try {
      const tasks = await apiFetch<Task[]>(`/api/tasks?task_id=${taskId}`);
      return tasks[0] ?? null;
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 과업 생성
  async createTask(task: Omit<Task, 'id' | 'created_at'>, options?: { past?: boolean }): Promise<Task> {
    try {
      // Ensure evaluation_id is provided before sending request
      if (!task.evaluation_id) {
        throw new Error('evaluation_id is required for creating a task');
      }
      const path = options?.past ? '/api/task?past=1' : '/api/task';
      return await apiFetch<Task>(path, {
        method: 'POST',
        body: JSON.stringify(task),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('❗ taskApiService.createTask error:', error);
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 과업 업데이트
  async updateTask(
    id: string,
    updates: Partial<Task>,
    options?: { past?: boolean },
  ): Promise<Task> {
    try {
      const path = options?.past ? `/api/task/${id}?past=1` : `/api/task/${id}`;
      return await apiFetch<Task>(path, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 과업 소프트 삭제 (deleted_at 설정)
  async softDeleteTask(id: string, options?: { past?: boolean }): Promise<void> {
    try {
      const path = options?.past ? `/api/task/${id}?past=1` : `/api/task/${id}`;
      await apiFetch<void>(path, {
        method: 'PATCH',
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 모든 과업 조회 (삭제된 과업 포함 여부는 백엔드 로직에 따라 다름)
  async getAllTasks(): Promise<Task[]> {
    try {
      // Assuming an endpoint that returns all tasks; adjust if needed
      return await apiFetch<Task[]>('/api/tasks');
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

};
