-- 평가 상태 전이 타임스탬프(#4): 성과보고(최종제출) 시점 + 칸반 진입 시점 계산용.
-- evaluations 에는 last_modified(아무 수정 시 갱신)만 있어, "언제 제출/되돌림/완료됐나"를 알 수 없었다.
--   submitted_at : 피평가자가 최종제출한(→submitted) 마지막 시각.  (성과보고 시점)
--   returned_at  : 평가자가 피평가자에게 돌려보낸(→in-progress) 마지막 시각.  (미제출 진입)
--   reverted_at  : 완료(completed)를 임시저장(evaluating)으로 되돌린 마지막 시각.  (검토필요 재진입)
--   completed_at : 평가가 완료(→completed)된 마지막 시각.  (완료 진입)
ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 기존 데이터 근사 백필 — 정확한 전이 시각이 없으므로 현재 상태 기준 last_modified 로 추정.
-- (submitted/evaluating/completed/locked 는 한 번은 제출됐던 것으로 본다.)
UPDATE evaluations SET submitted_at = last_modified
  WHERE submitted_at IS NULL AND evaluation_status IN ('submitted','evaluating','completed','locked');
UPDATE evaluations SET completed_at = last_modified
  WHERE completed_at IS NULL AND evaluation_status IN ('completed','locked');
