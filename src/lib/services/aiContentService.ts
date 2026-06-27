import { apiFetch } from '@/lib/api';
import { apiErrorHandler } from '@/utils/errorHandler';

// 조회 시 재호출 없는 AI 결과물(요약·제안) 저장소. 생성은 클라이언트(gptOss)에서 하고,
// 그 결과를 여기로 저장(put)했다가 조회(get/getBatch) 시 그대로 불러와 표시한다.
export type AiContentKind =
  | 'evaluatee_feedback_summary'
  | 'evaluator_feedback_summary'
  | 'task_growth_suggestion'
  | 'evaluatee_growth_suggestion'
  | 'evaluatee_feedback_keywords'
  | 'evaluator_feedback_keywords';

export type AiContentRecord = {
  content: string;
  generated_at: string;
  generated_by?: string | null;
};

export const aiContentService = {
  // 단건 조회 — 없으면 null. 권한 없음/오류도 null 로 흡수(화면은 '미생성'으로 처리).
  async get(kind: AiContentKind, scopeId: string): Promise<AiContentRecord | null> {
    try {
      return await apiFetch<AiContentRecord | null>(
        `/api/ai-content/${kind}/${encodeURIComponent(scopeId)}`,
      );
    } catch {
      return null;
    }
  },

  // 배치 조회 — scope_id → 레코드 맵. (피평가자 과업 성장제안 일괄 로드)
  async getBatch(kind: AiContentKind, scopeIds: string[]): Promise<Record<string, AiContentRecord>> {
    const ids = scopeIds.filter(Boolean);
    if (ids.length === 0) return {};
    try {
      const rows = await apiFetch<Array<{ scope_id: string; content: string; generated_at: string }>>(
        `/api/ai-content/${kind}?scopeIds=${encodeURIComponent(ids.join(','))}`,
      );
      const map: Record<string, AiContentRecord> = {};
      for (const r of rows ?? []) {
        map[r.scope_id] = { content: r.content, generated_at: r.generated_at };
      }
      return map;
    } catch {
      return {};
    }
  },

  // 생성/갱신(upsert).
  async put(
    kind: AiContentKind,
    scopeId: string,
    content: string,
    meta?: Record<string, unknown>,
  ): Promise<AiContentRecord> {
    try {
      return await apiFetch<AiContentRecord>(`/api/ai-content/${kind}/${encodeURIComponent(scopeId)}`, {
        method: 'PUT',
        body: JSON.stringify({ content, meta }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
