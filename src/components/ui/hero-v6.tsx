import { cn } from "@/lib/utils"
import { ColorPanels } from "@paper-design/shaders-react"

type ShaderShowcaseProps = {
  className?: string
}

// v6 — paper.design ColorPanels (2026-07-07 사용자 지정).
// 설정값은 사용자가 공유한 shaders.paper.design URL 파라미터 그대로:
// colors=ff9d00,fd4f30,809bff,6d2eff,333aff,f15cff,ffd557 · colorBack=000000
// density=3 · angle=0/0 · length=1.1 · edges=false · blur=0 · fadeIn=1 · fadeOut=0.3
// gradient=0 · speed=0.5 · scale=0.8 · rotation=0 · offset=0/0
// WebGL 로컬 렌더링(원격 씬 없음)이라 내부망에서도 동작한다.
export default function ShaderShowcase({ className }: ShaderShowcaseProps) {
  return (
    <div className={cn("min-h-screen w-full bg-black relative overflow-hidden", className)}>
      <ColorPanels
        className="absolute inset-0 h-full w-full"
        colors={["#ff9d00", "#fd4f30", "#809bff", "#6d2eff", "#333aff", "#f15cff", "#ffd557"]}
        colorBack="#000000"
        density={3}
        angle1={0}
        angle2={0}
        length={1.1}
        edges={false}
        blur={0}
        fadeIn={1}
        fadeOut={0.3}
        gradient={0}
        speed={0.5}
        scale={0.8}
        rotation={0}
        offsetX={0}
        offsetY={0}
      />
      {/* 좌측 스크림 — 로고·제목(왼쪽 배치) 가독성 확보(v4 와 동일 원칙, 배경이 이미 검정이라 약하게) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.30) 28%, rgba(0,0,0,0.08) 55%, transparent 80%)",
        }}
      />
    </div>
  )
}
