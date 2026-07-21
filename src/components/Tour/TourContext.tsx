import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import TourOverlay from './TourOverlay';
import { TOURS, type TourId } from './tourDefinitions';
import { TOUR_START_EVENT, type TourStartEventDetail } from './tourTypes';

/**
 * 화면 안내(코치마크) 전역 상태.
 * - 자동 시작은 사용자·투어별 1회(localStorage `coachTour:{tourId}:{employeeId}`,
 *   기존 키 컨벤션 `selectedEvaluationPeriodId:{employeeId}` 를 따름).
 * - 각 페이지의 '화면 안내' 버튼으로는 언제든 다시 실행(force).
 * - 라우트 이동·역할 전환 시 자동 종료 — 앵커가 사라진 채 스텝만 건너뛰는 상태를 막는다.
 */
interface TourContextValue {
  activeTourId: TourId | null;
  startTour: (id: TourId, options?: { force?: boolean }) => void;
  stopTour: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

const seenKeyFor = (tourId: string, employeeId: string) =>
  `coachTour:${tourId}:${employeeId || 'anonymous'}`;

export const TourProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const employeeId = user?.employeeId ?? '';
  const role = user?.role ?? null;
  const { pathname } = useLocation();

  const [activeTourId, setActiveTourId] = useState<TourId | null>(null);
  const activeRef = useRef<TourId | null>(null);

  const stopTour = useCallback(() => {
    activeRef.current = null;
    setActiveTourId(null);
  }, []);

  const startTour = useCallback(
    (id: TourId, options?: { force?: boolean }) => {
      if (activeRef.current) return; // 이미 진행 중이면 무시
      if (!options?.force) {
        try {
          if (localStorage.getItem(seenKeyFor(id, employeeId))) return;
        } catch {
          // 저장소를 못 쓰는 환경에서는 자동 시작하지 않음 — 매 방문마다 뜨는 것 방지
          return;
        }
      }
      try {
        // 시작 시점에 기록 — 중간에 이탈해도 다시 자동으로 뜨지 않는다(수동 재실행은 가능)
        localStorage.setItem(seenKeyFor(id, employeeId), new Date().toISOString());
      } catch {
        /* 기록 실패는 무시 — 이번 세션은 그대로 진행 */
      }
      activeRef.current = id;
      setActiveTourId(id);
      // 앵커가 접힌 아코디언 안에 있는 화면이 컨테이너를 펼칠 수 있도록 알린다
      window.dispatchEvent(
        new CustomEvent<TourStartEventDetail>(TOUR_START_EVENT, { detail: { tourId: id } }),
      );
    },
    [employeeId],
  );

  // 라우트·역할이 바뀌면 종료(첫 마운트 제외)
  const prevPathRef = useRef(pathname);
  const prevRoleRef = useRef(role);
  useEffect(() => {
    if (prevPathRef.current !== pathname || prevRoleRef.current !== role) {
      prevPathRef.current = pathname;
      prevRoleRef.current = role;
      stopTour();
    }
  }, [pathname, role, stopTour]);

  const value = useMemo(
    () => ({ activeTourId, startTour, stopTour }),
    [activeTourId, startTour, stopTour],
  );

  const tour = activeTourId ? TOURS[activeTourId] : null;

  return (
    <TourContext.Provider value={value}>
      {children}
      {tour && <TourOverlay key={tour.id} tour={tour} onClose={stopTour} />}
    </TourContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- 컨텍스트 훅 동반 export (AuthContext 와 동일 패턴)
export const useTour = (): TourContextValue => {
  const context = useContext(TourContext);
  if (!context) throw new Error('useTour 는 TourProvider 내부에서만 사용할 수 있습니다.');
  return context;
};

/**
 * 화면 데이터가 준비되면(ready=true) 해당 투어를 1회 자동 시작한다.
 * 이미 본 사용자는 startTour 의 seen 체크에서 걸러진다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- 컨텍스트 훅 동반 export
export const useTourAutoStart = (tourId: TourId, ready: boolean, delayMs = 900) => {
  const { startTour } = useTour();
  const firedRef = useRef(false);
  useEffect(() => {
    if (!ready || firedRef.current) return;
    // 아코디언 스프링 등 초기 애니메이션이 자리 잡은 뒤 시작.
    // fired 표시는 '실제로 시작한 순간'에만 — 대기 중 ready 가 잠깐 꺼졌다 켜져도
    // (기간 컨텍스트 로드로 인한 재조회 등) 자동 시작 기회가 소멸하지 않는다.
    const timer = window.setTimeout(() => {
      firedRef.current = true;
      startTour(tourId);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [ready, startTour, tourId, delayMs]);
};
