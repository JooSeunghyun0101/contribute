# HR 고도화 — 진행 트래커 (루프 상태판)

> 이 파일은 `/loop` 자동 개발의 **상태 머신**이다. 매 주기마다 여기서 다음 1스텝을 읽고, 완료 시 체크하고, 결정 게이트에서 멈춘다.
> 원본 설계: [hr-admin-enhancement-plan.md](./hr-admin-enhancement-plan.md) · 시작 2026-06-09
>
> 상태 기호: `[ ]` 대기 · `[~]` 진행중 · `[x]` 완료 · `[!]` 차단(결정 필요)

---

## 루프 1회 계약 (매 주기 이걸 그대로 수행)

1. 이 트래커에서 **가장 위의 `[ ]` 1개**를 고른다. (`[!]` 결정 게이트를 만나면 → **루프 종료 후 사용자에게 질문**)
2. 그 항목을 `[~]`로 바꾸고 구현한다. **한 주기 = 한 항목.** 범위 넘기지 말 것.
3. 큰 기능(F-로 시작) 항목을 처음 열면, 먼저 **하위 서브스텝으로 분해해 트래커에 추가**하고 그 첫 서브스텝부터 진행한다.
4. 검증: `npx tsc --noEmit` 통과 → `npm run build` 통과. (이 레포는 `typecheck` 스크립트 없음 → `npx tsc --noEmit` 사용)
5. 통과하면 커밋: `feat: ...` / `fix: ...` / `refactor: ...` 규칙. 실패하면 고치고 재검증, 못 고치면 `[~]`인 채로 멈추고 보고.
6. 항목을 `[x]`로 바꾸고 **이 파일을 커밋에 포함**한다.
7. 다음 주기로. 모든 항목이 `[x]`면 루프 종료.

**불변 규칙**
- 작업 브랜치에서만. `main` 직접 커밋 금지.
- 임의 HEX 금지, `tailwind.config.ts` OK 팔레트만. Supabase는 `src/lib/services/` 경유.
- 설계 원칙 위반 금지(특히 §2 품질점검: 판정 아님·HR 전용·인원 병기·소표본 회색·중립색).
- 결정 게이트는 절대 임의로 추정해 진행하지 않는다. 멈추고 묻는다.

---

## Phase 0 — 준비

- [x] **P0-1** 작업 브랜치 생성: `feat/hr-admin-enhancement` (없으면 생성 후 체크아웃)

## Phase A — 기반(IA·정리, 결정 불필요·저위험)

- [x] **A-1** 사이드바 HR 메뉴 5그룹화 (§1). `Sidebar.tsx`의 평면 `menus.hr`를 그룹 헤더 지원 구조로 — 현황·분석 / 운영 / 품질 / 결과 / 설정. 기존 라우트는 유지, 그룹 라벨만 추가.
- [x] **A-2** 위험영역 env 격리 (§1). `HrSettingsPage.tsx`의 DB 일괄삭제 버튼을 `VITE_ENABLE_DANGER_ZONE` 플래그로 가드 → 기본 숨김. ⚠ 클라 숨김만 — server.js reset 엔드포인트 서버측 가드는 후속(아래 로그).
- [x] **A-3** 시스템 설정 탭 분해 (§1). `HrSettingsPage.tsx`를 상단 탭(일반·알림·권한역할·고급/시스템)으로. "활성 평가기간 요약" 중복 삭제→링크 한 줄.

## Phase B — 1차 기능 (인프라 있음·결정 불필요)

- [x] **F-B1.1** 매칭 정합성 점검 화면(read-only). `HrUsersPage` 매칭 데이터 재사용 → 누락·자기평가·이상 탐지 리스트/요약. ⚠ 피평가자 다중 평가자=발령(정상)이므로 중복으로 플래그 금지([[multi-evaluation-means-transfer]]); 진짜 이상만. 신규 라우트 + 사이드바(설정 그룹) 진입.
- [보류] **F-B1.2** 드래그형 배정 보드(read-write). **사용자 결정(2026-06-09): 보류** — 추후 별도 설계(↓ 보류 섹션).
- [x] **F-B2.1** AI 검수 모니터링(read-only). `HrPromptsPage`/품질 영역에 평가의견 AI 플래그 목록(짧음·비구체·점수불일치)·분석. `feedbackApiService`·OpenAI 재사용. AI 호출 비용/배치/캐싱 고려.
- [보류] **F-B2.2** 반려 액션(write=평가자 통지). 알림 채널(D-1) 의존 → **D-1 이후 진행**(↓ 보류 섹션).

## ⛔ 결정 게이트 1 — 알림 채널

- [x] **D-1** 알림 발송 채널. **사실 확인**: 인프라=인앱 전용(`createNotification`/`/api/notification`), 이메일 발송 백엔드 없음(토글 UI만·무동작). **사용자 결정(2026-06-09)**: 인앱 동작 + **채널 추상화 계층**(이메일 어댑터 확장점) 준비. → F-C1에서 추상화 계층을 첫 소비자와 함께 구현.

## Phase C — 2차 기능 (결정 후 진행)

- [x] **F-C1** 독려·리마인드 센터 (#1). 미완료 평가자 리스트 + 마감 임박 + 리마인드 발송(HR 명시 액션·확인·대량발송 방지) + 발송 이력. **채널 추상화 계층(D-1) 포함** — 인앱 동작 + 이메일 어댑터 확장점. 발송이력은 기존 notifications 재사용 우선(신규 스키마 지양).
- [x] **F-B2.2** 재검토 요청(반려) 액션. F-B2.1 AI 검수 모니터링 행에 '재검토 요청' → 평가자 통지. 기존 `requestReturn`/`/return-request` 재사용(origin='hr' 문구 분기만, 상태 무변경·하위호환). HR 명시+확인. (§2.3 '재검토 요청'과 공유 primitive)
- [x] **F-C2a** 평가 품질 점검 — **횡단+무결성**(사용자 결정: 점진). 무결성 자동 플래그(빈 평가·가중치 합≠100·평가의견 미작성 등) + 변별력(갭 분산)×분포 건전성(횡단, 단일 기간 작동) + 드릴다운 + 재검토 요청(F-B2.2 `requestReturn` 재사용). 설계원칙 §2.1 엄수(판정 아님·HR 전용·인원 병기·소표본 회색·중립색). 갭=점수−성장레벨.
- [x] **F-C2b-prep** 샘플 데이터 현실적 재구성. ✅ `db_mig/reconstruct_sample_2025_2026.cjs` 작성·DRY_RUN 튜닝·COMMIT 적용. 점수 봉우리 3점(16/27/31/26%)·갭 meet중심(38/26/26/10)·평가자 성향 다양·연도ρ 0.55·전보 64·의견 unique 78%·무결성 결함 22. 점수=매트릭스·가중치=100·완료동기화 보존. 백업 보유. **사용자 결정(2026-06-09): 2025·2026 모두 샘플 → 최대한 실제처럼 재구성 후 F-C2b 옵션2 구현, 데모 caveat 불필요.** 평가자 잠재성향(관대도·변별력) 다양화·연도간 드리프트(기질 vs 급변)·전보 코호트·현실적 갭/점수 분포·의견 품질 다양화. ⚠ DB 쓰기(대량) — 백업 선행, 멱등 스크립트, 스키마/매트릭스 규칙 준수.
- [x] **F-C2b** 평가 품질 점검 — **종단**(전보 코호트·전년 드리프트·코호트-잔차·기질vs급변). `HrQualityPage` 하단 보조 패널 탭 4개(기본=기질vs급변), 양 기간 일괄 로드(useCompanyDashboardRecords+usePriorYearRecords, 무폭주), 2026 선택 시 prior=2025 실데이터 표시. 발령=정상·코호트 맥락·소표본 회색·중립색·완료율 caveat. read-only(requestReturn 재사용). typecheck+build·리뷰 pass.
- [x] **CLEANUP** F-C2a 데모/합성 caveat 제거(F-C2b 구현에 포함). CaveatBar GEN 문구→"선택한 평가기간 데이터 기준", grep 잔존 0. 완료율·발령정상 기능 표기 유지.
  - (※ 원 F-C2는 위 F-C2a/F-C2b로 분해됨.) 변별력(갭 분산)×분포 건전성 주력 + 종단 보조 + 무결성 리스트 + 드릴다운 + 재검토 요청. *서브스텝 분해 필수, 설계원칙 §2.1 준수.*
- [x] **F-C3** 평가의견 표절·복붙 탐지 (#4). 신규 `FeedbackDuplicateDetector`(HrPromptsPage 탭). 평가자 내부 의견 정규화 해시·편집거리 휴리스틱 즉시 + 경계 쌍만 AI 유사도 온디맨드(신규 `reviewFeedbackPairSimilarity` 래퍼). trivial 정형 단문 제외·발령정상·중립 톤·read-only(requestReturn). typecheck+build·리뷰 pass.
- [x] **F-C4** 점수-의견 정서 정합성 (#5). ✅ **F-B2.1에서 이미 구현 완료**(`reviewSentimentGap` = 갭버킷 의미↔의견 논조 정합성 = "4점인데 부정 톤" 탐지, AiReviewMonitoring sentiment 플래그). 신규 코드 없음 — 별도 탭 승격은 메뉴 비대화라 보류(AiReviewMonitoring 플래그로 충분).
- [x] **F-C5** 일괄 공지·FAQ 푸시 (#2). 신규 `HrNoticesFaqPage`(/hr/notices-faq, 운영 그룹). 일괄 공지(수신자 범위 토글·OrgFilterBar·수신자 확인·24h 중복가드·대량경고·dispatch 경유 인앱+이메일확장점) + FAQ CRUD(settings `faq_catalog` 재사용, 신규 스키마 0). notification_type='notice' 격리, read 무폭주(1훅). 리뷰 pass, medium(이력한도 500→서버캡 200 정합) 수정. typecheck+build 통과.

## ⛔ 결정 게이트 2·3 — 직군 필드 / PDF 방식

- [x] **D-2** 직군(family) 필드. **사용자 결정(2026-06-10): 직종(job_role) 단위만** — 직군 필드 미추가(마이그레이션 없음). 나중에 필요 시 추가.
- [x] **D-3** 개인 리포트 PDF 방식. **사용자 결정(2026-06-10): PDF 보류** — 화면/엑셀로 먼저, PDF 의존성 추가 안 함. F-D3 보류, F-D2는 엑셀 export 활용.

## Phase D — 3차 기능 (주기 종료·데이터 완결 후)

- [x] **F-D1** 직종 벤치마크 (#8). **직종(job_role) 단위만**(직군 필드 없음). 같은 직종 내 분포 비교(갭/달성/점수), 품질 진단(F-C2a) baseline 공유. 현황·분석 그룹. read-only. 신규 `HrJobRoleBenchmarkPage`(/hr/job-role-benchmark). 비평이 달성률 정의 정정(record.achieved 대신 samples gap≥0/n). 리뷰 pass.
- [x] **F-D2** 부서/본부 결과 리포트 (#7). 임원 보고용 요약. **화면 + 엑셀 export 활용(PDF 없음)**. 기존 `hrDataExport` 재사용. 신규 `HrDepartmentResultsPage`(/hr/results, 결과 그룹) + `downloadOrgResultWorkbook`. 조직 계층 집계·갭/달성/완료율·소표본 회색·read-only. 리뷰 pass.
- [보류] **F-D3** 개인 피드백 리포트 PDF (#6). **사용자 결정: PDF 보류**(D-3). 화면 요약은 가능하나 PDF 생성은 의존성 추가 시 재개.

---

## 보류 (사용자 결정 — 추후 재개, 루프 활성 경로 밖)

- **F-B1.2** 드래그형 배정 보드(read-write). 보류 2026-06-09. 재개 시 결정 필요: 엑셀 매칭 흐름과의 관계(대체/병행), 재배정=발령 이력 기록 의미, 드래그 vs 행별 액션.
- ~~**F-B2.2** 반려 액션~~ → ✅ **활성화됨**(F-C1 dispatch 완료) — Phase C 상단으로 이동.

## 작업 로그 (루프가 매 주기 한 줄 추가)

- 2026-06-09 트래커 생성.
- 2026-06-09 P0-1: `feat/hr-admin-enhancement` 브랜치 생성. 설계 문서 2건 커밋.
- 2026-06-09 A-1: 사이드바 HR 메뉴 5그룹화(현황·분석/운영/품질/설정, 결과는 빈 그룹 미렌더). MenuItem.group 추가·Fragment 래핑. typecheck+build 통과, 적대적 리뷰 pass(이슈 0).
- 2026-06-09 A-2: 위험영역(DB 일괄삭제) `DANGER_ZONE_ENABLED = import.meta.env.VITE_ENABLE_DANGER_ZONE === 'true'` 가드, 기본 숨김. `.env.example`에 플래그 추가. typecheck+build 통과, 리뷰 pass.
  - 후속(비차단): server.js의 resetEmployees/resetMatching 엔드포인트는 여전히 열려 있음 → 운영 안전 강화 원하면 서버측 권한/플래그 가드 별도 추가 검토.
- 2026-06-09 A-3: HrSettingsPage를 shadcn Tabs 4탭(일반·알림·권한역할·고급/시스템)으로 분해. 활성 평가기간 요약 중복 제거→/hr/periods 링크 카드, 위험영역은 고급 탭으로 이동하며 DANGER_ZONE_ENABLED 가드 유지. dead code 정리. typecheck+build 통과, 리뷰 pass(info 3). 설계+비평 단계가 IA 리스크(일반·권한 탭 콘텐츠 옅음) 명시 — 추후 전사 공통값/역할 UI 채워지면 해소.
- 2026-06-09 **Phase A(기반) 완료.** F-B1을 F-B1.1(read-only 정합성)·F-B1.2(read-write 드래그 배정=신규 게이트)로 분해. F-B1.1 착수.
- 2026-06-09 F-B1.1: 신규 `HrMatchingPage`(/hr/matching, 설정 그룹) 매칭 정합성 점검 화면(read-only). 규칙 5종(미배정·평가레코드없음·자기평가후보=anomaly / 발령가능·평가자신원미확인=neutral-info). 중복 카테고리 자체 없음(발령=정상 규칙 준수). 비평이 데이터모델 정정: evaluation LIMIT 1·evaluator_id 파생값·발령이력 lazy(요청폭주 방지). typecheck+build 통과, 리뷰 pass(read-only/발령규칙/중립톤 모두 OK). → **다음은 F-B1.2 게이트: 루프 정지, 사용자 확인 대기.**
- 2026-06-09 F-B1.2 게이트: **사용자 결정=보류**. F-B2를 F-B2.1(read-only AI 검수 모니터링)·F-B2.2(반려 통지=write, D-1 의존→보류)로 분해. F-B2.1 착수.
- 2026-06-09 F-B2.1: `HrPromptsPage`를 Tabs로 [AI 검수 모니터링][프롬프트 관리]. 신규 `AiReviewMonitoring`(read-only). 짧음/무의미=클라 휴리스틱 즉시, 비구체/점수-의견 정서불일치=온디맨드 AI(배치≤20·동시성3·캐싱). 자체 GPT-OSS 재사용(신규 엔드포인트 0), 신규 프롬프트 키 1개·reviewSentimentGap·detectGenericFeedback export 추가. 사이드바 라벨 'AI 품질·검수'. typecheck+build 통과, 리뷰 pass(read-only/비용통제/갭인지 OK; styleConsistent=인라인 style이나 HEX 위반 아님·코드베이스 idiom 일치).
  - 알려진 경미 follow-up: 필터 변경 시 selected Set 미정리로 숨겨진 선택 행이 배치에서 조용히 누락(카운트-처리 불일치, UX 수준).
- 2026-06-09 **Phase B 1차 read-only 완료(F-B1.1·F-B2.1).** 다음=D-1 알림 채널 게이트: 루프 정지, 사용자 확인 대기.
- 2026-06-09 D-1 게이트: 사실확인=인앱전용·이메일 백엔드 없음. **사용자 결정=인앱+이메일 추상화 준비.** F-C1에서 채널 dispatch 추상화 구현(첫 소비자=독려). F-B2.2 활성화(F-C1 후), F-C4는 F-B2.1과 중복 확인. F-C1 착수.
- 2026-06-09 F-C2a: 신규 `HrQualityPage`(/hr/quality, 품질 그룹 '평가 품질 점검'). 주력=변별력(갭 표본SD·분산)×분포 건전성(하향변별부재·갭집중·평행이동 '정황' 중립칩) + 무결성 4종(빈평가·전원동일점수·가중치≠100·의견미작성) + 평가자 드릴다운(피평가자 성장레벨·점수·갭) + 재검토 요청(requestReturn 재사용). §2.1 5원칙 1:1 구현(판정아님·HR전용·인원구성 병기·소표본<5 회색/표본부족·중립색), 데모·완료율 caveat 상시. 종단·관대도 사분면 0건(grep). useCompanyDashboardRecords 1훅(무폭주). typecheck+build·리뷰 pass. low 2건 직접 수정: ①드릴다운 점수표시를 floored 정수+가중 병기(갭 계산기준 일치) ②가중치 무결성 epsilon(|합−100|>0.5, 부동소수 오탐 방지). 재검증 tsc+build EXIT 0.
  - info follow-up(비차단): 재검토 사유 입력이 window.prompt(추후 shadcn 다이얼로그 권장); 분포 임계값은 데모데이터 휴리스틱→F-C2b 종단 확보 후 캘리브레이션.
- 2026-06-09 F-C4: 신규 코드 없음 — #5(점수-의견 정서 정합성)는 F-B2.1 `reviewSentimentGap`이 이미 충족. 별도 탭 승격 보류(메뉴 비대화). 완료 처리.
- 2026-06-09 F-C3: 신규 `FeedbackDuplicateDetector`(HrPromptsPage 탭 '평가의견 중복 탐지', 제목 'AI 품질·검수'). 평가자 내부 의견 정규화 해시·자체 Levenshtein 휴리스틱 즉시(exact/near/borderline) + borderline만 AI 온디맨드(신규 gptOss `reviewFeedbackPairSimilarity` 래퍼·기존 프롬프트 재사용). 길이차 prefilter·trivial 다층 제외·발령정상 안내·중립 톤·read-only(requestReturn). typecheck+build·리뷰 pass(info/low만).
- 2026-06-09 F-C2b: `HrQualityPage`에 종단 보조 패널(전보 코호트·전년 드리프트·코호트-잔차·기질vs급변, 탭 4·기본 급변). 양 기간 일괄 로드 무폭주, priorPeriodId 없으면 자동숨김(2026 선택 시 2025 prior 표시). 발령=정상 준수(전보 코호트=중립·코호트 맥락, by-employee LIMIT1 한계 caveat). §2.1 5원칙·완료율 caveat. **F-C2a 데모 caveat 제거 동반**. typecheck+build·리뷰 pass(info만). → §2 평가 품질 점검 횡단+종단 완성.
- 2026-06-10 F-D2: 신규 `HrDepartmentResultsPage`(/hr/results, 결과 그룹) + `hrDataExport.downloadOrgResultWorkbook`. 조직 계층(법인-본부-부-팀) 단위 인원·완료율·달성률·갭 분포·평균갭 요약 + 엑셀 export(2시트), **PDF 없음(D-3)**. useCompanyDashboardRecords 1훅·갭 재사용·소표본 회색·read-only. impl이 TDZ 버그 자가수정. 리뷰 pass.
- 2026-06-10 **★루프 종료**: 활성 [ ] 항목 전부 소진. 보류 2건(F-B1.2 드래그 배정·F-D3 개인 PDF)은 사용자 결정으로 후속. 계획서 §1~§3 + §2 센터피스 + 데이터 재구성 + 정합성 버그 3건까지 완료.
- 2026-06-10 F-D1: 신규 `HrJobRoleBenchmarkPage`(/hr/job-role-benchmark, 현황·분석 그룹). 직종(job_role)별 갭버킷·달성률·평균갭·SD 비교 + 드릴다운. F-C2a 갭계산 재사용, useCompanyDashboardRecords 1훅(무폭주), read-only. 비평이 달성률을 record.achieved(미완료 오염)→samples gap≥0/n으로 정정. 소표본 직종 회색·중립톤·'(직종 미상)' 통합. dead import 정리. typecheck+build·리뷰 pass.
- 2026-06-10 D-2/D-3 게이트: **사용자 결정 = 직종(job_role) 단위만(직군 필드 미추가) / PDF 보류.** F-D1(벤치마크)·F-D2(부서리포트 화면+엑셀) 진행, F-D3(개인 PDF) 보류. F-D1 착수.
- 2026-06-10 F-C5: 신규 `HrNoticesFaqPage`(/hr/notices-faq, 운영 그룹) — 일괄 공지(F-C1 dispatch 재사용·수신자 확인·24h 중복가드·대량경고·자동발송 없음) + FAQ CRUD(settings `faq_catalog` JSONB 재사용, 신규 마이그레이션 0). dispatch DispatchPayload union에 'notice' 추가. 리뷰 pass, medium(NOTICE_HISTORY_LIMIT 500→서버캡 200) 수정 후 커밋. **Phase C 전부 완료. 다음=D-2/D-3 게이트(직군 필드/PDF).**
- 2026-06-10 **마감기간 평가자 종료일 표시 수정(사용자 검수)**: 마감/잠금 평가기간(2025)인데 마지막 평가자가 "~현재"로 표시됨(`buildEvaluatorPeriods`가 마지막 구간 end=null로 두는데, 이는 활성기간에서만 '현재'가 맞음). `buildEvaluatorPeriods`는 추이 그래프 공유라 안 건드리고 `MyTasksPage` 표시 단계에서 마감/잠금 기간이면 end=null을 `selectedPeriod.ends_on`으로 대체 → 권오선 2025 박판근 "2025.01.01~2025.12.31". typecheck+build 통과.
- 2026-06-10 **데이터 정합성 버그 수정(사용자 검수 발견)**: ① [데이터] 재구성이 전보 시 마스터(`employees.evaluator_id`=앱의 '현재 평가자')를 '이전(첫) 평가자'로 두고 다른 사람을 최신으로 만들어, 앱의 '현재 평가' 배지(마스터)와 날짜(이력 최신)가 모순(2026 142건). → 스크립트 전보 로직을 **"최신 2026 배정=마스터"** 불변식으로 수정(otherEv는 더 이른 시점), 재실행. 검증: 피평가자 최신배정≠마스터 0명, 권오선 박판근=현재(~현재). ② [앱] `MyTasksPage`가 기간 인자 없이 로드+기간 의존성 누락 → 활성기간(2026)만 로드돼 2025 선택 시 빈 목록. → 선택 기간 전달 + useEffect 의존성에 `selectedPeriod?.id` 추가. 2025 데이터 자체는 정합이었음(표시/로딩 문제). typecheck+build 통과.
- 2026-06-09 F-C2b-prep: 데이터 재구성 설계(조사·비평이 갭분포 산술모순 등 치명오류 5건 보정)→스크립트 작성·비평(needs-fix 보정: feedback_history 컬럼·0점 의견 NULL·.cjs)→DRY_RUN 2회 튜닝(score4 37%→26%, 갭 meet중심화, 가중치결함 3→22)→COMMIT 적용. 독립 DB 검증 통과(의견 다양화 확인). 메모리·MEMORY.md 갱신.
- 2026-06-09 F-C2 게이트: 센터피스 체크포인트. 사용자 결정=**점진(횡단+무결성 먼저)**. 종단 데이터 "확인 필요"→DB 직접 조회: **evaluation_periods 2개**(2025-annual closed 695완결 / 2026-annual active 754·730완료) → 종단 viable, §0 전제 맞음. F-C2를 F-C2a(횡단+무결성, 착수)·F-C2b(종단, F-C2a 후)로 분해. ⚠ **데이터 상당수 데모/합성(GEN25-/GEN26-)** — 분석 수치는 실데이터 채워지기 전까진 데모 기반(기능 로직은 무관). MEMORY.md 인덱스 줄 교정(1개뿐→2개).
- 2026-06-09 F-B2.2: AI 검수 모니터링 행에 HR '재검토 요청' 액션. 기존 `/return-request`(`requestReturn`) 재사용 — `origin:'hr'` 추가로 문구만 분기, 평가 상태/점수 무변경, 기존 피평가자 호출자 하위호환. HR 명시+코멘트+AlertDialog 확인, 자동발송 없음. 리뷰 needs-fix 2건 직접 수정: ①중복발송 가드(버튼 disabled+evaluationId 키잉) ②수신자 표시를 '현재 담당 평가자'로(발령 시 오해 제거, 화면 이름은 참고로 강등). 재검증 tsc+build EXIT 0.
  - 잔여(수용): 새로고침 후 재발송까지 막는 서버측 24h 가드는 미적용(HR 명시+확인+세션 내 disable로 충분). 통지는 dispatch가 아니라 atomic한 기존 return-request 엔드포인트 경유(더 안전, 의도적).
- 2026-06-09 F-C1: 신규 `src/lib/notifications/dispatch.ts`(채널 추상화: inApp 동작=createNotification / email=미설정 stub→skipped, 큐·리트라이 없음 린) + 신규 `RemindersPage`(/hr/reminders, 운영 그룹). 미완료 평가자 집계는 useCompanyDashboardRecords 1훅(per-evaluator 조회 0). 발송=AlertDialog 확인+24h 중복가드+Set dedup+대량>50 경고, 자동발송 없음, 부분실패 toast. notifications 재사용(신규 스키마 0), 'reminder' 유니온 1개 추가. 리뷰 pass. **raw HEX #B91C1C 3곳→var(--danger) 교정**(CLAUDE.md 준수), 교정 후 tsc EXIT 0.
