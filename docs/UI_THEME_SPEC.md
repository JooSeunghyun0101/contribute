# UI 테마 기술서 (UI Theme Technical Specification)

> **기여도 평가 시스템** — Solar Dusk × Developer Brand Design System
> Version 1.0 | 2026-03-16

---

## 1. 디자인 철학 (Design Philosophy)

### 브랜드 가치 (Brand Values)

| 가치 | 설명 |
|------|------|
| **Developer-centricity** | 개발자 중심의 직관적인 인터페이스 |
| **Speed** | 빠른 정보 전달과 최소한의 인지 부하 |
| **Transparency** | 명확한 데이터 표현과 상태 가시성 |
| **Openness** | 열린 구조, 확장 가능한 컴포넌트 설계 |

### 브랜드 미학 (Brand Aesthetic)

- **Low-fi High-tech** — 복잡한 인터랙션 없이 기술적 정밀함 강조
- **Developer-centric Minimalism** — 불필요한 장식 제거, 기능 우선
- **Terminal Chic** — 모노스페이스 타이포그래피, 어두운 배경, 코드 감성
- **Monochromatic Precision** — 단색 팔레트에 포인트 컬러 1개
- **Infrastructure-first** — 데이터와 상태를 시각적 계층으로 명확하게 표현

### 브랜드 톤 (Brand Tone of Voice)

- **Technical** — 전문 용어 사용, 불필요한 수식어 제거
- **Efficient** — 최소 클릭, 최대 정보 밀도
- **Professional** — 신뢰감을 주는 일관된 인터랙션
- **Innovative** — 현대적인 UI 패턴, 최신 디자인 관습 채택

---

## 2. 색상 시스템 (Color System)

### CSS 커스텀 프로퍼티 (Dark Mode 기준)

```css
:root.dark {
  /* === Core Palette === */
  --background:   #1c1917;   /* 메인 배경 — 짙은 갈색 다크 */
  --foreground:   #f5f5f4;   /* 기본 텍스트 — 웜 화이트 */

  /* === Surface === */
  --card:         #292524;   /* 카드/패널 배경 */
  --sidebar:      #292524;   /* 사이드바 배경 */
  --muted:        #292524;   /* 비활성 영역 배경 */
  --muted-foreground: #a8a29e; /* 보조 텍스트 — 중간 회갈색 */

  /* === Brand === */
  --primary:      #f97316;   /* 메인 포인트 — 선셋 오렌지 */
  --primary-foreground: #1c1917; /* 주 버튼 위 텍스트 */

  /* === UI Structure === */
  --border:       #44403c;   /* 구분선, 테두리 */
  --input:        #44403c;   /* 인풋 테두리 */
  --ring:         #f97316;   /* 포커스 링 */
  --radius:       0.3rem;    /* 기본 border-radius */

  /* === Semantic === */
  --destructive:  oklch(0.577 0.245 27.325);  /* 위험/삭제 — 레드 */
  --accent:       #292524;
  --accent-foreground: #f5f5f4;

  /* === 커스텀 OK 팔레트 === */
  --ok-orange:    25 95% 53%;   /* 강조 오렌지 (HSL) */
  --ok-yellow:    45 93% 47%;   /* 강조 옐로우 */
  --ok-gold:      45 70% 55%;   /* 골드 (중간 채도) */
}
```

### 색상 사용 지침 (Usage Guide)

| 목적 | CSS Variable | Tailwind Class |
|------|-------------|----------------|
| 페이지 배경 | `--background` | `bg-background` |
| 카드 배경 | `--card` | `bg-card` |
| 비활성 영역 배경 | `--muted` + 투명도 | `bg-muted/30` |
| 기본 텍스트 | `--foreground` | `text-foreground` |
| 보조 텍스트 | `--muted-foreground` | `text-muted-foreground` |
| 포인트 색상 | `--primary` | `text-primary`, `bg-primary` |
| 포인트 배경 (연한) | `--primary` + 투명도 | `bg-primary/10`, `bg-primary/5` |
| 테두리 | `--border` | `border-border` |
| 포인트 테두리 | `--primary` + 투명도 | `border-primary/30`, `border-primary/50` |
| 성공/달성 | emerald | `text-emerald-400`, `bg-emerald-500/20` |
| 경고/진행중 | amber | `text-amber-400`, `bg-amber-500/10` |
| 위험/삭제 | `--destructive` | `text-destructive`, `bg-destructive/20` |

### 금지 색상 (Hardcoded Classes — 사용 금지)

```
❌ text-gray-*, bg-gray-*, border-gray-*
❌ text-orange-*, bg-orange-*, border-orange-*
❌ text-yellow-*, bg-yellow-*, border-yellow-*
❌ text-blue-*, text-purple-*, bg-purple-*
❌ bg-white, text-white (예외: text-primary-foreground)
❌ bg-[#F55000], bg-[#FFAA00] 등 hex 하드코딩
```

---

## 3. 타이포그래피 시스템 (Typography System)

### 폰트 패밀리 (Font Families)

```css
--font-sans:  'Oxanium', sans-serif;      /* UI 기본 폰트 — 기하학적 산세리프 */
--font-serif: 'Merriweather', serif;      /* 강조/태그라인 — 웜 세리프 */
--font-mono:  'Fira Code', monospace;     /* 코드/데이터 표시 */
```

### 타이포그래피 스케일 (Typography Scale)

```
페이지 제목 (Page Title):
  font-size:   text-2xl (24px)
  font-weight: font-bold
  font-family: Oxanium
  color:       text-foreground

섹션 제목 (Section Title):
  font-size:   text-lg (18px)
  font-weight: font-semibold
  font-family: Oxanium
  color:       text-foreground

카드 제목 (Card Title):
  font-size:   text-sm (14px)
  font-weight: font-semibold
  color:       text-foreground

본문 (Body):
  font-size:   text-sm (14px)
  font-weight: font-normal
  color:       text-foreground

보조 텍스트 (Muted):
  font-size:   text-xs (12px) ~ text-sm (14px)
  color:       text-muted-foreground

태그라인 (Tagline) — 브랜드 강조:
  font-family: Merriweather (serif)
  font-style:  italic
  color:       lime / chartreuse (#a3e635 / text-lime-400)
  font-size:   text-xl ~ text-2xl

데이터/코드 (Data/Code):
  font-family: Fira Code (mono)
  font-size:   text-xs ~ text-sm
  color:       text-primary 또는 text-foreground
```

### Tailwind 타이포그래피 클래스 조합

```tsx
// 페이지 제목
<h1 className="text-2xl font-bold text-foreground font-sans">

// 섹션 제목
<h2 className="text-lg font-semibold text-foreground">

// 보조 텍스트
<p className="text-sm text-muted-foreground">

// 태그라인 (브랜드)
<span className="text-xl italic font-serif text-lime-400">

// 데이터 수치
<span className="font-mono text-primary font-bold">

// 라벨
<label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
```

---

## 4. 컴포넌트 시스템 (Component System)

### 4-1. Badge / Tag (필 모양 뱃지)

브랜드 이미지에서 확인된 핵심 컴포넌트: **테두리만 있는 pill 형태**

```tsx
// === Pill Outline Badge (브랜드 기본) ===
// 배경 없음, 테두리만, border-radius: 999px
<span className="
  inline-flex items-center
  px-3 py-1
  rounded-full          /* border-radius: 999px */
  border border-border  /* 1px 테두리, 배경 없음 */
  text-xs font-medium
  text-foreground
">
  Developer-centricity
</span>

// === Primary Variant (강조) ===
<span className="
  inline-flex items-center
  px-3 py-1 rounded-full
  border border-primary/50
  text-xs font-medium text-primary
  bg-primary/5
">
  평가중
</span>

// === Success Variant ===
<span className="
  inline-flex items-center
  px-3 py-1 rounded-full
  border border-emerald-500/40
  text-xs font-medium text-emerald-400
  bg-emerald-500/10
">
  달성
</span>

// === Destructive Variant ===
<span className="
  inline-flex items-center
  px-3 py-1 rounded-full
  border border-destructive/40
  text-xs font-medium text-destructive
  bg-destructive/10
">
  미달성
</span>

// === Warning/In-Progress Variant ===
<span className="
  inline-flex items-center
  px-3 py-1 rounded-full
  border border-amber-500/40
  text-xs font-medium text-amber-400
  bg-amber-500/10
">
  진행중
</span>

// === New/Notification Badge ===
<span className="
  inline-flex items-center
  px-2 py-0.5 rounded-full
  bg-primary text-primary-foreground
  text-xs font-medium
">
  new
</span>
```

#### Badge CSS 커스텀 클래스 (index.css에 추가)

```css
/* Pill Outline Badges */
.badge-outline {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  border: 1px solid hsl(var(--border));
  font-size: 0.75rem;
  font-weight: 500;
  color: hsl(var(--foreground));
  background: transparent;
}

.badge-outline-primary {
  border-color: hsl(var(--primary) / 0.5);
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.05);
}

.badge-outline-success {
  border-color: rgb(52 211 153 / 0.4);
  color: rgb(52 211 153);  /* emerald-400 */
  background: rgb(16 185 129 / 0.1);
}

.badge-outline-warning {
  border-color: rgb(251 191 36 / 0.4);
  color: rgb(251 191 36);  /* amber-400 */
  background: rgb(245 158 11 / 0.1);
}
```

---

### 4-2. Card / Panel

```tsx
// === 기본 카드 ===
<div className="
  bg-card
  border border-border
  rounded-lg
  p-4
  shadow-sm
">

// === 강조 카드 (primary 테두리) ===
<div className="
  bg-card
  border border-primary/30
  rounded-lg
  p-4
">

// === 비활성/배경 영역 ===
<div className="
  bg-muted/30
  border border-border
  rounded-lg
  p-4
">

// === 호버 카드 ===
<div className="
  bg-card
  border border-border hover:border-primary/30
  rounded-lg p-4
  transition-colors cursor-pointer
">
```

---

### 4-3. Button

```tsx
// === Primary Button ===
<Button className="
  bg-primary text-primary-foreground
  hover:bg-primary/90
  rounded-md
">

// === Outline Button ===
<Button variant="outline" className="
  border-primary text-primary
  hover:bg-primary/10
  rounded-md
">

// === Ghost Button ===
<Button variant="ghost" className="
  text-muted-foreground
  hover:text-foreground hover:bg-muted/50
">

// === Destructive Button ===
<Button className="
  text-red-400 hover:text-red-300
  hover:bg-destructive/10
">
```

---

### 4-4. Input / Form Controls

```tsx
// === 기본 Input ===
<input className="
  bg-input-bg border border-border
  rounded-md px-3 py-2
  text-sm text-foreground
  placeholder:text-muted-foreground
  focus:outline-none
  focus:ring-2 focus:ring-primary/20
  focus:border-primary/30
  transition-colors
">

// === Textarea ===
<textarea className="
  bg-muted/20 border border-border
  rounded-md p-3
  text-sm text-foreground
  placeholder:text-muted-foreground
  focus:ring-2 focus:ring-primary/20
  focus:border-primary/30
  resize-none
">
```

---

### 4-5. Tooltip

```tsx
<TooltipContent className="
  max-w-xs p-3
  bg-card border border-border
  shadow-lg rounded-md
  text-sm text-foreground leading-relaxed
">
```

---

### 4-6. Status Indicators (점수/달성 상태)

```css
/* index.css에 정의된 시맨틱 클래스 활용 */

/* 점수별 색상 */
.score-1 { color: hsl(var(--ok-orange)); }
.score-2 { color: hsl(var(--ok-yellow)); }
.score-3 { color: hsl(var(--ok-gold)); }
.score-4 { color: hsl(var(--primary)); }

/* 달성 상태 */
.status-achieved     { color: rgb(52 211 153); }   /* emerald-400 */
.status-not-achieved { color: hsl(var(--destructive)); }
.status-in-progress  { color: rgb(251 191 36); }   /* amber-400 */
```

---

### 4-7. 스코어링 매트릭스 셀 (ScoringChart)

```tsx
// 선택된 셀 (current selection)
className="bg-emerald-500/20 text-emerald-400 border-emerald-500 ring-2 ring-emerald-500/30"

// 일반 셀
className="bg-muted/50 text-muted-foreground border-border"

// 행 헤더 (방식) — 선택됨
className="bg-primary text-primary-foreground border-primary/80 border-2 shadow-lg scale-105"

// 행 헤더 — 비선택
className="bg-primary/20 text-foreground hover:bg-primary/30"

// 열 헤더 (범위) — 선택됨
className="bg-amber-500 text-white border-amber-600 border-2 shadow-lg scale-105"

// 열 헤더 — 비선택
className="bg-amber-500/20 text-foreground hover:bg-amber-500/30"

// 기여없음 버튼
className="bg-destructive/20 text-foreground hover:bg-destructive/30"
```

---

## 5. 레이아웃 시스템 (Layout System)

### 5-1. 사이드바 레이아웃

```
전체 구조:
┌──────────┬────────────────────────────────────┐
│          │                                    │
│ Sidebar  │           Main Content             │
│ 240px    │           flex-1                   │
│ (접힘:   │                                    │
│  60px)   │                                    │
│          │                                    │
└──────────┴────────────────────────────────────┘

bg-sidebar    bg-background
border-r
border-border
```

```tsx
// AppLayout 기본 구조
<div className="flex h-screen bg-background overflow-hidden">
  {/* Sidebar */}
  <aside className="
    flex flex-col
    bg-sidebar border-r border-border
    transition-all duration-300
    w-[240px] // 또는 w-[60px] 접힌 상태
  ">

  {/* Main */}
  <main className="flex-1 flex flex-col overflow-hidden">
    {/* Header */}
    <header className="bg-sidebar border-b border-border px-6 py-4">

    {/* Content */}
    <div className="flex-1 overflow-auto p-6">
```

---

### 5-2. 2열 그리드 레이아웃 (브랜드 이미지 기반)

브랜드 이미지의 핵심 레이아웃 패턴: **두 섹션을 수직 구분선으로 나누는 2열 구조**

```tsx
// 2열 그리드 + 중앙 구분선
<div className="grid grid-cols-2 divide-x divide-border">
  {/* 좌측 섹션 */}
  <div className="pr-8">
    <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
      Tagline
    </h3>
    <p className="text-xl italic font-serif text-lime-400 leading-relaxed">
      "기여도를 정확하게 측정하는 가장 빠른 방법"
    </p>
  </div>

  {/* 우측 섹션 */}
  <div className="pl-8">
    <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
      Brand Values
    </h3>
    <div className="flex flex-wrap gap-2">
      {['공정성', '투명성', '효율성', '신뢰성'].map(v => (
        <span key={v} className="
          px-3 py-1 rounded-full
          border border-border
          text-xs text-foreground
        ">{v}</span>
      ))}
    </div>
  </div>
</div>

// 수직 구분선 (divider)
<div className="border-l border-border h-full" />

// 수평 구분선
<hr className="border-border" />
```

---

### 5-3. 카드 그리드

```tsx
// 대시보드 통계 카드 그리드
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">

// 평가 목록 그리드
<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

// 반응형 단일 컬럼 (모바일 우선)
<div className="space-y-3">
```

---

## 6. 아이콘 시스템 (Icon System)

lucide-react 기반, 크기별 사용 지침:

```tsx
// 인라인 아이콘 (텍스트와 함께)
<Icon className="h-4 w-4 text-muted-foreground" />

// 강조 아이콘 (primary 컬러)
<Icon className="h-4 w-4 text-primary" />

// 대형 상태 아이콘
<Icon className="h-6 w-6 text-foreground" />

// 카드 내 아이콘
<Icon className="h-5 w-5 text-muted-foreground" />

// 버튼 내 아이콘
<Icon className="h-4 w-4 mr-2" />

// 성공 아이콘
<CheckCircle className="h-4 w-4 text-emerald-400" />

// 경고 아이콘
<AlertCircle className="h-4 w-4 text-amber-400" />

// 위험 아이콘
<XCircle className="h-4 w-4 text-destructive" />
```

---

## 7. 애니메이션 & 트랜지션 (Motion)

```tsx
// 기본 전환 (색상, 테두리)
className="transition-colors duration-200"

// 크기 변환 (선택 상태)
className="transition-all transform scale-105"

// 입장 애니메이션 (Dialog, Dropdown)
className="animate-in slide-in-from-bottom-4 duration-300"

// 페이드인
className="animate-in fade-in duration-500"

// 로딩 스피너
className="animate-spin"

// 호버 강조
className="hover:border-primary/30 hover:bg-primary/5 transition-colors"
```

---

## 8. 역할별 색상 (Role Colors)

```css
/* index.css 시맨틱 클래스 */
.role-hr         { color: hsl(var(--primary)); }           /* 오렌지 */
.role-evaluator  { color: rgb(52 211 153); }               /* emerald-400 */
.role-evaluatee  { color: rgb(251 191 36); }               /* amber-400 */
```

```tsx
// Tailwind 인라인
const roleColor = {
  hr:        'text-primary bg-primary/10 border-primary/30',
  evaluator: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  evaluatee: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
};
```

---

## 9. 알림 시스템 (Notification System)

```tsx
// 읽지 않은 알림
className="border-primary/20 bg-primary/5"

// 읽은 알림
className="border-border bg-card"

// 알림 타입별 아이콘 색상
score_changed:        text-yellow-600    → text-amber-400
task_content_changed: text-blue-600      → text-primary
feedback_added:       text-green-600     → text-emerald-400
evaluation_completed: text-green-600     → text-emerald-400
evaluation_updated:   text-orange-600    → text-primary
```

---

## 10. 다크모드 강제 적용

이 시스템은 **다크모드 전용**으로 설계됨. `src/main.tsx`에서 강제 적용:

```tsx
// src/main.tsx
document.documentElement.classList.add('dark');
```

라이트모드 전환 불필요. 모든 컴포넌트는 `dark:` prefix 없이 dark 변수만 사용.

---

## 11. 컬러 하드코딩 방지 체크리스트

컴포넌트 작성 시 아래 체크리스트 준수:

```
☐ bg-white → bg-card 또는 bg-background
☐ bg-gray-50 → bg-muted/30
☐ bg-gray-100 → bg-muted/50
☐ text-gray-900 → text-foreground
☐ text-gray-700 → text-foreground
☐ text-gray-600 → text-muted-foreground
☐ text-gray-500 → text-muted-foreground
☐ border-gray-200 → border-border
☐ text-orange-* → text-primary
☐ bg-orange-* → bg-primary/* (투명도 조정)
☐ border-orange-* → border-primary/*
☐ text-yellow-* → text-amber-400 또는 text-primary
☐ bg-yellow-50 → bg-primary/5
☐ bg-yellow-100 → bg-primary/10
☐ text-blue-* → text-primary
☐ text-green-* → text-emerald-400
☐ bg-green-* → bg-emerald-500/10
☐ text-purple-* → text-muted-foreground
☐ bg-purple-* → bg-muted/20
☐ hex 하드코딩 (#F55000 등) → bg-primary
```

---

## 12. 빠른 참조 (Quick Reference)

```tsx
// === 가장 자주 쓰는 패턴 ===

// 섹션 컨테이너
<div className="bg-muted/30 border border-border rounded-lg p-4">

// 강조 컨테이너
<div className="bg-primary/5 border border-primary/20 rounded-lg p-4">

// 포인트 텍스트
<span className="text-primary font-semibold">

// 보조 라벨
<span className="text-xs text-muted-foreground">

// 인터랙티브 아이템
<div className="hover:bg-muted/50 transition-colors cursor-pointer rounded-md p-2">

// 구분선
<div className="border-t border-border">

// 스크롤 영역
<ScrollArea className="h-80 pr-4">

// 로딩 상태
<Loader2 className="h-4 w-4 animate-spin text-primary">

// 성공 상태
<CheckCircle className="h-4 w-4 text-emerald-400">

// 경고 상태
<AlertCircle className="h-4 w-4 text-amber-400">
```
