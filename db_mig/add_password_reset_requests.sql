BEGIN;

-- 비밀번호 초기화 요청·승인 워크플로우.
-- 비밀번호를 잊은 사용자가 로그인 화면에서 사번으로 초기화를 요청하면 pending 으로 쌓이고,
-- HR 이 승인하면 해당 직원의 password_hash 를 NULL + must_change_password=TRUE 로 되돌려
-- 초기 비밀번호(=사번)로 로그인 후 변경을 강제한다.
-- (HR 직접 초기화는 요청행 없이 즉시 수행 — admin_audit_logs 에만 남는다.)
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  employee_name text,
  status text NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
  reason text,                               -- 요청 사유(선택)
  resolved_by text,                          -- 승인/반려한 HR 사번
  resolved_at timestamptz,
  review_comment text,                       -- 반려 사유 등(선택)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prr_status ON public.password_reset_requests(status);
CREATE INDEX IF NOT EXISTS idx_prr_employee ON public.password_reset_requests(employee_id);

-- 한 직원당 pending 요청은 최대 하나 (중복 요청·알림 스팸 방지).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prr_pending_employee
  ON public.password_reset_requests(employee_id)
  WHERE status = 'pending';

COMMIT;
