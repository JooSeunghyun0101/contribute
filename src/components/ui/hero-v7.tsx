import { cn } from "@/lib/utils"
import { AuroraBackground } from "@/components/ui/aurora-background"

type ShaderShowcaseProps = {
  className?: string
}

// v7 — Aurora Background (2026-07-31, docs/aurora-background-설치정의서.md).
// CSS repeating-gradient 애니메이션이라 WebGL 불필요 — 전부 로컬이라 내부망에서도 동작.
// 로그인 좌측은 항상 다크: tailwind darkMode 셀렉터가 [data-theme="dark"] 이므로 래퍼에
// 고정해 다크 그라디언트를 강제한다. (앱 토큰은 :root[data-theme="dark"] 스코프라 영향 없음)
export default function ShaderShowcase({ className }: ShaderShowcaseProps) {
  return (
    <div
      data-theme="dark"
      // h-full: 좌측 패널(flex stretch)이 100vh 보다 길어져도 오로라가 끝까지 채우도록.
      // min-h-screen 은 부모 높이를 못 읽는 비정상 상황의 폴백.
      className={cn("relative h-full min-h-screen w-full overflow-hidden bg-black", className)}
    >
      <AuroraBackground
        showRadialGradient={false}
        className="absolute inset-0 h-full w-full bg-black dark:bg-black"
      >
        {/* 좌측 스크림 — 로고·제목(왼쪽 배치) 가독성 확보(v6 과 동일 원칙) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.30) 28%, rgba(0,0,0,0.08) 55%, transparent 80%)",
          }}
        />
      </AuroraBackground>
    </div>
  )
}
