-- AI 검수 유형(구체성/성의/복붙/논조)을 별도 컬럼으로 — HR 롤업에서 유형별 컬럼 표시용.
BEGIN;
ALTER TABLE public.task_evaluation_entries
  ADD COLUMN IF NOT EXISTS ai_type text;
COMMIT;
