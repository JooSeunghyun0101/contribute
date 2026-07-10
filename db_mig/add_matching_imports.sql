BEGIN;

CREATE TABLE IF NOT EXISTS public.matching_import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_file_name text NOT NULL,
  source_sheet_name text,
  imported_by text,
  row_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'applied' CHECK (status = ANY (ARRAY['applied'::text, 'failed'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matching_import_batches_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.matching_import_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  row_number integer NOT NULL,
  employee_id text,
  employee_name text,
  org_sequence text,
  department_id text,
  department_name text,
  work_start_date date,
  work_end_date date,
  evaluator_id text,
  evaluator_name text,
  confirmer_id text,
  confirmer_name text,
  evaluation_type text,
  matching_result text,
  is_primary boolean NOT NULL DEFAULT false,
  validation_status text NOT NULL DEFAULT 'valid' CHECK (validation_status = ANY (ARRAY['valid'::text, 'warning'::text, 'error'::text])),
  validation_message text,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matching_import_rows_pkey PRIMARY KEY (id),
  CONSTRAINT uq_matching_import_rows_batch_row UNIQUE (batch_id, row_number)
);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS department_id text,
  ADD COLUMN IF NOT EXISTS org_sequence text,
  ADD COLUMN IF NOT EXISTS work_start_date date,
  ADD COLUMN IF NOT EXISTS work_end_date date,
  ADD COLUMN IF NOT EXISTS evaluation_type text,
  ADD COLUMN IF NOT EXISTS matching_result text,
  ADD COLUMN IF NOT EXISTS confirmer_id text,
  ADD COLUMN IF NOT EXISTS confirmer_name text,
  ADD COLUMN IF NOT EXISTS last_matching_batch_id uuid;

CREATE OR REPLACE FUNCTION public.create_default_evaluation()
RETURNS trigger AS $$
BEGIN
  IF NOT (
    NEW.available_roles @> ARRAY['evaluatee']::text[]
    AND NEW.evaluator_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.evaluations (
    evaluatee_id,
    evaluatee_name,
    evaluatee_position,
    evaluatee_department,
    growth_level,
    evaluation_status,
    evaluation_year,
    evaluation_period_id,
    created_at,
    updated_at
  ) VALUES (
    NEW.employee_id,
    NEW.name,
    NEW.position,
    NEW.department,
    COALESCE(NEW.growth_level, 0),
    'draft',
    COALESCE(
      (SELECT evaluation_year FROM public.evaluation_periods WHERE status = 'active' ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC LIMIT 1),
      EXTRACT(YEAR FROM CURRENT_DATE)
    ),
    (SELECT id FROM public.evaluation_periods WHERE status = 'active' ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC LIMIT 1),
    now(),
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  ALTER TABLE public.matching_import_rows
    ADD CONSTRAINT fk_matching_import_rows_batch
    FOREIGN KEY (batch_id) REFERENCES public.matching_import_batches(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.matching_import_batches
    ADD CONSTRAINT fk_matching_import_batches_imported_by
    FOREIGN KEY (imported_by) REFERENCES public.employees(employee_id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employees
    ADD CONSTRAINT fk_employees_last_matching_batch
    FOREIGN KEY (last_matching_batch_id) REFERENCES public.matching_import_batches(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_matching_import_batches_created
  ON public.matching_import_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_matching_import_rows_batch
  ON public.matching_import_rows (batch_id, row_number);

CREATE INDEX IF NOT EXISTS idx_matching_import_rows_employee
  ON public.matching_import_rows (employee_id);

CREATE INDEX IF NOT EXISTS idx_matching_import_rows_evaluator
  ON public.matching_import_rows (evaluator_id);

CREATE INDEX IF NOT EXISTS idx_matching_import_rows_primary
  ON public.matching_import_rows (batch_id, is_primary);

CREATE INDEX IF NOT EXISTS idx_employees_department_id
  ON public.employees (department_id);

CREATE INDEX IF NOT EXISTS idx_employees_last_matching_batch
  ON public.employees (last_matching_batch_id);

COMMIT;
