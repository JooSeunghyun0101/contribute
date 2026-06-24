BEGIN;

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS assignment_history_id uuid,
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

UPDATE public.evaluations
SET record_status = 'active'
WHERE record_status IS NULL
   OR record_status <> ALL (ARRAY['active'::text, 'cancelled'::text]);

ALTER TABLE public.evaluations
  ALTER COLUMN record_status SET DEFAULT 'active',
  ALTER COLUMN record_status SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.evaluations
    ADD CONSTRAINT chk_evaluations_record_status
    CHECK (record_status = ANY (ARRAY['active'::text, 'cancelled'::text]));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.evaluations
    ADD CONSTRAINT fk_evaluations_assignment_history
    FOREIGN KEY (assignment_history_id) REFERENCES public.evaluator_assignment_history(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

WITH linked_history AS (
  SELECT DISTINCT ON (evaluation_id)
    evaluation_id,
    id AS history_id
  FROM public.evaluator_assignment_history
  WHERE evaluation_id IS NOT NULL
  ORDER BY evaluation_id, changed_at DESC, id DESC
)
UPDATE public.evaluations ev
SET assignment_history_id = linked_history.history_id
FROM linked_history
WHERE ev.id = linked_history.evaluation_id
  AND ev.assignment_history_id IS NULL;

UPDATE public.evaluations ev
SET assignment_history_id = NULL
WHERE assignment_history_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.evaluator_assignment_history h
    WHERE h.id = ev.assignment_history_id
  );

UPDATE public.evaluations ev
SET record_status = 'cancelled',
    updated_at = now()
FROM public.evaluator_assignment_history h
WHERE h.evaluation_id = ev.id
  AND h.status = 'cancelled'
  AND ev.record_status <> 'cancelled';

ALTER TABLE public.feedback_history
  ADD COLUMN IF NOT EXISTS task_uuid uuid,
  ADD COLUMN IF NOT EXISTS evaluation_id uuid,
  ADD COLUMN IF NOT EXISTS evaluator_id text,
  ADD COLUMN IF NOT EXISTS task_evaluation_entry_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

UPDATE public.feedback_history
SET status = 'active'
WHERE status IS NULL
   OR status <> ALL (ARRAY['active'::text, 'cancelled'::text]);

ALTER TABLE public.feedback_history
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.feedback_history
    ADD CONSTRAINT chk_feedback_history_status
    CHECK (status = ANY (ARRAY['active'::text, 'cancelled'::text]));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.feedback_history fh
SET
  task_uuid = COALESCE(fh.task_uuid, t.id),
  evaluation_id = COALESCE(fh.evaluation_id, t.evaluation_id)
FROM public.tasks t
WHERE fh.task_id = t.task_id
  AND (fh.task_uuid IS NULL OR fh.evaluation_id IS NULL);

UPDATE public.feedback_history fh
SET evaluator_id = e.employee_id
FROM public.employees e
WHERE fh.evaluator_id IS NULL
  AND NULLIF(BTRIM(fh.evaluator_name), '') IS NOT NULL
  AND e.name = fh.evaluator_name;

UPDATE public.feedback_history fh
SET evaluator_id = NULL
WHERE evaluator_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.employee_id = fh.evaluator_id
  );

WITH matched_feedback_entries AS (
  SELECT DISTINCT ON (fh.id)
    fh.id AS feedback_id,
    tee.id AS entry_id,
    tee.evaluator_id
  FROM public.feedback_history fh
  INNER JOIN public.task_evaluation_entries tee
    ON tee.task_uuid = fh.task_uuid
   AND (
      (fh.evaluator_id IS NOT NULL AND tee.evaluator_id IS NOT DISTINCT FROM fh.evaluator_id)
      OR (
        fh.evaluator_id IS NULL
        AND NULLIF(BTRIM(fh.evaluator_name), '') IS NOT NULL
        AND tee.evaluator_name = fh.evaluator_name
      )
    )
  WHERE fh.task_evaluation_entry_id IS NULL
  ORDER BY fh.id, tee.updated_at DESC, tee.created_at DESC
)
UPDATE public.feedback_history fh
SET
  task_evaluation_entry_id = matched.entry_id,
  evaluator_id = COALESCE(fh.evaluator_id, matched.evaluator_id)
FROM matched_feedback_entries matched
WHERE fh.id = matched.feedback_id;

WITH cancelled_histories AS (
  SELECT *
  FROM public.evaluator_assignment_history
  WHERE status = 'cancelled'
    AND new_evaluator_id IS NOT NULL
)
UPDATE public.task_evaluation_entries tee
SET
  status = 'cancelled',
  assignment_history_id = COALESCE(tee.assignment_history_id, h.id),
  cancelled_at = COALESCE(tee.cancelled_at, h.cancelled_at, now()),
  cancelled_by = COALESCE(tee.cancelled_by, h.cancelled_by),
  cancel_reason = COALESCE(tee.cancel_reason, h.cancel_reason),
  updated_at = now()
FROM cancelled_histories h,
     public.evaluations ev
WHERE ev.id = tee.evaluation_id
  AND ev.evaluatee_id = h.employee_id
  AND tee.evaluator_id IS NOT DISTINCT FROM h.new_evaluator_id
  AND COALESCE(tee.status, 'active') = 'active'
  AND (
    tee.assignment_history_id IS NULL
    OR tee.assignment_history_id = h.id
    OR tee.evaluation_id = h.evaluation_id
  );

WITH cancelled_entries AS (
  SELECT
    tee.id,
    tee.task_uuid,
    tee.evaluator_id,
    tee.evaluator_name,
    tee.cancelled_at,
    tee.cancelled_by,
    tee.cancel_reason,
    h.cancelled_at AS history_cancelled_at,
    h.cancelled_by AS history_cancelled_by,
    h.cancel_reason AS history_cancel_reason
  FROM public.task_evaluation_entries tee
  LEFT JOIN public.evaluator_assignment_history h ON h.id = tee.assignment_history_id
  WHERE tee.status = 'cancelled'
)
UPDATE public.feedback_history fh
SET
  status = 'cancelled',
  cancelled_at = COALESCE(fh.cancelled_at, ce.cancelled_at, ce.history_cancelled_at, now()),
  cancelled_by = COALESCE(fh.cancelled_by, ce.cancelled_by, ce.history_cancelled_by),
  cancel_reason = COALESCE(fh.cancel_reason, ce.cancel_reason, ce.history_cancel_reason)
FROM cancelled_entries ce
WHERE fh.task_uuid = ce.task_uuid
  AND COALESCE(fh.status, 'active') = 'active'
  AND (
    fh.task_evaluation_entry_id = ce.id
    OR fh.evaluator_id IS NOT DISTINCT FROM ce.evaluator_id
    OR (
      NULLIF(BTRIM(fh.evaluator_name), '') IS NOT NULL
      AND fh.evaluator_name = ce.evaluator_name
    )
  );

UPDATE public.feedback_history fh
SET
  status = 'cancelled',
  cancelled_at = COALESCE(fh.cancelled_at, h.cancelled_at, now()),
  cancelled_by = COALESCE(fh.cancelled_by, h.cancelled_by),
  cancel_reason = COALESCE(fh.cancel_reason, h.cancel_reason)
FROM public.evaluations ev
LEFT JOIN public.evaluator_assignment_history h
  ON h.evaluation_id = ev.id
  AND h.status = 'cancelled'
WHERE fh.evaluation_id = ev.id
  AND COALESCE(fh.status, 'active') = 'active'
  AND (ev.record_status = 'cancelled' OR h.id IS NOT NULL);

WITH affected AS (
  SELECT DISTINCT task_uuid
  FROM public.task_evaluation_entries
  WHERE task_uuid IS NOT NULL
),
entry_counts AS (
  SELECT
    tee.task_uuid,
    COUNT(*) AS total_count
  FROM public.task_evaluation_entries tee
  INNER JOIN affected a ON a.task_uuid = tee.task_uuid
  GROUP BY tee.task_uuid
),
latest AS (
  SELECT DISTINCT ON (tee.task_uuid)
    tee.task_uuid,
    tee.contribution_method,
    tee.contribution_scope,
    tee.score,
    tee.feedback,
    tee.feedback_date,
    tee.evaluator_name
  FROM public.task_evaluation_entries tee
  INNER JOIN affected a ON a.task_uuid = tee.task_uuid
  WHERE COALESCE(tee.status, 'active') = 'active'
  ORDER BY tee.task_uuid, tee.updated_at DESC, tee.created_at DESC
)
UPDATE public.tasks t
SET
  contribution_method = CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_method ELSE t.contribution_method END,
  contribution_scope = CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_scope ELSE t.contribution_scope END,
  score = CASE WHEN entry_counts.total_count > 0 THEN latest.score ELSE t.score END,
  feedback = CASE WHEN entry_counts.total_count > 0 THEN latest.feedback ELSE t.feedback END,
  feedback_date = CASE WHEN entry_counts.total_count > 0 THEN latest.feedback_date ELSE t.feedback_date END,
  evaluator_name = CASE WHEN entry_counts.total_count > 0 THEN latest.evaluator_name ELSE t.evaluator_name END
FROM affected a
LEFT JOIN entry_counts ON entry_counts.task_uuid = a.task_uuid
LEFT JOIN latest ON latest.task_uuid = a.task_uuid
WHERE t.id = a.task_uuid;

DO $$
BEGIN
  ALTER TABLE public.feedback_history
    ADD CONSTRAINT fk_feedback_history_task_uuid
    FOREIGN KEY (task_uuid) REFERENCES public.tasks(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.feedback_history
    ADD CONSTRAINT fk_feedback_history_evaluation
    FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.feedback_history
    ADD CONSTRAINT fk_feedback_history_evaluator
    FOREIGN KEY (evaluator_id) REFERENCES public.employees(employee_id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.feedback_history
    ADD CONSTRAINT fk_feedback_history_task_evaluation_entry
    FOREIGN KEY (task_evaluation_entry_id) REFERENCES public.task_evaluation_entries(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_evaluations_record_status
  ON public.evaluations (record_status);

CREATE INDEX IF NOT EXISTS idx_evaluations_assignment_history
  ON public.evaluations (assignment_history_id);

CREATE INDEX IF NOT EXISTS idx_feedback_history_status
  ON public.feedback_history (status);

CREATE INDEX IF NOT EXISTS idx_feedback_history_task_uuid
  ON public.feedback_history (task_uuid);

CREATE INDEX IF NOT EXISTS idx_feedback_history_evaluation
  ON public.feedback_history (evaluation_id);

CREATE INDEX IF NOT EXISTS idx_feedback_history_evaluator
  ON public.feedback_history (evaluator_id);

CREATE INDEX IF NOT EXISTS idx_feedback_history_task_evaluation_entry
  ON public.feedback_history (task_evaluation_entry_id);

COMMIT;
