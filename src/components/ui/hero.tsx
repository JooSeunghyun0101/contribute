// 로그인 히어로 배경 — 버전 스위치.
// 다른 버전으로 교체하려면 아래 import 한 줄만 변경하면 된다.
//
//   v1~v3: ⚠ 유실 — 2026-06 배포 점검(죽은코드 정리) 때 파일이 삭제됐고, 이후 PII 히스토리
//          재작성(오펀 단일 커밋 ece8633)으로 git 에서도 복구 불가. 참고용 기록:
//            v1: MeshGradient 2 레이어 (@paper-design/shaders-react)
//            v2: MeshGradient + 우측하단 PulsingBorder + 회전 텍스트
//            v3: Three.js shader-lines (저주파 격자 + 컬러 라인)
//   v4: Unicorn Studio OpenAI Codex animated background (튤립 씬, 청크 ~1.27MB)
//   v5: 간소화 — CSS 그라디언트만(외부 라이브러리·원격 씬 없음, 내부망 안전) ← 현재
//
// 배경 위 텍스트(기여도 평가 / OK금융그룹 ...)는 Login.tsx 의 오버레이에서 따로 렌더링하므로
// 버전에 무관하게 유지된다.

export { default } from "./hero-v5"
