BEGIN;

-- 평가자 변경요청·승인 워크플로우.
-- 평가자/피평가자가 특정 평가기간에 대해 "이 피평가자의 평가자를 바꿔달라"고 요청하면
-- HR 이 검토 후 승인/반려한다. 승인 시 기존 평가자배정 변경(evaluator-edit)이 적용되어
-- evaluator_assignment_history 에 이력이 남는다.
CREATE TABLE IF NOT EXISTS public.evaluator_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluatee_id text NOT NULL,
  evaluatee_name text,
  current_evaluator_id text,
  current_evaluator_name text,
  requested_evaluator_id text,
  requested_evaluator_name text,
  evaluation_period_id uuid,
  target_history_id uuid,                  -- 정정 대상 배정 이력(평가 구간) id
  segment_start_date date,                 -- 선택 구간 근무 시작일(표시 스냅샷)
  segment_end_date date,                   -- 선택 구간 근무 종료일(표시 스냅샷, null=현재)
  requested_by text NOT NULL,
  requester_role text NOT NULL,            -- 'evaluator' | 'evaluatee'
  reason text,
  status text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'cancelled'
  reviewed_by text,
  reviewed_at timestamptz,
  review_comment text,
  applied_history_id uuid,                 -- 승인 시 생성된 assignment_history id
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecr_status ON public.evaluator_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_ecr_evaluatee ON public.evaluator_change_requests(evaluatee_id);
CREATE INDEX IF NOT EXISTS idx_ecr_requested_by ON public.evaluator_change_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_ecr_period ON public.evaluator_change_requests(evaluation_period_id);

COMMIT;
