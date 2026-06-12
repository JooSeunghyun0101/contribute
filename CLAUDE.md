# Elevate Growth System (기여도평가시스템) — Claude Code 지침

OK금융그룹 新인사제도의 **기여도평가** 운영을 위한 웹 애플리케이션이다.
이 파일은 이 앱의 개발 세션에서만 적용된다. HR 업무 운영 지침은 별도 프로젝트를 참조한다.

---

## 이 프로젝트가 아닌 것

이 앱은 HR Planning 마스터 프로젝트(`C:\Users\OK\Project`)와 **독립된 개발 레포**다.
HR 운영 규칙(daily 로그 하네스, DRM, 스킬 라우팅, 보이스 톤 등)은 여기서 **적용하지 않는다**.

---

## 우선 참조 순서

1. 이 `CLAUDE.md`
2. `README.md` — 앱 개요·기술 스택·폴더 구조
3. `Design Guide.md` — OK 브랜드 컬러 시스템
4. `docs/UI_THEME_SPEC.md` — UI 테마 스펙
5. `AI_SETUP.md` — OpenAI API 연동 설정
6. `BACKEND_FRONTEND_OVERVIEW.md` — 백엔드·프런트엔드 전체 흐름
7. `docs/design-reference/YYYY-MM-DD/` — Claude Design으로 만든 UI 레퍼런스 박제본

---

## 기술 스택 요약

| 레이어 | 기술 |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| State | React Context API + React Query |
| Routing | React Router DOM |
| Backend | `server.js` (Express) + PostgreSQL (pg 풀) |
| AI | OpenAI 호환 프록시 `/api/ai/chat` (임시 GitHub Models → 내부망 이식 후 GPT-OSS, env 교체만) |
| Infra | Docker, docker-compose |

주요 디렉터리:
- `src/pages/` 역할별 페이지
- `src/components/` 공통·도메인 컴포넌트 (Dashboard, Evaluation, Layout, Notification, Settings, ui)
- `src/lib/services/` DB 서비스 레이어
- `src/contexts/` React Context
- `db_mig/`, `db_structure/` PostgreSQL 마이그레이션과 스키마 스냅샷 (적용 절차는 `db_mig/README.md`)

---

## 코드 작업 원칙

### 일반
- TypeScript strict 준수. 새로운 코드는 `any` 지양.
- 기존 shadcn/ui 컴포넌트 재사용 우선. 새 UI를 만들기 전에 `src/components/ui/`와 shadcn 카탈로그 확인.
- Tailwind 토큰은 `tailwind.config.ts`에 정의된 OK 브랜드 팔레트만 사용. 임의 HEX 값 금지.
- 코드 변경 시 관련 타입(`src/types/`) 먼저 확인·갱신.

### 디자인
- **OK Orange(`#F55000`)** 가 Main. Yellow·Dark Brown은 Sub.
- Claude Design 레퍼런스(`docs/design-reference/2026-04-23/prototype.html`)의 페이지 구조·레이아웃을 **기본 기준**으로 삼되, 실제 구현은 프로젝트의 Tailwind + shadcn 규칙으로 변환.
- 레퍼런스의 `tokens.css` CSS 변수 네이밍은 `tailwind.config.ts` 또는 `src/index.css`로 매핑.

### 데이터
- DB 접근은 `src/lib/services/` 서비스 레이어(apiFetch → `server.js` API)를 경유. 컴포넌트에서 직접 호출 지양.
- DB 스키마 변경은 `db_mig/`에 새 마이그레이션 추가 → psql로 **그 자리에서 즉시 적용**(`db_mig/README.md` 참조). 파일만 만들고 적용하지 않으면 해당 기능이 런타임 500으로 깨진다.
- `.env`에 민감정보 저장. `database_connect_information.yml`은 참조용이므로 커밋 주의.

### 테스트·빌드
- 변경 후 `npm run typecheck` → `npm run build` 통과 확인.
- 배포 대상 산출물은 `dist/`에 생성.

---

## Claude Design 레퍼런스 사용법

`docs/design-reference/YYYY-MM-DD/` 는 **읽기 전용 박제**다. 앞으로 Claude Design에서 UI를 재생성할 때마다 새 날짜 폴더를 추가한다.

현재 박제본: `docs/design-reference/2026-04-23/`
- `prototype.html` 10개 페이지 + 로그인 (피평가자 3 · 평가자 4 · HR 3)
- `pages.jsx` 페이지 정의
- `components.jsx` 공통 컴포넌트 · 아이콘
- `mock.js` 목업 데이터
- `tokens.css` 디자인 토큰

실행: 해당 폴더에서 `.\serve.ps1` → http://localhost:8123/prototype.html

페이지 수정 요청 예시:
> "design-reference/2026-04-23/pages.jsx의 `MyTasksPage`처럼 src/pages의 MyTasks를 맞춰줘"
> "ScoreTablePage 레이아웃을 레퍼런스 따라 src/components/Evaluation/ScoreTable.tsx에 반영해줘"

---

## 비즈니스 맥락 참조 (HR Planning 마스터 프로젝트)

이 앱의 기여도평가 제도·운영 규칙은 HR Planning 마스터 프로젝트에 있다.
비즈니스 판단이 필요할 때 아래 파일을 Read로 열어 참조한다.

| 대상 | 경로 |
|---|---|
| 평가 제도 상세 | `C:\Users\OK\Project\context\converted\新인사제도 개요 - Ⅲ 평가제도 상세.md` |
| 新인사제도 개요 | `C:\Users\OK\Project\context\converted\新인사제도 개요.md` |
| 직군·직종·직무 체계 | `C:\Users\OK\Project\context\converted\新인사제도 개요 - Ⅰ 직군 직종 직무 체계 상세.md` |
| 주간 회의 메모 | `C:\Users\OK\Project\knowledge\meetings\hr-team-weekly\` |
| 이슈 레지스터 | `C:\Users\OK\Project\issues\issue-register.md` |
| 관련 로드맵 | `C:\Users\OK\Project\tasks\master-roadmap.md` |

운영 규칙·공지·보고 등 HR 업무 쪽 작업은 HR Planning Claude Code 세션에서 처리한다.
이 앱 세션에서는 **코드 작업만** 한다.

---

## Git 커밋 메시지 규칙

- `feat: ...` 새 기능
- `fix: ...` 버그 수정
- `refactor: ...` 리팩터링
- `style: ...` UI·스타일
- `docs: ...` 문서
- `chore: ...` 설정·의존성

커밋 전 `npm run typecheck` 통과 필수.

---

## 세션 시작 시 체크

- 최근 Git 상태 확인 (`git status`)
- 로컬 `npm run dev` 서버 상태
- 다루려는 페이지·기능이 최근 design-reference에 있는지 확인
