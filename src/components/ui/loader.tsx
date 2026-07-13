import { motion } from 'motion/react';

// 단순 회전 로더(테두리 스핀). 인라인/작은 영역용.
export function ClassicLoader({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex h-10 w-10 animate-spin items-center justify-center rounded-full border-4 border-t-transparent ${className}`}
      style={{ borderColor: 'var(--ok-orange)', borderTopColor: 'transparent' }}
      role="status"
      aria-label="로딩 중"
    />
  );
}

// 스파이럴(원형 점) 로더 — 화면 전체/카드 로딩 강조용. (원본 framer-motion → 프로젝트의 motion/react)
export function SpiralLoader({ size = 64, color = 'var(--ok-orange)' }: { size?: number; color?: string }) {
  const dots = 8;
  const radius = size * 0.3125; // 64px 기준 20px
  const dot = Math.max(6, Math.round(size * 0.1875)); // 64px 기준 12px

  return (
    <div className="relative" style={{ height: size, width: size }} role="status" aria-label="로딩 중">
      {[...Array(dots)].map((_, index) => {
        const angle = (index / dots) * (2 * Math.PI);
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);

        return (
          <motion.div
            key={index}
            className="absolute rounded-full"
            style={{
              height: dot,
              width: dot,
              background: color,
              left: `calc(50% + ${x}px - ${dot / 2}px)`,
              top: `calc(50% + ${y}px - ${dot / 2}px)`,
            }}
            animate={{ scale: [0, 1, 0], opacity: [0, 1, 0] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: (index / dots) * 1.5,
              ease: 'easeInOut',
            }}
          />
        );
      })}
    </div>
  );
}

// 전체화면 오버레이 로딩 — 화면 전환·인증 부팅 등 "화면 전체가 준비 중"일 때.
// (버튼 인라인 '처리 중'/'AI 검토 중' 같은 부분 로딩에는 쓰지 않는다.)
export function FullScreenLoader({ message = '불러오는 중입니다…' }: { message?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={message}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        background: 'color-mix(in srgb, var(--surface-ink) 30%, transparent)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <SpiralLoader size={72} />
      {message && (
        <div
          style={{
            color: 'var(--surface-ink-fg)',
            fontSize: 'var(--fs-body)',
            fontWeight: 600,
            textShadow: '0 1px 8px color-mix(in srgb, var(--surface-ink) 55%, transparent)',
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}

export default SpiralLoader;
