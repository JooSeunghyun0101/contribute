import { apiFetch } from '@/lib/api';
import type { EvaluatorQnaLog } from '@/types';

export type EvaluatorQnaLogInput = {
  user_id: string;
  user_name?: string | null;
  user_department?: string | null;
  user_role?: string | null;
  question: string;
  answer?: string | null;
  is_error?: boolean;
};

export const evaluatorQnaLogService = {
  // 문의 1턴 저장. 로깅 실패가 사용자 경험을 막지 않도록 에러를 삼키고 null 반환.
  async create(input: EvaluatorQnaLogInput): Promise<EvaluatorQnaLog | null> {
    try {
      return await apiFetch<EvaluatorQnaLog>('/api/evaluator-qna-logs', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('AI 문의 이력 저장 실패:', error);
      return null;
    }
  },

  // HR 엑셀 다운로드용 전체 문의 이력(최신순).
  async listAll(): Promise<EvaluatorQnaLog[]> {
    return apiFetch<EvaluatorQnaLog[]>('/api/evaluator-qna-logs');
  },
};
