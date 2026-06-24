import { useEffect, useRef, useState } from 'react';
import { DotLottieReact, type DotLottie } from '@lottiefiles/dotlottie-react';

// 달성 축하 오버레이 — 기존 FireworksOverlay 와 동일한 trigger 구조를 받아 드롭인 교체된다.
// (x, y 는 호환을 위해 유지하나 전체화면 축하 연출이라 위치는 사용하지 않는다.)
export type CelebrationTrigger = {
  id: number;
  x: number;
  y: number;
};

type CelebrationOverlayProps = {
  trigger: CelebrationTrigger | null;
};

// 동시에 떠 있을 수 있는 최대 개수(연타 시 무한정 쌓이지 않도록 상한).
const MAX_CONCURRENT = 12;

export const CelebrationOverlay = ({ trigger }: CelebrationOverlayProps) => {
  // 새 trigger 마다 인스턴스를 '추가'한다(기존 것을 리셋/교체하지 않음).
  // 각 인스턴스는 재생 완료 시 스스로 제거 → 연타하면 여러 컨페티가 겹쳐 풍성하게 나온다.
  const [items, setItems] = useState<CelebrationTrigger[]>([]);
  const lastIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!trigger || trigger.id === lastIdRef.current) return;
    lastIdRef.current = trigger.id;
    setItems((prev) => {
      const next = [...prev, trigger];
      // 상한 초과 시 가장 오래된 것부터 버린다.
      return next.length > MAX_CONCURRENT ? next.slice(next.length - MAX_CONCURRENT) : next;
    });
  }, [trigger]);

  if (items.length === 0) return null;

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {items.map((item) => {
        const handleRef = (dotLottie: DotLottie | null) => {
          if (!dotLottie) return;
          const finish = () => remove(item.id);
          dotLottie.addEventListener('complete', finish);
          // 안전장치: complete 이벤트 누락 시에도 일정 시간 후 정리
          window.setTimeout(finish, 6000);
        };
        return (
          <DotLottieReact
            key={item.id}
            src="/lottie/achievement.lottie"
            autoplay
            loop={false}
            dotLottieRefCallback={handleRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
            }}
          />
        );
      })}
    </div>
  );
};
