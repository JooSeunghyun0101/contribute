import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

/** GET /api/badge-counts 응답 — 역할별 '지금 액션이 필요한 건수'. */
export interface SidebarBadgeCounts {
  /** 피평가자: 선택 기간 내 성과보고(최종제출) 전 평가 건수 */
  myPendingSubmit: number;
  /** 평가자: 검토 필요(submitted·evaluating) 담당 건수 */
  reviewNeeded: number;
  /** HR: 평가자 변경요청 대기 건수 */
  pendingChangeRequests: number;
  /** HR: 비밀번호 초기화 요청 대기 건수 */
  pendingPasswordResets: number;
}

const EMPTY: SidebarBadgeCounts = {
  myPendingSubmit: 0,
  reviewNeeded: 0,
  pendingChangeRequests: 0,
  pendingPasswordResets: 0,
};

const POLL_MS = 60_000;

// 사이드바 배지 — 가벼운 카운트 요청 1회를 60초 폴링 + 창 포커스 시 갱신.
// 배지는 부가 정보라 실패는 조용히 무시(0 표시)하고 화면 흐름을 막지 않는다.
export const useSidebarBadges = (
  periodId: string | null | undefined,
  enabled: boolean,
): SidebarBadgeCounts => {
  const [counts, setCounts] = useState<SidebarBadgeCounts>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setCounts(EMPTY);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch<Partial<SidebarBadgeCounts>>(
          `/api/badge-counts${periodId ? `?periodId=${encodeURIComponent(periodId)}` : ''}`,
        );
        if (!cancelled) setCounts({ ...EMPTY, ...res });
      } catch {
        /* 배지 실패는 무시 */
      }
    };
    load();
    const interval = window.setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [periodId, enabled]);

  return counts;
};
