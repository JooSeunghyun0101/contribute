BEGIN;

CREATE TABLE IF NOT EXISTS public.task_evaluation_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_uuid uuid NOT NULL,
  task_id text NOT NULL,
  evaluation_id uuid NOT NULL,
  evaluator_id text NOT NULL,
  evaluator_name text NOT NULL,
  contribution_method text,
  contribution_scope text,
  score integer,
  feedback text,
  feedback_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_evaluation_entries_pkey PRIMARY KEY (id),
  CONSTRAINT fk_task_evaluation_entries_task_uuid
    FOREIGN KEY (task_uuid) REFERENCES public.tasks(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_task_evaluation_entries_task_id
    FOREIGN KEY (task_id) REFERENCES public.tasks(task_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_task_evaluation_entries_evaluation
    FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT uq_task_evaluation_entries_task_evaluator UNIQUE (task_uuid, evaluator_id)
);

CREATE INDEX IF NOT EXISTS idx_task_evaluation_entries_evaluation
  ON public.task_evaluation_entries (evaluation_id);

CREATE INDEX IF NOT EXISTS idx_task_evaluation_entries_task
  ON public.task_evaluation_entries (task_uuid);

CREATE INDEX IF NOT EXISTS idx_task_evaluation_entries_evaluator
  ON public.task_evaluation_entries (evaluator_id);

INSERT INTO public.task_evaluation_entries (
  task_uuid,
  task_id,
  evaluation_id,
  evaluator_id,
  evaluator_name,
  contribution_method,
  contribution_scope,
  score,
  feedback,
  feedback_date,
  created_at,
  updated_at
)
SELECT
  t.id,
  t.task_id,
  t.evaluation_id,
  COALESCE(emp.employee_id, 'legacy:' || NULLIF(BTRIM(t.evaluator_name), ''), 'legacy:unknown'),
  COALESCE(NULLIF(BTRIM(t.evaluator_name), ''), '이전 평가자'),
  t.contribution_method,
  t.contribution_scope,
  t.score,
  t.feedback,
  t.feedback_date,
  COALESCE(t.feedback_date, t.created_at, now()),
  COALESCE(t.feedback_date, t.created_at, now())
FROM public.tasks t
LEFT JOIN public.employees emp ON emp.name = t.evaluator_name
WHERE
  t.score IS NOT NULL
  OR NULLIF(BTRIM(t.feedback), '') IS NOT NULL
  OR NULLIF(BTRIM(t.contribution_method), '') IS NOT NULL
  OR NULLIF(BTRIM(t.contribution_scope), '') IS NOT NULL
  OR NULLIF(BTRIM(t.evaluator_name), '') IS NOT NULL
ON CONFLICT (task_uuid, evaluator_id) DO UPDATE SET
  evaluator_name = EXCLUDED.evaluator_name,
  contribution_method = EXCLUDED.contribution_method,
  contribution_scope = EXCLUDED.contribution_scope,
  score = EXCLUDED.score,
  feedback = EXCLUDED.feedback,
  feedback_date = EXCLUDED.feedback_date,
  updated_at = EXCLUDED.updated_at;

COMMIT;
