import { useCallback, useEffect, useRef, useState } from 'react';

// 전사현황 ↔ 부서별 진행 화면이 같은 조직 필터를 공유한다(세션 단위).
// 두 화면은 서로 다른 라우트라 동시에 떠 있지 않으므로, 마운트 시 sessionStorage 에서
// 읽고 변경 시 즉시 써서 화면 전환·왕복에도 필터가 유지되게 한다.
//
// ⚠ 평가기간(periodId)이 바뀌면 필터를 비운다.
// 조직 명칭이 기간마다 다르고(예: 25년 "경영지원본부" ↔ 26년 "AX경영지원본부"),
// 노드키는 '조직 경로 전체'를 정확 일치로 매칭하므로 다른 기간의 키는 한 건도 맞지 않아
// 화면이 통째로 비는 문제가 생긴다. 기간이 달라지면 저장된 필터를 무효화한다.
const STORAGE_KEY = 'hr-org-filter';
// 같은 탭에서 동시에 떠 있는 소비자(평가 인사이트 산점도 ↔ 임베드된 분석 화면)가
// 필터 변경을 즉시 공유하도록 커스텀 이벤트로 브로드캐스트한다(sessionStorage 는 동일 탭에
// storage 이벤트를 안 쏘므로 직접 이벤트를 발행).
const SYNC_EVENT = 'hr-org-filter:change';

type Stored = { periodId: string | null; keys: string[] };

const read = (periodId: string | null): string[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // 구버전(배열만 저장) 호환: 기간정보가 없으면 무효화하고 비운다.
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return [];
    const stored = parsed as Partial<Stored>;
    if (stored.periodId !== periodId) return [];
    return Array.isArray(stored.keys) ? stored.keys.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
};

const write = (periodId: string | null, keys: string[]) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ periodId, keys } satisfies Stored));
  } catch {
    /* 저장 실패는 무시(필터는 메모리 상태로는 동작) */
  }
};

export const useSharedOrgFilter = (periodId: string | null): [string[], (next: string[]) => void] => {
  const [value, setValue] = useState<string[]>(() => read(periodId));
  const periodRef = useRef(periodId);
  periodRef.current = periodId;

  const set = useCallback((next: string[]) => {
    setValue(next);
    write(periodRef.current, next);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_EVENT));
  }, []);

  // 기간이 바뀌면(또는 같은 탭의 다른 화면에서 갱신됐으면) 현재 기간 기준으로 다시 읽는다.
  // 저장된 기간과 다르면 read 가 빈 배열을 돌려줘 필터가 초기화된다.
  useEffect(() => {
    setValue(read(periodId));
  }, [periodId]);

  // 같은 탭의 다른 소비자가 필터를 바꾸면 즉시 동기화(산점도 ↔ 임베드 화면 라이브 반영).
  useEffect(() => {
    const onSync = () => setValue(read(periodRef.current));
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  return [value, set];
};
