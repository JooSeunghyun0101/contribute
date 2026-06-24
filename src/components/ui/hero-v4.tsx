"use client"

import { cn } from "@/lib/utils"
import { Component as OpenAiCodexAnimatedBackground } from "@/components/ui/open-ai-codex-animated-background"

type ShaderShowcaseProps = {
  className?: string
}

// v4 — Unicorn Studio OpenAI Codex animated background.
// 레퍼런스 데모(DemoOne)와 동일하게 씬을 그대로 풀-블리드로 렌더링한다.
// 색을 변질시키는 주황 오버레이는 두지 않는다(텍스트 가독성은 Login.tsx 의 text-shadow 로 처리).
export default function ShaderShowcase({ className }: ShaderShowcaseProps) {
  return (
    <div className={cn("min-h-screen w-full bg-black relative overflow-hidden", className)}>
      <OpenAiCodexAnimatedBackground className="absolute inset-0 h-full w-full" />
      {/* 다크 스크림 — 밝은 튤립 배경을 OK 다크 톤으로 눌러 로고·제목 가독성 확보.
          로고·제목이 왼쪽에 있어 왼쪽을 더 진하게, 오른쪽 튤립은 살린다. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, rgba(16,11,8,0.66) 0%, rgba(16,11,8,0.46) 26%, rgba(16,11,8,0.24) 52%, rgba(16,11,8,0.10) 78%, rgba(16,11,8,0.04) 100%)",
        }}
      />
      {/* 상·하단 비네팅으로 전체 명도 한 단계 더 낮춤 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,5,3,0.22) 0%, transparent 26%, transparent 76%, rgba(8,5,3,0.28) 100%)",
        }}
      />
    </div>
  )
}
