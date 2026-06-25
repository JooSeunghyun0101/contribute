-- AI 과업 카테고리 + 피평가자별 50% 규칙 예외
-- - tasks.is_ai_task: 피평가자가 과업을 'AI 과업'으로 표시(제목 옆 체크박스).
-- - employees.ai_rule_exempt: HR이 특정 피평가자를 'AI 과업 50% 규칙' 면제로 지정.
--   면제자는 AI 과업 비중 미달이어도 성과보고 최종제출이 차단되지 않는다.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_ai_task BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ai_rule_exempt BOOLEAN NOT NULL DEFAULT false;
