# Aurora Background 설치/설정 정의서

React/Next.js 화면 배경으로 쓰는 오로라 셰이더(CSS 그라디언트 애니메이션) 컴포넌트의 설치·설정 가이드.
원본: Aceternity UI "Aurora Background" + 본 프로젝트에서 수정한 사항 반영(§6).

- 적용 예시: 이 저장소 `my-app` (2026 하반기 사령장 수여식 화면 전체 배경)
- 원본 컴포넌트: `components/ui/aurora-background.tsx`
- 데모: `/aurora-demo` 라우트 (`components/aurora-background-demo.tsx`, framer-motion 필요 — 데모에만 필요)

---

## 1. 요구사항

| 항목 | 요구 | 비고 |
|---|---|---|
| React | 18+ | Next.js App Router 기준 `"use client"` 컴포넌트 |
| TypeScript | 권장 | JS 사용 시 타입 선언만 제거 |
| Tailwind CSS | v3 또는 v4 | 버전에 따라 설정 방법이 다름 (§3, §4) |
| cn 유틸 | 필수 | `clsx` + `tailwind-merge` (shadcn 표준) |

```bash
npm i clsx tailwind-merge
# 데모 화면까지 쓸 경우에만:
npm i framer-motion
```

`lib/utils.ts` (없으면 생성):

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
```

## 2. 컴포넌트 설치

`components/ui/aurora-background.tsx` 를 대상 프로젝트의 같은 경로로 복사한다.
shadcn 프로젝트가 아니어도 되지만, `@/components/ui`·`@/lib/utils` 경로 별칭(tsconfig `paths`)은 맞춰줄 것.

## 3. Tailwind **v4** 설정 (이 프로젝트 방식)

v4는 `tailwind.config.js`가 없으므로 전역 CSS(`app/globals.css`)에 아래를 추가한다.

```css
@import "tailwindcss";

/* 다크 모드를 OS 설정이 아닌 .dark 클래스로 제어 */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  /* 컴포넌트가 참조하는 색상 변수 (v3의 addVariablesForColors 플러그인 대체) */
  --white: #ffffff;
  --black: #000000;
  --transparent: transparent;
  --blue-300: #93c5fd;
  --blue-400: #60a5fa;
  --blue-500: #3b82f6;
  --indigo-300: #a5b4fc;
  --violet-200: #ddd6fe;
}

/* aurora 애니메이션 정의 */
@theme {
  --animate-aurora: aurora 60s linear infinite;

  @keyframes aurora {
    from {
      background-position: 50% 50%, 50% 50%;
    }
    to {
      background-position: 350% 50%, 350% 50%;
    }
  }
}
```

어두운 화면을 기본으로 쓰려면 루트 레이아웃에서 다크 클래스를 고정한다:

```tsx
<html lang="ko" className="dark">
```

## 4. Tailwind **v3** 설정 (참고)

v3 프로젝트라면 `tailwind.config.js`를 다음과 같이 확장한다 (원본 배포 방식).

```js
const {
  default: flattenColorPalette,
} = require("tailwindcss/lib/util/flattenColorPalette");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"], // 프로젝트 경로에 맞게
  darkMode: "class",
  theme: {
    extend: {
      animation: {
        aurora: "aurora 60s linear infinite",
      },
      keyframes: {
        aurora: {
          from: { backgroundPosition: "50% 50%, 50% 50%" },
          to: { backgroundPosition: "350% 50%, 350% 50%" },
        },
      },
    },
  },
  plugins: [addVariablesForColors],
};

// 모든 Tailwind 색상을 전역 CSS 변수로 노출 (예: var(--blue-500))
function addVariablesForColors({ addBase, theme }) {
  let allColors = flattenColorPalette(theme("colors"));
  let newVars = Object.fromEntries(
    Object.entries(allColors).map(([key, val]) => [`--${key}`, val])
  );
  addBase({ ":root": newVars });
}
```

## 5. 사용법

전체 화면 래퍼로 감싼다. `div` 표준 속성(onClick 등)을 그대로 전달할 수 있다.

```tsx
import { AuroraBackground } from "@/components/ui/aurora-background";

export default function Page() {
  return (
    <AuroraBackground showRadialGradient={false} className="w-full h-screen overflow-hidden">
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        {/* 화면 내용 */}
      </div>
    </AuroraBackground>
  );
}
```

### Props

| Prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `children` | ReactNode | 필수 | 배경 위에 얹을 내용. 오로라 레이어는 `pointer-events-none` |
| `showRadialGradient` | boolean | `true` | 우상단 타원 마스크. 전체 화면을 고르게 채우려면 `false` |
| `className` | string | - | 래퍼 div에 병합(cn). 기본: `h-[100vh] flex 중앙정렬, bg-zinc-50 dark:bg-zinc-900` |
| 기타 | `React.HTMLProps<HTMLDivElement>` | - | `onClick`, `onContextMenu` 등 래퍼 div로 전달 |

## 6. 이 프로젝트에서 수정한 사항 (원본과의 차이)

복사할 때 이 두 가지가 반영된 버전(`my-app/components/ui/aurora-background.tsx`)을 쓰는 것을 권장한다.

1. **`after:dark:` → `dark:after:` 순서 수정 (v4 필수)**
   원본의 `after:dark:[background-image:...]`는 Tailwind v4에서 `::after` 뒤에 `:where(.dark…)`가 붙는
   무효 선택자가 되어 다크용 그라디언트가 적용되지 않는다(화면이 밝게 반전되어 보임).
   v4에서는 반드시 `dark:after:[background-image:...]` 순서로 쓸 것. (v3는 양쪽 다 동작)

2. **라우트 전환 시 애니메이션 연속성**
   페이지 이동으로 컴포넌트가 리마운트되면 CSS 애니메이션이 0초부터 재시작한다.
   애니메이션이 60초 선형 무한 루프이므로, 마운트 시 벽시계 기준 음수 `animation-delay`를 걸어
   어떤 화면에서 마운트되든 같은 위상에서 이어지게 했다:

   ```tsx
   const AURORA_CYCLE_SECONDS = 60; // --animate-aurora 주기와 일치해야 함

   useLayoutEffect(() => {
     const elapsed = (Date.now() / 1000) % AURORA_CYCLE_SECONDS;
     wrapperRef.current?.style.setProperty("--aurora-delay", `-${elapsed.toFixed(3)}s`);
   }, []);
   ```

   그리고 `::after` 클래스에 `after:[animation-delay:var(--aurora-delay,0s)]` 추가.
   ⚠️ 애니메이션 주기(60s)를 바꾸면 `AURORA_CYCLE_SECONDS`도 같이 바꿔야 한다.

## 7. 커스터마이징

- **색상**: `:root`의 `--blue-*`, `--indigo-300`, `--violet-200` 값을 원하는 팔레트로 교체하면
  컴포넌트 수정 없이 오로라 색이 바뀐다. (예: 주황/금색 행사 테마 → `#fdba74`, `#fbbf24` 계열)
- **속도**: `--animate-aurora: aurora 60s linear infinite`의 `60s` 조정 (+ §6-2의 상수 동기화)
- **강도**: 컴포넌트의 `opacity-50`, `blur-[10px]` 조정
- **밝은 배경**: 다크 고정을 빼고 `.dark` 클래스를 토글하면 라이트/다크 모두 지원

## 8. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 화면이 뿌옇게/반전되어 보임 | v4에서 `after:dark:` 무효 선택자 | §6-1 순서 수정 |
| 오로라가 아예 안 보임 | 색상 변수 미정의 → 그라디언트 투명 | §3 `:root` 변수 확인 |
| 애니메이션이 안 움직임 | `--animate-aurora`/keyframes 누락 | §3 `@theme` 블록 확인 |
| 라이트 모드로 나옴 | `.dark` 클래스/`@custom-variant` 누락 | §3 하단 확인 |
| 페이지 이동마다 배경이 튐 | 리마운트로 애니메이션 재시작 | §6-2 패치 적용 |
