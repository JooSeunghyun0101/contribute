-- 감사로그(admin_audit_logs) 무필터/action_type-only 기본 조회의 ORDER BY created_at DESC 지원 인덱스.
-- 기존 인덱스는 (target_employee_id, created_at DESC)·(actor_id, created_at DESC)·(action_type)뿐이라
-- target/actor 필터가 없는 기본 HR 랜딩 페이지는 풀스캔+정렬이 됨. 비파괴 추가(멱등).
BEGIN;

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
  ON public.admin_audit_logs (created_at DESC);

COMMIT;
