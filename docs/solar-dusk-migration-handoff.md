# Solar Dusk UI 마이그레이션 — 핸드오프

> 작성일: 2026-04-24
> 대상 브랜치: (현재 작업 브랜치)
> 원본 플랜: `C:\Users\OK\.claude\plans\docs-design-reference-2026-04-23-linear-snail.md`
> 디자인 레퍼런스: `docs/design-reference/2026-04-23/` (prototype.html / pages.jsx / components.jsx / tokens.css)

다른 세션에서 이 문서만 읽어도 작업을 이어갈 수 있도록 현재 진행 상태·파일 변경·남은 작업을 정리했다.

---

## 0. 가장 먼저 실행

```bash
npx tsc --noEmit   # 현재 0 오류 확인됨
npm run build      # 현재 통과 (chunk size 경고만 있음)
npm run dev        # 로컬 스모크 테스트
```

시각 비교용:
```
cd docs/design-reference/2026-04-23
.\serve.ps1   # http://localhost:8123/prototype.html
```

---

## 1. 완료된 Phase (0-3 + 4A + 5 부분)

### Phase 0 — 디자인 토큰 ✅
- `src/index.css` 전면 재작성
  - Solar Dusk 토큰(`--ok-orange: #D9623C` 등) + shadcn 호환 매핑(`--primary`, `--background` 등)
  - `:root[data-theme="dark"]` + `.dark` 듀얼 지원
  - Pretendard Variable CDN import (Freesentation ttf는 없음)
  - 유틸 클래스 `.sd-card`, `.sd-btn`, `.sd-chip`, `.sd-avatar`, `.sd-bar`, `.sd-field`, `.sd-input`
  - 레거시 `.status-*`, `.role-*`, `.score-*` 임시 유지
- `tailwind.config.ts` — `darkMode: ["class", '[data-theme="dark"]']`, `ok.*` 팔레트, `fontSize/borderRadius/boxShadow` 확장
- `index.html` — title "OK!Contribute — 기여도평가시스템", `theme-color #D9623C`

### Phase 1 — 브랜드 프리미티브 ✅ (`src/components/brand/`)
- `OkMark.tsx`, `BrandLockup.tsx`, `Icons.tsx`(26종), `Pill.tsx`, `NumBadge.tsx`, `StatCard.tsx`, `CountdownCard.tsx`, `index.ts`
- **lucide-react 대체 금지** 유지 (레퍼런스 스트로크 2px)

### Phase 2 — 앱 셸 ✅ (`src/components/Layout/`)
- `TopBar.tsx` — BrandLockup + `availableRoles` 게이트 역할 스위처 + 테마 토글(`<html data-theme>` + `.dark`) + NotificationBell + avatar + 로그아웃
- `Sidebar.tsx` — 역할별 메뉴(evaluatee 4 / evaluator 5 / hr 5) + NavLink active + 하단 CountdownCard
- `AppLayout.tsx` 단순화 — TopBar + Sidebar + `<Outlet />`
- `PageHeader.tsx` — 공통 h1 + subtitle + actions

### Phase 3 — 라우팅 ✅ (`src/App.tsx`)
- 폭죽·비·따봉 상태/MutationObserver/handler **전부 제거**
- `<RoleRedirect />` 가 `/` 를 역할별 홈으로 분기
- AppShell 중첩 라우트(리마운트 방지)
- 15개 페이지 라우트 등록 + 역할별 `ProtectedRoute`

### Phase 4A — 페이지 쉘 ✅
15개 쉘 생성 완료. 일부는 기존 컴포넌트로 임시 연결:
- `src/pages/my/{Home,MyTasksPage,MySchedulePage,MyFeedbackPage}.tsx`
- `src/pages/team/{Home,TeamMembersPage,ScoreTablePage,EvaluatorSchedulePage,EvaluatorFeedbackPage}.tsx`
- `src/pages/hr/{Home,HrDepartmentsPage,HrUsersPage,HrSettingsPage,HrMatrixPage}.tsx`

임시 재활용:
- `MyTasksPage` → `EvaluateeDashboardDB`
- `team/Home` → `EvaluatorDashboardDB`
- `hr/Home` → `HRDashboard`
- `HrMatrixPage` → `EvaluationMatrix`
- `HrSettingsPage` → `NotificationSettings / EvaluatorManagement / PromptManagement / DataExport` (`onClose={() => {}}` 더미)

### Phase 5 부분 — 레거시 제거 ✅
삭제 완료 (import 0 확인 후):
- `src/components/Evaluation/FullScreenConfetti.tsx`
- `src/components/Evaluation/RainAnimation.tsx`
- `src/components/Evaluation/ThumbsUpEffect.tsx`
- `src/components/Layout/Header.tsx`
- `src/pages/Index.tsx`

### Phase 4B-1 — Login 비주얼 리프레시 ✅
- `src/pages/Login.tsx` 전면 재작성
  - Solar Dusk 다크 패널(`#1F1428` / `#2A1D35`)
  - BrandLockup + "기여를 측정하다!" 그라데이션 헤드라인
  - 사번/비밀번호 + (복수 역할 시) 역할 선택 스텝 유지
  - 성공 시 `navigate('/')` → RoleRedirect 가 역할 홈으로
  - 반응형: `lg` 미만일 때 좌측 스토리 패널 숨김, 로그인 패널만 노출

---

## 2. 남은 작업 (우선순위순)

### 🔲 Phase 4B-2 — 페이지 내용 이식 (레퍼런스 대비 diff)

각 페이지를 `docs/design-reference/2026-04-23/pages.jsx` 의 해당 컴포넌트처럼 재구성.
현재는 기존 `*DashboardDB` 로 임시 연결되어 있어 **시각이 레퍼런스와 다르다**.

| 우선 | 페이지 | 데이터 소스 | 레퍼런스 컴포넌트 |
|---|---|---|---|
| 1 | `my/Home.tsx` (EvaluateeHome) | `useEvaluationDataDB(user.employeeId)` | pages.jsx `EvaluateeDashboard` (라인 107~) |
| 2 | `my/MyTasksPage.tsx` | 동일 | pages.jsx `MyTasksPage` |
| 3 | `team/ScoreTablePage.tsx` | `useEvaluatorMappings` + 매핑된 evaluatee `useEvaluationDataDB` 집계 | pages.jsx `ScoreTablePage` |
| 4 | `team/TeamMembersPage.tsx` | `useEvaluatorMappings` + `employeeService` | pages.jsx `TeamMembersPage` |
| 5 | `my/MyFeedbackPage.tsx` | `feedbackService` / `tasks[].feedbackHistory` | pages.jsx `MyFeedbackPage` |
| 6 | `team/EvaluatorFeedbackPage.tsx` | `feedbackApiService` author 필터 | pages.jsx `EvaluatorFeedbackPage` |
| 7 | `my/MySchedulePage.tsx` | `useEvaluationDataDB` tasks | pages.jsx `MySchedulePage` (TaskGantt 재활용) |
| 8 | `team/EvaluatorSchedulePage.tsx` | 멤버별 tasks | pages.jsx `EvaluatorSchedulePage` |
| 9 | `hr/Home.tsx` | 기존 `HRDashboard` → Solar Dusk KPI 스타일로 교체 | pages.jsx `HRDashboard` |
| 10 | `hr/HrDepartmentsPage.tsx` | `employeeService` + 부서 집계 | pages.jsx `HrDepartmentsPage` |
| 11 | `hr/HrUsersPage.tsx` | `employeeService.getAll` | pages.jsx `HrUsersPage` (shadcn Table) |
| 12 | `hr/HrSettingsPage.tsx` | 기존 컴포넌트 스택 섹션화 — 이미 스택 되어있음, 스타일만 맞추기 | pages.jsx `HrSettingsPage` |
| 13 | `hr/HrMatrixPage.tsx` | `EvaluationMatrix` 재활용 | pages.jsx `HrMatrixPage` |
| 14 | `team/Home.tsx` (EvaluatorHome) | `EvaluatorDashboardDB` → 레퍼런스 스타일로 | pages.jsx `EvaluatorDashboard` |

**접근 방법**: 각 페이지마다
1. prototype.html 에서 해당 화면 육안 확인
2. pages.jsx 에서 JSX 구조 복사
3. 인라인 `style={{}}` 를 Tailwind + `sd-*` 유틸 클래스로 변환 (토큰은 CSS 변수)
4. 데이터는 mock.js 가 아니라 실제 서비스 훅으로 연결
5. 기존 `src/components/Evaluation/{TaskCard,ScoreDisplay,AIFeedbackChat,EvaluationContent,EvaluationHeader,EvaluationSummary}` 재활용

### 🔲 Phase 5 나머지 — 레거시 대시보드 정리

대체가 끝난 후 **grep 으로 import 0 확인** 하고 삭제:
- `src/components/Dashboard/EvaluateeDashboard.tsx` (non-DB)
- `src/components/Dashboard/EvaluatorDashboard.tsx` (non-DB)
- `src/components/Dashboard/TaskManagement.tsx` (non-DB 가 있다면)
- (사용되지 않으면) `src/components/Dashboard/*DashboardDB.tsx` 도 최종 정리
- `src/contexts/NotificationContext.tsx` (DB 버전 사용 중인지 grep)
- `src/hooks/useEvaluationData.ts`, `useEvaluationDataUnified.ts` (grep)
- `src/index.css` 의 레거시 `.status-*`, `.role-*`, `.score-*` 클래스 (호출부 0 확인 후)

### 🔲 검증 — 역할별 수동 스모크

- **evaluatee** (예: `H1911042`) — 사이드바 4메뉴, Gantt, 피드백 카드, AddTask 모달
- **evaluator** (예: `H0908033`) — 5메뉴, 팀 3명 표시, Score 테이블 T01-T04 + 평균, `/evaluation/:id` 이동
- **hr** (예: `H0807021`) — 5메뉴, 부서 카드 진행률, 사용자 검색/필터, 설정 섹션 저장
- **테마 토글** — 해·달 아이콘으로 `data-theme` 변경, 모든 페이지 다크 가독성
- **역할 스위처** — availableRoles 여러 개인 계정에서 TopBar 에서 전환
- **NotificationBell** — NotificationContextDB 정상

---

## 3. 알려진 위험·메모

- **Freesentation 폰트**: ttf 원본이 `docs/design-reference/2026-04-23/fonts/` 에 없어서 Pretendard Variable CDN 로 대체. 실제 폰트를 구하면 `public/fonts/` 로 복사 후 `@font-face` 추가
- **레거시 hsl 패턴**: shadcn 변수를 hex 매핑해서 `hsl(var(--x) / 0.5)` 쓰던 곳이 있다면 알파 표기 깨짐. Phase 4B 진행하며 발견 시 `bg-primary/50` Tailwind 문법으로 교체
- **`*DashboardDB`**: 현재 MyTasksPage/team.Home/hr.Home 이 임시로 붙어있음. Phase 4B 페이지별 리라이트 시 완전히 대체
- **chunk size 경고**: build 시 1.2MB 번들 경고. 필요 시 `manualChunks` 설정 — 디자인 작업에는 영향 없음
- **computer-use / Chrome 확장**: 이 작업은 코드 편집 위주라 필요 없음. 시각 검수만 로컬 브라우저로

---

## 4. 커밋 권장 체크포인트

아직 커밋 안 했다면 다음 순서로 분리 추천:
1. `style: solar dusk 디자인 토큰 이식 (index.css, tailwind)`
2. `feat: 브랜드 프리미티브 및 앱 셸 (TopBar/Sidebar/AppLayout)`
3. `refactor: 15개 역할별 라우트 확장 및 celebration effect 제거`
4. `feat: Login Solar Dusk 리디자인`
5. (이후 페이지별 커밋)

커밋 전 `npx tsc --noEmit` + `npm run build` 둘 다 통과 필수.

---

## 5. 다른 세션 시작 프롬프트 예시

```
@docs/solar-dusk-migration-handoff.md 읽고 Phase 4B-2 이어서 해줘.
먼저 `my/Home.tsx` (EvaluateeHome) 부터 레퍼런스 pages.jsx 의
EvaluateeDashboard 레이아웃에 맞춰 재작성해. 데이터는
useEvaluationDataDB(user.employeeId) 사용.
```

또는

```
@docs/solar-dusk-migration-handoff.md 의 Phase 5 나머지 정리부터
해줘. 레거시 non-DB 대시보드 import 현황 grep 하고 제거 가능한
것부터.
```
