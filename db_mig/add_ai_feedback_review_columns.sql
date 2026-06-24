-- Phase 3: AI 피드백 검수 결과를 평가입력(task_evaluation_entries)에 영속화.
-- 평가자 저장 시 1차 AI 검수 결과를 항목당 최신 1건으로 기록. HR은 이 값을 롤업으로 열람.
-- 재저장(재검수) 시 매번 덮어써, 경고 없이 통과하면 ai_flagged=false 로 '이상없음' 갱신됨.
BEGIN;

ALTER TABLE public.task_evaluation_entries
  ADD COLUMN IF NOT EXISTS ai_flagged boolean,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_feedback_hash text;

COMMIT;
