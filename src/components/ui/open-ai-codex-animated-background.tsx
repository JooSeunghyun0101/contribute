"use client"

import { cn } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"
import UnicornScene from "unicornstudio-react"

export const useWindowSize = () => {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  })

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    window.addEventListener("resize", handleResize)
    handleResize()

    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return windowSize
}

type ComponentProps = {
  className?: string
}

// 21st.dev 레퍼런스(serjobas/open-ai-codex-animated-background)를 그대로 따른다.
// 씬 본래 색을 변질시키지 않도록 블렌드 모드·주황 폴백·DPI 오버라이드 없이 렌더링한다.
// 로그인 좌측 패널 안에 들어가므로 width/height만 윈도우 대신 컨테이너 크기에 맞춘다.
export const Component = ({ className }: ComponentProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      setSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full w-full overflow-hidden bg-black", className)}
    >
      {size.width > 1 && size.height > 1 && (
        <UnicornScene
          production={true}
          // ⚠️ TEMP(평가용): 무료 플랜 타일 워터마크(us_fwb 레이어) 제거한 로컬 씬으로 어울림만 확인.
          //    배포 전 반드시 유료 전환 후 projectId 로 복귀할 것.
          //    원복: 아래 jsonFilePath 줄을 지우고  projectId="Ezjxl3RlPWxl7Xls0dH8"  로 교체.
          jsonFilePath="/unicorn/tulip.json"
          width={size.width}
          height={size.height}
          className="h-full w-full"
          onError={(error) =>
            console.error("[UnicornScene] 씬 로드 실패:", error)
          }
        />
      )}
    </div>
  )
}
