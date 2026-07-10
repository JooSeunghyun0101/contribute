# 기여도평가 시스템 — 반입(사내 운영 투입) 전 통합 체크리스트

**작성일** 2026-06-19 · **대상** `C:\Users\OK\dev\contribute` (Elevate Growth System v1.1.0)
**합친 출처** ① `docs/CODE_REVIEW_20260619.md`(이전 세션) ② 독립 재검증(Opus 4.8 — server.js 핵심 경로 1차 정독) ③ GPT-oss 내부망 이식 맥락
**위협 모델(최우선)** 인증된 내부 사용자가 **자기 점수·상태·피드백을 조작**하는 시나리오.

> 이 문서가 단일 source of truth다. 두 리뷰의 항목을 합치고, 내가 코드로 확인한 것/확인이 더 필요한 것/원문이 틀린 것/원문에 없던 것을 표기로 구분했다.

## 표기 범례
| 표기 | 의미 |
|---|---|
| ✅ | 이 세션에서 **코드로 직접 확인**(파일·라인 검증) |
| ⚠️ | **착수 시 재확인 필요**(원문 주장이나 본 세션 미검증, 또는 판단 필요) |
| ❌ | **원문 부정확 → 정정** |
| 🆕 | **신규 발견**(원문 `CODE_REVIEW_20260619.md`에 없음) |
| 🤖 | **GPT-oss 내부망 이식과 연관** — 전환 시점에 함께 처리 |

진행: `- [ ]` 미착수 / `- [x]` 완료. 라인 번호는 2026-06-19 기준 `server.js`(약 8,780줄).

---

## 진행 현황 — 2026-06-19 패치 세션

- **P0-A 보안 10건(P0-1~P0-10) + P0-13: 코드 수정 완료.** `node --check server.js` 문법 통과. 공통 적용: 신원을 `req.session.employeeId`에서 파생 + 기존 행 가드 부착 + 컬럼 화이트리스트. ⚠️ **런타임(실 DB) 검증 대기** — 반입 전 아래 시나리오 스모크 테스트 필수.
- **P1 전 항목(P1-1~P1-6) 코드 완료** — `typecheck`·`build` 통과. apiFetch 401·취소가드·AI 펜싱·CSRF(X-Requested-With)·취소 actor·자기평가 차단.
- **P3 일부 완료** — P3-1(죽은 컴포넌트 5개 삭제)·P3-3(evaluatorMappingService 삭제)·P3-9(쿠키 견고화). 모두 build/syntax 검증.
- **P0-11(워터마크)**: **보류 결정(2026-06-19)** — 반입 직전 재검토.
- **P0-12·P0-14·P0-15**: 운영 인프라에서 **사용자 수행**(.env `COOKIE_SECURE`/AI env 스왑·DB 마이그레이션 데이터 확인).
- **자동진행 세션(2026-06-19 저녁) 결과**: ① 죽은 발령경로 제거(`14877bc` — evaluator-edit 엔드포인트·editEvaluator·unscoped transfer·reconcile·unassign-cancel) ② **DB 인덱스 2건 추가·적용**(`idx_employees_evaluator_id`, `idx_evaluations_evaluatee_id` — 기존 인덱스 현황 확인 후 실제 누락분만; P2-6) ③ 발령버그 **DB 시뮬레이션 재현검증 통과**(entry 전부 취소해도 수정 rebuild가 점수 보존). ④ **작은 안전작업 5건**: 죽은 shadcn 11종+deps 제거(P3-4, `021e220`)·`max_tokens` 출력상한(P2-4)·AI 성장제안 시그니처 캐시(P2-5, `9bab11a`)·멱등 마이그레이션 러너(P2-7)·hrDataExport 죽은export 검증(P3-2 — 문서 오류 정정, 삭제대상 없음).
- **의도적 보류(감독 세션 필요)** — 아래는 **데이터계층/동작 변경**이라 런타임 테스트 없이 배포 브랜치에 자동 투입 시 회귀 위험이 커서, 자동진행에서 제외하고 계획만 남김:
  - **P2-1 React Query 전면이관**: queryKey 설계 + 읽기경로(서비스별 useQuery)부터 점진 이관 + mutation invalidation. 페이지 단위로 런타임 확인하며 진행해야 함.
  - **P2-2 N+1**: `useEvaluationDataDB`(과업당 피드백·과거평가 순차) → 평가단위 일괄 엔드포인트. 임포트 배치(`unnest`). 동작 검증 필수.
  - **P2-3 메모이제이션 / UI/UX**: `HrUsersPage` 리렌더·모달 a11y·스켈레톤 — 시각 확인 필요.
  - **잔여 P3**: Supabase 죽은분기·console·mojibake 로그 = 무해한 cosmetic(낮은 우선순위).

### 🗓️ 월요일 할 일 (잔여 — 우선순위 순)

> **2026-06-23 세션 마감 — 전부 완료·런타임 검증·origin 푸시(최신 `6a8aae7`)**: U-1 손수 모달→Radix(`26b8842`·`2097508`) · P2-3 그룹 카운트 O(n²) 제거(`dfba5cd`) · U-2 초기 스켈레톤+기간전환 목록유지(`777c0db`). 이후 같은 날 **U-3**(행→메모 UserRow 분해 `8092b10`·`1551fec`)·**F-1**(감사로그)·**F-2**(자동저장+이탈경고)·**F-6**(일괄결과 리포트 `6a8aae7`)까지 완료·푸시. **남은 코드작업 없음** — F-3(조기최적화 보류)·F-4(단일인스턴스 보류)·F-5(P0-12 이후)·P3-10(비추천)·`useEvaluationDataDB` 분해(고위험저효용)는 보류/대기. **다음 단계=회원님 사이드 배포 게이트(P0-11/12/14/15, 아래 "1) 회원님이 직접").** ⚠️ 런타임 확인거리: 세 모달 X·Esc·바깥클릭 닫힘 / 묶어서보기 그룹 인원수 / 첫 로드 스켈레톤·평가기간 전환 부드러움.

**1) 회원님이 직접 (코드로 못 함 — 반입 전 필수)**
- [x] 런타임 스모크 검증 **6단계 + 보너스 전부 통과**(2026-06-22, 별도 :5055 인스턴스로 디스크 코드 직접 검증 — 아래 "실행 결과" 표).
- [x] **발령 변경→원복 재현 (점수 유지) — 실데이터 라이브 E2E 통과**(2026-06-22). 직원20(9000022, 2025완료 9건 sum20 + 2026 12건 sum17, 전 엔트리 ah_id NULL=옛 광역매칭 트리거조건)에 `PUT /api/employee/:id`(평가자 직원169000006→직원229000023) → `evaluator-assignment-history/:id/cancel`(원복) 라이브 실행. 결과: 원본 21엔트리 **바이트 동일 보존**(2025 sum20·2026 sum17 그대로)·새 draft평가만 cancelled·employee.evaluator_id 9000006 복귀·X→X 0. 백업 `hr-db-backup-20260622_e2e-pre.dump` + 삽입행 정밀삭제로 footprint 사전상태 복원(employees.updated_at 1건만 cosmetic 잔여). 상세는 아래 "정적+스캔 재검증" 말미.
- [ ] **P0-12** AI env 스왑(GPT-oss): `.env` 의 `AI_BASE_URL`/`AI_MODEL`
- [ ] **P0-15** 운영 env: `COOKIE_SECURE=true`·`CORS_ORIGINS`·`ALLOW_MOCK_FALLBACK=false`·`VITE_ENABLE_DANGER_ZONE` 미설정
- [ ] **P0-14** `org_structure` 마이그레이션 데이터 확인 / **P0-11** 로그인 워터마크 최종결정
- [ ] (선택) 새 DB 이식 시 `node db_mig/run-migrations.cjs --baseline` 후 사용

**2) 감독 코드 작업 (제가 변경 → 회원님 런타임 확인 루프 권장)**
- [x] **P2-1**(부분이관: 컨텍스트4종+대시보드, `useEvaluationDataDB`는 고위험 저효용으로 보류) · [x] **P2-2 N+1**(`b0901cf`) · [x] **P2-3**(그룹 O(n²) 제거 `dfba5cd`; 행 React.memo는 U-3)
- [x] **U-1**(모달 Radix `26b8842`·`2097508`) · [x] **U-2**(스켈레톤·기간전환 유지 `777c0db`) · [x] **U-3**(HrUsersPage 행 → 메모 UserRow 추출 `8092b10`·`1551fec`; useEvaluationDataDB 분해는 별도 후속) · [x] **U-4**(정렬 `298b29a`) · [x] **U-5**(진행률 `5d11b40`) · [ ] **P3-10**(비추천 — sd-btn이 사실상 OK 디자인시스템)
- [x] **P2-8** = **현행 유지 결정(스킵)** — 초기비번=사번은 운영 배포방식과 함께 별도 판단

**3) cosmetic (여유 시)**
- [x] **P3-5** Supabase 죽은분기 `75aa572` · [x] **P3-6** Gemini 네이밍 `68b3d70` · [x] **P3-7** console/PII `6a02a77` · [~] **P3-8** = **비이슈**(`prompt_templates.description` DB 클린, server 주석 mojibake만 무해)

**4) 추가 기능 (별도 개발)**
- **F-1** 감사로그 ✅완료 · **F-2** 자동저장+이탈경고 ✅완료 · **F-6** 일괄결과 리포트 ✅완료 · **F-3** 서버 페이징 ⏸️보류(조기최적화) · **F-4** 세션 영속화 ⏸️보류(단일인스턴스) · **F-5** AI 검수 비동기 ⏸️P0-12 이후

### 런타임 검증 시나리오 (P0-A 패치 후 반드시)
1. 피평가자 계정으로 `PUT /api/task-evaluation-entry` 에 타인 evaluator_id+점수 전송 → **403/423 차단** 확인.
2. 평가자 계정으로 정상 채점 저장 → **정상 동작** 확인.
3. 피평가자가 `PUT /api/evaluation/:id` 로 `evaluation_status='completed'` 시도 → **403**, `'submitted'` 는 정상.
4. 평가자 계정으로 `GET /api/evaluator-feedbacks?evaluatorId=<타인>` → **본인 것만** 반환.
5. 일반 계정으로 `GET /api/evaluator-mappings` / `GET /api/change-requests` → **403 / 본인 관련만**.
6. 알림 생성 후 `employees` 테이블에 **가짜 행이 안 생기는지** 확인.

#### ✅ 실행 결과 (2026-06-22) — 전부 통과 (13/13)

**방법**: 현재 작업트리 코드(60afcb9)를 **별도 인스턴스(:5055)** 로 기동(원본 :5000 미신뢰 — 패치 이전 기동 가능성) → 실데이터 계정으로 API 직접 호출. 테스트 전 백업(`hr-db-backup-20260622_smoke-pre.dump`), 쓰기 시나리오는 **정밀 원복**(before-파일 기준 신규 알림 2건 삭제·평가상태·타임스탬프 복원) 후 사전 스냅샷과 **완전 일치 확인**(employees 773·notif 69·점수 무변조). 대상: 평가 `8993561c`, 피평가자 직원23(9000024)/평가자 직원22(9000023), 비교군 직원24(9000025), HR=admin.

| # | 시나리오 | 기대 | 실제 |
|---|---|---|---|
| 0 | 미인증 `GET /api/evaluator-mappings` (쿠키 없음) | 401 | **401** ✅ 전역 게이트 |
| 1 | 피평가자가 평가자 명의로 점수 위조 `PUT /api/task-evaluation-entry` | 차단 | **423** *"another evaluator owns entries"* ✅ (evaluator_id 세션 강제 → 본인 소유 엔트리 없음). DB: 9000024 엔트리 미생성·직원22 점수 4 불변 |
| 1b | 쓰기에 `X-Requested-With` 누락 | 403 | **403** ✅ CSRF 게이트 |
| 2 | 배정 평가자 정상 채점 (status=submitted 상태) | 200 | **200** evaluator_id=9000023/score=4 ✅ |
| 3a | 피평가자가 `evaluation_status='completed'` | 403 | **403** ✅ P0-7 |
| 3b | 피평가자가 `'submitted'` | 200 | **200** ✅ |
| 4 | 평가자가 `?evaluatorId=<타인>`로 피드백 조회 | 본인 것만 | **세션 강제**(타인=본인=4건 동일, 직원24 39건 유출 없음) ✅ P0-6 |
| 5a | 비-HR `GET /api/evaluator-mappings` | 403 | **403** ✅ P0-9 |
| 5b | 비-HR `GET /api/change-requests` | 본인 관련만 | **0건**(2건 모두 무관) ✅ P0-10 |
| 5c | HR `GET /api/change-requests` (대조) | 전체 | **2건** ✅ |
| 6 | 알림 sender_id 사칭(`9999999`) | 세션 강제·직원 미생성 | 저장 sender_id=**9000023**, employees **773 불변**·가짜 사번 0 ✅ P0-5 |
| 7 | 비소유자 `PATCH .../ai-review` | 403 | **403** ✅ P0-2 |

**발견(코드 정상, 문서 보강)**: 점수 쓰기는 `TASK_EVALUATION_EDITABLE_STATUSES={submitted,evaluating}` 일 때만 허용 — 평가가 `in-progress`면 **배정 평가자도** 피평가자 제출 전엔 채점 불가(워크플로 정상). 따라서 위 #1·#2는 평가를 먼저 `submitted`로 둔 뒤 신원검사 경로를 검증해야 의미 있음(최초 실행 시 in-progress라 워크플로 게이트에서 단락 → 'submitted' 재실행으로 신원검사 경로까지 통과 확인).

⚠️ **참고**: 실행 중이던 dev 서버(:5000, PID 53844, 2026-06-19 17:59 기동)는 패치 이전 코드일 수 있음 — 본 검증은 디스크 코드를 별도 인스턴스로 확인했으므로 반입 산출물 검증으로는 충분. dev 편의상 최신 코드 반영을 원하면 :5000 재기동 권장.

### 평가자 발령/원복 데이터 무결성 버그 (런타임 검증 중 발견·수정 — 2026-06-19)

직원25(9000026) 케이스: 김철수 완료 → 홍길동 변경 → 변경 취소(원복) 후 **완료 점수 소실 + 이력 "김철수→김철수"**. 실 DB 추적으로 3개 버그 확정·수정.

- [x] **BUG-AH1** ✅ [로직·데이터] **스냅샷 재계산이 점수를 NULL로 덮어씀** — `rebuildTaskEvaluationSnapshot` (server.js:684). `entry_counts`가 취소 entry까지 세어 `total_count>0`인데 `latest`(활성)는 비어 → `score=NULL`. **수정**: `entry_counts`를 활성 entry만 카운트.
- [x] **BUG-AH2** ✅ [로직·데이터] **변경 취소가 타 기간 점수까지 취소** — cancel "일반 취소"(server.js:5120~)의 `assignment_history_id IS NULL` 광역 매칭이 같은 직원의 2025 entry까지 취소. **수정**: 해당 이력행/그 평가(`evaluation_id`)로 한정. 피드백 취소도 `ev.id` 스코프 추가.
- [x] **BUG-AH3** ✅ [로직·표시] **이전평가자 체인이 연도 경계를 넘음** — `reconcilePreviousEvaluatorIds` (server.js:1414)가 전 연도를 시간순 단일 체인으로 묶어 새 연도 첫 배정 prev를 전년 평가자로 채움(→ "X→X"). **수정**: `PARTITION BY evaluation_period_id`.
- **전수점검**: 피해 = **직원25 1명**(과업 9·이력 1행). 다른 직원 영향 0. 원본 점수는 취소 entry에 보존돼 있었음.
- **복구**: 백업(`hr-db-backup-20260619_1727_pre-recovery.dump`) 후 트랜잭션으로 ① X→X 이력 prev=NULL ② 잘못 취소된 9개 entry 김철수 명의로 교정·되살림 ③ 스냅샷 재계산. 검증 완료(2025 7/7·2026 2/2 점수 복원).
- ✅ **발령 생명주기 전수점검 완료(2026-06-19)**:
  - **[수정]** cancel 역이전(server.js:5120)을 `transferEvaluatorEntriesForCorrection`(비스코프) → `…Scoped`로 교체. 정방향 정정은 이미 Scoped라 역방향도 일치(타 기간 entry 이동 차단).
  - **[죽은 코드]** `cancelActiveEvaluationsForUnassignedEmployee`(774): 호출처 0. 기간 스코프 없이 전 평가 취소하는 잠재 cross-period 버그 → 살릴 경우 기간 스코프 필수, 아니면 제거 권장.
  - **[죽은 경로]** `evaluator-edit`(4863)/`editEvaluator` 서비스(581): UI 호출처 0(확인). 비스코프 transfer라 살릴 경우 cross-period 위험 → 제거 또는 활성기간 스코프 권장.
  - **✅ LIVE 경로는 안전**: 현재 평가자 변경은 `PUT /api/employee/:id`(기간별 draft+이력 생성, entry transfer 안 함)·cancel(수정됨)·correct(Scoped) → cross-period 결함 없음.
  - **DB 전수 스캔**: 점수 소실/타기간 취소 피해 = **직원25 1명뿐(복구 완료)**. completed-but-cancelled 2건 모두 직원25 2026 테스트 잔여(cancelled라 비표시).
- **재발 방지 검증(권장)**: 다른 피평가자로 김철수→홍길동→원복 재현 시 점수 유지 확인.

#### ✅ 정적+스캔 재검증 (2026-06-22) — AH1/AH2/AH3 수정 실재 + 데이터 무증상

3개 수정이 현재 커밋 코드에 **실재**함을 함수 본문으로 확인하고, 현재 실데이터에 **버그 증상이 없음**을 read-only 스캔으로 확인.

| 버그 | 코드 정적확인 (현재 라인) | 데이터 스캔 결과 |
|---|---|---|
| **AH1** 스냅샷이 점수 NULL로 덮어씀 | `rebuildTaskEvaluationSnapshot` server.js:699–701 — `entry_counts` 가 `WHERE COALESCE(status,'active')='active'` 로 **활성만 카운트** → 전부 취소 시 total_count=0 → `ELSE t.score` 점수 보존 | 활성 채점 엔트리 있는데 `tasks.score IS NULL` 인 과업 **0건** |
| **AH2** 변경취소가 타 기간 점수까지 취소 | `transferEvaluatorEntriesForCorrectionScoped` server.js:1088 — 대상 엔트리를 `WHERE evaluation_id=$1` 로 **평가 단위 스코프**(전역 `assignment_history_id IS NULL` 광역매칭 제거) | cancelled 엔트리 전체 **2건뿐, 둘 다 직원25(9000026) 2026 알려진 잔여**(score 4·3). 타 기간 취소 피해 0 |
| **AH3** 이전평가자 체인 연도 경계 침범(X→X) | `reconcilePreviousEvaluatorIds` server.js:1211·1227 — `ROW_NUMBER() OVER (PARTITION BY evaluation_period_id …)` + prev 조인도 동일 기간 한정 | applied non-cancel 중 `prev=new`(X→X) **0건**, 기간 첫 배정에 비정상 prev **0건** |

**판정**: 수정 코드 정상·데이터 클린.

#### ✅ 라이브 HTTP 변경→원복 E2E (2026-06-22) — 점수 보존 실증

실데이터 대상 **직원20(9000022)** — 변경 전 상태: 평가자 직원16(9000006), 2025평가(completed, 9엔트리 합20)·2026평가(in-progress, 12엔트리 합17), **21엔트리 전부 `assignment_history_id` NULL**(옛 BUG-AH2 광역매칭이 잡던 cross-period 조건). 별도 :5055 인스턴스에 HR(admin)로 라이브 호출:

1. `PUT /api/employee/9000022` `{evaluator_id:'9000023', evaluation_period_id:'<2026>'}` → **200**, employee.evaluator_id=9000023, 새 'change' 이력 + **새 2026 draft 평가** 생성(기존 평가는 불변).
2. `POST /api/evaluator-assignment-history/<H>/cancel` → **200**, employee.evaluator_id **9000006 복귀**, 새 draft 평가 `record_status=cancelled`.

**검증(DB 대조)**: 원본 21엔트리 **before↔after 바이트 동일**(status/score/evaluator/ah_id/updated_at) — 2025 합20·2026 합17 그대로. 전역 재스캔 AH1=0·AH3(X→X)=0 유지. 즉 **AH2**(cross-period 미취소)·**AH1**(스냅샷 점수 NULL 미발생)·**AH3**(체인 무오염) 모두 라이브 경로에서 확증. 정리: 백업(`hr-db-backup-20260622_e2e-pre.dump`) 후 삽입된 draft평가·이력행만 정밀삭제 → footprint 사전상태 일치 확인(employees.updated_at 타임스탬프 1건만 cosmetic 잔여).

---

## P0 — 반입 차단 (운영 데이터 투입 전 반드시)

### P0-A. 신원·인가 우회 — 인증 사용자가 평가 결과를 조작 (근본원인·조치 동일)

> **근본원인 하나:** 전역 게이트(server.js:2696)는 "로그인했는가"만 보장하고, 아래 핸들러들은 **"누구인가"를 `req.body`에서 신뢰**한다. 가드(`guardTaskParam('task_uuid','body')`·`guardEvaluationParam`)와 `req.session.employeeId`는 **이미 존재**(2696·2747·2810)하는데 정작 민감 라우트가 안 쓴다.
>
> **공통 조치(전 항목 동일):** ① 평가자/행위자 신원은 **항상 `req.session.employeeId`에서 파생**(본문 신뢰 금지) ② 이미 있는 행 가드 부착 ③ 동적 INSERT/UPDATE는 **수정 가능 컬럼 화이트리스트**(`EMPLOYEE_UPDATE_FIELDS` 패턴 재사용) ④ 가드가 **피평가자 본인을 통과**시키는 쓰기 라우트는 역할(평가자/HR)까지 추가 검사.

- [x] **P0-1** ✅ [보안·로직] **점수 위조** — `PUT /api/task-evaluation-entry` (server.js:7814)
  - 세션 미참조. 채점자 신원을 `payload.evaluator_id`(본문)에서 취득. `assertTaskEvaluationEntryEditable`(2201)는 "본문이 주장한 평가자"가 배정자인지만 검사 → **피평가자가 자기 평가자 사번을 넣어 자신에게 만점을 그 평가자 명의로 기록 가능.** 시스템 신뢰성의 근본 붕괴.
  - 조치: `evaluator_id`/`evaluator_name`을 세션에서 파생 + `guardTaskParam('task_uuid','body')` 부착.
- [x] **P0-2** ✅ [보안] **AI검수 결과 임의 변조** — `PATCH /api/task-evaluation-entry/:id/ai-review` (7900)
  - 인가/소유 검사 없이 `WHERE id=$1` UPDATE → 플래그된 평가자가 자기 플래그를 조용히 해제.
  - 조치: 엔트리-세션 사용자 연결 가드.
- [x] **P0-3** ✅ [보안] **과업 임의 수정/삭제** — `PUT·PATCH·DELETE /api/task/:id` (8066·8123·8144)
  - 행 가드 없음. `PUT`은 `Object.entries(req.body)`로 동적 SET(8082, 화이트리스트 없음) → 누구나 임의 과업의 점수·가중치·피드백 수정 또는 삭제(또 다른 점수 위조 경로).
  - 조치: `guardTaskParam('id')` + 컬럼 화이트리스트.
- [x] **P0-4** ✅ [보안] **임의 평가 생성 + 식별자 인젝션** — `POST /api/evaluation` (7203)
  - `requireHr`·가드 없음. `cols=Object.keys(req.body)`를 SQL에 **직접 보간**(7257) → 임의 `evaluatee_id`로 평가 생성(mass-assignment) **🆕 + 컬럼명 식별자 인젝션 위험**(파라미터 바인딩은 VALUES만 보호, 식별자는 무방비).
  - 조치: HR 전용 또는 본인 한정 + 컬럼 화이트리스트(키 보간 제거).
- [x] **P0-5** ✅ [보안] **알림 발신자 사칭 + 직원 디렉터리 오염** — `POST /api/notification` (8412)
  - 인가 없음. `sender_id`/`recipient_id` 본문 신뢰 + 미존재 사번이면 `INSERT INTO employees(...,'HR')` **자동 생성**(8443-8461).
  - **정정/보강:** 자동생성 직원은 `available_roles` 미설정이라 **자동 HR 승격은 아님**(직접 확인). 그래도 사칭·오염은 실재.
  - 조치: `sender_id`는 세션 강제, **직원 자동생성 로직 완전 삭제**, 컬럼 화이트리스트.
- [x] **P0-6** ✅ [보안] **평가자 간 피드백 유출** — `GET /api/evaluator-feedbacks` (7926)
  - 쿼리의 `evaluatorId`를 그대로 신뢰(스코프 없음) → 임의 평가자가 타 피평가자에게 쓴 자유서술 피드백 최대 100건 수집(PII).
  - 조치: 비-HR은 `evaluatorId = req.session.employeeId` 강제.
- [x] **P0-7** ✅🔺[보안·로직] **피평가자가 자기 평가 상태·성장레벨 변경** — `PUT /api/evaluation/:id` (7271)
  - `guardEvaluationParam('id')`는 있으나 **가드가 피평가자 본인을 통과**시킴 + `Object.keys(req.body)` 동적 SET(7296, 화이트리스트 없음) → **피평가자가 자기 평가의 `evaluation_status='completed'`·`growth_level`을 직접 변경 가능.** *(원문 P2 → P0 격상)*
  - 조치: 컬럼 화이트리스트 + `evaluation_status`/`growth_level` 등은 평가자/HR만, 서버측 상태전이 검증.
- [x] **P0-8** ✅🔺[보안] **피평가자가 자기 완료 평가 재오픈** — `POST /api/evaluation/:id/reopen-for-evaluator` (7505)
  - 가드가 피평가자를 통과 → 피평가자가 자기 'completed' 평가를 'evaluating'으로 되돌려 P0-1/P0-7과 결합해 점수 변경 가능. *(원문 P2 → P0 격상)*
  - 조치: 평가자(해당 평가 owner)/HR 한정.
- [x] **P0-9** ✅🔺[보안] **전사 평가자-피평가자 그래프 노출** — `GET /api/evaluator-mappings` (6212)
  - `requireHr` 없음 → 아무 사용자나 전 직원 평가자-피평가자 매핑(이름·부서) 조회. (같은 라우트 `POST`는 6237에 `requireHr` 있음.) *(원문 P2 → P0 격상)*
  - 조치: `requireHr` 부착 또는 스코프.
- [x] **P0-10** ⚠️ [보안] **변경요청 스코프·감사 위조** — `GET/POST /api/change-requests` (6459·6505)
  - 원문 P1 주장: GET이 전 직원 변경요청(피평가자명·사유)을 누구에게나 반환, POST는 `requested_by`를 본문 신뢰. **본 세션 미검증** → 착수 시 6459·6505 확인 후 GET 스코프 제한 + `requested_by` 세션 파생.

### P0-B. 배포 절차·설정·자산 게이트 (코드 외)

- [ ] **P0-11** 🆕🤖 [보안·컴플라이언스] **로그인 WebGL 라이선스 위반** — `src/components/ui/hero-v4.tsx:68`
  - UnicornStudio **무료플랜 워터마크를 제거한 로컬 씬(`/unicorn/tulip.json`)** 사용 + 코드에 "배포 전 반드시 유료 전환 후 projectId로 복귀" 경고. 금융사 운영 빌드에 워터마크 제거 자산 = 법무 리스크. **+ 내부망(인터넷 차단)에선 UnicornStudio 런타임이 로드 안 될 수 있어** 어차피 검은 배경 폴백.
  - 조치(택1): 유료 전환 후 `projectId` 복귀 / **배경을 정적 OK 브랜드 그라데이션으로 교체**(내부망 권장, `unicornstudio-react` 의존 제거).
  - **결정(2026-06-19): 보류** — 현 상태 유지(리스크 인지), 반입 직전 재결정. ⚠️ 반입 빌드 전 반드시 재검토.
- [ ] **P0-12** 🤖 [운영] **AI 프록시 env 스왑 (GitHub Models → GPT-oss)** — `.env`
  - 현재(테스트): GitHub Models 외부 API(`.env.example:19-21` 경고 — 실데이터 검수 금지, 테스트/샘플만). 반입 후: **아래 2줄만** 설정, `AI_API_KEY` 불필요.
    `AI_BASE_URL=http://172.17.170.201:8000/v1` · `AI_MODEL=gpt-oss-120b`
  - 효과: AI 입력이 **사내망을 벗어나지 않음** → 실데이터 검수 가능해짐(아래 'AI 내부망' 섹션 참조). env 교체만으로 코드 수정 불필요.
- [x] **P0-13** ✅🤖 [불필요·보안] **죽은 `VITE_*` AI 키 제거** — `.env.example:11-12`, `AI_SETUP.md`
  - `VITE_OPENAI_API_KEY`/`VITE_GEMINI_API_KEY`는 소스 미사용인데 `VITE_` 접두라 **채우면 클라이언트 번들에 키 노출**. AI는 서버 프록시 전용이므로 두 줄 삭제. (GPT-oss 전환과 무관하게 정리)
- [ ] **P0-14** ✅ [데이터] **`org_structure` 파괴적 마이그레이션 확인** — `db_mig/add_org_structure_period.sql:8`
  - `DROP TABLE IF EXISTS org_structure;` 후 다른 PK로 재생성 → 운영 적재분이 있으면 소실(주석으로만 경고). 적용 전 데이터 백업·재적재 경로 확인.
- [ ] **P0-15** ⚠️ [보안·운영] **운영 env 게이트 확인** — `.env`
  - `COOKIE_SECURE=true`(TLS 종단 뒤) · `CORS_ORIGINS=`(운영 오리진 명시) · `ALLOW_MOCK_FALLBACK=false`(fail-fast) · `VITE_ENABLE_DANGER_ZONE` 미설정(DB 일괄삭제 UI 숨김). **DB 일괄삭제 reset 엔드포인트의 서버측 가드도 확인**(클라 숨김만으론 부족).

---

## P1 — 반입 직후 즉시

- [x] **P1-1** ✅ [로직·UI/UX] **`apiFetch` 401·상태코드 미처리** — `src/lib/api.ts:12`
  - 모든 비-2xx를 영어 raw 문자열로 throw → 세션 만료가 재로그인으로 안 이어지고, `errorHandler`는 status를 못 읽어 전부 UNKNOWN. **인메모리 세션이라 서버 재시작 = 전원 세션 소멸**인데 그때 깨진 토스트만 보임.
  - 조치: 401 감지 시 로그아웃/리다이렉트, throw 에러에 `.status` 부착.
- [x] **P1-2** ✅ [로직] **`useEvaluationDataDB.loadEvaluationData` 취소 가드 없음** — `src/hooks/useEvaluationDataDB.ts:233`
  - ~360줄 비동기에 취소 토큰/AbortController 없음 → 기간·사번이 로딩 중 바뀌면 이전 요청이 stale 데이터로 덮어씀(다른 비동기는 다 이 패턴 씀).
- [x] **P1-3** ✅🤖 [보안·로직] **AI 검수 게이트 견고화** — `src/lib/gptOss.ts`
  - (a) **프롬프트 인젝션**: 사용자 원문(피드백·과업명)을 단일 `role:'user'` 프롬프트에 직접 연결(728) → "위 지시 무시" 류로 검수 우회. → 사용자 콘텐츠를 별도 메시지로 분리·펜싱.
  - (b) **실패 시 문자열 반환**: `callGptOss`가 catch에서 경고 문자열을 정상값처럼 `return`(345) → 편집필드에 AI 출력인 양 기록 + 검수가 조용히 skip(fail-open, 737/741). → 실패 시 예외 throw, 검수 결과 JSON 스키마 검증.
  - (c) 🆕 **내부 모순**: 주석(300)은 "throw를 래퍼가 catch"라는데 catch(342)가 그 throw를 삼킴 → `testGeminiConnection`(654)의 try/catch가 죽은 분기(연결 테스트가 망 단절에도 success=true). GPT-oss 전환 후 헬스체크 신뢰 위해 수정.
  - 🤖 모델이 GPT-oss(내부)로 바뀌어도 (a)(b)(c)는 **그대로 유효**(평가 무결성 문제이지 모델 위치 문제 아님).
- [x] **P1-4** ⚠️ [보안] **CSRF** — 상태변경 라우트 전체
  - 쿠키 인증 + credentialed CORS인데 CSRF 토큰/커스텀 헤더 검사 없음. → 게이트 미들웨어에서 `X-Requested-With` 또는 토큰 검사(SameSite=Lax 기반 위에 보강).
- [x] **P1-5** ⚠️ [보안] **`change-requests/:id/cancel` actor 옵셔널** — `server.js:6792` — `actor_id` 생략 시 임의 취소 가능 여부 확인, 세션 신원 강제.
- [x] **P1-6** ⚠️ [로직] **자기평가 차단 불일치** — `PUT /api/employee/:id` (4665) — 다른 라우트는 evaluator==evaluatee를 막는데 여기선 자기 자신을 평가자로 지정 가능한지 확인 후 동일 검증.

---

## P2 — 안정화 (비효율·성능·스키마)

- [x] **P2-1** ✅ [비효율·부분완료] **React Query 부분 이관**(설치만→컨텍스트4종+대시보드 useQuery; `useEvaluationDataDB`는 고위험 저효용 보류) — 원문: **설치만·사용 0건** — `App.tsx:51`. 전부 수동 `useState+useEffect` → 중복 fetch·캐시 없음·매 마운트 재조회. **읽기 경로 이관이 단일 최대 개선**(수동 취소·중복로딩 동시 해소).
- [x] **P2-2** ✅ [비효율] **N+1**(`b0901cf` 피드백 벌크 엔드포인트) — `useEvaluationDataDB`(425·572 과업당 피드백/과거평가 순차), 임포트(server.js:3493·4200대 행당 INSERT/조회). → 평가단위 일괄 엔드포인트 + `unnest`/`WHERE ... = ANY($1)` 배치.
- [x] **P2-3** ✅ [비효율] **메모이제이션**(파생데이터·페이지네이션 이미 메모, 그룹 헤더/카운트 렌더 중 O(n²)→`pageGroupRows` useMemo `dfba5cd`; 행 단위 React.memo는 U-3) — 원문: **0건** — `components/`에 `React.memo` 없음. `HrUsersPage`는 검색 한 글자마다 전 행 리렌더(행마다 인라인 style 재생성, 그룹카운트 렌더 내부 O(n²) 추정 1657). → `useMemo`/`React.memo`.
- [x] **P2-4** ✅🤖 [비효율] **`max_tokens` 지정 완료** — `callGptOss` 본문에 `max_tokens`(보고서 2048·그 외 768) 추가. 서버 프록시는 이미 전달(server.js:2154·2170). 런어웨이/지연 방지.
- [x] **P2-5** ✅ [비효율] **AI 성장제안 시그니처 캐시 적용** — `EvaluationAccordionCard` 효과에 과업 시그니처(점수·방식·범위·피드백·레벨) 캐시 + 수동 재생성 시 우회. 같은 과업 재선택 시 LLM 재호출 안 함.
- [x] **P2-6** ✅ [스키마] **핵심 조회 컬럼 인덱스 추가 완료** — `idx_employees_evaluator_id`, `idx_evaluations_evaluatee_id` (기존 인덱스 현황 확인 후 실제 누락분만; `db_mig/add_eval_lookup_indexes.sql` 적용·검증). 나머지 조회키는 이미 인덱싱돼 있었음.
- [x] **P2-7** ✅ [운영] **멱등 마이그레이션 러너 추가** — `db_mig/run-migrations.cjs`(schema_migrations 추적·`--baseline`·DROP TABLE 거부). 파일만 생성(미실행). **기존 DB는 `--baseline` 최초 1회** 후 사용.
- [x] **P2-8** ✅ [보안·결정] **현행 유지(스킵)** — 로그인 정책 약함 — 초기 비밀번호=사번(추측 가능), 정책이 8자/사번불가뿐. + 로그인 레이트리밋 적용 여부 재확인(`express-rate-limit` 설치는 확인).

---

## P3 — 정리 (불필요·중복·위생)

- [x] **P3-1** ✅ [불필요] **죽은 컴포넌트 트리** — 삭제 완료(EvaluationContent·TaskCard·AIFeedbackChat·ScoreDisplay·ScoringChart). 도달성: TaskCard 는 EvaluationContent 만, 나머지는 TaskCard 만 사용 확인 후 삭제 + build 검증. — `EvaluationContent.tsx`를 **어떤 컴포넌트도 import 안 함**(확인) → 이게 유일 사용처이던 `TaskCard.tsx`(505)·`AIFeedbackChat.tsx`(323)도 도달 불가 추정. 삭제 전 `TaskCard`/`AIFeedbackChat`의 다른 import처만 재확인.
- [x] **P3-2** ✅❌ [정정·검증완료] **원문 "죽은 export" 주장 틀림 확인** — `create*`/`buildExportFileName`은 죽은 게 아니라 **내부 전용 헬퍼**(파일 내부에서만 사용, 페이지 import 0). `download*` 공개 API는 페이지에서 사용 중. **삭제할 진짜 죽은 export 없음.** (내부 헬퍼 de-export 는 저가치라 보류)
- [x] **P3-3** ✅ [불필요] **`evaluatorMappingService.ts` 삭제 완료** — import처 0 + `credentials` 없는 bare `fetch` + `|| 'http://localhost:5000'` 폴백(운영서 브라우저가 localhost 호출). 죽은 코드라 삭제가 정답.
- [x] **P3-4** ✅🆕 [불필요] **죽은 shadcn 컴포넌트·의존성 제거 완료**(`021e220`) — `carousel·drawer·command·input-otp·resizable` 등 미import 컴포넌트 + deps(`embla-carousel-react·vaul·cmdk·input-otp·react-resizable-panels` 등) 제거(번들·공급망 축소).
- [x] **P3-5** ✅ [불필요] **Supabase 잔재**(`75aa572`) — `src/utils/errorHandler.ts`의 `PGRST116/301/302/303`·`handleSupabaseError`(66-167) 죽은 분기. 스택은 Express+pg. 정리.
- [x] **P3-6** ✅🤖 [불필요] **Gemini 네이밍 잔재**(`68b3d70` 죽은 함수 제거) — `gptOss.ts:647` `checkGeminiKey()`는 항상 `return true`. `testGeminiConnection` 등 Gemini/OpenAI 네이밍을 GPT-oss로 통일(P1-3 (c)와 함께).
- [x] **P3-7** ✅❌ [위생] **`console.*` 프로덕션 출력**(`6a02a77` PII payload 로그 제거) — **정정: `server.js`만 116개**(원문 "72건"은 과소, src 기준인 듯). 일부 PII payload 로그(`feedbackService.ts:87`). → 제거/게이트.
- [x] **P3-8** ✅❌ [위생·비이슈] **깨진 인코딩(mojibake)** — 재확인: `prompt_templates.description` DB 저장분은 **클린**, server.js 주석·로그 mojibake만 남아 무해(런타임 영향 0). 별도 수정 불필요.
- [x] **P3-9** ✅ [위생] `parseCookies` try/catch(malformed 쿠키 500 방지) + `clearSessionCookie` Secure 일관성 적용 완료. (`node --check` 통과)
- [ ] **P3-10** ⚠️ [UI/UX·비추천] **이중 디자인 시스템** — 페이지는 `sd-btn` 인라인 style, ui/ 프리미티브는 shadcn. 죽은 트리(shadcn Button)는 P3-1로 이미 삭제됨. **현 분리는 의도적 구조**(sd-btn=OK 브랜드 버튼, shadcn=복합 프리미티브). 전면 단일화는 대규모 시각 변경·회귀 위험이라 **배포 후 별도 판단 권장**.

---

## UI/UX

- [x] **U-1** ✅ **손수 모달 a11y** — HrUsersPage 중앙모달 3종(기여도 미리보기·조직정보 업로드·업로드 이력) → Radix `ui/dialog` 전환(focus-trap·Esc·role·aria·X) `26b8842`. 인사이트 우측 드로어는 role/aria-modal/aria-label 시맨틱 추가 `2097508`. (EvaluatorHistoryModal=이미 role/aria, 드로어 focus-trap/Esc 풀전환은 후속)
- [x] **U-2** ✅ **로딩 스켈레톤**(부분) — 사용자관리 초기 로드 스켈레톤(10행)+기간전환 시 목록 유지(`isInitialLoading`=query.isLoading)+"갱신 중…" `777c0db`. (대시보드/인사이트 테이블·낙관적 UI 확산은 후속)
- [x] **U-3** ✅ **거대 컴포넌트 분해(핵심 완료)** — `HrUsersPage` 행을 `React.memo` 컴포넌트 `UserRow`+`GroupHeaderRow`(`src/pages/hr/UserRow.tsx`)로 추출, 공유 헬퍼 `_hrUsersHelpers.ts` 분리. 메모 경계: `isSelected` boolean(Set 금지)·`editForm` 편집행만·행 핸들러 9종 rowHandlersRef(useEvent식)+`useCallback([])` 안정화. 검색 타이핑/선택/타행 편집 시 전 행 리렌더+인라인 style 재생성 제거(P2-3 잔여 해결). 적대적 리뷰 3렌즈 결함 0·런타임 검증·푸시(`8092b10`·`1551fec`). **잔여(선택): `useEvaluationDataDB`(1,348줄) 분해 — 고위험 저효용, 별도 후속.**
- [x] **U-4** ✅ **HrUsers 테이블 정렬**(사번/이름/레벨/상태 헤더 정렬) `298b29a`.
- [x] **U-5** ✅ **일괄 삭제/평가자변경 진행률** — 단일 boolean → `i/N` 진행률 `5d11b40`.

---

## 있으면 좋을 기능 (추가 개발)

- [x] **F-1** [보안·운영] **감사 로그(audit trail)** — **백엔드 배선 완료·런타임 검증(2026-06-23, 푸시됨 커밋 `c803fee`·`b4fa948`·`f48efa5`·`6611211`·`c2ed31a`)**. 기존 `admin_audit_logs` 테이블 + `insertAdminAuditLog` 헬퍼 재사용 → **스키마 변경 0**. 발견 시 이미 14곳(임포트·evaluator_correct·비번초기화·벌크평가자·변경요청·평가기간 CRUD) 배선돼 있었고 **7000번대 채점/상태 라우트가 사각**이었음. 신규 action_type(전부 actor=세션·target=피평가자·실제 변경 시에만 old→new): `evaluation_score_change`(점수 entry) · `evaluation_update`/`evaluation_reopen` · `task_update`/`task_soft_delete`/`task_delete` · `ai_review_change`(플래그 flip만=P0-2) · `evaluator_change`/`employee_update`. **조회 API 완료**(GET /api/audit-logs, HR전용·필터(target/actor/actionType/from/to)·페이지네이션 + `idx_admin_audit_logs_created_at`, 푸시됨 `b6557d3`; 적대적 리뷰 4렌즈=보안/authz/인젝션 0·low 3 수정, 라이브 SQL 검증). **완료(end-to-end)**: 뷰어 `/hr/audit-logs`(HR전용 필터+페이지네이션+old→new diff, `f38a096`, 적대적 UI리뷰 통과·TZ 1건 수정) + **취소/되돌리기 경로 감사**(`evaluator_assignment_cancel`, `d6c5cee`) + **되돌리기 self-heal 하드닝**(엉킨 이력에도 마스터 평가자=최신 applied 재동기화, `edd1f1f`). 런타임 검증 완료. cancelled 이력행은 **삭제 안 함**(변경 이력=감사 자산으로 보존, [[multi-evaluation-means-transfer]] 경계).
- [x] **F-2** [편의] **자동저장 + 이탈 경고(`beforeunload`)** — 과업 편집 유실 방지. **완료·푸시됨(`687d2be`·`5ce281b`)**: ① 평가자 에디터(Evaluation.tsx, `useEvaluationDataDB`) taskDrafts 800ms 디바운스 localStorage 자동저장+복원+이탈경고+종료/언마운트 플러시(`!readOnly` 게이트). ② 과업 카드(EvaluationAccordionCard) 자체 로컬 drafts → 재사용 훅 `useLocalDraftPersistence`(자동저장/복원, `ready` 게이트로 로드중-삭제 레이스 차단) + `useUnsavedChangesWarning`(이탈경고). 적대적 리뷰 워크플로 3회(자동저장 레이스·카드 미커버·복원 가드 엣지 수정), 런타임 검증. 읽기전용 페이지 제외.
- [ ] **F-3** [확장·보류] **서버사이드 검색·정렬·페이지네이션** — 현재 HrUsers는 클라이언트 필터. **보류 결정(2026-06-23)**: 771명 규모에선 조기최적화 + 고위험(evaluatorOptions·묶어서보기 그룹핑·교차페이지 전체선택 재설계 필요). 전사 수천명 규모로 커질 때 착수.
- [ ] **F-4** [운영·보류] **세션 영속화(Redis/DB)** — 인메모리라 재시작 시 전원 재로그인·수평확장 불가. **단일 인스턴스 전제면 보류.**
- [ ] **F-5** 🤖 [성능·대기] **AI 검수 비동기화** — 저장 시 최대 15초 블로킹 → 저장 즉시 완료 + 사후 검수. **P0-12 GPT-oss 전환 이후 착수**(자체호스팅 지연 클 때 특히 유효).
- [x] **F-6** [편의] **일괄작업 결과 리포트 — 완료·푸시(`6a8aae7`)** — 일괄 삭제/평가자변경의 실패 항목을 {사번·이름·사유}로 수집, 부분 실패 시 결과 모달(전체/성공/동일/실패 요약 + 실패 목록). 성공만이면 토스트로 끝.

---

## 🤖 AI 내부망(GPT-oss) 이식 — 통합 메모

현재 GitHub Models(외부, 테스트용) → 반입 후 GPT-oss(`http://172.17.170.201:8000/v1`, `gpt-oss-120b`, 키 불필요). **코드 수정 없이 env 교체만**으로 전환되도록 이미 설계됨(`.env.example:22-24`).

| 항목 | 전환 시 변화 | 조치 위치 |
|---|---|---|
| **PII** | 외부 전송 경고 해제 — 입력이 사내망을 안 벗어남 → **실데이터 검수 가능해짐**(현재는 테스트/샘플만 권장) | P0-12 |
| **프롬프트 인젝션·fail-open** | **변화 없음** — 평가 무결성 문제라 모델 위치와 무관, 반드시 수정 | P1-3 |
| **SSRF** | ⚠️ `/api/ai/chat`가 `AI_BASE_URL`(env 고정 내부호스트)로만 요청하고 **사용자 입력으로 대상 URL이 바뀌지 않는지** 확인(내부망에선 표적이 내부 서비스라 더 민감) | 착수 시 핸들러 확인 |
| **max_tokens** | 토큰 과금은 사라지나 **GPU 점유·지연·런어웨이** 방지로 여전히 지정 권장 | P2-4 |
| **네이밍·죽은 키** | `checkGeminiKey`/`testGeminiConnection`/`VITE_*` 키 등 Gemini·OpenAI 잔재를 GPT-oss로 정리 | P0-13, P3-6, P1-3(c) |
| **503 처리** | `AI_BASE_URL` 비면 503 — 전환 시 env 채우면 해소 | P0-12 |
| **응답지연** | 자체호스팅 모델은 지연이 클 수 있음 → 저장 블로킹 검수를 비동기화 | F-5 |

---

## 원문(`CODE_REVIEW_20260619.md`) 대비 변경 요약

- **격상(P2→P0):** P0-7(evaluation PUT mass-assignment+피평가자 status/growth_level), P0-8(reopen 자기재오픈), P0-9(evaluator-mappings 인가). 근거: 가드가 피평가자를 통과시켜 P0-A 조작 경로와 결합.
- **정정(❌):** P3-2 `createFullEvaluationDataWorkbook` "사용처 0" 부정확(내부 2회 호출). P3-7 `console` 72→116(server.js만).
- **신규(🆕):** P0-11 WebGL 워터마크 라이선스, P0-4 식별자 인젝션 각도, P0-13 죽은 VITE 키, P3-4 죽은 shadcn deps, P1-3(c) callGptOss 모순.
- **보강:** P0-5 알림 자동생성 직원은 자동 HR 승격 아님(정확화).

## 검증 방법론

- ✅ 항목은 본 세션에서 `server.js` 해당 라우트·가드 헬퍼(2058·2096·2164·2696·2747·2810)와 프런트 파일을 **직접 정독**해 확인. `npm run typecheck` 통과(0 err) · `lint` 0 err·128 warn · 자체 테스트 3개 파일.
- ⚠️ 항목은 원문 주장이거나 판단 필요 — **착수 시 명시 라인 재확인**.
- 권장 착수 순서: **P0-A 코드 보안 → P0-B 절차/설정(워터마크·GPT-oss env) → P1 → P3 죽은코드(도달성 확인 후) → P2 React Query/분해.** 각 단계 후 `typecheck`→`build` 통과 확인.
