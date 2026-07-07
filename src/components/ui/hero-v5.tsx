import { cn } from "@/lib/utils"

type ShaderShowcaseProps = {
  className?: string
}

// v5 — 간소화 버전(2026-07-07 사용자 요구). 외부 라이브러리·원격 씬 없이 CSS 만으로
// OK 브랜드 톤(다크 브라운 + 오렌지)의 그라디언트 배경을 그린다.
//   - 번들 ~0KB (v4 unicornstudio 청크 1.27MB 를 로그인에서 배제)
//   - 내부망(외부 CDN 차단)에서도 동일하게 렌더링
//   - prefers-reduced-motion 이면 애니메이션 정지
// 배경 위 텍스트는 Login.tsx 오버레이가 그리므로 여기선 배경만 책임진다.
export default function ShaderShowcase({ className }: ShaderShowcaseProps) {
  return (
    <div className={cn("min-h-screen w-full relative overflow-hidden", className)} style={{ background: "#100b08" }}>
      <style>{`
        @keyframes hero5-drift-a {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(6%, -4%) scale(1.12); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes hero5-drift-b {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(-5%, 6%) scale(1.08); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero5-blob { animation: none !important; }
        }
      `}</style>
      {/* 오렌지 광원 — 우상단에서 크게 번지는 브랜드 컬러(OK Orange #F55000 계열) */}
      <div
        className="hero5-blob absolute pointer-events-none"
        style={{
          top: "-30%",
          right: "-15%",
          width: "80%",
          height: "110%",
          background: "radial-gradient(closest-side, rgba(245,80,0,0.55), rgba(245,80,0,0.18) 55%, transparent 75%)",
          filter: "blur(40px)",
          animation: "hero5-drift-a 18s ease-in-out infinite",
        }}
      />
      {/* 앰버 보조광 — 하단 중앙, 서브 컬러(Yellow 계열)로 온도만 살짝 */}
      <div
        className="hero5-blob absolute pointer-events-none"
        style={{
          bottom: "-40%",
          left: "10%",
          width: "70%",
          height: "90%",
          background: "radial-gradient(closest-side, rgba(224,146,26,0.30), rgba(224,146,26,0.10) 55%, transparent 75%)",
          filter: "blur(50px)",
          animation: "hero5-drift-b 24s ease-in-out infinite",
        }}
      />
      {/* 다크 브라운 심도 — 좌측을 눌러 로고·제목(왼쪽 배치) 가독성 확보(v4 와 동일 원칙) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, rgba(16,11,8,0.72) 0%, rgba(16,11,8,0.45) 30%, rgba(16,11,8,0.15) 60%, rgba(16,11,8,0.05) 100%)",
        }}
      />
      {/* 상·하단 비네팅 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,5,3,0.30) 0%, transparent 28%, transparent 72%, rgba(8,5,3,0.34) 100%)",
        }}
      />
    </div>
  )
}
