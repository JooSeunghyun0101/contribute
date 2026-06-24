import { useEffect, useRef, useState } from 'react';
import { DotLottieReact, type DotLottie } from '@lottiefiles/dotlottie-react';

// 달성 축하 오버레이 — 기존 FireworksOverlay 와 동일한 trigger 구조를 받아 드롭인 교체된다.
// (x, y 는 호환을 위해 유지하나 전체화면 축하 연출이라 위치는 사용하지 않는다.)
//
// 클릭(달성)마다 A~C 팔레트 색풀에서 무작위 3색을 뽑아 컨페티를 '런타임 재배색'한다.
// → 매번 색이 달라지고, 여러 개가 겹쳐(스택) 풍성하게 나온다.
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

// A~C 팔레트 색풀(중복 블루 #2563EB 제거). 모두 OK 오렌지 컨셉과 대비되는 색.
const POOL = ['2D7FF9', '8B3FE8', '00C2D1', 'DB2777', '84CC16', 'EC4899', '6366F1', '2DD4BF'];
// 원본 컨페티의 3개 색 슬롯(gold/pink/teal) — 이 hex 를 런타임에 무작위 3색으로 교체.
const SLOTS = ['f9c606', 'ea0043', '00d392'];

const hexToRgb01 = (h: string): [number, number, number] =>
  [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
const cellToHex = (k: number[]): string =>
  k.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

// 색풀에서 서로 다른 3색 무작위 추출(Fisher–Yates).
function pickThree(): [number, number, number][] {
  const a = [...POOL];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [hexToRgb01(a[0]), hexToRgb01(a[1]), hexToRgb01(a[2])];
}

// base Lottie 를 깊은 복제 후, 3슬롯을 무작위 3색으로 교체한 JSON 문자열 반환.
function recolor(base: Record<string, unknown>): string {
  const three = pickThree();
  const j = structuredClone(base);
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    if (o && typeof o === 'object') {
      const node = o as Record<string, any>;
      if ((node.ty === 'fl' || node.ty === 'st') && node.c?.a === 0 && Array.isArray(node.c.k)) {
        const slot = SLOTS.indexOf(cellToHex(node.c.k));
        if (slot >= 0) {
          const [r, g, b] = three[slot];
          const alpha = node.c.k.length > 3 ? node.c.k[3] : undefined;
          node.c.k = alpha === undefined ? [r, g, b] : [r, g, b, alpha];
        }
      }
      for (const k in node) walk(node[k]);
    }
  };
  walk(j);
  return JSON.stringify(j);
}

// 베이스 애니메이션 JSON 은 한 번만 받아 캐시한다.
let baseCache: Record<string, unknown> | null = null;
let basePromise: Promise<Record<string, unknown> | null> | null = null;
function loadBase(): Promise<Record<string, unknown> | null> {
  if (baseCache) return Promise.resolve(baseCache);
  if (!basePromise) {
    basePromise = fetch('/lottie/confetti-base.json')
      .then((r) => (r.ok ? r.json() : null) as Promise<Record<string, unknown> | null>)
      .then((j: Record<string, unknown> | null) => {
        baseCache = j;
        return j;
      })
      .catch((): Record<string, unknown> | null => null);
  }
  return basePromise;
}

type Item = { id: number; data: string };

export const CelebrationOverlay = ({ trigger }: CelebrationOverlayProps) => {
  const [items, setItems] = useState<Item[]>([]);
  const lastIdRef = useRef<number | null>(null);

  // 첫 달성 전에 베이스를 미리 받아둔다(첫 클릭 지연 방지).
  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (!trigger || trigger.id === lastIdRef.current) return;
    lastIdRef.current = trigger.id;
    const id = trigger.id;
    loadBase().then((base) => {
      if (!base) return;
      const data = recolor(base);
      setItems((prev) => {
        const next = [...prev, { id, data }];
        return next.length > MAX_CONCURRENT ? next.slice(next.length - MAX_CONCURRENT) : next;
      });
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
            data={item.data}
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
