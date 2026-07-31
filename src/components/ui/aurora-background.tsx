import React, { useLayoutEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

// Aurora Background — docs/aurora-background-설치정의서.md 기준 설치본 (원본: Aceternity UI).
// 정의서 §6 수정 2건 반영:
//   1) dark:after: 순서 (원본 after:dark: 는 v4에서 무효 선택자 — v3에서도 권장 순서로 통일)
//   2) 마운트 시 벽시계 기준 음수 animation-delay → 리마운트돼도 60초 루프의 같은 위상에서 이어짐
// 이 프로젝트 변형(정의서와의 차이):
//   - <main> 래퍼 → <div> (로그인 좌측 패널 내부에 들어가므로 랜드마크 부적절)
//   - 색상 변수를 :root 대신 래퍼 인라인 스타일로 자급 — 전역 CSS 오염 없음
//   - 팔레트는 원본 blue 계열 대신 OK 주황/금색 (정의서 §7 예시 방향, 로그인 브랜드와 통일)
//   - 애니메이션 정의는 tailwind.config.ts 의 keyframes/animation.aurora (정의서 §4 v3 방식)

const AURORA_CYCLE_SECONDS = 60 // tailwind.config.ts animation.aurora 의 60s 와 일치해야 함

// 원본 변수 대응: --aurora-1←blue-500 · 2←indigo-300 · 3←blue-300 · 4←violet-200 · 5←blue-400.
// 값만 바꾸면 컴포넌트 수정 없이 오로라 색이 바뀐다(정의서 §7).
const AURORA_PALETTE = {
  "--aurora-1": "#3b82f6", // blue-500 (원본)
  "--aurora-2": "#a5b4fc", // indigo-300 (원본)
  "--aurora-3": "#93c5fd", // blue-300 (원본)
  "--aurora-4": "#ddd6fe", // violet-200 (원본)
  "--aurora-5": "#60a5fa", // blue-400 (원본)
  // OK 주황/금색 안: F55000 · FFB68A · FF9D00 · FFD557 · E04A00 (순서대로 1~5)
  "--white": "#fff",
  "--black": "#000",
  "--transparent": "transparent",
} as React.CSSProperties

interface AuroraBackgroundProps extends React.HTMLProps<HTMLDivElement> {
  children: ReactNode
  showRadialGradient?: boolean
}

export const AuroraBackground = ({
  className,
  children,
  showRadialGradient = true,
  style,
  ...props
}: AuroraBackgroundProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const elapsed = (Date.now() / 1000) % AURORA_CYCLE_SECONDS
    wrapperRef.current?.style.setProperty("--aurora-delay", `-${elapsed.toFixed(3)}s`)
  }, [])

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative flex h-[100vh] flex-col items-center justify-center bg-zinc-50 text-slate-950 dark:bg-zinc-900",
        className,
      )}
      style={{ ...AURORA_PALETTE, ...style }}
      {...props}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={cn(
            `pointer-events-none absolute -inset-[10px] opacity-50 blur-[10px] invert filter will-change-transform
            [--aurora:repeating-linear-gradient(100deg,var(--aurora-1)_10%,var(--aurora-2)_15%,var(--aurora-3)_20%,var(--aurora-4)_25%,var(--aurora-5)_30%)]
            [--dark-gradient:repeating-linear-gradient(100deg,var(--black)_0%,var(--black)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--black)_16%)]
            [--white-gradient:repeating-linear-gradient(100deg,var(--white)_0%,var(--white)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--white)_16%)]
            [background-image:var(--white-gradient),var(--aurora)]
            [background-size:300%,_200%]
            [background-position:50%_50%,50%_50%]
            after:absolute after:inset-0 after:content-[""]
            after:[background-image:var(--white-gradient),var(--aurora)]
            after:[background-size:200%,_100%]
            after:[background-attachment:fixed]
            after:[animation-delay:var(--aurora-delay,0s)]
            after:mix-blend-difference
            after:animate-aurora
            dark:invert-0
            dark:[background-image:var(--dark-gradient),var(--aurora)]
            dark:after:[background-image:var(--dark-gradient),var(--aurora)]`,
            showRadialGradient &&
              `[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,var(--transparent)_70%)]`,
          )}
        />
      </div>
      {children}
    </div>
  )
}
