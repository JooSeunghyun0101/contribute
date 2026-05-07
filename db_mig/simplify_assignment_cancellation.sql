BEGIN;

ALTER TABLE public.task_evaluation_entries
  ADD COLUMN IF NOT EXISTS assignment_history_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

UPDATE public.task_evaluation_entries
SET status = 'active'
WHERE status IS NULL;

UPDATE public.evaluator_assignment_history
SET change_type = 'change'
WHERE change_type = 'revert';

DO $$
BEGIN
  ALTER TABLE public.task_evaluation_entries
    ADD CONSTRAINT chk_task_evaluation_entries_status
    CHECK (status = ANY (ARRAY['active'::text, 'cancelled'::text]));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.evaluator_assignment_history
  DROP CONSTRAINT IF EXISTS chk_evaluator_assignment_history_change_type;

ALTER TABLE public.evaluator_assignment_history
  ADD CONSTRAINT chk_evaluator_assignment_history_change_type
  CHECK (change_type = ANY (ARRAY['change'::text, 'cancel'::text]));

DO $$
BEGIN
  ALTER TABLE public.task_evaluation_entries
    ADD CONSTRAINT fk_task_evaluation_entries_assignment_history
    FOREIGN KEY (assignment_history_id) REFERENCES public.evaluator_assignment_history(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_evaluation_entries_status
  ON public.task_evaluation_entries (status);

CREATE INDEX IF NOT EXISTS idx_task_evaluation_entries_assignment_history
  ON public.task_evaluation_entries (assignment_history_id);

CREATE INDEX IF NOT EXISTS idx_evaluator_assignment_history_evaluation_status
  ON public.evaluator_assignment_history (evaluation_id, status);

COMMIT;
