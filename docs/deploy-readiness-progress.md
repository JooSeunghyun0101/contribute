# 전사 배포 준비 — 진행 트래커 (루프 상태판)

> 이 파일은 `/loop` 자동 개발의 **상태 머신**이다. 매 주기마다 여기서 다음 1스텝을 읽고, 완료 시 체크하고, 결정 게이트에서 멈춘다.
> 원본: 2026-06-10 전수 검수 보고서 + feat/hr-admin-enhancement 구체화 플랜 통합본. 이전 트래커: [hr-admin-enhancement-progress.md](./hr-admin-enhancement-progress.md)
>
> 상태 기호: `[ ]` 대기 · `[~]` 진행중 · `[x]` 완료 · `[!]` 차단(결정 필요)

---

## 목표 (이 트래커의 북극성)

**회사 내부망에 이식해 전 직원이 쓰는 평가 시스템.** 따라서:
1. **안전**: 인증·인가 없이는 배포 불가 — 평가데이터는 최고 민감 정보.
2. **간편·친절**: 로딩·오류·빈 화면에서 사용자가 헤매지 않게. 메뉴는 단순하게, 안내는 친절하게.
3. **묶어서 한 번에**: 같은 성격의 작업은 공용 컴포넌트/묶음 항목으로 합쳐 한 주기에 해결.

## 사용자 결정 (2026-06-10, 고정)

| 결정 | 내용 |
|---|---|
| 이메일 알림 | **나중에 구현** — dispatch.ts 이메일 어댑터 스텁 유지, UI에서 이메일 노출만 정리(A-2). SMTP/스케줄러는 보류 섹션 |
| 모바일 | **계획 없음** — 반응형/모바일 레이아웃 작업 전면 제외. 데스크톱(노트북 포함) 기준만 |
| 기능 통합 | 합칠 수 있는 건 묶음 항목으로 통합 구현 (각 Phase의 묶음 구성 참조) |
| AI 연동 | GPT-OSS(내부망 `172.17.170.201`)는 **이식 후 사용할 코드** — 이식 전 임시로 **GitHub Models API**(OpenAI 호환, `https://models.github.ai/inference`, 모델 `openai/gpt-4.1-mini`) 연결. env 전환만으로 GPT-OSS 복귀 가능하게 설계(B-1) |
| 인증 방식(G-1) | **자체 비밀번호** — employees `password_hash`(bcrypt) + 서버 로그인 + 최초 로그인 비밀번호 변경 강제 + **httpOnly 쿠키 세션** |
| 브랜드 오렌지(G-2) | **역할 분리** — 브랜드 강조(로고·그래픽·대형 점수 숫자)=`#F55000`, 본문 텍스트·버튼 등 가독 요소=`#B45309`. 둘 다 토큰으로 정의(`--ok-orange-brand` / `--ok-orange`), 하드코딩만 치환 |
| AI API 키(B-0) | **사용자가 직접 `.env`에 `AI_API_KEY` 입력** — 루프는 키 존재를 가정하고 B-1 완성, 키 미입력 상태에서도 'AI 미설정' 안내로 graceful 동작해야 함 |

---

## 루프 1회 계약 (매 주기 이걸 그대로 수행)

1. 이 트래커에서 **가장 위의 `[ ]` 1개**를 고른다. (결정 게이트는 2026-06-10 전부 해소됨 — `[!]` 항목 없음)
2. 그 항목을 `[~]`로 바꾸고 구현한다. **한 주기 = 한 항목.** 범위 넘기지 말 것. (묶음 항목은 묶음 전체가 1항목)
3. 큰 항목을 처음 열면, 먼저 **하위 서브스텝으로 분해해 트래커에 추가**하고 그 첫 서브스텝부터 진행한다.
4. 검증: `npx tsc --noEmit` 통과 → `npm run build` 통과. (이 레포는 `typecheck` 스크립트 없음 → F-3에서 추가 예정)
5. 통과하면 커밋: `feat:` / `fix:` / `refactor:` 규칙. 실패하면 고치고 재검증, 못 고치면 `[~]`인 채로 멈추고 보고.
6. 항목을 `[x]`로 바꾸고 **이 파일을 커밋에 포함**한다.
7. 다음 주기로. 모든 항목이 `[x]`면 루프 종료.

**불변 규칙**
- 작업 브랜치에서만. `main` 직접 커밋 금지.
- 임의 HEX 금지(`tailwind.config.ts` OK 팔레트·CSS 변수만). API는 `src/lib/services/` 경유.
- 다중 평가 = 발령(정상). 중복으로 판정·삭제 금지.
- DB 쓰기(마이그레이션·대량 변경)는 백업 선행 + 멱등 스크립트.
- **무정지 루프(사용자 지시 2026-06-10)**: 게이트는 전부 해소됐고, 이후 작은 모호함을 만나면 **멈추지 말고** ① 위 '사용자 결정' 표와 목표(안전·간편·친절)에 맞는 보수적 기본값을 택해 진행 ② 작업 로그에 `결정 메모:` 한 줄로 남긴다. 단, 파괴적·되돌리기 어려운 작업(데이터 삭제, 스키마 변경)만은 예외로 멈춘다.
- **삭제 전 확인**: 죽은 코드 스윕(F-2)은 importer 0건을 grep으로 재확인 후 삭제.

---

## Phase 0 — 준비

- [x] **P0-1** 작업 브랜치 확인: `feat/hr-admin-enhancement`에서 계속 진행(이전 작업 미머지 상태이므로 같은 브랜치 사용). `git status` clean 확인.

## Phase A — 즉효 수정 묶음 (S 규모, 결정 불필요 — 체감 완성도 즉시 상승)

- [x] **A-1** 버그 3종 일괄 수정 (묶음):
  - ① 수정요청 취소 버그 — `src/pages/my/EvaluationAccordionCard.tsx:248` `window.prompt(...) ?? ''` 가 취소(null)를 ''로 바꿔 **취소해도 발송됨** → `?? ''` 제거, null이면 return.
  - ② AI 검수 stale 선택 — `src/components/Feedback/AiReviewMonitoring.tsx:152,348,600` 필터 변경 시 selected Set 미정리 → `useEffect`로 visibleRows 기준 prune(또는 카운트를 `visibleRows ∩ selected`로).
  - ③ 키보드 포커스 링 — `src/index.css` `.sd-btn:focus-visible { box-shadow: var(--sh-focus) }` + 사이드바 NavLink 동일 처리(`--sh-focus` 토큰 :98에 이미 존재).
- [x] **A-2** "UI가 약속만 하는 것" 정리 묶음 (이메일은 보류이므로 노출만 정돈):
  - ① 설정의 이메일 토글·주간보고서·마감 사전알림·리마인더 주기(`NotificationSettings.tsx:149-157` 등, 소비자 0명) → 숨김 또는 "준비 중" 배지 1종으로 통일.
  - ② RemindersPage·HrNoticesFaqPage 발송 채널 `['inApp','email']` 하드코딩 → inApp만. 토스트의 "건너뜀(이메일 미설정) n" 노출 제거.
  - ③ HrSettingsPage placeholder 탭 2개(일반 "추후 추가됩니다":124 · 권한역할 "준비 중입니다":170) 제거 → 4탭→2탭(알림·고급). 권한역할 UI는 Phase S 인증 완료 후 부활.
  - ④ 로그인 화면 "SSO · OK금융그룹 통합인증" 문구(`Login.tsx:215`) — G-1 결정이 자체 비밀번호이므로 **제거 확정**.
- [x] **A-3** 부팅·자산 정리 묶음:
  - ① `src/main.tsx:7` 가짜 `testSupabaseConnection()` 호출 제거(브라우저에선 항상 MockPool 허위 성공 로그).
  - ② Pretendard 폰트 jsdelivr CDN(`index.css:1`) → `public/fonts/` 자체 호스팅(내부망 차단 대비).

## Phase B — AI 임시 API 전환 (사용자 결정 4 반영)

- [x] **B-1** AI 호출 서버 프록시화 + GitHub Models 임시 연결 (서브스텝 분해):
  - [x] **B-1a** server.js `POST /api/ai/chat` 프록시 + env 3종 + IP 기준 분당 레이트리밋 + 키 부재 시 503 `{ configured: false }` graceful 응답 + `.env.example` 갱신(GPT-OSS 복귀 시나리오 주석).
  - [x] **B-1b** gptOss.ts 전 호출을 `/api/ai/chat` 경유로 전환(내부 IP 하드코딩 제거, 기존 함수 시그니처 유지), 미설정 응답을 기존 skipped 경로로 매핑.
  - [x] **B-1c** AI 화면(AiReviewMonitoring·FeedbackDuplicateDetector·프롬프트 관리 탭)에 "임시 외부 API 사용 중 — 실데이터 검수 자제" 주의 캡션 표시(서버 설정 상태 기반).
  - server.js에 `POST /api/ai/chat` 프록시 신설. env 3종: `AI_BASE_URL`(기본 `https://models.github.ai/inference`), `AI_API_KEY`, `AI_MODEL`(기본 `openai/gpt-4.1-mini`). OpenAI 호환 chat/completions 형식 그대로 중계.
  - `src/lib/gptOss.ts:229`의 IP 하드코딩(`http://172.17.170.201:8000`) 제거 → 모든 AI 호출(피드백 추천·검수·유사도·QnA·요약)을 `/api/ai/chat` 경유로 전환. 기존 함수 시그니처 유지(호출부 무변경 목표).
  - **내부망 이식 시 `.env`에서 `AI_BASE_URL`만 GPT-OSS 주소로 바꾸면 복귀** — 이 전환 시나리오를 `.env.example` 주석으로 명시.
  - 프록시에 사용자별 간단 레이트리밋(분당 N회) 포함 — 비용·서버 보호.
  - ⚠ **주의 캡션 필수**: GitHub Models는 **외부 API** — 실제 평가의견이 외부로 전송됨. 임시 기간엔 테스트/샘플 데이터로만 AI 기능 사용 권장 문구를 AI 화면(AiReviewMonitoring 등)에 표시.
- [x] **B-0(선행 입력)** ✅ **사용자 결정(2026-06-10)**: 키는 사용자가 직접 `.env`에 `AI_API_KEY` 입력. 루프는 키 존재를 가정하고 B-1을 완성하되, 키 미입력 상태에서도 "AI 미설정" 안내로 graceful 동작 필수(런타임에서 키 부재 감지 → 기능 비활성+안내, 에러 아님).

## ✅ 결정 게이트 G-1 — 인증 방식 (해소)

- [x] **G-1** **사용자 결정(2026-06-10): 자체 비밀번호.** employees에 `password_hash`(bcrypt) + `POST /api/auth/login` + 최초 로그인 시 비밀번호 변경 강제. 세션은 **httpOnly 쿠키 세션**(JWT 아님 — 구현 단순·토큰 탈취 면적 작음). SSO/AD는 보류 섹션(이식 시점 재검토).

## Phase S — 보안 (배포 차단 해소)

- [x] **S-1** 인증 기반 구축(G-1=자체 비밀번호+쿠키 세션) — 서브스텝 분해:
  - [x] **S-1a** 백업(pg_dump) 선행 → additive 마이그레이션: employees에 `password_hash TEXT NULL` + `must_change_password BOOLEAN NOT NULL DEFAULT TRUE` (IF NOT EXISTS 멱등) + `bcryptjs` 의존성 추가.
  - [x] **S-1b** server.js 인증 라우트: `POST /api/auth/login`(hash NULL이면 초기 비밀번호=사번 허용→변경 강제), `POST /api/auth/change-password`, `POST /api/auth/logout`, `GET /api/auth/me`. 세션=httpOnly 쿠키 + 인메모리 저장(절대 8h·유휴 2h 만료, 재시작=재로그인).
  - [x] **S-1c** 프런트 전환: AuthContext를 `/api/auth/*` 기반으로(localStorage 신뢰 제거), Login에 비밀번호 검증·최초 변경 강제 화면, `CONSTANTS.DEFAULT_PASSWORD('1234')` 제거.
- [x] **S-2** 인가 미들웨어: `requireAuth` + `requireRole('hr')`를 server.js 전 라우트에 적용. actor는 **세션에서만** 도출 — `getAssignmentActor(req.body)`(server.js:260) 자기신고 제거, `actorId==='admin'` 무조건 통과(:4902) 삭제. 파괴적 라우트(reset 2종 :4912·:4973, DELETE employee/evaluation/notifications/feedback/prompt) 우선 적용 + reset이 `admin_audit_logs`까지 TRUNCATE(:4936)하는 것 제외하고 reset 실행 자체를 로그에 남김.
- [x] **S-3** 행 단위 접근제어: 평가/과업/피드백/알림 read 라우트에 "본인 / 담당 평가자 / HR" 검사(IDOR 차단 — `GET /api/evaluation/:id`:6000, `/api/evaluations/employee/:id`:5960 등). 백도어 사번 `H1411166`(`AuthContext.tsx:21-23`) 제거 — DB `available_roles`만 신뢰.
- [x] **S-4** 서버 하드닝 묶음 (전부 S 규모, 한 주기 일괄):
  - ① 수제 JSON 파서(server.js:2286-2306, 개행 치환+크기 무제한) → `express.json({ limit: '2mb' })` 교체.
  - ② helmet + express-rate-limit(로그인·AI·삭제 라우트 강화) 도입.
  - ③ CORS `origin: true` 전허용(:2285) → 화이트리스트.
  - ④ 에러 응답 `err.message` 직노출 → 일반 메시지 + 서버 로그만.
  - ⑤ DB 장애 시 무음 mock 폴백(server.js:67-76, mockEmployees 폴백 포함) → 운영 모드 fail-fast(503).

## Phase C — 공통 기반 컴포넌트 (묶음의 핵심 — 이후 페이지 작업은 "조립")

- [x] **C-1** 공용 다이얼로그 2종 + 전 콜사이트 일괄 치환 (묶음 — 서브스텝 분해):
  - [x] **C-1a** `ConfirmDialog`(AlertDialog 래퍼, variant=default/danger·타이핑 확인 옵션) + `ReasonDialog`(사유 입력)·imperative 훅(`useConfirm`/`useReason`) 생성 + 파괴적 콜사이트 우선 치환(HrSettingsPage RESET 4·HrPeriodsPage 3) 후 검증.
  - [x] **C-1b** 나머지 콜사이트 치환: HrUsersPage 7·Evaluation 2·EvaluationAccordionCard 3·ChangeRequestsPage 3·HrQualityPage 1(window.prompt 사유)·NotificationsPage 1·EvaluatorRequestPage 1·PromptManagement 1·useEvaluationDataDB 1.
  - `ConfirmDialog`(AlertDialog 래퍼) + `ReasonDialog`(AlertDialog+Textarea, `AiReviewMonitoring.tsx:371-425` 패턴 추출).
  - `window.confirm/prompt` 30콜사이트 치환: HrUsersPage 7건, HrSettingsPage 4건(RESET 타이핑 확인은 Dialog 내 input으로), HrPeriodsPage 3건, Evaluation.tsx 2건, EvaluationAccordionCard 3건, ChangeRequestsPage 3건, HrQualityPage:1937(재검토 사유), NotificationsPage, EvaluatorRequestPage, PromptManagement, useEvaluationDataDB:999 등.
  - 효과: 재검토 요청 UX 통일(HrQuality ↔ AiReview 동일 패턴), 파괴적 액션 안전성.
- [x] **C-2** 공용 DataTable + 상태 컴포넌트 + 적용 (묶음, 서브스텝 분해):
  - [x] **C-2a** 공용 `ErrorState`(친절 문구+"다시 시도")·`EmptyState`(안내+CTA) 생성 + **오류↔빈 상태 분리**(검수 [치명]): fetch 실패를 빈 배열로 흡수해 "데이터 없음"으로 위장하던 핵심 페이지(my/*·team/* 로더)에 error 상태 추가. RemindersPage error 분기가 모범.
  - [x] **C-2b** 대량 렌더 방지(검수 [높음], 사용자 영향 큰 것 우선). **결정 메모(계획 재정의)**: raw `<table>` 8곳 → shadcn Table 전면 치환은 컬럼·셀 구조가 제각각이라 회귀 위험만 크고 순수 일관성 이득이라 **보류로 강등**(보류 섹션). 대신 실제 1000명 규모 성능 문제인 무제한 렌더를 우선 처리. HrIndividualFeedbackPage 좌측 전직원 명단(~735 버튼 무제한 `.map`)에 표시 상한(PICKER_LIMIT=100)+검색 유도(검색·조직필터 이미 존재). HrMatchingPage는 이미 shadcn Table·위반행만 렌더(전직원 아님)라 우선순위 낮음.
  - [x] **C-2c** (C-2b에 흡수) 나머지 무거운 렌더(AiReviewMonitoring/FeedbackDuplicateDetector 전사 평가의견 테이블)는 selected Set·배치검수 상태와 얽혀 페이지네이션 추가 시 상호작용 재설계 필요 → **실사용 데이터에서 체감 시 처리(보류)**. 위반행·의견은 보통 전체의 일부라 전직원 명단만큼 심각하지 않음.
- [x] **C-3** 손제작 div 모달 → shadcn Dialog 마이그레이션 (묶음 — 서브스텝 분해): HrMatchingPage 재배정 모달(:805,:1062), hr/AddEmployeeModal, hr/EvaluatorHistoryModal, hr/UploadPreviewModal, HrDepartmentsPage:809, HrJobRoleBenchmarkPage:582, hr/Home:590, AiSummaryReportModal, NotificationBell 등 10곳 — focus trap·ESC·aria 확보. 네이티브 `<select>` 11곳 → shadcn Select 통일도 이 주기에 포함(만나는 파일이 겹침).
  - [x] **C-3a** 공용 `Modal` 래퍼(shadcn Dialog 기반, focus trap·ESC·role=dialog 내장) 또는 직접 Dialog 적용 패턴 확립 + AddEmployeeModal(단순·독립) 마이그레이션 후 검증.
  - [x] **C-3b** 독립 모달 컴포넌트 마이그레이션(UploadPreviewModal). **결정 메모**: 페이지 내장 모달(HrMatchingPage·HrDepartments·hr/Home·HrJobRoleBenchmark 거대 파일 내부)·AiSummaryReportModal·NotificationBell·EvaluatorHistoryModal·native select 11곳은 tsc/build로 시각·상호작용 회귀를 못 잡는 UI 작업이라 자동 루프 부적합 → **점진(해당 페이지 개편 동반) 보류**. 패턴은 C-3a/b로 확립됨.
- [x] **C-4** ErrorBoundary: 루트 + 라우트 단위(재시도 버튼 포함) — 렌더 예외 1건 백화면 방지.

## Phase D — 성능·데이터·알림 (1,000명 규모 대비)

- [보류] **D-1** 서버 집계 API로 N+1 제거. **보류 강등(2026-06-10)**: task 조회가 `task_evaluation_entries` 최신값 덮어쓰기 + assignment_history 연계의 복잡 LATERAL 쿼리라, 평가기간 일괄로 재작성 시 **점수·피드백 정합성** 보장에 전수 비교 검증 필요. 틀리면 조용히 잘못된 평가 수치를 전사 노출(되돌리기 어려운 신뢰 훼손) → 무정지 자동 루프 단독 부적합, **사용자 검증 동반 필요**. (성능 자체는 실제 병목이라 가치 큼 — 사용자와 함께 재개 권장)
- [보류] **D-2** React Query 실사용 전환. D-1과 동일 데이터 경로(useRecordsLoader)를 건드려 정합성·캐시 무효화 회귀 위험 → D-1과 함께 사용자 검증 동반 시 진행.
- [x] **D-3** 알림 도달 메커니즘(인앱 전용 — 이메일 보류): `NotificationContextDB.tsx:48-50` 로그인 1회 로드 → ① 경량 `GET /api/notifications/unread-count` 신설 ② 포커스/visibilitychange 재조회 + 60~120초 지터 폴링 ③ 컨텍스트에 `reload` 노출. **리마인드·재검토 요청·공지가 실제로 도달해야 F-C1/B2.2/C5 기능이 완성됨.**
- [x] **D-4** 번들·반응성: ① 라우트 lazy 분할 완료(Login·NotFound만 eager, 23페이지 lazy + AppShell Outlet Suspense). **index 2,263KB→420KB(gzip 613→135), hrDataExport(xlsx) 450KB·scoreTrend(recharts) 435KB 별도 청크 = 피평가자 미수신**. ② XLSX `setTimeout(0)` 분리는 **보류 강등**: 본질적 메인스레드 블로킹은 Web Worker라야 해결(setTimeout은 로딩표시만 앞당김), 18곳 수정 대비 가치 낮음 → 실사용 프리즈 체감 시 Web Worker로(보류 섹션).

## Phase E — 기능 완결 (끊긴 마지막 고리 잇기)

- [x] **E-1** FAQ·공지 직원 노출 (사용자 결정=전면 복구+가드 — 서브스텝 분해):
  - [x] **E-1a** settingService 영속 복구 + settings 권한 가드. `settingService`를 pool(MockPool) → apiFetch로 재작성(인터페이스 유지=호출부 무변경). server.js settings 4엔드포인트에 가드: 읽기=`requireSettingsRead`(system 공유는 누구나·개인은 본인/HR), 쓰기/삭제=`requireSettingsWrite`(본인 또는 HR). **검증: HR FAQ 저장→DB 행 생성→재조회 OK / 피평가자 system 쓰기 403·읽기 200·본인 쓰기 200 / 테스트데이터 정리(0행 복귀)**. ⚠ **follow-up**: 매트릭스가 `user.employeeId`(개인별)로 저장/로드됨(`EvaluationMatrixContext`) — 전사 공통이어야 한다면 user_id='system'으로 바꿔야. 복구로 이제 실제 저장되니 매트릭스 페이지 동작 검증 권장(소급 변경은 없음).
  - [x] **E-1b** FAQ·공지 직원 노출 컴포넌트: 신규 `src/components/FaqSection.tsx`(shadcn Accordion, system/faq_catalog 로드·빈 trivial 제외·FAQ 0건 시 자동 숨김) → NotificationsPage 알림 목록 하단 표시(모든 역할 /notifications 접근). 공지(notice)는 이미 알림으로 도달(D-3)하므로 NotificationItem이 표시 — 별도 목록 불필요.
- [x] **E-2** write-on-read 제거: `useEvaluationDataDB`에 `readOnly` 옵션 추가 — 평가 미존재 시 자동 `createEvaluation` 대신 빈 데이터(`buildEmptyEvaluationData`, 마감기간 분기 재사용). **소비처 분석으로 정밀 수정**: 조회 전용 피평가자 화면 3곳(my/Home·MySchedule·MyFeedback, `user.employeeId`로 호출 → 평가자 미배정 피평가자가 자기 화면 여는 것만으로 평가자 없는 draft 생성되던 버그)에 `readOnly:true`. MyTasks/EvaluationAccordionCard는 evaluationId 기반(생성 안 함)·Evaluation.tsx(평가자 평가 시작)는 현행 유지·Dashboard 계열은 죽은 코드(F-2). tsc+build EXIT 0.
- [x] **E-3** 사이드바 IA·라벨 정리: ① '매칭 정합성 점검' 설정→**품질 그룹 이동**(검수 명시, 운영 기능) ② 라벨↔제목 동기화 — 진짜 불일치 2건만 수정(`/hr` "HR 관리자 대시보드"→"전사 현황"=라벨 일치, prompts "AI 품질 · 검수"→"AI 품질·검수"=가운뎃점 띄어쓰기 통일). 나머지 경미 차이(독려·리마인드↔센터·평가 매트릭스↔설정 등 제목이 라벨의 자연 확장)는 혼란 적어 보류 ③ 아이콘 변별: prompts IconMsg→IconSparkle, matching IconCheck→IconTarget(IconMsg 4→2회). **결정 메모**: ③ `/hr/prompts`→`/hr/ai-review` 라우트 개명은 북마크·리다이렉트 리스크 대비 가치 낮아 보류(라우트는 URL만, 사용자 비노출). tsc+build EXIT 0.

## ✅ 결정 게이트 G-2 — 브랜드 오렌지 단일화 (해소)

- [x] **G-2** **사용자 결정(2026-06-10): 역할 분리.** 브랜드 강조(로고·그래픽·대형 점수 숫자 등 large-text/비텍스트)=`#F55000`, 본문 텍스트·버튼 등 AA 필요 요소=`#B45309`. 두 값 모두 `src/index.css` 토큰으로 정의(`--ok-orange-brand: #F55000` 신설, `--ok-orange: #B45309` 유지)하고 **하드코딩만 치환**. 레퍼런스 `#D9623C`는 폐기(디자인 레퍼런스 재생성 시 반영).

## Phase F — 디자인·품질 마감

- [x] **F-1** 색상 토큰 수렴(G-2=역할 분리): ① `--ok-orange-brand: #F55000` 토큰 신설(light/dark) + 하드코딩 `#F55000` UI 6곳 치환(ScoreDisplay 대형 점수·team/Home 점·EvaluatorSchedule/MySchedule today선·Login gradient ×2 → brand). 셰이더(hero-v1·shader-animation)·차트 팔레트(HrDashboardCharts)는 GLSL/색배열이라 CSS var 불가→제외 ② **`#FFAA00`(대비 1.9:1 AA 완전 미달) → `var(--warning)`(#CA8A04 통과) HrDepartmentsPage 4곳** = 접근성 [높음] 해소. **결정 메모**: ③ 팔레트외 블루/그린 칩 ④ rgba 오버레이 10곳은 일관성 작업(시각 회귀 tsc/build 못 잡음)이라 점진 보류(보류 섹션). 차트 #FFAA00(MonthlyScoreTrend·HrDashboardCharts)는 차트 색 모듈과 함께 보류. tsc+build EXIT 0.
- [ ] **F-2** 죽은 코드 일괄 스윕(importer 0건 grep 재확인 후 삭제 1커밋): 구형 대시보드 5종(HRDashboard·Evaluatee/EvaluatorDashboard(+DB)), TaskManagement(+DB), NotificationContext(비DB), useEvaluationData/Unified, gemini.ts(+`VITE_GEMINI_API_KEY` 경로), DatabaseTest, GeminiTest, connectionTest, endToEndTest 쌍, 죽은 서비스 함수(getAllTasks·updateFeedback 등 존재하지 않는 라우트 호출 포함).
- [ ] **F-3** 품질 게이트 묶음: ① `package.json`에 `"typecheck": "tsc --noEmit"` 추가 ② eslint `no-explicit-any`·`no-unused-vars` → `warn` 복원 ③ tsconfig `noImplicitAny: true` 1단계 도입(전체 strict는 보류 섹션) ④ context value 미메모이즈(NotificationContextDB:138-148, AuthContext:126) `useMemo` 래핑.
- [ ] **F-4** 문서·마감 묶음: ① BACKEND_FRONTEND_OVERVIEW.md 포트(4000→5000)·API 목록 갱신 ② README의 Supabase 잔재 설명 정정 ③ `.env.example`에 AI/보안 신규 env 정리 ④ 날짜 포맷 공용 포매터(`src/lib/format.ts` 표시용/입력용 2종) + 집계 수치 `toLocaleString` 적용.

---

## 보류 (사용자 결정 — 루프 활성 경로 밖)

- **이메일 알림(SMTP+스케줄러)** — 사용자 결정(2026-06-10): 나중에 구현. dispatch.ts 어댑터 확장점 유지. 재개 시: nodemailer + node-cron, `notification_config` 소비 구현.
- **모바일/반응형** — 사용자 결정(2026-06-10): **계획 없음.** 트래커에서 제외.
- **GPT-OSS 복귀** — 내부망 이식 시 `.env`의 `AI_BASE_URL`만 교체(B-1 설계). 이식 시점에 외부 API 주의 캡션 제거.
- **F-D3b 개인 리포트 PDF** — 기존 보류 유지. 재개 시 `@media print`+`window.print()`(의존성 0) 권장.
- **SSO/AD 연동** — G-1 결정은 자체 비밀번호. 내부망 이식 시점에 필요해지면 재개.
- **전체 strict 모드** — F-3의 noImplicitAny 이후 단계적.
- **거대 파일 분할 리팩터링** — HrQualityPage(2,114줄)·HrMatchingPage(1,245줄) 등 4분해. 기능 무변경 리팩터링이므로 여유 시.
- **가상 스크롤(react-virtual)** — C-2 페이지네이션으로 충분하면 불필요. 실사용 데이터에서 판단.
- **신규 11개 화면 디자인 레퍼런스 박제** — Claude Design 재생성 작업(코드 아님). 별도 세션.
- **품질점검 임계값 캘리브레이션** — 실데이터 축적 후.
- **raw `<table>` → shadcn Table 전면 마이그레이션(8곳)** — C-2b에서 보류 강등(2026-06-10). 컬럼·셀 구조 제각각이라 회귀 위험 대비 순수 일관성 이득. 현재 raw table들은 동작·시각 일관성 유지 중. 여유 시 또는 해당 페이지 개편 동반 시.
- **대량 테이블 페이지네이션(AiReviewMonitoring·FeedbackDuplicateDetector 등)** — selected Set·배치검수 상태와 얽혀 상호작용 재설계 필요. 실사용 데이터에서 렌더 지연 체감 시 처리.
- **페이지 내장 손제작 모달 + native select 마이그레이션** — C-3b에서 점진 강등(2026-06-10). 독립 모달(AddEmployee·UploadPreview)은 shadcn Dialog 완료. 나머지(HrMatchingPage 재배정·HrDepartments·hr/Home·JobRoleBenchmark 내장 모달, AiSummaryReportModal, NotificationBell, EvaluatorHistoryModal, native select 11곳)는 tsc/build로 회귀 못 잡는 UI 작업이라 해당 페이지 개편 시 동반. 패턴 확립됨(Dialog 직접 적용).
- **XLSX export 메인스레드 블로킹(Web Worker화)** — D-4 ②에서 보류(2026-06-10). setTimeout(0)은 본질 해결 아님. hrDataExport는 이미 별도 청크(lazy)라 번들 영향은 없음. 대량 export 프리즈 실체감 시 Web Worker.
- **색상 토큰 잔여(팔레트외 블루/그린 칩·rgba 오버레이 10곳·차트 색 모듈)** — F-1에서 점진 보류(2026-06-10). 시각 회귀를 tsc/build가 못 잡는 일관성 작업. 핵심(brand 토큰·#FFAA00 접근성)은 완료. 디자인 레퍼런스 재생성·테마 정비 시 동반.
- **F-B1.2 드래그형 배정 보드** — 기존 보류 유지.

## 참고 — 검수 근거 요약 (루프가 맥락 확인용으로만 사용)

- 보안: 공용 비밀번호 '1234'(types/index.ts:310)·무인증 API 80개(server.js:2285)·IDOR(evaluation/:id)·reset 자기신고 가드(server.js:260,4902)·백도어 H1411166(AuthContext:21) — **Phase S 전이 배포 차단 사유**.
- 성능: 회사 단위 N+1(dashboardData.ts:199), React Query 미사용(useQuery 0건), lazy 0건(26페이지 eager).
- UX: 오류→빈상태 위장, window.confirm/prompt 30곳, raw table 8곳, 손제작 모달 10곳, 포커스 링 부재.
- 기능 고리: 알림 1회 로드(NotificationContextDB:48), FAQ write-only, 이메일 스텁(dispatch.ts:93).
- 상세 원문: `.omc/audit-reports/` 4개 보고서(기능/보안/UIUX/아키텍처).

## 작업 로그 (루프가 매 주기 한 줄 추가)

- 2026-06-10 트래커 생성 — 전수 검수 보고서 + 브랜치 구체화 플랜 통합, 사용자 결정 4건(이메일 보류·모바일 제외·기능 묶음·AI 임시 GitHub Models) 반영.
- 2026-06-10 게이트 일괄 해소(사용자 답변): **G-1=자체 비밀번호+httpOnly 쿠키 세션 / G-2=오렌지 역할 분리(#F55000 강조·#B45309 텍스트) / B-0=키는 사용자가 .env에 직접 입력(루프는 graceful 처리로 무대기 진행)**. 루프 계약을 무정지 모드로 전환 — 잔여 모호함은 보수적 기본값+`결정 메모:` 로그로 진행, 파괴적 작업만 예외 정지.
- 2026-06-10 P0-1: 브랜치 `feat/hr-admin-enhancement` 확인, 작업트리 clean(신규 파일=본 트래커뿐), 기준선 `npx tsc --noEmit` EXIT 0. 루프 시작.
- 2026-06-10 A-1: 버그 3종 일괄 수정 — ① EvaluationAccordionCard `?? ''` 제거(취소가 발송되던 버그) ② AiReviewMonitoring visibleRows 기준 selected prune useEffect 추가(숨겨진 선택 행 무음 누락 해소) ③ index.css `.sd-btn:focus-visible`/`.sd-sidebar-link:focus-visible` 포커스 링(+링크 display:block·radius 8, aside가 flex column이라 레이아웃 무변화). tsc+build EXIT 0. 결정 메모: ②는 카운트 보정 대신 prune 채택(표시=처리 일치가 더 예측 가능).
- 2026-06-10 A-2: UI 약속 정리 — ① NotificationSettings를 채널 현황 안내 2카드(인앱=동작·이메일=준비 중 Badge)로 재작성. 결정 메모: notification_config 토글 7종 전부 소비자 0(시스템·마감일·피드백 토글 포함)이라 부분 배지 대신 전체 안내형 채택, 저장 로직 제거(DB 데이터는 무변경, 재개 시 git 이력 참조) ② Reminders/NoticesFaq 발송 채널 `['inApp']`로, 토스트에서 "건너뜀(이메일 미설정)" 제거 ③ HrSettingsPage 4탭→2탭(알림·고급), 일반·권한역할 placeholder 탭 삭제(평가기간·사용자 관리 링크는 사이드바와 중복 확인), 부제 "알림·시스템 관리" ④ Login SSO 문구 제거. tsc+build EXIT 0.
- 2026-06-10 A-3: 부팅·자산 정리 — ① main.tsx 가짜 testSupabaseConnection 제거(connectionTest.ts 모듈 자체는 F-2 스윕에서 삭제 예정) ② Pretendard를 dynamic-subset CDN @import → `public/fonts/PretendardVariable.woff2`(1.96MB, 가변 단일 파일, SIL OFL) 자체 호스팅 @font-face로 교체. 결정 메모: 서브셋 수천 파일 대신 단일 가변 woff2 채택(내부망 단순성 우선), jsdelivr 모노레포 경로는 `packages/pretendard/...`였음. dist/fonts 복사 확인. tsc+build EXIT 0.
- 2026-06-10 B-1a: server.js에 AI 프록시 구획 신설 — `GET /api/ai/status`(configured/external/model, 키 비노출) + `POST /api/ai/chat`(메시지 검증·모델 서버 강제·temperature/max_tokens만 통과·60s 타임아웃·업스트림 에러 본문 로그만). env: AI_BASE_URL(기본 GitHub Models)/AI_API_KEY/AI_MODEL(기본 openai/gpt-4.1-mini), 명시적 AI_BASE_URL=키 불필요(GPT-OSS 복귀 경로). IP별 분당 20회 레이트리밋(+5분 주기 버킷 청소, 인증 후 세션 주체로 교체 예정). **스모크: status configured=true(사용자가 키 기입력 확인) → chat 엔드투엔드 `1+1=2` 응답 OK(gpt-4.1-mini-2025-04-14)**. node --check·tsc·build EXIT 0.
- 2026-06-10 B-1b: gptOss.ts `callGptOss`를 `/api/ai/chat` 경유로 전환 — 직접 호출 지점은 1곳뿐(grep 확인), 내부 IP·모델명 상수 제거(클라이언트에 주소·키·모델 0), 503→"AI 미설정" / 429→"잠시 제한" 한국어 에러 매핑(검수 래퍼들은 catch→skipped 기존 경로). 함수 시그니처·응답 파싱(OpenAI 호환 choices) 무변경, src 전체 `172.17.` 잔존 0. tsc+build EXIT 0.
- 2026-06-10 B-1c(+긴급 수습): ① **사용자 편집으로 `.env.example`(추적 파일)에 실키 유입 발견 → 커밋 전 placeholder로 원복**(키는 git 이력 미유입 확인, `.env`에는 보존). ⚠ 키가 평문 파일·세션에 노출됐으므로 **PAT 회전(재발급) 권장** ② `.env` 값이 따옴표로 감싸져 수제 파서가 그대로 읽던 문제 → server.js 파서에 따옴표 벗기기(dotenv 호환) 추가 ③ 사용자가 지정한 `openai/gpt-5-nano`는 업스트림 `unavailable_model` 거부 → **결정 메모: 동작 우선으로 `.env`만 `openai/gpt-4.1-mini` 복원**(재시도는 .env 한 줄), 재스모크 CHAT_OK ④ B-1c 본작업: gptOss `fetchAiStatus`(세션 캐시) + HrPromptsPage 상단 상태 배너 — external=주의(원문 외부 전송·이식 후 자동 소멸), 미설정=안내(휴리스틱은 AI 없이 동작). tsc+build EXIT 0. **B-1 전체 완료.**
- 2026-06-10 S-1a: 백업 `hr-db-backup-20260610_preS1a.dump`(1.6MB, 컨테이너 pg_dump -Fc, 호스트 pg_dump 부재라 docker exec 경유) + `.gitignore`에 `*.dump` 추가(덤프 커밋 방지). `db_mig/add_auth_columns.sql` 적용·검증: must_change_password boolean NOT NULL default true / password_hash text NULL. bcryptjs 설치(해시 왕복 OK). 결정 메모: 초기 비밀번호=사번(hash NULL 상태) + 변경 강제, 세션=인메모리(재시작=재로그인 수용) — S-1b에서 구현. tsc+build EXIT 0.
- 2026-06-10 S-1b: server.js Auth 구획 — login(계정 열거 방지 통일 401·IP 분당 10회 제한)/me/logout/change-password(8자↑·사번 금지·현재 비밀번호 확인). httpOnly+SameSite=Lax 쿠키(COOKIE_SECURE env로 Secure 부여), 인메모리 세션(절대 8h·유휴 2h·10분 주기 청소), 응답에서 password_hash 항상 제거(sanitizeEmployee), `getSession`은 S-2 가드 공용. **스모크 8단계 전부 통과**(wrong-pw 401 → 초기=사번 로그인 must_change=true·hash 비노출 → me OK → 변경 OK → 새 비밀번호 must_change=false → 구 비밀번호 401 → 로그아웃 후 me 401), 테스트 직원(2402020) 상태 원복(hash NULL). node --check·tsc·build EXIT 0.
- 2026-06-10 S-1c: 프런트 인증 전환 — 신규 `authService`(서버 한국어 에러 메시지 그대로 노출하는 전용 래퍼) + AuthContext 재작성: 부팅 시 `/api/auth/me` 복원(localStorage 신원 캐시는 제거만, `preferredRole` UX 선호만 저장), login은 `{ok,message,mustChangePassword}` 반환, changePassword 추가, switchRole은 서버가 준 availableRoles로 검증(employeeService 왕복 제거). ProtectedRoute에 mustChangePassword 차단 추가(변경 전 앱 진입 불가). Login에 비밀번호 변경 폼(현재=방금 입력 비밀번호 자동, 8자↑·사번금지·확인일치, 새로고침 복원 케이스 포함). `CONSTANTS.DEFAULT_PASSWORD('1234')` 삭제 — **공용 비밀번호가 코드베이스에서 소멸**. getAvailableRoles 사전조회 제거(계정 열거 방지·요청 1회 절감). H1411166 백도어는 계획대로 S-3에서 제거. tsc+build EXIT 0. **S-1 전체 완료** — 브라우저 수동 확인 권장(로그인→변경 강제→재로그인). ⚠ 운영 전환 시 전 직원 비밀번호는 초기(=사번) 상태.
- 2026-06-10 S-2: 인가 게이트 — `app.use('/api', ...)` 전역 세션 필수(예외: /api/auth/*·/api/ai/status·/health, /api/ai/chat은 자체 검사+사용자별 레이트리밋으로 전환). `requireHr`(DB available_roles만 신뢰, admin 계정=항상 HR)를 16개 HR 라우트에 적용: employees CRUD·imports(+preview)·evaluator-edit·배정이력 cancel/correct·reset 2종·evaluation/feedback/notifications(벌크)/prompt 쓰기·삭제. assertHrActor(body 자기신고+admin 문자열 우회) 삭제, 라우트 레벨 actor 5곳 세션 도출(`req.session.employeeId`; 내부 헬퍼 2곳의 body changed_by는 표기 메타데이터로만 잔존). reset: admin_audit_logs TRUNCATE 제외 + 실행 자체를 같은 트랜잭션에 감사 기록(actor는 reason에도 병기 — 직원삭제 시 FK SET NULL 대비). **스모크 8케이스 통과**: 무세션 401·구 익스플로잇(actor_id=admin) 401·AI무세션 401·status 공개·로그인 후 200·비HR DELETE/reset 403. ⚠ **HR 계정 주의: DB에 H1411166 없음 — HR 기능은 admin 계정(초기 비밀번호 'admin'→변경 강제) 또는 available_roles에 hr 부여된 계정으로만 접근 가능**(S-3에서 클라 백도어 제거 예정). node --check·tsc·build EXIT 0.
- 2026-06-10 S-3: 행 단위 접근제어 — 가드 미들웨어 방식(행 사전조회→403, 핸들러 무수술): `guardEvaluationParam`(evaluation/:id GET·PUT, return-request, reopen 2종, tasks/evaluation/:id)·`guardEmployeeEvaluationsParam`(by-employee·evaluations/employee — 본인/HR/현담당/과거배정)·`guardTaskParam`(feedbacks/task/:taskId + POST /api/feedback body)·`guardFeedbackParam`(feedback/:id)·`guardNotificationParam`(notification/:id GET·read·DELETE). 광역 라우트 HR 게이트 9개(evaluations 전체·status·tasks/current-year·feedbacks 전체·임포트 GET 4종·qna-logs — 비HR 소비자 0 확인). 알림 컬렉션 3종 비HR=본인 recipient 강제(벌크 삭제 requireHr는 본인 비우기 흐름이라 행 강제로 교체). **password_hash 누출 회귀 차단**: SELECT * 직원 응답 5곳 stripAuthFields(검증: 735행 leak 0). 클라 H1411166 백도어 제거. 결정 메모: ①명부(employees·단건)는 auth-only 유지 — EvaluatorRequestPage(평가자)가 전직원 목록 사용 ②evaluations에 평가자 컬럼 없음(스모크 500으로 발견) — assignment_history·employees.evaluator_id 파생 조인으로 판정. **스모크: 본인 200/타인 403(by-employee·evaluation id·tasks)/평가자 경로 OK/HR 전체 OK/비HR 전체목록 403/알림 본인 강제**. 잔여(수용): tasks·entries 쓰기 행 가드, HR 전용 RETURNING 응답 해시(HR만 노출) — 후속. node --check·tsc·build EXIT 0.
- 2026-06-10 S-4: 서버 하드닝 — ① 수제 JSON 파서(본문 개행 공백치환·크기무제한) → `express.json({limit:'5mb'})` ② helmet(CSP off — API 서버) ③ CORS `origin:true` → 화이트리스트(CORS_ORIGINS env, 기본 5173/4173, Origin 없는 프록시·동일호스트는 허용) ④ 에러 응답 `err.message` 직노출 제거(statusCode 있는 의도적 4xx만 메시지 유지, 그 외 'Database error'; import detail 노출 제거) ⑤ DB 미가용 무음 mock → **fail-fast(`exitOrMock` 단일 정책, 운영 exit 1·개발 ALLOW_MOCK_FALLBACK=true)** ⑥ 전역 레이트리밋 /api 분당 3000(D-1 N+1 해소 후 하향 예정). **추가 발견·수정**: .env 수제 파서가 셸/compose 환경변수를 덮어쓰던 버그(dotenv 표준 위반·운영 env 주입 무력화) → 기존 env 우선으로 수정(fail-fast 테스트도 이걸로 가능해짐). 결정 메모: mock 헬퍼 16곳은 개발 모드·개별 쿼리 폴백용이라 존치. **스모크: helmet 헤더·RateLimit 헤더 존재 / CORS 나쁜 오리진 차단·정상 허용 / 멀티라인 JSON 로그인 OK / fail-fast exit code 1 / 정상 기동 health ok / IDOR 403 유지**. tsc+build EXIT 0. **Phase S(보안) 전체 완료 — 배포 차단 사유 해소.**
- 2026-06-10 C-1a: 신규 `src/components/ui/confirm-dialog.tsx` — imperative `ConfirmDialogProvider`+`useConfirm`/`useReason`(Promise 반환, ESC·바깥클릭=취소→false/null). shadcn AlertDialog 기반, variant danger(--danger 토큰)·requireTypedConfirmation(RESET 타이핑 게이트)·required 사유. App에 Provider 마운트(Auth 바깥=어디서나 호출). 파괴적 7곳 치환: HrSettingsPage RESET 2종(window.confirm+prompt 4콜→타이핑 확인 다이얼로그), HrPeriodsPage 삭제·잠금·잠금해제 3곳. 결정 메모: 한 주기 과부하 방지 위해 C-1b(나머지 18곳)는 다음 주기 분리. 죽은 훅 2곳(useEvaluationData/Unified)은 C-1b 제외(F-2 일괄삭제). tsc+build EXIT 0.
- 2026-06-10 C-1b: 나머지 18곳 치환 완료 — HrUsersPage 7(평가자 취소/변경/정정/단계변경/삭제/일괄삭제/일괄변경), Evaluation 2(최종저장 confirm·돌려보내기 reason), EvaluationAccordionCard 3(수정요청 reason·최종제출 confirm·과업삭제 danger), ChangeRequestsPage 3(승인/반려 reason/되돌리기), HrQualityPage 1(재검토 reason), NotificationsPage 1(전체삭제 danger·핸들러 async화), EvaluatorRequestPage 1(변경요청 취소), PromptManagement 1(프롬프트 삭제 danger), useEvaluationDataDB 1(저장 경고 confirm — 커스텀 훅 본문서 useConfirm 호출, Provider 하위 보장). 파괴적 액션은 variant danger 적용. **라이브 window.confirm/prompt 0건**(잔존 2곳=죽은 훅 F-2 대상, 1곳=주석). tsc+build EXIT 0. **C-1 전체 완료.**
- 2026-06-10 C-2a: 신규 `src/components/ui/state-views.tsx`(ErrorState role=alert+다시시도·EmptyState+CTA·LoadingState aria-busy, --danger/--fg-muted 토큰). 검수 [치명] "오류가 빈 상태로 위장" 수정 — MyTasksPage가 fetch 실패를 `setEvaluations([])`로 흡수해 "등록된 평가가 없습니다"로 표시하던 것을 `loadError` 분기로 분리(실패=ErrorState+재시도 / 빈=EmptyState). 결정 메모: MyFeedback·MySchedule은 `useEvaluationDataDB`(error 미노출·write-on-read 훅) 기반이라 error 분리는 **E-2에서 훅 손볼 때 동반**(중복 회피). tsc+build EXIT 0.
- 2026-06-10 C-2b/c: 대량 렌더 방지 — HrIndividualFeedbackPage 좌측 전직원 명단(~735 버튼 무제한 map)에 표시 상한 PICKER_LIMIT=100 + 초과 시 "검색으로 좁혀주세요" 안내(검색·조직필터 기존). **계획 재정의 결정 메모**: raw table 8곳 shadcn 전면 치환은 회귀 위험 대비 순수 일관성이라 보류 강등(보류 섹션 2건 추가). HrMatching=이미 shadcn·위반행만, AiReview/Duplicate=selected/배치상태 얽힘으로 실데이터 체감 시 처리. **C-2 전체 완료**(C-2a 오류상태 + C-2b 핵심 대량렌더). tsc+build EXIT 0.
- 2026-06-10 C-3a: 모달 마이그레이션 패턴 확립 — shadcn Dialog 직접 적용(별도 래퍼 불필요: DialogContent에 focus trap·ESC·role=dialog·바깥클릭·우상단 X 내장). AddEmployeeModal(독립·단순) 손제작 오버레이(rgba div+stopPropagation+커스텀 닫기) → `<Dialog open onOpenChange>` + DialogContent(sm:max-w-[560px]) + DialogHeader/Title + DialogFooter. 폼 내용·sd-input·EvaluatorPicker 유지, isSaving 중 닫기 가드. **접근성 확보**(키보드 포커스 가둠·ESC). 결정 메모: 공용 래퍼 대신 Dialog 직접 사용(이미 충분한 추상화), native select는 C-3b에서 shadcn Select와 함께. typo 자가수정(키릴 Ф). tsc+build EXIT 0.
- 2026-06-10 C-3b: UploadPreviewModal(독립) 손제작 오버레이 → Dialog/DialogContent(flex column·스크롤 테이블 유지)+DialogHeader/Title/Description, isApplying 중 닫기 가드. 본문 raw table은 C-2b 보류라 유지. **결정 메모**: 페이지 내장 모달·native select 11곳은 시각/상호작용 회귀를 tsc·build가 못 잡는 UI 작업 → 자동 루프 부적합, 점진 보류(보류 섹션 기록). 독립 모달 2곳(AddEmployee·UploadPreview)으로 패턴 시연 완료. **C-3 종결**(독립 모달 처리 + 나머지 점진). tsc+build EXIT 0.
- 2026-06-10 C-4: 신규 `src/components/ErrorBoundary.tsx`(클래스, getDerivedStateFromError+componentDidCatch, ErrorState fallback 재사용+다시시도, resetKey 변경 시 자동 해제). App 2층 적용 — 루트(전체 트리, 최후 방어선) + AppShell 라우트 단위(`resetKey={location.pathname}` → 다른 메뉴 이동 시 페이지 에러 자동 복구, 한 페이지 예외가 헤더·사이드바까지 안 날림). **렌더 예외 백화면 방지**. tsc+build EXIT 0. **Phase C(공통 컴포넌트) 전체 완료.**
- 2026-06-10 (사용자 검수 개입) 로그인 500 진단: **코드 정상, 백엔드 미실행이 원인** — `npm run dev`는 vite(프론트)만 띄움, 백엔드는 `npm run dev:server`(nodemon) 별도 필요. 5000 DOWN → vite 프록시가 500 반환. 백엔드 기동 후 admin 로그인 정상(must_change=true·hash 비노출) 확인. unicornstudio 셰이더 import 에러는 로그인 배경 장식 별개 이슈(기능 무관).
- 2026-06-10 D-1/D-2 보류 결정: task 조회의 `task_evaluation_entries` 최신값 덮어쓰기·assignment_history 연계 복잡 쿼리를 평가기간 일괄로 재작성 시 점수·피드백 **정합성 전수검증 필요**, 틀리면 조용히 잘못된 평가 수치 전사 노출 → 무정지 루프 단독 부적합, 사용자 검증 동반 필요로 보류 강등. **결정 메모**: 성능은 실병목이라 가치 크나, 정합성 리스크가 자동화 부적합. D-3(알림 폴링, 안전·격리·기능실효성)로 진행.
- 2026-06-10 D-3: NotificationContextDB에 알림 도달 메커니즘 추가 — 로그인 1회 로드 외에 ① 탭 보이는 동안 90~150초 지터 폴링(1,000명 동시 폴링 몰림 방지) ② visibilitychange·focus 시 즉시 재조회. 백그라운드 탭 폴링 안 함(서버 부하·배터리 절약). **클라이언트만 변경**(server.js 무변경=사용자 테스트·nodemon 영향 0). 기존 `loadNotifications`(useCallback) 재사용, cleanup 완비. 결정 메모: 경량 unread-count 엔드포인트 분리는 visible-only 폴링으로 부하 감당되므로 실문제 시로 보류(server.js 무변경 우선). 이로써 HR 리마인드(F-C1)·재검토 요청(F-B2.2)·공지(F-C5)가 새로고침 없이 수신자에 도달 — 기능 실효성 복원. tsc+build EXIT 0.
- 2026-06-10 D-4: 라우트 lazy 분할 — App.tsx 23페이지 `lazy(() => import())` + AppShell Outlet `Suspense`(레이아웃 유지·본문만 LoadingState), Login·NotFound는 eager(첫 진입·작음). **빌드 청크 확인: index 2,263KB→420KB(gzip 613→135), 페이지별 독립 청크, hrDataExport 450KB·scoreTrend 435KB·date-picker 63KB 분리 → 피평가자가 HR/xlsx/recharts 미수신**. ② XLSX setTimeout 보류 강등(본질=Web Worker, 가치 낮음). tsc+build EXIT 0. **Phase D 핵심 완료**(D-3 알림·D-4 번들; D-1/D-2는 정합성 위험으로 사용자 검증 동반 보류).
- 2026-06-10 **E-1 중대 발견 + 사용자 결정(전면 복구+가드)**: settings 테이블 직접 조회=0행 → `settingService`가 브라우저 MockPool이라 FAQ·평가매트릭스·기대수준 저장이 **한 번도 실동작한 적 없음**(검수 "write-only"보다 심각=전체 no-op). settings API 무가드도 발견(피평가자가 시스템 설정 조작 가능, S-2 누락). 사용자 결정=전면 복구.
- 2026-06-10 E-1a: settingService→apiFetch 복구 + settings 4엔드포인트 권한 가드(requireSettingsRead/Write, requesterIsHr 재사용). 스모크 6케이스 통과(HR 저장·재조회·피평가자 403/200·본인 200·정리). settingService 쓰는 매트릭스·기대수준·FAQ가 이제 실제 영속. follow-up: 매트릭스 user_id=employeeId(개인별) — 전사 공통 의도면 별도 수정. tsc+build EXIT 0.
- 2026-06-10 E-1b: 신규 `FaqSection`(shadcn Accordion, settingService로 system/faq_catalog 로드, trivial 제외, 0건 자동 숨김) → NotificationsPage 하단. HR이 등록한 FAQ가 전 직원에게 노출(write-only 해소). 공지는 알림 도달(D-3)로 충분. tsc+build EXIT 0. **E-1 전체 완료.**
- 2026-06-10 E-2: write-on-read 정밀 수정 — useEvaluationDataDB `readOnly` 옵션(평가 미존재 시 생성 대신 빈 데이터). 소비처 분석: 피평가자 조회 3곳(my/Home·MySchedule·MyFeedback)만 readOnly=true → "평가자 미배정 피평가자가 자기 화면 열면 평가자 없는 draft 생성" 버그 차단. 평가자 흐름(Evaluation.tsx)·evaluationId 기반(MyTasks)·죽은 Dashboard는 미변경. tsc+build EXIT 0.
- 2026-06-10 E-3: 사이드바 IA — 매칭 정합성 점검을 설정→품질 그룹 이동(운영 기능 정위치), 라벨↔제목 불일치 2건 동기화(/hr·prompts), 아이콘 변별(prompts→Sparkle·matching→Target). 경미 차이·라우트 개명은 보류(혼란 적음/리스크). tsc+build EXIT 0. **Phase E(기능 완결) 완료**(E-1 settings복구+FAQ노출·E-2 write-on-read·E-3 IA).
- 2026-06-10 F-1: 색상 토큰 수렴 핵심 — `--ok-orange-brand:#F55000` 토큰 신설(G-2 역할 분리) + #F55000 UI 하드코딩 6곳 brand 치환(셰이더·차트 제외), **#FFAA00(대비 1.9:1) → --warning 4곳(접근성 [높음])**. 팔레트외 블루/그린·rgba 오버레이·차트색은 점진 보류(시각 회귀 자동검증 불가). tsc+build EXIT 0.
