# 사용자관리 · 업로드/다운로드 · DB 구조 전면 점검 (2026-07-13)

> **구현 현황 (2026-07-13, P0+P1+P2 전체 착수·완료)**
> - **P1 마이그레이션 적용 완료**: `db_mig/20260713_period_pipeline_integrity.sql` — 2025=closed·2026=active+**is_default**(employees 조직 파생 기준 교정), import 배치 기간 NOT NULL+FK, `ux_evaluations_active_stage` 부분 유니크. 백업 `db_mig/backups/pre_20260713_period_pipeline.json`. 사전점검: 위반 0건.
> - **P0 서버**: 배정이력 단건/벌크 `periodId` 필터 · preview 전면 재작업(기간 필수, apply와 동일 판정 — 읽기 전용 파티션 헬퍼 `partitionMatchingStagesForPeriod`, reconcile 본체 불변) · 매칭/대상자 임포트 기간 필수화(400) · counts 17키+evaluation_period 응답 · 배치 목록 기간 필터 · 전체 export의 evaluations 스코프 일관화.
> - **P0/P2 프론트**: 매칭 다운로드를 배치 replay → **그 기간 DB 진실 조립**으로 재구성(기간 필수·조용한 폴백 전면 제거·N+1→벌크 1회, 파일명 `_업로드양식`) · 신규 **매칭 이력 대장**(전 기간·읽기 전용, '평가기간' 헤더 마커, 업로드 시 거부) · 미리보기 탈락 사유 요약 패널 · 업로드 결과 상세 다이얼로그 · 캐시 무효화 확장(company 배너+로컬 캐시) · `DataPipelineWizard`(조직→대상자→매칭→기여도 4단계 가이드) · '기간 미대상 포함' 토글.
> - **적대적 리뷰(13에이전트) 반영 완료**:
>   - [critical] 1차 유니크 인덱스의 NULL 버킷이 정상 흐름 4곳(기간 초기화·기간 삭제·평가자 직접 지정·reconcile pass4)과 충돌(라이브 재현) → **2차 마이그레이션 `20260713_fix_unique_index_scope.sql` 적용**: `ux_evaluations_active_history`(한 배정단계→active 평가행 1개)로 범위 축소. 충돌 시나리오 dry-run 통과 재확인.
>   - [critical] 벌크 이력 API 500명 캡으로 새 다운로드 2종이 실데이터(654~761명)에서 즉사 → employeeService 벌크를 **400명 청크+병합**으로(모든 콜러 투명).
>   - [minor] preview/apply 카운터 정합(name_mismatch=primary 행 기준 통일, employees_missing=업로드 전 기준 통일) · 대상자 다운로드 오류 메시지 패스스루.
> - **검증**: typecheck·build 통과 · **API 스모크 11/11 통과**(임시 HR 계정 — 기간 필터 순수성·preview 400/counts/unchanged/carry·전체 export 양연도) · 인덱스 충돌 dry-run 통과.
> - **수용/후속 항목**: ① reconcile pass4의 '과업 실린 baseline 채택' 개선은 발령 E2E 하드닝 코드 불변 원칙상 후속 과제(인덱스 축소로 500은 발생 안 함 — 종전과 동일한 중복 draft 가능성만 잔존, 위저드의 매칭→기여도 순서 가이드가 시나리오 회피) ② POST /api/evaluation check-then-insert 레이스(기존 이슈) ③ 비정규 UUID 표기(대문자 등) 외부 스크립트 호출은 이제 400(프론트는 무영향) ④ carry 40명은 마스터에도 평가자 없음 — 다운로드 시 평가자 공란이 사실 반영.
> - **사용자 실사 피드백 반영(2026-07-14)**:
>   - ① 이동 전후 부서 동일 표기 → 이력 API(단건/벌크)에 단계별 평가행 조인(stage_dept_code/stage_department) 추가, 업로드 양식·이력 대장이 단계별 부서 사용. 실데이터 이동자 3명으로 검증(이수지점→기업금융1본부 등 분리 확인).
>   - ② 26년 이동자 누락 → **다운로드는 정상, 데이터 손상**: 2026-06-27 등록된 이동 200건이 같은 날 오염 '이력포함' 파일 재업로드의 pass5로 전건 취소('Removed by matching reconcile'), 180명이 1단계만 잔존. 원본은 취소 이력에 보존 — 복구는 취소 이력 기반 매칭 파일 재업로드로 가능(사용자 결정 대기).
>   - ③ 제도 규칙 반영: **별도 업로드 없으면 전년 마지막 정보 승계** — carry 행이 전 기간 이력에서 전년(이하) 마지막 단계의 평가자·원본 발령일·부서를 폴백 승계(기간 평가행 값 우선).
> - **잔여**: 브라우저 UI 실사(위저드·미리보기 탈락 패널·대장 업로드 거부) — 사용자 확인 진행 중.


> 보고된 증상: (A) 매칭파일 업로드 후 사용자관리 내용이 안 바뀌는 경우가 있음 · (B) 매칭파일 다운로드가 선택 연도가 아닌 전체 데이터를 내보냄.
> 조사 범위: HrUsersPage(+UserRow·UploadPreviewModal·MatchingIntegrityBanner), server.js 임포트/엑스포트 전 엔드포인트, hrDataExport.ts, employeeService, DB 스키마(schema_full.sql)+마이그레이션, **실DB 상태**.

---

## 1. 현행 구조 지도

### 1-1. 테이블 역할 (기간 스코프 여부)

| 테이블 | 기간 스코프 | 역할 |
|---|---|---|
| `employees` | ✕ (전역 1행/인) | **현재 상태** 마스터: 이름·직책·현재 부서·현재 평가자(evaluator_id)·roles |
| `evaluations` | ○ (FK) | **"그 기간의 그 직원"의 중심.** 기간별 조직 스냅샷(evaluatee_dept_code·evaluatee_org_*) 보유. 발령 시 단계별 복수 행(assignment_history_id 연결), 취소는 record_status='cancelled' 보존. ⚠(evaluatee_id, period) 유니크 제약 없음 — 앱/트리거 로직으로만 억제 |
| `evaluator_assignment_history` | ○ (nullable) | 평가자 배정 타임라인(발령일=changed_at, applied/cancelled, supersede 정정) |
| `matching_import_batches/rows` | △ (**nullable·FK 없음·구배치 백필 없음**) | 매칭 업로드 이력 + 원본행(raw_data). 재다운로드의 1차 원천 |
| `employee_profile_import_batches/rows` | △ (동일) | 대상자 업로드 이력 + 원본행 |
| `org_structure` | ○ (PK 구성요소) | **기간별 조직의 원천**: (dept_code, period) → 4단계 조직. 업로드=기간 스냅샷 통째 교체 |

### 1-2. 조직 정보의 3중 저장 (설계 의도)

```
조직 엑셀 업로드 → ③ org_structure (기간별 진실)
                     ├→ ① employees.org_* / department_id  ← is_default 기간일 때만 파생 (= "현재")
                     └→ ② evaluations.evaluatee_org_*      ← 그 기간 평가행 스냅샷 (화면·산정이 우선 읽음)
```

### 1-3. 업로드 4종의 역할 분담

| 업로드 | 쓰는 곳 | 기간 귀속 |
|---|---|---|
| ① 조직정보 | org_structure(기간 교체) + is_default 기간이면 employees.org_* | **periodId 필수** ✅ |
| ② 대상자(프로필) | employees upsert + 그 기간 draft 평가행 보장 + baseline 이력 | periodId **선택** — 없으면 기간 블록 통째 스킵 ⚠ |
| ③ 매칭 | employees upsert + **reconcile 5-pass**(이력·평가행 생성/정정/취소, 파일=정답) | periodId 선택 — 없으면 **active 기간 폴백** ⚠ |
| ④ 기여도 | 그 기간 기존 평가행에 과업/점수 재적재(평가행 안 만듦) | periodId(없으면 is_default 폴백) ✅ |

### 1-4. 사용자관리 화면의 데이터 출처
- 목록 = `employees`(마스터) × 선택 기간 `evaluations`(스냅샷): "이 평가기간 대상자 N명"=기간 평가행 수, "전체 등록 M명"=employees 수.
- **evaluatee는 선택 기간에 평가행이 있어야만 목록에 표시** (HrUsersPage.tsx:487-491).
- 행의 조직·성장레벨·평가자 = 기간 평가행 우선, 없으면 employees 폴백.

---

## 2. 실DB 상태 (2026-07-13 점검)

| 항목 | 값 | 함의 |
|---|---|---|
| 평가기간 | 2025·2026 **둘 다 `active`** | "active 기간 폴백" 류 로직 전부 모호. ensureUploadPeriod 가드가 있는 이유 |
| 매칭 배치 | **같은 파일**(`개인별매칭결과_..._이력포함.xlsx`, 2393행)이 **2025·2026 두 기간에 각각 커밋** | "이력포함 다운로드 → 그대로 재업로드"가 실제로 발생 (§4 악순환) |
| 대상자 배치 | 파일명 "2025 평가"인 파일이 **2026 기간으로 커밋**된 건 존재 | 기간-파일 크로스 업로드가 UI에서 막히지 않음 |
| 기간 내 복수 평가행 | 2025: 94명 / **2026: 221명** (+2026 취소 이력 200건) | 발령 정상 케이스 + 재업로드 반복으로 생성·취소가 부풀려진 정황 |
| 조직 불일치 | 2026 평가행 부서 ≠ employees 부서 **161건** | ①현재 vs ②기간 스냅샷의 정합성 점검 필요(전부 버그는 아님 — 조직개편이면 정상) |

---

## 3. 확정 결함 — B. "매칭 다운로드가 전체 연도로 나옴"

다운로드는 서버가 아니라 **클라이언트 조립**(`createMatchingUploadWorkbook`, hrDataExport.ts:830-922)이고 3분기 구조다. 연도 혼입 경로 4개:

| # | 결함 | 근거 |
|---|---|---|
| B-1 ★ | **배정이력 API에 기간 필터가 아예 없음** — 스키마에 evaluation_period_id가 있는데도 조회에 안 씀. 다운로드가 인별 이력을 병합할 때 **전 연도 수동 발령 행(manualRows)이 시트에 추가**됨 | server.js:5391-5417(`WHERE h.employee_id=$1`만), hrDataExport.ts:352-368·759-824 |
| B-2 ★ | **조용한 전체 폴백**: 그 기간 배치 없음 + 기간 평가맵 null(periodId가 null이거나 **조회 오류를 catch가 삼킴**)이면 "기간 미지정(전체)" 분기로 강등 — 전 대상자+전 연도 이력 덤프. **파일명엔 선택 기간 라벨이 붙어** 기간별 파일로 오인 | hrDataExport.ts:836(`.catch(()=>[])`)·447-449(catch→null)·887-921·924-929 |
| B-3 | 업로드 배치에 **파일 전 행(타 연도 포함) 저장** + latest-rows가 배치 전 행을 연도 필터 없이 반환 → 다연도 파일을 올린 기간은 다운로드도 전 연도 | server.js:4522-4578·3541-3581 |
| B-4 | 배치 목록 GET은 기간 조건 없음(최근 20건); `GET /api/hr/export/evaluation-data`는 periodId를 받아도 **evaluations만 스코프** — tasks·entries·feedback·assignment_histories·employees 5배열은 항상 전량 | server.js:3503-3516·5439-5495 |

## 4. 확정 결함 — A. "매칭 업로드해도 사용자관리가 안 바뀜"

업로드는 단일 트랜잭션이라 부분 반영은 없지만, **"조용한 탈락"이 12경로** 있다. 핵심:

| # | 결함 | 근거 |
|---|---|---|
| A-1 ★ | **연도 필터로 단계 소멸**: 발령일(근무시작일) 연도 ≠ 기간 evaluation_year인 단계는 reconcile에서 조용히 제거(카운트에도 안 잡힘). 당해 단계 0이면 carry 1건 시드뿐 — 기존과 같으면 unchanged | server.js:4244-4266 |
| A-2 ★ | **preview/apply 판정 비대칭**: preview는 기간 개념이 전혀 없고(클라이언트도 periodId 안 보냄) 전 기간 이력과 비교, apply는 기간 스코프+연도 필터 → **"미리보기=변경, 적용=무변경"** | employeeService.ts:368-380, server.js:4942-4975 vs 4287-4294 |
| A-3 | 같은 평가자·다른 발령일 = **의도적 무시**(pass3) — 날짜만 고쳐 재업로드해도 무변경. 같은 평가자 연속 행 병합도 뒤 행 날짜 무시 | server.js:4347-4359·4161-4166 |
| A-4 | 조용한 행 탈락: 영문 시작 사번 행 폐기 / 영문·빈 평가자사번 → 단계 제외 → stages 0이면 직원 통째 스킵 / validation error 행 제외 / employees 미존재 스킵 | server.js:4481-4484·4144·4742·4752-4754 |
| A-5 | employees upsert가 **name·position·growth_level·재직기간을 안 갱신**하고, 빈 값은 COALESCE로 기존 유지(지우기 불가) | server.js:4667-4695 |
| A-6 | 기간 귀속 어긋남: periodId 미전달 시 active 기간 폴백인데 **현재 2025·2026 둘 다 active** — 보고 있는 기간과 다른 기간에 적재 가능 | server.js:815-837, DB 상태 §2 |
| A-7 | 프론트 갱신 누락: 업로드 후 `'all'` 키만 invalidate — 같은 화면 **MatchingIntegrityBanner('company' 키)와 평가자 이력 모달 로컬 캐시는 stale 유지** | useDashboardRecords.ts:67-76, MatchingIntegrityBanner.tsx:21-22, HrUsersPage.tsx:387-393·609-632 |
| A-8 | 평가행이 안 만들어진 evaluatee는 employees에 upsert돼도 **목록에 아예 안 보임**(기간 평가행 필수 표시 규칙) | HrUsersPage.tsx:487-491 |
| A-9 | 결과 토스트가 반영 인원·이력 건수만 표시 — `ignored_date_stages`·연도 탈락·행 탈락 카운트는 응답에 있는데 **UI에 안 보여줌** | server.js:4917-4931, HrUsersPage.tsx:1713-1716 |

### ★ 두 버그의 악순환 (실데이터로 확인됨)
```
B(다운로드가 전 연도 이력 혼입 "_이력포함" 파일 생성)
  → 사용자가 그 파일을 수정해 재업로드
  → A-1(타 연도 발령일 행 대량 탈락) + A-3(날짜 수정 무시) → "안 바뀜"
  → 배치에는 2393행 전체가 또 저장 → 다음 다운로드는 더 오염(B-3)
```

---

## 5. 목표 설계 제안 — "기간이 1급 축인 업로드 파이프라인"

**원칙**: ① 모든 업로드/다운로드는 기간 필수·명시 ② 업로드 순서 강제(조직 → 대상자 → 매칭 → 기여도) ③ 다운로드는 업로드 양식과 왕복 대칭(그 기간 것만) ④ 탈락은 조용히 버리지 않고 전부 보고.

### P0 — 버그 수정 (스키마 변경 없음, 즉시 가능)
1. **배정이력 API에 `periodId` 파라미터 추가** + 다운로드 조립에서 기간 이력만 병합 (B-1)
2. **다운로드 폴백 제거**: periodId 필수화, 조회 실패 시 조용한 전체 덤프 대신 오류 토스트. "전체(전 기간) 내보내기"는 별도 메뉴로 분리하고 파일명에 `_전체기간` 명시 (B-2)
3. 다운로드 조립·latest-rows 소비 시 **기간 연도 행만 방출**(타 연도 행은 "참고" 별도 시트로) (B-3)
4. **preview에 periodId 전달 + 서버 preview를 apply와 동일 판정으로 정렬**, 미리보기에 탈락 사유별 카운트 표시: 연도 불일치 N·평가자 없음 N·영문 사번 N·날짜 무시 N (A-1·A-2·A-3·A-9)
5. 업로드 결과 토스트/모달에 서버 응답의 skip 카운트 전부 노출 (A-9)
6. 업로드 후 invalidate 확장: 'company' 키 + 이력 모달 로컬 캐시 초기화 (A-7)

### P1 — 정합성 가드 (소규모 마이그레이션)
7. `matching_import_batches`·`employee_profile_import_batches`의 `evaluation_period_id` **NOT NULL + FK** + 구배치 백필
8. `evaluations`에 부분 유니크 인덱스: `(evaluatee_id, evaluation_period_id) WHERE record_status='active' AND assignment_history_id IS NULL` 유사 가드(발령 복수행과 공존 가능한 형태로 설계 필요) + 중복 진단 쿼리 정례화
9. **평가기간 active 단일화**: 2025를 closed로(제도 확인 후). active 폴백 로직은 is_default 기준으로 통일
10. employees upsert 갱신 컬럼 정책 확정(name·position·growth_level 갱신 여부) 후 반영

### P2 — 구조 개선 (UX)
11. **업로드 위저드**: 기간 선택 → ① 조직(없으면 경고) → ② 대상자 → ③ 매칭 → ④ 기여도 순서 안내, 각 단계 완료 상태 표시(그 기간 배치 유무 기반)
12. 다운로드 2형식 분리: "업로드 양식(그 기간·왕복용)" vs "이력 대장(연도 컬럼 포함·읽기 전용)" — 대장 파일은 업로드 시 거부해 왕복 오염 차단
13. 사용자관리 목록에 "기간 평가행 없는 등록자" 표시 토글(A-8의 가시화)

---

## 부속 자료
- 상세 조사 보고 5건(파일:라인 근거 포함): 세션 scratchpad `probe/` (frontend-users-page · server-matching-imports · server-profile-org-contrib · db-schema · frontend-services)
- DB 점검 쿼리: scratchpad `db-inspect.cjs` (읽기 전용, 재실행 가능)
