import { apiFetch } from '@/lib/api';
import { FeedbackHistory } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export const feedbackApiService = {
  // 피드백 히스토리 조회 (task_id 기준)
  async getFeedbackHistoryByTaskId(taskId: string): Promise<FeedbackHistory[]> {
    try {
      return await apiFetch<FeedbackHistory[]>(`/api/feedbacks/task/${taskId}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 피드백 생성
  async createFeedback(feedback: Omit<FeedbackHistory, 'id' | 'created_at'>): Promise<FeedbackHistory> {
    try {
      return await apiFetch<FeedbackHistory>('/api/feedback', {
        method: 'POST',
        body: JSON.stringify(feedback),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 피드백 히스토리 생성 (피드백 저장 시 사용)
  async createFeedbackHistory(feedback: { task_id: string; content: string; evaluator_name: string }): Promise<FeedbackHistory> {
    try {
      return await apiFetch<FeedbackHistory>('/api/feedback', {
        method: 'POST',
        body: JSON.stringify(feedback),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 피드백 삭제
  async deleteFeedback(id: string): Promise<void> {
    try {
      await apiFetch<void>(`/api/feedback/${id}`, { method: 'DELETE' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
  // 피드백 업데이트
  async updateFeedback(id: string, updates: Partial<FeedbackHistory>): Promise<FeedbackHistory> {
    try {
      return await apiFetch<FeedbackHistory>(`/api/feedback/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  }
};