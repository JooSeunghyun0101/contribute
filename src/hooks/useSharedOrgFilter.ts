import { useCallback, useEffect, useState } from 'react';

// 전사현황 ↔ 부서별 진행 화면이 같은 조직 필터를 공유한다(세션 단위).
// 두 화면은 서로 다른 라우트라 동시에 떠 있지 않으므로, 마운트 시 sessionStorage 에서
// 읽고 변경 시 즉시 써서 화면 전환·왕복에도 필터가 유지되게 한다.
const STORAGE_KEY = 'hr-org-filter';

const read = (): string[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
};

export const useSharedOrgFilter = (): [string[], (next: string[]) => void] => {
  const [value, setValue] = useState<string[]>(read);

  const set = useCallback((next: string[]) => {
    setValue(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 저장 실패는 무시(필터는 메모리 상태로는 동작) */
    }
  }, []);

  // 같은 탭의 다른 곳에서 갱신됐을 수 있어, 마운트 시 한 번 최신값으로 동기화.
  useEffect(() => {
    setValue(read());
  }, []);

  return [value, set];
};
