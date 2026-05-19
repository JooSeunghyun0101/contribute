// 로그인 히어로 배경 셰이더 — 버전 스위치.
// 다른 버전으로 교체하려면 아래 import 한 줄만 변경하면 된다.
//
//   v1: 현재 적용 디자인 (MeshGradient 2 레이어, 깔끔)
//   v2: 최초 디자인 (MeshGradient + 우측하단 PulsingBorder + 회전 텍스트)
//   v3: Three.js shader-lines (저주파 격자 + 컬러 라인)
//
// 배경 위 텍스트(기여도 평가 / OK금융그룹 ...)는 Login.tsx 의 오버레이에서 따로 렌더링하므로
// 버전에 무관하게 유지된다.

export { default } from "./hero-v1"
