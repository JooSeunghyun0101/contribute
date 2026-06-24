BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_profile_import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_file_name text NOT NULL,
  source_sheet_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  imported_by text,
  row_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'applied' CHECK (status = ANY (ARRAY['applied'::text, 'failed'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_profile_import_batches_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.employee_profile_import_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  sheet_name text NOT NULL,
  row_number integer NOT NULL,
  evaluation_group text,
  evaluation_group_id text,
  evaluation_group_name text,
  employee_id text,
  employee_name text,
  org_sequence text,
  department_id text,
  department_name text,
  work_start_date date,
  work_end_date date,
  growth_level integer,
  growth_level_label text,
  position text,
  job_role text,
  evaluator_id text,
  evaluator_name text,
  evaluator_position text,
  target_status text,
  available_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_primary boolean NOT NULL DEFAULT false,
  validation_status text NOT NULL DEFAULT 'valid' CHECK (validation_status = ANY (ARRAY['valid'::text, 'warning'::text, 'error'::text])),
  validation_message text,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_profile_import_rows_pkey PRIMARY KEY (id),
  CONSTRAINT uq_employee_profile_import_rows_batch_sheet_row UNIQUE (batch_id, sheet_name, row_number)
);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS evaluation_group_id text,
  ADD COLUMN IF NOT EXISTS evaluation_group_name text,
  ADD COLUMN IF NOT EXISTS job_role text,
  ADD COLUMN IF NOT EXISTS target_status text,
  ADD COLUMN IF NOT EXISTS last_profile_batch_id uuid;

ALTER TABLE public.employee_profile_import_rows
  ADD COLUMN IF NOT EXISTS available_roles text[] NOT NULL DEFAULT ARRAY[]::text[];

DO $$
BEGIN
  ALTER TABLE public.employee_profile_import_rows
    ADD CONSTRAINT fk_employee_profile_import_rows_batch
    FOREIGN KEY (batch_id) REFERENCES public.employee_profile_import_batches(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employee_profile_import_batches
    ADD CONSTRAINT fk_employee_profile_import_batches_imported_by
    FOREIGN KEY (imported_by) REFERENCES public.employees(employee_id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.employees
    ADD CONSTRAINT fk_employees_last_profile_batch
    FOREIGN KEY (last_profile_batch_id) REFERENCES public.employee_profile_import_batches(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_profile_import_batches_created
  ON public.employee_profile_import_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_profile_import_rows_batch
  ON public.employee_profile_import_rows (batch_id, sheet_name, row_number);

CREATE INDEX IF NOT EXISTS idx_employee_profile_import_rows_employee
  ON public.employee_profile_import_rows (employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_profile_import_rows_evaluator
  ON public.employee_profile_import_rows (evaluator_id);

CREATE INDEX IF NOT EXISTS idx_employee_profile_import_rows_group
  ON public.employee_profile_import_rows (evaluation_group_id);

CREATE INDEX IF NOT EXISTS idx_employees_last_profile_batch
  ON public.employees (last_profile_batch_id);

CREATE INDEX IF NOT EXISTS idx_employees_evaluation_group
  ON public.employees (evaluation_group_id);

COMMIT;
