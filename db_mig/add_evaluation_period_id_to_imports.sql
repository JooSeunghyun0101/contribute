BEGIN;

-- 매칭/대상자 임포트 배치에 평가기간 식별자 추가.
-- HR 사용자 관리 화면에서 평가기간을 전환하면 그 기간에 묶인 가장 최근 import만
-- 다운로드/조회에 사용할 수 있도록 한다.
ALTER TABLE public.matching_import_batches
  ADD COLUMN IF NOT EXISTS evaluation_period_id uuid;

ALTER TABLE public.employee_profile_import_batches
  ADD COLUMN IF NOT EXISTS evaluation_period_id uuid;

CREATE INDEX IF NOT EXISTS idx_matching_import_batches_period
  ON public.matching_import_batches(evaluation_period_id);

CREATE INDEX IF NOT EXISTS idx_employee_profile_import_batches_period
  ON public.employee_profile_import_batches(evaluation_period_id);

COMMIT;
