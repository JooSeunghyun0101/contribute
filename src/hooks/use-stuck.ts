import { useEffect, useRef, useState } from 'react';

// position: sticky 한 PageHeader 아래로 sentinel(=감지 기준 지점)이 가려지는 순간을 감지하는 훅.
// 좌표 비교 방식: 스크롤마다 sentinel 의 top 과 고정 헤더의 bottom 을 getBoundingClientRect 로 직접 비교한다.
// (IntersectionObserver rootMargin 보다 정확 — 헤더가 가리는 영역만큼의 오차가 없다.)
// 스크롤 컨테이너는 AppLayout 의 <main overflow-y-auto>.
const getScrollParent = (node: HTMLElement | null): HTMLElement | null => {
  let el = node?.parentElement ?? null;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
    el = el.parentElement;
  }
  return null;
};

/**
 * @param enabled sentinel 이 실제로 렌더된 뒤에만 관찰하도록 하는 플래그(로딩/빈 상태 가드).
 * @returns sentinelRef 를 기준 지점(보통 카드 묶음 바로 뒤)에 달고, stuck 으로 "헤더 아래로 가려졌는지"를 읽는다.
 */
export function useStuck(enabled = true) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const el = sentinelRef.current;
    if (!el) return;
    const root = getScrollParent(el);
    const scrollTarget: HTMLElement | Window = root ?? window;
    const header = (root ?? document).querySelector<HTMLElement>('[data-sticky-header]');

    const update = () => {
      const sentinelTop = el.getBoundingClientRect().top;
      // 고정 헤더의 하단 y(뷰포트 좌표). 헤더가 없으면 스크롤 컨테이너 상단.
      const headerBottom = header
        ? header.getBoundingClientRect().bottom
        : root
          ? root.getBoundingClientRect().top
          : 0;
      // sentinel 이 헤더 하단까지 올라오면(=그 위 카드들이 헤더에 가려지면) stuck.
      setStuck(sentinelTop <= headerBottom);
    };

    update();
    scrollTarget.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scrollTarget.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [enabled]);

  return { sentinelRef, stuck };
}
