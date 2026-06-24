-- Relax evaluator_assignment_history for non-sequential corrections.
--
-- Background: corrections now insert a new superseding `change` row that points
-- back at the row it corrects via `supersedes_history_id`, and the corrected row
-- is marked status='cancelled'. The column + index already exist
-- (enhance_evaluator_assignment_history.sql) but had no referential integrity.
-- This migration only adds the self-referencing FK. Additive, idempotent.

BEGIN;

DO $$
BEGIN
  ALTER TABLE public.evaluator_assignment_history
    ADD CONSTRAINT fk_evaluator_assignment_history_supersedes
    FOREIGN KEY (supersedes_history_id) REFERENCES public.evaluator_assignment_history(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
