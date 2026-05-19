"use client"

import { useEffect, useRef, useState } from "react"
import { MeshGradient } from "@paper-design/shaders-react"

import { cn } from "@/lib/utils"

type ShaderShowcaseProps = {
  className?: string
}

const SHADER_MAX_PIXEL_COUNT = 3840 * 2160

// v1 — 현재 적용 중인 디자인. MeshGradient 2 레이어 + radial 오버레이.
export default function ShaderShowcase({ className }: ShaderShowcaseProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    const handleMouseEnter = () => setIsActive(true)
    const handleMouseLeave = () => setIsActive(false)

    const container = containerRef.current
    if (container) {
      container.addEventListener("mouseenter", handleMouseEnter)
      container.addEventListener("mouseleave", handleMouseLeave)
    }

    return () => {
      if (container) {
        container.removeEventListener("mouseenter", handleMouseEnter)
        container.removeEventListener("mouseleave", handleMouseLeave)
      }
    }
  }, [])

  return (
    <div ref={containerRef} className={cn("min-h-screen bg-[#050302] relative overflow-hidden", className)}>
      <MeshGradient
        className="absolute inset-0 h-full w-full"
        colors={["#050302", "#211B17", "#7C2D12", "#F97316", "#FDBA74"]}
        speed={isActive ? 0.42 : 0.28}
        distortion={0.76}
        swirl={0.22}
        grainMixer={0.05}
        grainOverlay={0.03}
        minPixelRatio={2}
        maxPixelCount={SHADER_MAX_PIXEL_COUNT}
      />
      <MeshGradient
        className="absolute inset-0 h-full w-full opacity-70"
        colors={["#1A0E07", "#5B4632", "#C2670D", "#F55000", "#F8F4EE"]}
        speed={isActive ? 0.28 : 0.18}
        distortion={0.48}
        swirl={0.38}
        grainMixer={0.08}
        grainOverlay={0.04}
        rotation={12}
        scale={1.18}
        minPixelRatio={2}
        maxPixelCount={SHADER_MAX_PIXEL_COUNT}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(900px 520px at 25% 28%, rgba(245,80,0,0.20), transparent 64%), linear-gradient(90deg, rgba(5,3,2,0.06), rgba(5,3,2,0.22))",
        }}
      />
    </div>
  )
}
