import { useEffect, useRef } from 'react';
import { draftService } from '@/lib/services/draftService';

type DraftMap = Record<string, unknown>;

const writeMap = (storageKey: string, drafts: DraftMap) => {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    if (Object.keys(drafts).length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), drafts }),
    );
  } catch {
    /* localStorage 사용 불가(용량/차단) 시 무시 */
  }
};

/**
 * F-2: 컴포넌트 로컬 draft 맵을 localStorage 에 디바운스 자동저장 + 마운트 시 복원 + 종료/언마운트 플러시.
 *
 * 핵심 안전장치:
 * - `ready`(기반 데이터 로드 완료) 전에는 읽기/쓰기를 하지 않는다 → 로드 중 빈 맵으로 저장본을 지우는 레이스 방지.
 * - 자동저장 타이머는 진입 시점의 key·snapshot 을 캡처(draftStorageKey 변경 레이스 방지).
 * - 복원은 storageKey 별 1회, 그리고 현재 맵이 비어있을 때만(작성 중인 내용 보호).
 */
export function useLocalDraftPersistence<T extends DraftMap>(params: {
  storageKey: string; // '' 이면 비활성
  drafts: T;
  setDrafts: (drafts: T) => void;
  ready: boolean;
  validKey?: (key: string) => boolean; // 복원 시 유효하지 않은(예: 삭제된 과업) 키 제외
  debounceMs?: number;
}): void {
  const { storageKey, drafts, ready, debounceMs = 800 } = params;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const setDraftsRef = useRef(params.setDrafts);
  setDraftsRef.current = params.setDrafts;
  const validKeyRef = useRef(params.validKey);
  validKeyRef.current = params.validKey;
  const restoredKeyRef = useRef<string | null>(null);
  // 리뷰 확정 수정(S2 레이스): 서버 draft 복원(GET)이 끝나기 전에는 서버 동기화를 하지 않는다 —
  // 디바운스 쓰기가 GET 보다 먼저 나가면 빈/구 맵으로 서버 draft 를 지워버릴 수 있다.
  const remoteRestoredKeyRef = useRef<string | null>(null);

  // 복원: storageKey 별 1회, 기반 데이터 준비 후, 현재 비어있을 때만(활성 편집 보호).
  // S2: 로컬 복원 후 서버 draft 를 조회해 '더 최신'이면 교체한다(다른 기기에서 쓰던 임시저장).
  // 단 그 사이 사용자가 입력을 시작했으면(복원본과 달라졌으면) 건드리지 않는다.
  useEffect(() => {
    if (!storageKey || !ready) return;
    if (restoredKeyRef.current === storageKey) return;
    // 작성 중인 내용 보호: 비어있을 때만 복원. 가드는 empty-check 통과 후에만 소모해,
    // 로드 중 입력으로 일시적으로 non-empty 였다고 해서 이후(재로드 등) 복원이 영구히 막히지 않게 한다.
    if (Object.keys(draftsRef.current).length > 0) {
      // 이미 작성 중 = 현재 맵이 보존 대상 — 서버 동기화를 바로 허용(비어있지 않아 삭제 위험 없음).
      remoteRestoredKeyRef.current = storageKey;
      return;
    }
    restoredKeyRef.current = storageKey;
    const filterValid = (map: DraftMap): DraftMap | null => {
      const vk = validKeyRef.current;
      const filtered: DraftMap = {};
      let any = false;
      for (const k of Object.keys(map)) {
        if (vk && !vk(k)) continue;
        filtered[k] = map[k];
        any = true;
      }
      return any ? filtered : null;
    };
    let localSavedAt: string | null = null;
    let appliedLocal: DraftMap | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        localSavedAt = typeof parsed?.savedAt === 'string' ? parsed.savedAt : null;
        const map = (parsed?.drafts ?? parsed) as DraftMap;
        if (map && typeof map === 'object') {
          const filtered = filterValid(map);
          if (filtered) {
            setDraftsRef.current(filtered as T);
            appliedLocal = filtered;
          }
        }
      }
    } catch {
      /* 파싱 실패 무시 */
    }
    void draftService
      .get(storageKey)
      .then((remote) => {
        if (!remote?.payload || typeof remote.payload !== 'object') return;
        if (
          localSavedAt &&
          new Date(remote.updated_at).getTime() <= new Date(localSavedAt).getTime()
        ) {
          return; // 로컬이 더 최신
        }
        const filtered = filterValid(remote.payload as DraftMap);
        if (!filtered) return;
        const current = draftsRef.current;
        const untouched =
          Object.keys(current).length === 0 ||
          JSON.stringify(current) === JSON.stringify(appliedLocal);
        if (untouched) setDraftsRef.current(filtered as T);
      })
      .finally(() => {
        // 복원 시도 완료(성공/실패 무관) — 이 시점부터 서버 동기화 허용.
        remoteRestoredKeyRef.current = storageKey;
      });
  }, [storageKey, ready]);

  // 디바운스 자동저장(레이스-세이프: key·snapshot 캡처). ready 전에는 쓰지 않음.
  // S2: 같은 타이밍에 서버 draft 도 동기화(빈 맵 = 서버측 삭제, 실패는 서비스가 무시).
  useEffect(() => {
    if (!storageKey || !ready) return;
    const key = storageKey;
    const snapshot = drafts;
    const timer = setTimeout(() => {
      writeMap(key, snapshot);
      // 서버 복원 완료 전에는 서버 쓰기 금지(리뷰 확정 수정 — 빈 맵이 서버 draft 를 지우는 레이스).
      if (remoteRestoredKeyRef.current === key) draftService.save(key, snapshot);
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, ready]);

  // 종료/언마운트 시 동기 플러시(디바운스 대기분 보존). ready 전에는 미부착(빈 맵으로 저장본 삭제 방지).
  // S2: 언로드 중 일반 fetch 는 중단될 수 있어 keepalive 로 서버 플러시를 보장.
  useEffect(() => {
    if (!storageKey || !ready) return;
    const key = storageKey;
    const flush = () => {
      writeMap(key, draftsRef.current);
      if (remoteRestoredKeyRef.current === key) draftService.flush(key, draftsRef.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [storageKey, ready]);
}
