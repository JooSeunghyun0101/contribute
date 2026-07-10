-- ==============================================================
-- Migration: Add evaluation_year columns and enforce consistency via trigger
-- ==============================================================

-- 1️⃣ Ensure evaluation_year column exists in evaluations
ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS evaluation_year integer;

-- 2️⃣ Set default to current year and back‑fill existing rows
ALTER TABLE public.evaluations
  ALTER COLUMN evaluation_year SET DEFAULT EXTRACT(YEAR FROM CURRENT_DATE);

UPDATE public.evaluations
  SET evaluation_year = EXTRACT(YEAR FROM CURRENT_DATE)
  WHERE evaluation_year IS NULL;

-- 3️⃣ Add a UNIQUE constraint on (id, evaluation_year) so it can be referenced by a composite FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_evaluations_id_year'
  ) THEN
    ALTER TABLE public.evaluations
      ADD CONSTRAINT uq_evaluations_id_year UNIQUE (id, evaluation_year);
  END IF;
END
$$;

-- 3️⃣ Ensure evaluation_year column exists in tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS evaluation_year integer;

-- 4️⃣ Set default to current year and back‑fill existing rows
ALTER TABLE public.tasks
  ALTER COLUMN evaluation_year SET DEFAULT EXTRACT(YEAR FROM CURRENT_DATE);

UPDATE public.tasks
  SET evaluation_year = EXTRACT(YEAR FROM CURRENT_DATE)
  WHERE evaluation_year IS NULL;

-- 5️⃣ Add a composite foreign key (evaluation_id, evaluation_year) referencing evaluations(id, evaluation_year)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_evaluation_composite'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_evaluation_composite
      FOREIGN KEY (evaluation_id, evaluation_year)
      REFERENCES public.evaluations(id, evaluation_year)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END
$$;
