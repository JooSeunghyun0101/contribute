import { apiFetch } from '@/lib/api';

/**
 * S2: 임시저장 draft 의 서버 보관 — 기기 간 이어서 작성.
 *
 * 로컬(localStorage) 임시저장과 병행하며, 복원 시 '더 최신' 쪽을 쓴다.
 * 서버 실패는 전부 조용히 무시한다 — 로컬 임시저장이 1차 방어선이고,
 * 서버 draft 는 기기 교체·브라우저 데이터 삭제에 대한 보강이다.
 */
export type RemoteDraft = { payload: Record<string, unknown>; updated_at: string } | null;

const draftUrl = (key: string) => `/api/drafts/${encodeURIComponent(key)}`;

export const draftService = {
  async get(key: string): Promise<RemoteDraft> {
    if (!key) return null;
    try {
      return await apiFetch<RemoteDraft>(draftUrl(key));
    } catch {
      return null;
    }
  },

  /** 저장(빈 맵 = 서버측 삭제). 호출부의 디바운스 타이밍을 그대로 따른다. */
  save(key: string, payload: Record<string, unknown>): void {
    if (!key) return;
    void apiFetch(draftUrl(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    }).catch(() => {
      /* 서버 draft 실패 무시 — 로컬 임시저장은 이미 기록됨 */
    });
  },

  /**
   * 탭 종료/언마운트 직전 플러시 — keepalive 로 언로드 중에도 전송을 보장한다.
   * (일반 fetch 는 페이지 종료와 함께 중단될 수 있다.)
   */
  flush(key: string, payload: Record<string, unknown>): void {
    if (!key || typeof fetch === 'undefined') return;
    try {
      const base = import.meta.env.VITE_API_BASE ?? '';
      void fetch(`${base}${draftUrl(key)}`, {
        method: 'POST',
        keepalive: true,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ payload }),
      }).catch(() => {
        /* 무시 */
      });
    } catch {
      /* 무시 */
    }
  },
};
