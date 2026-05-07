import { feedbackApiService } from './feedbackApiService';
import { FeedbackHistory, TaskEvaluationUpdate } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';
import { taskService } from './taskService';

/**
 * 프론트엔드에서 사용되는 피드백 서비스.
 * 내부적으로 `feedbackApiService` 를 래핑하여 API 호출을 수행합니다.
 * 각 메서드는 이미 `feedbackApiService` 내부에서 에러를 `apiErrorHandler` 로 처리하므로
 * 여기서는 단순 전달만 수행합니다.
 */
export const feedbackService = {
  /**
   * taskId 로 피드백 히스토리 조회
   */
  async getFeedbackHistoryByTaskId(taskId: string): Promise<FeedbackHistory[]> {
    try {
      return await feedbackApiService.getFeedbackHistoryByTaskId(taskId);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /**
   * 새로운 피드백 생성
   */
  async createFeedback(feedback: Omit<FeedbackHistory, 'id' | 'created_at'>): Promise<FeedbackHistory> {
    try {
      return await feedbackApiService.createFeedback(feedback);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /**
   * 기존 피드백 업데이트
   */
  async updateFeedback(id: string, updates: Partial<FeedbackHistory>): Promise<FeedbackHistory> {
    try {
      return await feedbackApiService.updateFeedback(id, updates);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 피드백 히스토리 생성 (평가 저장 시 사용)
  async createFeedbackHistory(feedback: { task_id: string; content: string; evaluator_name: string }): Promise<FeedbackHistory> {
    try {
      return await feedbackApiService.createFeedbackHistory(feedback);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /**
   * 피드백 삭제
   */
  async deleteFeedback(id: string): Promise<void> {
    try {
      await feedbackApiService.deleteFeedback(id);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /**
   * Update task evaluation fields (contribution method, scope, score, feedback, etc.)
   *
   * @param taskId - The DB task ID (primary key)
   * @param updates - Evaluation fields in camelCase
   */
  async updateTaskEvaluation(
    taskId: string,
    updates: {
      contributionMethod?: string;
      contributionScope?: string;
      score?: number;
      feedback?: string;
      feedbackDate?: string;
      evaluatorName?: string;
    }
  ): Promise<void> {
    try {
      const snakeCaseUpdates: Record<string, any> = {};
      // Log payload for debugging – confirms server call
      console.log('🔧 feedbackService.updateTaskEvaluation 호출 - payload', {
        taskId,
        updates,
        snakeCaseMapping: {
          contribution_method: updates.contributionMethod,
          contribution_scope: updates.contributionScope,
          score: updates.score,
          feedback: updates.feedback,
          feedback_date: updates.feedbackDate,
          evaluator_name: updates.evaluatorName,
        },
      });

      if (updates.contributionMethod !== undefined) {
        snakeCaseUpdates.contribution_method = updates.contributionMethod;
      }
      if (updates.contributionScope !== undefined) {
        snakeCaseUpdates.contribution_scope = updates.contributionScope;
      }
      if (updates.score !== undefined) {
        snakeCaseUpdates.score = updates.score;
      }
      if (updates.feedback !== undefined) {
        snakeCaseUpdates.feedback = updates.feedback;
      }
      if (updates.feedbackDate !== undefined) {
        snakeCaseUpdates.feedback_date = updates.feedbackDate;
      }
      if (updates.evaluatorName !== undefined) {
        snakeCaseUpdates.evaluator_name = updates.evaluatorName;
      }

      await taskService.updateTask(taskId, snakeCaseUpdates);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  }
};