BEGIN;

ALTER TABLE public.evaluator_assignment_history
  ADD COLUMN IF NOT EXISTS evaluation_id uuid,
  ADD COLUMN IF NOT EXISTS evaluation_period_id uuid,
  ADD COLUMN IF NOT EXISTS change_type text NOT NULL DEFAULT 'change',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'applied',
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS supersedes_history_id uuid;

UPDATE public.evaluator_assignment_history
SET change_type = 'change'
WHERE change_type IS NULL;

UPDATE public.evaluator_assignment_history
SET status = 'applied'
WHERE status IS NULL;

DO $$
BEGIN
  ALTER TABLE public.evaluator_assignment_history
    ADD CONSTRAINT chk_evaluator_assignment_history_change_type
    CHECK (change_type = ANY (ARRAY['change'::text, 'cancel'::text]));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.evaluator_assignment_history
    ADD CONSTRAINT chk_evaluator_assignment_history_status
    CHECK (status = ANY (ARRAY['applied'::text, 'cancelled'::text]));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.evaluator_assignment_history
    ADD CONSTRAINT fk_evaluator_assignment_history_evaluation
    FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.evaluator_assignment_history
    ADD CONSTRAINT fk_evaluator_assignment_history_period
    FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_evaluator_assignment_history_employee_status
  ON public.evaluator_assignment_history (employee_id, status, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluator_assignment_history_period
  ON public.evaluator_assignment_history (evaluation_period_id);

CREATE INDEX IF NOT EXISTS idx_evaluator_assignment_history_supersedes
  ON public.evaluator_assignment_history (supersedes_history_id);

COMMIT;
