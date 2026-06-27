# 기여도 평가 시스템 (Elevate Growth System)

> OK금융그룹 **新인사제도 — 기여도(Contribution) 평가** 운영을 위한 웹 애플리케이션

연초 등록한 과업을 기준으로, 평가자가 **기여방식 × 기여범위** 매트릭스로 점수를 매기고 피드백을 작성하면,
AI가 성장 제안·요약·키워드를 생성하고 HR이 전사 현황을 한눈에 관리합니다.

---

## ✨ 주요 기능

### 역할별 화면
- **피평가자(내 화면)** — 과업 등록·가중치·성과보고, 받은 평가/피드백·AI 성장제안 확인, 과업 간트, AI 도움말
- **평가자(팀 화면)** — 평가 보드(칸반), 점수 매트릭스 채점·피드백 작성, AI 의견 초안, 임시저장/평가저장·돌려보내기, 팀 통계·일정
- **HR(관리자)** — 전사 현황·부서별·평가 인사이트, AI 인물검색, 평가 열람, 리마인드·AI검수, 공지·FAQ, 평가기간·매트릭스·사용자 관리, 감사 로그
- 한 계정이 여러 역할을 가지면 **상단바 역할 스위처**로 전환

### AI 기능 (서버 프록시 `/api/ai/chat` 경유)
- **성장 제안 / 피드백 요약 / 키워드** — 평가자가 평가완료 저장 시 1회 생성·영속(조회 시 재호출 없음)
- **AI 피드백 검수** — 구체성·성실성·중복성·정합성 자동 점검(저장 시점)
- **AI 도움말** — 평가자·피평가자용 챗봇 + FAQ 합성
- **AI 인물검색(HR)** — 자연어 질의 → 피드백 기반 인물 검색

### 운영·데이터
- **평가기간**(연도별) · **조직 4단계**(법인›본부›부›팀) 필터
- **엑셀 업로드/다운로드** — 대상자 / 매칭(평가자 배정) / 조직정보 / 기여도(점수·피드백)
- **알림·일괄 공지 / FAQ**, **감사 로그**, **비밀번호 초기화(요청·승인)**
- 대시보드 차트·월별 추이·간트 차트

---

## 🧱 기술 스택

| 레이어 | 기술 |
|---|---|
| Frontend | React 18 · TypeScript · Vite |
| UI | Tailwind CSS · shadcn/ui · motion(애니메이션) |
| 상태 | React Context API · React Query(TanStack) |
| 라우팅 | React Router DOM |
| Backend | Express (`server.js`) REST API |
| DB | PostgreSQL (`pg` 풀, **백엔드 API 경유** — 프런트는 DB 직접 접근 안 함) |
| AI | OpenAI 호환 프록시 `/api/ai/chat` (임시 GitHub Models → 내부망 GPT-OSS, `.env` 교체만) |
| Infra | Docker · docker-compose · Render(임시 데모 배포) |

---

## 📁 프로젝트 구조

```
.
├── server.js                # Express API + (프로덕션) dist 정적 서빙
├── src/
│   ├── pages/               # 역할별 페이지 (my / team / hr) + Login, Evaluation
│   ├── components/          # 공통·도메인 컴포넌트
│   │   ├── Dashboard/ Evaluation/ Feedback/ Layout/ hr/ brand/
│   │   └── ui/              # shadcn/ui 및 공통 UI (loader, accordion-motion, faq-pro 등)
│   ├── contexts/            # React Context (Auth, EvaluationPeriod, Matrix …)
│   ├── hooks/               # 커스텀 훅 (useEvaluationDataDB 등)
│   ├── lib/
│   │   ├── services/        # DB 서비스 레이어 (apiFetch → server.js)
│   │   ├── gptOss.ts        # AI 호출 래퍼
│   │   └── defaultPrompts.json  # 기본 프롬프트 단일 원천(서버 시작 시 자동 시드)
│   └── types/               # TypeScript 타입
├── db_mig/                  # PostgreSQL 마이그레이션 (적용 절차: db_mig/README.md)
├── db_structure/            # 스키마 스냅샷 (schema_full.sql = 현재 전체 스키마 덤프)
├── docker/init.sql          # 컨테이너 최초 기동 시 스키마 부트스트랩
├── docs/                    # 설계 레퍼런스·테마 스펙·베타 안내 등
└── docker-compose.yml · render.yaml
```

---

## 🚀 빠른 시작 (로컬 개발)

### 1) 사전 준비
- Node.js 24 LTS, Docker(또는 로컬 PostgreSQL 16)

### 2) 의존성 설치
```bash
npm install
```

### 3) 환경 변수
`.env.example` → `.env` 복사 후 값 입력:
```bash
DATABASE_URL=postgresql://<user>:<password>@localhost:5532/human-resource
# AI(서버 프록시 전용) — 임시 GitHub Models 사용 시
AI_BASE_URL=https://models.github.ai/inference
AI_API_KEY=<github-models-token>
AI_MODEL=openai/gpt-4.1-mini
```
> 전체 변수·AI 연동 상세는 [`AI_SETUP.md`](./AI_SETUP.md), 백엔드·프런트 흐름은 [`BACKEND_FRONTEND_OVERVIEW.md`](./BACKEND_FRONTEND_OVERVIEW.md) 참조.

### 4) DB 기동 (Docker)
```bash
docker compose up -d        # postgres:16, localhost:5532
```

### 5) 개발 서버 — 프런트 + 백엔드 둘 다
```bash
npm run dev          # 프런트(Vite, http://localhost:5173)
npm run dev:server   # 백엔드 API(server.js, nodemon)  ← 다른 터미널
```

---

## 📜 npm 스크립트

| 스크립트 | 설명 |
|---|---|
| `npm run dev` | 프런트 개발 서버(Vite) |
| `npm run dev:server` | 백엔드 API(nodemon) |
| `npm run build` | 프로덕션 빌드 → `dist/` |
| `npm run start` | `node server.js` (dist 정적 서빙 + API, 단일 서비스) |
| `npm run typecheck` | TypeScript 검사 (**커밋 전 필수**) |
| `npm run lint` | ESLint |
| `npm test` | vitest + 서버 부팅 스모크(`smoke:server`) |
| `npm run preview` | 빌드 미리보기 |

---

## ☁️ 배포

### Render (임시 데모)
`render.yaml` 블루프린트로 **웹 서비스 1개 + Postgres 1개**를 띄웁니다(단일 서비스: `server.js`가 dist 정적 + API 동시 서빙).
- 무료 티어: 15분 미사용 시 슬립 → 다음 요청에 ~1분 콜드스타트. **실데이터/PII 금지(데모 전용)**

### 내부망 이관
1. 현재 스키마 그대로 적용: [`db_structure/schema_full.sql`](./db_structure/schema_full.sql) (`pg_dump --schema-only`, pgcrypto 포함)
2. 빈 DB에 적용 → 기준데이터 시드(매트릭스·평가기간 등) → `.env`의 `AI_BASE_URL`만 내부 GPT-OSS로 교체
> 기본 프롬프트는 **서버 시작 시 `defaultPrompts.json`에서 자동 시드**됩니다.

---

## 🗄️ DB 스키마 · 마이그레이션
- 스키마 변경은 `db_mig/`에 새 마이그레이션 추가 → **psql로 즉시 적용**(절차: `db_mig/README.md`)
- 현재 전체 스키마 스냅샷: `db_structure/schema_full.sql`
- 신규 컨테이너 부트스트랩: `docker/init.sql`

---

## 📚 문서
- [`CLAUDE.md`](./CLAUDE.md) — 개발 지침(이 레포 전용)
- [`AI_SETUP.md`](./AI_SETUP.md) — AI 연동 설정
- [`BACKEND_FRONTEND_OVERVIEW.md`](./BACKEND_FRONTEND_OVERVIEW.md) — 백엔드·프런트 전체 흐름
- [`Design Guide.md`](./Design%20Guide.md) · `docs/UI_THEME_SPEC.md` — OK 브랜드/테마
- [`docs/closed-beta-guide.md`](./docs/closed-beta-guide.md) — **클로즈 베타 테스터 안내**

---

## 🔒 보안·주의
- `.env`·자격증명은 커밋 금지. PII/실데이터는 데모 환경에 올리지 않습니다.
- DB 접근은 반드시 서비스 레이어(`src/lib/services` → `server.js`)를 경유 — 프런트에서 DB 직접 접근 금지.
- HR **시스템 설정의 일괄삭제/평가기간 초기화**는 전체 데이터를 지웁니다(운영 주의).

---

## 라이선스
OK금융그룹 **사내 전용** 프로젝트(비공개). 외부 배포·재사용 금지.
