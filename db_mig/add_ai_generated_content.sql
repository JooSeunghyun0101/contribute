-- 저장/트리거 시점에 생성한 AI 결과물을 영속화해, 조회 시 재호출 없이 그대로 표시한다.
-- (조회 때마다 AI를 돌리던 3개 항목을 트리거 기반 + 영속 출력으로 전환하기 위한 단일 저장소)
--
-- kind 별 scope_id 규약:
--   evaluatee_feedback_summary : '<evaluatee_id>:<period_id>'                 (피평가자 받은 피드백 요약 — 수동 생성)
--   evaluator_feedback_summary : '<evaluator_id>:<evaluatee_id>:<period_id>'  (평가자가 쓴 피드백 요약 — 평가 저장 시 자동)
--   task_growth_suggestion     : '<task_uuid>'                                (피평가자 과업 성장 제안 — 평가 저장 시 자동)
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_generated_content (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  scope_id     text NOT NULL,
  content      text NOT NULL,
  generated_by text,                                  -- 트리거한 사용자 employeeId(감사용)
  generated_at timestamptz NOT NULL DEFAULT now(),
  meta         jsonb,                                 -- period_id·시그니처 등 부가정보(선택)
  CONSTRAINT ai_generated_content_kind_scope_uniq UNIQUE (kind, scope_id)
);

COMMIT;
