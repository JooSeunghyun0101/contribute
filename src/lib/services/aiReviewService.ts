import { apiFetch } from '@/lib/api';
import { apiErrorHandler } from '@/utils/errorHandler';

export type AiReviewItem = {
  evaluation_id: string;
  evaluatee_id: string;
  evaluatee_name: string;
  evaluator_name: string;
  task_title: string | null;
  ai_type: string | null;
  ai_summary: string | null;
  ai_reviewed_at: string | null;
  /** 부적합 판정된 과업 식별자(= tasks.id). 평가 열람에서 해당 과업 자동 선택용. */
  task_uuid: string | null;
  /** 그 과업의 실제 평가 피드백 문구(검수 화면에서 함께 표시). */
  feedback: string | null;
};

export type AiReviewRollup = {
  total: number; // 피드백이 있는 평가 항목 수
  reviewed: number; // 1차 AI 검수가 기록된 항목 수
  flagged: number; // 부적합으로 플래그된 항목 수
  byEvaluator: { evaluator_name: string; total: number; flagged: number }[];
  items: AiReviewItem[]; // 플래그된 항목 목록
};

export const aiReviewService = {
  // HR 롤업 — 저장 시 쌓인 1차 검수 결과만 집계 조회(AI 재호출 없음).
  async getRollup(periodId?: string | null): Promise<AiReviewRollup> {
    try {
      const qs = periodId ? `?periodId=${encodeURIComponent(periodId)}` : '';
      return await apiFetch<AiReviewRollup>(`/api/ai-reviews${qs}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
