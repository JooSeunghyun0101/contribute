BEGIN;

CREATE TABLE IF NOT EXISTS public.evaluator_assignment_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  previous_evaluator_id text,
  new_evaluator_id text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text,
  CONSTRAINT evaluator_assignment_history_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_evaluator_assignment_history_employee
  ON public.evaluator_assignment_history (employee_id);

CREATE INDEX IF NOT EXISTS idx_evaluator_assignment_history_previous
  ON public.evaluator_assignment_history (previous_evaluator_id);

CREATE INDEX IF NOT EXISTS idx_evaluator_assignment_history_new
  ON public.evaluator_assignment_history (new_evaluator_id);

COMMIT;
