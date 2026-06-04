import { useEffect, useState } from 'react';
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

export const CelebrationOverlay = ({ trigger }: CelebrationOverlayProps) => {
  // 새 trigger.id 마다 DotLottie 를 remount(key) 해 처음부터 1회 재생, 완료되면 언마운트.
  const [active, setActive] = useState<CelebrationTrigger | null>(null);

  useEffect(() => {
    if (trigger) setActive(trigger);
  }, [trigger]);

  if (!active) return null;

  const handleRef = (dotLottie: DotLottie | null) => {
    if (!dotLottie) return;
    const finish = () => setActive(null);
    dotLottie.addEventListener('complete', finish);
    // 안전장치: complete 이벤트 누락 시에도 일정 시간 후 정리
    window.setTimeout(finish, 6000);
  };

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <DotLottieReact
        key={active.id}
        src="/lottie/achievement.lottie"
        autoplay
        loop={false}
        dotLottieRefCallback={handleRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};
