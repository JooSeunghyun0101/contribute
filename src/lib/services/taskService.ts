import { taskApiService } from './taskApiService';
import { Task } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

/**
 * 프론트엔드에서 사용되는 과업 서비스.
 * 내부해 실제 API와 통신한다.
 * 모든 메서드는 에러 발생 시 apiErrorHandler 로 래핑한다.
 */
export const taskService = {
  // 평가 ID 로 과업 조회 (삭제된 과업 제외)
  async getTasksByEvaluationId(evaluationId: string): Promise<Task[]> {
    try {
      return await taskApiService.getTasksByEvaluationId(evaluationId);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // task_id 로 단일 과업 조회
  async getTaskByTaskId(taskId: string): Promise<Task | null> {
    try {
      return await taskApiService.getTaskByTaskId(taskId);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 과업 생성
  async createTask(task: Omit<Task, 'id' | 'created_at'>, options?: { past?: boolean }): Promise<Task> {
    try {
      return await taskApiService.createTask(task, options);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 과업 업데이트
  async updateTask(id: string, updates: Partial<Task>, options?: { past?: boolean }): Promise<Task> {
    try {
      return await taskApiService.updateTask(id, updates, options);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 과업 소프트 삭제 (deleted_at 설정)
  async softDeleteTask(id: string, options?: { past?: boolean }): Promise<void> {
    try {
      await taskApiService.softDeleteTask(id, options);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 전체 과업 조회 (삭제된 과업 포함 여부는 백엔드 로직에 따름)
  async getAllTasks(): Promise<Task[]> {
    try {
      return await taskApiService.getAllTasks();
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

};