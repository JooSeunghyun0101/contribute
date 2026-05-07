BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.evaluation_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  evaluation_year integer NOT NULL,
  starts_on date,
  ends_on date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft'::text, 'active'::text, 'closed'::text, 'locked'::text])),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_periods_pkey PRIMARY KEY (id),
  CONSTRAINT uq_evaluation_periods_code UNIQUE (code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluation_periods_single_default
  ON public.evaluation_periods (is_default)
  WHERE is_default;

CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluation_periods_code_idx
  ON public.evaluation_periods (code);

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS evaluation_period_id uuid;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS evaluation_period_id uuid;

ALTER TABLE public.evaluations
  DROP CONSTRAINT IF EXISTS evaluations_evaluation_status_check;

ALTER TABLE public.evaluations
  ADD CONSTRAINT evaluations_evaluation_status_check
  CHECK (
    evaluation_status = ANY (
      ARRAY[
        'draft'::text,
        'submitted'::text,
        'evaluating'::text,
        'completed'::text,
        'locked'::text,
        'in-progress'::text
      ]
    )
  );

INSERT INTO public.evaluation_periods (
  code,
  name,
  evaluation_year,
  starts_on,
  ends_on,
  status,
  is_default
)
SELECT
  years.evaluation_year::text || '-annual',
  years.evaluation_year::text || ' Annual Evaluation',
  years.evaluation_year,
  make_date(years.evaluation_year, 1, 1),
  make_date(years.evaluation_year, 12, 31),
  CASE
    WHEN years.evaluation_year = EXTRACT(YEAR FROM CURRENT_DATE)::integer THEN 'active'
    ELSE 'closed'
  END,
  years.evaluation_year = EXTRACT(YEAR FROM CURRENT_DATE)::integer
FROM (
  SELECT DISTINCT evaluation_year
  FROM public.evaluations
  WHERE evaluation_year IS NOT NULL
  UNION
  SELECT DISTINCT evaluation_year
  FROM public.tasks
  WHERE evaluation_year IS NOT NULL
  UNION
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer AS evaluation_year
) AS years
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  starts_on = EXCLUDED.starts_on,
  ends_on = EXCLUDED.ends_on,
  status = CASE
    WHEN public.evaluation_periods.status = 'locked' THEN public.evaluation_periods.status
    ELSE EXCLUDED.status
  END,
  is_default = EXCLUDED.is_default,
  updated_at = now();

UPDATE public.evaluations AS e
SET evaluation_period_id = p.id
FROM public.evaluation_periods AS p
WHERE e.evaluation_period_id IS NULL
  AND e.evaluation_year = p.evaluation_year;

UPDATE public.tasks AS t
SET evaluation_period_id = e.evaluation_period_id
FROM public.evaluations AS e
WHERE t.evaluation_period_id IS NULL
  AND t.evaluation_id = e.id
  AND e.evaluation_period_id IS NOT NULL;

UPDATE public.tasks AS t
SET evaluation_period_id = p.id
FROM public.evaluation_periods AS p
WHERE t.evaluation_period_id IS NULL
  AND t.evaluation_year = p.evaluation_year;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_evaluations_period'
  ) THEN
    ALTER TABLE public.evaluations
      ADD CONSTRAINT fk_evaluations_period
      FOREIGN KEY (evaluation_period_id)
      REFERENCES public.evaluation_periods(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_period'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_period
      FOREIGN KEY (evaluation_period_id)
      REFERENCES public.evaluation_periods(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evaluations_period
  ON public.evaluations (evaluation_period_id);

CREATE INDEX IF NOT EXISTS idx_tasks_period
  ON public.tasks (evaluation_period_id);

COMMIT;
