# DB 마이그레이션 적용 가이드 (운영 이식 체크리스트)

이 레포에는 **자동 마이그레이션 러너가 없다.** SQL 파일을 만들기만 하면 아무 일도 일어나지 않고,
적용 안 된 채 코드가 배포되면 해당 기능이 **런타임 500**으로 깨진다
(실사례: `add_evaluation_period_id_to_imports.sql` 미적용 → 대상자 엑셀 업로드 500,
`add_password_reset_requests.sql` 미적용 → 비밀번호 초기화 500).

> **규칙: 마이그레이션 SQL을 작성하면 그 자리에서 즉시 DB에 적용하고, 적용 여부를 확인한다.**

## 적용 방법

```powershell
# 도커 컨테이너(hr-evaluation-db) 안의 psql로 적용
Get-Content db_mig\<파일>.sql -Raw | docker exec -i hr-evaluation-db psql -U postgres -d human-resource

# 또는 호스트에서 직접 (.env의 DATABASE_URL 기준, localhost:5532)
psql "$env:DATABASE_URL" -f db_mig\<파일>.sql
```

적용 전 백업(스키마 변경·대량 변경 시 필수):

```powershell
docker exec hr-evaluation-db pg_dump -U postgres -Fc human-resource > hr-db-backup-$(Get-Date -Format yyyyMMdd_HHmm).dump
```

---

## 신규 DB(내부망 이식 등) 구축 경로

**권장 — 덤프 복원.** 현재 DB가 모든 마이그레이션이 적용된 유일한 진실이므로,
`pg_dump -Fc` 덤프를 떠서 새 환경에 `pg_restore`로 복원하는 것이 가장 안전하다.
(데이터 없이 스키마만 옮기려면 `pg_dump --schema-only`.)

```powershell
docker exec hr-evaluation-db pg_dump -U postgres -Fc human-resource > transfer.dump
# 새 환경에서
pg_restore -U postgres -d human-resource --no-owner transfer.dump
```

**차선 — 스냅샷 + 마이그레이션 재생.** `db_structure/`의 테이블 스냅샷은 날짜별 부분 스냅샷이라
단독으로 완전하지 않다(예: `settings` 테이블은 `tables_past.sql`에만 존재). 이 경로를 쓸 경우
누락 테이블이 없는지 아래 확인 쿼리로 검증할 것.

## 스키마 마이그레이션 — 적용 필수, 시간순 (18개)

git 추가일 순서. 모두 멱등(`IF NOT EXISTS` 등) 또는 트랜잭션이라 재실행에 비교적 안전하지만,
순서대로 1회 적용이 원칙.

| 순서 | 파일 | 내용 |
|---|---|---|
| 2026-05-07 | `add_evaluation_periods_and_statuses.sql` | 평가기간 테이블 + 상태 컬럼 + pgcrypto |
| 2026-05-07 | `add_task_evaluation_entries.sql` | 과업 평가 엔트리 테이블 |
| 2026-05-07 | `add_evaluator_assignment_history.sql` | 평가자 배정 이력 테이블 |
| 2026-05-07 | `enhance_evaluator_assignment_history.sql` | 배정 이력 컬럼 보강 |
| 2026-05-07 | `normalize_evaluation_validity.sql` | evaluations 유효성 컬럼 |
| 2026-05-07 | `simplify_assignment_cancellation.sql` | 배정 취소 단순화 컬럼 |
| 2026-05-07 | `add_deleted_at_to_tasks.sql` | tasks 소프트 삭제 컬럼 |
| 2026-05-08 | `add_admin_audit_logs.sql` | 관리자 감사 로그 테이블 |
| 2026-05-08 | `add_matching_imports.sql` | 매칭 임포트 배치 테이블 + 함수 |
| 2026-05-11 | `add_employee_profile_imports.sql` | 대상자 임포트 배치 테이블 |
| 2026-05-15 | `relax_evaluator_assignment_history.sql` | 배정 이력 제약 완화 |
| 2026-06-01 | `add_evaluation_period_id_to_imports.sql` | 임포트 배치에 평가기간 컬럼 (미적용 시 업로드 500) |
| 2026-06-01 | `fix_create_default_evaluation_trigger.sql` | 기본 평가 생성 트리거 신버전 (active 기간 없으면 미생성 + 중복 방지) |
| 2026-06-02 | `add_org_hierarchy_columns.sql` | 법인-본부-부-팀 4단계 조직 컬럼 (업로드 전 적용 필수) |
| 2026-06-04 | `add_evaluator_change_requests.sql` | 평가자 변경요청 워크플로 테이블 |
| 2026-06-04 | `add_evaluator_qna_logs.sql` | 평가자 AI 문의 이력 테이블 |
| 2026-06-10 | `add_auth_columns.sql` | 인증 컬럼 password_hash·must_change_password (미적용 시 로그인 500) |
| 2026-06-11 | `add_password_reset_requests.sql` | 비밀번호 초기화 요청 테이블 (미적용 시 초기화 500) |

적용 여부 빠른 확인:

```sql
-- 핵심 컬럼·테이블 존재 확인 (전부 t 가 나와야 함)
SELECT
  to_regclass('public.evaluation_periods')        IS NOT NULL AS periods,
  to_regclass('public.task_evaluation_entries')   IS NOT NULL AS entries,
  to_regclass('public.evaluator_assignment_history') IS NOT NULL AS assign_hist,
  to_regclass('public.admin_audit_logs')          IS NOT NULL AS audit,
  to_regclass('public.matching_import_batches')   IS NOT NULL AS matching_imp,
  to_regclass('public.employee_profile_import_batches') IS NOT NULL AS profile_imp,
  to_regclass('public.evaluator_change_requests') IS NOT NULL AS change_req,
  to_regclass('public.evaluator_qna_logs')        IS NOT NULL AS qna,
  to_regclass('public.password_reset_requests')   IS NOT NULL AS pw_reset,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='password_hash')        AS auth_cols,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='org_corp')             AS org_cols,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matching_import_batches' AND column_name='evaluation_period_id') AS period_on_imports;
```

## 1회성 데이터 보정 — 신규 DB에 재적용 금지 (9개)

특정 시점의 데이터 오류를 고친 스크립트. 이미 반영된 DB의 덤프를 복원하면 불필요하고,
빈 DB에선 무의미하다. **이식 시 건너뛴다.**

`backfill_assignment_evaluations.sql` · `backfill_assignment_history_baseline.sql` ·
`backfill_evaluator_history_from_matching_dates.sql` · `cleanup_bad_employee_ids.sql` ·
`reconcile_direct_evaluator_edit_history.sql` · `reconcile_employees_evaluator_id.sql` ·
`reconcile_evaluation_record_status.sql` · `transfer_correction_entries_ownership.sql` ·
`transfer_direct_evaluator_edit_entries.sql`

## 샘플 데이터

> 개인정보(실명·사번) 제거를 위해 실데이터 SQL 덤프
> (`employees_rows.sql`·`evaluations_rows.sql`·`tasks_rows.sql`·`feedback_history_rows.sql`·`notifications_rows.sql`)는
> **삭제**했다. 깨끗한 상태로 기동한 뒤 내부망에서 직접 업로드한다.

`reconstruct_sample_2025_2026.cjs` (합성 샘플 재구성 스크립트, DRY_RUN 기본) — 운영 DB 투입 금지

## 운영 이식 시 함께 챙길 것

- `.env` — `DATABASE_URL`, `AI_BASE_URL`(GPT-OSS 주소로 교체), `AI_API_KEY`, `AI_MODEL`, `CORS_ORIGINS`, `COOKIE_SECURE`
- 전 직원 초기 비밀번호 = 사번(최초 로그인 시 변경 강제), HR은 `admin` 계정(초기 비밀번호 `admin`) 또는 `available_roles`에 `hr` 부여 계정
- 백업 덤프는 `*.dump`로 git 제외됨(.gitignore)
